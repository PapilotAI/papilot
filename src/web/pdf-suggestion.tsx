import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AGENT_NAMES, type Annotation } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './pdf-suggestion.css';
import { groupName } from './note-groups.tsx';
import { sendsMessage } from './composer.ts';

export interface PdfNoteActions {
  has: (id: string) => boolean;
  toggle: (note: Annotation) => void;
  remove: (note: Annotation) => Promise<void>;
  restore: (note: Annotation) => Promise<void>;
  edit: (note: Annotation, comment: string) => Promise<void>;
  onEditing: (editing: boolean) => void;
  onBusy: (busy: boolean) => void;
  disabled: boolean;
}

// The card lives in the PDF's annotation layer. Reposition it around its text
// anchor on zoom/scroll, keeping it inside both the page and visible PDF area.
export function PdfNoteCard({ note, number, index, total, selected, busy, error, onToggle, onDismiss, onClose, onPrevious, onNext, onSave, onEditing }: {
  note: Annotation; number: number; index: number; total: number; selected: boolean; busy: boolean; error: string;
  onToggle: () => void; onDismiss: () => void; onClose: () => void; onPrevious: () => void; onNext: () => void;
  onSave: (comment: string) => Promise<boolean>; onEditing: (editing: boolean) => void;
}) {
  const card = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null, ai = Boolean(note.aiReview);
  useEffect(() => { onEditing(editing); return () => onEditing(false); }, [editing, onEditing]);
  async function save() { if (!busy && draft?.trim() && await onSave(draft.trim())) setDraft(null); }
  useLayoutEffect(() => {
    const element = card.current!, layer = element.closest<HTMLElement>('.note-layer')!, viewport = element.closest<HTMLElement>('.pdf-container')!;
    let frame = 0;
    const place = () => {
      const page = layer.getBoundingClientRect(), view = viewport.getBoundingClientRect();
      const left = Math.max(page.left, view.left) + 8, right = Math.min(page.right, view.right) - 8;
      const top = Math.max(page.top, view.top) + 8, bottom = Math.min(page.bottom, view.bottom) - 8;
      const anchor = { left: page.left + note.rect[0] * page.width, right: page.left + note.rect[2] * page.width, top: page.top + note.rect[1] * page.height, bottom: page.top + note.rect[3] * page.height };
      const visible = right > left && bottom > top && anchor.bottom >= top && anchor.top <= bottom && anchor.right >= left && anchor.left <= right;
      element.style.visibility = visible ? 'visible' : 'hidden';
      if (!visible) return;
      const width = Math.min(note.aiReview ? 330 : 280, right - left);
      element.style.width = `${width}px`;
      element.style.maxHeight = `${bottom - top}px`;
      const height = element.getBoundingClientRect().height;
      // Use space beside the passage when possible; otherwise sit just below
      // it, or above when the passage is near the foot of the visible page.
      const beside = right - anchor.right >= width + 12;
      const x = beside ? anchor.right + 12 : Math.max(left, Math.min(anchor.left, right - width));
      const below = bottom - anchor.bottom, above = anchor.top - top;
      const y = beside ? anchor.top : below >= height + 10 || below >= above ? anchor.bottom + 10 : anchor.top - height - 10;
      element.style.left = `${x - page.left}px`;
      element.style.top = `${Math.max(top, Math.min(y, bottom - height)) - page.top}px`;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    const observer = new ResizeObserver(schedule);
    observer.observe(layer); observer.observe(viewport); observer.observe(element);
    viewport.addEventListener('scroll', schedule); window.addEventListener('resize', schedule);
    place(); element.focus({ preventScroll: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); viewport.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, [note.id, note.rect[0], note.rect[1], note.rect[2], note.rect[3]]);

  return <section ref={card} className={'pdf-note-card ' + (ai ? 'pdf-suggestion' : 'pdf-personal-note')} role="dialog" aria-modal="false" aria-label={ai ? t('AI suggestion {n}', { n: number }) : t('PDF note {n}', { n: number })} tabIndex={-1} onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); if (editing) setDraft(null); else onClose(); }
  }}>
    <div className="pdf-note-content"><div className="pdf-suggestion-body">{editing ? <form className="note-edit" onSubmit={event => { event.preventDefault(); void save(); }}>
      <textarea autoFocus aria-label={t('Edit note {n}', { n: number })} value={draft} rows={4} maxLength={4000} disabled={busy} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (sendsMessage(event.nativeEvent, window.matchMedia('(pointer: coarse)').matches)) { event.preventDefault(); void save(); } }}/>
      <div className="button-row"><button type="button" className="button ghost compact" disabled={busy} onClick={() => setDraft(null)}>{t('Cancel')}</button><button className="button primary compact" disabled={busy || !draft.trim()}>{busy ? t('Saving…') : t('Save')}</button></div>
    </form> : <p>{note.comment || (note.group ? t('Highlighted in {group}', { group: groupName(note.group) }) : '')}</p>}</div><button type="button" className="icon-button pdf-note-close" aria-label={ai ? t('Close suggestion') : t('Close note')} title={ai ? t('Close suggestion') : t('Close note')} disabled={busy} onClick={onClose}><Icon name="close" size={14}/></button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!editing && <div className="pdf-note-tools">
      {note.aiReview && <span className="pdf-note-origin" role="img" aria-label={`${t('AI suggestion')} · ${AGENT_NAMES[note.aiReview.agent]}`} title={`${t('AI suggestion')} · ${AGENT_NAMES[note.aiReview.agent]}`}><Icon name="spark" size={13}/></span>}
      <button type="button" className="pdf-note-attach" aria-label={ai ? t('Include suggestion {n} in this task', { n: number }) : t('Include note {n} in this task', { n: number })} aria-pressed={selected} title={selected ? t('Remove from task') : t('Add to task')} disabled={busy} onClick={onToggle}><Icon name={selected ? 'check' : 'plus'} size={13}/>{selected ? t('Added to task') : t('Add to task')}</button>
      <span className="pdf-note-tools-space"/>
      {!ai && <button type="button" className="icon-button note-edit-trigger" aria-label={t('Edit note {n}: {comment}', { n: number, comment: note.comment })} title={t('Edit note')} disabled={busy} onClick={() => setDraft(note.comment)}><Icon name="pencil" size={14}/></button>}
      <button type="button" className="icon-button pdf-note-delete" aria-label={ai ? t('Ignore suggestion {n}', { n: number }) : t('Delete note {n}', { n: number })} title={ai ? t('Ignore') : t('Delete note')} disabled={busy} onClick={onDismiss}><Icon name="trash" size={14}/></button>
      {ai && total > 1 && <div className="pdf-suggestion-navigation"><button type="button" className="icon-button" aria-label={t('Previous suggestion')} title={t('Previous suggestion')} disabled={busy || index <= 0} onClick={onPrevious}><Icon name="chevronLeft" size={14}/></button><span aria-label={t('{current} of {total}', { current: index + 1, total })}>{index + 1}/{total}</span><button type="button" className="icon-button" aria-label={t('Next suggestion')} title={t('Next suggestion')} disabled={busy || index >= total - 1} onClick={onNext}><Icon name="chevronRight" size={14}/></button></div>}
    </div>}
  </section>;
}
