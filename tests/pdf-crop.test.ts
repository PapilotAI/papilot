import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { PDFDocument } from 'mupdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cropDocument, croppedViewport, fullPageViewport, FULL_PAGE, moveCropEdge, readPdfCrop, savePdfCrop, validCrop, type PdfCrop } from '../src/web/pdf-crop.ts';
import { browserStorage } from '../src/web/storage.ts';

test('crop preferences validate bounds and stay isolated by manuscript and root document', () => {
  const crop: PdfCrop = [0.12, 0.08, 0.84, 0.92];
  for (const bad of [null, {}, [], [0, 0, 1], [0, 0, Infinity, 1], [0, 0, '1', 1], [-0.1, 0, 1, 1], [0.8, 0, 0.2, 1], [0, 0.7, 1, 0.7]]) assert.equal(validCrop(bad), false);
  savePdfCrop('test-paper:main.tex', crop);
  assert.deepEqual(readPdfCrop('test-paper:main.tex'), crop);
  assert.deepEqual(readPdfCrop('other-paper:main.tex'), FULL_PAGE);
  assert.deepEqual(readPdfCrop('test-paper:appendix.tex'), FULL_PAGE);
  browserStorage.setItem('papilot:pdf-crop:broken', '{');
  assert.deepEqual(readPdfCrop('broken'), FULL_PAGE);
  savePdfCrop('test-paper:main.tex', FULL_PAGE);
  assert.deepEqual(readPdfCrop('test-paper:main.tex'), FULL_PAGE);
  assert.ok(!browserStorage.getItem('papilot:pdf-crop:test-paper:main.tex'));
});

test('dragging any edge cannot invert or collapse the viewport', () => {
  assert.deepEqual(moveCropEdge([0.1, 0.2, 0.8, 0.9], 0, 2), [0.79, 0.2, 0.8, 0.9]);
  assert.deepEqual(moveCropEdge(FULL_PAGE, 3, -1), [0, 0, 1, 0.01]);
  assert.deepEqual(moveCropEdge(FULL_PAGE, 1, -1), FULL_PAGE);
});

test('real PDF viewports crop all rotations and page boxes without changing PDF data or text', async () => {
  const source = new PDFDocument(fs.readFileSync('tests/fixtures/outline.pdf'));
  const original = source.findPage(0);
  original.put('CropBox', [30, 40, 550, 720]);
  original.put('UserUnit', 2);
  const second = source.findPage(1);
  second.put('CropBox', [0, 0, 400, 500]);
  second.put('Rotate', 90);
  const buffer = source.saveToBuffer(''), bytes = buffer.asUint8Array().slice(); buffer.destroy(); source.destroy();
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  try {
    const document = await task.promise, page = await document.getPage(1);
    const view = [...page.view], text = await page.getTextContent();
    let crop: PdfCrop = [0.1, 0.2, 0.85, 0.9];
    cropDocument(document, () => crop);
    await document.getPage(1);
    for (const rotation of [0, 90, 180, 270]) {
      const full = fullPageViewport(page, { scale: 1.5, rotation }), cropped = page.getViewport({ scale: 1.5, rotation });
      assert.ok(Math.abs(cropped.width - full.width * 0.75) < 1e-7);
      assert.ok(Math.abs(cropped.height - full.height * 0.7) < 1e-7);
      const point = full.convertToPdfPoint(full.width * 0.4, full.height * 0.5);
      const screen = cropped.convertToViewportPoint(point[0], point[1]);
      assert.ok(Math.abs(screen[0] - full.width * 0.3) < 1e-7);
      assert.ok(Math.abs(screen[1] - full.height * 0.3) < 1e-7);
      assert.deepEqual(cropped.clone({ scale: 3 }).viewBox, cropped.viewBox, 'PDF.js zoom retains the cropped box');
      assert.deepEqual(page.getViewport({ scale: 1.5, rotation, dontFlip: true }).viewBox, cropped.viewBox, 'link annotations use the same box');
      assert.deepEqual(croppedViewport(full, FULL_PAGE).viewBox, view);
    }
    assert.deepEqual(page.view, view, 'word extraction still uses the original box');
    assert.deepEqual(await page.getTextContent(), text);
    assert.deepEqual(await document.getData(), bytes, 'exported bytes are untouched');
    const next = await document.getPage(2), fullNext = fullPageViewport(next, { scale: 1 }), croppedNext = next.getViewport({ scale: 1 });
    assert.equal(next.rotate, 90);
    assert.notEqual(fullNext.width, fullPageViewport(page, { scale: 1 }).width);
    assert.ok(Math.abs(croppedNext.width - fullNext.width * 0.75) < 1e-7, 'later pages use their own size and intrinsic rotation');
    assert.ok(Math.abs(croppedNext.height - fullNext.height * 0.7) < 1e-7);
    crop = FULL_PAGE;
    assert.deepEqual(page.getViewport({ scale: 1 }).viewBox, view, 'reset restores the original page');
    assert.deepEqual((await document.getPage(2)).view, (await document.getPage(2)).getViewport({ scale: 1 }).viewBox);
  } finally { await task.destroy(); }
});
