import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadRequest, canStreamUpdates } from '../src/web/refresh.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('simultaneous refresh triggers share one request and one update', async () => {
  const request = new ReadRequest<string>();
  const result = deferred<string>();
  let calls = 0;
  const values: string[] = [];
  const load = async () => { calls++; return result.promise; };
  const first = request.run('state', load, value => values.push(value));
  const second = request.run('state', load, value => values.push(value));
  assert.equal(first, second);
  result.resolve('latest');
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(values, ['latest']);
});

test('switching tasks aborts the old read and ignores late results', async () => {
  const request = new ReadRequest<string>();
  const oldResult = deferred<string>();
  const values: string[] = [];
  let oldSignal!: AbortSignal;
  const first = request.run('task-one', signal => { oldSignal = signal; return oldResult.promise; }, value => values.push(value));
  await Promise.resolve();
  const second = request.run('task-two', async () => 'new task', value => values.push(value));
  assert.equal(oldSignal.aborted, true);
  await second;
  oldResult.resolve('obsolete task');
  await first;
  assert.deepEqual(values, ['new task']);
});

test('cancellation suppresses stale failures and subsequent reads still succeed', async () => {
  const request = new ReadRequest<string>();
  let updates = 0;
  const pending = request.run('state', async signal => {
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    return 'stale';
  }, () => { updates++; });
  await Promise.resolve();
  request.cancel();
  await pending;
  await request.run('state', async () => 'fresh', () => { updates++; });
  assert.equal(updates, 1);
});

test('failed reads release their slot so reconnect can retry', async () => {
  const request = new ReadRequest<string>();
  await assert.rejects(request.run('state', async () => { throw new Error('offline'); }, () => {}), /offline/);
  let value = '';
  await request.run('state', async () => 'reconnected', next => { value = next; });
  assert.equal(value, 'reconnected');
});

test('only multiplexed HTTP connections use persistent event streams', () => {
  for (const protocol of ['', 'http/1.0', 'http/1.1', 'unknown']) assert.equal(canStreamUpdates(protocol), false);
  for (const protocol of ['h2', 'h3']) assert.equal(canStreamUpdates(protocol), true);
});
