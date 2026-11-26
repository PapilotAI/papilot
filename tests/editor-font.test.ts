import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EDITOR_FONT_SIZE, EDITOR_FONT_SIZES, parseEditorFontSize, stepEditorFontSize } from '../src/web/editor-font.ts';

test('saved editor font sizes fall back to the default unless supported', () => {
  for (const value of [null, '', 'large', '9', '12.5', '30']) assert.equal(parseEditorFontSize(value), DEFAULT_EDITOR_FONT_SIZE);
  for (const size of EDITOR_FONT_SIZES) assert.equal(parseEditorFontSize(String(size)), size);
});

test('editor font size steps through the supported sizes and stops at the ends', () => {
  assert.equal(stepEditorFontSize(12, 'in'), 13);
  assert.equal(stepEditorFontSize(16, 'in'), 18);
  assert.equal(stepEditorFontSize(18, 'out'), 16);
  assert.equal(stepEditorFontSize(10, 'out'), 10);
  assert.equal(stepEditorFontSize(24, 'in'), 24);
  assert.equal(stepEditorFontSize(20, 'reset'), DEFAULT_EDITOR_FONT_SIZE);
});
