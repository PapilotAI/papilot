import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { noteOptionsSummary, readPreparedNoteOptions, preparedOptionEdits, savePreparedNoteOptions, prepareNoteComparisons } from '../src/server/prepared-note-options.ts';
import { noteOptionContext, noteOptionsKey } from '../src/server/note-options.ts';
import { Store } from '../src/server/store.ts';
import type { PreparedNoteOptions, Run, Task } from '../src/shared.ts';
import type { NoteRound } from '../src/server/note-results.ts';
import type { ReviewClient } from '../src/server/review.ts';

const before = 'The model is fast and the estimate is stable.\n';
const after = 'The model is efficient and the estimate is robust.\n';
const units: NoteRound['units'] = [
  { id: 'c001', file: 'main.tex', old_start: 1, old_end: 1, old_text: 'fast', new_text: 'efficient', text_ops: [['replace', 13, 17, 13, 22]], old_context: { text: before, start: 0 } },
  { id: 'c002', file: 'main.tex', old_start: 1, old_end: 1, old_text: 'stable', new_text: 'robust', text_ops: [['replace', 38, 44, 43, 49]], old_context: { text: before, start: 0 } },
];
const prepared: PreparedNoteOptions = { note: 1, current: { label: 'Efficient', reason: 'Emphasize efficiency.' }, options: [
  { label: 'Concise', reason: 'Use a familiar shorter term.', edits: [{ file: 'main.tex', find: after, replace: after.replace('efficient', 'quick') }] },
  { label: 'Specific', reason: 'Specify computational efficiency.', edits: [{ file: 'main.tex', find: after, replace: after.replace('efficient', 'computationally efficient') }] },
] };
const response = (notes: unknown = [prepared]) => 'Revised the speed description.\n\n```papilot-note-options\n' + JSON.stringify({ notes }) + '\n```';

for (const change of ['accept', 'reject another change', 'new round'] as const) test(`background previews discard stale results after ${change}`, async () => {
  const store = new Store(':memory:');
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const rendering = new Promise<void>(resolve => { started = resolve; });
  const task = { id: 'task', name: 'task', status: 'reviewing', review: { round: 1 } } as Task;
  const run: Run = { id: 'run', taskId: task.id, requestKey: 'run', prompt: '', status: 'completed', createdAt: 1, finishedAt: 2, reviewRound: 1, noteOptions: [prepared] };
  const key = noteOptionsKey(task.id, 'run:0', 1);
  const choices = { round: 1, key: 'run:0', selected: 'current', options: ['efficient', 'quick', 'concise'].map((text, i) => ({
    id: i ? text : 'current', label: text, reason: 'Clarify speed.', edits: [{ unit: 'c001', text }],
  })) };
  const state = { latest: 1, closed: false, decisions: { c001: 'pending', c002: 'pending' } };
  const requests: unknown[] = [];
  const client = {
    url: `http://preview-test/${encodeURIComponent(change)}`,
    get: async (route: string) => route.includes('/rounds/') ? { round: 1, before: 'before', after: 'after', units, sections: [], loose: [{ kind: 'change', units: ['c001', 'c002'] }] } : structuredClone(state),
    post: async (_route: string, body: unknown) => { requests.push(body); started(); await gate; throw new Error('Obsolete preview failed'); },
  } as unknown as ReviewClient;
  let work: Promise<void> | undefined;
  try {
    store.saveRun(run);
    store.saveItem({ id: run.id, taskId: task.id, type: 'user', text: '', createdAt: 1, meta: { notes: [{ where: 'main.tex line 1', quote: 'fast', comment: 'Clarify speed.' }] } });
    store.savePreference(key, choices);
    work = prepareNoteComparisons(store, task, client);
    await rendering;
    if (change === 'accept') state.decisions.c001 = 'accepted';
    else if (change === 'new round') state.latest = 2;
    else state.decisions.c002 = 'rejected';
    release();
    await work;
    assert.equal(requests.length, 1, 'Obsolete comparisons stop before the next candidate');
    assert.deepEqual((requests[0] as { rejected: string[] }).rejected, []);
    assert.deepEqual(store.preference(key), choices, 'A stale failure cannot lock choices behind Retry');
  } finally { release(); await work; store.close(); }
});

