import test from 'node:test';
import assert from 'node:assert/strict';
import { readNotesInstructions, reviewNotesInstructions } from '../src/notes.ts';
import { mergeLines, nearestGlyph, wordAround } from '../src/web/note-geometry.ts';

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

test('a long press picks the nearest word on the touched line', () => {
  const glyphs = [...'ab cd', ...'ef'].map((text, i) => ({ text, line: i < 5 ? 0 : 1 }));
  const boxes = glyphs.map(({ text, line }, i) => text === ' ' ? null : [(i % 5) * 10, line * 20, (i % 5) * 10 + 9, line * 20 + 12] as [number, number, number, number]);
  assert.equal(nearestGlyph(boxes, 33, 6), 3);
  // A point between the lines prefers the line it is closer to over a nearer column.
  assert.equal(nearestGlyph(boxes, 40, 15), 4);
  // A space between words picks the nearer neighbour.
  assert.equal(nearestGlyph(boxes, 25, 6), 3);
  assert.equal(nearestGlyph(boxes, 300, 6, 40), -1);
  assert.deepEqual(wordAround(glyphs, 4), [3, 4]);
  assert.deepEqual(wordAround(glyphs, 0), [0, 1]);
  // A word ends with its line, even without a space.
  assert.deepEqual(wordAround(glyphs, 5), [5, 6]);
});
