import { useEffect, useRef, useState } from 'react';
import type { AgentId, CitationEvidence, CitationVerdict, LibraryReport, Task } from '../shared.ts';
import { AgentPicker, type AgentOption } from './agent-picker.tsx';
import { Icon } from './icons.tsx';
import { t, tn } from './i18n.ts';
import { VerdictLabel, type Segment } from './evidence-marks.tsx';
import './citation-check.css';

// A citation check is a task of its own, started when the author chooses:
// with the quick model from Settings it checks every citation against the
// library's PDF of its work, and looks for library works for the sentences
// that cite nothing. Its page shows what it found; another model checks
// again from there. The paper's PDF shows it only when the author turns
// that on.

type Load = <T>(route: string, body?: unknown) => Promise<T>;
export interface ModelChoice { agent: AgentId; model: string | null; effort: string | null }

interface Row { id: string; verdict: Segment; sentence: string; place: string; work: string; note: string; evidence: CitationEvidence[]; entry: string; hash: string; key: string; suggestion?: string }
const RANK: Record<Segment, number> = { unsupported: 0, partial: 1, unclear: 2, suggested: 3, supported: 4 };

/** A check task's page: its progress, what it found, the model it checks
 * with, and whether the paper's PDF shows it. */
export function CitationCheckView({ task, load, agents, lead, onOpen, onCite, reconnect }: {
  task: Task; load: Load; agents: AgentOption[]; lead?: React.ReactNode;
  onOpen: (target: { entry: string; hash: string; key: string }, evidence?: CitationEvidence) => void;
  onCite: (suggestion: LibraryReport['suggestions'][number]) => void;
  reconnect?: () => Promise<void>;
}) {
  const check = task.citationCheck!, state = check.state, running = task.status === 'running';
  const [report, setReport] = useState<LibraryReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reconnecting, setReconnecting] = useState(false);
  const [choice, setChoice] = useState<ModelChoice | null>(task.agent ? { agent: task.agent, model: task.model, effort: task.effort ?? null } : null);
  useEffect(() => { if (task.agent) setChoice({ agent: task.agent, model: task.model, effort: task.effort ?? null }); }, [task.agent, task.model, task.effort]);
  // The findings are read again as the run reports progress.
  useEffect(() => {
    let live = true;
    void load<LibraryReport>(`/projects/${task.projectId}/library?online=0`).then(value => { if (live) setReport(value); }, failure => { if (live) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { live = false; };
  }, [task.projectId, state?.done, task.status]);
  const act = async (route: string, body: unknown = {}) => {
    setBusy(true); setError('');
    try { await load(`/tasks/${task.id}/citations/${route}`, body); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  };
  const titleOf = (key: string) => {
    const entry = report?.entries.find(item => item.key === key), title = entry?.fields.find(field => field.name === 'title');
    return { entry: entry?.id ?? '', title: (title?.resolved ?? title?.value ?? key).replace(/[{}\\]/g, '') };
  };
  const pdfOf = (entry: string) => report?.library.entries[entry]?.pdf?.hash ?? '';
  const rows: Row[] = !report ? [] : [
    ...report.citations.flatMap(sentence => Object.entries(sentence.findings).filter(([, finding]) => finding.task === task.id && !finding.stale).map(([key, finding]) => {
      const { entry, title } = titleOf(key);
      return { id: `${sentence.id}|${key}`, verdict: finding.verdict as CitationVerdict, sentence: sentence.sentence, place: `${sentence.file}:${sentence.line}`, work: title, note: finding.note, evidence: finding.evidence, entry, hash: pdfOf(entry), key };
    })),
    ...report.suggestions.filter(suggestion => suggestion.task === task.id).map(suggestion => {
      const { entry, title } = titleOf(suggestion.key);
      return { id: suggestion.id, verdict: 'suggested' as const, sentence: suggestion.sentence, place: `${suggestion.file}:${suggestion.line}`, work: title, note: suggestion.note, evidence: suggestion.evidence, entry, hash: suggestion.pdf, key: suggestion.key, suggestion: suggestion.id };
    }),
  ].sort((a, b) => RANK[a.verdict] - RANK[b.verdict]);
  const look = rows.filter(row => row.verdict !== 'supported' && row.verdict !== 'suggested'), could = rows.filter(row => row.verdict === 'suggested'), held = rows.filter(row => row.verdict === 'supported');
  // The model as its agent names it, never its internal id.
  const named = agents.find(option => option.value === task.agent)?.runtime?.models.find(item => item.id === task.model);
  const model = state?.model || named?.name || named?.id || (task.agent ? agents.find(option => option.value === task.agent)?.label : undefined) || t('Quick model');
  const dismiss = (row: Row) => void load<LibraryReport>(row.suggestion ? `/projects/${task.projectId}/citations/suggestions/dismiss?online=0` : `/projects/${task.projectId}/citations/forget?online=0`, row.suggestion ? { id: row.suggestion } : { id: row.id.split('|')[0], key: row.key }).then(setReport);
  const summary = [look.length ? tn(look.length, '{n} to look at', '{n} to look at') : '', could.length ? tn(could.length, '{n} could cite', '{n} could cite') : '', held.length ? tn(held.length, '{n} supported', '{n} supported') : ''].filter(Boolean);
  return <section className="citation-check-view" aria-labelledby={`check-${task.id}`}>
    <header className="citation-check-head">
      {lead}
      <div className="citation-check-title">
        <h2 id={`check-${task.id}`}>{task.title}</h2>
        <p role="status">{running
          ? state?.total ? (state.phase === 'sources' ? t('Finding sources with {model}: {done} of {total}', { model, done: state.done, total: state.total }) : t('Checking citations with {model}: {done} of {total}', { model, done: state.done, total: state.total })) : t('{model}: getting ready…', { model })
          : state?.error ? state.error
          : summary.length ? summary.map((part, index) => <span key={index} className="citation-check-part">{part}</span>) : t('Nothing found to check')}
          {!running && state && state.failed > 0 && <span className="citation-check-failed">{tn(state.failed, '{n} could not be checked; check again.', '{n} could not be checked; check again.')}</span>}</p>
      </div>
      <div className="citation-check-actions">
        <label className="citation-check-show">
          <input type="checkbox" role="switch" className="switch" checked={check.show} disabled={busy} onChange={event => void act('show', { show: event.target.checked })}/>
          <span>{t('Show in the paper')}</span>
        </label>
        {choice && <AgentPicker label={t('Model')} agents={agents} agent={choice.agent} model={choice.model ?? ''} effort={choice.effort ?? ''} disabled={running}
          reconnecting={reconnecting} onReconnect={() => { if (!reconnect) return; setReconnecting(true); void reconnect().finally(() => setReconnecting(false)); }}
          onSelect={(agent, selected) => setChoice({ agent, model: selected || null, effort: null })} onChange={change => { if (change.effort !== undefined) setChoice(current => current && ({ ...current, effort: change.effort || null })); }}/>}
        {running
          ? <button type="button" className="button secondary compact" disabled={busy || state?.stopping} onClick={() => void act('stop')}><Icon name="stop" size={14}/>{t('Stop')}</button>
          : <button type="button" className="button secondary compact" disabled={busy} onClick={() => void act('rerun', choice ?? {})}><Icon name="refresh" size={14}/>{t('Check again')}</button>}
      </div>
      {running && state?.total ? <progress className="citation-check-progress" value={state.done} max={state.total} aria-label={t('Progress')}/> : null}
    </header>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="citation-check-body">
      {(running || state?.output) && <ModelOutput text={state?.output ?? ''} running={running}/>}
      {!rows.length && !running ? <p className="library-empty">{t('Nothing found to check: the library needs the PDFs of the works the paper cites.')}</p> : null}
      {look.length > 0 && <CheckRows title={t('To look at')} rows={look} open onOpen={onOpen} onDismiss={dismiss}/>}
      {could.length > 0 && <CheckRows title={t('Could cite')} rows={could} open={!look.length} onOpen={onOpen} onDismiss={dismiss}
        onCite={report ? id => { const suggestion = report.suggestions.find(item => item.id === id); if (suggestion) onCite(suggestion); } : undefined}/>}
      {held.length > 0 && <CheckRows title={t('Supported')} rows={held} onOpen={onOpen}/>}
    </div>
  </section>;
}

/** What the model has written, batch after batch: open while it works,
 * with how long it has been waiting; afterwards one line that opens. */
function ModelOutput({ text, running }: { text: string; running: boolean }) {
  const box = useRef<HTMLPreElement>(null), [since] = useState(() => Date.now()), [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [text]);
  useEffect(() => { if (!running) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [running]);
  const waiting = t('Waiting for the model… {n} s', { n: Math.round((now - since) / 1000) });
  return <details className="citation-check-output" open={running || undefined}>
    <summary>{running ? <span className="spinner" aria-hidden="true"/> : <Icon name="chevronRight" size={12}/>}{t('Model output')}</summary>
    <pre ref={box}>{text}{running && <span className="citation-check-waiting">{text ? '\n' : ''}{waiting}</span>}</pre>
  </details>;
}

function CheckRows({ title, rows, open, onOpen, onCite, onDismiss }: { title: string; rows: Row[]; open?: boolean; onOpen: (target: { entry: string; hash: string; key: string }, evidence?: CitationEvidence) => void; onCite?: (id: string) => void; onDismiss?: (row: Row) => void }) {
  return <section className="citation-check-group">
    <h3>{title}<span className="count">{rows.length}</span></h3>
    <ol>{rows.map((row, index) => <li key={row.id} data-verdict={row.verdict}>
      <details open={open && index === 0}>
        <summary>
          <VerdictLabel verdict={row.verdict}/>
          <span className="citation-check-sentence">{row.sentence}</span>
          <code>{row.place}</code>
        </summary>
        <div className="citation-check-detail">
          <p className="citation-check-work">{row.work}</p>
          {row.note && <p className="citation-check-note">{row.note}</p>}
          {row.evidence.map((item, i) => <button key={i} type="button" className="library-evidence" disabled={!row.hash} onClick={() => onOpen({ entry: row.entry, hash: row.hash, key: row.key }, item)}>
            <q>{item.quote}</q><span className="library-evidence-page">{t('p. {page}', { page: item.page })}</span>
          </button>)}
          {(onCite || onDismiss) && <div className="citation-check-row-actions">
            {row.suggestion && onCite && <button type="button" className="button secondary compact" onClick={() => onCite(row.suggestion!)}>{t('Ask an agent to cite it')}</button>}
            {onDismiss && <button type="button" className="button ghost compact" onClick={() => onDismiss(row)}>{t('Dismiss')}</button>}
          </div>}
        </div>
      </details>
    </li>)}</ol>
  </section>;
}
