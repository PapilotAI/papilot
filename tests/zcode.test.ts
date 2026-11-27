import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { zcodeVersion } from '../bin/zcode-cli.mjs';
import { ZCodeAgent } from '../src/server/zcode.ts';

const CLI = String.raw`
const fs = require('node:fs');
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const emit = (type, payload) => console.log(JSON.stringify({ type, sessionId, turnId: 'native-turn', payload }));
if (args[0] === 'doctor') {
  const held = process.env.ZCODE_TEST_HOLD_DOCTOR;
  if (held) {
    fs.writeFileSync(held + '.tmp', String(process.pid));
    fs.renameSync(held + '.tmp', held);
    setInterval(() => {}, 1000);
    return;
  }
  console.log(JSON.stringify({ cli: { name: 'zcode', version: '0.18.0' } }));
  process.exit(0);
}
const prompt = option('--prompt');
const sessionId = args.includes('--resume') ? option('--resume') : 'sess_' + process.pid;
const database = process.env.ZCODE_SESSION_DB_PATH;
const logs = process.env.ZCODE_LOG_DIR;
const storage = process.env.ZCODE_STORAGE_DIR;
const legacyDatabase = process.env.ZCODE_SESSION_DB;
fs.appendFileSync(process.env.ZCODE_TEST_LOG, JSON.stringify({ args, cwd: fs.realpathSync(process.cwd()), sessionId, database, legacyDatabase, logs, storage }) + '\n');
if (prompt.includes('Disposable helper')) {
  fs.writeFileSync(database, 'native session');
  fs.writeFileSync(database + '-wal', 'session sidecar');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(require('node:path').join(logs, 'native.log'), 'diagnostic output');
}
if (prompt.includes('Ignore shutdown')) process.on('SIGTERM', () => {});
emit('turn.started');
if (prompt.includes('Hold this turn') || prompt.includes('Ignore shutdown')) { setInterval(() => {}, 1000); return; }
if (prompt.includes('Fail this turn')) {
  emit('turn.failed', { error: { message: 'Mock provider refused the request' } });
} else {
  console.log(JSON.stringify({ type: 'model.streaming', sessionId: 'sess_unrelated', payload: { kind: 'text_delta', delta: 'Wrong task' } }));
  emit('session.updated', { modelId: 'fixture-model' });
  emit('tool.updated', { kind: 'scheduled', toolCallId: 'write', toolName: 'Write', input: { file_path: 'paper.tex' } });
  emit('tool.updated', { kind: 'result', toolCallId: 'write' });
  if (prompt.includes('Deny a tool')) {
    emit('tool.updated', { kind: 'scheduled', toolCallId: 'command', toolName: 'Bash', input: { command: 'echo hello' } });
    emit('permission.resolved', { toolCallId: 'command', decision: 'deny' });
  }
  emit('model.streaming', { kind: 'text_delta', assistantMessageId: 'reply', delta: 'Edited ' });
  emit('model.streaming', { kind: 'text_delta', assistantMessageId: 'reply', delta: 'the paper.' });
  emit('model.streaming', { kind: 'finish', assistantMessageId: 'reply' });
  emit('turn.completed', { resultType: 'success' });
}
console.log(JSON.stringify({ type: 'result', sessionId, response: 'Edited the paper.', usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 1 } }));
`;