test('internal fences preserve normal Markdown and prose on either side', () => {
  const example = '````text\r\n```papilot-note-options\r\n{"notes":[]}\r\n```\r\n````';
  const unrelated = '```papilot-note-options-example\n{"sample":true}\n```';
  const intro = ['Discuss `papilot-note-options` here.', example, unrelated].join('\n\n');
  assert.equal(noteOptionsSummary(intro), intro);
  assert.deepEqual(readPreparedNoteOptions(intro, 1), []);
  const choices = { ...prepared, options: [{ ...prepared.options[0], edits: [{ file: 'main.tex', find: 'Before', replace: '```' }] }] };
  const reply = intro + '\n\n   ~~~papilot-note-options title=Internal\r\n' + JSON.stringify({ notes: [choices] }) + '\r\n   ~~~\n\nThe rest is unchanged.';
  assert.equal(noteOptionsSummary(reply), intro + '\n\n\nThe rest is unchanged.');
  assert.deepEqual(readPreparedNoteOptions(reply, 1), [choices]);
  assert.equal(noteOptionsSummary('Still visible\n```papilot-note-options\n{"notes":'), 'Still visible');
  assert.equal(noteOptionsSummary('Ordinary marker sample\n```papilot-note-'), 'Ordinary marker sample\n```papilot-note-');
});

