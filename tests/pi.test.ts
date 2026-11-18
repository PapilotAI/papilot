import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PiAgent } from '../src/server/pi.ts';
import { piExecutable, supportedPi } from '../bin/pi-cli.mjs';

const model = { provider: 'custom', id: 'org/model', name: 'Research model', reasoning: true };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(prompt?: (command: any, peer: any) => void, options: { models?: any[]; version?: string } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-pi-test-'));
  const calls: any[] = [], peers: any[] = [], notifications: any[] = [], requests: any[] = [];
  const launch = (_binary: string, args: string[], spawnOptions: any) => {
    const child: any = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    const close = (code = 0) => { if (!closed) { closed = true; child.emit('close', code); } };
    child.kill = () => { close(); return true; };
    child.stdin.on('finish', () => setImmediate(close));
    const send = (value: any) => child.stdout.write(JSON.stringify(value) + '\n');
    const reply = (command: any, data: any = {}) => send({ type: 'response', id: command.id, command: command.type, success: true, data });
    const peer = { child, send, reply, args, spawnOptions, close };
    peers.push(peer);
    let buffer = '';
    child.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const command = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); calls.push(command);
        setImmediate(() => {
          if (command.type === 'get_state') reply(command, { model, thinkingLevel: 'medium', sessionFile: args[args.indexOf('--session') + 1] });
          else if (command.type === 'get_available_models') reply(command, { models: options.models ?? [model] });
          else if (command.type === 'prompt') {
            if (prompt) prompt(command, peer);
            else { reply(command, { disposition: 'started' }); answer(peer, 'Done.'); }
          } else if (command.type !== 'extension_ui_response') reply(command);
        });
      }
    });
    return child;
  };
  const agent = new PiAgent({ dir, find: () => 'fake-pi', version: async () => options.version || '1.5.2', launch: launch as any });
  agent.on('notification', message => notifications.push(message));
  agent.on('request', message => requests.push(message));
  return { agent, dir, peers, calls, notifications, requests, cleanup: () => { agent.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
function answer(peer: any, text: string) {
  peer.send({ type: 'message_start', message: { role: 'assistant' } });
  peer.send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } });
  peer.send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } });
  peer.send({ type: 'agent_end', messages: [] });
  peer.send({ type: 'agent_settled', aborted: false });
}
async function thread(agent: PiAgent, extra: any = {}) {
  return (await agent.request('thread/start', { cwd: os.tmpdir(), developerInstructions: 'Only edit the paper.', ...extra })).thread.id;
}
function completion(agent: PiAgent) {
  return new Promise<any>(resolve => {
    const listen = (message: any) => { if (message.method === 'turn/completed') { agent.off('notification', listen); resolve(message.params.turn); } };
    agent.on('notification', listen);
  });
}
async function run(agent: PiAgent, id: string, extra: any = {}) {
  const done = completion(agent);
  await agent.request('turn/start', { threadId: id, input: [{ type: 'text', text: 'Edit this paper.' }], ...extra });
  return done;
}

test('Pi discovers native configuration without prompting and refreshes on reconnect', async () => {
  const f = fixture();
  try {
    await Promise.all([f.agent.start(), f.agent.start()]);
    assert.equal(f.peers.length, 1);
    assert.ok(f.peers[0].args.includes('--no-session'));
    assert.equal(f.peers[0].args.includes('--no-extensions'), false);
    assert.equal(f.calls.some(call => call.type === 'prompt'), false);
    assert.equal((await f.agent.request('account/read')).requiresOpenaiAuth, false);
    assert.deepEqual((await f.agent.request('model/list')).data.map((entry: any) => [entry.model, entry.source, entry.isDefault]), [['custom/org/model', 'custom', true]]);
    assert.deepEqual(f.agent.permissionOptions(), []);
    await assert.rejects(f.agent.taskPermissionConfig('full'));
    await f.agent.start(); assert.equal(f.peers.length, 2);
  } finally { f.cleanup(); }
});

