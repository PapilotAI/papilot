import test from 'node:test';
import assert from 'node:assert/strict';
import type { PendingRequest, Snapshot, Task } from '../src/shared.ts';
import { taskAlerts } from '../src/web/notifications.ts';

const base: Task = { id: 'a', projectId: 'p', name: 'p-a', title: 'Tighten the abstract', instructions: '', worktree: '/tmp/a', threadId: null, turnId: null, model: null, status: 'running', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
const snapshot = (tasks: Partial<Task>[], requests: PendingRequest[] = []): Snapshot => ({ projects: [], tasks: tasks.map(task => ({ ...base, ...task })), requests, runtime: { connected: true, authenticated: true, account: null, error: null, models: [] }, version: 'test' });
const request = (method: string): PendingRequest => ({ id: 'r1', taskId: 'a', method, params: {}, createdAt: 1 });

test('a new question or approval request asks for the author', () => {
  assert.deepEqual(taskAlerts(snapshot([{}]), snapshot([{ status: 'waiting_input', agent: 'claude' }], [request('item/tool/requestUserInput')])), [{ taskId: 'a', title: 'Claude needs your input', body: 'Tighten the abstract' }]);
  assert.equal(taskAlerts(snapshot([{}]), snapshot([{ status: 'waiting_input' }], [request('item/commandExecution/requestApproval')]))[0].title, 'Codex is waiting for your approval');
  // A request already seen is not announced again.
  assert.deepEqual(taskAlerts(snapshot([{ status: 'waiting_input' }], [request('item/tool/requestUserInput')]), snapshot([{ status: 'waiting_input' }], [request('item/tool/requestUserInput')])), []);
});

test('a finished build announces the review, or that the agent finished without changes', () => {
  const ready = taskAlerts(snapshot([{ status: 'building' }]), snapshot([{ status: 'reviewing', review: { state: 'reviewing', round: 1, counts: { pending: 3 } } }]));
  assert.equal(ready[0].title, 'Review ready · 3 changes to decide');
  const one = taskAlerts(snapshot([{ status: 'building' }]), snapshot([{ status: 'reviewing', review: { state: 'reviewing', round: 1, counts: { pending: 1 } } }]));
  assert.equal(one[0].title, 'Review ready · 1 change to decide');
  const none = taskAlerts(snapshot([{ status: 'building' }]), snapshot([{ status: 'reviewing', review: { state: 'done', round: 1, counts: { pending: 0 } } }]));
  assert.equal(none[0].title, 'Codex finished');
});

test('errors are announced once; pausing and unchanged or new tasks are not', () => {
  const failed = taskAlerts(snapshot([{}]), snapshot([{ status: 'failed', error: '\nlatexmk exited with code 12\nmore' }]));
  assert.deepEqual(failed, [{ taskId: 'a', title: 'A task needs attention', body: 'Tighten the abstract\nlatexmk exited with code 12' }]);
  assert.deepEqual(taskAlerts(snapshot([{ status: 'failed' }]), snapshot([{ status: 'failed' }])), []);
  assert.deepEqual(taskAlerts(snapshot([{}]), snapshot([{ status: 'interrupted' }])), []);
  assert.equal(taskAlerts(snapshot([{}]), snapshot([{ status: 'interrupted', error: 'Codex disconnected.' }])).length, 1);
  assert.deepEqual(taskAlerts(snapshot([]), snapshot([{ status: 'failed' }])), []);
});
