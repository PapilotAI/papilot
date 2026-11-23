import { useEffect, useId, useRef, useState } from 'react';
import type { MemoryCatalog, MemoryExample, MemoryScope, MemorySuggestion, TimelineItem } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './memory.css';

type API = <T>(route: string, body?: unknown) => Promise<T>;
export const OPEN_MEMORY = 'papilot:open-memory';
// Server errors arrive already translated (see api.ts).
export const failureText = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);
export const memoryScopeName = (scope: MemoryScope) => scope === 'paper' ? t('This paper') : scope === 'shared' ? t('Shared with coauthors') : t('All papers');

// Where a rule goes: the choices share one control in the card and in Settings.
export function MemoryScopeSwitch({ value, onChange, shareable, disabled, label }: { value: MemoryScope; onChange: (scope: MemoryScope) => void; shareable: boolean; disabled?: boolean; label: string }) {
  const name = useId();
  const options: { scope: MemoryScope; text: string; title?: string }[] = [
    { scope: 'paper', text: t('This paper') },
    { scope: 'personal', text: t('All papers') },
    { scope: 'shared', text: t('Shared'), title: t('Shared with coauthors through Git') },
  ];
  return <div className="segmented memory-scope" role="radiogroup" aria-label={label}>
    {options.map(option => {
      const off = disabled || (option.scope === 'shared' && !shareable);
      return <label key={option.scope} className={(value === option.scope ? 'checked' : '') + (off ? ' disabled' : '')} title={option.title}>
        <input type="radio" name={name} value={option.scope} checked={value === option.scope} disabled={off} onChange={() => onChange(option.scope)}/>
        <span>{option.text}</span>
      </label>;
    })}
  </div>;
}

// What Papilot proposes to remember once a task's review is finished: the
// rule, which the author may reword, where it goes, and what prompted it.
export function MemoryCard({ item, projectId, api }: { item: TimelineItem; projectId: string; api: API }) {
  const [current, setCurrent] = useState(item);
  const [shareable, setShareable] = useState(false);
  useEffect(() => setCurrent(item), [item]);
  useEffect(() => {
    let live = true;
    api<MemoryCatalog>(`/memory?projectId=${encodeURIComponent(projectId)}`).then(catalog => { if (live) setShareable(catalog.shareable); }, () => undefined);
    return () => { live = false; };
  }, [api, projectId]);
  const suggestions = (current.memory || []).filter(suggestion => suggestion.status !== 'dismissed');
  const dismissedAll = !suggestions.length && Boolean(current.memory?.length);
  // Dismissing the last suggestion removes the card; the conversation's input is where to go next.
  useEffect(() => { if (dismissedAll && document.activeElement === document.body) document.querySelector<HTMLTextAreaElement>('#conversation-panel .composer textarea')?.focus(); }, [dismissedAll]);
  if (!suggestions.length) return null;
  return <section className="memory-card" aria-label={t('Writing memory')}>
    <header><Icon name="brain" size={14}/><span>{suggestions.some(suggestion => suggestion.status === 'pending') ? t('Remember for later tasks?') : t('Remembered')}</span></header>
    {suggestions.map(suggestion => <Suggestion key={suggestion.id} taskId={item.taskId} suggestion={suggestion} shareable={shareable} api={api} onSaved={setCurrent}/>)}
  </section>;
}

function Suggestion({ taskId, suggestion, shareable, api, onSaved }: { taskId: string; suggestion: MemorySuggestion; shareable: boolean; api: API; onSaved: (item: TimelineItem) => void }) {
  const id = useId();
  const undo = useRef<HTMLButtonElement>(null), field = useRef<HTMLTextAreaElement>(null), acted = useRef(false);
  // After Remember the focus moves to Undo, and after Undo back to the rule.
  useEffect(() => {
    if (!acted.current) return;
    acted.current = false;
    (suggestion.status === 'saved' ? undo.current : field.current)?.focus();
  }, [suggestion.status]);
  const [text, setText] = useState(suggestion.text);
  const [scope, setScope] = useState<MemoryScope>(suggestion.scope);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function act(body: object) {
    setBusy(true); setError('');
    try { const item = await api<TimelineItem>(`/tasks/${taskId}/memory/${suggestion.id}`, body); acted.current = true; onSaved(item); }
    catch (failure) { setError(failureText(failure)); }
    finally { setBusy(false); }
  }
  if (suggestion.status === 'saved' && suggestion.saved) return <div className="memory-saved">
    <Icon name="check" size={14}/>
    <p role="status"><span className="sr-only">{t('Remembered')}: </span><span>{suggestion.saved.text}</span><small>{memoryScopeName(suggestion.saved.scope)}</small></p>
    <span className="memory-buttons">
      <button ref={undo} type="button" className="button secondary compact" disabled={busy} onClick={() => void act({ action: 'undo' })}>{t('Undo')}</button>
      <button type="button" className="button secondary compact" onClick={() => window.dispatchEvent(new Event(OPEN_MEMORY))}>{t('Manage')}</button>
    </span>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
  return <form className="memory-suggestion" onSubmit={event => { event.preventDefault(); void act({ action: 'save', text, scope }); }}>
    <label className="sr-only" htmlFor={id}>{t('Preference')}</label>
    <textarea ref={field} id={id} rows={2} value={text} disabled={busy} onChange={event => setText(event.target.value)}/>
    {(suggestion.replaces || suggestion.quote) && <p className="memory-evidence">
      {suggestion.replaces && <span>{t('Replaces “{rule}”', { rule: suggestion.replaces })}</span>}
      {suggestion.quote && <span>“{suggestion.quote}”</span>}
    </p>}
    {/* role=list: Safari drops list semantics from unstyled grid lists. */}
    {suggestion.examples?.length ? <ul className="memory-examples" role="list" aria-label={t('What prompted it')}>
      {byTask(suggestion.examples).map(([task, examples]) => <li key={task}>
        <small>{task === taskId ? t('This task') : examples[0].title}</small>
        <ul role="list">{examples.map((example, index) => <li key={index}><Example example={example}/></li>)}</ul>
      </li>)}
    </ul> : null}
    <div className="memory-actions">
      <MemoryScopeSwitch label={t('Keep for')} value={scope} onChange={setScope} shareable={shareable} disabled={busy}/>
      <span className="memory-buttons">
        <button type="button" className="button secondary compact" disabled={busy} onClick={() => void act({ action: 'dismiss' })}>{t('Dismiss')}</button>
        <button type="submit" className="button primary compact" disabled={busy || !text.trim()}>{t('Remember')}</button>
      </span>
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </form>;
}

const byTask = (examples: MemoryExample[]) => [...examples.reduce((groups, example) => groups.set(example.task, [...groups.get(example.task) || [], example]), new Map<string, MemoryExample[]>())];

// The author's own words, or a change they turned down: the agent's text struck through, then what they kept.
function Example({ example }: { example: MemoryExample }) {
  if (example.said) return <q>{example.said}</q>;
  return <>
    {example.rejected && <del><span className="sr-only">{t('Rejected')}: </span>{example.rejected}</del>}
    {example.rejected && example.kept && <span className="memory-arrow" aria-hidden="true"> → </span>}
    {example.kept && <span><span className={example.rejected ? 'sr-only' : undefined}>{t('Kept')}: </span>{example.kept}</span>}
  </>;
}
