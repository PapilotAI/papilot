import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { CitationEvidence, CitationSuggestion, CitationVerdict, EvidenceMark } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './evidence-marks.css';

// Citations checked against their works, shown in the margin of a PDF as an
// evidence card does it. In the paper's PDF: a bar beside each paragraph with
// one segment per checked citation in reading order, coloured by its verdict, and a dashed one
// for a sentence that cites nothing but could cite a library work. In a cited
// work's PDF, the other way round: a bar beside each passage the paper relies
// on, whose card shows the paper's sentences and goes back to them.

type Load = <T>(route: string) => Promise<T>;
export type EvidenceFinding = EvidenceMark['findings'][number];
export type EvidenceSuggestion = NonNullable<EvidenceMark['suggestion']>;
export type OpenEvidence = (target: { entry: string; hash: string; key: string }, evidence?: CitationEvidence) => void;
export interface EvidenceActions { open?: OpenEvidence; cite?: (suggestion: EvidenceSuggestion) => void; dismiss?: (suggestion: EvidenceSuggestion) => void }
export type Segment = CitationVerdict | 'suggested';
type Rect = [number, number, number, number];

/** The marks of the PDF build on screen, read again while a quick check runs,
 * when the window comes back into focus, and when the Library changes them. */
export function useEvidenceMarks(projectId: string, buildKey: string | undefined, load: Load, enabled = true) {
  // Marks belong to one build: a reflowed PDF never shows another build's.
  const [shown, setShown] = useState<{ key: string; marks: EvidenceMark[] }>({ key: '', marks: [] }), [round, setRound] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const again = () => setRound(n => n + 1);
    window.addEventListener('focus', again);
    window.addEventListener(EVIDENCE_CHANGED, again);
    return () => { window.removeEventListener('focus', again); window.removeEventListener(EVIDENCE_CHANGED, again); };
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
/** Sent when findings or suggestions change, so the paper's marks follow. */
export const EVIDENCE_CHANGED = 'papilot:evidence';

const ORDER: Segment[] = ['unsupported', 'partial', 'unclear', 'suggested', 'supported'];
const ICON: Record<Segment, string> = { supported: 'check', partial: 'minus', unsupported: 'close', unclear: 'question', suggested: 'plus' };
export const verdictName = (verdict: Segment) => ({ supported: t('Supported'), partial: t('Partly supported'), unsupported: t('Not supported'), unclear: t('Cannot tell'), suggested: t('Could cite') })[verdict];
export function VerdictLabel({ verdict }: { verdict: Segment }) {
  return <span className="evidence-verdict" data-verdict={verdict}><Icon name={ICON[verdict]} size={11}/>{verdictName(verdict)}</span>;
}

interface Placed { id: string; rects: Rect[] }
interface Group<T extends Placed> { id: string; top: number; bottom: number; left: number; marks: T[] }
/** Marks of one page gathered by paragraph: sentences whose lines touch, in
 * the same column, share one bar, so neighbouring sentences never stack. */
export function groupMarks<T extends Placed>(marks: T[]): Group<T>[] {
  const placed = marks.map(mark => ({ mark, top: Math.min(...mark.rects.map(r => r[1])), bottom: Math.max(...mark.rects.map(r => r[3])), left: Math.min(...mark.rects.map(r => r[0])), line: Math.max(...mark.rects.map(r => r[3] - r[1])) }))
    .sort((a, b) => a.top - b.top);
  const groups: Group<T>[] = [];
  for (const item of placed) {
    const last = groups.at(-1);
    if (last && item.top <= last.bottom + item.line * 0.6 && Math.abs(item.left - last.left) < 0.12) {
      last.marks.push(item.mark); last.bottom = Math.max(last.bottom, item.bottom); last.left = Math.min(last.left, item.left);
    } else groups.push({ id: item.mark.id, top: item.top, bottom: item.bottom, left: item.left, marks: [item.mark] });
  }
  return groups;
}

/** One page's marks with their bars and the open card, in that page's layer
 * of the PDF view. focus opens the group holding that mark. */
export function MarginMarks<T extends Placed>({ marks, segments, card, focus, label }: {
  marks: T[]; segments: (mark: T) => Segment[]; label: (group: Group<T>) => string;
  card: (group: Group<T>, close: () => void, hover: (id: string | null) => void) => ReactNode; focus?: string;
}) {
  const groups = groupMarks(marks), [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (focus) { const group = groups.find(item => item.marks.some(mark => mark.id === focus)); if (group) setOpen(group.id); } }, [focus, marks]);
  return <>{groups.map(group => <MarginGroup key={group.id} group={group} open={open === group.id} focus={focus} onToggle={on => setOpen(on ? group.id : null)} segments={group.marks.flatMap(segments)} label={label(group)} card={card}/>)}</>;
}

