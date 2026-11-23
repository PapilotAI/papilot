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

// Which of a task's suggestions to show: those waiting for an answer, and
// those remembered here, so Undo stays at hand until the author moves on.
// answered holds what the author answered in this session.
export const shownSuggestions = (task: Task, answered: ReadonlySet<string> | undefined) =>
  (task.memory || []).filter(suggestion => suggestion.status === 'pending' || (suggestion.status === 'saved' && answered?.has(suggestion.id)));

// What Papilot noticed in the author's reviews, offered beside the task's
// save step as they commit or apply it: never in the way of saving, and
// gone once answered. The wording and where it is kept can be changed in
// Settings → Memory after Remember. onChange reads the task again.
export function MemoryNudge({ task, answered, api, onChange }: { task: Task; answered: Set<string>; api: API; onChange: () => void }) {
  const [current, setCurrent] = useState(task);
  useEffect(() => setCurrent(task), [task]);
  const section = useRef<HTMLElement>(null);
  const shown = shownSuggestions(current, answered);
  if (!shown.length) return null;
  const update = (id: string, memory: MemorySuggestion[]) => {
    answered.add(id);
    const next = { ...current, memory }, left = shownSuggestions(next, answered);
    // Focus stays near: the next suggestion, else the save step's field, the review's card or the chat's input.
    const save = section.current?.closest('.review-complete, .task-delivery');
    const target = left.length ? null : save?.querySelector<HTMLElement>('.task-commit textarea') || save?.closest<HTMLElement>('.review-complete') || document.querySelector<HTMLElement>('#conversation-panel .composer textarea');
    setCurrent(next);
    onChange();
    requestAnimationFrame(() => {
      if (left.length) { if (!section.current?.contains(section.current.ownerDocument.activeElement)) section.current?.querySelector<HTMLElement>('button')?.focus(); }
      else target?.focus();
    });
  };
  return <section ref={section} className="task-commit memory-nudge" aria-label={t('Writing memory')}>
    {shown.map(suggestion => <Suggestion key={suggestion.id} taskId={task.id} suggestion={suggestion} api={api} onChange={memory => update(suggestion.id, memory)}/>)}
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
  if (suggestion.status === 'saved' && suggestion.saved) return <div className="memory-nudge-item memory-nudge-saved">
    <div className="memory-nudge-head"><Icon name="check" size={14}/><span role="status">{t('Remembered')}</span><span className="memory-nudge-scope">{memoryScopeName(suggestion.saved.scope)}</span></div>
    <p className="memory-nudge-rule">{suggestion.saved.text}</p>
    <div className="memory-nudge-foot">
      <span className="task-commit-actions">
        <button ref={undo} type="button" className="task-commit-alternative" disabled={busy} onClick={() => void act('undo')}>{t('Undo')}</button>
        <button type="button" className="task-commit-alternative" onClick={() => window.dispatchEvent(new Event(OPEN_MEMORY))}>{t('Manage')}</button>
      </span>
    </div>
    {failed}
  </div>;
  return <div className="memory-nudge-item">
    <div className="memory-nudge-head"><Icon name="brain" size={14}/><span>{t('Remember this writing habit?')}</span><span className="memory-nudge-scope">{memoryScopeName(suggestion.scope)}</span></div>
    <p className="memory-nudge-rule">{suggestion.text}</p>
    {suggestion.replaces && <p className="memory-nudge-note">{t('Replaces “{rule}”', { rule: suggestion.replaces })}</p>}
    <div className="memory-nudge-foot">
      <details>
        <summary><span>{t('What prompted it')}</span><span className="memory-nudge-count" aria-hidden="true">{suggestion.examples.length}</span></summary>
        {/* role=list: Safari drops list semantics from unstyled grid lists. */}
        <ul className="memory-examples" role="list">
          {byTask(suggestion.examples).map(([task, examples]) => <li key={task}>
            <small>{task === taskId ? t('This task') : examples[0].title}</small>
            <ul role="list">{examples.map((example, index) => <li key={index}><Example example={example}/></li>)}</ul>
          </li>)}
        </ul>
      </details>
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
