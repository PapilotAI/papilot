import { setImmediate as yieldToReader } from 'node:timers/promises';
import type { PdfDocument, PdfPage, OutlineEntry } from '../../engine/src/render/pdf.ts';
import type { Annotation } from '../shared.ts';
import type { Located, MarkRequest } from './note-location.ts';
import { groupSectionNotes, type SectionHeading, type SectionPageLayout } from './note-sections.ts';
import { readTrace, type CompiledPaper } from './writer/build-map.ts';

/** The outline belongs to an immutable compiled PDF, independently of its notes. */
export function readSectionHeadings(document: PdfDocument, compiled: CompiledPaper): SectionHeading[] {
  let traced;
  try { traced = readTrace(compiled, null); } catch { /* Older builds use PDF bookmarks. */ }
  const bookmarks: OutlineEntry[] = document.outline.filter((item: OutlineEntry) => item.page >= 0 && item.page < document.length);
  const destinations = new Map<OutlineEntry, { page: number; x: number; y: number } | null>(bookmarks.map(item => [item, document.destination(item.uri)]));
  const position = (item: typeof bookmarks[number]) => {
    // A bookmark needs the page box, not text, drawings or glyph shapes.
    const page = document.raw.loadPage(item.page), destination = destinations.get(item);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      return { page: item.page, top: (item.y - y0) / (y1 - y0),
        ...(destination ? { left: (destination.x - x0) / (x1 - x0) } : {}) };
    } finally { page.destroy(); }
  };
  const clean = (title: string) => title.replace(/\s+/g, ' ').trim();
  return traced?.headings.length ? traced.headings.map((heading, index) => {
    const title = clean([heading.number, heading.title].filter(Boolean).join(' '));
    const anchored = heading.anchor ? bookmarks.filter(item => item.name === heading.anchor) : [];
    const matches = anchored.length ? anchored : bookmarks.filter(item => clean(item.title) === clean(title) || clean(item.title) === clean(heading.title));
    return { id: `section-${index}`, title, level: heading.level, ranges: heading.ranges, ...(matches.length === 1 ? { position: position(matches[0]) } : {}) };
  }) : bookmarks.map((item, index) => ({ id: `bookmark-${index}`, title: clean(item.title), level: item.level, position: position(item) }));
}

/** Only marks not already classified for this PDF reach the worker. */
export async function readSectionNotes(document: PdfDocument, compiled: CompiledPaper, key: string, notes: Annotation[], headings: SectionHeading[], locate: (request: MarkRequest) => Promise<Located | null>) {
  // Stored source anchors may have followed edits made after this PDF.
  // Relocate in its immutable snapshot so heading and mark lines agree.
  const anchored: Annotation[] = [];
  const traced = headings.some(heading => heading.ranges);
  for (const note of notes) {
    if (!traced || note.key !== key) { anchored.push(note); continue; }
    await yieldToReader();
    const located = await locate({ pdf: compiled.pdf, root: compiled.root, sourceDir: compiled.sourceDir, page: note.page, rect: note.rect, rects: note.rects || [], selected: note.quote }).catch(() => null);
    anchored.push({ ...note, source: located?.source || null });
  }
  const layouts = new Map<number, SectionPageLayout>();
  for (const number of new Set(notes.filter(note => note.key === key && note.page >= 0 && note.page < document.length).map(note => note.page))) {
    await yieldToReader();
    const page: PdfPage = document.page(number), middle = page.bounds[0] + page.width / 2;
    // The engine's prose detector needs several lines. A sparse page still
    // proves columns when a right-column bookmark and side-by-side text agree.
    const left = page.lines.filter(line => line.rect[2] < middle), right = page.lines.filter(line => line.rect[0] > middle);
    const starts = document.outline.filter(item => item.page === number).flatMap(item => { const at = document.destination(item.uri); return at ? [at.x] : []; });
    const rightHeading = starts.some(x => x > middle), acrossColumns = Math.max(...starts) - Math.min(...starts) > page.width * 0.25;
    const sparseColumns = rightHeading && left.length > 0 && right.length > 0
      && (acrossColumns || left.some(a => right.some(b => Math.min(a.rect[3], b.rect[3]) - Math.max(a.rect[1], b.rect[1]) > 3)));
    if (!page.twoColumns && !sparseColumns) continue;
    const spans: [number, number][] = page.twoColumns ? page.spanning : [
      ...page.lines.flatMap(line => line.chars.filter(char => char.text.trim() && char.rect[0] < middle + 4 && char.rect[2] > middle - 4).map(char => [char.rect[1], char.rect[3]] as [number, number])),
      ...page.drawings.filter(rect => rect[0] < middle + 4 && rect[2] > middle - 4).map(rect => [rect[1], rect[3]] as [number, number]),
    ];
    const spanning: [number, number][] = [];
    for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
      const last = spanning.at(-1);
      if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
      else spanning.push([start, end]);
    }
    layouts.set(number, { gutter: 0.5, spanning: spanning.map(([start, end]) => [(start - page.bounds[1]) / page.height, (end - page.bounds[1]) / page.height]) });
  }
  const grouped = groupSectionNotes(anchored, key, headings, layouts);
  return layouts.size ? { ...grouped, pageLayouts: Object.fromEntries(layouts) } : grouped;
}