test('Pi reports missing credentials and unsupported CLI versions', async () => {
  const f = fixture(undefined, { models: [] }), old = fixture(undefined, { version: '0.73.1' });
  try {
    await f.agent.start(); assert.equal((await f.agent.request('account/read')).requiresOpenaiAuth, true);
    await assert.rejects(old.agent.start(), /1\.5\.1/); assert.equal(old.peers.length, 0);
    for (const version of ['1.5.1', '1.5.2', '2.0.0']) assert.equal(supportedPi(version), true);
    for (const version of ['1.5.0', '0.73.1', 'garbage', '1.5.1-beta']) assert.equal(supportedPi(version), false);
    assert.notEqual(piExecutable({ PATH: path.resolve('node_modules/.bin'), HOME: f.dir, USERPROFILE: f.dir }), path.resolve('node_modules/.bin/pi'), 'Writer SDK is not a native Pi installation');
    assert.equal(piExecutable({ PAPILOT_PI_BIN: path.join(f.dir, 'missing') }), null);
  } finally { f.cleanup(); old.cleanup(); }
});

test('Pi discovery skips regular bundled shims before a native CLI on PATH', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-pi-path-'));
  try {
    const bin = path.join(dir, 'bin'), bundled = path.join(dir, 'node_modules', '.bin'), native = path.join(dir, 'native');
    for (const folder of [bin, bundled, native]) fs.mkdirSync(folder, { recursive: true });
    for (const name of ['pi-cli.mjs', 'agent-paths.mjs']) fs.copyFileSync(new URL(`../bin/${name}`, import.meta.url), path.join(bin, name));
    const name = process.platform === 'win32' ? 'pi.cmd' : 'pi';
    for (const folder of [bundled, native]) fs.writeFileSync(path.join(folder, name), 'fixture wrapper', { mode: 0o755 });
    const { piExecutable: find } = await import(pathToFileURL(path.join(bin, 'pi-cli.mjs')).href);
    const env = { PATH: [bundled, native].join(path.delimiter), HOME: dir, USERPROFILE: dir };
    // Windows lookup may return PATHEXT's casing for the same executable.
    assert.equal(path.relative(find(env)!, path.join(native, name)), '');
    assert.equal(path.relative(find({ ...env, PAPILOT_PI_BIN: path.join(native, name) })!, path.join(native, name)), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Pi streams Unicode, native images and file/command tools, preserving instructions and model IDs', async () => {
  const f = fixture((command, peer) => {
    peer.reply(command, { disposition: 'started' });
    peer.send({ type: 'tool_execution_start', toolCallId: 'shell', toolName: 'bash', args: { command: 'latexmk main.tex' } });
    peer.send({ type: 'tool_execution_end', toolCallId: 'shell', result: { content: [{ type: 'text', text: 'OK' }] }, isError: false });
    peer.send({ type: 'tool_execution_start', toolCallId: 'edit', toolName: 'edit', args: { path: 'main.tex' } });
    peer.send({ type: 'tool_execution_end', toolCallId: 'edit', result: { content: [] }, isError: false });
    answer(peer, '中文\u2028text\u2029done');
  });
  try {
    const image = path.join(f.dir, 'page.png'); fs.writeFileSync(image, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
    await f.agent.start(); const id = await thread(f.agent);
    assert.equal((await run(f.agent, id, { model: 'custom/org/model', effort: 'high', input: [{ type: 'text', text: 'Read.' }, { type: 'localImage', path: image }] })).status, 'completed');
    const prompt = f.calls.find(call => call.type === 'prompt');
    assert.equal(prompt.message, 'Read.'); assert.equal(prompt.images[0].mimeType, 'image/png');
    const selected = f.calls.find(call => call.type === 'set_model');
    assert.equal(selected.provider, 'custom'); assert.equal(selected.modelId, 'org/model');
    assert.equal(f.calls.find(call => call.type === 'set_thinking_level').level, 'high');
    assert.ok(f.peers[1].args.includes('Only edit the paper.'));
    assert.equal(f.peers[1].args.includes('--no-extensions'), false);
    const items = f.notifications.filter(item => item.method === 'item/completed').map(item => item.params.item);
    assert.deepEqual(items.map(item => item.type), ['commandExecution', 'fileChange', 'agentMessage']);
    assert.equal(items[0].aggregatedOutput, 'OK'); assert.equal(items[1].changes[0].path, 'main.tex');
    assert.equal(items[2].text, '中文\u2028text\u2029done');
    await run(f.agent, id);
    assert.deepEqual(f.peers[1].args, f.peers[2].args, 'same session path across turns');
    fs.writeFileSync(path.join(f.dir, id + '.jsonl'), 'fixture session');
    f.agent.close(); await f.agent.start();
    await f.agent.request('thread/resume', { threadId: id, cwd: os.tmpdir() }); await run(f.agent, id);
    assert.equal(f.peers.at(-1).args[3], f.peers[1].args[3], 'same session path after server restart');
    await assert.rejects(f.agent.request('thread/resume', { threadId: '../../escape', cwd: os.tmpdir() }));
  } finally { f.cleanup(); }
});

test('Pi waits through retry boundaries and does not mistake prompt acceptance for completion', async () => {
  let active: any;
  const f = fixture((command, peer) => { active = peer; peer.reply(command, { disposition: 'started' }); peer.send({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'Retrying' } }); peer.send({ type: 'agent_end', willRetry: true }); });
  try {
    await f.agent.start(); const id = await thread(f.agent), done = completion(f.agent);
    await f.agent.request('turn/start', { threadId: id });
    await assert.rejects(f.agent.request('turn/start', { threadId: id }), /still running/);
    while (!active) await tick();
    await tick(); assert.equal(f.notifications.some(item => item.method === 'turn/completed'), false);
    answer(active, 'Recovered.'); assert.equal((await done).status, 'completed');
  } finally { f.cleanup(); }
});

test('Pi forwards extension confirmations, selections and free text without automatic approval', async () => {
  for (const method of ['confirm', 'select', 'input', 'editor']) {
    let active: any;
    const f = fixture((command, peer) => { active = peer; peer.reply(command, { disposition: 'started' }); peer.send({ type: 'extension_ui_request', id: 'native-id', method, title: 'Choose', options: ['Option A', 'Option B'] }); });
    try {
      await f.agent.start(); const id = await thread(f.agent), done = completion(f.agent);
      await f.agent.request('turn/start', { threadId: id });
      while (!f.requests.length) await tick();
      assert.equal(f.calls.some(call => call.type === 'extension_ui_response'), false);
      if (method === 'select') assert.equal(f.requests[0].params.questions[0].isOther, false);
      f.agent.respond(f.requests[0].id, method === 'confirm' ? { decision: 'decline' } : { answers: { value: { answers: ['Option B'] } } });
      const reply = f.calls.find(call => call.type === 'extension_ui_response');
      assert.equal(reply.id, 'native-id'); assert.deepEqual(method === 'confirm' ? reply.confirmed : reply.value, method === 'confirm' ? false : 'Option B');
      answer(active, 'Done'); assert.equal((await done).status, 'completed');
    } finally { f.cleanup(); }
  }
});

test('Pi handles rejection, empty output, provider errors, process exits and handled commands', async () => {
  for (const scenario of ['reject', 'empty', 'provider', 'exit', 'handled']) {
    const f = fixture((command, peer) => {
      if (scenario === 'reject') { peer.send({ type: 'response', id: command.id, success: false, error: 'Missing API key' }); return; }
      peer.reply(command, { disposition: scenario === 'handled' ? 'handled' : 'started' });
      if (scenario === 'exit') { peer.close(1); return; }
      if (scenario === 'provider') peer.send({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'Provider refused' } });
      if (scenario !== 'handled') peer.send({ type: 'agent_settled' });
    });
    try { await f.agent.start(); assert.equal((await run(f.agent, await thread(f.agent))).status, scenario === 'handled' ? 'completed' : 'failed', scenario); }
    finally { f.cleanup(); }
  }
});