function fixture(t: import('node:test').TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-zcode-'));
  const cli = path.join(dir, 'fixture.cjs'), log = path.join(dir, 'calls.ndjson'), data = path.join(dir, 'data');
  fs.writeFileSync(cli, CLI);
  const storage = path.join(dir, 'native-storage');
  const env = { ...process.env, PAPILOT_ZCODE_BIN: cli, ZCODE_TEST_LOG: log, ZCODE_STORAGE_DIR: storage };
  const agents: ZCodeAgent[] = [];
  const create = (overrides: NodeJS.ProcessEnv = {}) => {
    const agent = new ZCodeAgent(data, { ...env, ...overrides });
    agents.push(agent);
    return agent;
  };
  t.after(async () => {
    try { await Promise.all(agents.map(agent => agent.close())); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  return { dir, data, cli, storage, create, calls: () => fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) };
}

function completed(agent: ZCodeAgent) {
  return new Promise<any>(resolve => {
    const listener = (message: any) => {
      if (message.method !== 'turn/completed') return;
      agent.off('notification', listener);
      resolve(message.params.turn);
    };
    agent.on('notification', listener);
  });
}

async function waitForFile(file: string, signal: AbortSignal) {
  const watcher = fs.watch(path.dirname(file));
  try { while (!fs.existsSync(file)) await once(watcher, 'change', { signal }); }
  finally { watcher.close(); }
}

test('checks for a supported ZCode CLI without testing credentials or making a model request', async t => {
  const { create, cli } = fixture(t);
  const agent = create();
  assert.equal(agent.detect(), true);
  await agent.start();
  assert.equal(agent.ready, true);
  assert.deepEqual(await agent.request('model/list'), { data: [] });
  assert.equal(zcodeVersion('{"cli":{"name":"zcode","version":"0.17.2"}}'), null);
  assert.equal(zcodeVersion('{"cli":{"name":"other","version":"1.0.0"}}'), null);
  fs.unlinkSync(cli);
  await assert.rejects(agent.start(), /ZCode CLI was not found/);
  assert.equal(agent.ready, false);
});

test('streams edits and one final reply, then resumes the same native session with the current permissions', async t => {
  const { dir, data, create, calls } = fixture(t);
  const agent = create();
  await agent.start();
  const { thread } = await agent.request('thread/start', { cwd: dir, developerInstructions: 'Preserve the manuscript language.' });
  const { thread: other } = await agent.request('thread/start', { cwd: dir });
  const events: any[] = [];
  agent.on('notification', event => events.push(event));
  const done = completed(agent);
  const image = path.join(dir, 'figure 1.png');
  await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Edit this file.\nKeep the equation.' }, { type: 'localImage', path: image }] });
  assert.equal((await done).status, 'completed');
  const first = calls()[0];
  assert.equal(first.cwd, fs.realpathSync(dir));
  assert.equal(first.database, path.join(data, 'sessions.db'));
  assert.ok(first.args.includes(image));
  assert.ok(first.args.some((arg: string) => arg.includes('Preserve the manuscript language.') && arg.includes('Keep the equation.')));
  assert.equal(first.args[first.args.indexOf('--mode') + 1], 'edit');
  assert.ok(!first.args.includes('--resume'));
  assert.deepEqual(events.filter(event => event.method === 'item/agentMessage/delta').map(event => event.params.delta), ['Edited ', 'the paper.']);
  assert.deepEqual(events.filter(event => event.method === 'item/completed').map(event => event.params.item.type), ['fileChange', 'agentMessage']);
  const usage = events.find(event => event.method === 'turn/usage')?.params;
  assert.equal(usage.model, 'fixture-model');
  assert.equal(usage.usage.cached, 1);

  const otherDone = completed(agent);
  await agent.request('turn/start', { threadId: other.id, input: [{ type: 'text', text: 'Edit a separate task.' }] });
  await otherDone;
  assert.notEqual(calls()[1].sessionId, first.sessionId);
  const restarted = create();
  await restarted.start();
  await restarted.request('thread/resume', { threadId: thread.id, cwd: dir, taskPermissions: 'full' });
  const resumed = completed(restarted);
  await restarted.request('turn/start', { threadId: thread.id, taskPermissions: 'workspace', input: [{ type: 'text', text: 'Try another revision.' }] });
  assert.equal((await resumed).status, 'completed');
  const next = calls()[2];
  assert.equal(next.args[next.args.indexOf('--resume') + 1], first.sessionId);
  assert.equal(next.args[next.args.indexOf('--mode') + 1], 'edit');
});

test('stops the native process, respects read-only tasks, and surfaces an error even if the CLI exits successfully', { timeout: 15000 }, async t => {
  const { dir, data, create } = fixture(t);
  const agent = create();
  await agent.start();
  await assert.rejects(agent.request('thread/start', { cwd: dir, sandbox: 'read-only' }), /read-only/);
  const { thread } = await agent.request('thread/start', { cwd: dir, taskPermissions: 'full' });
  const mapped = path.join(data, 'sessions', thread.id);
  fs.mkdirSync(path.dirname(mapped), { recursive: true });
  const stopped = completed(agent);
  await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Hold this turn' }] });
  await waitForFile(mapped, t.signal);
  await agent.closeWorktree(dir);
  assert.equal((await stopped).status, 'interrupted');
  await agent.request('thread/resume', { threadId: thread.id, cwd: dir });
  const failed = completed(agent);
  await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Fail this turn' }] });
  assert.deepEqual((await failed).error, { message: 'Mock provider refused the request' });
});

test('settles a denied tool even when ZCode finishes the turn successfully', async t => {
  const { dir, create } = fixture(t);
  const agent = create();
  await agent.start();
  const { thread } = await agent.request('thread/start', { cwd: dir });
  const events: any[] = [];
  agent.on('notification', event => events.push(event));
  const done = completed(agent);
  await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Deny a tool' }] });
  assert.equal((await done).status, 'completed');
  const command = events.filter(event => event.params.item?.type === 'commandExecution');
  assert.deepEqual(command.map(event => [event.method, event.params.item.status]), [['item/started', 'inProgress'], ['item/completed', 'failed']]);
  assert.equal(command[0].params.item.id, command[1].params.item.id);
});

test('deletes native storage after a successful or failed ephemeral helper turn', async t => {
  const { dir, data, storage, create, calls } = fixture(t);
  const agent = create({ ZCODE_SESSION_DB_PATH: path.join(dir, 'configured.db'), ZCODE_SESSION_DB: path.join(dir, 'legacy.db') });
  await agent.start();
  for (const [prompt, status] of [['Disposable helper', 'completed'], ['Disposable helper. Fail this turn', 'failed']]) {
    const { thread } = await agent.request('thread/start', { cwd: dir, ephemeral: true });
    const done = completed(agent);
    await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: prompt }] });
    assert.equal((await done).status, status);
    const call = calls().at(-1);
    assert.equal(call.storage, storage);
    assert.equal(call.legacyDatabase, undefined);
    assert.ok(!call.args.includes('--resume'));
    assert.equal(path.dirname(call.logs), path.dirname(call.database));
    assert.ok(!fs.existsSync(path.dirname(call.database)));
    assert.ok(!fs.existsSync(data));
    await agent.closeThread(thread.id);
  }
});

