import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AntigravityAgent, ClaudeAgent, groupModels } from '../src/server/agents.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const events = (agent: EventEmitter) => { const seen: { method: string; params: any }[] = []; agent.on('notification', message => seen.push(message)); return seen; };
const completed = (seen: { method: string; params: any }[]) => new Promise<any>(resolve => { const check = setInterval(() => { const done = seen.find(event => event.method === 'turn/completed'); if (done) { clearInterval(check); resolve(done.params.turn); } }, 2); });

test('agy effort variants are grouped into one model with efforts, and the saved model is the default', () => {
  const listing = 'Fetching available models...\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\ngemini-4-argon-high\tGemini 4 Argon (High)\ngemini-4-argon-low\tGemini 4 Argon (Low)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n';
  assert.deepEqual(groupModels(listing, 'Gemini 4 Argon (High)'), [
    { model: 'gemini-4-argon', displayName: 'Gemini 4 Argon', efforts: ['low', 'medium', 'high'], ids: { medium: 'gemini-4-argon-medium', high: 'gemini-4-argon-high', low: 'gemini-4-argon-low' }, isDefault: true, defaultEffort: 'high' },
    { model: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)', efforts: [], ids: { '': 'claude-sonnet-4-6' }, isDefault: false, defaultEffort: null },
  ]);
});

function fakeAgy(lines: string[][]) {
  const launches: { args: string[]; cwd: string; child: any }[] = [];
  const launch = (_command: string, args: string[], options: { cwd: string }) => {
    const child: any = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = (signal: string) => { child.killed = signal; setImmediate(() => child.emit('close', null, signal)); };
    launches.push({ args, cwd: options.cwd, child });
    const script = lines.shift() || [];
    setImmediate(() => { for (const line of script) child.stdout.write(line + '\n'); if (script.length) { child.stdout.end(); setImmediate(() => child.emit('close', 0)); } });
    return child;
  };
  return { launches, launch };
}

test('Antigravity turns run agy in accept-edits mode, stream into items, and resume their conversation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-agy-'));
  const first = [
    JSON.stringify({ event: 'init', conversation_id: 'conv-1', init: {} }),
    JSON.stringify({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Editing ' } }),
    JSON.stringify({ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'now.' } }),
    JSON.stringify({ event: 'step_update', step_update: { step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'write_file', tool_info: { parameters: { Path: '/work/main.tex' } } } }),
    JSON.stringify({ event: 'step_update', step_update: { step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'write_file', tool_info: { parameters: { Path: '/work/main.tex' } } } }),
    'warning: not JSON',
    JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Editing now.', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } }),
  ];
  const second = [JSON.stringify({ event: 'init', conversation_id: 'conv-1' }), JSON.stringify({ event: 'result', result: { status: 'ERROR', error: 'Quota exceeded' } })];
  const fake = fakeAgy([first, second, []]);
  const agent = new AntigravityAgent('agy', path.join(dir, 'conversations.json'), fake.launch as any);
  (agent as any).catalog = groupModels('gemini-4-argon-low\tGemini 4 Argon (Low)\ngemini-4-argon-high\tGemini 4 Argon (High)\n');
  agent.ready = true;
  try {
    const seen = events(agent);
    const { thread } = await agent.request('thread/start', { cwd: '/work', developerInstructions: 'Only edit the worktree.', model: 'gemini-4-argon' });
    const { turn } = await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Shorten the abstract.' }], cwd: '/work', effort: 'high', clientUserMessageId: 'run-1' });
    assert.equal((await completed(seen)).status, 'completed');
    const args = fake.launches[0].args;
    assert.equal(fake.launches[0].cwd, '/work');
    assert.deepEqual(args.slice(2), ['--output-format', 'stream-json', '--mode', 'accept-edits', '--model', 'gemini-4-argon-high']);
    assert.match(args[1], /^Only edit the worktree\.\n\n---\n\nShorten the abstract\.$/);
    assert.deepEqual(seen.filter(e => e.method === 'item/agentMessage/delta').map(e => e.params.delta), ['Editing ', 'now.']);
    const items = seen.filter(e => e.method === 'item/completed').map(e => e.params.item);
    assert.deepEqual(items.map(item => item.type), ['agentMessage', 'fileChange', 'agentMessage']);
    assert.equal(items[0].text, 'Editing now.');
    assert.deepEqual(items[1].changes, [{ path: '/work/main.tex' }]);
    assert.match(items[2].text, /could not run RunCommand/);
    assert.equal(seen.every(e => e.params.threadId === thread.id), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'conversations.json'), 'utf8')), { [thread.id]: 'conv-1' });
    const read = await agent.request('thread/read', { threadId: thread.id });
    assert.deepEqual(read.thread.turns, [{ id: turn.id, status: 'completed', items: [{ type: 'userMessage', clientId: 'run-1' }] }]);
    // A later turn, even from a fresh adapter after a restart, resumes the same conversation.
    const restarted = new AntigravityAgent('agy', path.join(dir, 'conversations.json'), fake.launch as any);
    restarted.ready = true;
    const again = events(restarted);
    await restarted.request('thread/resume', { threadId: thread.id, cwd: '/work', developerInstructions: 'Only edit the worktree.' });
    await restarted.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Now the introduction.' }], cwd: '/work' });
    const failed = await completed(again);
    assert.deepEqual([failed.status, failed.error.message], ['failed', 'Quota exceeded']);
    assert.deepEqual(fake.launches[1].args.slice(0, 2), ['-p', 'Now the introduction.']);
    assert.deepEqual(fake.launches[1].args.slice(-2), ['--conversation', 'conv-1']);
    // Pausing stops the process and ends the turn as interrupted.
    const paused = events(restarted);
    const { turn: third } = await restarted.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Wait.' }], cwd: '/work' });
    await tick();
    await restarted.request('turn/interrupt', { threadId: thread.id, turnId: third.id });
    assert.equal((await completed(paused)).status, 'interrupted');
    assert.equal(fake.launches[2].child.killed, 'SIGINT');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function fakeClaude(script: (options: any) => AsyncGenerator<any>) {
  const calls: { prompt: unknown; options: any }[] = [];
  const query = ((input: { prompt: unknown; options: any }) => {
    calls.push(input);
    const generator: any = typeof input.prompt === 'string' ? script(input.options) : (async function* () {})();
    generator.accountInfo = async () => ({ email: 'me@example.com', subscriptionType: 'Claude Max' });
    generator.supportedModels = async () => [
      { value: 'default', displayName: 'Default (recommended)', description: '', resolvedModel: 'claude-opus-5-5', supportedEffortLevels: ['low', 'high'] },
      { value: 'opus', displayName: 'Opus 5.5', description: '', resolvedModel: 'claude-opus-5-5', supportedEffortLevels: ['low', 'high'] },
      { value: 'haiku', displayName: 'Haiku 5.5', description: '', resolvedModel: 'claude-haiku-5-5', supportedEffortLevels: ['low'] },
    ];
    generator.close = () => {};
    return generator;
  });
  return { calls, load: async () => query as any };
}

