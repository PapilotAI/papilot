import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

// PDF or Changes: the manuscript as it is (for reading and annotating) or
// uncommitted Git changes shown in place on the full PDF.
export type PdfMode = 'pdf' | 'changes';
export function ModeSwitch({ mode, onMode }: { mode: PdfMode; onMode: (mode: PdfMode) => void }) {
  return <div className="pdf-modes" role="group" aria-label={t('Show')}>
    <button type="button" aria-label="PDF" title="PDF" aria-pressed={mode === 'pdf'} onClick={() => onMode('pdf')}><Icon name="paper" size={15}/><span>PDF</span></button>
    <button type="button" aria-label={t('Changes')} aria-pressed={mode === 'changes'} title={t('What changed since the last commit, to stage, revert and commit change by change')} onClick={() => onMode('changes')}><Icon name="diff" size={15}/><span>{t('Changes')}</span></button>
  </div>;
}
