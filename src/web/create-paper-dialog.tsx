import { useEffect, useId, useRef, useState } from 'react';
import type { Project } from '../shared.ts';
import { Icon } from './icons.tsx';
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
const GROUPS = ['thesis', 'conference', 'journal', 'slides', 'poster', 'cv', 'book', 'other'] as const;
type Group = typeof GROUPS[number] | 'all';
const groupOf = (template: PaperTemplate): Group => (GROUPS as readonly string[]).includes(template.category) ? template.category as Group : 'other';
const groupLabel = (group: Group) => ({ all: t('All'), thesis: t('Theses'), conference: t('Conferences'), journal: t('Journals'), slides: t('Slides'), poster: t('Posters'), cv: t('CVs'), book: t('Books'), other: t('Other') })[group];
const ENGINE: Record<string, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };
const templateName = (template: Choice) => locale().startsWith('zh') && template.zh?.name ? template.zh.name : template.name;
// Where a template comes from, unless its name already says so (NeurIPS 2026).
const templateMeta = (template: Choice) => { if (template.family) return template.family; const from = template.venue ? [template.venue.name, template.venue.year].filter(Boolean).join(' ') : template.organization ?? ''; return template.name.includes(from) ? '' : from; };
const choiceOf = ({ id, version, name, zh, engine, thumbnail, organization, venue }: PaperTemplate, family?: string): Choice => ({ id, version, name, ...(zh ? { zh } : {}), engine, ...(thumbnail ? { thumbnail } : {}), ...(organization ? { organization } : {}), ...(venue ? { venue } : {}), ...(family ? { family } : {}) });
// Conferences are listed alphabetically: Universe serves every field, not one ranking.
const isVenue = (template: PaperTemplate) => Boolean(template.template || template.venue);
// crypto.randomUUID is unavailable on LAN HTTP. Keep a UUID-shaped random ID.
const uuid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
export function CreatePaperPanel({ api, onDone, preset, tab, active, onBusyChange }: { api: <T>(url: string, body?: unknown) => Promise<T>; onDone: (paper: Project) => Promise<void>; preset?: { id: string; version: string }; tab: 'blank' | 'templates'; active: boolean; onBusyChange: (busy: boolean) => void }) {
  const dialog = useRef<HTMLDivElement>(null), pending = useRef(false), id = useId();
  const [form, setForm] = useState(initialForm), [busy, setBusy] = useState(false), [error, setError] = useState('');
  // A saved draft starts at the details. A link from the Universe website waits on
  // the template step until its exact version is found, so Create cannot use another.
  const [step, setStep] = useState<'template' | 'details'>(() => !preset && (initialForm().template || initialForm().example) ? 'details' : 'template');
  const [browseAll, setBrowseAll] = useState(Boolean(preset));
  const [templates, setTemplates] = useState<PaperTemplate[] | null>(null), [unavailable, setUnavailable] = useState('');
  const [group, setGroup] = useState<Group>('all'), [query, setQuery] = useState('');
  useEffect(() => {
    let live = true;
    if (!form.parent) void api<{ parent: string }>('/projects/create-defaults').then(value => { if (live) setForm(current => current.parent ? current : { ...current, parent: value.parent }); }, failure => { if (live) setError(failure instanceof Error ? failure.message : String(failure)); });
    // Without templates (offline, or none published) the dialog is the plain form.
    const loaded = (list: PaperTemplate[], problem = '') => {
      if (!live) return;
      setTemplates(list); setUnavailable(list.length ? '' : problem);
      const found = preset && list.find(item => item.id === preset.id && item.version === preset.version);
      if (found) { setForm(current => ({ ...current, example: false, template: choiceOf(found, list.find(item => item.id === found.template)?.name) })); setStep('details'); }
    };
    void api<{ templates?: PaperTemplate[]; error?: string }>('/universe').then(value => loaded(Array.isArray(value?.templates) ? value.templates : [], value?.error), failure => loaded([], failure instanceof Error ? failure.message : String(failure)));
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (active && tab === 'templates' && step === 'details') dialog.current?.querySelector<HTMLInputElement>('[name="name"]')?.focus();
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
  // Shared templates show as first pages; conferences that reuse them as a list, in
  // the Conferences group or when a search matches them.
  const shown = group === 'conference' ? [] : (templates || []).filter(item => !item.template && (group === 'all' || groupOf(item) === group) && matches(item));
  const venues = group === 'conference' || (group === 'all' && words.length) ? (templates || []).filter(item => isVenue(item) && matches(item)).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })) : [];
  const pick = (template: PaperTemplate | null) => { setForm(current => ({ ...current, example: !template, template: template && choiceOf(template, familyName(template)) })); setError(''); setStep('details'); };
  return <div ref={dialog} className="create-paper-dialog">
      {tab === 'templates' && step === 'template' ? <>
        <div className="template-heading"><h3>{browseAll ? t('Templates') : t('Featured templates')}</h3><button type="button" className="button ghost compact" onClick={() => { setBrowseAll(!browseAll); setGroup('all'); setQuery(''); }}>{browseAll ? t('Featured') : t('Browse all')}<Icon name="arrowRight" size={14}/></button></div>
        {browseAll && <div className="template-tools">
          {groups.length > 1 && <div className="template-groups" role="group" aria-label={t('Template type')}>{(['all', ...groups] as Group[]).map(key => <button key={key} type="button" aria-pressed={group === key} onClick={() => setGroup(key)}>{groupLabel(key)}</button>)}</div>}
          {Boolean(templates?.length) && <label className="template-search"><Icon name="search" size={14}/><input type="search" value={query} placeholder={t('Search templates')} aria-label={t('Search templates')} autoComplete="off" spellCheck={false} onChange={event => setQuery(event.target.value)}/></label>}
        </div>}
        <div className="template-grid" role="list" aria-label={t('Templates')}>
          {group === 'all' && !words.length && <button type="button" role="listitem" className="template-card" aria-pressed={!form.template} onClick={() => pick(null)}>
            <span className="template-thumb blank"><Icon name="paper" size={24}/></span>
            <span className="template-name">{t('Example project')}</span>
          </button>}
          {(browseAll ? shown : shown.slice(0, 5)).map(item => <button key={item.id} type="button" role="listitem" className="template-card" aria-pressed={form.template?.id === item.id} title={templateName(item)} onClick={() => pick(item)}>
            <span className="template-thumb">{item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer"/>}</span>
            <span className="template-name">{templateName(item)}</span>
            <span className="template-meta">{templateMeta(item)}</span>
          </button>)}
          {templates === null && [0, 1, 2].map(key => <span key={key} className="template-card placeholder" aria-hidden="true"><span className="template-thumb"/></span>)}
          {venues.length > 0 && <div className="template-venues" role="group" aria-label={t('Conferences')}>
            {venues.map(item => <button key={item.id} type="button" className="template-venue" aria-pressed={form.template?.id === item.id} title={item.venue?.full ?? item.description} onClick={() => pick(item)}>
              <span className="template-venue-name">{templateName(item)}</span>
              <span className="template-venue-full">{item.venue?.full ?? item.description}</span>
              <span className="template-venue-family">{familyName(item) ?? ''}</span>
            </button>)}
          </div>}
        </div>
        {unavailable && <p className="template-status" role="status">{unavailable}</p>}
      </> : <>
        {tab === 'templates' && <div className="template-chosen">
          <span className="template-thumb">{chosen?.thumbnail ? <img src={chosen.thumbnail} alt="" referrerPolicy="no-referrer"/> : <Icon name="paper" size={14}/>}</span>
          <span className="template-chosen-text"><strong>{chosen ? templateName(chosen) : t('Example project')}</strong><span>{chosen ? [templateMeta(chosen), ENGINE[chosen.engine]].filter(Boolean).join(' · ') : 'pdfLaTeX'}</span></span>
          <button type="button" className="button ghost compact" disabled={busy} onClick={() => setStep('template')}>{t('Change…')}</button>
        </div>}
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label htmlFor={id + '-name'}>{t('Paper name')}</label><input id={id + '-name'} name="name" value={form.name} required maxLength={120} autoComplete="off" disabled={busy} onChange={event => setForm({ ...form, name: event.target.value })}/>
        {nativeFolders ? <div className="create-paper-save-label" id={id + '-location'}>{t('Save in')}</div> : <label htmlFor={id + '-parent'}>{t('Save in')}</label>}
        <div className="create-paper-location">
          {nativeFolders ? <><Icon name="folder" size={16}/><div className="create-paper-location-copy" role="group" aria-labelledby={id + '-location'}><strong>{form.parent.split(/[\\/]/).filter(Boolean).at(-1) || form.parent}</strong><span>{form.parent}</span></div><button type="button" className="button secondary compact" disabled={busy} onClick={() => void browse()}>{t('Change…')}</button></> : <input id={id + '-parent'} name="parent" value={form.parent} required maxLength={4000} autoComplete="off" spellCheck={false} disabled={busy} onChange={event => setForm({ ...form, parent: event.target.value })}/>}
        </div>
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
