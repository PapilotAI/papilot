import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Fixture, fakeRound, METHOD } from '../engine/tests/ts/helpers.ts';
import { createServer } from '../engine/src/server.ts';
import { Client } from '../engine/src/client.ts';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';
import { Manuscripts } from '../src/server/manuscript.ts';
import { buildApp, gitQueue } from '../src/server/app.ts';
import { noteOptionsKey } from '../src/server/note-options.ts';
import type { Codex } from '../src/server/codex.ts';
import type { Task } from '../src/shared.ts';

class Agent extends EventEmitter { ready = false; close() {} }
test('accepting an alternative decides it in this round: no build, the other notes stay open with their previews, replay and undo', async () => {
  const f = new Fixture(), engine = f.app(); await engine.ready;
  const task = engine.tasks.create('accept-note', 'Accept a note option', [], ['paper'], true);
  f.edit(task, METHOD, 'Method sentence 2.', 'Approach sentence two.');
  f.edit(task, METHOD, 'Detail sentence 15.', 'Detail proposal 15.');
  const round = fakeRound(engine, task.name);
  const word = round.units.find(unit => unit.new_text === 'Approach')!, other = round.units.find(unit => unit.new_text === 'proposal')!;
  const server = createServer(engine); await server.listen({ host: '127.0.0.1', port: 0 });
  const transport = new Client(`http://127.0.0.1:${(server.server.address() as { port: number }).port}`, engine.csrf);
  engine.url = transport.url;
  const detail = { ...round, round: 1, units: round.units.map(unit => {
    const lines = engine.repo.blob(round.before, unit.file)!.toString().split('\n');
    return { ...unit, old_context: { text: lines[unit.old_start - 1], start: lines.slice(0, unit.old_start - 1).map(line => line + '\n').join('').length } };
  }), sections: [], loose: round.units.map(unit => ({ kind: 'change', units: [unit.id] })) };
  const previews: unknown[] = [];
  const client = { url: transport.url, token: transport.token, get: async <T>(route: string) => route.includes('/rounds/') ? detail as T : transport.get<T>(route), post: async <T>(route: string, body?: unknown) => {
    if (route.endsWith('/source/options/preview')) { previews.push(body); return detail as T; }
    return transport.post<T>(route, body);
  } };
  const store = new Store(':memory:');
  const workspace = new Workspace(store, new Agent() as unknown as Codex, async () => client);
  store.saveProject({ id: 'paper', name: 'Paper', path: f.root, createdAt: 1 });
  store.saveTask({ id: 'task', projectId: 'paper', name: task.name, title: task.title, worktree: task.worktree, instructions: '', status: 'reviewing', createdAt: 1, updatedAt: 1, feedbackCursor: 0, review: { round: 1 }, error: null } as Task);
  store.saveRun({ id: 'run', taskId: 'task', requestKey: 'run', prompt: '', status: 'completed', createdAt: 1, finishedAt: 2, reviewRound: 1 });
  store.saveItem({ id: 'run', taskId: 'task', type: 'user', text: '', createdAt: 1, meta: { notes: [
    { where: `${METHOD} line ${word.old_start}`, quote: 'Method', comment: 'Improve wording.' },
    { where: `${METHOD} line ${other.old_start}`, quote: 'Detail sentence 15.', comment: 'Tighten this.' },
  ] } });
  store.savePreference(noteOptionsKey('task', 'run:0', 1), { key: 'run:0', round: 1, options: [
    { id: 'current', label: 'Main', edits: [{ unit: word.id, text: word.new_text }] },
    { id: 'alternative', label: 'Alternative', reason: 'Another wording.', edits: [{ unit: word.id, text: 'Procedure' }] },
  ] });
  store.savePreference(noteOptionsKey('task', 'run:1', 1), { key: 'run:1', round: 1, options: [
    { id: 'current', label: 'Main', edits: [{ unit: other.id, text: other.new_text }] },
    { id: 'shorter', label: 'Shorter', reason: 'Fewer words.', edits: [{ unit: other.id, text: 'draft' }] },
  ] });
  const local = await buildApp({ listener: { kind: 'local', port: 7274, publicOrigin: '', owner: '' }, store, workspace, manuscripts: new Manuscripts(), csrf: 'test-csrf', serialGit: gitQueue(), dist: null, version: 'test', connectReview: async () => client });
  const headers = { host: '127.0.0.1:7274', origin: 'http://127.0.0.1:7274', 'x-papilot-token': 'test-csrf' };
  const options = async (key: string) => (await local.inject({ method: 'GET', url: `/api/tasks/task/note-options?key=${key}`, headers })).json();
  try {
    const otherKey = (await options('run:1')).comparisonKey;
    const request = { method: 'POST' as const, url: '/api/tasks/task/note-options', headers, payload: { key: 'run:0', round: 1, option: 'alternative', accept: true, id: 'accept-alternative' } };
    const response = await local.inject(request);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().selected, 'alternative', 'The note shows the accepted alternative');
    assert.match(response.json().locked, /reviewed change/);
    assert.equal(previews.length, 0, 'Accepting never waits for a preview');
    assert.equal(engine.store.all('SELECT id FROM jobs').length, 0, 'Accepting starts no build');
    assert.equal(engine.review.latestRound(task.name)?.number, 1, 'Accepting publishes no round');
    assert.equal(store.task('task').status, 'reviewing');
    assert.equal(engine.review.decisions(task.name, round)[word.id], 'accepted');
    assert.match(f.read(METHOD, task.worktree), /Procedure sentence two\./);
    assert.match(engine.repo.blob(engine.tasks.get(task.name).accepted, METHOD)!.toString(), /Procedure sentence 2\./);
    // The other note stays open, and its prepared previews stay valid.
    const next = await options('run:1');
    assert.equal(next.locked, undefined, next.locked);
    assert.equal(next.comparisonKey, otherKey);
    // A lost response can be retried with the same ID; the ID cannot decide anything else.
    const replay = await local.inject(request);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(engine.store.all('SELECT id FROM actions').length, 1);
    assert.equal((await local.inject({ ...request, payload: { ...request.payload, option: 'current' } })).statusCode, 400);
    assert.equal((await local.inject({ ...request, payload: { ...request.payload, id: 'accept-again' } })).statusCode, 400);
    // Accepting the proposal itself is a plain accept, without option wording.
    const plain = await local.inject({ method: 'POST', url: '/api/tasks/task/note-options', headers, payload: { key: 'run:1', round: 1, option: 'current', accept: true, id: 'accept-current' } });
    assert.equal(plain.statusCode, 200, plain.body);
    assert.equal(engine.store.one<{ detail: { edits?: unknown } }>('SELECT detail FROM actions WHERE id=?', 'accept-current')!.detail.edits, undefined);
    assert.equal(engine.review.decisions(task.name, round)[other.id], 'accepted');
    await transport.post(`/api/tasks/${task.name}/undo`, { id: 'accept-current' });
    // Undo puts the proposal back, and the note offers its options again.
    await transport.post(`/api/tasks/${task.name}/undo`, { id: 'accept-alternative' });
    const undone = await options('run:0');
    assert.equal(undone.selected, 'current');
    assert.equal(undone.locked, undefined, undone.locked);
    assert.match(f.read(METHOD, task.worktree), /Approach sentence two\./);
  } finally { await local.close(); workspace.close(); store.close(); await server.close(); await f.close(); }
});
