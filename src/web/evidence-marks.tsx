import { useEffect, useId, useRef, useState } from 'react';
import type { CitationEvidence, CitationVerdict, EvidenceMark } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './evidence-marks.css';

// The checked citations beside their sentences in the paper's PDF, as an
// evidence card does it: a segmented bar in the margin, one segment per cited
// work coloured by its verdict, and a card beside it with each verdict, why,
// and the cited work's own lines, which open its PDF there.

type Load = <T>(route: string) => Promise<T>;
export type EvidenceFinding = EvidenceMark['findings'][number];
export type OpenEvidence = (finding: EvidenceFinding, evidence?: CitationEvidence) => void;

/** The marks of the PDF build on screen, read again while a quick check runs
 * and when the window comes back into focus. */
export function useEvidenceMarks(projectId: string, buildKey: string | undefined, load: Load, enabled = true) {
  // Marks belong to one build: a reflowed PDF never shows another build's.
  const [shown, setShown] = useState<{ key: string; marks: EvidenceMark[] }>({ key: '', marks: [] }), [round, setRound] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const again = () => setRound(n => n + 1);
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !buildKey) return;
    let live = true, timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const result = await load<{ key: string; marks: EvidenceMark[]; running: boolean }>(`/projects/${projectId}/manuscript/evidence?key=${encodeURIComponent(buildKey)}`);
        if (!live) return;
        setShown({ key: result.key, marks: result.marks });
        if (result.running) timer = setTimeout(() => void read(), 2000);
      } catch { /* Marks are an aid; the Library still lists every finding. */ }
    };
    void read();
    return () => { live = false; clearTimeout(timer); };
  }, [projectId, buildKey, load, enabled, round]);
  return enabled && shown.key === buildKey ? shown.marks : [];
}

const ORDER: CitationVerdict[] = ['unsupported', 'partial', 'unclear', 'supported'];
const verdictIcon: Record<CitationVerdict, string> = { supported: 'check', partial: 'minus', unsupported: 'close', unclear: 'question' };
export const verdictName = (verdict: CitationVerdict) => ({ supported: t('Supported'), partial: t('Partly supported'), unsupported: t('Not supported'), unclear: t('Cannot tell') })[verdict];

/** One page's marks, in its layer of the PDF view. */
export function EvidenceMarks({ marks, onOpen }: { marks: EvidenceMark[]; onOpen?: OpenEvidence }) {
  const [open, setOpen] = useState<string | null>(null);
  return <>{marks.map(mark => <EvidenceTag key={mark.id} mark={mark} open={open === mark.id} onToggle={on => setOpen(on ? mark.id : null)} onOpen={onOpen}/>)}</>;
}

function EvidenceTag({ mark, open, onToggle, onOpen }: { mark: EvidenceMark; open: boolean; onToggle: (on: boolean) => void; onOpen?: OpenEvidence }) {
  const id = useId(), tag = useRef<HTMLButtonElement>(null), card = useRef<HTMLDivElement>(null);
  const top = Math.min(...mark.rects.map(rect => rect[1])), bottom = Math.max(...mark.rects.map(rect => rect[3])), left = Math.min(...mark.rects.map(rect => rect[0]));
  const findings = [...mark.findings].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict));
  const worst = findings[0].verdict;
  // A click or tap outside the card, or Escape, closes it, and focus goes back to the mark.
  useEffect(() => {
    if (!open) return;
    card.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!card.current?.contains(event.target as Node) && !tag.current?.contains(event.target as Node)) onToggle(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const close = () => { onToggle(false); tag.current?.focus({ preventScroll: true }); };
  const label = t('Citation check: {verdicts}', { verdicts: findings.map(finding => `${finding.key} ${verdictName(finding.verdict)}`).join(', ') });
  return <>
    <button ref={tag} type="button" className="evidence-tag" data-verdict={worst} aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined}
      style={{ left: `calc(${left * 100}% - 14px)`, top: `${top * 100}%`, height: `${(bottom - top) * 100}%` }} onClick={() => onToggle(!open)}>
      {findings.map((finding, index) => <span key={index} data-verdict={finding.verdict}/>)}
    </button>
    {open && mark.rects.map((rect, index) => <div key={index} className="evidence-sentence" data-verdict={worst} style={{ left: `${rect[0] * 100}%`, top: `${rect[1] * 100}%`, width: `${(rect[2] - rect[0]) * 100}%`, height: `${(rect[3] - rect[1]) * 100}%` }}/>)}
    {/* Below the sentence, so it stays readable beside its verdicts; above it near the page's end. */}
    {open && <div ref={card} id={id} role="dialog" aria-label={t('Citation check')} tabIndex={-1} className="evidence-card"
      style={{ left: `clamp(4px, ${left * 100}%, calc(100% - min(340px, 92%) - 4px))`, ...(bottom > 0.6 ? { bottom: `calc(${(1 - top) * 100}% + 6px)` } : { top: `calc(${bottom * 100}% + 6px)` }) }}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <header className="evidence-card-head">
        <span>{t('Citation check')}</span>
        <button type="button" className="icon-button" aria-label={t('Close')} onClick={close}><Icon name="close" size={13}/></button>
      </header>
      <ul className="evidence-card-list">
        {findings.map(finding => <li key={finding.key} data-verdict={finding.verdict}>
          <p className="evidence-card-verdict"><Icon name={verdictIcon[finding.verdict]} size={12}/><strong>{verdictName(finding.verdict)}</strong><code>{finding.key}</code></p>
          {finding.title && <p className="evidence-card-title">{finding.title}</p>}
          {finding.note && <p className="evidence-card-note">{finding.note}</p>}
          {finding.evidence.map((evidence, index) => <button key={index} type="button" className="evidence-card-quote" onClick={() => { onToggle(false); onOpen?.(finding, evidence); }}>
            <q>{evidence.quote}</q><span>{t('p. {page}', { page: evidence.page })}</span>
          </button>)}
          <p className="evidence-card-by">{finding.by ? t('Quick check by {model}', { model: finding.by }) : t('Checked by an agent')}</p>
        </li>)}
      </ul>
      {onOpen && <footer><button type="button" className="button ghost compact" onClick={() => { onToggle(false); onOpen(findings[0]); }}><Icon name="library" size={13}/>{t('Open in Library')}</button></footer>}
    </div>}
  </>;
}
