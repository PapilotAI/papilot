import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';

test('the shipped favicon keeps all five Papilot stripes', () => {
  const image = new mupdf.Image(readFileSync(new URL('../public/favicon.png', import.meta.url)));
  const pixmap = image.toPixmap();
  try {
    assert.equal(pixmap.getWidth(), 64);
    assert.equal(pixmap.getHeight(), 64);
    const pixels = pixmap.getPixels();
    const channels = pixmap.getNumberOfComponents();
    const stripes: string[] = [];
    let previous = 'background';
    // Cross the mark perpendicular to its stripes. Count separated colour
    // bands in the actual PNG, so a stale or regenerated mini icon fails too.
    for (let i = 0; i < pixmap.getWidth(); i++) {
      const offset = i * pixmap.getStride() + i * channels;
      const [r, g, b, alpha = 255] = pixels.subarray(offset, offset + channels);
      const colour = alpha < 200 ? 'background'
        : r < 100 && b < 180 ? 'navy'
          : r < 140 && b > 180 && g > 70 ? 'blue'
            : r > 200 && g < 180 && b < 180 ? 'coral' : 'background';
      if (colour !== 'background' && colour !== previous) stripes.push(colour);
      previous = colour;
    }
    assert.deepEqual(stripes, ['navy', 'navy', 'coral', 'blue', 'blue']);
  } finally {
    pixmap.destroy();
    image.destroy();
  }
});
