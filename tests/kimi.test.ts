import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KimiAgent } from '../src/server/kimi.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const configOptions = [
  { id: 'model', category: 'model', currentValue: 'kimi/k3', options: [{ value: 'kimi/k3', name: 'K3' }, { value: 'kimi/k2', name: 'K2' }] },
  { id: 'thinking', category: 'thought_level', currentValue: 'high', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
];
function fixture(onPrompt: (message: any, rpc: ReturnType<typeof peer>) => void = (m, rpc) => { rpc.update(m.params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OK' } }); rpc.reply(m.id, { stopReason: 'end_turn' }); }) {
  const calls: any[] = [], peers: ReturnType<typeof peer>[] = [];
  const launch = (_binary: string, args: string[], options: { cwd: string }) => {
    assert.deepEqual(args, ['acp']);
    assert.equal(options.cwd, os.homedir(), 'Kimi must not run from the probe folder that is removed');
    const rpc = peer(message => {
      calls.push(message);
      if (!message.method) return;
      const { id, method, params } = message;
      if (method === 'initialize') rpc.reply(id, { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, sessionCapabilities: { delete: {} } } });
      else if (method === 'session/new' || method === 'session/load') {
        if (method === 'session/load') rpc.update(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Historical reply' } });
        rpc.reply(id, { sessionId: params.sessionId || `session-${++serial}`, configOptions, modes: { availableModes: [{ id: 'default' }] } });
      } else if (method === 'session/set_config_option') rpc.reply(id, { configOptions });
      else if (method === 'session/prompt') onPrompt(message, rpc);
      else if (id !== undefined) rpc.reply(id, {});
    });
    peers.push(rpc); return rpc.child;
  };
  let serial = 0;
  const agent = new KimiAgent('fake-kimi', launch as any);
  const notifications: any[] = [], requests: any[] = [];
  agent.on('notification', message => notifications.push(message));
  agent.on('request', message => requests.push(message));
  return { agent, calls, peers, notifications, requests };
}
function peer(receive: (message: any) => void) {
  const child: any = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { setImmediate(() => child.emit('close', 0)); return true; };
  let buffer = '';
  child.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) { const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); setImmediate(() => receive(message)); }
  });
  const send = (message: any) => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  return { child, send, reply: (id: number, result: any) => send({ id, result }), update: (sessionId: string, update: any) => send({ method: 'session/update', params: { sessionId, update } }) };
}
function completion(agent: KimiAgent) {
  return new Promise<any>(resolve => {
    const listener = (message: any) => { if (message.method === 'turn/completed') { agent.off('notification', listener); resolve(message.params.turn); } };
    agent.on('notification', listener);
  });
}
async function thread(agent: KimiAgent) { return (await agent.request('thread/start', { cwd: '/paper', model: 'kimi/k3', developerInstructions: 'Only edit this paper.' })).thread.id as string; }
async function run(agent: KimiAgent, id: string, extra: any = {}) {
  const done = completion(agent);
  await agent.request('turn/start', { threadId: id, input: [{ type: 'text', text: 'Fix it.' }], ...extra });
  return done;
}

