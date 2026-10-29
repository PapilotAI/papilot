import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Task } from '../shared.ts';
import { reviewNotesInstructions } from '../notes.ts';
import { Icon } from './icons.tsx';
import { browserStorage } from './storage.ts';
import { sendsMessage } from './composer.ts';
import styles from './review-notes.css?inline';
import { mergeLines, type Rect } from './note-geometry.ts';
import { t, tn } from './i18n.ts';

type Mark = { strip: string; round: number; where: string; quote: string; rects: Rect[]; region: boolean };
type Note = Mark & { id: string; comment: string };
type Draft = { notes: Note[]; requestKey: string; editing: (Mark & { comment: string }) | null };
type Layer = { strip: HTMLElement; element: HTMLElement; key: string; round: number };
const uuid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(20)), b => b.toString(16).padStart(2, '0')).join('');
const unit = (v: number) => Math.max(0, Math.min(1, v));
const percent = ([x, y, right, bottom]: Rect) => ({ left: `${x * 100}%`, top: `${y * 100}%`, width: `${(right - x) * 100}%`, height: `${(bottom - y) * 100}%` });
const elementAt = (node: Node | null) => node?.nodeType === 1 ? node as Element : node?.parentElement;
function load(key: string): Draft {
  try {
    const value = JSON.parse(browserStorage.getItem(key) || 'null');
    if (value && Array.isArray(value.notes) && typeof value.requestKey === 'string') return value;
  } catch { /* A damaged draft must not prevent the review from opening. */ }
  return { notes: [], requestKey: uuid(), editing: null };
}
function mark(layer: Layer, rects: Rect[], quote: string, region: boolean): Mark {
  const change = layer.strip.closest('.change');
  const side = layer.strip.closest('.before') ? 'Before' : layer.strip.closest('.after') ? 'After' : 'Unchanged text';
  // The viewer may be in Chinese; the agent reads the English copies in data-change and data-location.
  const number = change?.querySelector<HTMLElement>('.change-number'), place = change?.querySelector<HTMLElement>('.change-where');
  const where = [`Round ${layer.round}`, `PDF page ${layer.strip.dataset.page || '?'}`, side,
    number?.dataset.change ? `Change ${number.dataset.change}` : number?.textContent, place?.dataset.location || place?.getAttribute('title') || place?.textContent].filter(Boolean).join(' · ');
  return { strip: layer.key, round: layer.round, where, quote, rects, region };
}