test('Claude turns use the local Claude Code login, resume their session, and report items, approvals and usage', async () => {
  const fake = fakeClaude(async function* (options) {
    yield { type: 'system', subtype: 'init', session_id: options.sessionId || options.resume, effort: 'xhigh' };
    yield { type: 'stream_event', parent_tool_use_id: null, session_id: 's', event: { type: 'message_start', message: { id: 'm1' } } };
    yield { type: 'stream_event', parent_tool_use_id: null, session_id: 's', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking.' } } };
    yield { type: 'assistant', parent_tool_use_id: null, session_id: 's', message: { id: 'm1', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'latexmk main.tex' } }, { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/work/main.tex' } }] } };
    // An unsandboxed command asks for approval; a question asks the user.
    const decision = await options.canUseTool('Bash', { command: 'rm -rf build' }, { signal: new AbortController().signal, title: 'Claude wants to run rm -rf build' });
    const answer = await options.canUseTool('AskUserQuestion', { questions: [{ question: 'Which section?', header: 'Scope', options: [{ label: 'Intro', description: '' }, { label: 'Model', description: '' }] }] }, { signal: new AbortController().signal });
    yield { type: 'user', parent_tool_use_id: null, session_id: 's', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'Output written', is_error: false }, { type: 'tool_result', tool_use_id: 'tool-2', content: [{ type: 'text', text: 'file' }], is_error: false }] } };
    yield { type: 'rate_limit_event', session_id: 's', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.42, resetsAt: 1_800_000_000 } };
    yield { type: 'assistant', parent_tool_use_id: null, session_id: 's', message: { id: 'm2', content: [{ type: 'text', text: `Done: ${decision.behavior}, ${answer.updatedInput.answers['Which section?']}.` }] } };
    yield { type: 'result', subtype: 'success', is_error: false, result: 'Done', session_id: 's' };
  });
  const agent = new ClaudeAgent(fake.load);
  await agent.start();
  assert.deepEqual(await agent.request('account/read'), { account: { email: 'me@example.com', type: 'Claude Max' }, requiresOpenaiAuth: false });
  assert.deepEqual((await agent.request('model/list')).data.map((m: any) => [m.model, m.isDefault, m.supportedReasoningEfforts.length]), [['opus', true, 2], ['haiku', false, 1]]);
  await assert.rejects(agent.request('account/rateLimits/read'), /not reported usage/);
  const seen = events(agent), requests: any[] = [];
  agent.on('request', request => { requests.push(request); setImmediate(() => agent.respond(request.id, request.method === 'item/tool/requestUserInput' ? { answers: { 0: { answers: ['Intro'] } } } : { decision: 'decline' })); });
  const { thread } = await agent.request('thread/start', { cwd: '/work', developerInstructions: 'Only edit the worktree.', model: 'opus' });
  await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Fix the build.' }], cwd: '/work', effort: 'high' });
  assert.equal((await completed(seen)).status, 'completed');
  const options = fake.calls[1].options;
  assert.equal(fake.calls[1].prompt, 'Fix the build.');
  assert.deepEqual([options.cwd, options.model, options.effort, options.sessionId, options.resume, options.permissionMode], ['/work', 'opus', 'high', thread.id, undefined, 'acceptEdits']);
  assert.deepEqual(options.sandbox, { enabled: true, autoAllowBashIfSandboxed: true });
  assert.deepEqual(options.systemPrompt, { type: 'preset', preset: 'claude_code', append: 'Only edit the worktree.' });
  assert.deepEqual(options.settingSources, ['project']);
  assert.deepEqual(requests.map(r => [r.method, r.params.command || r.params.questions?.[0].question]), [['item/commandExecution/requestApproval', 'rm -rf build'], ['item/tool/requestUserInput', 'Which section?']]);
  assert.equal(requests[0].params.reason, 'Claude wants to run rm -rf build');
  const items = seen.filter(e => e.method === 'item/completed').map(e => e.params.item);
  assert.deepEqual(items.map(item => [item.type, item.text || item.command || item.status]), [['agentMessage', 'Checking.'], ['commandExecution', 'latexmk main.tex'], ['toolCall', 'Read /work/main.tex'], ['agentMessage', 'Done: deny, Intro.']]);
  assert.equal(items[1].aggregatedOutput, 'Output written');
  assert.deepEqual(seen.filter(e => e.method === 'item/agentMessage/delta').map(e => [e.params.itemId, e.params.delta]), [['m1:0', 'Checking.']]);
  // Usage comes from the turn's rate limit events; the model's default effort from its init message.
  const usage = await agent.request('account/rateLimits/read');
  assert.deepEqual(usage.rateLimits.primary, { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_800_000_000 });
  assert.equal(usage.rateLimits.planType, 'max');
  assert.equal((await agent.request('model/list')).data[0].defaultReasoningEffort, 'xhigh');
  // The next turn resumes the same Claude session.
  const next = events(agent);
  await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Again.' }], cwd: '/work' });
  await completed(next);
  assert.deepEqual([fake.calls[2].options.resume, fake.calls[2].options.sessionId, fake.calls[2].options.effort], [thread.id, undefined, undefined]);
});

