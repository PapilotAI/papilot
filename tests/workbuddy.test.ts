import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkBuddyAgent } from '../src/server/workbuddy.ts';

function fixture({ loggedIn = true, modes = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'fullAccess'] } = {}) {
  const calls: any[] = [], launches: { binary: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }[] = [];
  let serial = 0;
  const launch = (binary: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
    launches.push({ binary, args, cwd: options.cwd, env: options.env });
    const child: any = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { setImmediate(() => child.emit('close', 0)); return true; };
    const send = (message: any) => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
    let buffer = '';
    child.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        calls.push(message);
        setImmediate(() => {
          const { id, method, params } = message;
          if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [{ id: 'internal', name: 'Sign in' }] } });
          else if (method === 'session/new' || method === 'session/load') {
            if (!loggedIn) send({ id, error: { code: -32000, message: 'Authentication required', data: { category: 'auth' } } });
            else send({ id, result: { sessionId: params.sessionId || `wb-${++serial}`, modes: { availableModes: modes.map(id => ({ id })) }, models: { currentModelId: 'configured-model', availableModels: [{ modelId: 'configured-model', name: 'Configured model' }] } } });
          } else if (id !== undefined) send({ id, result: {} });
        });
      }
    });
    return child;
  };
  return { agent: new WorkBuddyAgent('fake-workbuddy-wrapper', launch as any), calls, launches };
}

test('WorkBuddy requires its explicitly configured launcher instead of selecting CodeBuddy', async () => {
  let launched = false;
  const agent = new WorkBuddyAgent('', (() => { launched = true; throw new Error('unexpected launch'); }) as any);
  assert.equal(agent.detect(), false);
  await assert.rejects(agent.start(), /PAPILOT_WORKBUDDY_BIN/);
  await assert.rejects(agent.request('thread/start', { cwd: os.tmpdir() }), /PAPILOT_WORKBUDDY_BIN/);
  await assert.rejects(agent.request('thread/resume', { cwd: os.tmpdir(), threadId: 'old-session' }), /PAPILOT_WORKBUDDY_BIN/);
  assert.equal(agent.ready, false);
  assert.equal(launched, false);
  agent.close();
});

test('WorkBuddy checks its own login without prompting and starts task runtimes in their worktrees', { timeout: 5000 }, async () => {
  const f = fixture();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-workbuddy-test-'));
  try {
    await f.agent.start();
    assert.equal(f.agent.ready, true);
    assert.ok(f.launches.every(call => call.binary === 'fake-workbuddy-wrapper'));
    assert.deepEqual(f.launches[0].args, ['--acp', '--permission-mode', 'default']);
    assert.equal(f.launches[0].env.CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS, '1');
    assert.equal(f.calls.some(call => ['authenticate', 'session/prompt'].includes(call.method)), false);
    assert.equal(f.calls.some(call => call.params?._meta), false, 'the public ACP flow must not forge desktop admission metadata');
    const account = await f.agent.request('account/read', {});
    assert.match(account.account.type, /WorkBuddy/);
    assert.equal(account.requiresOpenaiAuth, false);
    assert.deepEqual(f.agent.permissionOptions().map(option => option.value), ['workspace', 'acceptEdits', 'plan', 'full']);
    await f.agent.request('thread/start', { cwd, taskPermissions: 'workspace' });
    assert.equal(f.launches.at(-1)?.cwd, cwd);
    assert.ok(f.calls.some(call => call.method === 'session/set_mode' && call.params.modeId === 'default'));
  } finally { f.agent.close(); fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('WorkBuddy authentication failure stays unavailable and does not launch a login flow', { timeout: 5000 }, async () => {
  const f = fixture({ loggedIn: false });
  try {
    await assert.rejects(f.agent.start(), /WorkBuddy.*Authentication required.*PAPILOT_WORKBUDDY_BIN/);
    assert.equal(f.agent.ready, false);
    assert.equal(f.calls.some(call => ['authenticate', 'session/prompt'].includes(call.method)), false);
    const account = await f.agent.request('account/read', {});
    assert.equal(account.account, null);
    assert.equal(account.requiresOpenaiAuth, true);
  } finally { f.agent.close(); }
});

test('WorkBuddy refuses a runtime that offers only bypassed permissions', { timeout: 5000 }, async () => {
  const f = fixture({ modes: ['bypassPermissions', 'fullAccess'] });
  try {
    await assert.rejects(f.agent.start(), /does not offer manual approvals/);
    assert.equal(f.agent.ready, false);
    assert.equal(f.calls.some(call => call.method === 'session/prompt'), false);
  } finally { f.agent.close(); }
});

test('WorkBuddy does not represent its planning mode as a read-only sandbox', { timeout: 5000 }, async () => {
  const f = fixture();
  try {
    await f.agent.start();
    await assert.rejects(f.agent.request('thread/start', { cwd: os.tmpdir(), sandbox: 'read-only' }), /The selected agent does not support read-only tasks through ACP\. Select another agent\./);
    assert.equal(f.calls.some(call => call.method === 'session/prompt'), false);
  } finally { f.agent.close(); }
});
