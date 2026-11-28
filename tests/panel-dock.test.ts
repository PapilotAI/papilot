import test from 'node:test';
import assert from 'node:assert/strict';
import { dropZone, fitFloat } from '../src/web/panel-dock.tsx';

const area = { width: 1000, height: 800 };

test('a dragged panel docks on the edge it is dropped near, and floats elsewhere', () => {
  assert.equal(dropZone({ x: 10, y: 400 }, area), 'left');
  assert.equal(dropZone({ x: 990, y: 400 }, area), 'right');
  assert.equal(dropZone({ x: 500, y: 790 }, area), 'bottom');
  assert.equal(dropZone({ x: 10, y: 790 }, area), 'left', 'a corner goes to the side');
  assert.equal(dropZone({ x: 500, y: 10 }, area), 'float', 'the top edge is the toolbar, not a dock');
  assert.equal(dropZone({ x: 500, y: 400 }, area), 'float');
});

test('a floating panel starts at the right below the toolbar and always fits its area', () => {
  assert.deepEqual(fitFloat(undefined, area), { x: 604, y: 56, width: 380, height: 560 });
  assert.deepEqual(fitFloat({ x: 900, y: 700, width: 400, height: 300 }, area), { x: 600, y: 500, width: 400, height: 300 }, 'pushed back inside');
  assert.deepEqual(fitFloat({ x: -50, y: -20, width: 100, height: 50 }, area), { x: 0, y: 0, width: 300, height: 200 }, 'never smaller than usable');
  assert.deepEqual(fitFloat({ x: 0, y: 0, width: 4000, height: 4000 }, area), { x: 0, y: 0, width: 984, height: 784 }, 'never larger than its area');
  assert.deepEqual(fitFloat({ x: 10, y: 10, width: 500, height: 500 }, { width: 200, height: 150 }), { x: 0, y: 0, width: 300, height: 200 }, 'a tiny area keeps the minimum');
});
