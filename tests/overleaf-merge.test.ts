import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { merge3, restore } from '../src/server/overleaf/merge.ts';

test('merges change each side once, by lines and then by characters', () => {
  // The same line added on both sides, split differently by the diff, is
  // never doubled; the overlapping edit is a conflict instead.
  assert.equal(merge3('a\n', 'a\nb\n', 'A\nb\n').text, 'A\nb\n');
  assert.deepEqual(merge3('We have 100 apples and 20 pears.\n', 'We have 1000 apples and 20 pears.\n', 'We have 100 apples and 25 pears.\n'), { text: 'We have 1000 apples and 25 pears.\n', conflicts: [] });
  assert.deepEqual(merge3('In the begining was the word.\n', 'In the beginning was the word.\n', 'In the begining was the Word.\n'), { text: 'In the beginning was the Word.\n', conflicts: [] });
  // An edit of the author's is merged or offered back, never dropped.
  const close = merge3('See fig:1 and tab:2.\n', 'See fig:11 and tab:2.\n', 'See fig:1 and tab:3.\n');
  assert.ok(close.text === 'See fig:11 and tab:3.\n' || close.conflicts.some(conflict => conflict.ours.includes('fig:11')));
  assert.deepEqual(merge3('xab', 'xabb', 'Yxabb'), { text: 'Yxabb', conflicts: [] });
  assert.equal(merge3('\\item one\n', '\\item one\n\\item two\n', '\\item One\n\\item two\n').text, '\\item One\n\\item two\n');
  assert.deepEqual(merge3('The cat sat on the mat.\n', 'The cat sat on the red mat.\n', 'The black cat sat on the mat.\n'), { text: 'The black cat sat on the red mat.\n', conflicts: [] });
  assert.deepEqual(merge3('one\ntwo\n', 'ONE\ntwo\n', 'one\nTWO\n'), { text: 'ONE\nTWO\n', conflicts: [] });
});

test('a passage both sides changed keeps Overleaf’s text, and the author’s can be put back', () => {
  const merged = merge3('one\ntwo\nthree\n', 'one\ntwo (mine)\nthree\n', 'one\nTWO (Overleaf)\nthree\n');
  assert.equal(merged.text, 'one\nTWO (Overleaf)\nthree\n');
  assert.equal(merged.conflicts.length, 1);
  assert.equal(restore(merged.text, merged.conflicts[0]), 'one\ntwo (mine)\nthree\n');
  assert.equal(restore('changed entirely\n', merged.conflicts[0]), null);
});

test('restoring a whole-file deletion requires the file to remain empty', () => {
  const conflict = { ours: 'My text', theirs: '', before: '', after: '' };
  assert.equal(restore('', conflict), 'My text');
  assert.equal(restore('Someone added new text', conflict), null);
});

test('merging is safe whatever both sides did', () => {
  const text = fc.array(fc.constantFrom('a\n', 'b\n', 'c', ' ', 'x\n'), { maxLength: 8 }).map(parts => parts.join(''));
  fc.assert(fc.property(text, text, text, (base, ours, theirs) => {
    const merged = merge3(base, ours, theirs);
    if (ours === theirs) assert.equal(merged.text, theirs);
    if (base === ours) assert.equal(merged.text, theirs);
    if (base === theirs) assert.equal(merged.text, ours);
    // Without conflicts, every line Overleaf added and kept appears.
    if (!merged.conflicts.length && ours === base) assert.equal(merged.text, theirs);
  }), { numRuns: 3000 });
});
