import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Repo } from '../../engine/src/core/git.ts';
import { isAgentId, isTaskReviewNote, type Annotation, type ExternalReview, type ExternalReviewOptions, type ExternalReviewRemote } from '../shared.ts';
import { taskTitle } from '../task-caption.ts';
import { canonicalGroup, parseGroupInstructions } from '../note-groups.ts';
import {
  createHandoffRequest, handoffCommit, handoffCommitPattern, handoffFiles, handoffGit, handoffIdPattern, handoffReceipt, handoffReceiptMarkdown,
  handoffFence, handoffNotes, handoffRecord, handoffRequestMarkdown, handoffSource, handoffTaskPrompt, proposalDigest, validateHandoffProposal,
} from './review-handoff.ts';
import { taskRoute, type reviewClient } from './review.ts';
import type { Store } from './store.ts';
import type { Workspace } from './workspace.ts';

export const EXTERNAL_REVIEWS = 'external-reviews';
const route = '/api/projects/:id/external-review';
const projectScope = { config: { resource: { project: 'id' } } } as const;
const proposalLimit = 2 * 1024 * 1024;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
type SavedReview = ExternalReview & { noteSelection?: string; automaticRequest?: string; requestPublication?: string; result?: NonNullable<ExternalReview['result']> & { publication?: string } };
type Params = { id: string; review?: string };
type ReviewRequest = FastifyRequest<{ Params: Params; Body: Record<string, unknown> }>;

function githubRepository(raw: string) {
  const ssh = /^git@github\.com:([\w.-]+\/[\w.-]+)$/i.exec(raw)?.[1];
  let repo = ssh;
  if (!repo) try {
    const url = new URL(raw);
    if (['https:', 'ssh:'].includes(url.protocol) && url.hostname.toLowerCase() === 'github.com' && !url.port && !url.search && !url.hash) repo = url.pathname.slice(1);
  } catch { /* A non-GitHub remote still supports the Git exchange. */ }
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return undefined;
  return repo.replace(/\.git$/i, '');
}

async function configuredRemotes(repo: Repo): Promise<ExternalReviewRemote[]> {
  const remoteNames = (await handoffGit(repo, ['remote'])).toString().split('\n').filter(Boolean);
  return (await Promise.all(remoteNames.map(async name => {
    const urls = await Promise.all([[], ['--push']].map(flags => handoffGit(repo, ['remote', 'get-url', '--all', ...flags, name], { check: false })
      .then(output => output.toString().trim().split('\n').filter(Boolean))));
    if (urls.some(list => list.length !== 1)) return null;
    const [fetch, push] = urls.map(list => list[0]);
    const repository = githubRepository(fetch), pushed = githubRepository(push);
    if (fetch !== push && (!repository || repository.toLowerCase() !== pushed?.toLowerCase())) return null;
    return { name, revision: sha256(JSON.stringify([fetch, push])), ...(repository ? { repository, url: `https://github.com/${repository}` } : {}) };
  }))).filter(remote => remote !== null);
}

const gitOptions = { timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } };
const localRef = (id: string, kind: string) => `refs/papilot/external-review/${id}/${kind}`;
const branchRef = (branch: string) => `refs/heads/${branch}`;
const commitManuscriptError = () => new Error('Commit the current manuscript before requesting an external review.');

async function automaticReviewFiles(repo: Repo, baseCommit: string, document: () => Promise<string | undefined>, notes: Annotation[]) {
  const committed = new Set(await handoffFiles(repo, baseCommit));
  const sources = [...new Set(notes.flatMap(note => note.source && committed.has(note.source.file) ? [note.source.file] : []))];
  if (sources.length) return sources;
  const main = await document();
  if (!main) throw new Error('Choose an existing TeX main file.');
  if (!committed.has(main)) throw commitManuscriptError();
  return [main];
}

async function fetchReviewBranch(repo: Repo, remote: string, branch: string, destination: string) {
  await handoffGit(repo, ['fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--', remote, `+${branchRef(branch)}:${destination}`], gitOptions);
  return handoffCommit(repo, destination);
}

