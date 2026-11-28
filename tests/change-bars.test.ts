import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, Text } from '@codemirror/state';
import { barChanges, changeBars, setBase } from '../src/web/source-codemirror.ts';

const text = (value: string) => Text.of(value.split('\n'));

test('change bars mark the lines that differ from the last commit as the author types', () => {
  const base = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight';
  let state = EditorState.create({ doc: base.replace('two', 'TWO'), extensions: changeBars(text(base)) });
  assert.deepEqual(barChanges(state), [{ kind: 'modified', from: 1, to: 2 }]);
  state = state.update({ changes: { from: state.doc.length, insert: '\nnine' } }).state;
  const marks = barChanges(state);
  assert.deepEqual(marks[0], { kind: 'modified', from: 1, to: 2 }, 'the earlier change keeps its bar');
  assert.equal(marks.length, 2, 'the new line has a bar of its own');
});

test('a save moves the bars\' base without replacing them, so anything reading them before the save still can', () => {
  const before = EditorState.create({ doc: 'one\nTWO\nthree', extensions: changeBars(text('one\ntwo\nthree')) });
  // Replacing the bars on a save once left a measure, asked for just before,
  // reading a field the new state no longer had.
  const after = before.update({ effects: setBase.of(text('one\nTWO\nthree')) }).state;
  assert.deepEqual(barChanges(after), [], 'nothing differs from the new base');
  const typed = after.update({ changes: { from: 0, insert: 'ONE ' } }).state;
  assert.deepEqual(barChanges(typed), [{ kind: 'modified', from: 0, to: 1 }], 'typing after a save compares with the saved text');
});
