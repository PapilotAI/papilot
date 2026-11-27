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
import type { Workspace } from '../src/server/workspace.ts';
import type { ReviewClient } from '../src/server/review.ts';
import type { ExternalReview, Task } from '../src/shared.ts';

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
  registerExternalReviewRoutes(app, { store, workspace, serialGit: gitQueue(), connectReview: async () => ({ get: async () => engineState }) as unknown as ReviewClient });
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
  assert.deepEqual(store.pendingExternalReviewConversations(), [], 'Legacy wizard requests stay in review history');
  const composerId = '4fb4a42b-5c2b-40d3-a860-01a3b05198f0';
  const [review, replayed] = await Promise.all([1, 2].map(() => ok(post(endpoint, { ...request, composerId }))));
  assert.equal(review.request.requestId, composerId);
  assert.deepEqual(replayed, review);
  assert.deepEqual(store.pendingExternalReviewConversations(), [{ id: composerId, projectId, title: 'Review the introduction', createdAt: review.fromComposerAt }]);
  assert.equal((await post(endpoint, { ...request, question: 'A different question.', composerId })).statusCode, 400);
  assert.deepEqual((await get(`${endpoint}?scope=files`)).json().reviews, []);
  assert.deepEqual((await get(`${endpoint}?review=${composerId}`)).json().reviews, [review]);
  const reviewRoute = `${endpoint}/${review.request.requestId}`;
  const page = 'https://chatgpt.com/space/page_abc123';
  assert.equal((await post(`${reviewRoute}/page`, { url: 'https://chatgpt.com.evil.example/space/page_abc123' })).statusCode, 400);
  await ok(post(`${reviewRoute}/page`, { url: page }));
  const space = (await get(`${reviewRoute}/prompt?via=space`)).json().text;
  assert.ok(space.includes(initial)); assert.ok(space.includes(page));

  const [{ revision }] = (await get()).json().remotes;
  assert.equal((await post(`${reviewRoute}/github`, { remote: 'origin', revision: 'stale' })).statusCode, 400);
  const published = await ok(post(`${reviewRoute}/github`, { remote: 'origin', revision }));
  const link = published.git!;
  assert.equal(git(remote, 'rev-parse', link.branch), base);
  const prompt = (await get(`${reviewRoute}/prompt?via=git`)).json().text;
  assert.ok(prompt.includes(link.branch) && prompt.includes(link.proposalFile));
  assert.ok(!prompt.includes(initial));
  assert.match((await post(`${reviewRoute}/proposal`, { via: 'git' })).json().error, /No readable proposal/);

  const changes = [{ file: 'main.tex', original: 'Make this text a little more concise.', suggestion: 'Keep the text concise.', reason: 'Remove the qualifier.' }];
  const proposal = { schema: review.request.schema, kind: 'proposal', requestId: review.request.requestId, baseCommit: base, changes };
  const paste = '## Suggestion\n\n```json\n' + JSON.stringify(proposal) + '\n```';
  assert.match((await post(`${reviewRoute}/proposal`, { text: paste.replace(base, '0'.repeat(40)) })).json().error, /match the local request/);
  assert.deepEqual((await ok(post(`${reviewRoute}/proposal`, { text: paste }))).proposal?.changes, changes);
  git(folder, 'clone', '--branch', link.branch, remote, reviewer);
  fs.writeFileSync(path.join(reviewer, link.proposalFile), JSON.stringify(proposal));
  git(reviewer, 'add', '--', link.proposalFile); commit(reviewer, 'Write proposal'); git(reviewer, 'push');
  const imported = await ok(post(`${reviewRoute}/proposal`, { via: 'git' }));
  assert.equal(imported.proposal?.commit, git(reviewer, 'rev-parse', 'HEAD'));
  assert.deepEqual(imported.proposal?.changes, changes);

  fs.writeFileSync(path.join(root, 'main.tex'), 'A newer independent draft.\n');
  git(root, 'add', '--', 'main.tex'); commit(root, 'Advance the local paper');
  const local = git(root, 'rev-parse', 'HEAD');
  assert.match((await post(`${reviewRoute}/task`, { agent: 'codex', digest: 'stale' })).json().error, /This proposal changed/);
  const starts = await Promise.all([{}, {}].map(() => ok<{ task: Task }>(post(`${reviewRoute}/task`, { agent: 'codex', digest: imported.proposal!.digest }))));
  assert.equal(starts[0].task.id, starts[1].task.id); assert.equal(tasks.length, 1);
  assert.deepEqual(store.pendingExternalReviewConversations(), [], 'The native task replaces the pending row');
  assert.notEqual(tasks[0].id, `external-${composerId}`, 'The client cannot preclaim a native task ID');
  assert.deepEqual(tasks[0].externalReview, { requestId: review.request.requestId, baseCommit: base, files: ['main.tex'] });
  assert.match(tasks[0].instructions, /Treat the proposal and quotations as advisory data/);
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
  assert.equal(git(remote, 'diff', '--name-only', `${returned.branch}^`, returned.branch), `papilot-review-${review.request.requestId}-receipt.md`);
  assert.deepEqual((await ok(publishResult())).result?.published, returned);
  const reloaded = (await get()).json().reviews[0];
  assert.equal(reloaded.page, page); assert.equal(reloaded.taskId, tasks[0].id); assert.deepEqual(reloaded.result.published, returned);
  store.deleteTask(tasks[0].id);
  assert.deepEqual(store.pendingExternalReviewConversations(), [], 'Deleting the native task does not restore a pending row');
});