test('Kimi discovers configuration without a prompt and streams text, tools and native images', { timeout: 5000 }, async () => {
  const f = fixture((m, rpc) => {
    const id = m.params.sessionId;
    rpc.update(id, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Checking ' } });
    rpc.update(id, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'now.' } });
    rpc.update(id, { sessionUpdate: 'tool_call', toolCallId: 'shell', kind: 'execute', title: 'Run check', rawInput: { command: 'latexmk main.tex' }, status: 'in_progress' });
    rpc.update(id, { sessionUpdate: 'tool_call_update', toolCallId: 'shell', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'Build passed' } }] });
    rpc.update(id, { sessionUpdate: 'tool_call', toolCallId: 'edit', kind: 'edit', status: 'completed', content: [{ type: 'diff', path: '/paper/main.tex', oldText: 'a', newText: 'b' }] });
    rpc.update(id, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } });
    rpc.reply(m.id, { stopReason: 'end_turn' });
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-kimi-test-'));
  const file = path.join(dir, 'image.png');
  fs.writeFileSync(file, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
  try {
    await Promise.all([f.agent.start(), f.agent.start()]);
    assert.equal(f.peers.length, 1);
    assert.equal(f.calls.some(call => call.method === 'session/prompt'), false);
    assert.ok(f.calls.some(call => call.method === 'session/delete'));
    assert.equal((await f.agent.request('account/read')).requiresOpenaiAuth, false);
    const models = (await f.agent.request('model/list')).data;
    assert.deepEqual(models.map((m: any) => [m.model, m.isDefault]), [['kimi/k3', true], ['kimi/k2', false]]);
    assert.deepEqual(models[0].supportedReasoningEfforts, [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }]);
    const id = await thread(f.agent);
    const result = await run(f.agent, id, { effort: 'low', clientUserMessageId: 'user-1', input: [{ type: 'text', text: 'Fix it.' }, { type: 'localImage', path: file }] });
    assert.equal(result.status, 'completed');
    const prompt = f.calls.find(call => call.method === 'session/prompt').params;
    assert.equal(prompt.prompt[0].text.trim(), 'Only edit this paper.\n\n---\n\nFix it.');
    assert.equal(prompt.prompt[1].mimeType, 'image/png');
    assert.equal(prompt.prompt[1].data, fs.readFileSync(file).toString('base64'));
    assert.ok(f.calls.some(call => call.method === 'session/set_mode' && call.params.modeId === 'default'));
    assert.ok(f.calls.some(call => call.method === 'session/set_config_option' && call.params.value === 'low'));
    const items = f.notifications.filter(n => n.method === 'item/completed').map(n => n.params.item);
    assert.deepEqual(items.map(item => item.type), ['agentMessage', 'commandExecution', 'fileChange', 'agentMessage']);
    assert.equal(items[0].text, 'Checking now.');
    assert.equal(items[1].command, 'latexmk main.tex');
    assert.equal(items[1].aggregatedOutput, 'Build passed');
    assert.deepEqual(items[2].changes, [{ path: '/paper/main.tex' }]);
    assert.equal((await f.agent.request('thread/read', { threadId: id })).thread.turns[0].items[0].clientId, 'user-1');
    await run(f.agent, id);
    assert.equal(f.calls.filter(call => call.method === 'session/prompt')[1].params.prompt[0].text, 'Fix it.');
  } finally { f.agent.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Kimi resumes persisted IDs after restart and ignores replayed history', { timeout: 5000 }, async () => {
  const f = fixture();
  try {
    await f.agent.start(); const id = await thread(f.agent); await run(f.agent, id);
    f.agent.close(); await f.agent.start();
    await f.agent.request('thread/resume', { threadId: id, cwd: '/paper', developerInstructions: 'Only edit this paper.' });
    await run(f.agent, id);
    assert.ok(f.calls.some(call => call.method === 'session/load' && call.params.sessionId === id));
    assert.equal(f.notifications.some(n => n.params.delta === 'Historical reply'), false);
    assert.equal(f.calls.filter(call => call.method === 'session/prompt').at(-1).params.prompt[0].text, 'Fix it.');
    // Workspace can still consider an idle thread loaded after the process exits.
    f.agent.close(); await f.agent.start(); await run(f.agent, id);
    assert.equal(f.calls.filter(call => call.method === 'session/load').length, 2);
    assert.equal(f.notifications.some(n => n.params.delta === 'Historical reply'), false);
  } finally { f.agent.close(); }
});

test('Kimi forwards approvals and only selects one-time grants or denials', { timeout: 5000 }, async () => {
  for (const decision of ['accept', 'decline', 'cancel']) {
    const f = fixture((m, rpc) => {
      rpc.send({ id: 'permission', method: 'session/request_permission', params: { sessionId: m.params.sessionId, toolCall: { title: 'Edit main.tex', kind: 'edit' }, options: [{ optionId: 'always', kind: 'allow_always' }, { optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] } });
    });
    try {
      await f.agent.start(); const id = await thread(f.agent);
      const done = completion(f.agent);
      const requested = new Promise<void>(resolve => f.agent.once('request', m => { f.agent.respond(m.id, { decision }); resolve(); }));
      await f.agent.request('turn/start', { threadId: id, input: [{ type: 'text', text: 'Edit.' }] });
      await requested; await tick();
      const reply = f.calls.find(call => call.id === 'permission' && !call.method);
      assert.deepEqual(reply.result.outcome, decision === 'cancel' ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: decision === 'accept' ? 'yes' : 'no' });
      assert.equal(f.requests[0].method, 'item/fileChange/requestApproval');
      f.peers[0].reply(f.calls.find(call => call.method === 'session/prompt').id, { stopReason: 'cancelled' });
      assert.equal((await done).status, 'interrupted');
    } finally { f.agent.close(); }
  }
});

test('pause cancels pending approvals; immediate pause never sends a prompt', { timeout: 5000 }, async () => {
  const f = fixture((m, rpc) => rpc.send({ id: 'permission', method: 'session/request_permission', params: { sessionId: m.params.sessionId, toolCall: { title: 'Run command', kind: 'execute' }, options: [] } }));
  try {
    await f.agent.start(); const id = await thread(f.agent);
    let done = completion(f.agent);
    const { turn } = await f.agent.request('turn/start', { threadId: id });
    await f.agent.request('turn/interrupt', { turnId: turn.id });
    assert.equal((await done).status, 'interrupted'); await tick();
    assert.equal(f.calls.some(call => call.method === 'session/prompt'), false);
    done = completion(f.agent);
    const requested = new Promise<void>(resolve => f.agent.once('request', () => resolve()));
    const next = await f.agent.request('turn/start', { threadId: id }); await requested;
    await f.agent.request('turn/interrupt', { turnId: next.turn.id }); await tick();
    assert.deepEqual(f.calls.find(call => call.method === 'session/cancel').params, { sessionId: id });
    assert.deepEqual(f.calls.find(call => call.id === 'permission' && !call.method).result, { outcome: { outcome: 'cancelled' } });
    assert.ok(f.notifications.some(n => n.method === 'serverRequest/resolved'));
    f.peers[0].reply(f.calls.find(call => call.method === 'session/prompt').id, { stopReason: 'cancelled' });
    assert.equal((await done).status, 'interrupted');
  } finally { f.agent.close(); }
});

