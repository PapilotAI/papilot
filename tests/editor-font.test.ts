import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EDITOR_FONT_SIZE, EDITOR_FONT_SIZES, parseEditorFontSize } from '../src/web/editor-font.ts';

test('saved editor font sizes fall back to the default unless supported', () => {
  for (const value of [null, '', 'large', '9', '12.5', '30']) assert.equal(parseEditorFontSize(value), DEFAULT_EDITOR_FONT_SIZE);
  for (const size of EDITOR_FONT_SIZES) assert.equal(parseEditorFontSize(String(size)), size);
});
