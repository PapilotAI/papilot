import test from 'node:test';
import assert from 'node:assert/strict';
import { readNotesInstructions, reviewNotesInstructions } from '../src/notes.ts';
import { GROUP_COLORS, noteGroups } from '../src/note-groups.ts';
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

test('color groups survive message recovery with empty individual comments and a shared instruction', () => {
  const notes = [
    { group: 'yellow' as const, where: 'Round 2 · PDF page 1 · Before · main.tex:10', quote: 'First passage', comment: '' },
    { group: 'yellow' as const, where: 'Round 2 · PDF page 2 · Unchanged text', quote: 'Second passage', comment: '' },
  ];
  const prompt = reviewNotesInstructions(notes, 'Explain the yellow passages.');
  assert.deepEqual(readNotesInstructions(prompt), notes);
  assert.match(prompt, /Overall request: Explain the yellow passages\./);
  assert.match(prompt, /Never infer an editing action from a color/);
});

test('legacy blue annotations remain grouped with yellow without losing their text or position', () => {
  const recovered = readNotesInstructions('Revise the manuscript according to these notes the author marked on the compiled PDF.\n\n1. Round 2 · PDF page 1 · Color group: Blue\n   PDF text: "Saved passage"\n   Note: Keep the citation.')!;
  assert.deepEqual(recovered, [{ group: 'blue', where: 'Round 2 · PDF page 1', quote: 'Saved passage', comment: 'Keep the citation.' }]);
  const newer = { group: 'yellow' as const, where: 'Page 2', quote: 'New passage', comment: '' };
  const [group] = noteGroups([...recovered, newer]);
  assert.equal(group.group, 'yellow');
  assert.deepEqual(group.entries, [{ note: recovered[0], index: 0 }, { note: newer, index: 1 }]);
  assert.equal(GROUP_COLORS[recovered[0].group!], GROUP_COLORS.yellow);
  const prompt = reviewNotesInstructions(recovered, 'Explain the yellow passages.');
  assert.match(prompt, /Color group: Yellow/);
  assert.doesNotMatch(prompt, /Color group: Blue/);
  assert.deepEqual(readNotesInstructions(prompt), [{ ...recovered[0], group: 'yellow' }]);
});
