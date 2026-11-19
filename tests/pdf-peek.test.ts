import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { PDFDocument } from 'mupdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfPeekRegion, resolvePdfDestination } from '../src/web/pdf-destination.ts';
import { cropDocument, fullPageViewport } from '../src/web/pdf-crop.ts';

test('peek resolves real named/explicit PDF destinations and rejects unavailable pages', async () => {
  const source = new PDFDocument(fs.readFileSync('tests/fixtures/outline.pdf'));
  source.getTrailer().get('Root').put('Names', { Dests: { Names: [source.newString('equation'), [source.findPage(1), source.newName('XYZ'), 70, 400, null]] } });
  const buffer = source.saveToBuffer(''), bytes = buffer.asUint8Array().slice(); buffer.destroy(); source.destroy();
  const task = getDocument({ data: bytes, useSystemFonts: true });
  try {
    const document = await task.promise;
    const destinations = await document.getDestinations();
    assert.ok(destinations.size);
    for (const [name, explicit] of destinations.entries()) {
      assert.deepEqual(await resolvePdfDestination(document, name), await resolvePdfDestination(document, explicit));
      assert.ok((await resolvePdfDestination(document, name))!.pageNumber > 0);
    }
    assert.equal(await resolvePdfDestination(document, 'missing-reference'), null);
    for (const page of [-1, document.numPages, 1.5, null, '1']) assert.equal(await resolvePdfDestination(document, [page, { name: 'Fit' }]), null);
    assert.equal((await resolvePdfDestination(document, [0, { name: 'Fit' }]))?.pageNumber, 1);
  } finally { await task.destroy(); }
});

test('peek clips around destinations through rotation, UserUnit, CropBox and reader crops', async () => {
  for (const rotation of [0, 90, 180, 270]) {
    const source = new PDFDocument(fs.readFileSync('tests/fixtures/outline.pdf'));
    source.findPage(0).put('CropBox', [30, 40, 550, 720]);
    source.findPage(0).put('Rotate', rotation);
    source.findPage(0).put('UserUnit', 2);
    const buffer = source.saveToBuffer(''), bytes = buffer.asUint8Array().slice(); buffer.destroy(); source.destroy();
    const task = getDocument({ data: bytes, useSystemFonts: true });
    try {
      const document = await task.promise;
      cropDocument(document, () => [0.2, 0.3, 0.8, 0.9]);
      const page = await document.getPage(1);
      for (const destination of [
        [0, { name: 'XYZ' }, 200, 340, null], [0, { name: 'FitH' }, 340],
        [0, { name: 'FitBH' }, 340], [0, { name: 'FitV' }, 200],
        [0, { name: 'FitR' }, 200, 200, 400, 340], [0, { name: 'Fit' }],
        [0, { name: 'XYZ' }, null, null, null], [0, { name: 'XYZ' }, 99999, -9999, null],
      ]) {
        const region = pdfPeekRegion(page, destination, 558, 330);
        assert.equal(region.width, 558);
        assert.ok(region.height <= 330 && region.height > 0);
        assert.ok(region.top >= 0 && region.top + region.height <= region.viewport.height + 1e-6);
        assert.deepEqual(region.viewport.viewBox, fullPageViewport(page, { scale: 1 }).viewBox);
        if (destination[2] === 200 && destination[3] === 340) {
          const [, targetY] = region.viewport.convertToViewportPoint(200, 340);
          assert.ok(targetY >= region.top && targetY <= region.top + region.height, `target stays inside the preview at ${rotation} degrees`);
        }
      }
    } finally { await task.destroy(); }
  }
});

test('a centered table anchor keeps the whole local table inside a narrow preview', async () => {
  const task = getDocument({ data: new Uint8Array(fs.readFileSync('tests/fixtures/outline.pdf')), useSystemFonts: true });
  try {
    const document = await task.promise, page = await document.getPage(1);
    const text = { items: [
      { str: 'Table 1: Measured results', transform: [10, 0, 0, 10, 240, 400], width: 180, height: 10, dir: 'ltr', fontName: 'fixture', hasEOL: true },
      { str: 'Alpha', transform: [10, 0, 0, 10, 240, 380], width: 30, height: 10, dir: 'ltr', fontName: 'fixture', hasEOL: false },
      { str: '98.4', transform: [10, 0, 0, 10, 380, 380], width: 25, height: 10, dir: 'ltr', fontName: 'fixture', hasEOL: true },
    ], styles: {}, lang: null };
    const region = pdfPeekRegion(page, [0, { name: 'XYZ' }, 330, 410, null], 372, 330, text);
    const [left] = region.viewport.convertToViewportPoint(240, 400), [right] = region.viewport.convertToViewportPoint(420, 400);
    assert.ok(left >= region.left + 8, 'the caption and row labels are inside the left edge');
    assert.ok(right <= region.left + region.width - 8, 'the last column fits too');
  } finally { await task.destroy(); }
});
