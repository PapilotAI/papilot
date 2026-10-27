import { forwardRef, Fragment, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { EventBus, FindState, LinkTarget, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import viewerStyles from 'pdfjs-dist/web/pdf_viewer.css?inline';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Annotation } from '../shared.ts';
import { ActionMenu } from './action-menu.tsx';
import { ChipSelect } from './chip-select.tsx';
import { sendsMessage } from './composer.ts';
import { Icon } from './icons.tsx';
import { browserStorage } from './storage.ts';

pdfjs.GlobalWorkerOptions.workerSrc = worker;

// The pdf.js stylesheet also styles pdf.js's own app (.sidebar, .dialog) and
// sets a dark color scheme on :root; keep all of it inside the viewer.
const styles = document.createElement('style');
styles.textContent = `@scope (.pdf-view) {${viewerStyles.replaceAll(':root', ':scope').replace(/color-scheme:\s*light dark;?/g, '')}}`;
document.head.append(styles);

export type Rect = [number, number, number, number];
export interface OutlineItem { title: string; level: number; dest: unknown; page: number; top: number | null }
export interface PdfHandle { goTo: (item: OutlineItem) => void; goToNote: (note: Annotation) => void }
interface Selection { page: number; rects: Rect[]; quote: string }

const touch = () => window.matchMedia('(pointer: coarse)').matches;
const unit = (value: number) => Math.min(1, Math.max(0, value));
const percent = ([x0, y0, x1, y1]: Rect): React.CSSProperties => ({ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` });
const bounds = (rects: Rect[]): Rect => [Math.min(...rects.map(r => r[0])), Math.min(...rects.map(r => r[1])), Math.max(...rects.map(r => r[2])), Math.max(...rects.map(r => r[3]))];
const zooms = [{ value: 'page-width', label: 'Fit width' }, { value: 'page-fit', label: 'Fit page' }, ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map(scale => ({ value: String(scale), label: `${scale * 100}%` }))];

// A note covers whole words: a drag that starts or ends inside a word takes
// all of it, so the quote is readable and the highlight matches it. Only a
// boundary that cuts through a word widens; one already beside a word (the
// browser often ends a drag at the start of the next word) stays. Returns the
// widened range and the word pieces it added at each end.
function wholeWords(selected: Range) {
  const range = selected.cloneRange(), letter = /[\p{L}\p{N}]/u, start = range.startContainer, end = range.endContainer;
  let before = '', after = '';
  if (start.nodeType === Node.TEXT_NODE) {
    const text = start.textContent || ''; let at = range.startOffset;
    if (letter.test(text[at] || '')) while (at > 0 && letter.test(text[at - 1])) at--;
    before = text.slice(at, range.startOffset); range.setStart(start, at);
  }
  if (end.nodeType === Node.TEXT_NODE) {
    const text = end.textContent || ''; let at = range.endOffset;
    if (at > 0 && letter.test(text[at - 1])) while (at < text.length && letter.test(text[at])) at++;
    after = text.slice(range.endOffset, at); range.setEnd(end, at);
  }
  return { range, before, after };
}

// pdf.js lays each line of text out as one run in a stand-in font, which
// drifts from the printed words mid-line, so a drag selects other words than
// the ones under the pointer. The server reads each word's printed place from
// the PDF; selection and search use one run per word from it, placed on the
// word's baseline, and fall back to pdf.js's own text if that is unavailable.
type Words = { words: [string, number, number, number, number, number][] };
function exactText(document: PDFDocumentProxy, source: string) {
  const getPage = document.getPage.bind(document), pages = new Map<number, Promise<PDFPageProxy>>();
  document.getPage = (number: number) => {
    if (!pages.has(number)) pages.set(number, getPage(number).then(page => {
      if (page.rotate % 360 !== 0) return page;
      const own = page.getTextContent.bind(page);
      let exact: Promise<ReturnType<typeof textContent> | null> | null = null;
      const content = () => exact ??= fetch(`${source}&page=${number - 1}`).then(response => response.ok ? response.json() : null).then((data: Words | null) => data ? textContent(data, page.view) : null, () => null);
      page.getTextContent = (async (params?: Parameters<PDFPageProxy['getTextContent']>[0]) => (await content()) || own(params)) as PDFPageProxy['getTextContent'];
      page.streamTextContent = ((params?: Parameters<PDFPageProxy['getTextContent']>[0]) => new ReadableStream({ async start(controller) { controller.enqueue((await content()) || await own(params)); controller.close(); } })) as PDFPageProxy['streamTextContent'];
      return page;
    }));
    return pages.get(number)!;
  };
}
// A word followed by another on its line carries the space and reaches the
// next word's start, so a drag can begin in the gap between words.
function textContent({ words }: Words, view: number[]) {
  const items = words.map(([str, left, baseline, size, width, eol], index) => {
    const next = words[index + 1], joined = !eol && next && next[1] > left;
    return { str: joined ? str + ' ' : str, dir: 'ltr', width: joined ? next[1] - left : width, height: size, transform: [size, 0, 0, size, view[0] + left, view[3] - baseline], fontName: 'exact', hasEOL: Boolean(eol) };
  });
  return { items, styles: { exact: { fontFamily: 'serif', ascent: 0.8, descent: -0.2, vertical: false } }, lang: null };
}

// Number tags sit in the page margin level with the first marked line, on the
// side nearer the mark, so they never cover text; tags on one line step outwards.
function tagSpots(firsts: Rect[]) {
  const placed: { side: 'left' | 'right'; top: number }[] = [];
  return firsts.map(rect => {
    const side: 'left' | 'right' = (rect[0] + rect[2]) / 2 > 0.5 ? 'right' : 'left', top = (rect[1] + rect[3]) / 2;
    const slot = placed.filter(spot => spot.side === side && Math.abs(spot.top - top) < 0.015).length;
    placed.push({ side, top });
    return { [side]: 8 + slot * 24, top: `${top * 100}%` } as React.CSSProperties;
  });
}

// Text layers report one rectangle per span; join those on the same line so a
// selection is stored and highlighted line by line.
export function mergeLines(rects: Rect[]) {
  const lines: Rect[] = [];
  for (const r of [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    const line = lines.find(l => Math.abs((l[1] + l[3]) / 2 - (r[1] + r[3]) / 2) < Math.min(l[3] - l[1], r[3] - r[1]) / 2 && r[0] <= l[2] + 0.02);
    if (line) { line[0] = Math.min(line[0], r[0]); line[1] = Math.min(line[1], r[1]); line[2] = Math.max(line[2], r[2]); line[3] = Math.max(line[3], r[3]); }
    else lines.push([...r]);
  }
  return lines;
}

// PDF bookmarks (hyperref writes them) with the page and height each one opens.
async function readOutline(document: PDFDocumentProxy) {
  const items: OutlineItem[] = [];
  async function walk(nodes: Awaited<ReturnType<PDFDocumentProxy['getOutline']>> | undefined, level: number) {
    for (const node of nodes || []) {
      const dest = typeof node.dest === 'string' ? await document.getDestination(node.dest).catch(() => null) : node.dest;
      let page = 0, top: number | null = null;
      if (Array.isArray(dest) && dest[0] !== undefined && dest[0] !== null) {
        page = typeof dest[0] === 'number' ? dest[0] + 1 : await document.getPageIndex(dest[0]).then(index => index + 1, () => 0);
        const kind = (dest[1] as { name?: string } | undefined)?.name;
        top = kind === 'XYZ' && typeof dest[3] === 'number' ? dest[3] : (kind === 'FitH' || kind === 'FitBH') && typeof dest[2] === 'number' ? dest[2] : null;
      }
      if (page) items.push({ title: node.title.trim(), level, dest: node.dest, page, top });
      await walk(node.items, level + 1);
    }
  }
  await walk(await document.getOutline(), 0);
  return items;
}

export function NoteEditor({ rect, onSave, onCancel }: { rect: Rect; onSave: (comment: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    if (!text.trim() || busy) return;
    setBusy(true); setError('');
    try { await onSave(text.trim()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  // Open below the marked text, or above it when it ends near the bottom of the page.
  const below = rect[3] < 0.75;
  return <form className="note-editor" style={{ left: `min(${rect[0] * 100}%, calc(100% - min(340px, 100%)))`, ...(below ? { top: `calc(${rect[3] * 100}% + 8px)` } : { bottom: `calc(${(1 - rect[1]) * 100}% + 8px)` }) }} onPointerDown={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void save(); }}>
    <textarea autoFocus aria-label="Note for the agent" placeholder="What should change here?" rows={3} value={text} readOnly={busy} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } else if (sendsMessage(e.nativeEvent, touch())) { e.preventDefault(); void save(); } }}/>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="button-row"><button type="button" className="button secondary compact" disabled={busy} onClick={onCancel}>Cancel</button><button className="button primary compact" disabled={busy || !text.trim()}>{busy ? 'Adding…' : 'Add note'}</button></div>
  </form>;
}

// A pdf.js viewer that behaves like a local PDF reader: continuous pages,
// crisp zoom, selectable text, search, links and bookmarks. Notes live in a
// layer above each page; pdf.js clears unknown children when it redraws a
// page, so each layer is re-attached after rendering.
export const PdfView = forwardRef<PdfHandle, {
  url: string; words?: string; notes: { note: Annotation; number: number }[]; active: string; region: boolean; setRegion: (on: boolean) => void;
  onCreate: (page: number, rect: Rect, rects: Rect[], quote: string, comment: string) => Promise<void>;
  onSelect: (note: Annotation) => void; outline: OutlineItem[]; section: number;
  onOutline: (items: OutlineItem[]) => void; onSection: (index: number) => void;
}>(function PdfView(props, ref) {
  const latest = useRef(props); latest.current = props;
  const container = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null), findInput = useRef<HTMLInputElement>(null);
  const tools = useRef<{ bus: EventBus; links: PDFLinkService; find: PDFFindController; viewer: PDFViewer } | null>(null);
  const loaded = useRef<PDFDocumentProxy | null>(null), restore = useRef<{ scale: string; top: number; left: number } | null>(null);
  const layerMap = useRef(new Map<number, HTMLElement>());
  const [layers, setLayers] = useState(new Map<number, HTMLElement>());
  const [pages, setPages] = useState(0), [page, setPage] = useState(1), [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState({ value: 'page-width', scale: 1 });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [findOpen, setFindOpen] = useState(false), [query, setQuery] = useState(''), [matches, setMatches] = useState({ current: 0, total: 0 }), [notFound, setNotFound] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<{ page: number; rect: Rect; rects: Rect[]; quote: string } | null>(null);
  const [draft, updateDraft] = useState<{ page: number; rect: Rect } | null>(null), draftRef = useRef(draft);
  const setDraft = (value: typeof draft) => { draftRef.current = value; updateDraft(value); };
  const origin = useRef<{ page: number; x: number; y: number; box: DOMRect } | null>(null);

  useImperativeHandle(ref, () => ({
    goTo(item) { latest.current.onSection(latest.current.outline.indexOf(item)); void tools.current?.links.goToDestination(item.dest as string | unknown[]); },
    goToNote(note) {
      const div = tools.current?.viewer.getPageView(note.page)?.div, box = container.current;
      if (!div || !box) return;
      box.scrollTo({ top: box.scrollTop + div.getBoundingClientRect().top - box.getBoundingClientRect().top + note.rect[1] * div.offsetHeight - 96, behavior: 'smooth' });
    },
  }), []);

  useEffect(() => {
    const box = container.current!, bus = new EventBus();
    const links = new PDFLinkService({ eventBus: bus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer' });
    const find = new PDFFindController({ eventBus: bus, linkService: links });
    const viewer = new PDFViewer({ container: box, viewer: inner.current!, eventBus: bus, linkService: links, findController: find, removePageBorders: true, annotationMode: pdfjs.AnnotationMode.ENABLE });
    links.setViewer(viewer);
    tools.current = { bus, links, find, viewer };
    const attach = ({ pageNumber, source }: { pageNumber: number; source?: { div?: HTMLElement } }) => {
      const div = source?.div ?? viewer.getPageView(pageNumber - 1)?.div;
      if (!div) return;
      let layer = layerMap.current.get(pageNumber);
      if (!layer) { layer = document.createElement('div'); layer.className = 'note-layer'; layerMap.current.set(pageNumber, layer); setLayers(new Map(layerMap.current)); }
      if (layer.parentElement !== div) div.append(layer);
    };
    bus.on('pagerendered', attach); bus.on('textlayerrendered', attach); bus.on('annotationlayerrendered', attach);
    bus.on('pagesinit', () => {
      const keep = restore.current; restore.current = null;
      viewer.currentScaleValue = keep?.scale || browserStorage.getItem('papilot:pdf-zoom') || 'page-width';
      if (keep) { box.scrollTop = keep.top; box.scrollLeft = keep.left; }
    });
    bus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => { setPage(pageNumber); setPageInput(String(pageNumber)); });
    bus.on('scalechanging', ({ scale, presetValue }: { scale: number; presetValue?: string }) => {
      setZoom({ value: presetValue || String(scale), scale });
      if (presetValue) browserStorage.setItem('papilot:pdf-zoom', presetValue); else browserStorage.setItem('papilot:pdf-zoom', String(Math.round(scale * 100) / 100));
    });
    // The current section is the last bookmark above a line 40% down the view
    // (PDF units grow upwards); at the end of the document it is the last one.
    bus.on('updateviewarea', ({ location }: { location?: { pageNumber: number; top: number; scale: number } }) => {
      if (!location) return;
      const items = latest.current.outline, reading = location.top - box.clientHeight * 0.4 / (viewer.currentScale * 96 / 72);
      let current = -1;
      items.forEach((item, index) => { if (item.page < location.pageNumber || (item.page === location.pageNumber && (item.top === null || item.top >= reading))) current = index; });
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2 && items.length) current = items.length - 1;
      if (current !== latest.current.section) latest.current.onSection(current);
    });
    bus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: { current: number; total: number } }) => setMatches(matchesCount));
    bus.on('updatefindcontrolstate', ({ state, matchesCount }: { state: number; matchesCount?: { current: number; total: number } }) => { setNotFound(state === FindState.NOT_FOUND); if (matchesCount) setMatches(matchesCount); });
    // Trackpad pinches arrive as ctrl+wheel; touch pinches are handled here so
    // the page zooms instead of the whole workspace.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); viewer.updateScale({ drawingDelay: 250, scaleFactor: Math.exp(-e.deltaY / 100), origin: [e.clientX, e.clientY] });
    };
    let pinch: number | null = null;
    const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const touchStart = (e: TouchEvent) => { if (e.touches.length === 2) pinch = spread(e.touches); };
    const touchMove = (e: TouchEvent) => {
      if (pinch === null || e.touches.length !== 2) return;
      e.preventDefault();
      const distance = spread(e.touches);
      viewer.updateScale({ drawingDelay: 250, scaleFactor: distance / pinch, origin: [(e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2] });
      pinch = distance;
    };
    const touchEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; };
    box.addEventListener('wheel', wheel, { passive: false });
    box.addEventListener('touchstart', touchStart, { passive: true });
    box.addEventListener('touchmove', touchMove, { passive: false });
    box.addEventListener('touchend', touchEnd);
    // A text selection on one page offers "Add note" beside it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const select = () => {
      const current = document.getSelection();
      if (!current || current.isCollapsed || !current.rangeCount) { setSelection(null); return; }
      const { range, before, after } = wholeWords(current.getRangeAt(0)), node = range.startContainer, element = node instanceof Element ? node : node.parentElement;
      const pageDiv = element?.closest<HTMLElement>('.page');
      if (!pageDiv || !box.contains(pageDiv)) { setSelection(null); return; }
      const frame = pageDiv.getBoundingClientRect();
      const rects = mergeLines(Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1 && r.top >= frame.top - 1 && r.bottom <= frame.bottom + 1)
        .map(r => [unit((r.left - frame.left) / frame.width), unit((r.top - frame.top) / frame.height), unit((r.right - frame.left) / frame.width), unit((r.bottom - frame.top) / frame.height)] as Rect));
      // The selection's own text keeps pdf.js's line breaks as spaces.
      const quote = (before + current.toString() + after).replace(/\s+/g, ' ').trim();
      setSelection(rects.length && quote ? { page: Number(pageDiv.dataset.pageNumber) - 1, rects, quote } : null);
    };
    const selectionChange = () => { clearTimeout(timer); timer = setTimeout(select, 120); };
    document.addEventListener('selectionchange', selectionChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', selectionChange);
      box.removeEventListener('wheel', wheel); box.removeEventListener('touchstart', touchStart); box.removeEventListener('touchmove', touchMove); box.removeEventListener('touchend', touchEnd);
      viewer.cleanup(); void loaded.current?.loadingTask.destroy(); loaded.current = null; tools.current = null; layerMap.current.clear();
    };
  }, []);

  // A recompiled manuscript opens at the same place and zoom.
  useEffect(() => {
    const current = tools.current!, box = container.current!;
    let cancelled = false, settled = false;
    if (loaded.current) restore.current = { scale: current.viewer.currentScaleValue, top: box.scrollTop, left: box.scrollLeft };
    setLoading(!loaded.current); setError('');
    const task = pdfjs.getDocument({ url: props.url, enableXfa: false });
    task.promise.then(async document => {
      settled = true;
      if (cancelled) { void document.loadingTask.destroy(); return; }
      const previous = loaded.current;
      loaded.current = document; layerMap.current.clear(); setLayers(new Map()); setSelection(null); setEditing(null);
      if (latest.current.words) exactText(document, latest.current.words);
      current.viewer.setDocument(document); current.links.setDocument(document, null);
      setPages(document.numPages); setLoading(false);
      void previous?.loadingTask.destroy();
      const items = await readOutline(document).catch(() => []);
      if (!cancelled) latest.current.onOutline(items);
    }, failure => { settled = true; if (!cancelled) { setError(failure instanceof Error ? failure.message : String(failure)); setLoading(false); } });
    return () => { cancelled = true; if (!settled) void task.destroy(); };
  }, [props.url]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const viewer = tools.current?.viewer, mod = e.metaKey || e.ctrlKey;
      if (!viewer || e.defaultPrevented) return;
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); if (findInput.current) findInput.current.select(); else setFindOpen(true); }
      else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); viewer.increaseScale(); }
      else if (mod && e.key === '-') { e.preventDefault(); viewer.decreaseScale(); }
      else if (mod && e.key === '0') { e.preventDefault(); viewer.currentScaleValue = 'page-width'; }
      else if (e.key === 'Escape' && latest.current.region) latest.current.setRegion(false);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  function search(again: boolean, previous = false, text = query) {
    tools.current?.bus.dispatch('find', { source: null, type: again ? 'again' : '', query: text, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
  }
  function closeFind() { setFindOpen(false); setQuery(''); setMatches({ current: 0, total: 0 }); setNotFound(false); tools.current?.bus.dispatch('findbarclose', { source: null }); }
  function goToPage() {
    const viewer = tools.current?.viewer, number = Number.parseInt(pageInput, 10);
    if (viewer && number >= 1 && number <= pages) viewer.currentPageNumber = number; else setPageInput(String(page));
  }
  function startNote() {
    if (!selection) return;
    setEditing({ page: selection.page, rect: bounds(selection.rects), rects: selection.rects, quote: selection.quote });
    document.getSelection()?.removeAllRanges(); setSelection(null);
  }
  async function save(comment: string) {
    if (!editing) return;
    await latest.current.onCreate(editing.page, editing.rect, editing.rects, editing.quote, comment);
    setEditing(null); latest.current.setRegion(false);
  }
  const section = props.outline[props.section];
  const zoomLabel = zooms.find(option => option.value === zoom.value) ? zoom.value : String(Math.round(zoom.scale * 100) / 100);
  const zoomOptions = zooms.some(option => option.value === zoomLabel) ? zooms : [...zooms, { value: zoomLabel, label: `${Math.round(zoom.scale * 100)}%` }];

  return <div className={'pdf-view' + (props.region ? ' marking' : '')}>
    <div className="pdf-toolbar" role="toolbar" aria-label="PDF controls">
      <ActionMenu label="Contents" className="pdf-section" menuClassName="outline-menu" align="start" actions={props.outline.length
        ? props.outline.map((item, index) => ({ id: String(index), label: item.title, hint: String(item.page), indent: Math.min(item.level, 4), checked: index === props.section, select: () => { props.onSection(index); void tools.current?.links.goToDestination(item.dest as string | unknown[]); } }))
        : [{ label: 'This PDF has no bookmarks', disabled: true }]}>
        <Icon name="list" size={16}/><span className="pdf-section-title">{section?.title || 'Contents'}</span><Icon name="chevronDown" size={14}/>
      </ActionMenu>
      <div className="pdf-pager">
        <button type="button" className="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => tools.current?.viewer.previousPage()}><Icon name="chevronUp" size={16}/></button>
        <input aria-label="Page number" inputMode="numeric" value={pageInput} onChange={e => setPageInput(e.target.value.replace(/\D/g, ''))} onFocus={e => e.currentTarget.select()} onBlur={() => setPageInput(String(page))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goToPage(); e.currentTarget.blur(); } }}/>
        <span className="pdf-pages">/ {pages || '–'}</span>
        <button type="button" className="icon-button" aria-label="Next page" disabled={page >= pages} onClick={() => tools.current?.viewer.nextPage()}><Icon name="chevronDown" size={16}/></button>
      </div>
      <div className="pdf-zoom">
        <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out (⌘−)" onClick={() => tools.current?.viewer.decreaseScale()}><Icon name="minus" size={16}/></button>
        <ChipSelect className="zoom-chip" label="Zoom" value={zoomLabel} options={zoomOptions} onChange={value => { if (tools.current) tools.current.viewer.currentScaleValue = value; }}/>
        <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in (⌘+)" onClick={() => tools.current?.viewer.increaseScale()}><Icon name="plus" size={16}/></button>
      </div>
      <button type="button" className={'icon-button' + (findOpen ? ' active' : '')} aria-label="Find in PDF" aria-pressed={findOpen} title="Find (⌘F)" onClick={() => { if (findOpen) closeFind(); else setFindOpen(true); }}><Icon name="search" size={16}/></button>
      <button type="button" className={'icon-button region-toggle' + (props.region ? ' active' : '')} aria-label="Mark region" aria-pressed={props.region} title="Mark a figure or region" onClick={() => props.setRegion(!props.region)}><Icon name="region" size={16}/></button>
    </div>
    {findOpen && <div className="pdf-find">
      <Icon name="search" size={15}/>
      <input ref={findInput} autoFocus aria-label="Search the PDF" placeholder="Find in PDF" value={query} onChange={e => { setQuery(e.target.value); search(false, false, e.target.value); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(true, e.shiftKey); } else if (e.key === 'Escape') { e.preventDefault(); closeFind(); } }}/>
      <span className="pdf-find-count" aria-live="polite">{query ? notFound ? 'No matches' : matches.total ? `${matches.current} of ${matches.total}` : '' : ''}</span>
      <button type="button" className="icon-button" aria-label="Previous match" disabled={!matches.total} onClick={() => search(true, true)}><Icon name="chevronUp" size={16}/></button>
      <button type="button" className="icon-button" aria-label="Next match" disabled={!matches.total} onClick={() => search(true)}><Icon name="chevronDown" size={16}/></button>
      <button type="button" className="icon-button" aria-label="Close search" onClick={closeFind}><Icon name="close" size={15}/></button>
    </div>}
    {props.region && <div className="pdf-hint">Drag across the page to mark a figure, equation or region. Press Escape to stop.</div>}
    <div className="pdf-scroll-host">
      <div ref={container} className="pdf-container" tabIndex={0} aria-label="PDF pages">
        <div ref={inner} className="pdfViewer"/>
      </div>
      {(loading || error) && <div className="review-loading"><p role={error ? 'alert' : 'status'}>{error ? `The PDF could not be opened: ${error}` : 'Opening the PDF…'}</p></div>}
    </div>
    {[...layers].map(([number, layer]) => createPortal(<Fragment>
      {(() => {
        const notes = props.notes.filter(({ note }) => note.page === number - 1), spots = tagSpots(notes.map(({ note }) => (note.rects?.length ? note.rects : [note.rect])[0]));
        return notes.map(({ note, number: label }, index) => <Fragment key={note.id}>
          {(note.rects?.length ? note.rects : [note.rect]).map((rect, part) => <div key={part} className={(note.rects?.length ? 'note-mark' : 'note-box') + (props.active === note.id ? ' active' : '')} style={percent(rect)}/>)}
          <button type="button" className={'note-tag' + (props.active === note.id ? ' active' : '')} style={spots[index]} aria-label={`Note ${label}: ${note.comment}`} title={note.comment} onClick={() => props.onSelect(note)}>{label}</button>
        </Fragment>);
      })()}
      {props.region && <div className="region-capture"
        onPointerDown={e => {
          if (editing || e.button > 0) return;
          e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
          const box = e.currentTarget.getBoundingClientRect(), x = unit((e.clientX - box.left) / box.width), y = unit((e.clientY - box.top) / box.height);
          origin.current = { page: number - 1, x, y, box }; setDraft({ page: number - 1, rect: [x, y, x, y] });
        }}
        onPointerMove={e => { const start = origin.current; if (!start) return; const x = unit((e.clientX - start.box.left) / start.box.width), y = unit((e.clientY - start.box.top) / start.box.height); setDraft({ page: start.page, rect: [Math.min(start.x, x), Math.min(start.y, y), Math.max(start.x, x), Math.max(start.y, y)] }); }}
        onPointerUp={() => {
          const current = draftRef.current; origin.current = null; setDraft(null);
          if (current && (current.rect[2] - current.rect[0] > 0.015 || current.rect[3] - current.rect[1] > 0.01)) setEditing({ page: current.page, rect: current.rect, rects: [], quote: '' });
        }}/>}
      {draft?.page === number - 1 && <div className="note-box draft" style={percent(draft.rect)}/>}
      {selection?.page === number - 1 && !editing && <button type="button" className="add-note" style={{ left: `${selection.rects[selection.rects.length - 1][2] * 100}%`, top: `${selection.rects[selection.rects.length - 1][3] * 100}%` }} onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()} onClick={startNote}><Icon name="pencil" size={14}/>Add note</button>}
      {editing?.page === number - 1 && <>
        {(editing.rects.length ? editing.rects : [editing.rect]).map((rect, index) => <div key={index} className={(editing.rects.length ? 'note-mark' : 'note-box') + ' draft'} style={percent(rect)}/>)}
        <NoteEditor rect={editing.rect} onCancel={() => { setEditing(null); }} onSave={save}/>
      </>}
    </Fragment>, layer, `layer-${number}`))}
  </div>;
});
