import test from 'node:test';
import assert from 'node:assert/strict';
import { resetText, windowName } from '../src/web/usage.tsx';

test('usage windows are named by length and resets read as a countdown or a day', () => {
  assert.equal(windowName(10080), 'Weekly limit');
  assert.equal(windowName(300), '5-hour limit');
  assert.equal(windowName(1440), 'Daily limit');
  assert.equal(windowName(null), 'Usage limit');
  const now = Date.UTC(2026, 9, 27, 12);
  assert.equal(resetText(now + 30_000, now), 'resets now');
  assert.equal(resetText(now + 3 * 3_600_000 + 20 * 60_000, now), 'resets in 3 h 20 min');
  assert.equal(resetText(now + 45 * 60_000, now), 'resets in 45 min');
  assert.match(resetText(now + 3 * 86_400_000, now), /^resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d{2}\s?(AM|PM)$/);
  assert.match(resetText(now + 9 * 86_400_000, now), /^resets Nov \d{1,2}$/);
});
