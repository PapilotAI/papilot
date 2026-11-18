import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mupdf from 'mupdf';
import { markedPage, withNotePages } from '../src/server/note-pages.ts';
import { reviewNotesInstructions } from '../src/notes.ts';
import type { NoteSummary } from '../src/shared.ts';

const pdf = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/outline.pdf');

test('a commented page is drawn with its passage highlighted and boxed', () => {
  const png = markedPage(mupdf, pdf, 0, [[0.2, 0.3, 0.6, 0.33]]);
  assert.deepEqual([...png.subarray(1, 4)], [...Buffer.from('PNG')]);
  const image = mupdf.Image ? new mupdf.Image(png) : null, pixmap = image?.toPixmap();
  if (pixmap) {
    const width = pixmap.getWidth(), height = pixmap.getHeight(), n = Math.round(pixmap.getStride() / width), pixels = pixmap.getPixels();
    const at = (x: number, y: number) => [...pixels.subarray(Math.round(y * height) * pixmap.getStride() + Math.round(x * width) * n, Math.round(y * height) * pixmap.getStride() + Math.round(x * width) * n + 3)];
    // Inside the passage the page is tinted yellow: more red and green than blue.
    const [r, g, b] = at(0.4, 0.315);
    assert.ok(r > b + 40 && g > b + 20, `tinted ${[r, g, b]}`);
    // Far from it, the page is as printed.
    assert.deepEqual(at(0.9, 0.9), [255, 255, 255]);
  }
  assert.throws(() => markedPage(mupdf, pdf, 99, [[0, 0, 1, 1]]), /not in the PDF/);
});

test('a comment on the PDF reader goes to the agent with its page image and source lines', async () => {
  const notes: NoteSummary[] = [
    { id: 'a', where: 'PDF page 2', quote: 'binding power', comment: 'Explain this', paper: { page: 1, rects: [[0.1, 0.2, 0.5, 0.22], [0.1, 0.22, 0.3, 0.24]], key: 'f'.repeat(16) } },
    { id: 'b', where: 'Round 1 · PDF page 3 · After', quote: 'strip text', comment: 'Shorter' },
  ];
  const attached: string[] = [];
  const { notes: sent, attachments } = await withNotePages(notes, {
    pdf: async () => pdf,
    locate: async () => ({ file: 'sections/pratt.tex', lines: [40, 42] }),
    render: async () => Buffer.from('png'),
    attach: async name => { attached.push(name); return 'id-' + name; },
  }, 10);
  assert.deepEqual(attached, ['comment-1-page-2.png']);
  assert.deepEqual(attachments, ['id-comment-1-page-2.png']);
  assert.equal(sent[0].where, 'PDF page 2 · sections/pratt.tex lines 40–42');
  assert.deepEqual(sent[0].anchor?.sources, [{ file: 'sections/pratt.tex', lines: [40, 42] }]);
  assert.equal(sent[1], notes[1]);
  const prompt = reviewNotesInstructions(sent);
  assert.match(prompt, /1\. PDF page 2 · sections\/pratt\.tex lines 40–42\n {3}Marked lines on the page \(left, top, right, bottom\): 10%, 20%, 50%, 24%\n {3}Page image: comment-1-page-2\.png, with the passage highlighted and boxed in red\n {3}PDF text: "binding power"/);
  assert.match(prompt, /attached page image shows where/);
  // Without room for more attachments, the comment keeps its text and place.
  const full = await withNotePages(notes.slice(0, 1), { pdf: async () => pdf, locate: async () => null, render: async () => Buffer.from('png'), attach: async () => { throw new Error('full'); } }, 10);
  assert.deepEqual(full.attachments, []);
  assert.doesNotMatch(full.notes[0].context!.join('\n'), /Page image/);
});
