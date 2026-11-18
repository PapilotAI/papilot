import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodeBuddyAgent } from '../src/server/codebuddy.ts';
import { RpcResponseError } from '../src/server/codex.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const modes = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions', 'fullAccess'];
function fixture() {
  let serial = 0;
  const stored = new Map<string, string>();
  const behavior = { rejectResume: false, rejectModel: false, delayClose: false };
  const processes: { cwd: string; args: string[]; env: NodeJS.ProcessEnv; calls: any[]; child: any; send: (message: any) => void; finishExit: () => void }[] = [];
  const launch = (_binary: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
    const child: any = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const finishExit = () => { child.exitCode = 0; child.emit('close', 0); };
    child.kill = () => { child.killed = true; if (!behavior.delayClose) setImmediate(finishExit); return true; };
    const send = (message: any) => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
    const calls: any[] = [];
    const pending = new Map<string, any>();
    processes.push({ cwd: options.cwd, args, env: options.env, calls, child, send, finishExit });
    let buffer = '';
    child.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        calls.push(message);
        setImmediate(() => {
          const { id, method, params } = message;
          if (method === 'initialize') send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: true } }, authMethods: [{ id: 'external' }] } });
          else if (method === 'session/new' || method === 'session/load') {
            if (method === 'session/load' && behavior.rejectResume) { send({ id, error: { code: -32000, message: 'Resume unavailable' } }); return; }
            const sessionId = params.sessionId || `codebuddy-${++serial}`;
            if (method === 'session/load') assert.equal(stored.get(sessionId), options.cwd, 'resume must launch in the original process directory');
            // Match CodeBuddy: the session ignores params.cwd and uses the
            // process cwd, so a shared home-directory process fails this test.
            stored.set(sessionId, options.cwd);
            send({ id, result: { sessionId, modes: { currentModeId: 'bypassPermissions', availableModes: modes.map(id => ({ id })) },
              models: { currentModelId: 'auto', availableModels: [{ modelId: 'auto', name: 'Auto' }] } } });
          } else if (method === 'session/set_model' && behavior.rejectModel) {
            send({ id, error: { code: -32000, message: 'Model unavailable' } });
          } else if (method === 'session/prompt') {
            pending.set(params.sessionId, message);
            send({ id: `approve-${params.sessionId}`, method: 'session/request_permission', params: { sessionId: params.sessionId,
              toolCall: { toolCallId: 'edit', kind: 'edit', title: 'Edit main.tex', locations: [{ path: path.join(options.cwd, 'main.tex') }] },
              options: [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] } });
          } else if (method === 'session/cancel') {
            const prompt = pending.get(params.sessionId);
            send({ id: prompt.id, result: { stopReason: 'cancelled' } });
          } else if (!method && String(id).startsWith('approve-')) {
            const sessionId = String(id).slice('approve-'.length), prompt = pending.get(sessionId);
            send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: options.cwd } } } });
            send({ id: prompt.id, result: { stopReason: 'end_turn' } });
          } else if (id !== undefined) send({ id, result: {} });
        });
      }
    });
    return child;
  };
  const agent = new CodeBuddyAgent('fake-codebuddy', launch as any);
  const requests: any[] = [], notifications: any[] = [];
  agent.on('request', request => requests.push(request));
  agent.on('notification', event => notifications.push(event));
  return { agent, processes, stored, requests, notifications, behavior };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await tick();
  assert.ok(check(), 'expected protocol event');
}

test('CodeBuddy discovers models without authentication or generation in an isolated process', { timeout: 5000 }, async () => {
  const f = fixture();
  try {
    await f.agent.start();
    assert.equal(f.agent.ready, true);
    assert.equal(f.processes.length, 1);
    assert.notEqual(f.processes[0].cwd, os.homedir());
    assert.equal(fs.existsSync(f.processes[0].cwd), false);
    assert.equal(f.processes[0].child.killed, true);
    assert.deepEqual(f.processes[0].args, ['--acp', '--permission-mode', 'default']);
    assert.equal(f.processes[0].env.CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS, '1');
    assert.equal(f.processes[0].calls.some(call => ['authenticate', 'session/prompt'].includes(call.method)), false);
    assert.equal((await f.agent.request('model/list')).data[0].model, 'auto');
    assert.deepEqual(f.agent.permissionOptions().map(option => option.value), ['workspace', 'acceptEdits', 'plan', 'full']);
  } finally { f.agent.close(); }
});