test('Pi interruption waits for exit and read-only helpers disable tools and extensions', async () => {
  let active: any;
  const f = fixture((command, peer) => { active = peer; peer.reply(command, { disposition: 'started' }); });
  try {
    await f.agent.start(); const id = await thread(f.agent, { ephemeral: true, sandbox: 'read-only' }), done = completion(f.agent);
    const turn = await f.agent.request('turn/start', { threadId: id });
    while (!active) await tick();
    await f.agent.request('turn/interrupt', { turnId: turn.turn.id });
    assert.equal((await done).status, 'interrupted');
    for (const option of ['--no-session', '--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates']) assert.ok(active.args.includes(option));
    assert.equal(active.args.includes('--session'), false);
    assert.ok(f.calls.some(call => call.type === 'abort'));
    await f.agent.closeThread(id);
  } finally { f.cleanup(); }
});

test('Pi waits for model work started by a handled extension command', async () => {
  let active: any;
  const f = fixture((command, peer) => {
    active = peer;
    peer.send({ type: 'agent_start' });
    peer.reply(command, { disposition: 'handled' });
  });
  try {
    await f.agent.start(); const id = await thread(f.agent), done = completion(f.agent);
    await f.agent.request('turn/start', { threadId: id });
    while (!active) await tick();
    await tick(); await tick();
    assert.equal(f.notifications.some(item => item.method === 'turn/completed'), false);
    answer(active, 'Extension response'); assert.equal((await done).status, 'completed');
  } finally { f.cleanup(); }
});

