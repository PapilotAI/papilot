import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { Strip } from "../types.ts";
import { t } from "./i18n.ts";
import { CMapData } from "./FullPaper.tsx";
import { alignPages, locator, scope, type PlacedChange } from "./paper.ts";
import { fullPaperReader } from "./full-paper-reader.ts";
import { holdReader } from "./reader-handoff.ts";

// Both versions of the paper, whole, side by side: the old version's pages
// on the left and the new version's on the right, paired page by page, with
// a blank page where one version has pages the other has not. Each change is
// marked where it prints, removed words red on the left page and added words
// green on the right, by laying the change's own comparison crops over the
// pages, and the change being reviewed shaded over exactly its lines. Nothing
// cuts through a page: a column between the two has a bar level with each
// change, with its number; a click there, or on the change on either page,
// selects it and opens its decisions.
interface Doc { pdf: PDFDocumentProxy; width: number; height: number; labels: string[] | null; words: string[][] }
type Side = "before" | "after";
// A change's crops on one page, in PDF points.
interface Placed { index: number; strip: Strip; page: number }

async function open(url: string, tasks: ReturnType<typeof pdfjs.getDocument>[]): Promise<Doc> {
  const task = pdfjs.getDocument({ url, enableXfa: false, BinaryDataFactory: CMapData });
  tasks.push(task);
  const pdf = await task.promise, first = (await pdf.getPage(1)).getViewport({ scale: 1 });
  // Each page's words, to pair the two versions' pages by what they say.
  const words = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
    const content = await (await pdf.getPage(index + 1)).getTextContent();
    return content.items.flatMap((item) => "str" in item ? item.str.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [] : []);
  }));
  return { pdf, width: first.width, height: first.height, labels: await pdf.getPageLabels().catch(() => null), words };
}

function place(doc: Doc, changes: PlacedChange[], side: Side): Placed[] {
  const find = locator(doc.pdf.numPages, doc.labels), placed: Placed[] = [];
  for (const { block, index } of changes) {
    // An unchanged passage that only moved or reflowed has nothing to mark.
    if (block.identical) continue;
    for (const strip of block[side]) {
      if (strip.top === undefined) continue;
      const page = find(strip);
      if (page >= 0) placed.push({ index, strip, page });
    }
  }
  return placed;
}

