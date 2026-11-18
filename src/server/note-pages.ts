import fs from 'node:fs';
import type { NoteSummary } from '../shared.ts';

// A comment made on the task's PDF reader reaches the agent with the page it
// was made on: an image of that page with the quoted passage highlighted and
// outlined, the passage's place on the page, and the source lines SyncTeX
// finds for it.

type Rect = [number, number, number, number];
type Mupdf = typeof import('mupdf');

const SCALE = 1.5, PAD = 6, BORDER = 3;
const bounds = (rects: Rect[]): Rect => [Math.min(...rects.map(r => r[0])), Math.min(...rects.map(r => r[1])), Math.max(...rects.map(r => r[2])), Math.max(...rects.map(r => r[3]))];

/** Page `index` (0-based) of `pdf` as a PNG, with `rects` (fractions of the page) marked. */
export function markedPage(mupdf: Mupdf, pdf: string, index: number, rects: Rect[]): Buffer {
  const document = mupdf.Document.openDocument(fs.readFileSync(pdf), 'application/pdf');
  try {
    if (index < 0 || index >= document.countPages()) throw new Error('That page is not in the PDF.');
    const page = document.loadPage(index), pixmap = page.toPixmap([SCALE, 0, 0, SCALE, 0, 0], mupdf.ColorSpace.DeviceRGB, false, true);
    try {
      const width = pixmap.getWidth(), height = pixmap.getHeight(), stride = pixmap.getStride(), n = Math.round(stride / width);
      const pixels = pixmap.getPixels();
      const paint = (x0: number, y0: number, x1: number, y1: number, color: [number, number, number], alpha: number) => {
        for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++)
          for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
            const at = y * stride + x * n;
            for (let c = 0; c < 3; c++) pixels[at + c] = Math.round(pixels[at + c] * (1 - alpha) + color[c] * alpha);
          }
      };
      // The passage as a highlighter would mark it, and a box around it to find it at a glance.
      for (const [x0, y0, x1, y1] of rects) paint(x0 * width, y0 * height, x1 * width, y1 * height, [255, 214, 0], 0.35);
      const [x0, y0, x1, y1] = bounds(rects), left = x0 * width - PAD, top = y0 * height - PAD, right = x1 * width + PAD, bottom = y1 * height + PAD;
      const red: [number, number, number] = [220, 38, 38];
      paint(left - BORDER, top - BORDER, right + BORDER, top, red, 1); paint(left - BORDER, bottom, right + BORDER, bottom + BORDER, red, 1);
      paint(left - BORDER, top, left, bottom, red, 1); paint(right, top, right + BORDER, bottom, red, 1);
      return Buffer.from(pixmap.asPNG());
    } finally { pixmap.destroy(); page.destroy(); }
  } finally { document.destroy(); }
}

const percent = (rect: Rect) => rect.map(value => `${Math.round(value * 100)}%`).join(', ');
const lines = ([start, end]: [number, number]) => start === end ? `line ${start}` : `lines ${start}–${end}`;

export interface NotePageHost {
  /** The PDF a note was made on, or null when it is no longer available. */
  pdf(paper: NonNullable<NoteSummary['paper']>): Promise<string | null>;
  /** Where the passage is in the task's files, when SyncTeX can tell. */
  locate(paper: NonNullable<NoteSummary['paper']>, quote: string): Promise<{ file: string; lines: [number, number] } | null>;
  render(pdf: string, page: number, rects: Rect[]): Promise<Buffer>;
  attach(name: string, png: Buffer): Promise<string>;
}

/** Notes with what the agent needs to find them, and the page images to attach. */
export async function withNotePages(notes: NoteSummary[], host: NotePageHost, room: number) {
  const attachments: string[] = [];
  const result = await Promise.all(notes.map(async (note, index) => {
    const paper = note.paper;
    if (!paper) return note;
    const where = [note.where], context = [`Marked lines on the page (left, top, right, bottom): ${percent(bounds(paper.rects))}`];
    const source = await host.locate(paper, note.quote).catch(() => null);
    if (source) where.push(`${source.file} ${lines(source.lines)}`);
    if (index < room) {
      const pdf = await host.pdf(paper).catch(() => null);
      const png = pdf ? await host.render(pdf, paper.page, paper.rects).catch(() => null) : null;
      const name = `comment-${index + 1}-page-${paper.page + 1}.png`;
      // Without room for the image, the comment still goes with its text and place.
      const id = png ? await host.attach(name, png).catch(() => null) : null;
      if (id) {
        attachments[index] = id;
        context.push(`Page image: ${name}, with the passage highlighted and boxed in red`);
      }
    }
    const sources = [...(note.anchor?.sources || []), ...(source ? [source] : [])];
    return { ...note, where: where.join(' · '), context, anchor: { ...note.anchor, sources } };
  }));
  return { notes: result, attachments: attachments.filter(Boolean) };
}