async function publishReviewBranch(repo: Repo, remote: string, branch: string, commit: string, destination: string) {
  const ref = branchRef(branch);
  try {
    await handoffGit(repo, ['-c', `remote.${remote}.mirror=false`, 'push', '--no-follow-tags',
      `--force-with-lease=${ref}:`, '--', remote, `${commit}:${ref}`], gitOptions);
  } catch (error) {
    // Recover a successful push even if its response was lost and the branch has advanced.
    const tip = await fetchReviewBranch(repo, remote, branch, destination).catch(() => undefined);
    if (!tip || (await handoffGit(repo, ['merge-base', commit, tip], { check: false })).toString().trim() !== commit) throw error;
  }
}

async function commitReviewFiles(repo: Repo, parent: string, files: Record<string, string>, message: string) {
  const paths = Object.keys(files).sort();
  if ((await handoffGit(repo, ['ls-tree', parent, '--', ...paths])).length) throw new Error('A review exchange file already exists in the manuscript.');
  const commit = await repo.commitWithAsync(parent, Object.fromEntries(paths.map(file => [file, Buffer.from(files[file])])), message);
  const changed = (await handoffGit(repo, ['diff', '--name-only', '--no-relative', '--no-renames', '--ignore-submodules=none', '-z', parent, commit])).toString().split('\0').filter(Boolean);
  const published = await Promise.all(paths.map(file => handoffSource(repo, commit, file)));
  if (changed.sort().join('\0') !== paths.join('\0') || published.some((text, index) => text !== files[paths[index]])) {
    throw new Error('Could not prepare a Git commit containing only the review exchange files.');
  }
  return commit;
}

function pageLink(value: unknown) {
  if (value === '') return undefined;
  if (typeof value === 'string') try {
    const url = new URL(value.trim());
    if (url.origin === 'https://chatgpt.com' && !url.username && !url.password && /^\/space\/page_[a-z0-9]+\/?$/i.test(url.pathname)) return url.origin + url.pathname;
  } catch { /* Report a format error below. */ }
  throw new Error('Paste a ChatGPT Space Page link.');
}