export function ComparePages({ active, before, after, files, changes, current, states, controls, onSelect, scrollRoot, readingPlace, onReady, onUnavailable }: {
  /** False while the full paper is shown: both PDFs stay loaded, their pages
   *  are not rendered. */
  active: boolean;
  before: string;
  after: string;
  /** Where the changes' comparison crops are. */
  files: string;
  changes: PlacedChange[];
  current: number;
  /** Each change's decision state, for its marks. */
  states: (index: number) => string;
  /** The decisions of the change being reviewed. */
  controls: (index: number) => ReactNode;
  onSelect: (index: number) => void;
  scrollRoot: RefObject<HTMLElement | null>;
  /** Where the reading place is kept. */
  readingPlace: string;
  /** The pages exist; `restored` when the reading place was restored. */
  onReady: (restored: boolean) => void;
  onUnavailable: () => void;
}) {
  const [docs, setDocs] = useState<{ before: Doc; after: Doc } | null>(null), [error, setError] = useState(""),
    ready = useRef(onReady), unavailable = useRef(onUnavailable), box = useRef<HTMLDivElement>(null);
  ready.current = onReady; unavailable.current = onUnavailable;
  // The change whose decisions are open. A click on its bar again, a click
  // elsewhere or Escape deselects it: its shade and decisions go until a
  // change is selected again, by a click or by moving through the review.
  const [panel, setPanel] = useState<number | null>(null), [deselected, setDeselected] = useState(false);
  useEffect(() => { setDeselected(false); }, [current]);
  const deselect = () => { setPanel(null); setDeselected(true); };
  const shown = deselected ? -1 : current;
  useEffect(() => {
    if (shown < 0 || !active) return;
    // Only a click on the pages away from any change deselects: the bar,
    // the change map and dialogs keep the change.
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (box.current?.contains(target) && !target?.closest(".compare-panel, .compare-bar, .compare-mark")) deselect();
    };
    // Escape first closes what is open over the review: a dialog, the help
    // or a comment being written.
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog[open], .help-backdrop, .composer")) deselect();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [shown, active]);
  const choose = (index: number) => { onSelect(index); setDeselected(false); setPanel(index); };
  useEffect(() => {
    let live = true;
    const tasks: ReturnType<typeof pdfjs.getDocument>[] = [];
    setDocs(null); setError("");
    Promise.all([open(before, tasks), open(after, tasks)]).then(
      ([old, next]) => { if (live) setDocs({ before: old, after: next }); },
      (failure: Error) => { if (!live) return; setError(failure.message); unavailable.current(); },
    );
    return () => { live = false; tasks.forEach((task) => void task.destroy()); };
  }, [before, after]);
  useEffect(() => { if (docs && active) return paint(box.current!, docs, scrollRoot.current); }, [docs, scrollRoot, active]);
  useLayoutEffect(() => { if (active) return holdReader(window); }, [active]);
  // The workspace's page, outline, zoom and find controls read the new
  // version's pages, as in the full paper; fit to width fits both versions.
  useLayoutEffect(() => {
    if (!docs || !active) return;
    const reader = fullPaperReader(box.current!, scrollRoot.current!, docs.after.pdf, readingPlace, true);
    ready.current(reader.restored);
    return () => reader.dispose();
  }, [docs, readingPlace, scrollRoot, active]);
  if (!active) return null;
  if (error) return <p className="empty" role="alert">{error}</p>;
  // Not the full paper's loading status: the review stays shown meanwhile.
  if (!docs) return <div className="compare-status" role="status"><div className="pulse" /><span>{t("Opening both versions…")}</span></div>;
  const old = place(docs.before, changes, "before"), next = place(docs.after, changes, "after");
  const rows = alignPages(docs.before.words, docs.after.words);
  // Each change's lines on a page, as a share of the page's height: where
  // its bar in the middle column runs.
  const extents = (list: Placed[], doc: Doc) => {
    const found = new Map<number, { page: number; top: number; bottom: number }>();
    for (const { index, strip, page } of list) {
      const [, y0, , y1] = scope(strip), top = (strip.top! + y0) / doc.height, bottom = (strip.top! + y1) / doc.height, extent = found.get(index);
      if (!extent) found.set(index, { page, top, bottom });
      else if (extent.page === page) { extent.top = Math.min(extent.top, top); extent.bottom = Math.max(extent.bottom, bottom); }
    }
    return found;
  };
  const oldLines = extents(old, docs.before), newLines = extents(next, docs.after);
  // A change with nothing to mark on the pages, such as an edit that prints
  // the same, still has its bar: just below the change before it, as the
  // full paper shows it after that change, or at the top of the first page.
  let previous: { page: number; bottom: number; lines: typeof newLines } | null = null;
  for (const { index } of changes) {
    const placedLines = newLines.get(index) ? newLines : oldLines.get(index) ? oldLines : null;
    if (placedLines) { const extent = placedLines.get(index)!; previous = { page: extent.page, bottom: extent.bottom, lines: placedLines }; continue; }
    const top: number = previous ? previous.bottom + 0.012 : 0.03, bottom: number = top + 0.02;
    (previous?.lines ?? newLines).set(index, { page: previous?.page ?? 0, top, bottom });
    previous = { page: previous?.page ?? 0, bottom, lines: previous?.lines ?? newLines };
  }
  const page = (side: Side, doc: Doc, number: number | null, placed: Placed[]) => {
    if (number === null) return <div className="compare-page compare-blank" style={{ aspectRatio: `${doc.width} / ${doc.height}` }} aria-hidden="true" />;
    return (
      <div className="compare-page" data-side={side} data-page={number} style={{ aspectRatio: `${doc.width} / ${doc.height}` }}
        data-reader-page={side === "after" ? number : undefined} data-pdf-width={doc.width} data-pdf-height={doc.height}
        aria-label={`${side === "before" ? t("Before") : t("After")} · ${t("p. {pages}", { pages: doc.labels?.[number] ?? String(number + 1) })}`}>
        {side === "after" && (
          // The whole page, for the reader's place and the find marks.
          <div className="paper-slice compare-reading" data-left={0} data-right={doc.width} data-top={0} data-bottom={doc.height}
            data-pdf-top={0} data-pdf-bottom={doc.height} data-reading-anchor={`${number}:0`} />
        )}
        {placed.filter((item) => item.page === number).map(({ index, strip }) => (
          <div key={`${index}:${strip.src}`} className={`compare-mark${index === shown ? " current" : ""}`} data-state={states(index)} data-side={side}
            style={{
              left: `${((strip.left ?? 0) / doc.width) * 100}%`, top: `${(strip.top! / doc.height) * 100}%`,
              width: `${(strip.width / doc.width) * 100}%`, height: `${(strip.height / doc.height) * 100}%`,
            }}
            onClick={() => choose(index)}>
            <img src={files + strip.src} alt="" draggable={false} />
            {(() => {
              // A light shade over exactly the change's lines.
              const [x0, y0, x1, y1] = scope(strip);
              return <div className="compare-shade" style={{
                left: `${(x0 / strip.width) * 100}%`, top: `${(y0 / strip.height) * 100}%`,
                width: `${((x1 - x0) / strip.width) * 100}%`, height: `${((y1 - y0) / strip.height) * 100}%`,
              }} />;
            })()}
          </div>
        ))}
      </div>
    );
  };
  // The middle column: a bar level with each change's lines, with its number
  // above. A click on it opens the change's decisions under the bar, in the
  // column, so nothing covers the pages.
  const gutter = (b: number | null, a: number | null) => (
    <div className="compare-gutter">
      {changes.flatMap(({ index }) => {
        const left = oldLines.get(index), right = newLines.get(index),
          l = left && left.page === b ? left : null, r = right && right.page === a ? right : null;
        // One bar per change: in the row of its new lines, or of its old
        // ones for a deletion, also when the two print on different rows.
        if (right ? !r : !l) return [];
        const top = Math.min(l?.top ?? 1, r?.top ?? 1), bottom = Math.max(l?.bottom ?? 0, r?.bottom ?? 0),
          open = panel === index && index === shown;
        return [
          <div key={index} className={`compare-spot${index === shown ? " current" : ""}`} data-stop={index} data-state={states(index)}
            style={{ top: `${top * 100}%`, height: `${(bottom - top) * 100}%` }}>
            <button type="button" className="compare-bar" aria-label={t("Change {n}", { n: index + 1 })} aria-current={index === shown || undefined}
              aria-expanded={open} onClick={() => open ? deselect() : choose(index)}>
              <span className="compare-index">{index + 1}</span>
            </button>
            {open && <div className="compare-panel">{controls(index)}</div>}
          </div>,
        ];
      })}
    </div>
  );
  return (
    <div className="compare" ref={box}>
      {rows.map(([b, a], i) => (
        <div className="compare-row" key={`${b}:${a}:${i}`}>
          {page("before", docs.before, b, old)}
          {gutter(b, a)}
          {page("after", docs.after, a, next)}
        </div>
      ))}
    </div>
  );
}

// Paints each page while it is within about a screen of the viewport, and
// frees its canvas further away, so a long thesis scrolls like a short paper.
function paint(container: HTMLElement, docs: { before: Doc; after: Doc }, root: HTMLElement | null) {
  const alive = new Map<HTMLElement, { canvas?: HTMLCanvasElement; task?: RenderTask }>();
  let stopped = false;
  const release = (element: HTMLElement) => {
    const entry = alive.get(element);
    alive.delete(element);
    entry?.task?.cancel();
    // A canvas painted before a resize is freed too, though its entry went.
    element.querySelectorAll<HTMLCanvasElement>(":scope > canvas").forEach((canvas) => { canvas.remove(); canvas.width = canvas.height = 0; });
  };
  const draw = async (element: HTMLElement) => {
    const entry: { canvas?: HTMLCanvasElement; task?: RenderTask } = {};
    alive.set(element, entry);
    try {
      const doc = element.dataset.side === "before" ? docs.before : docs.after,
        page = await doc.pdf.getPage(Number(element.dataset.page) + 1);
      if (stopped || alive.get(element) !== entry) return;
      const scale = (element.clientWidth * Math.min(window.devicePixelRatio || 1, 3)) / page.getViewport({ scale: 1 }).width,
        viewport = page.getViewport({ scale }), canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      entry.task = page.render({ canvas, viewport });
      await entry.task.promise;
      if (stopped || alive.get(element) !== entry) { canvas.width = canvas.height = 0; return; }
      element.querySelectorAll(":scope > canvas").forEach((old) => old.remove());
      entry.canvas = canvas;
      element.prepend(canvas);
    } catch (failure) {
      if (!stopped && (failure as Error)?.name !== "RenderingCancelledException") console.error(failure);
      if (alive.get(element) === entry) alive.delete(element);
    }
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      if (entry.isIntersecting) { if (!alive.has(element)) void draw(element); }
      else release(element);
    }
  }, { root, rootMargin: "1000px 0px" });
  const pages = () => container.querySelectorAll<HTMLElement>(".compare-page:not(.compare-blank)");
  pages().forEach((element) => observer.observe(element));
  // A wider column needs sharper pages.
  let width = container.clientWidth;
  const resized = new ResizeObserver(() => {
    if (Math.abs(container.clientWidth - width) < 1) return;
    width = container.clientWidth;
    for (const element of [...alive.keys()]) { alive.get(element)?.task?.cancel(); alive.delete(element); }
    pages().forEach((element) => { observer.unobserve(element); observer.observe(element); });
  });
  resized.observe(container);
  return () => {
    stopped = true;
    observer.disconnect(); resized.disconnect();
    for (const element of [...alive.keys()]) release(element);
  };
}
