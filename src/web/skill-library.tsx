import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { Project, Skill } from '../shared.ts';
import type { LibrarySkill, SkillCatalog, SkillDocument } from '../skill-library.ts';
import { Icon } from './icons.tsx';
import { Markdown } from './markdown.tsx';
import { skillDescription, skillIcon, skillName } from './skills.tsx';
import { t } from './i18n.ts';
import './skill-library.css';

type API = <T>(route: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
export interface SkillLibraryOptions { project?: Project; api: API; onChanged: () => void }
export interface SkillLibraryControls { cancel: () => void; navigate: (proceed: () => void) => void }
type Editor = { id: string; source: Skill['source']; content: string; saved?: SkillDocument };
const key = (skill: Pick<Skill, 'source' | 'id'>) => `${skill.source}/${skill.id}`;
const sourceName = (source: Skill['source']) => source === 'builtin' ? t('Built-in') : source === 'user' ? t('Global') : t('This paper');
const instructions = (content: string) => content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '').trim();
function skillError(failure: unknown) {
  const message = failure instanceof Error ? failure.message : String(failure);
  switch (message) {
    case 'This skill changed on disk. Reload it before saving.': return t('This skill changed on disk. Reload it before saving.');
    case 'This skill changed on disk. Reload it before deleting.': return t('This skill changed on disk. Reload it before deleting.');
    case 'A skill with this ID already exists in this location.': return t('A skill with this ID already exists in this location.');
    case 'This skill no longer exists. Refresh the list.': return t('This skill no longer exists. Refresh the list.');
    case 'This skill was removed on disk. Reload the list before saving.': return t('This skill was removed on disk. Reload the list before saving.');
    case 'The skill must contain instructions.': return t('The skill must contain instructions.');
    case 'Skill content must contain 1–20,000 characters.': return t('Skill content must contain 1–20,000 characters.');
    default: return message;
  }
}