test('CodeBuddy remains unavailable when disposable workspace cleanup fails, then retries discovery', { timeout: 5000 }, async t => {
  const f = fixture(), remove = fs.promises.rm.bind(fs.promises), folders: string[] = [];
  const cleanup = t.mock.method(fs.promises, 'rm', async (folder: fs.PathLike, options: fs.RmOptions) => {
    folders.push(String(folder));
    assert.equal(f.agent.ready, false, 'availability is published only after cleanup succeeds');
    assert.equal(options.recursive, true);
    assert.ok((options.maxRetries || 0) > 0 && (options.maxRetries || 0) <= 5, 'transient Windows locks have bounded retries');
    throw Object.assign(new Error('EPERM: directory is still locked'), { code: 'EPERM' });
  });
  try {
    await assert.rejects(f.agent.start(), /EPERM/);
    assert.equal(f.agent.ready, false);
    assert.deepEqual(await f.agent.request('account/read'), { account: null, requiresOpenaiAuth: true });
    assert.deepEqual(await f.agent.request('model/list'), { data: [] });
    assert.deepEqual(f.agent.permissionOptions(), []);
    const oldFolder = f.processes[0].cwd;
    await assert.rejects(f.agent.start(), /EPERM/);
    assert.equal(f.processes.length, 1, 'failed cleanup must not allocate another discovery process');
    assert.deepEqual(folders, [oldFolder, oldFolder], 'retry removes the retained workspace');
    cleanup.mock.restore();
    await f.agent.start();
    assert.equal(f.agent.ready, true);
    assert.equal(fs.existsSync(oldFolder), false, 'the earlier failed workspace is eventually removed');
    assert.equal(f.processes.length, 2);
  } finally {
    cleanup.mock.restore(); f.agent.close();
    for (const folder of folders) await remove(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('CodeBuddy retains a timed-out discovery worker across close and reconnect until its streams close', { timeout: 5000 }, async t => {
  const f = fixture();
  f.behavior.delayClose = true;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const started = f.agent.start(), failed = assert.rejects(started, /did not exit/);
    await until(() => Boolean(f.processes[0]?.child.killed));
    const old = f.processes[0];
    old.child.exitCode = 0;
    old.child.emit('exit', 0);
    t.mock.timers.tick(10000);
    await failed;
    f.agent.close();
    await assert.rejects(f.agent.start(), /did not exit/);
    assert.equal(f.processes.length, 1, 'reconnect must retain the old probe and its cleanup barrier');
    assert.equal(f.agent.ready, false);
    assert.equal(fs.existsSync(old.cwd), true, 'the directory stays while inherited streams remain open');
    old.finishExit();
    f.behavior.delayClose = false;
    t.mock.timers.reset();
    await f.agent.start();
    assert.equal(f.agent.ready, true);
    assert.equal(f.processes.length, 2);
    assert.equal(fs.existsSync(old.cwd), false);
  } finally {
    t.mock.timers.reset(); f.behavior.delayClose = false;
    for (const entry of f.processes) entry.finishExit();
    f.agent.close();
    for (const entry of f.processes) await fs.promises.rm(entry.cwd, { recursive: true, force: true });
  }
});

test('CodeBuddy discovery retains inherited streams after its owned group exits and removes its workspace before reconnecting', { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const script = `
    const { spawn } = require('node:child_process');
    const { createInterface } = require('node:readline');
    createInterface({ input: process.stdin }).on('line', line => {
      const message = JSON.parse(line);
      const result = message.method === 'initialize' ? { protocolVersion: 1, agentCapabilities: {} }
        : message.method === 'session/new' ? { sessionId: 'probe', modes: { availableModes: [{ id: 'default' }] }, models: { currentModelId: 'auto', availableModels: [{ modelId: 'auto', name: 'Auto' }] } } : {};
      const reply = () => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
      if (message.method === 'session/new' && process.argv[1] === 'hold') {
        // Deliberately escape the owned group while retaining its streams, so
        // group termination cannot release this fixture and shutdown times out.
        const descendant = spawn(process.execPath, ['-e', 'process.stdin.resume(); process.stdin.once("end", () => process.exit(0));'], { detached: true, stdio: [3, 'inherit', 'inherit'] });
        descendant.once('spawn', reply);
      } else if (message.id !== undefined) reply();
    });
  `;
  const processes: { child: ChildProcess; cwd: string; closed: Promise<unknown>; didClose: boolean }[] = [];
  let firstExit!: () => void;
  const exited = new Promise<void>(resolve => { firstExit = resolve; });
  const agent = new CodeBuddyAgent('fake-codebuddy', (_binary, _args, options) => {
    assert.ok(options?.cwd, 'discovery launches in its disposable workspace');
    const first = processes.length === 0;
    if (!first) assert.equal(fs.existsSync(processes[0].cwd), false, 'old discovery workspace must be removed before launching its replacement');
    const child = spawn(process.execPath, ['-e', script, first ? 'hold' : 'normal'], { ...options, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    const entry = { child, cwd: String(options.cwd), closed: Promise.resolve() as Promise<unknown>, didClose: false };
    entry.closed = once(child, 'close').then(() => { entry.didClose = true; });
    if (first) child.once('exit', firstExit);
    processes.push(entry);
    return child;
  });
  const release = (child: ChildProcess) => (child.stdio[3] as NodeJS.WritableStream).end();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const failed = assert.rejects(agent.start(), /did not exit/);
    await exited;
    const old = processes[0];
    assert.equal(old.didClose, false, 'the descendant retains stdout and stderr after its parent exits');
    t.mock.timers.tick(10000);
    await failed;
    assert.equal(agent.ready, false);
    agent.close();
    await assert.rejects(agent.start(), /did not exit/);
    assert.equal(processes.length, 1, 'reconnect must not bypass the retained discovery process');
    assert.equal(old.didClose, false);
    assert.equal(fs.existsSync(old.cwd), true);
    release(old.child);
    await old.closed;
    t.mock.timers.reset();
    await agent.start();
    assert.equal(agent.ready, true);
    assert.equal(processes.length, 2);
    assert.ok(processes.every(entry => entry.didClose && !fs.existsSync(entry.cwd)));
  } finally {
    t.mock.timers.reset(); agent.close();
    for (const { child } of processes) {
      release(child);
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
    }
    await Promise.all(processes.map(entry => entry.closed));
    for (const { cwd } of processes) await fs.promises.rm(cwd, { recursive: true, force: true });
  }
});

test('CodeBuddy close during retained probe cleanup prevents a replacement discovery process', { timeout: 5000 }, async t => {
  const f = fixture(), remove = fs.promises.rm.bind(fs.promises);
  const cleanup = t.mock.method(fs.promises, 'rm', async () => { throw new Error('EPERM: probe is locked'); });
  let release: () => void = () => {};
  try {
    await assert.rejects(f.agent.start(), /EPERM/);
    const oldFolder = f.processes[0].cwd;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let removing = false;
    cleanup.mock.mockImplementation(async (folder: fs.PathLike, options?: fs.RmOptions) => {
      removing = true;
      await gate;
      await remove(folder, options);
    });
    const retry = f.agent.start(), disconnected = assert.rejects(retry, /disconnected/);
    await until(() => removing);
    f.agent.close();
    release();
    await disconnected;
    assert.equal(f.processes.length, 1);
    assert.equal(fs.existsSync(oldFolder), false);
    cleanup.mock.restore();
    await f.agent.start();
    assert.equal(f.agent.ready, true);
    assert.equal(f.processes.length, 2);
  } finally {
    release(); cleanup.mock.restore(); f.agent.close();
    for (const entry of f.processes) await remove(entry.cwd, { recursive: true, force: true });
  }
});

test('CodeBuddy keeps concurrent papers, approvals and interruptions in their own processes', { timeout: 5000 }, async () => {
  const f = fixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-papers-'));
  const first = path.join(dir, 'first'), second = path.join(dir, 'second');
  fs.mkdirSync(first); fs.mkdirSync(second);
  try {
    await f.agent.start();
    const [a, b] = await Promise.all([f.agent.request('thread/start', { cwd: first }), f.agent.request('thread/start', { cwd: second })]);
    assert.equal(f.stored.get(a.thread.id), first);
    assert.equal(f.stored.get(b.thread.id), second);
    const [ta, tb] = await Promise.all([f.agent.request('turn/start', { threadId: a.thread.id, input: [{ type: 'text', text: 'Edit A' }] }),
      f.agent.request('turn/start', { threadId: b.thread.id, input: [{ type: 'text', text: 'Edit B' }] })]);
    await until(() => f.requests.length === 2);
    const ra = f.requests.find(request => request.params.threadId === a.thread.id), rb = f.requests.find(request => request.params.threadId === b.thread.id);
    assert.match(ra.params.command, /first/); assert.match(rb.params.command, /second/);
    f.agent.respond(rb.id, { decision: 'decline' });
    await until(() => f.notifications.some(event => event.method === 'turn/completed' && event.params.turn.id === tb.turn.id));
    assert.equal(f.processes.find(process => process.cwd === second)?.child.killed, true, 'completed tasks must release idle runtimes');
    assert.equal(f.notifications.some(event => event.method === 'turn/completed' && event.params.turn.id === ta.turn.id), false);
    await f.agent.request('turn/interrupt', { turnId: ta.turn.id });
    await until(() => f.notifications.some(event => event.method === 'turn/completed' && event.params.turn.id === ta.turn.id));
    const pa = f.processes.find(process => process.cwd === first)!, pb = f.processes.find(process => process.cwd === second)!;
    assert.equal(pa.calls.some(call => call.method === 'session/cancel' && call.params.sessionId === a.thread.id), true);
    assert.equal(pb.calls.some(call => call.method === 'session/cancel'), false);
    assert.deepEqual(pb.calls.find(call => call.id === `approve-${b.thread.id}` && !call.method)?.result.outcome, { outcome: 'selected', optionId: 'no' });
    for (const process of [pa, pb]) assert.ok(process.calls.filter(call => call.method === 'session/set_mode').every(call => call.params.modeId === 'default'));
    await assert.rejects(f.agent.request('thread/resume', { threadId: a.thread.id, cwd: second }), /cannot move an active session/);
  } finally { f.agent.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CodeBuddy resumes after reconnect in the original worktree and reapplies permissions', { timeout: 5000 }, async () => {
  const f = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-resume-'));
  try {
    await f.agent.start();
    const { thread } = await f.agent.request('thread/start', { cwd, taskPermissions: 'full' });
    f.agent.close();
    await f.agent.start();
    await f.agent.request('thread/resume', { threadId: thread.id, cwd, taskPermissions: 'workspace' });
    const process = f.processes.at(-1)!;
    assert.equal(process.cwd, cwd);
    assert.ok(process.calls.some(call => call.method === 'session/load' && call.params.sessionId === thread.id));
    assert.equal(process.calls.filter(call => call.method === 'session/set_mode').at(-1)?.params.modeId, 'default');
    assert.equal(process.calls.some(call => call.method === 'authenticate'), false);
    assert.equal(f.agent.supportsReadOnlyTasks, false);
  } finally { f.agent.close(); fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('CodeBuddy rejects read-only tasks before launching a native process', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.agent.request('thread/start', { cwd: os.tmpdir(), sandbox: 'read-only' }), /does not support read-only/);
    await assert.rejects(f.agent.request('thread/resume', { threadId: 'saved', cwd: os.tmpdir(), sandbox: 'read-only' }), /does not support read-only/);
    assert.equal(f.processes.length, 0);
  } finally { f.agent.close(); }
});

test('CodeBuddy releases a deleted task process and clears stale discovery after disconnect', { timeout: 5000 }, async () => {
  const f = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-close-'));
  try {
    await f.agent.start();
    const { thread } = await f.agent.request('thread/start', { cwd });
    const process = f.processes.at(-1)!;
    await f.agent.closeThread(thread.id);
    assert.equal(process.child.killed, true);
    await assert.rejects(f.agent.request('turn/start', { threadId: thread.id, input: [] }), /Start or resume/);
    assert.equal(f.agent.ready, true, 'closing a task preserves agent availability');
    f.agent.close();
    assert.deepEqual(await f.agent.request('account/read'), { account: null, requiresOpenaiAuth: true });
    assert.deepEqual(await f.agent.request('model/list'), { data: [] });
    assert.deepEqual(f.agent.permissionOptions(), []);
  } finally { f.agent.close(); fs.rmSync(cwd, { recursive: true, force: true }); }
});

for (const reconnect of [false, true]) {
  test(`CodeBuddy restores a loaded idle thread before the next turn after ${reconnect ? 'reconnect' : 'worker exit'}`, { timeout: 5000 }, async () => {
    const f = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-idle-'));
    try {
      await f.agent.start();
      const { thread } = await f.agent.request('thread/start', { cwd });
      if (reconnect) { f.agent.close(); await f.agent.start(); }
      else f.processes.at(-1)!.child.emit('close', 1);
      // Workspace.loaded skips thread/resume on this path.
      const { turn } = await f.agent.request('turn/start', { threadId: thread.id, model: 'auto', taskPermissions: 'workspace', input: [{ type: 'text', text: 'Continue' }] });
      await until(() => f.requests.length === 1);
      const process = f.processes.at(-1)!;
      assert.equal(process.cwd, cwd);
      assert.ok(process.calls.some(call => call.method === 'session/load' && call.params.sessionId === thread.id));
      f.agent.respond(f.requests[0].id, { decision: 'accept' });
      await until(() => f.notifications.some(event => event.method === 'turn/completed' && event.params.turn.id === turn.id));
      assert.equal(f.notifications.filter(event => event.method === 'turn/completed').at(-1)?.params.turn.status, 'completed');
    } finally { f.agent.close(); fs.rmSync(cwd, { recursive: true, force: true }); }
  });
}

test('CodeBuddy rejects a failed restore before submitting a prompt and can retry it', { timeout: 5000 }, async () => {
  const f = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-retry-'));
  try {
    await f.agent.start();
    const { thread } = await f.agent.request('thread/start', { cwd });
    f.processes.at(-1)!.child.emit('close', 1);
    f.behavior.rejectResume = true;
    await assert.rejects(f.agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Continue' }] }), error => error instanceof RpcResponseError && /Resume unavailable/.test(error.message));
    assert.equal(f.processes.some(process => process.calls.some(call => call.method === 'session/prompt')), false);
    f.behavior.rejectResume = false;
    await f.agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Continue' }] });
    await until(() => f.requests.length === 1);
    f.agent.respond(f.requests[0].id, { decision: 'decline' });
    await until(() => f.notifications.some(event => event.method === 'turn/completed'));
  } finally { f.agent.close(); fs.rmSync(cwd, { recursive: true, force: true }); }
});

for (const interrupted of [false, true]) {
  test(`CodeBuddy keeps initial instructions after ${interrupted ? 'an immediate pause' : 'a pre-prompt failure and failed restore'}`, { timeout: 5000 }, async () => {
    const f = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-instructions-'));
    const instructions = 'Edit only main.tex. Papilot publishes the review after the turn.';
    const prompts = () => f.processes.flatMap(process => process.calls).filter(call => call.method === 'session/prompt');
    try {
      await f.agent.start();
      const { thread } = await f.agent.request('thread/start', { cwd, model: 'auto', developerInstructions: instructions });
      f.behavior.rejectModel = !interrupted;
      const first = await f.agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Edit the title.' }] });
      if (interrupted) await f.agent.request('turn/interrupt', { turnId: first.turn.id });
      await until(() => f.notifications.some(event => event.method === 'turn/completed' && event.params.turn.id === first.turn.id));
      assert.equal(prompts().length, 0, 'the native history has not received the instructions');
      f.behavior.rejectModel = false;
      if (!interrupted) {
        f.behavior.rejectResume = true;
        await assert.rejects(f.agent.request('turn/start', { threadId: thread.id, input: [] }), /Resume unavailable/);
        f.behavior.rejectResume = false;
      }
      const retry = await f.agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Retry the title edit.' }] });
      await until(() => f.requests.length === 1);
      assert.equal(prompts()[0].params.prompt[0].text, `${instructions}\n\n---\n\nRetry the title edit.`);
      f.agent.respond(f.requests[0].id, { decision: 'decline' });
      await until(() => f.notifications.some(event => event.method === 'turn/completed' && event.params.turn.id === retry.turn.id));

      const next = await f.agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Continue.' }] });
      await until(() => f.requests.length === 2);
      assert.equal(prompts()[1].params.prompt[0].text, 'Continue.', 'established sessions must not repeat the instructions');
      f.agent.respond(f.requests[1].id, { decision: 'decline' });
      await until(() => f.notifications.some(event => event.method === 'turn/completed' && event.params.turn.id === next.turn.id));
    } finally { f.agent.close(); fs.rmSync(cwd, { recursive: true, force: true }); }
  });
}

test('CodeBuddy does not repeat submitted initial instructions after a worker disconnects mid-turn', { timeout: 5000 }, async () => {
  const f = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-submitted-'));
  try {
    await f.agent.start();
    const { thread } = await f.agent.request('thread/start', { cwd, developerInstructions: 'Papilot owns the review workflow.' });
    const first = await f.agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Edit.' }] });
    await until(() => f.requests.length === 1);
    f.processes.at(-1)!.finishExit();
    await until(() => f.notifications.some(event => event.method === 'turn/completed' && event.params.turn.id === first.turn.id));
    const next = await f.agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Continue.' }] });
    await until(() => f.requests.length === 2);
    assert.equal(f.processes.at(-1)!.calls.find(call => call.method === 'session/prompt').params.prompt[0].text, 'Continue.');
    f.agent.respond(f.requests[1].id, { decision: 'decline' });
    await until(() => f.notifications.some(event => event.method === 'turn/completed' && event.params.turn.id === next.turn.id));
  } finally { f.agent.close(); fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('CodeBuddy resumes an uncached native session without repeating initial instructions', { timeout: 5000 }, async () => {
  const f = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-persisted-'));
  try {
    f.stored.set('persisted-session', cwd);
    await f.agent.start();
    await f.agent.request('thread/resume', { cwd, threadId: 'persisted-session', developerInstructions: 'Already in native history.' });
    const { turn } = await f.agent.request('turn/start', { threadId: 'persisted-session', input: [{ type: 'text', text: 'Continue.' }] });
    await until(() => f.requests.length === 1);
    assert.equal(f.processes.at(-1)!.calls.find(call => call.method === 'session/prompt').params.prompt[0].text, 'Continue.');
    f.agent.respond(f.requests[0].id, { decision: 'decline' });
    await until(() => f.notifications.some(event => event.method === 'turn/completed' && event.params.turn.id === turn.id));
  } finally { f.agent.close(); fs.rmSync(cwd, { recursive: true, force: true }); }
});

for (const known of [false, true]) for (const next of ['resume', 'delete', 'reconnect'] as const) {
  test(`CodeBuddy waits for a failed ${known ? 'known' : 'uncached'} restore worker before ${next}`, { timeout: 5000 }, async () => {
    const f = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-failed-restore-'));
    try {
      await f.agent.start();
      const { thread } = await f.agent.request('thread/start', { cwd });
      if (known) f.processes.at(-1)!.finishExit();
      else await f.agent.closeThread(thread.id);
      f.behavior.rejectResume = true; f.behavior.delayClose = true;
      await assert.rejects(f.agent.request('thread/resume', { threadId: thread.id, cwd }), /Resume unavailable/);
      const failed = f.processes.at(-1)!;
      assert.equal(failed.child.killed, true);
      assert.equal(failed.child.exitCode, undefined);
      f.behavior.rejectResume = false;
      if (next === 'reconnect') {
        f.agent.close();
        f.behavior.delayClose = false; // The separate discovery worker can exit.
        await f.agent.start();
      }
      const count = f.processes.length;
      let finished = false;
      const pending = (next === 'delete' ? f.agent.closeThread(thread.id)
        : next === 'resume' ? f.agent.request('thread/resume', { threadId: thread.id, cwd })
        : f.agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Continue' }] }))
        .then(() => { finished = true; });
      await tick(); await tick();
      assert.equal(finished, false, 'the failed restore still owns the worktree');
      assert.equal(f.processes.length, count, 'no replacement may overlap the failed restore');
      f.behavior.delayClose = false;
      failed.finishExit();
      await pending;
      if (next === 'reconnect') {
        await until(() => f.requests.length === 1);
        f.agent.respond(f.requests[0].id, { decision: 'decline' });
        await until(() => f.notifications.some(event => event.method === 'turn/completed'));
      }
    } finally {
      f.behavior.delayClose = false;
      for (const worker of f.processes) if (worker.child.killed && worker.child.exitCode == null) worker.finishExit();
      f.agent.close(); fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
}

test('CodeBuddy keeps a failed shutdown attached to the session until the process exits', { timeout: 5000 }, async t => {
  const f = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-shutdown-retry-'));
  try {
    await f.agent.start();
    const { thread } = await f.agent.request('thread/start', { cwd });
    const worker = f.processes.at(-1)!;
    f.behavior.delayClose = true;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deleted = assert.rejects(f.agent.closeThread(thread.id), /did not exit/);
    t.mock.timers.tick(10000);
    await deleted;
    await assert.rejects(f.agent.closeThread(thread.id), /did not exit/);
    await assert.rejects(f.agent.request('thread/resume', { threadId: thread.id, cwd }), /did not exit/);
    assert.equal(f.processes.length, 2, 'a timed-out worker must prevent replacements');
    f.behavior.delayClose = false;
    worker.finishExit();
    await f.agent.closeThread(thread.id);
    await assert.rejects(f.agent.request('turn/start', { threadId: thread.id, input: [] }), /Start or resume/);
  } finally {
    f.behavior.delayClose = false;
    for (const worker of f.processes) if (worker.child.killed && worker.child.exitCode == null) worker.finishExit();
    f.agent.close(); fs.rmSync(cwd, { recursive: true, force: true });
  }
});

for (const reconnect of [false, true]) {
  test(`CodeBuddy waits for a failed task creation worker before ${reconnect ? 'reconnecting' : 'retrying'}`, { timeout: 5000 }, async () => {
    const f = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-failed-start-'));
    try {
      await f.agent.start();
      f.behavior.rejectModel = true; f.behavior.delayClose = true;
      await assert.rejects(f.agent.request('thread/start', { cwd, model: 'auto' }), /Model unavailable/);
      const failed = f.processes.at(-1)!;
      assert.equal(failed.child.killed, true);
      f.behavior.rejectModel = false;
      if (reconnect) {
        f.agent.close();
        f.behavior.delayClose = false;
        await f.agent.start();
      }
      const count = f.processes.length;
      let finished = false;
      const pending = f.agent.request('thread/start', { cwd, model: 'auto' }).then(() => { finished = true; });
      await tick(); await tick();
      assert.equal(finished, false, 'a failed start must release its process even without a registered session');
      assert.equal(f.processes.length, count);
      f.behavior.delayClose = false;
      failed.finishExit();
      await pending;
      assert.equal(finished, true);
    } finally {
      f.behavior.delayClose = false;
      for (const worker of f.processes) if (worker.child.killed && worker.child.exitCode == null) worker.finishExit();
      f.agent.close(); fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
}

for (const hasThread of [false, true]) {
  test(`CodeBuddy worktree release waits for workers ${hasThread ? 'with' : 'without'} a thread ID and can retry`, { timeout: 5000 }, async t => {
    const f = fixture(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-worktree-close-'));
    const cwd = path.join(root, 'deleted'), other = path.join(root, 'preserved');
    fs.mkdirSync(cwd); fs.mkdirSync(other);
    try {
      await f.agent.start();
      const { thread: otherThread } = await f.agent.request('thread/start', { cwd: other });
      const otherWorker = f.processes.at(-1)!;
      let threadId: string | undefined;
      t.mock.timers.enable({ apis: ['setTimeout'] });
      f.behavior.delayClose = true;
      if (hasThread) threadId = (await f.agent.request('thread/start', { cwd })).thread.id;
      else {
        f.behavior.rejectModel = true;
        await assert.rejects(f.agent.request('thread/start', { cwd, model: 'auto' }), /Model unavailable/);
        f.behavior.rejectModel = false;
      }
      const worker = f.processes.at(-1)!;
      let finished = false;
      const closing = f.agent.closeWorktree(cwd).finally(() => { finished = true; });
      const failure = assert.rejects(closing, /did not exit/);
      await tick(); await tick();
      assert.equal(finished, false);
      assert.equal(worker.child.killed, true);
      assert.equal(otherWorker.child.killed, undefined, 'other worktrees keep their workers');
      t.mock.timers.tick(10000);
      await failure;
      await assert.rejects(f.agent.closeWorktree(cwd), /did not exit/);
      if (threadId) await assert.rejects(f.agent.request('turn/start', { threadId, input: [] }), /did not exit/);
      else await assert.rejects(f.agent.request('thread/start', { cwd }), /did not exit/);
      f.behavior.delayClose = false;
      worker.finishExit();
      await f.agent.closeWorktree(cwd);
      if (threadId) await assert.rejects(f.agent.request('turn/start', { threadId, input: [] }), /Start or resume/);
      assert.equal(otherWorker.child.killed, undefined);
      await f.agent.closeThread(otherThread.id);
    } finally {
      f.behavior.delayClose = false;
      for (const worker of f.processes) if (worker.child.killed && worker.child.exitCode == null) worker.finishExit();
      f.agent.close(); fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const next of ['delete', 'resume'] as const) {
  test(`CodeBuddy waits for a released worker to exit before ${next}`, { timeout: 5000 }, async () => {
    const f = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codebuddy-exit-'));
    try {
      await f.agent.start();
      const { thread } = await f.agent.request('thread/start', { cwd });
      const worker = f.processes.at(-1)!;
      f.behavior.delayClose = true;
      await f.agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Edit' }] });
      await until(() => f.requests.length === 1);
      f.agent.respond(f.requests[0].id, { decision: 'decline' });
      await until(() => f.notifications.some(event => event.method === 'turn/completed'));
      assert.equal(worker.child.killed, true);
      assert.equal(worker.child.exitCode, undefined, 'the native process has not released its cwd yet');
      let finished = false;
      const pending = (next === 'delete' ? f.agent.closeThread(thread.id)
        : f.agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Continue' }] })).then(() => { finished = true; });
      await tick(); await tick();
      assert.equal(finished, false, 'shutdown after close must reuse its pending exit promise');
      assert.equal(f.processes.length, 2, 'a replacement must not overlap the exiting worker');
      f.behavior.delayClose = false;
      worker.finishExit();
      await pending;
      if (next === 'resume') {
        await until(() => f.requests.length === 2);
        f.agent.respond(f.requests[1].id, { decision: 'decline' });
        await until(() => f.notifications.filter(event => event.method === 'turn/completed').length === 2);
      }
    } finally {
      f.behavior.delayClose = false;
      for (const worker of f.processes) if (worker.child.killed && worker.child.exitCode == null) worker.finishExit();
      f.agent.close(); fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
}
