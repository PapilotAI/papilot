import type { ReactNode } from 'react';
import { t } from './i18n.ts';

export function NoteQuote({ text }: { text: string }) {
  return <div className="note-quote">
    <blockquote className="note-quote-text" aria-label={t('Quoted text')}>{text || t('Marked region')}</blockquote>
  </div>;
}

export function NoteBody({ children }: { children: ReactNode }) {
  return <div className="note-body" role="group" aria-label={t('Your note')}>
    {children}
  </div>;
}
