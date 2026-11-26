import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_APPEARANCE, INTERFACE_SIZES, parseAppearance, resolveWindowControls, resolveWindowControlsStyle, stepInterfaceSize } from '../src/web/appearance.ts';

test('older or invalid appearance preferences default reviews to following the PDF', () => {
  for (const value of [null, '{broken', '{}', '{"pdf":"light"}', '{"review":"invalid"}', '{"review":false}']) {
    assert.equal(parseAppearance(value).review, 'pdf');
  }
  assert.equal(parseAppearance('{"pdf":"light"}').pdf, 'light');
  assert.equal(DEFAULT_APPEARANCE.review, 'pdf');
});

test('review appearance survives saving independently of the PDF preference', () => {
  for (const review of ['pdf', 'theme', 'light'] as const) {
    const saved = { ...DEFAULT_APPEARANCE, pdf: 'light' as const, review };
    const restored = parseAppearance(JSON.stringify(saved));
    assert.equal(restored.review, review);
    assert.equal(restored.pdf, 'light');
  }
});

test('interface size keeps supported zoom factors and steps through them', () => {
  assert.equal(DEFAULT_APPEARANCE.size, 1);
  for (const value of [null, '{}', '{"size":3}', '{"size":0.5}', '{"size":"1.5"}', '{"size":1.3}']) assert.equal(parseAppearance(value).size, 1);
  for (const size of INTERFACE_SIZES) assert.equal(parseAppearance(JSON.stringify({ ...DEFAULT_APPEARANCE, size })).size, size);
  assert.equal(stepInterfaceSize(1, 'in'), 1.1);
  assert.equal(stepInterfaceSize(1.25, 'out'), 1.1);
  assert.equal(stepInterfaceSize(1, 'out'), 1);
  assert.equal(stepInterfaceSize(2, 'in'), 2);
  assert.equal(stepInterfaceSize(1.75, 'reset'), 1);
});

test('window button side and style default per platform and survive saving', () => {
  assert.equal(DEFAULT_APPEARANCE.windowControls, 'auto');
  assert.equal(DEFAULT_APPEARANCE.windowControlsStyle, 'auto');
  for (const value of [null, '{}', '{"windowControls":"top"}', '{"windowControls":true}', '{"windowControlsStyle":"round"}']) {
    assert.equal(parseAppearance(value).windowControls, 'auto');
    assert.equal(parseAppearance(value).windowControlsStyle, 'auto');
  }
  for (const windowControls of ['auto', 'left', 'right'] as const) {
    for (const windowControlsStyle of ['auto', 'compact', 'wide'] as const) {
      const restored = parseAppearance(JSON.stringify({ ...DEFAULT_APPEARANCE, windowControls, windowControlsStyle }));
      assert.equal(restored.windowControls, windowControls);
      assert.equal(restored.windowControlsStyle, windowControlsStyle);
    }
  }
  assert.equal(resolveWindowControls('auto', 'linux'), 'left');
  assert.equal(resolveWindowControls('auto', 'win32'), 'right');
  assert.equal(resolveWindowControls('right', 'linux'), 'right');
  assert.equal(resolveWindowControls('left', 'win32'), 'left');
  assert.equal(resolveWindowControls('right', 'darwin'), 'left');
  assert.equal(resolveWindowControlsStyle('auto', 'linux'), 'compact');
  assert.equal(resolveWindowControlsStyle('auto', 'win32'), 'wide');
  assert.equal(resolveWindowControlsStyle('wide', 'linux'), 'wide');
  assert.equal(resolveWindowControlsStyle('compact', 'win32'), 'compact');
  assert.equal(resolveWindowControlsStyle('wide', 'darwin'), 'compact');
});
