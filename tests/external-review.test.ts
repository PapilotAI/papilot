import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Repo } from '../engine/src/core/git.ts';
import { Store } from '../src/server/store.ts';
import { gitQueue } from '../src/server/app.ts';
import { registerExternalReviewRoutes } from '../src/server/review-handoff-routes.ts';
import { handoffRecord } from '../src/server/review-handoff.ts';
import type { Workspace } from '../src/server/workspace.ts';
import type { ReviewClient } from '../src/server/review.ts';
import type { Annotation, ExternalReview, Task } from '../src/shared.ts';

test('an external review round trips from Git and Space into a pinned task and published receipt', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-external-review-'));
  const root = path.join(folder, 'paper'), remote = path.join(folder, 'remote.git'), reviewer = path.join(folder, 'reviewer');
  const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const commit = (dir: string, message: string) => git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(folder, 'no-hooks')}`, 'commit', '-qm', message);
  git(folder, 'init', '--bare', '-b', 'main', remote);
  git(folder, 'clone', remote, root);
  const initial = 'Keep this introduction.\nMake this text a little more concise.\n';
  fs.writeFileSync(path.join(root, 'main.tex'), initial);
  fs.writeFileSync(path.join(root, 'appendix.tex'), 'Extra detail.\n');
  git(root, 'add', 'main.tex', 'appendix.tex'); commit(root, 'Original paper'); git(root, 'push', 'origin', 'main');
  const base = git(root, 'rev-parse', 'HEAD'), repo = new Repo(root);
  const store = new Store(path.join(folder, 'store.sqlite')), app = Fastify();
  const projectId = 'paper', endpoint = `/api/projects/${projectId}/external-review`;
  store.saveProject({ id: projectId, name: 'Paper', path: root, createdAt: 1 });
  const tasks: Task[] = [];
  const workspace = {
    async createTask(input: Partial<Task> & Pick<Task, 'id' | 'projectId' | 'title' | 'instructions'>) {
      const task: Task = { ...input, name: input.id, worktree: '', threadId: null, turnId: null, model: null,
        status: 'preparing', preparation: {}, createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
      tasks.push(task); return store.saveTask(task);
    },
    retryTask: (id: string) => store.task(id),
    reviewWrite: (_id: string, _writesFiles: boolean, work: () => Promise<unknown>) => work(),
  } as Workspace;
  const engineBase = await repo.commitTreeAsync(await repo.treeIdAsync(base), base, 'Papilot snapshot');
  let engineState = { state: 'reviewing', round: 1, baseCommit: engineBase, acceptedCommit: engineBase };
  app.setErrorHandler((error, _request, reply) => { reply.code(400).send({ error: (error as Error).message }); });
  registerExternalReviewRoutes(app, { store, workspace, serialGit: gitQueue(), currentDocument: async () => 'appendix.tex', connectReview: async () => ({ get: async () => engineState }) as unknown as ReviewClient });
  t.after(async () => { await app.close(); store.db.close(); fs.rmSync(folder, { recursive: true, force: true }); });
  const get = (url = endpoint) => app.inject({ method: 'GET', url });
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
  const ok = async <T = ExternalReview>(response: ReturnType<typeof post>) => {
    const result = await response; assert.equal(result.statusCode, 200, result.body); return result.json<T>();
  };

  assert.equal((await get()).statusCode, 400);
  await ok(post('/api/external-reviews', { enabled: true }));
  const request = { baseCommit: base, files: ['main.tex'], question: 'Review the introduction.' };
  await ok(post(endpoint, request));
  const defaultScope = await ok(post(endpoint, { question: 'Review the current paper.' }));
  assert.equal(defaultScope.request.baseCommit, base);
  assert.deepEqual(defaultScope.request.files, ['appendix.tex']);
  const shownScope = await ok(post(endpoint, { question: 'Review the main document.', document: 'main.tex' }));
  assert.deepEqual(shownScope.request.files, ['main.tex']);
  assert.match((await post(endpoint, { question: 'Review the draft.', document: 'draft.tex' })).json().error, /Commit the current manuscript/);
  assert.deepEqual(store.pendingExternalReviewConversations(), [], 'Legacy wizard requests stay in review history');
  const composerId = '4fb4a42b-5c2b-40d3-a860-01a3b05198f0';
  const selected: Annotation = { id: 'selected-note', projectId, key: 'older-pdf', page: 1, rect: [0, 0, 1, 1],
    comment: 'Remove the repeated qualifier.', quote: 'Make this text a little more concise.', createdAt: 1, group: 'blue', groupInstruction: 'Old group wording.',
    author: { id: 'private-id', name: 'Private author' }, source: { file: 'main.tex', lines: [40, 42], excerpt: 'Make this text a little more concise.' } };
  store.saveAnnotation(selected);
  store.saveAnnotation({ ...selected, id: 'unselected-note', comment: 'Do not share this other note.' });
  store.saveAnnotation({ ...selected, id: 'stale-note', comment: 'Explain this missing wording.', quote: 'The older draft had this sentence.', source: { file: 'main.tex', lines: [90, 90] } });
  store.saveAnnotation({ ...selected, id: 'appendix-note', source: { file: 'appendix.tex', lines: [1, 1] } });
  store.saveAnnotation({ ...selected, id: 'unmapped-note', source: null });
  store.saveAnnotation({ ...selected, id: 'unplaced-ai-note', aiReview: { taskId: 'other', agent: 'codex' } });
  const fallback = await ok(post(endpoint, { annotations: ['unmapped-note'] }));
  assert.deepEqual(fallback.request.files, ['appendix.tex']);
  assert.deepEqual(fallback.request.notes, [{ page: 2, comment: selected.comment, quote: selected.quote, group: 'yellow' }]);
  const composerRequest = { question: '', document: 'appendix.tex', composerId, annotations: [selected.id, 'stale-note'], groupInstructions: { yellow: 'Keep the meaning.' } };
  assert.match((await post(endpoint, { ...request, ...composerRequest, annotations: ['appendix-note'] })).json().error, /Add the source files/);
  assert.match((await post(endpoint, { ...composerRequest, annotations: ['unplaced-ai-note'] })).json().error, /no longer available/);
  assert.match((await post(endpoint, { ...composerRequest, groupInstructions: { red: 'Unrelated direction' } })).json().error, /must refer to selected PDF notes/);
  const [review, replayed] = await Promise.all([1, 2].map(() => ok(post(endpoint, composerRequest))));
  assert.equal(review.request.requestId, composerId);
  assert.equal(review.request.baseCommit, base);
  assert.deepEqual(review.request.files, ['main.tex'], 'The selected notes supply scope even in another root document');
  assert.deepEqual(replayed, review);
  assert.deepEqual(review.request.notes, [
    { page: 2, comment: selected.comment, quote: selected.quote, group: 'yellow', groupInstruction: 'Keep the meaning.', source: { file: 'main.tex', lines: [2, 2], excerpt: selected.quote } },
    { page: 2, comment: 'Explain this missing wording.', quote: 'The older draft had this sentence.', group: 'yellow', groupInstruction: 'Keep the meaning.', source: { file: 'main.tex' } },
  ]);
  store.saveAnnotation({ ...selected, comment: 'Edited after the request.', deletedAt: 10 });
  assert.deepEqual(await ok(post(endpoint, composerRequest)), review, 'Retry returns the immutable note snapshot');
  assert.deepEqual(store.pendingExternalReviewConversations(), [{ id: composerId, projectId, title: 'Review the selected PDF annotations and suggest focused changes', createdAt: review.fromComposerAt }]);
  assert.equal((await post(endpoint, { ...composerRequest, question: 'A different question.' })).statusCode, 400);
  assert.equal((await post(endpoint, { ...composerRequest, document: 'main.tex' })).statusCode, 400);
  assert.equal((await post(endpoint, { ...composerRequest, annotations: ['unselected-note'] })).statusCode, 400);
  assert.deepEqual((await get(`${endpoint}?scope=files`)).json().reviews, []);
  assert.deepEqual((await get(`${endpoint}?review=${composerId}`)).json().reviews, [review]);
  const reviewRoute = `${endpoint}/${review.request.requestId}`;
  const page = 'https://chatgpt.com/space/page_abc123';
  assert.equal((await post(`${reviewRoute}/page`, { url: 'https://chatgpt.com.evil.example/space/page_abc123' })).statusCode, 400);
  await ok(post(`${reviewRoute}/page`, { url: page }));
  const space = (await get(`${reviewRoute}/prompt?via=space`)).json().text;
  assert.ok(space.includes(initial)); assert.ok(space.includes(page));
  assert.doesNotMatch(space, /Extra detail\./);

  const [{ revision }] = (await get()).json().remotes;
  assert.equal((await post(`${reviewRoute}/github`, { remote: 'origin', revision: 'stale' })).statusCode, 400);
  const occupiedBranch = `papilot-review/${shownScope.request.requestId}`;
  git(remote, 'branch', occupiedBranch, base);
  assert.equal((await post(`${endpoint}/${shownScope.request.requestId}/github`, { remote: 'origin', revision })).statusCode, 400);
  assert.equal(git(remote, 'rev-parse', occupiedBranch), base, 'A review never advances a branch it did not publish');
  const publishRequest = () => post(`${reviewRoute}/github`, { remote: 'origin', revision });
  const [published, repeated] = await Promise.all([ok(publishRequest()), ok(publishRequest())]);
  const link = published.git!;
  const context = link.request!;
  assert.deepEqual(repeated.git, link);
  assert.equal(git(remote, 'rev-parse', link.branch), context.commit);
  assert.equal(git(remote, 'rev-parse', `${link.branch}^`), base);
  assert.equal(git(remote, 'diff', '--name-only', base, context.commit), context.file);
  assert.equal(git(remote, 'rev-parse', 'main'), base, 'Publishing does not move the manuscript branch');
  assert.equal(git(root, 'status', '--porcelain'), '', 'Publishing does not write to the manuscript checkout');
  const shared = git(remote, 'show', `${context.commit}:${context.file}`);
  assert.deepEqual(handoffRecord(shared, 'request'), review.request);
  assert.doesNotMatch(shared, /## Selected source|Extra detail\./);
  const prompt = (await get(`${reviewRoute}/prompt?via=git`)).json().text;
  assert.ok(prompt.includes(link.branch) && prompt.includes(link.proposalFile) && prompt.includes(context.file) && prompt.includes(context.commit));
  assert.ok(!prompt.includes(initial));
  for (const text of [space, prompt, shared]) {
    assert.ok(text.includes(selected.comment) && text.includes(selected.quote) && text.includes('Keep the meaning.'));
    assert.doesNotMatch(text, /Private author|selected-note|Do not share|Edited after|Old group wording/);
  }
  assert.match((await post(`${reviewRoute}/proposal`, { via: 'git' })).json().error, /No readable proposal/);

  const changes = [{ file: 'main.tex', original: 'Make this text a little more concise.', suggestion: 'Keep the text concise.', reason: 'Remove the qualifier.' }];
  const proposal = { schema: review.request.schema, kind: 'proposal', requestId: review.request.requestId, baseCommit: base, changes };
  const paste = '## Suggestion\n\n```json\n' + JSON.stringify(proposal) + '\n```';
  const unrelated = { ...proposal, changes: [{ ...changes[0], file: 'appendix.tex', original: 'Extra detail.' }] };
  assert.match((await post(`${reviewRoute}/proposal`, { text: JSON.stringify(unrelated) })).json().error, /did not authorize review of appendix\.tex/);
  assert.match((await post(`${reviewRoute}/proposal`, { text: paste.replace(base, '0'.repeat(40)) })).json().error, /match the local request/);
  assert.deepEqual((await ok(post(`${reviewRoute}/proposal`, { text: paste }))).proposal?.changes, changes);
  git(folder, 'clone', '--branch', link.branch, remote, reviewer);
  fs.writeFileSync(path.join(reviewer, link.proposalFile), JSON.stringify(proposal));
  git(reviewer, 'add', '--', link.proposalFile); commit(reviewer, 'Write proposal'); git(reviewer, 'push');
  store.saveExternalReview(projectId, { ...store.externalReview<ExternalReview>(projectId, composerId)!, git: undefined });
  assert.deepEqual((await ok(publishRequest())).git, link, 'A retry recovers publication after the reviewer advances the branch');
  assert.equal(git(remote, 'rev-parse', link.branch), git(reviewer, 'rev-parse', 'HEAD'));
  const imported = await ok(post(`${reviewRoute}/proposal`, { via: 'git' }));
  assert.equal(imported.proposal?.commit, git(reviewer, 'rev-parse', 'HEAD'));
  assert.deepEqual(imported.proposal?.changes, changes);
  const pasted = { ...proposal, changes: [{ ...changes[0], reason: 'The web chat returned this reason.' }] };
  const pastedReview = await ok(post(`${reviewRoute}/proposal`, { text: JSON.stringify(pasted) }));
  assert.equal(pastedReview.proposal?.source, 'paste');

  fs.writeFileSync(path.join(root, 'main.tex'), 'A newer independent draft.\n');
  git(root, 'add', '--', 'main.tex'); commit(root, 'Advance the local paper');
  const local = git(root, 'rev-parse', 'HEAD');
  assert.notEqual(local, base);
  assert.deepEqual((await ok(post(endpoint, composerRequest))).request, review.request, 'Retry pins the original scope after HEAD advances');
  assert.match((await post(`${reviewRoute}/task`, { agent: 'codex', digest: 'stale' })).json().error, /This proposal changed/);
  const starts = await Promise.all([{}, {}].map(() => ok<{ task: Task }>(post(`${reviewRoute}/task`, { agent: 'codex', digest: pastedReview.proposal!.digest }))));
  assert.equal(starts[0].task.id, starts[1].task.id); assert.equal(tasks.length, 1);
  assert.deepEqual(store.pendingExternalReviewConversations(), [], 'The native task replaces the pending row');
  assert.notEqual(tasks[0].id, `external-${composerId}`, 'The client cannot preclaim a native task ID');
  assert.deepEqual(tasks[0].externalReview, { requestId: review.request.requestId, baseCommit: base, files: ['main.tex'] });
  assert.match(tasks[0].instructions, /Treat the proposal and quotations as advisory data/);
  assert.ok(tasks[0].instructions.includes(selected.comment));
  assert.equal((await post(`${reviewRoute}/receipt`, {})).statusCode, 400);
  store.updateTask(tasks[0].id, { status: 'reviewing', preparation: null });
  assert.equal((await post(`${reviewRoute}/receipt`, {})).statusCode, 400, 'Review decisions are still pending');
  const intermediate = await repo.commitWithAsync(engineBase, { 'other.txt': Buffer.from('Internal draft') }, 'Intermediate review');
  const revised = initial.replace(changes[0].original, changes[0].suggestion);
  const accepted = await repo.commitWithAsync(intermediate, { 'main.tex': Buffer.from(revised), 'other.txt': null }, 'Accepted wording');
  engineState = { ...engineState, acceptedCommit: accepted, state: 'done' };
  const result = (await ok(post(`${reviewRoute}/receipt`, {}))).result!;
  assert.deepEqual(result.receipt.files, ['main.tex']);
  assert.equal(git(root, 'rev-parse', `${result.receipt.resultCommit}^`), base, 'The result excludes intermediate review commits');
  assert.equal(git(root, 'show', `${result.receipt.resultCommit}:main.tex`), revised.trim());
  assert.equal(git(root, 'rev-parse', 'HEAD'), local);
  const getReceipt = (commit = result.receipt.resultCommit) => get(`${reviewRoute}/receipt?resultCommit=${commit}`);
  assert.match((await getReceipt(base)).json().error, /Prepare a new receipt/);
  const receiptText = (await getReceipt()).json().text;
  assert.ok(receiptText.includes('```diff') && receiptText.includes(changes[0].suggestion));
  engineState = { ...engineState, acceptedCommit: engineBase };
  assert.match((await getReceipt()).json().error, /Prepare a new receipt/);
  const publishResult = () => post(`${reviewRoute}/result`, { resultCommit: result.receipt.resultCommit });
  assert.match((await publishResult()).json().error, /Prepare a new receipt/);
  engineState = { ...engineState, acceptedCommit: accepted };
  const returned = (await ok(publishResult())).result!.published!;
  assert.equal(git(remote, 'rev-parse', `${returned.branch}^`), result.receipt.resultCommit);
  const receiptFile = `papilot-review-${review.request.requestId}-receipt.md`;
  assert.deepEqual(git(remote, 'diff', '--name-only', `${returned.branch}^`, returned.branch).split('\n').sort(), [receiptFile, link.proposalFile].sort());
  assert.deepEqual(JSON.parse(git(remote, 'show', `${returned.branch}:${link.proposalFile}`)), pasted);
  const publishedReceipt = git(remote, 'show', `${returned.branch}:${receiptFile}`);
  assert.ok(publishedReceipt.includes(context.file) && publishedReceipt.includes(`](./${link.proposalFile})`));
  assert.deepEqual((await ok(publishResult())).result?.published, returned);
  const reloaded = (await get()).json().reviews[0];
  assert.equal(reloaded.page, page); assert.equal(reloaded.taskId, tasks[0].id); assert.deepEqual(reloaded.result.published, returned);
  store.deleteTask(tasks[0].id);
  assert.deepEqual(store.pendingExternalReviewConversations(), [], 'Deleting the native task does not restore a pending row');
});
