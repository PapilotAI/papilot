import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AntigravityAgent } from '../src/server/agents.ts';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';
import { taskFinished, type Task } from '../src/shared.ts';
import type { ReviewClient } from '../src/server/review.ts';
import { errorMessages } from '../src/web/locales/index.ts';

const target = 'C:\\Users\\Author\\AppData\\Roaming\\Papilot\\environment.json';
const step = (step_index: number, step_type: string, more: Record<string, unknown> = {}) => ({ event: 'step_update', step_update: { step_index, step_type, state: 'DONE', ...more } });
// Replays the NDJSON lines once agy has read the prompt.
function fakeAgy(lines: unknown[]) {
  const runs: { args: string[] }[] = [];
  const launch = (_command: string, args: string[]) => {
    runs.push({ args });
    const child: any = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
    child.stdin.resume();
    child.stdin.on('end', () => {
      for (const line of lines) child.stdout.write(JSON.stringify(line) + '\n');
      child.stdout.end(); setImmediate(() => child.emit('close', 0));
    });
    return child;
  };
  return { runs, launch: launch as any };
}

// agy 1.5.9 really emitted SUCCESS, an empty response and a DONE read_file
// after soft-denying ReadFile. A DONE agent_response without text preceded it.
for (const scenario of ['empty-reply', 'progress-only', 'unfinished-reply', 'blank-reply', 'partial-edits', 'no-steps', 'finished-reply', 'cli-error'] as const) {
  test(`Antigravity permission denial keeps the task actionable: ${scenario}`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-agy-denial-'));
    const lines: any[] = [{ event: 'init', conversation_id: 'denied-conversation' }, step(0, 'user_input')];
    if (scenario !== 'no-steps') {
      lines.push(step(1, 'agent_response', scenario === 'progress-only' ? { text_delta: 'Reading the glossary first.' } : {}));
      if (scenario === 'partial-edits') lines.push(step(2, 'tool', { tool_name: 'write_file', tool_info: { parameters: { Path: path.join(dir, 'main.tex') } } }));
      for (const state of ['ACTIVE', 'DONE']) lines.push(step(3, 'tool', { state, tool_name: 'read_file', tool_info: { parameters: { Path: target } } }));
    }
    if (scenario === 'unfinished-reply') lines.push(step(4, 'agent_response', { state: 'ACTIVE', text_delta: 'I still need to' }));
    if (scenario === 'blank-reply') lines.push(step(4, 'agent_response', { text_delta: '  ' }));
    if (scenario === 'finished-reply') lines.push(step(4, 'agent_response', { text_delta: 'The abstract describes collaborative editing.' }));
    lines.push({ event: 'result', result: { status: scenario === 'cli-error' ? 'ERROR' : 'SUCCESS', response: scenario === 'progress-only' ? 'Reading the glossary first.' : '',
      ...(scenario === 'cli-error' ? { error: 'Quota exceeded' } : {}), denied_actions: [{ action: 'read_file', display_name: 'ReadFile' }] } });
    const fake = fakeAgy(lines);
    const agent = new AntigravityAgent('unused-agy', path.join(dir, 'conversations.json'), fake.launch);
    agent.ready = true;
    const store = new Store(':memory:');
    const reviewCalls: string[] = [];
    const summary = { state: 'reviewing', round: null, counts: { accepted: 0, rejected: 0, commented: 0, pending: 0 } };
    const review: ReviewClient = { url: 'http://unused', token: 'test',
      async get(route: string) { return (route.includes('/feedback') ? { feedback: [] } : route.includes('/jobs/') ? { status: 'done', outcome: 'empty', changes: 0 } : summary) as any; },
      async post(route: string) { reviewCalls.push(route); return { job: 'empty-review' } as any; },
    };
    const workspace = new Workspace(store, undefined, async () => review, { antigravity: agent });
    const task: Task = { id: 'denied-task', projectId: 'paper', agent: 'antigravity', name: 'p-denied', title: 'Translate abstract', instructions: 'Translate the abstract into Chinese.', worktree: dir,
      threadId: null, turnId: null, model: null, permissions: 'workspace', status: 'reviewing', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
    try {
      store.saveProject({ id: task.projectId, name: 'Paper', path: dir, createdAt: 1 }); store.saveTask(task);
      workspace.runtimes.antigravity.authenticated = true;
      const run = await workspace.enqueue(task.id, '改为中文', 'denied-request', false);
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const saved = store.task(task.id);
        if (saved.status === 'failed' || (saved.review?.job?.status === 'done' && !workspace.busyForUpdate)) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const saved = store.task(task.id), items = store.items(task.id), completed = scenario === 'finished-reply';
      assert.equal(saved.status, completed ? 'reviewing' : 'failed');
      assert.equal(store.runs().find(value => value.id === run.id)?.status, completed ? 'completed' : 'failed');
      assert.equal(taskFinished(saved), completed, 'A blocked turn must not appear completed or offer archiving');
      assert.equal(reviewCalls.some(route => route.endsWith('/publish')), completed, 'Do not turn a terminal denial into an empty review');
      assert.ok(items.some(item => item.status === 'declined' && item.text.includes('ReadFile')));
      if (completed) assert.equal(saved.error, null);
      else if (scenario === 'cli-error') assert.equal(saved.error, 'Quota exceeded');
      else {
        assert.match(saved.error || '', /Always proceed \(approves all tools\)/);
        for (const [language, translations] of Object.entries(errorMessages)) if (language !== 'en') assert.ok(Object.hasOwn(translations, saved.error!), `The blocked-task error is translated for ${language}`);
        if (['empty-reply', 'progress-only', 'partial-edits'].includes(scenario)) assert.ok(items.some(item => item.type === 'tool' && item.status === 'declined' && item.text.includes(target)), 'Keep the denied operation and its target in the timeline');
      }
      if (scenario === 'empty-reply') assert.equal(items.filter(item => item.type === 'assistant').length, 0);
      assert.equal(fake.runs.length, 1, 'Never retry automatically after a permission denial');
      assert.equal(saved.permissions, 'workspace', 'A denial must not silently broaden permissions');
    } finally { workspace.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('A read-only Antigravity helper stopped by a permission denial gets no advice to change permissions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-agy-denial-'));
  const fake = fakeAgy([{ event: 'init', conversation_id: 'helper-conversation' }, step(0, 'user_input'), step(1, 'tool', { tool_name: 'read_file', tool_info: { parameters: { Path: target } } }),
    { event: 'result', result: { status: 'SUCCESS', response: '', denied_actions: [{ action: 'read_file', display_name: 'ReadFile' }] } }]);
  const agent = new AntigravityAgent('unused-agy', path.join(dir, 'conversations.json'), fake.launch);
  agent.ready = true;
  try {
    const ended = new Promise<any>(resolve => agent.on('notification', message => { if (message.method === 'turn/completed') resolve(message.params.turn); }));
    const { thread } = await agent.request('thread/start', { cwd: dir, sandbox: 'read-only', developerInstructions: 'Write a short title.' });
    await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Title this task.' }], cwd: dir });
    const turn = await ended;
    assert.deepEqual(fake.runs[0].args.slice(4, 6), ['--mode', 'plan']);
    assert.deepEqual([turn.status, turn.error.message], ['failed', 'Antigravity stopped because an operation needed permission.']);
    for (const [language, translations] of Object.entries(errorMessages)) if (language !== 'en') assert.ok(Object.hasOwn(translations, turn.error.message), `The helper error is translated for ${language}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