test('unmarked choice envelopes stay out of streamed and saved replies', () => {
  const object = { notes: [prepared] }, raw = JSON.stringify(object, null, 2);
  const intro = 'Revised the opening.';
  for (const block of [raw, '```json\n' + raw + '\n```', '~~~JSON\n' + raw + '\n~~~', '```\n' + raw + '\n```']) {
    for (let end = 1; end <= block.length; end++)
      assert.equal(noteOptionsSummary(intro + '\n\n' + block.slice(0, end), true), intro, 'stream prefix ' + end);
    assert.equal(noteOptionsSummary(intro + '\n\n' + block), intro);
    assert.deepEqual(readPreparedNoteOptions(block, 1), [prepared]);
    assert.match(noteOptionsSummary(intro + '\n' + block + '\n\n```tex\nX\n```'), /^Revised the opening\.\n+```tex/);
  }
  for (const ordinary of [{ notes: [] }, { notes: ['private'] }, { records: [object] }, [1, object], { ...object, example: true }]) {
    const json = JSON.stringify(ordinary, null, 2);
    assert.equal(noteOptionsSummary(json), json);
    assert.equal(noteOptionsSummary('```json\n' + json + '\n```'), '```json\n' + json + '\n```');
  }
  assert.equal(noteOptionsSummary(raw.slice(0, raw.indexOf('"edits"') + 7)), '');
  assert.equal(noteOptionsSummary('````text\n' + raw + '\n````'), '````text\n' + raw + '\n````');
});

test('prepared choice counts are guidance, with a bounded response size', () => {
  for (const count of [0, 1, 2, 3, 5, 6]) {
    const entry = { ...prepared, options: Array.from({ length: count }, (_, index) => ({ ...prepared.options[0], label: `Choice ${index}` })) };
    assert.deepEqual(readPreparedNoteOptions(response([entry]), 1), [entry]);
  }
  assert.deepEqual(readPreparedNoteOptions(response([{ ...prepared, options: Array(7).fill(prepared.options[0]) }]), 1), []);
});

test('background preparation covers each annotation before its next alternative', async () => {
  const store = new Store(':memory:');
  const task = { id: 'task', name: 'task', status: 'reviewing', review: { round: 1 } } as Task;
  const run = { id: 'run', taskId: task.id, requestKey: 'run', prompt: '', status: 'completed', createdAt: 1, reviewRound: 1, noteOptions: [prepared] } as Run;
  const requests: string[] = [];
  const client = {
    url: 'http://round-robin-preview-test',
    get: async (route: string) => route.includes('/rounds/') ? { round: 1, before: 'before', after: 'after', units, sections: [], loose: [{ kind: 'change', units: ['c001', 'c002'] }] }
      : { latest: 1, closed: false, decisions: { c001: 'pending', c002: 'pending' } },
    post: async (_route: string, body: any) => { assert.equal(body.background, true); requests.push(body.id); },
  } as unknown as ReviewClient;
  try {
    store.saveRun(run);
    store.saveItem({ id: run.id, taskId: task.id, type: 'user', text: '', createdAt: 1, meta: { notes: [
      { where: 'main.tex line 1', quote: 'fast', comment: 'Clarify speed.' },
      { where: 'main.tex line 1', quote: 'stable', comment: 'Clarify stability.' },
    ] } });
    for (const [i, unit] of units.entries()) store.savePreference(noteOptionsKey(task.id, `run:${i}`, 1), {
      round: 1, key: `run:${i}`, selected: 'current', options: [unit.new_text, 'first', 'second'].map((text, j) => ({
        id: j ? `${i}-${text}` : 'current', label: text, reason: 'Clarify.', edits: [{ unit: unit.id, text }],
      })),
    });
    await prepareNoteComparisons(store, task, client);
    assert.deepEqual(requests, ['0-first', '1-first', '0-second', '1-second']);
  } finally { store.close(); }
});

test('prepared choices are extracted once and streaming preserves the conversational summary', () => {
  assert.deepEqual(readPreparedNoteOptions(response(), 1), [prepared]);
  assert.deepEqual(readPreparedNoteOptions(response(), 0), []);
  assert.deepEqual(readPreparedNoteOptions('```papilot-note-options\n{"notes":', 1), []);
  assert.deepEqual(readPreparedNoteOptions(response([{ ...prepared, note: 2 }]), 1), []);
  assert.deepEqual(readPreparedNoteOptions(response([{ ...prepared, current: { label: 'Current', reason: '' } }]), 1), []);
  const text = response();
  for (let n = text.indexOf('```'); n <= text.length; n++) assert.equal(noteOptionsSummary(text.slice(0, n), true).trimEnd(), 'Revised the speed description.');
  assert.equal(noteOptionsSummary('A normal response.\nAnother paragraph.'), 'A normal response.\nAnother paragraph.');
});

test('source context disambiguates prepared choices but cannot change another note', () => {
  const files = new Map([['main.tex', after]]);
  assert.deepEqual(preparedOptionEdits(prepared.options[0], [units[0]], files), [{ unit: 'c001', text: 'quick' }]);
  assert.deepEqual(preparedOptionEdits(prepared.options[1], [units[0]], files), [{ unit: 'c001', text: 'computationally efficient' }]);
  assert.throws(() => preparedOptionEdits({ ...prepared.options[0], edits: [{ file: 'main.tex', find: after, replace: after.replace('robust', 'reliable') }] }, [units[0]], files), /outside this note/);
  assert.throws(() => preparedOptionEdits(prepared.options[0], [units[0]], new Map([['main.tex', after + after]])), /ambiguous/);
  assert.throws(() => preparedOptionEdits({ ...prepared.options[0], edits: [...prepared.options[0].edits, ...prepared.options[0].edits] }, [units[0]], files), /overlapping/);
  assert.throws(() => preparedOptionEdits({ ...prepared.options[0], edits: [{ file: '../other.tex', find: after, replace: 'other' }] }, [units[0]], files), /unrelated/);
});

test('reordered wording preserves the unchanged source between this note’s units', () => {
  const source = 'The model has a short runtime and yields stable estimates.\nAnother claim remains unchanged.\n';
  const fragments = ['has a short runtime and yields', ' estimates'];
  const linked: NoteRound['units'] = fragments.map((text, i) => ({
    id: `c${i}`, file: 'main.tex', old_start: 1, old_end: 1, old_text: '', new_text: text,
    text_ops: [['replace', 0, 0, source.indexOf(text), source.indexOf(text) + text.length]],
  }));
  const option = { label: 'Emphasize estimates', reason: 'Use estimates as the subject.', edits: [{
    file: 'main.tex', find: 'and yields stable estimates.', replace: 'and the resulting estimates are stable.',
  }] };
  const files = new Map([['main.tex', source]]);
  const edits = preparedOptionEdits(option, linked, files);
  assert.deepEqual(edits, [{ unit: 'c0', text: 'has a short runtime and the resulting estimates are' }, { unit: 'c1', text: '' }]);
  const applied = [...linked].reverse().reduce((text, unit) => {
    const [, , , start, end] = unit.text_ops![0];
    return text.slice(0, start) + edits.find(edit => edit.unit === unit.id)!.text + text.slice(end);
  }, source);
  assert.equal(applied, source.replace(option.edits[0].find, option.edits[0].replace));
  assert.throws(() => preparedOptionEdits(option, [linked[0]], files), /outside this note/);
  assert.throws(() => preparedOptionEdits({ ...option, edits: [{ file: 'main.tex', find: source, replace: applied.replace('Another claim', 'A different claim') }] }, linked, files), /outside this note/);
  assert.throws(() => preparedOptionEdits({ ...option, edits: [{ ...option.edits[0], replace: 'and the resulting estimates are stable and stable.' }] }, linked, files), /ambiguous/);
});

test('published notes expose choices from the editing turn without any agent request or source mutation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-prepared-options-')), store = new Store(':memory:');
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@localhost');
    fs.writeFileSync(path.join(root, 'main.tex'), after); git('add', '.'); git('commit', '-qm', 'Proposal');
    const commit = git('rev-parse', 'HEAD');
    const task = { id: 'task', name: 'task', worktree: root, status: 'reviewing', review: { round: 1 } } as Task;
    const run: Run = { id: 'run', taskId: 'task', requestKey: 'request', prompt: '', status: 'completed', createdAt: 1, finishedAt: 2, reviewRound: 1, noteOptions: [prepared] };
    store.saveRun(run);
    store.saveItem({ id: 'run', taskId: 'task', type: 'user', text: 'Keep the facts.', createdAt: 1, meta: { notes: [{ where: 'main.tex line 1', quote: 'The model is fast', comment: 'Clarify speed.' }] } });
    const detail: NoteRound = { round: 1, before: commit, after: commit, units, sections: [], loose: [{ kind: 'change', units: ['c001', 'c002'] }] };
    const client = { get: async (route: string) => route.includes('/rounds/') ? detail : { latest: 1, closed: false, decisions: { c001: 'pending', c002: 'pending' } }, post: () => { throw new Error('Must never request new work'); } } as unknown as ReviewClient;
    await savePreparedNoteOptions(store, task, run, client);
    const first = (await noteOptionContext(store, task, 'run:0', client)).options;
    assert.deepEqual(first.options.map(option => option.edits), ['efficient', 'quick', 'computationally efficient'].map(text => [{ unit: 'c001', text }]));
    assert.deepEqual(first.options.map(option => option.reason), ['Emphasize efficiency.', 'Use a familiar shorter term.', 'Specify computational efficiency.']);
    await savePreparedNoteOptions(store, task, run, client);
    assert.deepEqual((await noteOptionContext(store, task, 'run:0', client)).options, first, 'Recovery preserves choice identities');
    assert.equal(store.items('task')[0].text, 'Keep the facts.');
    assert.equal(fs.readFileSync(path.join(root, 'main.tex'), 'utf8'), after);
    assert.equal(git('status', '--porcelain'), '');
    const rendered: string[] = [], progress: number[][] = [];
    const renderer = { ...client, post: async (route: string, body: any) => {
      assert.equal(route, '/api/tasks/task/source/options/preview');
      assert.equal(body.round, 1);
      rendered.push(body.edits[0].text);
      if (body.edits[0].text === 'quick') throw new Error('Invalid optional LaTeX');
      return {};
    } } as ReviewClient;
    await prepareNoteComparisons(store, task, renderer, (...values) => progress.push(values));
    assert.deepEqual(rendered, ['quick', 'computationally efficient']);
    assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]]);
    assert.equal((await noteOptionContext(store, task, 'run:0', client)).options.options[1].previewError, 'Invalid optional LaTeX', 'A failed optional render is recorded without losing the main review or other choices');
    assert.equal(git('status', '--porcelain'), '');
    const partial: Run = { ...run, id: 'partial', requestKey: 'partial', noteOptions: [{ ...prepared, options: [prepared.options[0], {
      ...prepared.options[1], edits: [{ file: 'main.tex', find: after, replace: after.replace('robust', 'reliable') }],
    }] }] };
    store.saveRun(partial);
    store.saveItem({ ...store.items('task')[0], id: 'partial', createdAt: 3 });
    await savePreparedNoteOptions(store, task, partial, client);
    const remaining = (await noteOptionContext(store, task, 'partial:0', client)).options;
    assert.deepEqual(remaining.options.map(option => option.label), ['Efficient', 'Concise'], 'An out-of-scope choice does not discard the valid alternative');
    assert.equal(remaining.options[0].reason, prepared.current.reason);
    assert.equal(git('status', '--porcelain'), '');
  } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