function MarginGroup<T extends Placed>({ group, open, focus, onToggle, segments, label, card }: {
  group: Group<T>; open: boolean; focus?: string; onToggle: (on: boolean) => void; segments: Segment[]; label: string;
  card: (group: Group<T>, close: () => void, hover: (id: string | null) => void) => ReactNode;
}) {
  const id = useId(), tag = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), [hovered, setHovered] = useState<string | null>(null);
  // A click or tap outside the card, or Escape, closes it, and focus goes back to the bar.
  useEffect(() => {
    if (!open) { setHovered(null); return; }
    panel.current?.focus({ preventScroll: true });
    // Shown from elsewhere: that sentence is lit and brought into the card's view.
    const shown = focus && group.marks.some(mark => mark.id === focus) ? focus : null;
    setHovered(shown);
    if (shown) panel.current?.querySelector(`[data-mark="${CSS.escape(shown)}"]`)?.scrollIntoView({ block: 'nearest' });
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !tag.current?.contains(event.target as Node)) onToggle(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const close = () => { onToggle(false); tag.current?.focus({ preventScroll: true }); };
  const lit = open ? group.marks.filter(mark => !hovered || mark.id === hovered).flatMap(mark => mark.rects) : [];
  const below = group.bottom <= 0.6;
  return <>
    <button ref={tag} type="button" className="evidence-tag" data-worst={[...segments].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0]} aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined}
      style={{ left: `calc(${group.left * 100}% - 13px)`, top: `${group.top * 100}%`, height: `${(group.bottom - group.top) * 100}%` }} onClick={() => onToggle(!open)}>
      {segments.map((segment, index) => <span key={index} data-verdict={segment}/>)}
    </button>
    {lit.map((rect, index) => <div key={index} className="evidence-sentence" style={{ left: `${rect[0] * 100}%`, top: `${rect[1] * 100}%`, width: `${(rect[2] - rect[0]) * 100}%`, height: `${(rect[3] - rect[1]) * 100}%` }}/>)}
    {/* Below the paragraph, so it stays readable; above it near the page's end. */}
    {open && <div ref={panel} id={id} role="dialog" aria-label={label} tabIndex={-1} className="evidence-card"
      style={{ left: `clamp(4px, ${group.left * 100}%, calc(100% - min(360px, 94%) - 4px))`, ...(below ? { top: `calc(${group.bottom * 100}% + 6px)` } : { bottom: `calc(${(1 - group.top) * 100}% + 6px)` }) }}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <header className="evidence-card-head">
        <Tally segments={segments}/>
        <button type="button" className="icon-button" aria-label={t('Close')} onClick={close}><Icon name="close" size={13}/></button>
      </header>
      {card(group, () => onToggle(false), setHovered)}
    </div>}
  </>;
}

/** How many of each verdict, worst first, as small coloured counts. */
function Tally({ segments }: { segments: Segment[] }) {
  const counts = ORDER.map(verdict => [verdict, segments.filter(segment => segment === verdict).length] as const).filter(([, n]) => n);
  return <p className="evidence-tally">{counts.map(([verdict, n]) => <span key={verdict} data-verdict={verdict}><i aria-hidden="true"/>{n} {verdictName(verdict)}</span>)}</p>;
}

/** A sentence as it reads, its citations set apart. */
export function CitedSentence({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
    parts.push(text.slice(at, match.index));
    parts.push(<span key={match.index} className="evidence-cite">{match[1]}</span>);
    at = match.index + match[0].length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

const quoteButton = (evidence: CitationEvidence, index: number, onClick: () => void) => <button key={index} type="button" className="evidence-quote" onClick={onClick}>
  <q>{evidence.quote}</q><span>{t('p. {page}', { page: evidence.page })}</span>
</button>;
const checkedBy = (by?: string) => <p className="evidence-by">{by ? t('Quick check by {model}', { model: by }) : t('Checked by an agent')}</p>;

/** The paper's PDF: each sentence of the paragraph with its verdicts, and a
 * sentence citing nothing with the work it could cite. */
export function PaperEvidence({ marks, actions, focus }: { marks: EvidenceMark[]; actions: EvidenceActions; focus?: string }) {
  const segments = (mark: EvidenceMark): Segment[] => mark.suggestion ? ['suggested'] : mark.findings.map(finding => finding.verdict);
  return <MarginMarks marks={marks} segments={segments} focus={focus}
    label={group => t('Citation check: {verdicts}', { verdicts: group.marks.flatMap(mark => mark.suggestion ? [`${mark.suggestion.key} ${verdictName('suggested')}`] : mark.findings.map(finding => `${finding.key} ${verdictName(finding.verdict)}`)).join(', ') })}
    card={(group, close, hover) => <ol className="evidence-list">{group.marks.map(mark => <li key={mark.id} data-mark={mark.id} data-focused={focus === mark.id || undefined} onPointerEnter={() => hover(mark.id)} onPointerLeave={() => hover(null)} onFocus={() => hover(mark.id)}>
      <p className="evidence-sentence-text"><CitedSentence text={mark.sentence}/></p>
      {mark.suggestion ? <SuggestionRow suggestion={mark.suggestion} actions={actions} close={close}/>
        : [...mark.findings].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict)).map(finding => <div key={finding.key} className="evidence-row" data-verdict={finding.verdict}>
          <p className="evidence-row-head"><VerdictLabel verdict={finding.verdict}/><span className="evidence-work">{finding.title || finding.key}</span></p>
          {finding.note && <p className="evidence-note">{finding.note}</p>}
          {finding.evidence.map((evidence, index) => quoteButton(evidence, index, () => { close(); actions.open?.(finding, evidence); }))}
          {checkedBy(finding.by)}
        </div>)}
    </li>)}</ol>}/>;
}