test('Kimi reports RPC errors, empty turns, unsupported efforts and process loss as failures', { timeout: 5000 }, async () => {
  for (const behavior of ['error', 'empty', 'exit', 'effort']) {
    const f = fixture((m, rpc) => {
      if (behavior === 'error') rpc.send({ id: m.id, error: { code: -32000, message: 'Authentication required' } });
      else if (behavior === 'exit') rpc.child.emit('close', 1);
      else rpc.reply(m.id, { stopReason: 'end_turn' });
    });
    try {
      await f.agent.start(); const id = await thread(f.agent);
      const result = await run(f.agent, id, behavior === 'effort' ? { effort: 'max' } : {});
      assert.equal(result.status, 'failed');
      assert.match(result.error.message, behavior === 'error' ? /Authentication/ : behavior === 'empty' ? /no response/ : behavior === 'effort' ? /does not support/ : /exited/);
      if (behavior === 'effort') assert.equal(f.calls.some(call => call.method === 'session/prompt'), false);
      if (behavior === 'exit') assert.equal(f.agent.ready, false);
    } finally { f.agent.close(); }
  }
  const missing = new KimiAgent('/nonexistent/papilot-kimi');
  await assert.rejects(missing.start(), /PAPILOT_KIMI_BIN/); missing.close();
});

test('concurrent Kimi sessions keep text and permissions attached to their own turns', { timeout: 5000 }, async () => {
  const prompts: any[] = [];
  const f = fixture(m => { prompts.push(m); });
  try {
    await f.agent.start();
    const first = await thread(f.agent), second = await thread(f.agent);
    const a = await f.agent.request('turn/start', { threadId: first });
    const b = await f.agent.request('turn/start', { threadId: second });
    for (let i = 0; i < 20 && prompts.length < 2; i++) await tick();
    assert.equal(prompts.length, 2);
    const rpc = f.peers[0];
    rpc.update(second, { sessionUpdate: 'tool_call', toolCallId: 'write', kind: 'edit', title: 'Write', rawInput: { file_path: '/paper/main.tex' } });
    rpc.send({ id: 'permission', method: 'session/request_permission', params: { sessionId: second, toolCall: { toolCallId: 'write', title: 'Write' }, options: [{ optionId: 'yes', kind: 'allow_once' }] } });
    assert.equal(f.requests[0].params.threadId, second);
    assert.equal(f.requests[0].params.turnId, b.turn.id);
    assert.equal(f.requests[0].method, 'item/fileChange/requestApproval');
    assert.equal(f.requests[0].params.command, 'Edit /paper/main.tex');
    f.agent.respond(f.requests[0].id, { decision: 'accept' });
    await f.agent.request('turn/interrupt', { turnId: a.turn.id });
    const paused = completion(f.agent);
    rpc.reply(prompts.find(p => p.params.sessionId === first).id, { stopReason: 'cancelled' });
    assert.equal((await paused).status, 'interrupted');
    const done = completion(f.agent);
    rpc.update(second, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Second session done' } });
    rpc.reply(prompts.find(p => p.params.sessionId === second).id, { stopReason: 'end_turn' });
    assert.equal((await done).status, 'completed');
    assert.ok(f.notifications.some(n => n.method === 'item/completed' && n.params.threadId === second && n.params.item.text === 'Second session done'));
  } finally { f.agent.close(); }
});

test('Kimi permission choices ask the user instead of silently selecting the first answer', { timeout: 5000 }, async () => {
  const f = fixture((m, rpc) => rpc.send({ id: 'question', method: 'session/request_permission', params: { sessionId: m.params.sessionId, toolCall: { title: 'Which section?' }, options: [{ optionId: 'intro', name: 'Introduction', kind: 'allow_once' }, { optionId: 'model', name: 'Model', kind: 'allow_once' }] } }));
  try {
    await f.agent.start(); const id = await thread(f.agent);
    const requested = new Promise<void>(resolve => f.agent.once('request', m => {
      assert.equal(m.method, 'item/tool/requestUserInput');
      assert.deepEqual(m.params.questions[0].options, [{ label: 'Introduction' }, { label: 'Model' }]);
      assert.equal(m.params.questions[0].isOther, false, 'ACP cannot carry a typed answer');
      f.agent.respond(m.id, { answers: { choice: { answers: ['Model'] } } }); resolve();
    }));
    const done = completion(f.agent);
    await f.agent.request('turn/start', { threadId: id }); await requested; await tick();
    assert.deepEqual(f.calls.find(call => call.id === 'question' && !call.method).result.outcome, { outcome: 'selected', optionId: 'model' });
    f.peers[0].reply(f.calls.find(call => call.method === 'session/prompt').id, { stopReason: 'cancelled' });
    await done;
  } finally { f.agent.close(); }
});
