import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { applyHistory, applyText, historyOp, sanitizeText, textHunks, textOp, trackedText, transformHistoryX, transformTextX, visibleText, type TrackedText } from '../src/server/overleaf/ot.ts';

// Short texts from a small alphabet make edits collide often.
const text = fc.string({ unit: fc.constantFrom('a', 'b', 'c', '\n', ' ', 'é'), maxLength: 30 });

test('text operations turn one text into another', () => {
  fc.assert(fc.property(text, text, (a, b) => { assert.equal(applyText(a, textOp(a, b)), b); }), { numRuns: 2000 });
  assert.deepEqual(textOp('the cat sat', 'the cot sat'), [{ p: 5, d: 'a' }, { p: 5, i: 'o' }]);
  assert.deepEqual(textOp('', 'new'), [{ p: 0, i: 'new' }]);
  assert.deepEqual(textOp('same', 'same'), []);
});

test('concurrent text operations converge, the incoming edit first where inserts meet', () => {
  fc.assert(fc.property(text, text, text, (base, mine, theirs) => {
    const a = textOp(base, mine), b = textOp(base, theirs);
    const [a2, b2] = transformTextX(a, b);
    assert.equal(applyText(applyText(base, b), a2), applyText(applyText(base, a), b2));
  }), { numRuns: 3000 });
  // The server transforms an incoming edit as the left side.
  const [left, right] = transformTextX([{ p: 1, i: 'X' }], [{ p: 1, i: 'Y' }]);
  assert.deepEqual(left, [{ p: 1, i: 'X' }]);
  assert.deepEqual(right, [{ p: 2, i: 'Y' }]);
  // A delete inside text the other side deleted shrinks to nothing.
  assert.deepEqual(transformTextX([{ p: 2, d: 'cd' }], [{ p: 1, d: 'bcde' }]), [[], [{ p: 1, d: 'be' }]]);
  // A comment grows with text typed inside it and needs no text change.
  assert.deepEqual(transformTextX([{ p: 0, c: 'abc', t: 'x' }], [{ p: 1, i: 'Z' }])[0], [{ p: 0, c: 'aZbc', t: 'x' }]);
});

test('character hunks keep surrogate pairs together and find small edits in long lines', () => {
  assert.deepEqual(textHunks('a😀b', 'a😃b'), [{ at: 1, remove: '😀', insert: '😃' }]);
  const line = 'word '.repeat(400);
  assert.deepEqual(textHunks(line + '\nend', line.replace(/^word/, 'ward') + '\nend'), [{ at: 1, remove: 'o', insert: 'a' }]);
});

const tracked = fc.tuple(text, fc.array(fc.boolean(), { maxLength: 30 })).map(([content, flags]): TrackedText => ({ content, deleted: Uint8Array.from(content.split('').map((_, i) => flags[i] ? 1 : 0)) }));

test('history operations edit the visible text and leave tracked deletions in place', () => {
  fc.assert(fc.property(tracked, text, (file, after) => {
    const op = historyOp(file, after);
    if (!op) { assert.equal(visibleText(file), after); return; }
    const next = applyHistory(file, op);
    assert.equal(visibleText(next), after);
  }), { numRuns: 2000 });
  const file = trackedText({ content: 'one two three', trackedChanges: [{ range: { pos: 4, length: 4 }, tracking: { type: 'delete' } }] });
  assert.equal(visibleText(file), 'one three');
  // Editing next to hidden text keeps the coauthor's suggestion.
  assert.deepEqual(historyOp(file, 'one 3'), { textOperation: [8, '3', -5] });
  assert.equal(visibleText(applyHistory(file, { textOperation: [8, '3', -5] })), 'one 3');
});

test('concurrent history operations converge with tracked changes', () => {
  const tracking = { type: 'delete' as const, userId: '0123456789abcdef01234567', ts: '2026-11-18T00:00:00.000Z' };
  fc.assert(fc.property(tracked, text, text, fc.nat(), fc.nat(), (file, mine, theirs, from, length) => {
    const a = historyOp(file, mine) || { textOperation: file.content.length ? [file.content.length] : [] };
    let b = historyOp(file, theirs) || { textOperation: file.content.length ? [file.content.length] : [] };
    // Sometimes the coauthor marks a deletion instead of removing text.
    if (file.content.length && from % 3 === 0) {
      const start = from % file.content.length, n = 1 + length % (file.content.length - start);
      b = { textOperation: [start, { r: n, tracking }, file.content.length - start - n].filter(scan => scan !== 0) };
    }
    const [a2, b2] = transformHistoryX(a, b);
    const left = applyHistory(applyHistory(file, b), a2), right = applyHistory(applyHistory(file, a), b2);
    assert.equal(left.content, right.content);
    assert.deepEqual([...left.deleted], [...right.deleted]);
  }), { numRuns: 3000 });
  // The first operation's insert goes first where both insert.
  assert.deepEqual(transformHistoryX({ textOperation: [1, 'X', 1] }, { textOperation: [1, 'Y', 1] }), [{ textOperation: [1, 'X', 2] }, { textOperation: [2, 'Y', 1] }]);
  // Comment operations do not move text.
  assert.deepEqual(transformHistoryX({ textOperation: ['a'] }, { commentId: 'x', ranges: [] }), [{ textOperation: ['a'] }, { commentId: 'x', ranges: [] }]);
});

test('text is normalized as Overleaf stores it', () => {
  assert.equal(sanitizeText('a\r\nb\rc😀'), 'a\nb\nc\uFFFD\uFFFD');
});
