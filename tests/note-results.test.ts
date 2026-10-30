import test from 'node:test';
import assert from 'node:assert/strict';
import { matchNoteChanges, taskNoteResults, type NoteRound } from '../src/server/note-results.ts';
import { noteAnchor, reviewNotesInstructions } from '../src/notes.ts';
import type { NoteSummary, Run, Task, TimelineItem } from '../src/shared.ts';
import type { ReviewClient } from '../src/server/review.ts';

const note: NoteSummary = { id: 'n1', where: 'Page 2 · main.tex lines 10–12', quote: 'The original technical sentence.', comment: 'Shorten it.', anchor: { sources: [{ file: 'main.tex', lines: [10, 12] }] } };
const detail: NoteRound = {
  round: 1,
  units: [
    { id: 'c1', file: 'main.tex', old_start: 10, old_end: 11, old_text: note.quote, new_text: 'A shorter sentence.' },
    { id: 'c2', file: 'main.tex', old_start: 12, old_end: 14, old_text: 'A second sentence.', new_text: 'Another.' },
    { id: 'c3', file: 'other.tex', old_start: 10, old_end: 11, old_text: note.quote, new_text: 'A different paper section.' },
    { id: 'c4', file: 'main.tex', old_start: 40, old_end: 42, old_text: 'Unrelated content.', new_text: 'Revised unrelated content.' },
  ],
  sections: [{ blocks: [{ kind: 'context' }, { kind: 'change', units: ['c1'], before: [{ text: [{ text: note.quote }] }] }, { kind: 'change', units: ['c2'] }] }],
  loose: [{ kind: 'change', units: ['c3'] }, { kind: 'change', units: ['c4'] }],
};

test('source anchors link every overlapping change in viewer order, with actual review decisions', () => {
  assert.deepEqual(matchNoteChanges(note, detail, { c1: 'accepted', c2: 'rejected' }), [
    { round: 1, stop: 0, units: ['c1'], state: 'accepted', match: 'source' },
    { round: 1, stop: 1, units: ['c2'], state: 'rejected', match: 'source' },
  ]);
  assert.deepEqual(matchNoteChanges({ ...note, quote: '', anchor: { sources: [{ file: 'main.tex', lines: [80, 90] }] } }, detail, {}), []);
});

test('older locations are recovered and review quotes survive shifted source lines', () => {
  assert.deepEqual(noteAnchor({ where: 'Round 1 · PDF page 2 · Before · Change 2 · a file.tex:26–43, 50; b.tex:2 · p. 2', quote: '', comment: '' }), { round: 1, sources: [{ file: 'a file.tex', lines: [26, 43] }, { file: 'a file.tex', lines: [50, 50] }, { file: 'b.tex', lines: [2, 2] }] });
  const review = { ...note, anchor: { round: 1, sources: [{ file: 'main.tex', lines: [35, 36] as [number, number] }] } };
  const links = matchNoteChanges(review, { ...detail, round: 2 }, {});
  assert.equal(links.length, 1); assert.equal(links[0].stop, 0); assert.equal(links[0].match, 'quote');
  assert.deepEqual(matchNoteChanges({ ...review, quote: 'x' }, detail, {}), [], 'short common text is not enough evidence');
  assert.deepEqual(matchNoteChanges({ ...review, quote: 'No such text appears in the changes.' }, detail, {}), []);
});

test('a title word links to its definition even when SyncTeX points at maketitle', () => {
  const title: NoteSummary = { where: 'Page 1 · main.tex line 10', quote: 'Manuscripts', comment: 'Change this word.' };
  const round: NoteRound = { round: 1, units: [{ id: 'c1', file: 'main.tex', old_start: 4, old_end: 4, old_text: '\\title{Papilot for LaTeX Manuscripts}', new_text: '\\title{Papilot for LaTeX Papers}' }], sections: [], loose: [{ kind: 'change', units: ['c1'] }] };
  assert.equal(matchNoteChanges(title, round, {})[0]?.match, 'quote');
  const ambiguous = { ...round, units: [...round.units, { ...round.units[0], id: 'c2' }], loose: [...round.loose, { kind: 'change', units: ['c2'] }] };
  assert.deepEqual(matchNoteChanges({ ...title, quote: 'LaTeX' }, ambiguous, {}), [], 'a short repeated word is not enough to select a change');
});

test('note links stay with the published run, never the queued follow-up or latest unrelated round', async () => {
  const task = { id: 'task', name: 'p-task', status: 'reviewing', review: { round: 3 } } as Task;
  const run = { id: 'run1', taskId: task.id, reviewRound: 1, status: 'completed' } as Run;
  const items: TimelineItem[] = [
    { id: run.id, taskId: task.id, type: 'user', text: '', meta: { notes: [note] }, createdAt: 1 },
    { id: 'queued', taskId: task.id, type: 'user', text: '', meta: { notes: [note] }, createdAt: 2 },
    { id: 'unchanged', taskId: task.id, type: 'user', text: '', meta: { notes: [note] }, createdAt: 3 },
  ];
  const routes: string[] = [];
  const client = { get: async (route: string) => { routes.push(route); return route.includes('/rounds/') ? detail : { decisions: { c1: 'accepted', c2: 'pending' } }; } } as unknown as ReviewClient;
  const results = await taskNoteResults(task, items, [run, { ...run, id: 'queued', reviewRound: 0, status: 'queued' }, { ...run, id: 'unchanged', reviewRound: null }], client);
  assert.deepEqual(results.map(result => [result.round, result.state]), [[1, 'matched'], [null, 'waiting'], [null, 'unmatched']]);
  assert.deepEqual(routes.sort(), ['/api/tasks/p-task/rounds/1', '/api/tasks/p-task/state?round=1']);
  const unpublished = await taskNoteResults(task, [items[1]], [{ ...run, id: 'queued', reviewRound: 0 }], client);
  assert.equal(unpublished[0].state, 'waiting', 'a finished run awaiting a successful build cannot use an older round');
  const legacy = { ...items[0], id: 'old', text: reviewNotesInstructions([{ where: 'Page 2 · main.tex lines 10–12', quote: note.quote, comment: note.comment }]), meta: undefined };
  const old = await taskNoteResults({ ...task, review: { ...task.review!, round: 1 } }, [legacy], [], client);
  assert.equal(old[0].state, 'matched');
  await assert.rejects(taskNoteResults(task, [items[0]], [run], { get: async () => ({}) } as unknown as ReviewClient), /could not be loaded/, 'missing review data is not reported as an unmatched note');
});
