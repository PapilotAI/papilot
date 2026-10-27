import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/server/store.ts';
import { Workspace, accountUsage, agentModel } from '../src/server/workspace.ts';
import { RpcResponseError, type Codex } from '../src/server/codex.ts';
import type { ReviewClient } from '../src/server/review.ts';
import type { PendingReview, Run, Task } from '../src/shared.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const feedback = { cursor: 7, feedback: [{ body: 'Preserve the boundary condition.' }] };
const summary = { state: 'reviewing', round: 1, counts: { pending: 1 } };

class FakeCodex extends EventEmitter {
  ready = false;
  calls: { method: string; params: any }[] = [];
  replies: { id: string | number; result: unknown }[] = [];
  rejections: { id: string | number; message: string }[] = [];
  handler = async (method: string, _params: any): Promise<any> => method === 'turn/start' ? { turn: { id: 'turn-new' } } : { thread: { id: 'thread' } };
  async request(method: string, params: any) { this.calls.push({ method, params }); return this.handler(method, params); }
  respond(id: string | number, result: unknown) { this.replies.push({ id, result }); }
  reject(id: string | number, message: string) { this.rejections.push({ id, message }); }
  close() { this.ready = false; }
}

function fixture(reviewHandler?: (method: string, route: string, body?: unknown) => Promise<any>, options: { file?: string; reviewUrl?: string; claude?: FakeCodex } = {}) {
  const store = new Store(options.file || ':memory:');
  const codex = new FakeCodex();
  const calls: { method: string; route: string; body?: unknown }[] = [];
  const invoke = async (method: string, route: string, body?: unknown) => {
    calls.push({ method, route, body });
    if (reviewHandler) return reviewHandler(method, route, body);
    if (route.includes('/feedback')) return feedback;
    if (route.includes('/jobs/')) return { status: 'done' };
    if (route.endsWith('/publish')) return { job: 'job' };
    return summary;
  };
  const review: ReviewClient = { url: options.reviewUrl || 'http://unused', token: 'test', get: route => invoke('GET', route), post: (route, body) => invoke('POST', route, body) };
  const workspace = new Workspace(store, codex as unknown as Codex, 2, async () => review, options.claude ? { claude: options.claude as unknown as Codex } : {});
  const task: Task = { id: 'task-id', projectId: 'paper', name: 'p-task', title: 'Task', instructions: 'Edit the introduction.', worktree: '/unused', threadId: 'thread', turnId: null, model: null, status: 'reviewing', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
  store.saveProject({ id: task.projectId, name: 'Paper', path: '/unused', createdAt: 1 });
  store.saveTask(task);
  (workspace as any).loaded.add('thread');
  workspace.runtime.authenticated = true;
  return { store, codex, workspace, task, calls, close() { workspace.close(); store.close(); } };
}

function uncertainRun(f: ReturnType<typeof fixture>, active = true) {
  const run: Run = { id: 'pending-run', taskId: f.task.id, requestKey: 'pending-request', prompt: 'An uncertain revision.', feedbackCursor: 7, status: 'uncertain', createdAt: 1, finishedAt: null };
  f.store.saveRun(run);
  f.store.updateTask(f.task.id, { status: 'uncertain', turnId: null, pendingRunId: run.id, error: 'Check task status.' });
  if (active) (f.workspace as any).active.set(f.task.id, run);
  return run;
}

function identifiedTurn(run: Run, status = 'inProgress') {
  return { id: 'turn-confirmed', status, items: [{ type: 'userMessage', clientId: run.id }] };
}

const pendingReview: PendingReview = { route: '/api/tasks/p-task/decide', body: { id: 'decision-123', action: 'accept', round: 1, changes: ['change-1'] }, previousStatus: 'reviewing' };
const pageState = { csrf: 'test', task: 'p-task', title: 'Task', closed: false, state: 'reviewing', latest: 1, round: 1, revision: 'revision', decisions: { 'change-1': 'accepted' }, comments: {}, undo: null, job: null };

async function reviewServer(handler: (request: IncomingMessage, response: ServerResponse, body: any) => void | Promise<void>) {
  const calls: { route: string; body: any; token: string | string[] | undefined }[] = [];
  const server = createServer(async (request, response) => {
    try {
      let text = '';
      for await (const chunk of request) text += chunk;
      const body = text ? JSON.parse(text) : undefined;
      calls.push({ route: request.url!, body, token: request.headers['x-review-token'] });
      await handler(request, response, body);
    } catch { response.destroy(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The review fixture did not bind an HTTP port.');
  return { calls, url: `http://127.0.0.1:${address.port}`, async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}

test('enqueue preserves a newer building status after feedback loading yields', async () => {
  const gate = deferred<typeof feedback>();
  const f = fixture(async () => gate.promise);
  try {
    const pending = f.workspace.enqueue(f.task.id, 'Revise the wording.', 'request');
    await tick();
    f.store.updateTask(f.task.id, { status: 'building' });
    gate.resolve(feedback);
    const run = await pending;
    assert.equal(f.store.task(f.task.id).status, 'building');
    assert.equal(f.store.runByKey(run.requestKey)?.status, 'queued');
  } finally { f.close(); }
});

test('concurrent retries with one request key persist only one run and message', async () => {
  const gate = deferred<typeof feedback>();
  const f = fixture(async () => gate.promise);
  try {
    const first = f.workspace.enqueue(f.task.id, 'Revise once.', 'same-request');
    const retry = f.workspace.enqueue(f.task.id, 'Revise once.', 'same-request');
    gate.resolve(feedback);
    const [a, b] = await Promise.all([first, retry]);
    assert.equal(a.id, b.id);
    assert.equal(f.store.runs().length, 1);
    assert.equal(f.store.items(f.task.id).length, 1);
  } finally { f.close(); }
});

test('parallel distinct messages cannot both occupy the one queued slot', async () => {
  const gate = deferred<typeof feedback>();
  const f = fixture(async () => gate.promise);
  try {
    const first = f.workspace.enqueue(f.task.id, 'First instruction.', 'first');
    const second = f.workspace.enqueue(f.task.id, 'Second instruction.', 'second');
    const results = Promise.allSettled([first, second]);
    gate.resolve(feedback);
    const settled = await results;
    assert.equal(settled.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(settled.filter(result => result.status === 'rejected').length, 1);
    assert.equal(f.store.runs().length, 1);
    assert.equal(f.store.items(f.task.id).length, 1);
  } finally { f.close(); }
});

test('a review write reserves the worktree until it finishes', async () => {
  const gate = deferred<void>();
  const f = fixture();
  try {
    f.codex.ready = true;
    const writing = f.workspace.reviewWrite(f.task.id, true, () => gate.promise);
    await f.workspace.enqueue(f.task.id, 'Next revision.', 'next', false);
    await tick();
    assert.equal(f.codex.calls.length, 0);
    assert.throws(() => f.workspace.publish(f.task.id));
    await assert.rejects(f.workspace.reviewWrite(f.task.id, true, async () => {}));
    gate.resolve();
    await writing;
    await tick();
    assert.equal(f.codex.calls.filter(call => call.method === 'turn/start').length, 1);
    assert.equal(f.store.task(f.task.id).status, 'running');
  } finally { gate.resolve(); f.close(); }
});

test('publication reserves the worktree and rejects duplicate builds and review writes', async () => {
  const gate = deferred<{ status: string }>();
  const f = fixture(async (_method, route) => route.includes('/jobs/') ? gate.promise : route.endsWith('/publish') ? { job: 'job' } : summary);
  try {
    f.codex.ready = true;
    const building = f.workspace.publish(f.task.id);
    assert.throws(() => f.workspace.publish(f.task.id));
    await assert.rejects(f.workspace.reviewWrite(f.task.id, true, async () => {}));
    await f.workspace.enqueue(f.task.id, 'Next revision.', 'next', false);
    await tick();
    assert.equal(f.codex.calls.length, 0);
    assert.equal(f.store.task(f.task.id).status, 'building');
    gate.resolve({ status: 'done' });
    await building;
    await tick();
    assert.equal(f.codex.calls.filter(call => call.method === 'turn/start').length, 1);
  } finally { gate.resolve({ status: 'done' }); f.close(); }
});

test('comments remain available during an active turn while file decisions are blocked', async () => {
  const f = fixture();
  try {
    f.store.updateTask(f.task.id, { status: 'running', turnId: 'turn-new' });
    (f.workspace as any).active.set(f.task.id, { id: 'run' });
    assert.equal(await f.workspace.reviewWrite(f.task.id, false, async () => 'comment saved'), 'comment saved');
    await assert.rejects(f.workspace.reviewWrite(f.task.id, true, async () => {}));
    assert.throws(() => f.workspace.publish(f.task.id));
  } finally { f.close(); }
});

test('canceling queued feedback leaves it available for the next submission', async () => {
  const f = fixture();
  try {
    await f.workspace.enqueue(f.task.id, 'Apply the review comments.', 'first');
    assert.equal(f.store.task(f.task.id).feedbackCursor, 0);
    await f.workspace.interrupt(f.task.id);
    assert.equal(f.store.runByKey('first')?.status, 'interrupted');
    const retry = await f.workspace.enqueue(f.task.id, 'Apply the review comments.', 'retry');
    assert.match(retry.prompt, /Preserve the boundary condition/);
    assert.equal(f.store.task(f.task.id).feedbackCursor, 0);
    const afters = f.calls.filter(call => call.route.includes('/feedback')).map(call => new URL(call.route, 'http://unused').searchParams.get('after'));
    assert.ok(afters.length >= 2 && afters.every(after => after === '0'), afters.join());
  } finally { f.close(); }
});

test('unsent review comments exclude feedback already queued for Codex', async () => {
  const items = [{ id: 3, kind: 'comment' }, { id: 5, kind: 'reject' }, { id: 7, kind: 'comment' }];
  const f = fixture(async (_method, route) => {
    if (!route.includes('/feedback')) return summary;
    const after = Number(new URL(route, 'http://unused').searchParams.get('after'));
    const feedback = items.filter(item => item.id > after);
    return { cursor: feedback.at(-1)?.id ?? after, feedback };
  });
  try {
    await f.workspace.refresh(f.task.id);
    assert.equal(f.store.task(f.task.id).review?.unsent, 2);
    await f.workspace.enqueue(f.task.id, 'Address the comments.', 'send');
    await f.workspace.refresh(f.task.id);
    assert.equal(f.store.task(f.task.id).review?.unsent, 0);
    await f.workspace.interrupt(f.task.id);
    await f.workspace.refresh(f.task.id);
    assert.equal(f.store.task(f.task.id).review?.unsent, 2, 'Pausing a queued message returns its comments to the unsent count');
  } finally { f.close(); }
});

test('renaming a task changes only its title and is blocked during deletion', () => {
  const f = fixture();
  try {
    const renamed = f.workspace.renameTask(f.task.id, 'Clarify the abstract');
    assert.equal(renamed.title, 'Clarify the abstract');
    assert.equal(f.store.task(f.task.id).instructions, f.task.instructions);
    f.store.updateTask(f.task.id, { status: 'deleting' });
    assert.throws(() => f.workspace.renameTask(f.task.id, 'Another title'), /being deleted/);
  } finally { f.close(); }
});

test('feedback is marked delivered only after turn start is acknowledged', async () => {
  const ack = deferred<{ turn: { id: string } }>();
  const f = fixture();
  try {
    f.codex.handler = async () => ack.promise;
    f.codex.ready = true;
    await f.workspace.enqueue(f.task.id, 'Apply the review comments.', 'request');
    await tick();
    assert.equal(f.store.task(f.task.id).feedbackCursor, 0);
    ack.resolve({ turn: { id: 'turn-new' } });
    await tick();
    assert.equal(f.store.task(f.task.id).feedbackCursor, 7);
  } finally { ack.resolve({ turn: { id: 'turn-new' } }); f.close(); }
});

test('old completion and failure callbacks cannot finalize a newer active run', async () => {
  const f = fixture();
  try {
    const run: Run = { id: 'new-run', taskId: f.task.id, requestKey: 'new-request', prompt: 'New instruction.', status: 'running', createdAt: 1, finishedAt: null };
    f.store.saveRun(run);
    f.store.updateTask(f.task.id, { status: 'running', turnId: 'turn-new' });
    (f.workspace as any).active.set(f.task.id, run);
    await (f.workspace as any).notification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn-old', status: 'completed' } } });
    (f.workspace as any).failRun({ ...run, id: 'old-run' }, new Error('Late failure'));
    assert.equal(f.store.task(f.task.id).status, 'running');
    assert.equal(f.store.task(f.task.id).turnId, 'turn-new');
    assert.equal(f.store.runByKey('new-request')?.status, 'running');
    assert.equal((f.workspace as any).active.get(f.task.id)?.id, run.id);
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test('a fast completion before the turn/start response is applied to its owning run', async () => {
  const ack = deferred<{ turn: { id: string } }>();
  const f = fixture();
  try {
    f.codex.handler = async () => ack.promise;
    f.codex.ready = true;
    await f.workspace.enqueue(f.task.id, 'Small revision.', 'request', false);
    await tick();
    await (f.workspace as any).notification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn-fast', status: 'completed' } } });
    assert.equal(f.store.runByKey('request')?.status, 'running');
    ack.resolve({ turn: { id: 'turn-fast' } });
    await tick();
    assert.equal(f.store.runByKey('request')?.status, 'completed');
    assert.equal(f.store.task(f.task.id).status, 'reviewing');
    assert.equal(f.calls.filter(call => call.route.endsWith('/publish')).length, 1);
    assert.equal((f.workspace as any).active.has(f.task.id), false);
  } finally { ack.resolve({ turn: { id: 'turn-fast' } }); f.close(); }
});

test('pause invalidates a message still loading feedback before it reaches the queue', async () => {
  const gate = deferred<typeof feedback>();
  const f = fixture(async () => gate.promise);
  try {
    const pending = f.workspace.enqueue(f.task.id, 'Delayed instruction.', 'request');
    const rejected = assert.rejects(pending);
    await tick();
    await f.workspace.interrupt(f.task.id);
    gate.resolve(feedback);
    await rejected;
    assert.equal(f.store.task(f.task.id).status, 'interrupted');
    assert.equal(f.store.runs().length, 0);
    assert.equal(f.store.items(f.task.id).length, 0);
  } finally { gate.resolve(feedback); f.close(); }
});

test('an uncertain turn/start outcome retains its worktree reservation', async () => {
  const f = fixture();
  try {
    f.codex.handler = async () => { throw new Error('Codex request timed out: turn/start'); };
    f.codex.ready = true;
    const run = await f.workspace.enqueue(f.task.id, 'Possibly started instruction.', 'request', false);
    await tick();
    assert.equal(f.store.task(f.task.id).status, 'uncertain');
    assert.equal(f.store.runByKey('request')?.status, 'uncertain');
    assert.equal((f.store.task(f.task.id) as any).pendingRunId, run.id);
    await assert.rejects(f.workspace.reviewWrite(f.task.id, true, async () => {}));
    assert.throws(() => f.workspace.publish(f.task.id));
    await assert.rejects(f.workspace.enqueue(f.task.id, 'A later instruction.', 'next', false));
    await tick();
    assert.equal(f.codex.calls.filter(call => call.method === 'turn/start').length, 1);
  } finally { f.close(); }
});

test('an explicit turn/start rejection safely releases its reservation', async () => {
  const f = fixture();
  try {
    f.codex.handler = async () => { throw new RpcResponseError('Model is unavailable.'); };
    f.codex.ready = true;
    await f.workspace.enqueue(f.task.id, 'Rejected revision.', 'request', false);
    await tick();
    assert.equal(f.store.task(f.task.id).status, 'failed');
    assert.equal(f.store.task(f.task.id).pendingRunId, null);
    assert.equal(f.store.runByKey('request')?.status, 'failed');
    assert.equal((f.workspace as any).active.has(f.task.id), false);
    assert.equal(await f.workspace.reviewWrite(f.task.id, true, async () => 'allowed'), 'allowed');
  } finally { f.close(); }
});

test('reconcile restores a persisted active turn by its message identity and replays its input request', async () => {
  const f = fixture();
  try {
    const run = uncertainRun(f, false);
    const request = { id: 23, method: 'item/tool/requestUserInput', params: { threadId: 'thread', turnId: 'turn-confirmed', questions: [{ id: 'scope', question: 'Which section?' }] } };
    (f.workspace as any).earlyRequests.set(f.task.id, [request]);
    f.codex.handler = async () => ({ thread: { status: { type: 'active' }, turns: [identifiedTurn(run)] } });
    const task = await f.workspace.reconcile(f.task.id);
    assert.equal(task.status, 'waiting_input');
    assert.equal(task.turnId, 'turn-confirmed');
    assert.equal(task.pendingRunId, null);
    assert.equal(task.feedbackCursor, 7);
    assert.equal(f.store.runByKey(run.requestKey)?.status, 'running');
    assert.equal((f.workspace as any).active.get(f.task.id)?.id, run.id);
    assert.equal(f.workspace.requests.size, 1);
    assert.equal(f.codex.calls[0].method, 'thread/read');
    assert.equal(f.codex.calls[0].params.includeTurns, true);
    await assert.rejects(f.workspace.reviewWrite(f.task.id, true, async () => {}));
  } finally { f.close(); }
});

test('reconcile finalizes an identified completed turn and builds its review once', async () => {
  const f = fixture();
  try {
    const run = uncertainRun(f);
    f.codex.handler = async () => ({ thread: { status: { type: 'idle' }, turns: [identifiedTurn(run, 'completed')] } });
    await Promise.all([f.workspace.reconcile(f.task.id), f.workspace.reconcile(f.task.id)]);
    assert.equal(f.store.task(f.task.id).status, 'reviewing');
    assert.equal(f.store.task(f.task.id).turnId, null);
    assert.equal(f.store.task(f.task.id).pendingRunId, null);
    assert.equal(f.store.runByKey(run.requestKey)?.status, 'completed');
    assert.equal(f.calls.filter(call => call.route.endsWith('/publish')).length, 1);
    assert.equal((f.workspace as any).active.has(f.task.id), false);
  } finally { f.close(); }
});

test('reconcile cannot adopt an unrelated turn or unlock a missing pending turn', async () => {
  const f = fixture();
  try {
    const run = uncertainRun(f, false);
    f.codex.handler = async () => ({ thread: { status: { type: 'idle' }, turns: [identifiedTurn({ ...run, id: 'unrelated-run' }, 'completed')] } });
    await assert.rejects(f.workspace.reconcile(f.task.id), /not confirmed/);
    assert.equal(f.store.task(f.task.id).status, 'uncertain');
    assert.equal(f.store.task(f.task.id).pendingRunId, run.id);
    assert.equal(f.store.task(f.task.id).feedbackCursor, 0);
    assert.equal(f.store.runByKey(run.requestKey)?.status, 'uncertain');
    await assert.rejects(f.workspace.reviewWrite(f.task.id, true, async () => {}));
    assert.throws(() => f.workspace.publish(f.task.id));
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test('reconcile recognizes a persisted known turn even when its user item is absent', async () => {
  const f = fixture();
  try {
    const run = uncertainRun(f, false);
    f.store.updateTask(f.task.id, { turnId: 'known-turn' });
    f.codex.handler = async () => ({ thread: { status: { type: 'notLoaded' }, turns: [{ id: 'known-turn', status: 'inProgress', items: [] }] } });
    await f.workspace.reconcile(f.task.id);
    assert.equal(f.store.task(f.task.id).status, 'interrupted');
    assert.equal(f.store.runByKey(run.requestKey)?.status, 'interrupted');
    assert.equal((f.workspace as any).active.has(f.task.id), false);
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test('reconcile preserves a completion received while reading an older in-progress snapshot', async () => {
  const read = deferred<any>();
  const f = fixture();
  try {
    const run = uncertainRun(f);
    f.codex.handler = async () => read.promise;
    const checking = f.workspace.reconcile(f.task.id);
    await (f.workspace as any).notification({ method: 'turn/completed', params: { threadId: 'thread', turn: identifiedTurn(run, 'completed') } });
    read.resolve({ thread: { status: { type: 'active' }, turns: [identifiedTurn(run)] } });
    await checking;
    assert.equal(f.store.runByKey(run.requestKey)?.status, 'completed');
    assert.equal(f.store.task(f.task.id).status, 'reviewing');
    assert.equal(f.calls.filter(call => call.route.endsWith('/publish')).length, 1);
  } finally { read.resolve({ thread: { turns: [] } }); f.close(); }
});

test('a stale request resolution cannot replace uncertain status with running', async () => {
  const f = fixture();
  try {
    uncertainRun(f);
    await (f.workspace as any).notification({ method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: 999 } });
    assert.equal(f.store.task(f.task.id).status, 'uncertain');
    assert.equal(f.store.task(f.task.id).turnId, null);
    await assert.rejects(f.workspace.enqueue(f.task.id, 'Do not restart yet.', 'next', false));
  } finally { f.close(); }
});

test('an input request resolved before turn/start acknowledgement is not replayed', async () => {
  const ack = deferred<{ turn: { id: string } }>();
  const f = fixture();
  try {
    f.codex.handler = async () => ack.promise;
    f.codex.ready = true;
    await f.workspace.enqueue(f.task.id, 'Small revision.', 'request', false);
    await tick();
    (f.workspace as any).serverRequest({ id: 31, method: 'item/tool/requestUserInput', params: { threadId: 'thread', turnId: 'turn-new', questions: [{ id: 'scope', question: 'Which section?' }] } });
    await (f.workspace as any).notification({ method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: 31 } });
    ack.resolve({ turn: { id: 'turn-new' } });
    await tick();
    assert.equal(f.workspace.requests.size, 0);
    assert.equal(f.store.task(f.task.id).status, 'running');
  } finally { ack.resolve({ turn: { id: 'turn-new' } }); f.close(); }
});

test('an ambiguous review write keeps queued edits reserved until the decision is confirmed', async () => {
  const gate = deferred<void>();
  const f = fixture();
  try {
    f.codex.ready = true;
    const writing = f.workspace.reviewWrite(f.task.id, true, async () => { await gate.promise; throw new Error('Review response was lost.'); }, pendingReview);
    const rejected = assert.rejects(writing, /lost/);
    assert.deepEqual(f.store.task(f.task.id).pendingReview, pendingReview);
    const run = await f.workspace.enqueue(f.task.id, 'Next revision.', 'next', false);
    gate.resolve();
    await rejected;
    await tick();
    assert.equal(f.store.task(f.task.id).status, 'uncertain');
    assert.deepEqual(f.store.task(f.task.id).pendingReview, pendingReview);
    assert.equal(f.store.runByKey(run.requestKey)?.status, 'queued');
    assert.equal(f.codex.calls.length, 0);
    await assert.rejects(f.workspace.enqueue(f.task.id, 'Another revision.', 'later', false));
    await assert.rejects(f.workspace.reviewWrite(f.task.id, true, async () => {}));
    assert.throws(() => f.workspace.publish(f.task.id));
    assert.equal(await f.workspace.reviewWrite(f.task.id, false, async () => 'comment saved'), 'comment saved');
  } finally { gate.resolve(); f.close(); }
});

test('restart recovery preserves the exact pending review and prevents a persisted queue from starting', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-review-recovery-'));
  const file = path.join(folder, 'state.sqlite');
  const f = fixture(undefined, { file });
  let restarted: Store | undefined;
  let workspace: Workspace | undefined;
  try {
    const queued = await f.workspace.enqueue(f.task.id, 'Waiting revision.', 'queued', false);
    f.store.updateTask(f.task.id, { pendingReview });
    f.close();
    restarted = new Store(file);
    restarted.recover();
    const codex = new FakeCodex();
    codex.ready = true;
    workspace = new Workspace(restarted, codex as unknown as Codex);
    workspace.runtime.authenticated = true;
    await (workspace as any).drain();
    assert.equal(restarted.task(f.task.id).status, 'uncertain');
    assert.deepEqual(restarted.task(f.task.id).pendingReview, pendingReview);
    assert.equal(restarted.runByKey(queued.requestKey)?.status, 'queued');
    assert.equal(codex.calls.length, 0);
    await assert.rejects(workspace.reviewWrite(f.task.id, true, async () => {}));
    assert.throws(() => workspace!.publish(f.task.id));
  } finally { workspace?.close(); restarted?.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});

test('checking a lost review response replays its original identity exactly once and resumes queued work', async () => {
  const applied = new Set<string>();
  let mutations = 0;
  const server = await reviewServer((request, response, body) => {
    const fresh = !applied.has(body.id);
    if (fresh) { applied.add(body.id); mutations++; request.socket.destroy(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(pageState));
  });
  const f = fixture(undefined, { reviewUrl: server.url });
  try {
    const writing = f.workspace.reviewWrite(f.task.id, true, async () => {
      const response = await fetch(server.url + pendingReview.route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': 'test' }, body: JSON.stringify(pendingReview.body) });
      return response.json();
    }, pendingReview);
    const rejected = assert.rejects(writing);
    await f.workspace.enqueue(f.task.id, 'Waiting revision.', 'queued', false);
    await rejected;
    assert.equal(f.store.task(f.task.id).status, 'uncertain');
    const task = await f.workspace.reconcile(f.task.id);
    assert.equal(task.pendingReview, null);
    assert.equal(task.status, 'queued');
    assert.equal(mutations, 1);
    assert.deepEqual(server.calls.map(call => ({ route: call.route, body: call.body, token: call.token })), Array(2).fill({ route: pendingReview.route, body: pendingReview.body, token: 'test' }));
    f.codex.ready = true;
    await (f.workspace as any).drain();
    await tick();
    assert.equal(f.store.task(f.task.id).status, 'running');
    assert.equal(f.codex.calls.filter(call => call.method === 'turn/start').length, 1);
  } finally { f.close(); await server.close(); }
});

test('concurrent review status checks cannot replay the decision twice', async () => {
  const received = deferred<void>(), release = deferred<void>();
  const server = await reviewServer(async (_request, response) => {
    received.resolve();
    await release.promise;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(pageState));
  });
  const f = fixture(undefined, { reviewUrl: server.url });
  try {
    f.store.updateTask(f.task.id, { status: 'uncertain', pendingReview });
    const checking = f.workspace.reconcile(f.task.id);
    await received.promise;
    await assert.rejects(f.workspace.reconcile(f.task.id), /still being checked/);
    await assert.rejects(f.workspace.reviewWrite(f.task.id, true, async () => {}));
    release.resolve();
    await checking;
    assert.equal(server.calls.length, 1);
    assert.equal(f.store.task(f.task.id).status, 'reviewing');
  } finally { release.resolve(); f.close(); await server.close(); }
});

test('an already-applied undo is checked using the same action ID without undoing another action', async () => {
  const pendingUndo: PendingReview = { route: '/api/tasks/p-task/undo', body: { id: 'already-undone-action' }, previousStatus: 'interrupted' };
  let otherUndone = false;
  const server = await reviewServer((_request, response, body) => {
    if (body.id === 'other-action') otherUndone = true;
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Nothing to undo here any more. Reload the page.' }));
  });
  const f = fixture(undefined, { reviewUrl: server.url });
  try {
    f.store.updateTask(f.task.id, { status: 'uncertain', pendingReview: pendingUndo });
    const task = await f.workspace.reconcile(f.task.id);
    assert.deepEqual(server.calls[0].body, pendingUndo.body);
    assert.equal(otherUndone, false);
    assert.equal(task.status, 'interrupted');
    assert.equal(task.pendingReview, null);
    assert.match(task.error!, /Nothing to undo/);
    assert.equal(await f.workspace.reviewWrite(f.task.id, true, async () => 'allowed'), 'allowed');
  } finally { f.close(); await server.close(); }
});

test('review status checks retain uncertainty for transport, authentication, and malformed responses', async t => {
  const cases = [
    { name: 'disconnected transport', status: 0, body: '' },
    { name: 'unauthenticated response', status: 401, body: JSON.stringify({ error: 'Sign in.' }) },
    { name: 'forbidden response', status: 403, body: JSON.stringify({ error: 'Expired token.' }) },
    { name: 'server failure', status: 500, body: JSON.stringify({ error: 'Internal error.' }) },
    { name: 'invalid JSON', status: 200, body: '<html>Unavailable</html>' },
    { name: 'unrecognized success', status: 200, body: '{}' },
    { name: 'wrong task success', status: 200, body: JSON.stringify({ ...pageState, task: 'another-task' }) },
    { name: 'unrecognized business error', status: 400, body: JSON.stringify({ message: 'Unavailable.' }) },
  ];
  for (const entry of cases) await t.test(entry.name, async () => {
    const server = await reviewServer((request, response) => {
      if (!entry.status) { request.socket.destroy(); return; }
      response.writeHead(entry.status, { 'Content-Type': 'application/json' });
      response.end(entry.body);
    });
    const f = fixture(undefined, { reviewUrl: server.url });
    try {
      f.store.updateTask(f.task.id, { status: 'uncertain', pendingReview });
      await assert.rejects(f.workspace.reconcile(f.task.id));
      assert.equal(f.store.task(f.task.id).status, 'uncertain');
      assert.deepEqual(f.store.task(f.task.id).pendingReview, pendingReview);
      await assert.rejects(f.workspace.enqueue(f.task.id, 'Do not start yet.', 'next', false));
      await assert.rejects(f.workspace.reviewWrite(f.task.id, true, async () => {}));
      assert.throws(() => f.workspace.publish(f.task.id));
    } finally { f.close(); await server.close(); }
  });
});

const finishResponse = { task: 'p-task', finished: true, changed_files: [], discarded: {} };
const deletionReview = async (_method: string, route: string) => route.endsWith('/state') ? pageState : finishResponse;

test('deletion rejects active, queued, building, uncertain, and reserved tasks without engine writes', async t => {
  for (const status of ['running', 'waiting_input', 'queued', 'building', 'uncertain'] as const) await t.test(status, async () => {
    const f = fixture(deletionReview);
    try {
      f.store.updateTask(f.task.id, { status });
      await assert.rejects(f.workspace.deleteTask(f.task.id), /Pause the task/);
      assert.equal(f.store.task(f.task.id).status, status);
      assert.equal(f.calls.length, 0);
    } finally { f.close(); }
  });
  for (const reservation of ['active', 'publishing', 'reviewWrites', 'pendingReview', 'queued-run', 'preparing']) await t.test(reservation, async () => {
    const f = fixture(deletionReview);
    try {
      if (reservation === 'active') (f.workspace as any).active.set(f.task.id, { id: 'run' });
      else if (reservation === 'pendingReview') f.store.updateTask(f.task.id, { pendingReview });
      else if (reservation === 'queued-run') {
        await f.workspace.enqueue(f.task.id, 'Queued instruction.', 'queued', false);
        f.store.updateTask(f.task.id, { status: 'reviewing' });
      } else (f.workspace as any)[reservation].add(f.task.id);
      await assert.rejects(f.workspace.deleteTask(f.task.id));
      assert.equal(f.calls.length, 0);
    } finally { f.close(); }
  });
});

test('deletion waits for every pending comment and then removes only the selected task', async () => {
  const first = deferred<void>(), second = deferred<void>();
  const f = fixture(deletionReview);
  try {
    const other: Task = { ...f.task, id: 'other-task', name: 'p-other', threadId: 'other-thread' };
    f.store.saveTask(other);
    const run: Run = { id: 'old-run', taskId: f.task.id, requestKey: 'old-request', prompt: 'Earlier work.', status: 'completed', createdAt: 1, finishedAt: 2 };
    f.store.saveRun(run);
    f.store.saveRun({ ...run, id: 'other-run', taskId: other.id, requestKey: 'other-request' });
    f.store.saveItem({ id: 'old-item', taskId: f.task.id, type: 'assistant', text: 'Earlier answer.', createdAt: 1 });
    f.store.saveItem({ id: 'other-item', taskId: other.id, type: 'assistant', text: 'Keep this answer.', createdAt: 1 });
    (f.workspace as any).liveItems.set('late-item', { id: 'late-item', taskId: f.task.id, type: 'assistant', text: 'A late delta.', createdAt: 2 });
    const a = f.workspace.reviewWrite(f.task.id, false, () => first.promise);
    const b = f.workspace.reviewWrite(f.task.id, false, () => second.promise);
    await assert.rejects(f.workspace.deleteTask(f.task.id));
    first.resolve(); await a;
    await assert.rejects(f.workspace.deleteTask(f.task.id));
    second.resolve(); await b;
    assert.deepEqual(await f.workspace.deleteTask(f.task.id), { ok: true });
    (f.workspace as any).flush();
    assert.deepEqual(f.store.tasks().map(task => task.id), [other.id]);
    assert.deepEqual(f.store.runs().map(run => run.id), ['other-run']);
    assert.deepEqual(f.store.items(f.task.id), []);
    assert.equal(f.store.items(other.id)[0].text, 'Keep this answer.');
    assert.equal(f.store.projects().length, 1);
    assert.equal(f.store.taskDeleted(f.task.id), true);
    assert.deepEqual(f.calls.filter(call => call.method === 'POST'), [{ method: 'POST', route: '/api/tasks/p-task/finish', body: { force: true } }]);
    const callCount = f.calls.length;
    assert.deepEqual(await f.workspace.deleteTask(f.task.id), { ok: true });
    assert.equal(f.calls.length, callCount);
  } finally { first.resolve(); second.resolve(); f.close(); }
});

test('in-flight deletion blocks all task mutations and a duplicate deletion request', async () => {
  const gate = deferred<typeof finishResponse>();
  const f = fixture(async (_method, route) => route.endsWith('/state') ? pageState : gate.promise);
  try {
    const deleting = f.workspace.deleteTask(f.task.id);
    assert.equal(f.store.task(f.task.id).status, 'deleting');
    await assert.rejects(f.workspace.enqueue(f.task.id, 'Not allowed.', 'new', false));
    await assert.rejects(f.workspace.reviewWrite(f.task.id, true, async () => {}));
    await assert.rejects(f.workspace.reviewWrite(f.task.id, false, async () => {}));
    await assert.rejects(f.workspace.interrupt(f.task.id));
    await assert.rejects(f.workspace.reconcile(f.task.id));
    assert.throws(() => f.workspace.publish(f.task.id));
    await assert.rejects(f.workspace.deleteTask(f.task.id), /already in progress/);
    await (f.workspace as any).notification({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'old-turn', itemId: 'late', delta: 'Ignore this stale output.' } });
    gate.resolve(finishResponse);
    await deleting;
    (f.workspace as any).flush();
    assert.equal(f.store.tasks().length, 0);
    assert.equal(f.store.items(f.task.id).length, 0);
  } finally { gate.resolve(finishResponse); f.close(); }
});

test('feedback that finishes after deletion cannot recreate runs or history', async () => {
  const gate = deferred<typeof feedback>();
  const f = fixture(async (method, route) => route.includes('/feedback') ? gate.promise : deletionReview(method, route));
  try {
    const queued = f.workspace.enqueue(f.task.id, 'Delayed instructions.', 'delayed');
    const rejected = assert.rejects(queued, /Task not found/);
    await tick();
    await f.workspace.deleteTask(f.task.id);
    gate.resolve(feedback);
    await rejected;
    assert.equal(f.store.tasks().length, 0);
    assert.equal(f.store.runs().length, 0);
    assert.equal(f.store.items(f.task.id).length, 0);
  } finally { gate.resolve(feedback); f.close(); }
});

test('lost finish responses stay reserved across restart and retry confirms closed identity', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-delete-recovery-'));
  const file = path.join(folder, 'state.sqlite');
  let closed = false, finishCalls = 0;
  const f = fixture(async (_method, route) => {
    if (route.endsWith('/state')) return { ...pageState, closed };
    finishCalls++; closed = true;
    throw new Error('The finish response was lost.');
  }, { file });
  let reopened: Store | undefined, workspace: Workspace | undefined;
  try {
    await assert.rejects(f.workspace.deleteTask(f.task.id), /lost/);
    assert.equal(f.store.task(f.task.id).status, 'deleting');
    f.close();
    reopened = new Store(file); reopened.recover();
    assert.equal(reopened.task(f.task.id).status, 'deleting');
    assert.match(reopened.task(f.task.id).error!, /restarted during deletion/);
    const review: ReviewClient = { url: 'http://unused', token: 'test', get: async <T>() => ({ ...pageState, closed }) as T, post: async () => { finishCalls++; throw new Error('A closed task must not be finished again.'); } };
    workspace = new Workspace(reopened, new FakeCodex() as unknown as Codex, 2, async () => review);
    await assert.rejects(workspace.enqueue(f.task.id, 'Do not resume.', 'next', false));
    await workspace.deleteTask(f.task.id);
    assert.equal(reopened.tasks().length, 0);
    assert.equal(finishCalls, 1);
    assert.equal(reopened.taskDeleted(f.task.id), true);
  } finally { workspace?.close(); reopened?.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});

test('unconfirmed deletion never treats a malformed or foreign engine response as completion', async t => {
  for (const entry of [
    { name: 'missing state identity', state: { closed: true } },
    { name: 'foreign closed state', state: { ...pageState, task: 'another-task', closed: true } },
    { name: 'invalid closed flag', state: { ...pageState, closed: 'true' } },
    { name: 'missing finish identity', state: pageState, finish: { finished: true } },
    { name: 'foreign finish identity', state: pageState, finish: { task: 'another-task', finished: true } },
    { name: 'explicit engine refusal', state: pageState, error: new Error('A round is still being built.') },
  ]) await t.test(entry.name, async () => {
    const f = fixture(async (_method, route) => {
      if (route.endsWith('/state')) return entry.state;
      if (entry.error) throw entry.error;
      return entry.finish;
    });
    try {
      await assert.rejects(f.workspace.deleteTask(f.task.id));
      assert.equal(f.store.task(f.task.id).status, 'deleting');
      assert.equal(f.store.taskDeleted(f.task.id), false);
      await assert.rejects(f.workspace.reviewWrite(f.task.id, true, async () => {}));
    } finally { f.close(); }
  });
});

test('deleted task IDs cannot be recreated by a delayed create retry', async () => {
  const f = fixture(deletionReview);
  try {
    const id = 'deleted-task-000001';
    f.store.saveTask({ ...f.task, id });
    await f.workspace.deleteTask(id);
    const count = f.calls.length;
    await assert.rejects(f.workspace.createTask({ id, projectId: f.task.projectId, title: 'Stale create request', instructions: 'Do not recreate.' }), /was deleted/);
    assert.equal(f.calls.length, count);
    assert.deepEqual(f.store.tasks().map(task => task.id), [f.task.id]);
  } finally { f.close(); }
});

test('real engine deletion removes one temporary worktree while preserving accepted text and another task', async () => {
  const { Fixture, METHOD, fakeRound } = await import(new URL('../vendor/latex-review/tests/ts/helpers.ts', import.meta.url).href);
  const { createServer: createReviewServer } = await import(new URL('../vendor/latex-review/src/server.ts', import.meta.url).href);
  const disk = new Fixture();
  const app = disk.app();
  const engine = createReviewServer(app);
  let f: ReturnType<typeof fixture> | undefined;
  try {
    const target = app.tasks.create('p-task', 'Remove this task', [], ['paper']);
    const other = app.tasks.create('p-other', 'Keep this task', [], ['paper']);
    disk.edit(target, METHOD, 'Method sentence 2.', 'Accepted manuscript sentence.');
    disk.edit(target, METHOD, 'Detail sentence 15.', 'Unaccepted draft sentence.');
    const round = fakeRound(app, target.name);
    app.review.decide(target.name, { id: 'accept-before-delete', action: 'accept', round: round.number, changes: [round.units[0].id] });
    const manuscript = disk.read(METHOD);
    assert.match(manuscript, /Accepted manuscript sentence/);
    assert.doesNotMatch(manuscript, /Unaccepted draft sentence/);
    const head = app.repo.rev('HEAD');
    const index = fs.readFileSync(path.join(disk.root, '.git/index'));
    const artifacts = path.join(app.state, 'rounds', target.name, '001');
    fs.mkdirSync(artifacts, { recursive: true }); fs.writeFileSync(path.join(artifacts, 'fixture.svg'), '<svg/>');
    app.url = await engine.listen({ port: 0, host: '127.0.0.1' });
    f = fixture(async (method, route, body) => {
      const response = await fetch(app.url + route, { method, headers: { 'Content-Type': 'application/json', 'X-Review-Token': app.csrf }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      return value;
    });
    f.store.saveProject({ id: f.task.projectId, name: 'Temporary paper', path: disk.root, createdAt: 1 });
    f.store.updateTask(f.task.id, { worktree: target.worktree });
    await f.workspace.deleteTask(f.task.id);
    assert.equal(fs.existsSync(target.worktree), false);
    assert.equal(fs.existsSync(artifacts), false);
    assert.equal(fs.existsSync(other.worktree), true);
    assert.equal(app.tasks.get(other.name).closed, null);
    assert.equal(app.repo.text(['for-each-ref', `refs/latex-review/${target.name}/`]), '');
    assert.notEqual(app.repo.text(['for-each-ref', `refs/latex-review/${other.name}/`]), '');
    assert.equal(disk.read(METHOD), manuscript);
    assert.equal(app.repo.rev('HEAD'), head);
    assert.deepEqual(fs.readFileSync(path.join(disk.root, '.git/index')), index);
    const closedState = await fetch(app.url + '/api/tasks/p-task/state').then(response => response.json());
    assert.equal(closedState.task, target.name);
    assert.equal(closedState.closed, true);
    assert.equal(f.store.tasks().length, 0);
  } finally { f?.close(); await engine.close(); await disk.close(); }
});

test('Codex models list their reasoning efforts, and a task runs every turn at its effort', async () => {
  assert.deepEqual(agentModel({ model: 'gpt-x', displayName: 'GPT X', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'xhigh', description: 'Deep' }, { description: 'malformed' }] }),
    { id: 'gpt-x', name: 'GPT X', isDefault: true, efforts: ['low', 'xhigh'], defaultEffort: 'medium' });
  assert.deepEqual(agentModel({ id: 'plain' }), { id: 'plain', name: 'plain', isDefault: false, efforts: [], defaultEffort: null });
  const f = fixture();
  try {
    f.codex.ready = true;
    f.store.updateTask(f.task.id, { effort: 'xhigh' });
    await f.workspace.enqueue(f.task.id, 'Next revision.', 'next', false);
    await tick();
    const turn = f.codex.calls.find(call => call.method === 'turn/start');
    assert.equal(turn?.params.effort, 'xhigh');
  } finally { f.close(); }
  const plain = fixture();
  try {
    plain.codex.ready = true;
    await plain.workspace.enqueue(plain.task.id, 'Next revision.', 'next', false);
    await tick();
    assert.equal('effort' in plain.codex.calls.find(call => call.method === 'turn/start')!.params, false);
  } finally { plain.close(); }
});

test('account usage keeps the limit windows, plan and credits Codex reports', () => {
  const window = { usedPercent: 83, windowDurationMins: 10080, resetsAt: 1_793_600_296 };
  assert.deepEqual(accountUsage({ ordinaryUsageAllowed: true, rateLimits: { planType: 'pro', primary: window, secondary: null, credits: { hasCredits: true, unlimited: false, balance: '12418.76' }, rateLimitReachedType: null } }),
    { plan: 'pro', windows: [{ usedPercent: 83, minutes: 10080, resetsAt: 1_793_600_296_000 }], credits: { unlimited: false, balance: 12418.76 }, reached: false });
  assert.equal(accountUsage({ ordinaryUsageAllowed: false, rateLimits: { primary: { usedPercent: 140, windowDurationMins: 300, resetsAt: null } } })!.reached, true);
  assert.equal(accountUsage({ ordinaryUsageAllowed: false, rateLimits: { primary: { usedPercent: 140, windowDurationMins: 300, resetsAt: null } } })!.windows[0].usedPercent, 100);
  assert.equal(accountUsage({ rateLimits: { primary: null, secondary: null, credits: { hasCredits: false, unlimited: false, balance: null } } }), null);
  assert.equal(accountUsage(undefined), null);
});

test('a task runs on its own agent: turns, approvals and pausing go to that agent only', async () => {
  const claude = new FakeCodex();
  const f = fixture(undefined, { claude });
  try {
    f.codex.ready = true; claude.ready = true;
    f.workspace.runtimes.claude.authenticated = true;
    f.store.updateTask(f.task.id, { agent: 'claude', threadId: 'claude-thread' });
    (f.workspace as any).loaded.add('claude-thread');
    await f.workspace.enqueue(f.task.id, 'Tighten the abstract.', 'claude-run', false);
    await tick();
    assert.equal(f.codex.calls.length, 0);
    assert.deepEqual(claude.calls.map(call => call.method), ['turn/start']);
    assert.equal(claude.calls[0].params.threadId, 'claude-thread');
    // An approval from Claude is answered through Claude, never Codex.
    claude.emit('request', { id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'claude-thread', turnId: 'turn-new', command: 'make' } });
    const [request] = f.workspace.snapshot().requests;
    assert.equal(request.taskId, f.task.id);
    f.workspace.answer(request.id, { decision: 'accept' });
    assert.deepEqual(claude.replies, [{ id: 'approval-1', result: { decision: 'accept' } }]);
    assert.deepEqual(f.codex.replies, []);
    // A request for this task that arrives from another agent is refused.
    f.codex.emit('request', { id: 'stray', method: 'item/commandExecution/requestApproval', params: { threadId: 'claude-thread', turnId: 'turn-new' } });
    assert.deepEqual(f.codex.rejections.map(r => r.id), ['stray']);
    await f.workspace.interrupt(f.task.id);
    assert.deepEqual(claude.calls.at(-1), { method: 'turn/interrupt', params: { threadId: 'claude-thread', turnId: 'turn-new' } });
    // Claude's turn completion is handled like Codex's.
    claude.emit('notification', { method: 'turn/completed', params: { threadId: 'claude-thread', turn: { id: 'turn-new', status: 'interrupted' } } });
    await tick();
    assert.equal(f.store.task(f.task.id).status, 'interrupted');
  } finally { f.close(); }
});
