import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { t } from './i18n.ts';
import { Icon } from './icons.tsx';
import { noteLocation } from './note-location.ts';
import type { MarkKind, NoteSummary } from '../shared.ts';

// A delete mark's text says what happens to the marked passage.
export const markText = (note: { kind?: MarkKind; comment: string }) => note.kind === 'delete' ? note.comment.trim() ? t('Replace with: {text}', { text: note.comment.trim() }) : t('Delete this text') : note.comment;
export function NoteQuote({ text, kind }: { text: string; kind?: MarkKind }) {
  return <div className="note-quote">
    <blockquote className="note-quote-text" data-kind={kind} aria-label={t('Quoted text')}>{text || t('Marked region')}</blockquote>
  </div>;
}

export function NoteBody({ children }: { children: ReactNode }) {
  return <div className="note-body" role="group" aria-label={t('Your note')}>
    {children}
  </div>;
}

export function SubmittedNoteContent({ note, index, children }: { note: NoteSummary; index: number; children?: ReactNode }) {
  return <>
    <div className="sent-note-heading">
      <span className="sent-note-where"><span className="sent-note-number" aria-hidden="true">{index + 1}</span><span className="sent-note-location">{noteLocation(note.where)}</span></span>
      {children}
    </div>
    {note.quote ? <blockquote data-kind={note.kind}>{note.quote}</blockquote> : <span className="sent-note-region">{t('Marked region')}</span>}
    {(note.comment || note.kind === 'delete' || note.stamp) && <p>{note.stamp && <span className="pdf-note-stamp"><Icon name="spark" size={12}/>{note.stamp}</span>}{markText(note)}</p>}
  </>;
}

// A PDF rejection can happen with both the drawer and the Chat row unmounted.
export function renderSubmittedNote(card: HTMLElement, note: NoteSummary, index: number) {
  const root = createRoot(card);
  flushSync(() => root.render(<SubmittedNoteContent note={note} index={index}/>));
  return () => root.unmount();
}
