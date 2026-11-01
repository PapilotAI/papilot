import { useLayoutEffect, useRef } from 'react';
import { AGENT_NAMES, type Annotation } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './pdf-suggestion.css';

export interface PdfSuggestionActions {
  has: (id: string) => boolean;
  toggle: (note: Annotation) => void;
  remove: (note: Annotation) => Promise<void>;
  restore: (note: Annotation) => Promise<void>;
  onBusy: (busy: boolean) => void;
  disabled: boolean;
}

// The card lives in the PDF's annotation layer. Reposition it around its text
// anchor on zoom/scroll, keeping it inside both the page and visible PDF area.
export function PdfSuggestion({ note, number, index, total, selected, busy, error, onToggle, onDismiss, onClose, onPrevious, onNext }: {
  note: Annotation; number: number; index: number; total: number; selected: boolean; busy: boolean; error: string;
  onToggle: () => void; onDismiss: () => void; onClose: () => void; onPrevious: () => void; onNext: () => void;
}) {
  const card = useRef<HTMLElement>(null);
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
      const width = Math.min(330, right - left);
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

  return <section ref={card} className="pdf-suggestion" role="dialog" aria-modal="false" aria-label={t('AI suggestion {n}', { n: number })} tabIndex={-1} onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className="pdf-suggestion-head"><Icon name="spark" size={14}/><strong>{t('AI suggestion')}</strong><span>{AGENT_NAMES[note.aiReview!.agent]}</span><button type="button" className="icon-button" aria-label={t('Close suggestion')} disabled={busy} onClick={onClose}><Icon name="close" size={14}/></button></div>
    <div className="pdf-suggestion-body"><p>{note.comment}</p></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="pdf-suggestion-actions">
      <button type="button" className="note-card-select" aria-label={t('Include suggestion {n} in this task', { n: number })} aria-pressed={selected} title={selected ? t('Remove from task') : t('Add to task')} disabled={busy} onClick={onToggle}><Icon name={selected ? 'check' : 'plus'} size={13}/>{selected ? t('Added to task') : t('Add to task')}</button>
      <button type="button" className="note-dismiss" aria-label={t('Ignore suggestion {n}', { n: number })} disabled={busy} onClick={onDismiss}>{t('Ignore')}</button>
    </div>
    {total > 1 && <div className="pdf-suggestion-navigation"><button type="button" className="icon-button" aria-label={t('Previous suggestion')} disabled={busy || index <= 0} onClick={onPrevious}><Icon name="chevronLeft" size={14}/></button><span>{t('{current} of {total}', { current: index + 1, total })}</span><button type="button" className="icon-button" aria-label={t('Next suggestion')} disabled={busy || index >= total - 1} onClick={onNext}><Icon name="chevronRight" size={14}/></button></div>}
  </section>;
}