export function SkillLibraryPanel({ project, api, onChanged, onClose, controls }: SkillLibraryOptions & { onClose: () => void; controls: Ref<SkillLibraryControls> }) {
  const panel = useRef<HTMLDivElement>(null), sequence = useRef(0), mounted = useRef(true), pending = useRef(false);
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null), [editor, setEditor] = useState<Editor | null>(null);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<Skill['source'] | 'all'>('all');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const [leaving, setLeaving] = useState<{ proceed: () => void } | null>(null);
  const suffix = project ? `?projectId=${encodeURIComponent(project.id)}` : '';
  const dirty = Boolean(editor && (!editor.saved || editor.content !== editor.saved.content));
  const readonly = editor?.source === 'builtin';

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; sequence.current++; };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  useEffect(() => { if (leaving || confirmDelete) panel.current?.querySelector<HTMLButtonElement>('[data-keep-editing]')?.focus(); }, [leaving, confirmDelete]);
  useImperativeHandle(controls, () => ({ cancel, navigate }));

  function navigate(proceed: () => void) {
    if (busy) return;
    if (dirty) setLeaving({ proceed }); else { setConfirmDelete(false); proceed(); }
  }
  async function choose(skill: LibrarySkill) {
    const request = ++sequence.current;
    setLoading(true); setError(''); setSaved(false); setConfirmDelete(false); setEditor(null);
    try {
      const document = await api<SkillDocument>(`/skills/${key(skill)}${suffix}`);
      if (mounted.current && request === sequence.current) { setEditor({ ...document, saved: document }); setPreview(document.source === 'builtin'); }
    } catch (failure) { if (mounted.current && request === sequence.current) setError(skillError(failure)); }
    finally { if (mounted.current && request === sequence.current) setLoading(false); }
  }
  async function reload() {
    const request = ++sequence.current;
    setLoading(true); setError(''); setEditor(null); setSaved(false); setConfirmDelete(false);
    try {
      const next = await api<SkillCatalog>(`/skills${suffix}`);
      if (!mounted.current || request !== sequence.current) return;
      setCatalog(next); setLoading(false);
      if (next.skills[0] && !window.matchMedia('(max-width: 680px)').matches) void choose(next.skills[0]);
    } catch (failure) { if (mounted.current && request === sequence.current) { setError(skillError(failure)); setLoading(false); } }
  }
  function create(copy?: Editor) {
    sequence.current++; setLoading(false); setError(''); setSaved(false); setPreview(false); setQuery(''); setFilter('all'); setConfirmDelete(false);
    let id = copy?.id || '';
    if (copy) {
      let number = 1;
      while (catalog?.skills.some(skill => skill.source === 'user' && skill.id === id)) id = `${copy.id.slice(0, 37)}-copy${number++ > 1 ? number - 1 : ''}`;
    }
    setEditor({ id, source: 'user', content: copy?.content || `---\nname: ${t('New skill')}\ndescription: \n---\n\n` });
    requestAnimationFrame(() => panel.current?.querySelector<HTMLInputElement>('[name="skill-id"]')?.focus());
  }
  function change(update: Partial<Editor>) { setEditor(current => current ? { ...current, ...update } : null); setSaved(false); setConfirmDelete(false); }
  async function save(remove = false) {
    if (!editor || pending.current) return;
    pending.current = true; setBusy(true); setError(''); setSaved(false);
    try {
      const document = await api<SkillDocument>(`/skills/${key(editor)}${remove ? '/remove' : ''}`, { projectId: project?.id, content: editor.content, revision: editor.saved?.revision });
      onChanged();
      if (!mounted.current) return;
      setConfirmDelete(false);
      if (remove) { setEditor(null); await reload(); }
      else {
        setEditor({ ...document, saved: document }); setSaved(true);
        // The write has succeeded even if refreshing the catalog now fails.
        setCatalog(await api<SkillCatalog>(`/skills${suffix}`));
      }
    } catch (failure) { if (mounted.current) setError(skillError(failure)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  function cancel() {
    if (busy) return;
    if (leaving) setLeaving(null);
    else if (confirmDelete) setConfirmDelete(false);
    else navigate(onClose);
  }
  const visible = (catalog?.skills || []).filter(skill => (filter === 'all' || skill.source === filter) && `${skill.id} ${skillName(skill)} ${skillDescription(skill)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const body = editor ? instructions(editor.content) : '';
  return <div ref={panel} className={'skill-library' + (editor || loading || error ? ' has-editor' : '')} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); if (dirty && !readonly && body && !busy && !leaving && !confirmDelete) void save(); } }}>
      <div className="skill-library-layout" inert={Boolean(leaving || confirmDelete)}>
        <aside className="skill-library-sidebar">
          <div className="skill-library-tools"><div className="skill-library-search"><Icon name="search" size={14}/><input type="search" aria-label={t('Search skills')} placeholder={t('Search skills')} value={query} onChange={event => setQuery(event.target.value)}/></div><button className="icon-button" aria-label={t('Refresh skills')} title={t('Refresh skills')} disabled={busy || loading} onClick={() => navigate(() => void reload())}><Icon name="refresh" size={14}/></button><button className="icon-button" aria-label={t('New skill')} title={t('New skill')} disabled={!catalog || busy} onClick={() => navigate(() => create())}><Icon name="plus" size={17}/></button></div>
          <div className="skill-library-filter" role="group" aria-label={t('Skill scope')}>
            <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{t('All')}</button><button aria-pressed={filter === 'user'} onClick={() => setFilter('user')}>{t('Global')}</button>{project && <button aria-pressed={filter === 'paper'} onClick={() => setFilter('paper')}>{t('This paper')}</button>}<button aria-pressed={filter === 'builtin'} onClick={() => setFilter('builtin')}>{t('Built-in')}</button>
          </div>
          <nav className="skill-library-list" aria-label={t('Skills')}>
            {visible.map(skill => <button key={key(skill)} className={'skill-library-item' + (editor?.saved && key(editor) === key(skill) ? ' active' : '')} aria-current={editor?.saved && key(editor) === key(skill) ? 'true' : undefined} disabled={busy} onClick={() => { if (editor?.saved && key(editor) === key(skill)) return; navigate(() => void choose(skill)); }}><Icon name={skillIcon(skill.id)} size={16}/><span><span className="skill-library-item-title"><strong>{skillName(skill)}</strong><span className="skill-library-source">{sourceName(skill.source)}</span></span><small title={skillDescription(skill)}>{!skill.active ? <><span className="skill-library-overridden">{t('Overridden')}</span> · </> : null}{skillDescription(skill) || `/${skill.id}`}</small></span></button>)}
            {catalog && !visible.length && <p className="skill-library-empty">{t('No matching skills')}</p>}
          </nav>
        </aside>
        <div className="skill-library-detail">
          <button className="skill-library-back" onClick={() => navigate(() => { sequence.current++; setEditor(null); setLoading(false); })}><Icon name="chevronLeft" size={15}/>{t('All skills')}</button>
          {loading ? <p className="skill-library-empty" role="status">{t('Loading skills…')}</p> : editor ? <>
            <div className="skill-library-editor-heading"><div><h3>{editor.saved ? skillName(editor.saved) : t('New skill')}</h3><span>{sourceName(editor.source)}{editor.source === 'paper' && project ? ` · ${project.name}` : ''}</span></div><button className="button secondary compact" disabled={busy} onClick={() => navigate(() => create(editor))}><Icon name="copy" size={14}/>{t('Copy and edit')}</button></div>
            {!editor.saved && <div className="skill-library-new-fields"><label>{t('Skill ID')}<input name="skill-id" value={editor.id} placeholder="my-skill" pattern="[a-z0-9][a-z0-9-]{0,47}" maxLength={48} disabled={busy} onChange={event => change({ id: event.target.value })} spellCheck={false}/></label><label>{t('Save to')}<select value={editor.source} disabled={busy} onChange={event => change({ source: event.target.value as Skill['source'] })}><option value="user">{t('Global')}</option>{project && <option value="paper">{t('This paper')}</option>}</select></label><p>{t('Use lowercase letters, numbers and hyphens. This is also the / command name.')}</p></div>}
            {readonly ? <p className="skill-library-notice">{t('Copy this built-in skill to customize it for all papers or this paper.')}</p> : <div className="skill-library-edit-tools"><span>{t('Skill content (Markdown)')}</span><div className="segmented" role="group" aria-label={t('Skill content view')}><button aria-pressed={!preview} onClick={() => setPreview(false)}><Icon name="pencil" size={13}/>{t('Edit')}</button><button aria-pressed={preview} onClick={() => setPreview(true)}>{t('Preview')}</button></div></div>}
            {preview ? <div className="skill-library-preview"><Markdown text={body}/></div> : <textarea className="skill-library-content" aria-label={t('Skill content (Markdown)')} value={editor.content} onChange={event => change({ content: event.target.value })} disabled={busy} maxLength={20000} spellCheck={false}/>}
            {editor.saved && !editor.saved.active && <p className="skill-library-notice">{t('A skill with the same ID takes priority here: this paper, then global, then built-in.')}</p>}
            <footer className="skill-library-editor-actions">{editor.saved && !readonly && <button className="button ghost danger-text compact" disabled={busy} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14}/>{t('Delete skill')}</button>}<span role="status">{saved ? t('Saved') : dirty ? t('Unsaved changes') : ''}</span>{!readonly && <button className="button primary compact" disabled={busy || !dirty || !body || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(editor.id)} onClick={() => void save()}>{busy ? t('Saving…') : t('Save')}</button>}</footer>
          </> : !error && <p className="skill-library-empty">{t('Select a skill or create your own.')}</p>}
          {error && <p className="inline-error" role="alert">{error}<button className="button secondary compact" disabled={busy} onClick={() => navigate(() => void reload())}>{t('Refresh skills')}</button></p>}
        </div>
      </div>
      {(leaving || confirmDelete) && <div className="skill-library-confirm" role="alert"><p>{leaving ? t('Discard unsaved skill changes?') : t('Delete this skill? Only its Markdown file is removed; supporting files stay in place.')}</p><div><button data-keep-editing className="button secondary compact" disabled={busy} onClick={() => { setLeaving(null); setConfirmDelete(false); }}>{t('Keep editing')}</button><button className="button danger compact" disabled={busy} onClick={() => { if (leaving) { const { proceed } = leaving; setLeaving(null); setConfirmDelete(false); proceed(); } else void save(true); }}>{leaving ? t('Discard changes') : t('Delete skill')}</button></div></div>}
  </div>;
}