test('Pi clears expired extension requests and rejects lost session files', async () => {
  let active: any;
  const f = fixture((command, peer) => {
    active = peer; peer.reply(command, { disposition: 'started' });
    peer.send({ type: 'extension_ui_request', id: 'timed', method: 'confirm', title: 'Continue?', timeout: 5 });
  });
  try {
    await f.agent.start(); const id = await thread(f.agent), done = completion(f.agent);
    await assert.rejects(f.agent.request('thread/resume', { threadId: id, cwd: os.tmpdir() }), /session file is missing/);
    await f.agent.request('turn/start', { threadId: id });
    await new Promise<void>(resolve => {
      const listen = (message: any) => { if (message.method === 'serverRequest/resolved') { f.agent.off('notification', listen); resolve(); } };
      f.agent.on('notification', listen);
    });
    assert.throws(() => f.agent.respond(f.requests[0].id, { decision: 'accept' }), /ended/);
    assert.ok(f.calls.some(call => call.type === 'extension_ui_response' && call.cancelled));
    answer(active, 'Expired'); assert.equal((await done).status, 'completed');
  } finally { f.cleanup(); }
});

test('Pi cannot launch a turn after its thread was closed or a probe after shutdown', async () => {
  const f = fixture();
  try {
    await f.agent.start(); const id = await thread(f.agent);
    await f.agent.request('turn/start', { threadId: id });
    await f.agent.closeThread(id); await tick();
    assert.equal(f.peers.length, 1); assert.equal(f.calls.some(call => call.type === 'prompt'), false);
    let release!: (version: string) => void, launches = 0;
    const agent = new PiAgent({ find: () => 'fake-pi', version: () => new Promise(resolve => { release = resolve; }), launch: (() => { launches++; throw new Error('Unexpected launch'); }) as any });
    const connecting = agent.start(); agent.close(); release('1.5.2');
    await assert.rejects(connecting, /ended/);
    assert.equal(launches, 0); assert.equal(agent.ready, false);
  } finally { f.cleanup(); }
});
