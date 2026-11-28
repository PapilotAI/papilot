import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isPopout, isZoom, placeOnDisplays, popoutPlaces, POPOUT_PREFIX } from '../desktop/popout-windows.ts';
import { POPOUT_PREFIX as WEB_PREFIX } from '../src/web/popout-window.ts';
import { INTERFACE_SIZES } from '../src/web/appearance.ts';

test('only blank windows the workspace names as pop-outs open in the app', () => {
  assert.equal(WEB_PREFIX, POPOUT_PREFIX, 'the workspace and the app agree on the name');
  assert.equal(isPopout('about:blank', POPOUT_PREFIX + 'source-paper'), true);
  assert.equal(isPopout('https://example.com/', POPOUT_PREFIX + 'source-paper'), false, 'a pop-out name does not let a page in');
  assert.equal(isPopout('about:blank', ''), false, 'other blank windows open in the browser');
  assert.equal(isPopout('about:blank', 'papilot-other'), false);
  assert.equal(isPopout('about:blank', POPOUT_PREFIX + 'x'.repeat(300)), false);
});

test('a pop-out reopens where it was while that place is on a display', () => {
  const laptop = { x: 0, y: 25, width: 1440, height: 875 }, monitor = { x: 1440, y: -300, width: 2560, height: 1415 };
  const saved = { x: 2000.4, y: 100, width: 900, height: 1000.6 };
  assert.deepEqual(placeOnDisplays(saved, [laptop, monitor]), { x: 2000, y: 100, width: 900, height: 1001 }, 'on the second display');
  assert.equal(placeOnDisplays(saved, [laptop]), undefined, 'that display is gone: the system places it');
  assert.deepEqual(placeOnDisplays({ x: 100, y: 100, width: 2400, height: 1300 }, [laptop, monitor]), { x: 100, y: 100, width: 1440, height: 875 }, 'no larger than the display it opens on');
  assert.deepEqual(placeOnDisplays({ x: -780, y: 100, width: 900, height: 600 }, [laptop]), { x: -780, y: 100, width: 900, height: 600 }, 'enough of its title bar shows to grab');
  assert.equal(placeOnDisplays({ x: -800, y: 100, width: 900, height: 600 }, [laptop]), undefined, 'too little shows');
  assert.equal(placeOnDisplays({ x: 100, y: 0, width: 900, height: 600 }, [laptop]), undefined, 'its title bar is above the work area');
  assert.equal(placeOnDisplays({ x: 100, y: 880, width: 900, height: 600 }, [laptop]), undefined, 'its title bar is below the work area');
  for (const bad of [undefined, null, 'x', {}, { x: 0, y: 30, width: 0, height: 600 }, { x: 0, y: 30, width: Infinity, height: 600 }]) {
    assert.equal(placeOnDisplays(bad, [laptop]), undefined, JSON.stringify(bad));
  }
});

test('the place is kept in the app data and survives a bad file', t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-popout-places-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const places = popoutPlaces(data), editor = POPOUT_PREFIX + 'source-paper', chat = POPOUT_PREFIX + 'dock-task';
  assert.equal(places.read(editor), undefined);
  places.save(editor, { x: 10, y: 40, width: 800, height: 600 });
  places.save(chat, { x: 900, y: 40, width: 400, height: 700 });
  assert.deepEqual(popoutPlaces(data).read(editor), { x: 10, y: 40, width: 800, height: 600 }, 'each pop-out keeps its own place');
  assert.deepEqual(popoutPlaces(data).read(chat), { x: 900, y: 40, width: 400, height: 700 });
  fs.writeFileSync(path.join(data, 'popout-windows.json'), '{');
  assert.equal(places.read(editor), undefined);
});

test('pop-outs take every interface size and nothing else', () => {
  for (const size of INTERFACE_SIZES) assert.equal(isZoom(size), true, String(size));
  for (const bad of [0, 0.5, 3, NaN, '1.25', null]) assert.equal(isZoom(bad), false, String(bad));
});
