import test from 'node:test';
import assert from 'node:assert/strict';
import { readNotesInstructions, reviewNotesInstructions } from '../src/notes.ts';
import { mergeLines } from '../src/web/note-geometry.ts';

test('glyph rectangles merge overlapping spans without highlighting across lines', () => {
  assert.deepEqual(mergeLines([[0.1, 0.2, 0.2, 0.23], [0.1, 0.2, 0.2, 0.23], [0.2, 0.2, 0.3, 0.23], [0.1, 0.3, 0.2, 0.33]]), [[0.1, 0.2, 0.3, 0.23], [0.1, 0.3, 0.2, 0.33]]);
});

test('review annotations carry round and side context and render back as notes', () => {
  const notes = [
    { where: 'Round 2 · PDF page ix · Before · Change 2 · main/ack.tex:26–43', quote: 'Thank you “both”.', comment: 'Keep the names.\nMake this warmer.' },
    { where: 'Round 1 · PDF page 4 · Unchanged text · Region in displayed strip: 10%, 20%, 30%, 40%', quote: '', comment: 'Enlarge this figure.' },
  ];
  const prompt = reviewNotesInstructions(notes);
  assert.deepEqual(readNotesInstructions(prompt), notes);
  assert.match(prompt, /Preserve accepted changes and do not reintroduce rejected edits unless a note explicitly asks/);
});
