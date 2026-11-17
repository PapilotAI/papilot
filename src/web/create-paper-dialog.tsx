import { useEffect, useId, useRef, useState } from 'react';
import type { Project } from '../shared.ts';
import { Icon } from './icons.tsx';
import { FolderField } from './folder-browser.tsx';
import { locale, t } from './i18n.ts';
import { chooseDirectory, nativeFolders } from './desktop-chrome.tsx';
import { browserStorage } from './storage.ts';
import { requestId } from './request-id.ts';
import './create-paper-dialog.css';

const draftKey = 'papilot:create-paper', identityKey = draftKey + ':request';
// A Universe template as /api/universe lists it; null below means the blank paper.
export type PaperTemplate = { id: string; version: string; name: string; description?: string; zh?: { name?: string }; category: string; tags: string[]; organization?: string; venue?: { name: string; year?: number; full?: string }; template?: string; engine: string; thumbnail?: string };
// family: the name of the shared template a conference uses (PLDI 2027 → PACMPL).
type Choice = Pick<PaperTemplate, 'id' | 'version' | 'name' | 'zh' | 'engine' | 'thumbnail' | 'organization' | 'venue'> & { family?: string };
type Form = { name: string; parent: string; template: Choice | null; example?: boolean };
function initialForm(): Form {
  try {
    const saved = JSON.parse(browserStorage.getItem(draftKey) || 'null');
    const template = saved?.template && typeof saved.template.id === 'string' && typeof saved.template.version === 'string' && typeof saved.template.name === 'string' ? saved.template as Choice : null;
    if (typeof saved?.name === 'string' && typeof saved?.parent === 'string') return { name: saved.name, parent: saved.parent, template, example: saved.example === true };
  } catch { /* Ignore an unreadable draft. */ }
  return { name: '', parent: '', template: null };
}
const GROUPS = ['conference', 'journal', 'thesis', 'slides', 'poster', 'cv', 'book', 'other'] as const;
// Product browsing order, independent of years and the upstream catalog order.
const AI_CONFERENCES = ['neurips', 'icml', 'iclr', 'cvpr', 'iccv', 'eccv', 'acl', 'emnlp', 'naacl', 'aaai', 'ijcai', 'aistats', 'uai', 'sigkdd'];
const priority = (template: PaperTemplate) => { const index = AI_CONFERENCES.indexOf(template.id); return index < 0 ? AI_CONFERENCES.length : index; };
type Group = typeof GROUPS[number] | 'all';
const groupOf = (template: PaperTemplate): typeof GROUPS[number] => (GROUPS as readonly string[]).includes(template.category) ? template.category as typeof GROUPS[number] : 'other';
const groupLabel = (group: Group) => ({ all: t('All'), thesis: t('Theses'), conference: t('Conferences'), journal: t('Journals'), slides: t('Slides'), poster: t('Posters'), cv: t('CVs'), book: t('Books'), other: t('Other') })[group];
const ENGINE: Record<string, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };
const templateName = (template: Choice) => locale().startsWith('zh') && template.zh?.name ? template.zh.name : template.name;
// Where a template comes from, unless its name already says so (NeurIPS 2026).
const templateMeta = (template: Choice) => { if (template.family) return template.family; const from = template.venue ? [template.venue.name, template.venue.year].filter(Boolean).join(' ') : template.organization ?? ''; return template.name.includes(from) ? '' : from; };
const choiceOf = ({ id, version, name, zh, engine, thumbnail, organization, venue }: PaperTemplate, family?: string): Choice => ({ id, version, name, ...(zh ? { zh } : {}), engine, ...(thumbnail ? { thumbnail } : {}), ...(organization ? { organization } : {}), ...(venue ? { venue } : {}), ...(family ? { family } : {}) });
const isVenue = (template: PaperTemplate) => Boolean(template.template || template.venue);
// crypto.randomUUID is unavailable on LAN HTTP. Keep a UUID-shaped random ID.
const uuid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
export function CreatePaperPanel({ api, onDone, preset, tab, active, onBusyChange }: { api: <T>(url: string, body?: unknown) => Promise<T>; onDone: (paper: Project) => Promise<void>; preset?: { id: string; version: string }; tab: 'blank' | 'templates'; active: boolean; onBusyChange: (busy: boolean) => void }) {
  const dialog = useRef<HTMLDivElement>(null), pending = useRef(false), id = useId();
  const presetPending = useRef(Boolean(preset));
  const [form, setForm] = useState(initialForm), [busy, setBusy] = useState(false), [error, setError] = useState('');
  // A saved draft starts at the details. A link from the Universe website waits on
  // the template step until its exact version is found, so Create cannot use another.
  const [step, setStep] = useState<'template' | 'details'>(() => !preset && (initialForm().template || initialForm().example) ? 'details' : 'template');
  const [templates, setTemplates] = useState<PaperTemplate[] | null>(null), [unavailable, setUnavailable] = useState(false), [catalogAttempt, setCatalogAttempt] = useState(0);
  const [group, setGroup] = useState<Group>('all'), [query, setQuery] = useState('');
  // Choosing Blank is explicit, even if a website link is still resolving.
  useEffect(() => { if (active && tab === 'blank') presetPending.current = false; }, [active, tab]);
  useEffect(() => {
    let live = true;
    if (!form.parent) void api<{ parent: string }>('/projects/create-defaults').then(value => { if (live) setForm(current => current.parent ? current : { ...current, parent: value.parent }); }, failure => { if (live) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    setTemplates(null); setUnavailable(false);
    const loaded = (list: PaperTemplate[], problem = '') => {
      if (!live) return;
      setTemplates(list); setUnavailable(!list.length && Boolean(problem));
      const found = presetPending.current && preset && list.find(item => item.id === preset.id && item.version === preset.version);
      if (found) { presetPending.current = false; setForm(current => ({ ...current, example: false, template: choiceOf(found, list.find(item => item.id === found.template)?.name) })); setStep('details'); }
    };
    void api<{ templates?: PaperTemplate[]; error?: string }>('/universe').then(value => loaded(Array.isArray(value?.templates) ? value.templates : [], value?.error), failure => loaded([], failure instanceof Error ? failure.message : String(failure)));
    return () => { live = false; };
  }, [catalogAttempt]);
  function focusStep() {
    const selector = step === 'details' || tab === 'blank' ? '[name="name"]' : '.template-search input';
    dialog.current?.querySelector<HTMLInputElement>(selector)?.focus();
  }
  useEffect(() => {
    if (active && tab === 'templates') focusStep();
  }, [step]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => { browserStorage.setItem(draftKey, JSON.stringify(form)); }, [form]);
  const chosen = tab === 'templates' ? form.template : null, example = tab === 'templates' && form.example;
  // Show the folder creation will make instead of explaining it in prose.
  const name = form.name.trim(), parent = form.parent.trim();
  const target = name && parent ? (/[\\/]$/.test(parent) ? parent : parent + (parent.includes('\\') && !parent.includes('/') ? '\\' : '/')) + name : '';
  async function submit() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const body = { name: form.name.trim(), parent: form.parent.trim(), ...(chosen ? { template: { id: chosen.id, version: chosen.version } } : example ? { example: true } : {}) };
      const id = requestId(browserStorage, identityKey, JSON.stringify(body), uuid);
      const paper = await api<Project>('/projects/create', { id, ...body });
      await onDone(paper);
      browserStorage.removeItem(draftKey); browserStorage.removeItem(identityKey);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function browse() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { const parent = await chooseDirectory(); if (parent) setForm(current => ({ ...current, parent })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { pending.current = false; setBusy(false); requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>('.create-paper-location button')?.focus()); }
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const groups = GROUPS.filter(key => templates?.some(item => groupOf(item) === key));
  const familyName = (item: PaperTemplate) => item.template ? templates?.find(other => other.id === item.template)?.name : undefined;
  // A conference matches its shared template by id (lipics), not by that template's name,
  // which lists other venues (PACMPL (POPL, PLDI, …)).
  const matches = (item: PaperTemplate) => words.every(word => [item.id, item.name, item.zh?.name, item.organization, item.venue?.name, item.venue?.full, item.template, ...item.tags].some(value => value?.toLowerCase().includes(word)));
  // One card per result, including conferences with their own author kits. Shared
  // kit aliases appear in Conferences and search without duplicating the All grid.
  const shown = (templates || []).filter(item => {
    if (!matches(item)) return false;
    if (group === 'conference') return isVenue(item);
    if (group === 'all') return !item.template || words.length > 0;
    return !item.template && groupOf(item) === group;
  });
  shown.sort((a, b) => priority(a) - priority(b)
    || (group === 'all' ? GROUPS.indexOf(groupOf(a)) - GROUPS.indexOf(groupOf(b)) : 0)
    || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const pick = (template: PaperTemplate | null) => { presetPending.current = false; setForm(current => ({ ...current, example: !template, template: template && choiceOf(template, familyName(template)) })); setError(''); setStep('details'); };
  return <div ref={dialog} className="create-paper-dialog">
      {tab === 'templates' && unavailable && <div className="template-status" role="status"><span>{t('Templates are unavailable. You can still create a blank paper.')}</span><button type="button" className="button ghost compact" disabled={busy} onClick={() => { focusStep(); setCatalogAttempt(value => value + 1); }}>{t('Retry')}</button></div>}
      {tab === 'templates' && step === 'template' ? <>
        <search className="template-tools" aria-label={t('Templates')}>
          <div className="template-browse">
            <label className="template-search" htmlFor={id + '-search'}><Icon name="search" size={14}/><input id={id + '-search'} type="search" value={query} placeholder={t('Search templates')} aria-label={t('Search templates')} autoComplete="off" spellCheck={false} onChange={event => setQuery(event.target.value)}/></label>
            <a className="button ghost compact template-contribute" href="https://github.com/PapilotAI/universe/blob/main/CONTRIBUTING.md" target="_blank" rel="noreferrer" aria-label={t('Contribute')} title={t('Contribute')}><Icon name="github" size={16}/><span>{t('Contribute')}</span></a>
          </div>
          {groups.length > 1 && <div className="template-groups" role="group" aria-label={t('Template type')}>{(['all', ...groups] as Group[]).map(key => <button key={key} type="button" className="button ghost compact" aria-pressed={group === key} onClick={() => setGroup(key)}>{groupLabel(key)}</button>)}</div>}
        </search>
        <ul className="template-grid" role="list" aria-label={t('Templates')}>
          {group === 'all' && !words.length && <li><button type="button" className="template-card" aria-pressed={Boolean(form.example)} onClick={() => pick(null)}>
            <span className="template-thumb blank"><Icon name="paper" size={24}/></span>
            <span className="template-name">{t('Example project')}</span>
          </button></li>}
          {shown.map(item => <li key={item.id}><button type="button" className="template-card" aria-pressed={form.template?.id === item.id} title={item.venue?.full ?? templateName(item)} onClick={() => pick(item)}>
            <span className="template-thumb">{item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer"/>}</span>
            <span className="template-name">{templateName(item)}</span>
            <span className="template-meta">{familyName(item) ?? templateMeta(item)}</span>
          </button></li>)}
          {templates === null && [0, 1, 2].map(key => <li key={key} className="template-card placeholder" aria-hidden="true"><span className="template-thumb"/></li>)}
        </ul>
      </> : <>
        {tab === 'templates' && <div className="template-chosen">
          <span className="template-thumb">{chosen?.thumbnail ? <img src={chosen.thumbnail} alt="" referrerPolicy="no-referrer"/> : <Icon name="paper" size={14}/>}</span>
          <span className="template-chosen-text"><strong>{chosen ? templateName(chosen) : t('Example project')}</strong><span>{chosen ? [templateMeta(chosen), ENGINE[chosen.engine]].filter(Boolean).join(' · ') : 'pdfLaTeX'}</span></span>
          <button type="button" className="button ghost compact" disabled={busy} onClick={() => setStep('template')}>{t('Change…')}</button>
        </div>}
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label htmlFor={id + '-name'}>{t('Paper name')}</label><input id={id + '-name'} name="name" value={form.name} required maxLength={120} autoComplete="off" disabled={busy} onChange={event => setForm({ ...form, name: event.target.value })}/>
        {nativeFolders ? <>
          <div className="create-paper-save-label" id={id + '-location'}>{t('Save in')}</div>
          <div className="create-paper-location"><Icon name="folder" size={16}/><div className="create-paper-location-copy" role="group" aria-labelledby={id + '-location'}><strong>{form.parent.split(/[\\/]/).filter(Boolean).at(-1) || form.parent}</strong><span>{form.parent}</span></div><button type="button" className="button secondary compact" disabled={busy} onClick={() => void browse()}>{t('Change…')}</button></div>
        </> : <FolderField id={id + '-parent'} name="parent" api={api} label={t('Save in')} value={form.parent} onChange={parent => setForm(current => ({ ...current, parent }))} title={t('Save in')} action={t('Use this folder')} disabled={busy} onError={setError} onPicked={parent => setForm(current => ({ ...current, parent }))}/>}
        {busy && <p className="create-paper-status" role="status"><span className="spinner"/>{t('Creating your paper…')}</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="create-paper-footer">
          <p className="create-paper-target" title={target || undefined} aria-live="polite">{target && <span className="create-paper-target-path"><span className="paper-location-parent">{target.slice(0, -name.length)}</span><span className="paper-location-name">{name}</span></span>}</p>
          <button type="submit" className="button primary" disabled={busy || !form.name.trim() || !form.parent.trim()}>{t('Create paper')}</button>
        </div>
      </form>
      </>}
  </div>;
}
