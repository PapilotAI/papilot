import path from 'node:path';
import { readTrace, type CompiledPaper } from './writer/build-map.ts';
import { groupSectionNotes, type SectionHeading, type SectionPageLayout } from './note-sections.ts';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import type { OutlineEntry, PdfPage } from '../../engine/src/render/pdf.ts';
import type { Annotation } from '../shared.ts';
import { AnnotationPages, placeAnnotation, type AnnotationPlacement } from './annotation-placement.ts';
import { locateMark, type LineOp, type MarkRequest } from './note-location.ts';

const { engine } = workerData as { engine: string };
const [{ PdfDocument, containsCenter }, { opcodesWithin }] = await Promise.all([
  import(pathToFileURL(path.join(engine, 'src/render/pdf.ts')).href),
  import(pathToFileURL(path.join(engine, 'src/core/diff.ts')).href),
]);
type Document = InstanceType<typeof PdfDocument>;

// The documents one request reads, each opened once and closed at its end.
async function reading<T>(work: (open: (file: string) => Document) => Promise<T>) {
  const documents = new Map<string, Document>();
  try {
    return await work(file => {
      let document = documents.get(file);
      if (!document) documents.set(file, document = new PdfDocument(file));
      return document;
    });
  } finally { for (const document of documents.values()) document.close(); }
}

const operations = {
  sections: ({ compiled, key, notes }: { compiled: CompiledPaper; key: string; notes: Annotation[] }) => reading(async open => {
    const document = open(compiled.pdf);
    let traced;
    try { traced = readTrace(compiled, null); } catch { /* Older builds use PDF bookmarks. */ }
    const bookmarks: OutlineEntry[] = document.outline.filter((item: OutlineEntry) => item.page >= 0 && item.page < document.length);
    const destinations = new Map<OutlineEntry, { page: number; x: number; y: number } | null>(bookmarks.map(item => [item, document.destination(item.uri)]));
    const position = (item: typeof bookmarks[number]) => {
      const page = document.page(item.page), destination = destinations.get(item);
      return { page: item.page, top: (item.y - page.bounds[1]) / page.height,
        ...(destination ? { left: (destination.x - page.bounds[0]) / page.width } : {}) };
    };
    const layouts = new Map<number, SectionPageLayout>();
    for (const number of new Set([...bookmarks.map(item => item.page), ...notes.filter(note => note.key === key && note.page >= 0 && note.page < document.length).map(note => note.page)])) {
      const page: PdfPage = document.page(number), middle = page.bounds[0] + page.width / 2;
      // The engine's prose detector needs several lines. A sparse page still
      // proves columns when a right-column bookmark and side-by-side text agree.
      const left = page.lines.filter(line => line.rect[2] < middle), right = page.lines.filter(line => line.rect[0] > middle);
      const starts = bookmarks.filter(item => item.page === number).flatMap(item => { const at = destinations.get(item); return at ? [at.x] : []; });
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
    const clean = (title: string) => title.replace(/\s+/g, ' ').trim();
    const headings: SectionHeading[] = traced?.headings.length ? traced.headings.map((heading, index) => {
      const title = clean([heading.number, heading.title].filter(Boolean).join(' '));
      const anchored = heading.anchor ? bookmarks.filter(item => item.name === heading.anchor) : [];
      const matches = anchored.length ? anchored : bookmarks.filter(item => clean(item.title) === clean(title) || clean(item.title) === clean(heading.title));
      return { id: `section-${index}`, title, level: heading.level, ranges: heading.ranges, ...(matches.length === 1 ? { position: position(matches[0]) } : {}) };
    }) : bookmarks.map((item, index) => ({ id: `bookmark-${index}`, title: clean(item.title), level: item.level, position: position(item) }));
    // Stored source anchors may have followed edits made after this PDF.
    // Relocate in its immutable snapshot so heading and mark lines agree.
    const anchored: Annotation[] = [];
    for (const note of notes) {
      if (!traced?.headings.length || note.key !== key) { anchored.push(note); continue; }
      const located = await locateMark(document, { pdf: compiled.pdf, root: compiled.root, sourceDir: compiled.sourceDir, page: note.page, rect: note.rect, rects: note.rects || [], selected: note.quote }, { containsCenter, opcodesWithin }).catch(() => null);
      anchored.push({ ...note, source: located?.source || null });
    }
    return groupSectionNotes(anchored, key, headings, layouts);
  }),
  locate: (request: MarkRequest) => reading(open => locateMark(open(request.pdf), request, { containsCenter, opcodesWithin: opcodesWithin as (a: string[], b: string[], timeout: number) => LineOp[] | null })),
  // Notes from earlier PDFs, placed on the current one. A note whose place
  // cannot be verified, or whose PDF cannot be read, stays where it was.
  place: ({ current, notes }: { current: string; notes: { note: Annotation; previous: string }[] }) => reading(async open => {
    const pages = new Map<string, AnnotationPages>(), of = (file: string) => {
      let found = pages.get(file);
      if (!found) pages.set(file, found = new AnnotationPages(open(file)));
      return found;
    };
    const target = of(current), placed: (AnnotationPlacement | null)[] = [];
    for (const { note, previous } of notes) {
      try { placed.push(await placeAnnotation(note, of(previous), target)); }
      catch { placed.push(null); }
    }
    return placed;
  }),
};

parentPort!.on('message', async ({ id, op, args }: { id: number; op: keyof typeof operations; args: never }) => {
  try { parentPort!.postMessage({ id, value: await operations[op](args) }); }
  catch (error) { parentPort!.postMessage({ id, error: (error as Error)?.message || String(error) }); }
});