test('shutdown waits for a running doctor and escalates an unresponsive turn', { timeout: 20000 }, async t => {
  const { dir, data, create, calls } = fixture(t);
  const agent = create();
  await agent.start();
  const doctorFile = path.join(dir, 'doctor.pid');
  const probing = create({ ZCODE_TEST_HOLD_DOCTOR: doctorFile });
  const rejected = assert.rejects(probing.start(), /ZCode CLI could not be run/);
  const { thread } = await agent.request('thread/start', { cwd: dir });
  const mapped = path.join(data, 'sessions', thread.id);
  fs.mkdirSync(path.dirname(mapped), { recursive: true });
  const stopped = completed(agent);
  let status: string | undefined;
  void stopped.then(turn => { status = turn.status; });
  await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Ignore shutdown' }] });
  await Promise.all([waitForFile(mapped, t.signal), waitForFile(doctorFile, t.signal)]);
  const doctorPid = Number(fs.readFileSync(doctorFile, 'utf8'));
  const turnPid = Number(calls()[0].sessionId.slice(5));
  await probing.close();
  assert.throws(() => process.kill(doctorPid, 0), { code: 'ESRCH' });
  await rejected;
  await agent.close();
  assert.throws(() => process.kill(turnPid, 0), { code: 'ESRCH' });
  assert.equal(status, 'interrupted');
});
