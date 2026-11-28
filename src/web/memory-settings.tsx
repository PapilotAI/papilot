import { useEffect, useId, useRef, useState } from 'react';
import type { MemoryCatalog, MemoryScope, Project } from '../shared.ts';
import { ActionMenu, type MenuAction } from './action-menu.tsx';
import { ChipSelect } from './chip-select.tsx';
import { Icon } from './icons.tsx';
import { LANGUAGES, t } from './i18n.ts';
import { failureText } from './memory-card.tsx';
import './memory.css';

type API = <T>(route: string, body?: unknown) => Promise<T>;
export interface MemorySettingsOptions { project?: Project; api: API; hosted?: boolean }
type View = 'paper' | 'personal';
type Editing = { scope: MemoryScope; rule: string | null; text: string };

// Settings → Memory: whether and in which language Papilot suggests
// preferences, and the preferences agents follow, grouped by the file that
// holds them: this paper on this computer, shared with coauthors, or all papers.
export function MemorySettings({ project, api, hosted = false }: MemorySettingsOptions) {
  const [catalog, setCatalog] = useState<MemoryCatalog | null>(null);
  const [view, setView] = useState<View>(project ? 'paper' : 'personal');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // A rule being edited, or with rule null, a new one being added to scope.
  const [editing, setEditing] = useState<Editing | null>(null);
  const toggle = useId(), field = useId(), name = useId();
  // Where focus goes once a change lands, since the control that was used is
  // gone: the edited rule's button, or the add button of its group.
  const root = useRef<HTMLDivElement>(null), focus = useRef<string | null>(null);
  useEffect(() => {
    const target = focus.current;
    if (!target || !catalog || editing) return;
    focus.current = null;
    const rule = root.current?.querySelector<HTMLElement>(`[data-memory-rule="${CSS.escape(target)}"] .memory-edit-button`);
    (rule || root.current?.querySelector<HTMLElement>(`[data-memory-add="${CSS.escape(target)}"]`) || root.current?.querySelector<HTMLElement>('[data-memory-add]'))?.focus();
  }, [catalog, editing]);
  const query = project ? `?projectId=${encodeURIComponent(project.id)}` : '';
  useEffect(() => {
    let live = true;
    setCatalog(null); setError('');
    api<MemoryCatalog>('/memory' + query).then(value => { if (live) setCatalog(value); }, failure => { if (live) setError(failureText(failure)); });
    return () => { live = false; };
  }, [api, query]);
  async function change(route: string, body: object) {
    setBusy(true); setError('');
    try { setCatalog(await api<MemoryCatalog>('/memory/' + route, { ...body, ...(project ? { projectId: project.id } : {}) })); return true; }
    catch (failure) {
      setError(failureText(failure));
      // Another editor may have changed the file; show what is there now.
      api<MemoryCatalog>('/memory' + query).then(setCatalog, () => undefined);
      return false;
    } finally { setBusy(false); }
  }
  const file = (scope: MemoryScope) => catalog?.files.find(entry => entry.scope === scope);
  // The shared file is offered when Git would carry it, or when it already holds rules.
  const scopes: MemoryScope[] = view === 'personal' ? ['personal'] : ['paper', ...(catalog?.shareable || file('shared')?.rules.length ? ['shared' as const] : [])];
  const groupName = (scope: MemoryScope) => scope === 'paper' ? (hosted ? t('This paper') : t('Only on this computer')) : scope === 'shared' ? t('Shared with coauthors') : t('All papers');
  const moves = (scope: MemoryScope, rule: string): MenuAction[] => [
    ...(['paper', 'shared', 'personal'] as MemoryScope[]).filter(other => other !== scope && (project || other === 'personal')).map(to => ({
      label: to === 'shared' ? t('Share with coauthors') : to === 'paper' ? (scope === 'shared' ? t('Stop sharing') : t('Move to this paper')) : t('Move to all papers'),
      disabled: busy || (to === 'shared' && !catalog?.shareable),
      select: () => void change('move', { scope, to, text: rule, revisions: { from: file(scope)?.revision, to: file(to)?.revision } }),
    })),
    { label: t('Delete'), divider: true, danger: true, disabled: busy, select: () => { focus.current = scope; void change('remove', { scope, text: rule, revision: file(scope)?.revision }); } },
  ];
  function save(current: Editing) {
    const text = current.text.trim();
    const done = current.rule === null
      ? change('add', { scope: current.scope, text, revision: file(current.scope)?.revision })
      : change('update', { scope: current.scope, previous: current.rule, text, revision: file(current.scope)?.revision });
    void done.then(saved => { if (saved) { focus.current = current.rule === null ? current.scope : current.scope + text; setEditing(null); } });
  }
  const cancel = (current: Editing) => { focus.current = current.rule === null ? current.scope : current.scope + current.rule; setEditing(null); };
  // One field for editing a rule or adding one. Escape cancels; Enter submits
  // through the form, which leaves an input method's composition alone.
  const form = (current: Editing) => <form className="memory-form" onSubmit={event => { event.preventDefault(); save(current); }}>
    <label className="sr-only" htmlFor={field}>{current.rule === null ? t('New preference') : t('Preference')}</label>
    <input id={field} value={current.text} disabled={busy} autoFocus placeholder={current.rule === null ? t('Describe the preference') : undefined}
      onChange={event => setEditing({ ...current, text: event.target.value })}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(current); } }}/>
    <button type="button" className="button secondary compact" onClick={() => cancel(current)}>{t('Cancel')}</button>
    <button type="submit" className="button primary compact" disabled={busy || !current.text.trim()}>{current.rule === null ? t('Add') : t('Save')}</button>
  </form>;
  return <div ref={root} className="settings-page memory-settings">
    <section className="settings-card">
      <div className="settings-row settings-toggle">
        <div className="settings-text">
          <label className="settings-name" htmlFor={toggle}>{t('Learn from reviews')}</label>
          <p id={toggle + '-detail'}>{t('As you save a task, suggest writing habits noticed in your notes, comments and rejected edits. Nothing is saved until you choose Remember.')}</p>
        </div>
        <input id={toggle} type="checkbox" role="switch" className="switch" aria-describedby={toggle + '-detail'} checked={catalog?.learning ?? true} disabled={!catalog || busy} onChange={event => void change('learning', { enabled: event.target.checked })}/>
      </div>
      <div className="settings-row settings-choice">
        <div className="settings-text"><span className="settings-name">{t('Memory language')}</span><p>{t('For the preferences Papilot suggests. Auto follows the language of your feedback.')}</p></div>
        <ChipSelect label={t('Memory language')} value={catalog?.language || 'auto'} disabled={!catalog || busy} onChange={language => void change('language', { language })}
          options={[{ value: 'auto', label: t('Auto') }, ...LANGUAGES.map(item => ({ value: item.id, label: item.name }))]}/>
      </div>
    </section>
    <section className="memory-rules" aria-label={t('Saved preferences')}>
      {project && <div className="segmented memory-view" role="radiogroup" aria-label={t('Preferences for')}>
        {(['paper', 'personal'] as View[]).map(option => <label key={option} className={view === option ? 'checked' : undefined}>
          <input type="radio" name={name} value={option} checked={view === option} onChange={() => { setView(option); setEditing(null); }}/>
          <span>{option === 'paper' ? t('This paper') : t('All papers')}</span>
        </label>)}
      </div>}
      {!catalog && !error && <p className="memory-loading" role="status">{t('Loading memory…')}</p>}
      {catalog && scopes.map(scope => {
        const rules = file(scope)?.rules || [], adding = editing?.scope === scope && editing.rule === null;
        return <section key={scope} className="memory-group" aria-label={groupName(scope)}>
          <header><span>{groupName(scope)}</span>{!hosted && <code title={file(scope)?.path}>{file(scope)?.path}</code>}</header>
          <ul className="memory-list settings-card">
            {!rules.length && !adding && <li className="memory-empty">{t('No preferences yet')}</li>}
            {rules.map(rule => <li key={rule} data-memory-rule={scope + rule}>
              {editing?.scope === scope && editing.rule === rule ? form(editing) : <>
                <p>{rule}</p>
                <span className="memory-row-actions">
                  <button type="button" className="icon-button memory-edit-button" aria-label={t('Edit preference')} title={t('Edit preference')} disabled={busy} onClick={() => setEditing({ scope, rule, text: rule })}><Icon name="pen" size={14}/></button>
                  <ActionMenu label={t('More actions for this preference')} actions={moves(scope, rule)} disabled={busy}/>
                </span>
              </>}
            </li>)}
            <li className="memory-add-row">
              {adding ? form(editing) : <button type="button" className="memory-add" data-memory-add={scope} disabled={busy} onClick={() => setEditing({ scope, rule: null, text: '' })}><Icon name="plus" size={14}/>{t('Add preference')}</button>}
            </li>
          </ul>
        </section>;
      })}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>
  </div>;
}
