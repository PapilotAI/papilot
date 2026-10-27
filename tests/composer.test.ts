import test from 'node:test';
import assert from 'node:assert/strict';
import { ComposerDraft, reviewInstructions, sendsMessage, taskTitle } from '../src/web/composer.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  let id = 0;
  const create = () => new ComposerDraft('draft', storage, () => String(++id));
  return { draft: create(), create, storage };
}

test('sending review feedback preserves the unsent draft and uses a separate request ID', async () => {
  const { draft, storage } = setup();
  draft.edit('My next revision');
  const messages: { text: string; requestKey: string }[] = [];
  await draft.submit('feedback', async message => { messages.push(message); });
  assert.equal(messages[0].text, reviewInstructions);
  assert.equal(draft.text, 'My next revision');
  assert.equal(storage.getItem('draft'), 'My next revision');
  await draft.submit('draft', async message => { messages.push(message); });
  assert.notEqual(messages[0].requestKey, messages[1].requestKey);
  assert.equal(draft.text, '');
  assert.equal(storage.getItem('draft'), null);
});

test('typing during submission preserves new text and blocks duplicate sends', async () => {
  const { draft, storage } = setup();
  draft.edit('First instruction');
  const gate = deferred();
  let calls = 0;
  const pending = draft.submit('draft', async message => {
    calls++;
    assert.equal(message.text, 'First instruction');
    await gate.promise;
  });
  assert.equal(draft.sending, true);
  assert.equal(draft.getSnapshot().sendingSource, 'draft');
  draft.edit('Next instruction');
  assert.equal(await draft.submit('draft', async () => { calls++; }), false);
  gate.resolve();
  await pending;
  assert.equal(calls, 1);
  assert.equal(draft.sending, false);
  assert.equal(draft.getSnapshot().sendingSource, null);
  assert.equal(draft.text, 'Next instruction');
  assert.equal(storage.getItem('draft'), 'Next instruction');
});

test('a failed submission retains its text and reuses its request ID on retry', async () => {
  const { draft, storage } = setup();
  draft.edit('Keep my text');
  let failedKey = '';
  await assert.rejects(draft.submit('draft', async message => { failedKey = message.requestKey; throw new Error('Connection lost'); }), /Connection lost/);
  assert.equal(draft.sending, false);
  assert.equal(draft.text, 'Keep my text');
  assert.equal(storage.getItem('draft'), 'Keep my text');
  await draft.submit('draft', async message => { assert.equal(message.requestKey, failedKey); });
  assert.equal(draft.text, '');
});

test('a late response cannot erase a draft saved after reopening the task', async () => {
  const { draft, create, storage } = setup();
  draft.edit('Previous instruction');
  const gate = deferred();
  const pending = draft.submit('draft', () => gate.promise);
  const reopened = create();
  reopened.edit('New instruction after switching tasks');
  gate.resolve();
  await pending;
  assert.equal(storage.getItem('draft'), 'New instruction after switching tasks');
});

test('an edited draft receives a new request ID after a failed request', async () => {
  const { draft } = setup();
  draft.edit('First instruction');
  let firstKey = '';
  await assert.rejects(draft.submit('draft', async message => { firstKey = message.requestKey; throw new Error('Offline'); }));
  draft.edit('Revised instruction');
  await draft.submit('draft', async message => { assert.notEqual(message.requestKey, firstKey); });
});

test('new task titles use the first line of the prompt', () => {
  assert.equal(taskTitle('\n  Shorten the introduction.\nKeep the citations.'), 'Shorten the introduction');
  assert.equal(taskTitle('## Tighten   the abstract'), 'Tighten the abstract');
  assert.equal(taskTitle('   '), 'Untitled task');
  const long = taskTitle('Rewrite the related work section so that it compares our method with every baseline in the evaluation and explains the differences');
  assert.ok(long.length <= 81 && long.endsWith('…') && !long.includes('  '));
  assert.equal(long, 'Rewrite the related work section so that it compares our method with every…');
});

test('Enter sends from a hardware keyboard but never while composing text', () => {
  const key = { key: 'Enter', shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, isComposing: false };
  assert.equal(sendsMessage(key, false), true);
  assert.equal(sendsMessage({ ...key, shiftKey: true }, false), false);
  assert.equal(sendsMessage(key, true), false);
  assert.equal(sendsMessage({ ...key, metaKey: true }, true), true);
  assert.equal(sendsMessage({ ...key, ctrlKey: true }, false), true);
  assert.equal(sendsMessage({ ...key, isComposing: true }, false), false);
  assert.equal(sendsMessage({ ...key, keyCode: 229 }, false), false);
  assert.equal(sendsMessage({ ...key, key: 'a' }, false), false);
});