export function registerExternalReviewRoutes(app: FastifyInstance, { store, workspace, serialGit, connectReview, settleAnnotation, currentDocument }: {
  store: Store; workspace: Workspace; serialGit: <T>(projectId: string, work: () => Promise<T>) => Promise<T>; connectReview: typeof reviewClient;
  settleAnnotation?: (id: string) => Promise<void> | undefined;
  currentDocument: (id: string, root: string) => Promise<string | undefined>;
}) {
  const enabled = () => store.preference<boolean>(EXTERNAL_REVIEWS) === true;
  const projectRepo = (id: string) => {
    if (!enabled()) throw new Error('Enable external reviews in Settings → Experiments first.');
    return new Repo(store.project(id).path);
  };
  const save = (id: string, review: SavedReview) => { store.saveExternalReview(id, review); return review; };
  const find = (id: string, key: string | undefined) => {
    const review = key && handoffIdPattern.test(key) ? store.externalReview<SavedReview>(id, key) : undefined;
    if (!review) throw new Error('This external review no longer exists.');
    return review;
  };
  // Mutations in two tabs see the same saved request and share the paper's Git queue.
  const change = <T>(handler: (repo: Repo, id: string, review: SavedReview, body: Record<string, unknown>) => Promise<T> | T) => (request: ReviewRequest) => {
    const { id, review } = request.params;
    return serialGit(id, async () => handler(projectRepo(id), id, find(id, review), request.body ?? {}));
  };
  const gitRemoteFor = async (repo: Repo, review: SavedReview) => {
    const remote = (await configuredRemotes(repo)).find(remote => remote.name === review.git?.remote.name && remote.revision === review.git?.remote.revision);
    if (!remote || !review.git) throw new Error('The review Git remote changed. Restore it to continue or use the Space Page.');
    return remote;
  };
  const completedReview = async (repo: Repo, review: SavedReview) => {
    const task = review.taskId && store.findTask(review.taskId);
    if (!task || !review.proposal || task.status !== 'reviewing' || task.reconciliation || task.pendingReview) throw new Error('Finish the local task and review its changes before preparing a receipt.');
    const client = await connectReview(repo.root);
    const info = await client.get<{ state: string; round: number | null; baseCommit: string; acceptedCommit: string }>(taskRoute(task.name));
    if (info.round !== null && info.state !== 'done') throw new Error('Finish reviewing the local task before preparing a receipt.');
    if (info.round === null && info.state !== 'editing') throw new Error('Finish the local task and review its changes before preparing a receipt.');
    return info;
  };
  const assertCurrentReceipt = async (repo: Repo, review: SavedReview) => {
    const info = await completedReview(repo, review);
    if (info.acceptedCommit !== review.result?.accepted) throw new Error('The accepted changes have moved. Prepare a new receipt.');
  };

  app.post<{ Body: { enabled?: boolean } }>('/api/external-reviews', request => {
    if (typeof request.body?.enabled !== 'boolean') throw new Error('Send enabled as true or false.');
    store.savePreference(EXTERNAL_REVIEWS, request.body.enabled);
    store.emit('change');
    return { enabled: request.body.enabled };
  });
  app.get<{ Params: Params; Querystring: { scope?: string; review?: string } }>(route, projectScope, async (request): Promise<ExternalReviewOptions> => {
    const { id } = request.params, repo = projectRepo(id), { scope, review } = request.query;
    const selected = review ? find(id, review) : undefined;
    const baseCommit = selected?.request.baseCommit ?? await handoffCommit(repo, 'HEAD');
    const [files, remotes] = await Promise.all([handoffFiles(repo, baseCommit), configuredRemotes(repo)]);
    return { baseCommit, files, remotes, reviews: selected ? [selected] : scope === 'files' ? [] : store.externalReviews(id) };
  });
  app.post<{ Params: Params; Body: { baseCommit?: unknown; document?: unknown; files?: unknown; question?: unknown; composerId?: unknown; annotations?: unknown; groupInstructions?: unknown } }>(route, { ...projectScope, bodyLimit: proposalLimit }, request => serialGit(request.params.id, async () => {
    const { id } = request.params, repo = projectRepo(id), { baseCommit, document, question, files, composerId, annotations, groupInstructions } = request.body ?? {};
    if ((baseCommit !== undefined || files !== undefined) && (typeof baseCommit !== 'string' || !handoffCommitPattern.test(baseCommit))) throw new Error('Choose a committed version to review.');
    if (document !== undefined && typeof document !== 'string') throw new Error('Choose an existing TeX main file.');
    if (composerId !== undefined && (typeof composerId !== 'string' || !handoffIdPattern.test(composerId))) throw new Error('This external review no longer exists.');
    if (annotations !== undefined && (!Array.isArray(annotations) || annotations.some((note: unknown) => typeof note !== 'string' || !note || note.length > 64))) throw new Error('Select valid PDF notes for this task.');
    const noteIds = [...new Set<string>(annotations ?? [])], directions = parseGroupInstructions(groupInstructions);
    const noteSelection = noteIds.length ? sha256(JSON.stringify([noteIds, Object.entries(directions).sort()])) : undefined;
    const text = noteIds.length && (question === undefined || typeof question === 'string' && !question.trim()) ? 'Review the selected PDF annotations and suggest focused changes.' : question;
    const prior = composerId && store.externalReview<SavedReview>(id, composerId);
    // The same composer submission keeps its original commit and note snapshot,
    // even when HEAD or the manuscript's active document changes before retry.
    const automaticRequest = files === undefined && composerId ? sha256(JSON.stringify([baseCommit, document, typeof text === 'string' ? text.trim() : text, noteSelection])) : undefined;
    if (prior && automaticRequest) {
      if (!prior.fromComposerAt || prior.automaticRequest !== automaticRequest) throw new Error('This external review no longer exists.');
      return prior;
    }
    const commit = typeof baseCommit === 'string' ? baseCommit : await handoffCommit(repo, 'HEAD').catch(() => { throw commitManuscriptError(); });
    if (prior) {
      const record = await createHandoffRequest(repo, commit, text, files, composerId);
      const { notes: _, ...previousRequest } = prior.request;
      if (!prior.fromComposerAt || prior.automaticRequest || prior.noteSelection !== noteSelection || JSON.stringify(previousRequest) !== JSON.stringify(record)) throw new Error('This external review no longer exists.');
      return prior;
    }
    if (noteIds.length && settleAnnotation) await Promise.all(noteIds.map(settleAnnotation));
    const notes = noteIds.map(noteId => {
      const note = store.findAnnotation(id, noteId);
      if (!note || note.taskId || note.deletedAt !== undefined || isTaskReviewNote(note)) throw new Error('A selected PDF note is no longer available. Refresh the manuscript and try again.');
      return note;
    });
    const selectedFiles = files === undefined ? await automaticReviewFiles(repo, commit, async () => document || await currentDocument(id, repo.root), notes) : files;
    const record = await createHandoffRequest(repo, commit, text, selectedFiles, composerId);
    if (notes.length) {
      if (Object.keys(directions).some(group => !notes.some(note => note.group && canonicalGroup(note.group) === group))) throw new Error('Group instructions must refer to selected PDF notes.');
      if (files !== undefined) {
        const outside = notes.flatMap(note => note.source && !record.files.includes(note.source.file) ? [note.source.file] : []);
        if (outside.length && (await handoffFiles(repo, commit)).some(file => outside.includes(file))) throw new Error('Add the source files for the selected PDF notes, or deselect those notes.');
      }
      record.notes = await handoffNotes(repo, record, notes, directions);
    }
    const review: SavedReview = { request: record, ...(composerId ? { fromComposerAt: Date.now() } : {}), ...(noteSelection ? { noteSelection } : {}), ...(automaticRequest ? { automaticRequest } : {}) };
    await repo.updateRefAsync(localRef(review.request.requestId, 'base'), commit);
    return save(id, review);
  }));
  app.post(`${route}/:review/page`, projectScope, change((_repo, id, review, body) => save(id, { ...review, page: pageLink(body.url) })));
  app.post(`${route}/:review/github`, projectScope, change(async (repo, id, review, body) => {
    if (review.git) return review;
    const remote = (await configuredRemotes(repo)).find(candidate => candidate.name === body.remote);
    if (!remote) throw new Error('Choose a Git remote with matching fetch and push destinations.');
    if (remote.revision !== body.revision) throw new Error('The review Git remote changed. Restore it to continue or use the Space Page.');
    const { requestId, baseCommit } = review.request, branch = `papilot-review/${requestId}`;
    const file = `papilot-review-${requestId}-request.md`;
    let commit = review.requestPublication;
    if (!commit) {
      const markdown = await handoffRequestMarkdown(repo, review.request, false);
      commit = await commitReviewFiles(repo, baseCommit, { [file]: `${markdown}\n` }, 'Record external review request');
      await repo.updateRefAsync(localRef(requestId, 'request'), commit);
      review = save(id, { ...review, requestPublication: commit });
    }
    await publishReviewBranch(repo, remote.name, branch, commit, localRef(requestId, 'proposal'));
    const url = remote.url && `${remote.url}/blob/${commit}/${file}`;
    return save(id, { ...review, git: { branch, remote, proposalFile: `papilot-review-${requestId}.json`, request: { file, commit, ...(url ? { url } : {}) } } });
  }));
  app.get<{ Params: Params; Querystring: { via?: string } }>(`${route}/:review/prompt`, projectScope, async request => {
    const { id, review: key } = request.params, repo = projectRepo(id), review = find(id, key);
    const git = request.query.via === 'git' && review.git;
    if (request.query.via === 'git' && !git) throw new Error('Publish the review branch before copying its prompt.');
    const context = git && git.request;
    const lead = git
      ? [
        `Read the selected committed files in ${git.remote.repository ?? `Git remote ${git.remote.name}`} at the base commit below. Use the GitHub app if this is a GitHub repository.`,
        ...(context ? [`The shared review request and selected PDF notes are in ${context.file} at ${context.commit} on ${git.branch}.${context.url ? ` Open ${context.url}` : ''} The same request is copied below for reference. Cite the source file paths and verify the exact passages at the requested base commit.`] : []),
        `Return the proposal as JSON here. If you have write access, save the same JSON to ${git.proposalFile} on the existing branch ${git.branch}.`,
      ].join('\n\n')
      : request.query.via === 'chat'
        ? 'Review the committed source included below and return the proposal in a JSON code block in this chat.'
        : `${review.page ? `Open this ChatGPT Space Page ${review.page}.` : 'Create a private ChatGPT Space Page for this review.'} Put the review request and your proposal on the Page. Write the proposal in its own top-level JSON code block. If you cannot write to the Page, return the same JSON here.`;
    return { text: `${lead}\n\n${await handoffRequestMarkdown(repo, review.request, !git)}` };
  });
  app.post(`${route}/:review/proposal`, { ...projectScope, bodyLimit: proposalLimit }, change(async (repo, id, review, body) => {
    if (review.taskId && store.findTask(review.taskId)) throw new Error('This proposal already has a local task. Start a new review for another proposal.');
    const { requestId, baseCommit } = review.request;
    let source: 'git' | 'paste' = 'paste', commit: string | undefined, input = body.text;
    if (body.via === 'git' && review.git) {
      const remote = await gitRemoteFor(repo, review), ref = localRef(requestId, 'proposal');
      commit = await fetchReviewBranch(repo, remote.name, review.git.branch, ref);
      const ancestor = review.git.request?.commit ?? baseCommit;
      if ((await handoffGit(repo, ['merge-base', ancestor, commit])).toString().trim() !== ancestor) throw new Error('The review branch no longer contains the requested commit.');
      try { input = await handoffSource(repo, commit, review.git.proposalFile); }
      catch { throw new Error('No readable proposal was found on the review branch. Try again after the reviewer writes it, or paste the JSON.'); }
      source = 'git';
    }
    if (typeof input !== 'string') throw new Error('Paste the proposal JSON from the review.');
    const proposal = await validateHandoffProposal(repo, review.request, handoffRecord(input, 'proposal', requestId));
    return save(id, { ...review, result: undefined, proposal: { digest: proposalDigest(proposal.changes), changes: proposal.changes, source, ...(commit ? { commit } : {}) } });
  }));
  app.post(`${route}/:review/task`, projectScope, change(async (repo, id, review, body) => {
    if (!review.proposal) throw new Error('Import a proposal before starting a local agent.');
    if (review.proposal.digest !== body.digest) throw new Error('This proposal changed. Reopen the review and check the latest proposal.');
    const existing = review.taskId && store.findTask(review.taskId);
    if (existing) {
      if (existing.externalReview?.requestId !== review.request.requestId) throw new Error('This task belongs to a different review.');
      return { review, task: workspace.retryTask(existing.id) };
    }
    const agent = body.agent;
    if (!isAgentId(agent) || agent === 'collaboration') throw new Error('Choose a local agent.');
    const { requestId, baseCommit, question, notes } = review.request;
    const idForTask = !review.taskId || store.taskDeleted(review.taskId) ? `external-${randomUUID()}` : review.taskId;
    const changes = review.proposal.changes;
    // Confirm the saved Git base is still readable, even when the manuscript has advanced.
    await handoffCommit(repo, baseCommit);
    review = save(id, { ...review, taskId: idForTask, result: undefined });
    const task = await workspace.createTask({ id: idForTask, projectId: id, agent,
      ...(typeof body.model === 'string' && body.model ? { model: body.model } : {}),
      title: taskTitle(question), permissions: 'workspace',
      instructions: handoffTaskPrompt({ baseCommit, question, notes, changes }, true),
      externalReview: { requestId, baseCommit, files: [...new Set(changes.map(change => change.file))] },
    });
    return { task, review };
  }));
  app.post(`${route}/:review/receipt`, projectScope, change(async (repo, id, review) => {
    const info = await completedReview(repo, review);
    if (review.result?.accepted === info.acceptedCommit) return review;
    const { requestId, baseCommit } = review.request;
    if (await handoffCommit(repo, `${info.baseCommit}^`) !== baseCommit) throw new Error('The local task starts from a different commit.');
    const acceptedTree = (await handoffGit(repo, ['rev-parse', '--verify', `${info.acceptedCommit}^{tree}`])).toString().trim();
    const baseTree = (await handoffGit(repo, ['rev-parse', '--verify', `${baseCommit}^{tree}`])).toString().trim();
    // Publish only the accepted tree. Intermediate review history can contain
    // text that the author rejected, so the result has the published base as its parent.
    const resultCommit = acceptedTree === baseTree ? baseCommit : await repo.commitTreeAsync(acceptedTree, baseCommit, 'Implement external review');
    const receipt = await handoffReceipt(repo, { requestId, baseCommit, changes: review.proposal!.changes }, resultCommit, true);
    await repo.updateRefAsync(localRef(requestId, 'result'), resultCommit);
    return save(id, { ...review, result: { accepted: info.acceptedCommit, receipt } });
  }));
  app.get<{ Params: Params; Querystring: { resultCommit?: string } }>(`${route}/:review/receipt`, projectScope, async (request, reply) => {
    const { id, review: key } = request.params, repo = projectRepo(id), review = find(id, key);
    if (!review.result) throw new Error('Prepare a receipt before sharing it.');
    const { receipt } = review.result;
    if (request.query.resultCommit !== receipt.resultCommit) throw new Error('The accepted changes have moved. Prepare a new receipt.');
    await assertCurrentReceipt(repo, review);
    const patch = (await handoffGit(repo, ['diff', '--no-relative', '--no-ext-diff', '--no-textconv', receipt.baseCommit, receipt.resultCommit])).toString();
    const text = handoffReceiptMarkdown(receipt);
    reply.header('Cache-Control', 'no-store');
    return { text: `${text}${patch ? `\n\n${handoffFence('diff', patch)}` : ''}` };
  });
  app.post(`${route}/:review/result`, projectScope, change(async (repo, id, review, body) => {
    if (!review.result || !review.git || !review.taskId) throw new Error('Prepare a receipt and publish the review branch before sharing the result.');
    if (body.resultCommit !== review.result.receipt.resultCommit) throw new Error('The accepted changes have moved. Prepare a new receipt.');
    if (review.result.published) return review;
    const remote = await gitRemoteFor(repo, review), { receipt } = review.result;
    const branch = `${review.git.branch}-result-${receipt.resultCommit.slice(0, 12)}`;
    const file = `papilot-review-${receipt.requestId}-receipt.md`;
    const request = review.git.request;
    const context = request?.url ? `[Review request](${request.url})` : request ? `Review request \`${request.file}\` on \`${review.git.branch}\`` : '';
    const markdown = [handoffReceiptMarkdown(receipt), context, `[Checked proposal](./${review.git.proposalFile})`].filter(Boolean).join('\n\n') + '\n';
    let publication = review.result.publication;
    if (!publication) {
      const { schema, requestId, baseCommit } = review.request;
      const proposal = { schema, kind: 'proposal', requestId, baseCommit, changes: review.proposal!.changes };
      publication = await commitReviewFiles(repo, receipt.resultCommit, {
        [file]: markdown,
        [review.git.proposalFile]: `${JSON.stringify(proposal, null, 2)}\n`,
      }, 'Record external review result');
      await repo.updateRefAsync(localRef(receipt.requestId, 'publication'), publication);
      review = save(id, { ...review, result: { ...review.result, publication } });
    }
    const commit = publication;
    return workspace.reviewWrite(review.taskId!, true, async () => {
      await assertCurrentReceipt(repo, review);
      await publishReviewBranch(repo, remote.name, branch, commit, localRef(receipt.requestId, 'published-result'));
      return save(id, { ...review, result: { ...review.result!, published: { branch, ...(remote.url ? { url: `${remote.url}/blob/${commit}/${file}` } : {}) } } });
    });
  }));
}
