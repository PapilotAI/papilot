import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewAssets } from '../src/assets.ts';

test('review resources exclude changed source images and filename-looking prose', () => {
  const strip = { width: 100, height: 20, src: 'before.svg', clean: 'clean.svg' };
  assert.deepEqual(reviewAssets({
    files: '/review/project/files/1/', units: [{ file: 'figure.png', text: 'caption.jpg' }],
    sections: [{ blocks: [{ before: [strip], after: [strip] }] }],
    loose: [{ after: [{ width: 10, height: 20, src: '../outside.svg', clean: 'after.svg' }] }],
  }), ['before.svg', 'clean.svg', 'after.svg']);
});