function SuggestionRow({ suggestion, actions, close }: { suggestion: EvidenceSuggestion; actions: EvidenceActions; close: () => void }) {
  return <div className="evidence-row" data-verdict="suggested">
    <p className="evidence-row-head"><VerdictLabel verdict="suggested"/><span className="evidence-work">{suggestion.title || suggestion.key}</span></p>
    {suggestion.note && <p className="evidence-note">{suggestion.note}</p>}
    {suggestion.evidence.map((evidence, index) => quoteButton(evidence, index, () => { close(); actions.open?.({ entry: suggestion.entry, hash: suggestion.pdf, key: suggestion.key }, evidence); }))}
    <div className="evidence-actions">
      {actions.cite && <button type="button" className="button secondary compact" onClick={() => { close(); actions.cite!(suggestion); }}>{t('Ask an agent to cite it')}</button>}
      {actions.dismiss && <button type="button" className="button ghost compact" onClick={() => { close(); actions.dismiss!(suggestion); }}>{t('Dismiss')}</button>}
    </div>
    {checkedBy(suggestion.by)}
  </div>;
}

/** A passage of a cited work and the sentence of the paper that relies on it. */
export interface SourceUse { id: string; sentenceId: string; page: number; rects: Rect[]; sentence: string; file: string; line: number; verdict: Segment; note: string; by?: string }
/** A cited work's PDF: each passage the paper relies on, with the paper's
 * sentences, and the way back to each in the paper's PDF. */
export function SourceEvidence({ uses, onShow }: { uses: SourceUse[]; onShow?: (use: SourceUse) => void }) {
  return <MarginMarks marks={uses} segments={use => [use.verdict]}
    label={group => t('Cited in your paper: {n}', { n: group.marks.length })}
    card={(group, close, hover) => <ol className="evidence-list">{group.marks.map(use => <li key={use.id} onPointerEnter={() => hover(use.id)} onPointerLeave={() => hover(null)} onFocus={() => hover(use.id)}>
      <div className="evidence-row" data-verdict={use.verdict}>
        <p className="evidence-row-head"><VerdictLabel verdict={use.verdict}/><code className="evidence-where">{use.file}:{use.line}</code></p>
        <p className="evidence-sentence-text"><CitedSentence text={use.sentence}/></p>
        {use.note && <p className="evidence-note">{use.note}</p>}
        {onShow && <div className="evidence-actions"><button type="button" className="button secondary compact" onClick={() => { close(); onShow(use); }}><Icon name="paper" size={13}/>{t('Show in paper')}</button></div>}
      </div>
    </li>)}</ol>}/>;
}

/** The passages of one work the paper relies on: its findings' evidence and the suggestions to cite it. */
export function sourceUses(key: string, sentences: { id: string; sentence: string; file: string; line: number; findings: Record<string, { verdict: CitationVerdict; note: string; evidence: CitationEvidence[]; by?: string; stale?: boolean }> }[], suggestions: CitationSuggestion[]): SourceUse[] {
  const uses: SourceUse[] = [];
  const add = (sentenceId: string, base: Omit<SourceUse, 'id' | 'page' | 'rects' | 'sentenceId'>, evidence: CitationEvidence[]) => evidence.forEach((item, index) => {
    const page = item.marks[0]?.page;
    if (page) uses.push({ ...base, id: `${sentenceId}:${index}`, sentenceId, page: page - 1, rects: item.marks.filter(mark => mark.page === page).map(mark => mark.rect) });
  });
  for (const sentence of sentences) {
    const finding = sentence.findings[key];
    if (finding && !finding.stale) add(sentence.id, { sentence: sentence.sentence, file: sentence.file, line: sentence.line, verdict: finding.verdict, note: finding.note, by: finding.by }, finding.evidence);
  }
  for (const suggestion of suggestions) if (suggestion.key === key) add(`suggest:${suggestion.id}`, { sentence: suggestion.sentence, file: suggestion.file, line: suggestion.line, verdict: 'suggested', note: suggestion.note, by: suggestion.by }, suggestion.evidence);
  return uses;
}