// Notes belong to the task and the exact displayed round/strip. They do not
// change accept/reject decisions, and are sent through the normal task queue.
export function ReviewNotes({ doc, task, onSend }: { doc: Document | null; task: Task; onSend: (message: { text: string; requestKey: string }) => Promise<void> }) {
  const storageKey = `papilot:review-notes:${task.id}`;
  const [draft, setDraft] = useState(() => load(storageKey));
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selection, setSelection] = useState<Mark | null>(null);
  const [region, setRegion] = useState(false), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [drag, setDrag] = useState<{ key: string; rect: Rect } | null>(null);
  const origin = useRef<{ layer: Layer; x: number; y: number } | null>(null);
  const current = useRef({ draft, region, busy }); current.current = { draft, region, busy };
  const sending = useRef(false);
  function update(value: Draft) { browserStorage.setItem(storageKey, JSON.stringify(value)); setDraft(value); }
  useEffect(() => {
    if (!doc) return;
    const mounted = new Map<HTMLElement, Layer>();
    const scan = () => {
      let changed = false;
      const strips = Array.from(doc.querySelectorAll<HTMLElement>('.pdf-strip'));
      for (const [strip, layer] of mounted) if (!strips.includes(strip)) { layer.element.remove(); mounted.delete(strip); changed = true; }
      strips.forEach((strip, index) => {
        const src = strip.querySelector('img')?.getAttribute('src') || '';
        const round = Number(src.match(/\/files\/[^/]+\/(\d+)\//)?.[1] || task.review?.round || 0);
        const key = `${round}:${index}`;
        const previous = mounted.get(strip);
        if (previous?.key === key) return;
        previous?.element.remove();
        const element = doc.createElement('div'); element.className = 'review-note-layer'; strip.append(element);
        mounted.set(strip, { strip, element, key, round }); changed = true;
      });
      if (changed) { setLayers([...mounted.values()]); setSelection(null); }
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    let timer: ReturnType<typeof setTimeout>;
    const select = () => {
      if (current.current.draft.editing || current.current.region || current.current.busy) return;
      const selected = doc.getSelection();
      if (!selected?.rangeCount || selected.isCollapsed) { setSelection(null); return; }
      const range = selected.getRangeAt(0);
      const first = elementAt(range.startContainer)?.closest<HTMLElement>('.pdf-strip');
      const last = elementAt(range.endContainer)?.closest<HTMLElement>('.pdf-strip');
      // Keep one note tied to one visible strip; never include change controls.
      const layer = first === last && first ? mounted.get(first) : null;
      if (!layer || !elementAt(range.startContainer)?.closest('.pdf-text') || !elementAt(range.endContainer)?.closest('.pdf-text')) { setSelection(null); return; }
      const box = layer.strip.getBoundingClientRect();
      const rects: Rect[] = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0).map(r => [unit((r.left - box.left) / box.width), unit((r.top - box.top) / box.height), unit((r.right - box.left) / box.width), unit((r.bottom - box.top) / box.height)]);
      const quote = selected.toString().replace(/\s+/g, ' ').trim();
      setSelection(quote && rects.length ? mark(layer, mergeLines(rects), quote, false) : null);
    };
    const selectionChanged = () => { clearTimeout(timer); timer = setTimeout(select, 100); };
    doc.addEventListener('selectionchange', selectionChanged);
    return () => { clearTimeout(timer); observer.disconnect(); doc.removeEventListener('selectionchange', selectionChanged); for (const layer of mounted.values()) layer.element.remove(); };
  }, [doc, task.review?.round]);
  function edit(mark: Mark) {
    update({ ...current.current.draft, editing: { ...mark, comment: '' } });
    setSelection(null); setRegion(false); setOpen(true); doc?.getSelection()?.removeAllRanges();
  }
  function save() {
    const value = current.current.draft, editing = value.editing;
    if (!editing?.comment.trim() || busy) return;
    update({ notes: [...value.notes, { ...editing, comment: editing.comment.trim(), id: uuid() }], editing: null, requestKey: uuid() });
  }
  async function send() {
    if (sending.current || !draft.notes.length || draft.editing) return;
    sending.current = true; setBusy(true); setError('');
    const submitted = draft;
    try {
      await onSend({ requestKey: submitted.requestKey, text: reviewNotesInstructions(submitted.notes.map(note => ({
        where: note.where + (note.region ? ` · Region in displayed strip: ${note.rects[0].map(v => `${Math.round(v * 100)}%`).join(', ')}` : ''), quote: note.quote, comment: note.comment,
      }))) });
      // A different mount may have saved more notes while this request was pending.
      const saved = load(storageKey);
      if (saved.requestKey === submitted.requestKey) update({ notes: [], editing: null, requestKey: uuid() });
      else setDraft(saved);
      setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { sending.current = false; setBusy(false); }
  }
  const blocked = task.status === 'uncertain' || task.status === 'deleting';
  return <>
    <button type="button" className="icon-button" aria-label={t('Mark region')} title={t('Mark a region in the review PDF')} aria-pressed={region} disabled={!doc || busy || Boolean(draft.editing)} onClick={() => { setRegion(!region); setOpen(false); setSelection(null); }}><Icon name="region" size={15}/></button>
    <button type="button" className="button ghost compact review-notes-toggle" aria-label={draft.notes.length ? t('Review notes, {n}', { n: draft.notes.length }) : t('Review notes')} aria-pressed={open} disabled={!doc} onClick={() => setOpen(!open)}><Icon name="notes" size={15}/><span>{draft.notes.length || t('Notes')}</span></button>
    {doc && createPortal(<style>{styles}</style>, doc.head)}
    {layers.map(layer => createPortal(<Fragment>
      {draft.notes.filter(note => note.strip === layer.key).map(note => <Fragment key={note.id}>
        {note.rects.map((rect, i) => <div key={i} className={note.region ? 'review-note-box' : 'review-note-mark'} style={percent(rect)}/>)}
        <button className="review-note-tag" style={{ top: `${note.rects[0][1] * 100}%` }} title={note.comment} aria-label={t('Review note: {comment}', { comment: note.comment })} onClick={() => setOpen(true)}>{draft.notes.indexOf(note) + 1}</button>
      </Fragment>)}
      {draft.editing?.strip === layer.key && draft.editing.rects.map((rect, i) => <div key={i} className={draft.editing!.region ? 'review-note-box' : 'review-note-mark'} style={percent(rect)}/>)}
      {region && <div className="review-region-capture" onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
        const box = layer.strip.getBoundingClientRect(), x = unit((e.clientX - box.left) / box.width), y = unit((e.clientY - box.top) / box.height);
        origin.current = { layer, x, y }; setDrag({ key: layer.key, rect: [x, y, x, y] });
      }} onPointerMove={e => {
        const start = origin.current; if (!start) return;
        const box = start.layer.strip.getBoundingClientRect(), x = unit((e.clientX - box.left) / box.width), y = unit((e.clientY - box.top) / box.height);
        setDrag({ key: start.layer.key, rect: [Math.min(start.x, x), Math.min(start.y, y), Math.max(start.x, x), Math.max(start.y, y)] });
      }} onPointerUp={e => {
        const start = origin.current; origin.current = null; setDrag(null);
        if (!start) return;
        const box = start.layer.strip.getBoundingClientRect(), x = unit((e.clientX - box.left) / box.width), y = unit((e.clientY - box.top) / box.height);
        const rect: Rect = [Math.min(start.x, x), Math.min(start.y, y), Math.max(start.x, x), Math.max(start.y, y)];
        if ((rect[2] - rect[0]) * box.width < 4 || (rect[3] - rect[1]) * box.height < 4) return;
        // Keep nearby PDF text as a locator for figures and equations too.
        const quote = (start.layer.strip.querySelector('.pdf-text')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
        edit(mark(start.layer, [rect], quote, true));
      }} onPointerCancel={() => { origin.current = null; setDrag(null); }}/>}
      {drag?.key === layer.key && <div className="review-note-box" style={percent(drag.rect)}/>}
      {selection?.strip === layer.key && !draft.editing && !busy && <button className="review-add-note" style={{ left: `${Math.min(80, selection.rects.at(-1)![2] * 100)}%`, top: `${selection.rects.at(-1)![3] * 100}%` }} onPointerDown={e => e.preventDefault()} onClick={() => edit(selection)}>{t('Add note')}</button>}
    </Fragment>, layer.element, layer.key))}
    {doc && (open || region) && createPortal(<aside className="review-notes-panel" aria-label={t('Review PDF notes')} onKeyDown={e => {
      // Do not let the review engine interpret note-editor shortcuts as decisions.
      e.stopPropagation();
      if (e.key === 'Escape' && !busy) { setOpen(false); setRegion(false); }
    }}>
      <header><strong>{region ? t('Mark region') : draft.notes.length ? t('Review notes ({n})', { n: draft.notes.length }) : t('Review notes')}</strong><button type="button" aria-label={t('Close review notes')} onClick={() => { setOpen(false); setRegion(false); }}>×</button></header>
      {region ? <p>{t('Drag over a figure, equation or paragraph to add a note.')}</p> : <>
        {draft.editing ? <form onSubmit={e => { e.preventDefault(); save(); }}>
          <small>{draft.editing.where}</small>
          {draft.editing.quote && <blockquote>{draft.editing.quote}</blockquote>}
          <textarea autoFocus aria-label={t('Note for the agent')} rows={3} placeholder={t('What should change here?')} value={draft.editing.comment} onChange={e => update({ ...draft, editing: { ...draft.editing!, comment: e.target.value } })} onKeyDown={e => { if (sendsMessage(e.nativeEvent, window.matchMedia('(pointer: coarse)').matches)) { e.preventDefault(); save(); } }}/>
          <footer><button type="button" onClick={() => update({ ...draft, editing: null })}>{t('Cancel')}</button><button className="primary" disabled={!draft.editing.comment.trim()}>{t('Add note')}</button></footer>
        </form> : <>
          {draft.notes.length ? <ol>{draft.notes.map((note, index) => <li key={note.id}>
            <div><button className="review-note-location" onClick={() => { layers.find(layer => layer.key === note.strip)?.strip.scrollIntoView({ block: 'center' }); setOpen(false); }}>{index + 1}. {note.where}</button><button type="button" aria-label={t('Delete review note {n}', { n: index + 1 })} disabled={busy} onClick={() => update({ ...draft, notes: draft.notes.filter(item => item.id !== note.id), requestKey: uuid() })}>×</button></div>
            {note.quote && <blockquote>{note.quote}</blockquote>}<p>{note.comment}</p>
            {note.round !== task.review?.round && <small>{t('Marked on an earlier review round.')}</small>}
          </li>)}</ol> : <p>{t('Select text in the review PDF and choose Add note, or use Mark region. Notes can also be added to accepted, rejected and unchanged text.')}</p>}
          {error && <p className="review-notes-error" role="alert">{error}</p>}
          {blocked && <p>{t('Check the task status before sending notes.')}</p>}
          <footer><button className="primary" disabled={!draft.notes.length || busy || blocked} onClick={() => void send()}>{busy ? t('Sending…') : draft.notes.length ? tn(draft.notes.length, 'Send {n} note to the agent', 'Send {n} notes to the agent') : t('Send notes to the agent')}</button></footer>
        </>}
      </>}
    </aside>, doc.body)}
  </>;
}
