import test from 'node:test';
import assert from 'node:assert/strict';
import { NotePreviewCache } from '../src/web/note-preview-cache.ts';

test('background preparation and repeated selection share one comparison load', async () => {
  const cache = new NotePreviewCache<object>();
  let loads = 0, finish!: (value: object) => void;
  const detail = { revision: 'candidate' };
  const load = () => { loads++; return new Promise<object>(resolve => { finish = resolve; }); };
  const prepared = cache.read('task:round:option', load);
  const selected = cache.read('task:round:option', load);
  await Promise.resolve();
  assert.equal(loads, 1); assert.equal(cache.peek('task:round:option'), undefined);
  finish(detail);
  assert.equal(await prepared, detail); assert.equal(await selected, detail);
  assert.equal(cache.peek('task:round:option'), detail);
  assert.equal(await cache.read('task:round:option', load), detail); assert.equal(loads, 1);
});
test('a failed background comparison can retry and different review rounds stay separate', async () => {
  const cache = new NotePreviewCache<string>();
  await assert.rejects(cache.read('round1', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await cache.read('round1', async () => 'old'), 'old');
  assert.equal(await cache.read('round2', async () => 'new'), 'new');
  assert.equal(cache.peek('round1'), 'old'); assert.equal(cache.peek('round2'), 'new');
});

test('selection promotes an in-flight prefetch once without repeating its load or decode', async () => {
  const cache = new NotePreviewCache<string>();
  let finish!: (value: string) => void, loads = 0, promotions = 0;
  const load = () => { loads++; return new Promise<string>(resolve => { finish = resolve; }); };
  const pending = cache.read('option', load, () => { promotions++; });
  await Promise.resolve();
  assert.equal(cache.read('option', load), pending);
  assert.equal(cache.read('option', load), pending);
  assert.equal(promotions, 1); assert.equal(loads, 1);
  finish('decoded'); await pending;
  await cache.read('option', load);
  assert.equal(promotions, 1);
});

test('cache pressure retains pending comparisons and evicts only completed least-recent results', async () => {
  const cache = new NotePreviewCache<string>(1);
  let finish!: (value: string) => void;
  const first = cache.read('pending', () => new Promise<string>(resolve => { finish = resolve; }));
  await cache.read('old', async () => 'old');
  await cache.read('recent', async () => 'recent');
  assert.equal(cache.peek('old'), undefined);
  assert.equal(cache.peek('recent'), 'recent');
  assert.equal(cache.read('pending', async () => { throw new Error('Duplicate load'); }), first);
  finish('first'); await first;
  assert.equal(cache.peek('pending'), 'first');
  assert.equal(cache.peek('recent'), undefined);
});

test('prefetches across notes leave connections free and a selected queued option starts immediately', async () => {
  const cache = new NotePreviewCache<string>();
  const requests: { key: string; background: boolean }[] = [], releases = new Map<string, () => void>();
  let promotions = 0;
  const load = (key: string) => (background: boolean) => {
    requests.push({ key, background });
    return new Promise<string>(resolve => releases.set(key, () => resolve(key)));
  };
  const warming = ['note1:a', 'note1:b', 'note2:a'].map(key => cache.read(key, load(key), () => { promotions++; }));
  await Promise.resolve();
  assert.deepEqual(requests, [{ key: 'note1:a', background: true }]);
  const selected = cache.read('note2:a', load('note2:a'));
  assert.equal(selected, warming[2]);
  await Promise.resolve();
  assert.deepEqual(requests, [{ key: 'note1:a', background: true }, { key: 'note2:a', background: false }]);
  assert.equal(promotions, 0, 'Queued options need no separate promotion request');
  releases.get('note2:a')!(); await selected;
  assert.equal(requests.length, 2, 'Finishing a foreground option does not start a second background fetch');
  releases.get('note1:a')!(); await warming[0];
  assert.deepEqual(requests[2], { key: 'note1:b', background: true });
  releases.get('note1:b')!(); await Promise.all(warming);
});

test('a failed prefetch releases its slot for the next note', async () => {
  const cache = new NotePreviewCache<string>();
  const failed = cache.read('failed', async () => { throw new Error('broken PDF'); }, () => {});
  const next = cache.read('next', async () => 'ready', () => {});
  await assert.rejects(failed, /broken PDF/);
  assert.equal(await next, 'ready');
});
