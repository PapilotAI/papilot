import { useEffect, useId, useRef, useState } from 'react';
import type { MemoryCatalog, MemoryScope, Project } from '../shared.ts';
import { ActionMenu, type MenuAction } from './action-menu.tsx';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import { failureText, memoryScopeName } from './memory-card.tsx';
import './memory.css';

type API = <T>(route: string, body?: unknown) => Promise<T>;
export interface MemorySettingsOptions { project?: Project; api: API }
type View = 'paper' | 'personal';

// Settings → Memory: the preferences agents follow, for this paper (kept in
// this checkout or shared with coauthors) and for all papers.
export function MemorySettings({ project, api }: MemorySettingsOptions) {
  const [catalog, setCatalog] = useState<MemoryCatalog | null>(null);
  const [view, setView] = useState<View>(project ? 'paper' : 'personal');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ scope: MemoryScope; rule: string; text: string } | null>(null);
  const toggle = useId(), add = useId(), name = useId();
  // Where focus goes once a change lands: the edited rule's button, or the
  // field to add another, since the control that was used is gone.
  const root = useRef<HTMLDivElement>(null), focus = useRef<string | null>(null);
  useEffect(() => {
    const target = focus.current;
    if (!target || !catalog) return;
    focus.current = null;
    (root.current?.querySelector<HTMLElement>(target === 'add' ? `#${CSS.escape(add)}` : `[data-memory-rule="${CSS.escape(target)}"] .memory-edit-button`) || root.current?.querySelector<HTMLElement>(`#${CSS.escape(add)}`))?.focus();
  }, [catalog, editing, add]);
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
  const scopes: MemoryScope[] = view === 'paper' ? ['paper', 'shared'] : ['personal'];
  const rules = scopes.flatMap(scope => (file(scope)?.rules || []).map(rule => ({ scope, rule })));
  const target: MemoryScope = view === 'paper' ? 'paper' : 'personal';
  const moves = (scope: MemoryScope, rule: string): MenuAction[] => [
    ...(['paper', 'shared', 'personal'] as MemoryScope[]).filter(other => other !== scope && (project || other === 'personal')).map(to => ({
      label: to === 'shared' ? t('Share with coauthors') : to === 'paper' ? (scope === 'shared' ? t('Stop sharing') : t('Move to this paper')) : t('Move to all papers'),
      disabled: busy || (to === 'shared' && !catalog?.shareable),
      select: () => void change('move', { scope, to, text: rule, revisions: { from: file(scope)?.revision, to: file(to)?.revision } }),
    })),
    { label: t('Delete'), divider: true, danger: true, disabled: busy, select: () => { focus.current = 'add'; void change('remove', { scope, text: rule, revision: file(scope)?.revision }); } },
  ];
  return <div ref={root} className="settings-page memory-settings">
    <section className="settings-card">
      <div className="settings-row settings-toggle">
        <div className="settings-text">
          <label className="settings-name" htmlFor={toggle}>{t('Learn from reviews')}</label>
          <p id={toggle + '-detail'}>{t('After you finish reviewing a task, suggest preferences from your notes, comments and rejected edits. Nothing is saved until you choose Remember.')}</p>
        </div>
        <input id={toggle} type="checkbox" role="switch" className="switch" aria-describedby={toggle + '-detail'} checked={catalog?.learning ?? true} disabled={!catalog || busy} onChange={event => void change('learning', { enabled: event.target.checked })}/>
      </div>
    </section>
    <section className="memory-rules" aria-label={t('Saved preferences')}>
      {project && <div className="segmented memory-view" role="radiogroup" aria-label={t('Preferences for')}>
        {(['paper', 'personal'] as View[]).map(option => <label key={option} className={view === option ? 'checked' : undefined}>
          <input type="radio" name={name} value={option} checked={view === option} onChange={() => { setView(option); setEditing(null); }}/>
          <span>{option === 'paper' ? t('This paper') : t('All papers')}</span>
        </label>)}
      </div>}
      {!catalog && !error && <p className="muted" role="status">{t('Loading memory…')}</p>}
      {catalog && !rules.length && <p className="memory-empty">{view === 'paper' ? t('No preferences for this paper yet.') : t('No preferences for all papers yet.')}</p>}
      {rules.length > 0 && <ul className="memory-list">
        {rules.map(({ scope, rule }) => <li key={scope + rule} data-memory-rule={scope + rule}>
          {editing?.scope === scope && editing.rule === rule
            ? <form className="memory-edit" onSubmit={event => { event.preventDefault(); const text = editing.text.trim(); void change('update', { scope, previous: rule, text, revision: file(scope)?.revision }).then(done => { if (done) { focus.current = scope + text; setEditing(null); } }); }}>
              <label className="sr-only" htmlFor={add + '-edit'}>{t('Preference')}</label>
              {/* Escape cancels; Enter submits through the form, which leaves IME composition alone. */}
              <input id={add + '-edit'} value={editing.text} disabled={busy} autoFocus onChange={event => setEditing({ ...editing, text: event.target.value })} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); focus.current = scope + rule; setEditing(null); } }}/>
              <button type="button" className="button secondary compact" onClick={() => { focus.current = scope + rule; setEditing(null); }}>{t('Cancel')}</button>
              <button type="submit" className="button primary compact" disabled={busy || !editing.text.trim()}>{t('Save')}</button>
            </form>
            : <>
              <p>{rule}{scope === 'shared' && <span className="memory-tag" title={t('Shared with coauthors through Git')}>{t('Shared')}</span>}</p>
              <button type="button" className="icon-button memory-edit-button" aria-label={t('Edit preference')} disabled={busy} onClick={() => setEditing({ scope, rule, text: rule })}><Icon name="pen" size={14}/></button>
              <ActionMenu label={t('More actions for this preference')} actions={moves(scope, rule)} disabled={busy}/>
            </>}
        </li>)}
      </ul>}
      {catalog && <form className="memory-add" onSubmit={event => { event.preventDefault(); void change('add', { scope: target, text: draft, revision: file(target)?.revision }).then(done => { if (done) { focus.current = 'add'; setDraft(''); } }); }}>
        <label className="sr-only" htmlFor={add}>{t('New preference')}</label>
        <input id={add} value={draft} disabled={busy} placeholder={view === 'paper' ? t('Add a preference for this paper') : t('Add a preference for all papers')} onChange={event => setDraft(event.target.value)}/>
        <button type="submit" className="button secondary compact" disabled={busy || !draft.trim()}>{t('Add')}</button>
      </form>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {catalog && <dl className="memory-location">
        {scopes.map(scope => <div key={scope}><dt>{memoryScopeName(scope)}</dt><dd><code>{file(scope)?.path}</code></dd></div>)}
      </dl>}
    </section>
  </div>;
}
