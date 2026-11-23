import { useEffect, useRef, useState } from 'react';
import type { MemoryExample, MemoryScope, MemorySuggestion, Task } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './task-commit.css';
import './memory-nudge.css';

type API = <T>(route: string, body?: unknown) => Promise<T>;
export const OPEN_MEMORY = 'papilot:open-memory';
// Server errors arrive already translated (see api.ts).
export const failureText = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);
export const memoryScopeName = (scope: MemoryScope) => scope === 'paper' ? t('This paper') : scope === 'shared' ? t('Shared with coauthors') : t('All papers');

// What Papilot noticed in the author's reviews, offered beside the task's
// save step as they commit or apply it: never in the way of saving, and
// gone once answered. The wording and where it is kept can be changed in
// Settings → Memory after Remember.
export function MemoryNudge({ task, api }: { task: Task; api: API }) {
  const [memory, setMemory] = useState(task.memory || []);
  useEffect(() => setMemory(task.memory || []), [task.memory]);
  const section = useRef<HTMLElement>(null);
  const shown = memory.filter(suggestion => suggestion.status !== 'dismissed');
  if (!shown.length) return null;
  // Dismissing the last suggestion removes this section; the review's own card keeps the focus.
  const update = (next: MemorySuggestion[]) => {
    const card = section.current?.closest<HTMLElement>('.review-complete');
    setMemory(next);
    if (card && !next.some(suggestion => suggestion.status !== 'dismissed')) requestAnimationFrame(() => card.focus());
  };
  return <section ref={section} className="task-commit memory-nudge" aria-label={t('Writing memory')}>
    <header><Icon name="brain" size={14}/><span>{shown.some(suggestion => suggestion.status === 'pending') ? t('Remember for later tasks?') : t('Remembered')}</span></header>
    {shown.map(suggestion => <Suggestion key={suggestion.id} taskId={task.id} suggestion={suggestion} api={api} onChange={update}/>)}
  </section>;
}

function Suggestion({ taskId, suggestion, api, onChange }: { taskId: string; suggestion: MemorySuggestion; api: API; onChange: (memory: MemorySuggestion[]) => void }) {
  const undo = useRef<HTMLButtonElement>(null), remember = useRef<HTMLButtonElement>(null), acted = useRef(false);
  // After Remember the focus moves to Undo, and after Undo back to Remember.
  useEffect(() => {
    if (!acted.current) return;
    acted.current = false;
    (suggestion.status === 'saved' ? undo.current : remember.current)?.focus();
  }, [suggestion.status]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function act(action: 'save' | 'dismiss' | 'undo') {
    setBusy(true); setError('');
    try { const { memory } = await api<{ memory: MemorySuggestion[] }>(`/tasks/${taskId}/memory/${suggestion.id}`, { action }); acted.current = true; onChange(memory); }
    catch (failure) { setError(failureText(failure)); }
    finally { setBusy(false); }
  }
  const failed = error && <p className="task-commit-error" role="alert">{error}</p>;
  if (suggestion.status === 'saved' && suggestion.saved) return <div className="memory-nudge-saved">
    <Icon name="check" size={14}/>
    <p role="status"><span className="memory-nudge-hidden">{t('Remembered')}: </span><span>{suggestion.saved.text}</span><small>{memoryScopeName(suggestion.saved.scope)}</small></p>
    <span className="task-commit-actions">
      <button ref={undo} type="button" className="task-commit-alternative" disabled={busy} onClick={() => void act('undo')}>{t('Undo')}</button>
      <button type="button" className="task-commit-alternative" onClick={() => window.dispatchEvent(new Event(OPEN_MEMORY))}>{t('Manage')}</button>
    </span>
    {failed}
  </div>;
  return <div className="memory-nudge-suggestion">
    <p className="memory-nudge-rule">{suggestion.text}</p>
    {suggestion.replaces && <p className="memory-nudge-note">{t('Replaces “{rule}”', { rule: suggestion.replaces })}</p>}
    <details>
      <summary>{t('What prompted it')}</summary>
      {/* role=list: Safari drops list semantics from unstyled grid lists. */}
      <ul className="memory-examples" role="list">
        {byTask(suggestion.examples).map(([task, examples]) => <li key={task}>
          <small>{task === taskId ? t('This task') : examples[0].title}</small>
          <ul role="list">{examples.map((example, index) => <li key={index}><Example example={example}/></li>)}</ul>
        </li>)}
      </ul>
    </details>
    <div className="memory-nudge-foot">
      <small>{memoryScopeName(suggestion.scope)}</small>
      <span className="task-commit-actions">
        <button type="button" className="task-commit-alternative" disabled={busy} onClick={() => void act('dismiss')}>{t('Dismiss')}</button>
        <button ref={remember} type="button" className="task-commit-primary" disabled={busy} onClick={() => void act('save')}>{t('Remember')}</button>
      </span>
    </div>
    {failed}
  </div>;
}

const byTask = (examples: MemoryExample[]) => [...examples.reduce((groups, example) => groups.set(example.task, [...groups.get(example.task) || [], example]), new Map<string, MemoryExample[]>())];

// The author's own words, or a change they turned down: the agent's text struck through, then what they kept.
function Example({ example }: { example: MemoryExample }) {
  if (example.said) return <q>{example.said}</q>;
  return <>
    {example.rejected && <del><span className="memory-nudge-hidden">{t('Rejected')}: </span>{example.rejected}</del>}
    {example.rejected && example.kept && <span className="memory-arrow" aria-hidden="true"> → </span>}
    {example.kept && <span><span className={example.rejected ? 'memory-nudge-hidden' : undefined}>{t('Kept')}: </span>{example.kept}</span>}
  </>;
}