test('pausing a Claude turn aborts it and declines its pending approval', async () => {
  let started = () => {};
  const ready = new Promise<void>(resolve => { started = resolve; });
  const fake = fakeClaude(async function* (options) {
    yield { type: 'system', subtype: 'init', session_id: 's' };
    const signal = options.abortController.signal;
    const decision = options.canUseTool('Bash', { command: 'make' }, { signal, title: 'Run make?' });
    started();
    const result = await decision;
    if (signal.aborted) throw new Error(`aborted after ${result.behavior}`);
    yield { type: 'result', subtype: 'success', is_error: false, result: '', session_id: 's' };
  });
  const agent = new ClaudeAgent(fake.load);
  const seen = events(agent);
  const { thread } = await agent.request('thread/start', { cwd: '/work' });
  const { turn } = await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Build.' }], cwd: '/work' });
  await ready;
  await agent.request('turn/interrupt', { threadId: thread.id, turnId: turn.id });
  assert.equal((await completed(seen)).status, 'interrupted');
  assert.equal(seen.some(e => e.method === 'serverRequest/resolved'), true);
});

test('a refused Claude subscription login explains that Papilot needs an API key', async () => {
  const fake = fakeClaude(async function* () {
    yield { type: 'system', subtype: 'init', session_id: 's' };
    yield { type: 'result', subtype: 'success', is_error: true, result: 'Failed to authenticate. API Error: 403 Request not allowed', session_id: 's' };
  });
  const agent = new ClaudeAgent(fake.load);
  const seen = events(agent);
  const { thread } = await agent.request('thread/start', { cwd: '/work' });
  await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Edit.' }], cwd: '/work' });
  const turn = await completed(seen);
  assert.equal(turn.status, 'failed');
  assert.match(turn.error.message, /subscription login cannot be used through the Claude Agent SDK; give Papilot an Anthropic API key/);
});
