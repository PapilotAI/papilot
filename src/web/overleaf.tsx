import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { OverleafBrowserSession, OverleafComparison, OverleafPerson, OverleafProjectSummary, OverleafState, OverleafSync } from '../shared.ts';
import { Icon } from './icons.tsx';
import { BrandIcon } from './brand-icon.tsx';
import { keepDialogFocus } from './focus.ts';
import { errorText, locale, t, tn } from './i18n.ts';
import { personHue, personName, usePresence } from './overleaf-presence.ts';
import './overleaf.css';

// Overleaf sync in the app: signing in, linking a paper to a project, its
// status beside Version Management, and passages both sides changed.

type Api = <T = any>(route: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
export const OVERLEAF = 'https://www.overleaf.com';
const host = (origin: string) => { try { return new URL(origin).host.replace(/^www\./, ''); } catch { return origin; } };
/** The server an Overleaf address belongs to, or null for other links. */
export function overleafOrigin(value: string) {
  const text = value.trim();
  if (/^[a-f0-9]{24}$/i.test(text)) return OVERLEAF;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : 'https://' + text);
    if (url.hostname === 'overleaf.com' || url.hostname === 'www.overleaf.com') return OVERLEAF;
    return /^\/project\/[a-f0-9]{24}(?:\/share)?\/?$/i.test(url.pathname) ? url.origin : null;
  } catch { return null; }
}
const desktopSignIn = () => window.papilotDesktop?.overleafSignIn;

/** Signs in to an Overleaf server: with the session of a browser on this
 *  computer that is signed in already, in a window of the desktop app,
 *  which handles Google and institutional logins, or with a session cookie. */
export function OverleafSignIn({ api, origin, onSignedIn, server, onServer }: { api: Api; origin: string; onSignedIn: () => void; server?: boolean; onServer?: (origin: string) => void }) {
  const id = useId(), openWindow = desktopSignIn();
  const [cookie, setCookie] = useState(''), [busy, setBusy] = useState<string | false>(false), [error, setError] = useState('');
  const [sessions, setSessions] = useState<OverleafBrowserSession[] | null>(null);
  // Focus moves into the sign-in when it first appears, never while an address is typed.
  const [settled, setSettled] = useState(false);
  useEffect(() => { if (sessions && !settled) setSettled(true); }, [sessions]);
  useEffect(() => {
    let stop = new AbortController();
    const list = () => {
      stop.abort();
      const signal = (stop = new AbortController()).signal;
      api<{ sessions: OverleafBrowserSession[] }>('/overleaf/browsers', { origin }, signal).then(value => setSessions(Array.isArray(value.sessions) ? value.sessions : []), () => { if (!signal.aborted) setSessions(current => current || []); });
    };
    // While a server address is typed, look once typing pauses.
    const timer = setTimeout(list, settled ? 400 : 0);
    // A browser signed in meanwhile is found on coming back to Papilot.
    window.addEventListener('focus', list);
    return () => { clearTimeout(timer); stop.abort(); window.removeEventListener('focus', list); };
  }, [origin]);
  // Closing the sign-in cancels a request still waiting, such as a Keychain prompt.
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const [other, setOther] = useState(origin !== OVERLEAF), [address, setAddress] = useState(origin === OVERLEAF ? '' : host(origin));
  function changeServer(value: string) {
    setAddress(value);
    try { onServer?.(value.trim() ? new URL(/^[a-z]+:\/\//i.test(value.trim()) ? value.trim() : 'https://' + value.trim()).origin.replace('https://overleaf.com', OVERLEAF) : OVERLEAF); } catch { /* Not an address yet. */ }
  }
  async function submit(body: { cookies: string | null; fresh?: boolean } | { browser: string }, key = 'cookie') {
    if ('cookies' in body && !body.cookies) return;
    const stop = pending.current = new AbortController();
    setBusy(key); setError('');
    try { await api('/overleaf/sign-in', { origin, ...body }, stop.signal); if (!stop.signal.aborted) onSignedIn(); }
    catch (failure) { if (!stop.signal.aborted) setError((failure as Error).message); }
    finally { if (!stop.signal.aborted) setBusy(false); }
  }
  const found = sessions?.length ? sessions : null;
  const form = <form onSubmit={event => { event.preventDefault(); void submit({ cookies: cookie.trim() }); }}>
    <label htmlFor={id}>{t('Session cookie from {server}', { server: host(origin) })}</label>
    <div className="overleaf-row">
      <input id={id} type="password" autoComplete="off" spellCheck={false} autoFocus={!found && !settled} value={cookie} placeholder="overleaf_session2=…" disabled={Boolean(busy)} onChange={event => setCookie(event.target.value)}/>
      <button className="button primary compact" disabled={Boolean(busy) || !cookie.trim()}>{busy === 'cookie' ? <span className="spinner light"/> : null}{t('Sign in')}</button>
    </div>
    <CookieSteps origin={origin}/>
  </form>;
  return <div className="overleaf-sign-in">
    {server && (other
      ? <label className="overleaf-server">{t('Overleaf server')}<input value={address} placeholder="overleaf.example.edu" spellCheck={false} autoCapitalize="none" onChange={event => changeServer(event.target.value)}/></label>
      : <button type="button" className="overleaf-other" onClick={() => setOther(true)}>{t('Use another Overleaf server')}</button>)}
    {found && <div className="overleaf-browsers">
      {found.map((session, index) => <button key={session.id} type="button" className={'button compact ' + (index ? 'secondary' : 'primary')} autoFocus={!index && !settled} disabled={Boolean(busy)} onClick={() => void submit({ browser: session.id }, session.id)}>
        {busy === session.id ? <span className={'spinner' + (index ? '' : ' light')}/> : <BrandIcon name="overleaf" size={15}/>}{t('Use the sign-in from {browser}', { browser: session.profile ? `${session.browser} · ${session.profile}` : session.browser })}
      </button>)}
    </div>}
    {sessions && (openWindow
      ? <button type="button" className={'button compact ' + (found ? 'secondary' : 'primary')} disabled={Boolean(busy)} onClick={() => void openWindow(origin).then(cookies => submit({ cookies, fresh: true }, 'window'), failure => setError((failure as Error).message))}>{busy === 'window' ? <span className={'spinner' + (found ? '' : ' light')}/> : <BrandIcon name="overleaf" size={15}/>}{t('Sign in to {server}', { server: host(origin) })}</button>
      : found ? <details className="overleaf-help overleaf-paste"><summary><Icon name="chevronRight" size={13}/>{t('Paste a session cookie instead')}</summary>{form}</details> : form)}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}

// Marks where a value set apart, such as a cookie name, goes in a
// translated sentence.
const MARK = '\u0000';
const spliced = (text: string, value: React.ReactNode) => { const [head, tail = ''] = text.split(MARK); return <>{head}{value}{tail}</>; };

/** Where a browser keeps the session cookie, shown in place. */
function CookieSteps({ origin }: { origin: string }) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return <details className="overleaf-help">
    <summary><Icon name="chevronRight" size={13}/>{t('Where to find it')}</summary>
    <ol>
      <li>{t('On a computer, sign in to {server} in a browser.', { server: host(origin) })}</li>
      <li>{spliced(t('Open the developer tools: {keys}.', { keys: MARK }), <kbd>{mac ? '⌥⌘I' : 'F12'}</kbd>)}</li>
      <li>{spliced(t('Choose Application (Chrome, Edge) or Storage (Safari, Firefox), then Cookies › {site}.', { site: MARK }), <code>{origin}</code>)}</li>
      <li>{spliced(t('Copy the value of {cookie} and paste it here.', { cookie: MARK }), <code>{origin === OVERLEAF ? 'overleaf_session2' : 'overleaf.sid'}</code>)}</li>
    </ol>
  </details>;
}

function Dialog({ title, className, onClose, children }: { title: React.ReactNode; className?: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null, element = dialog.current!;
    element.showModal();
    return () => { element.close(); if (opener?.isConnected && opener.getClientRects().length) opener.focus(); };
  }, []);
  return <dialog ref={dialog} className="modal-backdrop" aria-labelledby={id} onKeyDown={keepDialogFocus} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={'modal overleaf-dialog ' + (className || '')}>
      <button className="modal-close icon-button" aria-label={t('Close')} onClick={onClose}><Icon name="close"/></button>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  </dialog>;
}

const files = (list: string[]) => <ul className="overleaf-files">{list.slice(0, 6).map(file => <li key={file}><code>{file}</code></li>)}{list.length > 6 && <li className="overleaf-more">{tn(list.length - 6, 'and {n} more', 'and {n} more')}</li>}</ul>;

/** Links the open paper to an Overleaf project: chosen from the account's
 *  projects or pasted as a link, compared, then synced. */
/** Linking a paper to a project, or, for a synced paper (`current`), moving
 *  it to another project: either way, compared first. */
export function OverleafLinkDialog({ api, projectId, overleaf, current, onClose, onLinked = onClose }: { api: Api; projectId: string; overleaf: OverleafState | undefined; current?: OverleafSync; onClose: () => void; onLinked?: () => void }) {
  const fieldId = useId();
  const replace = current ? { replace: true } : {};
  const [link, setLink] = useState(''), [origin, setOrigin] = useState(current?.origin || overleaf?.accounts[0]?.origin || OVERLEAF);
  const [projects, setProjects] = useState<OverleafProjectSummary[] | null>(null), [filter, setFilter] = useState('');
  const [comparison, setComparison] = useState<OverleafComparison | null>(null), [choice, setChoice] = useState<'overleaf' | 'local'>('overleaf');
  const [busy, setBusy] = useState<'' | 'compare' | 'link'>(''), [error, setError] = useState(''), [signIn, setSignIn] = useState<string | null>(null);
  const signedIn = Boolean(overleaf?.accounts.some(account => account.origin === origin));
  useEffect(() => {
    if (!signedIn || signIn) { setProjects(null); return; }
    const stop = new AbortController();
    api<{ projects: OverleafProjectSummary[] }>(`/overleaf/projects?origin=${encodeURIComponent(origin)}`, undefined, stop.signal).then(value => { if (!stop.signal.aborted) setProjects(value.projects); }, failure => { if (!stop.signal.aborted) { if ((failure as { signIn?: string }).signIn) setSignIn(origin); else setError((failure as Error).message); } });
    return () => stop.abort();
  }, [origin, signedIn, signIn]);
  async function compare(value: string) {
    setLink(value); setComparison(null); setError('');
    const server = overleafOrigin(value);
    if (!server) { if (value.trim()) setError(t('Paste the link of an Overleaf project.')); return; }
    setOrigin(server);
    setBusy('compare');
    try { setComparison(await api<OverleafComparison>(`/projects/${projectId}/overleaf/compare`, { url: value.trim(), ...replace })); }
    catch (failure) { if ((failure as { signIn?: string }).signIn) setSignIn((failure as { signIn: string }).signIn); else setError((failure as Error).message); }
    finally { setBusy(''); }
  }
  async function start() {
    setBusy('link'); setError('');
    try { await api(`/projects/${projectId}/overleaf/link`, { url: link.trim(), choice, ...replace }); onLinked(); }
    catch (failure) { setError((failure as Error).message); setBusy(''); }
  }
  const shown = useMemo(() => (projects || []).filter(item => item.name.toLowerCase().includes(filter.trim().toLowerCase())), [projects, filter]);
  const isCurrent = (item: OverleafProjectSummary) => current?.origin === origin && current.overleafId === item.id;
  const date = (time: number | null) => time ? new Date(time).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: new Date(time).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '';
  return <Dialog title={<><BrandIcon name="overleaf" size={22}/>{current ? t('Change Overleaf project') : t('Sync with Overleaf')}</>} onClose={() => { if (busy !== 'link') onClose(); }}>
    {signIn ? <OverleafSignIn api={api} origin={signIn} onSignedIn={() => { setSignIn(null); if (link) void compare(link); }}/> : <>
      {!comparison && (signedIn ? <>
        <div className="overleaf-projects">
          <div className="overleaf-projects-head"><span>{t('Your projects')}</span>{projects && projects.length > 8 && <input type="search" aria-label={t('Search projects')} placeholder={t('Search projects')} value={filter} onChange={event => setFilter(event.target.value)}/>}</div>
          {projects === null ? <p className="overleaf-quiet" role="status"><span className="spinner"/>{t('Loading projects…')}</p>
            : <ul role="list" aria-label={t('Your projects')}>{shown.map((item, index) => {
              // The project the paper syncs with now stays where it is.
              const syncing = isCurrent(item);
              return <li key={item.id}><button type="button" autoFocus={index === shown.findIndex(other => !isCurrent(other))} disabled={Boolean(busy) || syncing} aria-current={syncing || undefined} onClick={() => void compare(`${origin}/project/${item.id}`)}>
                <span className="overleaf-project-name">{item.name}</span><span className="overleaf-project-meta">{syncing ? t('Syncing now') : [item.owner, date(item.updatedAt)].filter(Boolean).join(' · ')}</span>
              </button></li>;
            })}{!shown.length && <li className="overleaf-quiet">{t('No matching projects')}</li>}</ul>}
        </div>
        <form className="overleaf-link" onSubmit={event => { event.preventDefault(); void compare(link); }}>
          <label htmlFor={fieldId}>{t('Or paste a project or sharing link')}</label>
          <div className="overleaf-row">
            <input id={fieldId} type="url" inputMode="url" autoCapitalize="none" spellCheck={false} value={link} disabled={Boolean(busy)} placeholder={`${OVERLEAF}/project/…`} onChange={event => { setLink(event.target.value); setError(''); }}/>
            <button className="button primary compact" disabled={Boolean(busy) || !link.trim()}>{busy === 'compare' ? <span className="spinner light"/> : <Icon name="arrowRight" size={15}/>}{t('Next')}</button>
          </div>
        </form>
      </> : <OverleafSignIn api={api} origin={origin} server onServer={setOrigin} onSignedIn={() => undefined}/>)}
      {comparison && <div className="overleaf-compare">
        <p className="overleaf-compare-title"><BrandIcon name="overleaf" size={16}/><strong>{comparison.name}</strong></p>
        <ul className="overleaf-counts">
          <li><Icon name="check" size={14}/>{tn(comparison.same, '{n} file matches', '{n} files match')}</li>
          {comparison.overleaf.length > 0 && <li><Icon name="download" size={14}/>{tn(comparison.overleaf.length, '{n} file only on Overleaf', '{n} files only on Overleaf')}</li>}
          {comparison.local.length > 0 && <li><Icon name="arrowUp" size={14}/>{tn(comparison.local.length, '{n} file only in this paper', '{n} files only in this paper')}</li>}
          {comparison.different.length > 0 && <li className="overleaf-differ"><Icon name="diff" size={14}/>{tn(comparison.different.length, '{n} file differs', '{n} files differ')}</li>}
        </ul>
        {comparison.different.length > 0 && <>
          {files(comparison.different)}
          <div className="view-selector overleaf-choice" role="group" aria-label={t('Where files differ')}>
            <button type="button" aria-pressed={choice === 'overleaf'} onClick={() => setChoice('overleaf')}><BrandIcon name="overleaf" size={14}/>{t('Keep Overleaf’s')}</button>
            <button type="button" aria-pressed={choice === 'local'} onClick={() => setChoice('local')}><Icon name="paper" size={14}/>{t('Keep this paper’s')}</button>
          </div>
        </>}
      </div>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {comparison && <div className="button-row">
        <button type="button" className="button secondary" disabled={busy === 'link'} onClick={() => setComparison(null)}>{t('Back')}</button>
        <button type="button" className="button primary" autoFocus disabled={busy === 'link'} onClick={() => void start()}>{busy === 'link' ? <span className="spinner light"/> : <Icon name="refresh" size={15}/>}{current ? t('Switch project') : t('Start syncing')}</button>
      </div>}
    </>}
  </Dialog>;
}

export function syncLabel(sync: OverleafSync) {
  return sync.state === 'synced' ? t('Synced')
    : sync.state === 'syncing' ? tn(sync.pending, 'Sending {n} file…', 'Sending {n} files…')
      : sync.state === 'connecting' ? t('Connecting to Overleaf…')
        : sync.state === 'paused' ? t('Paused during a Git merge')
          : sync.state === 'signed-out' ? t('Signed out')
            : sync.state === 'no-access' ? t('No access to the project')
              : t('Offline, retrying');
}
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => [...part][0]!.toUpperCase()).join('') || '?';
// Each coauthor keeps a color, as their cursor has on Overleaf.
const Face = ({ person }: { person: OverleafPerson }) => <i title={personName(person)} style={{ '--face': `${personHue(person.id)}` } as React.CSSProperties}>{initials(person.name)}</i>;
/** The changed part of two versions of a passage, marked in each. */
function Marked({ text, other }: { text: string; other: string }) {
  let start = 0, end = 0;
  while (start < text.length && start < other.length && text[start] === other[start]) start++;
  while (end < text.length - start && end < other.length - start && text[text.length - 1 - end] === other[other.length - 1 - end]) end++;
  return <>{text.slice(0, start)}<mark>{text.slice(start, text.length - end)}</mark>{text.slice(text.length - end)}</>;
}

/** The sidebar row of a synced paper: its state and who is on Overleaf now. */
export function OverleafRow({ sync, onOpen }: { sync: OverleafSync; onOpen: () => void }) {
  const attention = sync.conflicts.length > 0 || ['signed-out', 'no-access', 'offline'].includes(sync.state);
  return <button type="button" className={'nav-link overleaf-link' + (attention ? ' attention' : '')} title={`${sync.name}\n${syncLabel(sync)}`} aria-label={t('Overleaf: {state}', { state: syncLabel(sync) })} onClick={onOpen}>
    <BrandIcon name="overleaf" size={16}/><span className="nav-label">Overleaf</span>
    <span className="nav-meta">
      {sync.collaborators.length > 0 && <span className="overleaf-faces" aria-hidden>{sync.collaborators.slice(0, 3).map(person => <Face key={person.id} person={person}/>)}</span>}
      {sync.conflicts.length > 0 ? <span className="count">{sync.conflicts.length}</span> : <span className={'overleaf-dot ' + sync.state} aria-hidden/>}
    </span>
  </button>;
}

/** A synced paper's Overleaf details: state, coauthors online, passages
 *  both sides changed, and stopping the sync. */
export function OverleafPanel({ api, sync, overleaf, onClose, onOpenFile }: { api: Api; sync: OverleafSync; overleaf: OverleafState | undefined; onClose: () => void; onOpenFile?: (file: string, line?: number) => void }) {
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [stopping, setStopping] = useState(false), [changing, setChanging] = useState(false);
  const cursors = usePresence(sync.projectId);
  const signedIn = Boolean(overleaf?.accounts.some(account => account.origin === sync.origin));
  async function act(key: string, route: string) {
    setBusy(key); setError('');
    try { await api(`/projects/${sync.projectId}/overleaf/${route}`, {}); return true; }
    catch (failure) { setError((failure as Error).message); return false; }
    finally { setBusy(''); }
  }
  // Another project is picked in place of the panel, which comes back if the author changes their mind.
  if (changing) return <OverleafLinkDialog api={api} projectId={sync.projectId} overleaf={overleaf} current={sync} onClose={() => setChanging(false)} onLinked={onClose}/>;
  return <Dialog title={<><BrandIcon name="overleaf" size={22}/>{t('Sync with Overleaf')}</>} className="overleaf-panel" onClose={onClose}>
    {/* The project, as a location row: its name and server, and another in its place. */}
    <div className="paper-location overleaf-project" title={sync.url}>
      <span className="paper-location-path"><span className="paper-location-name">{sync.name || t('Overleaf')}</span></span>
      <span className="overleaf-project-host">{host(sync.origin)}</span>
      <button type="button" className="button ghost compact" aria-label={t('Change project…')} disabled={Boolean(busy)} onClick={() => setChanging(true)}>{t('Change…')}</button>
    </div>
    <div className={'overleaf-state ' + sync.state}>
      <span className={'overleaf-dot ' + sync.state} aria-hidden/>
      <span>{syncLabel(sync)}{sync.readOnly ? ` · ${t('View only')}` : sync.tracking ? ` · ${t('Track changes on')}` : ''}</span>
      {(sync.state === 'offline' || sync.state === 'no-access') && <button type="button" className="button ghost compact" disabled={Boolean(busy)} onClick={() => void act('retry', 'retry')}>{t('Retry')}</button>}
    </div>
    {sync.state === 'signed-out' || !signedIn ? <OverleafSignIn api={api} origin={sync.origin} onSignedIn={() => undefined}/> : null}
    {sync.message && sync.state !== 'synced' && sync.state !== 'syncing' && <p className="overleaf-quiet">{errorText(sync.message)}</p>}
    {sync.collaborators.length > 0 && <div className="overleaf-people" aria-label={t('On Overleaf now')}>
      <span className="overleaf-section">{t('On Overleaf now')}</span>
      <ul>{sync.collaborators.map(person => {
        // Their file opens where their cursor is.
        const line = cursors.find(cursor => cursor.id === person.id && cursor.file === person.file)?.line;
        return <li key={person.id}>
          <Face person={person}/><span className="overleaf-person">{personName(person)}</span>
          {person.file && (onOpenFile
            ? <button type="button" className="overleaf-person-file" title={t('Open {file} where {name} is', { file: person.file, name: personName(person) })} onClick={() => { onOpenFile(person.file!, line); onClose(); }}>{person.file}</button>
            : <span className="overleaf-person-file">{person.file}</span>)}
        </li>;
      })}</ul>
    </div>}
    {sync.conflicts.length > 0 && <div className="overleaf-conflicts">
      <span className="overleaf-section">{sync.conflicts.every(conflict => conflict.kind === 'text') ? tn(sync.conflicts.length, '{n} place changed on both sides', '{n} places changed on both sides') : tn(sync.conflicts.length, '{n} version of yours set aside', '{n} versions of yours set aside')}</span>
      <ul>{sync.conflicts.map(conflict => <li key={conflict.id}>
        <code className="overleaf-conflict-file">{conflict.path}</code>
        {conflict.kind === 'text' ? <div className="overleaf-versions">
          <div><span>{t('Overleaf')}</span><p>{conflict.theirs ? <Marked text={conflict.theirs} other={conflict.ours || ''}/> : <em>{t('(removed)')}</em>}</p></div>
          <div><span>{t('Your version')}</span><p>{conflict.ours ? <Marked text={conflict.ours} other={conflict.theirs || ''}/> : <em>{t('(removed)')}</em>}</p></div>
        </div> : <p className="overleaf-quiet">{t('Overleaf’s file replaced yours.')}</p>}
        <div className="overleaf-conflict-actions">
          <button type="button" className="button ghost compact" disabled={Boolean(busy)} onClick={() => void act(conflict.id, `conflicts/${conflict.id}/dismiss`)}>{t('Keep Overleaf’s')}</button>
          <button type="button" className="button secondary compact" disabled={Boolean(busy)} onClick={() => void act(conflict.id, `conflicts/${conflict.id}/use-mine`)}>{busy === conflict.id ? <span className="spinner"/> : null}{t('Use mine')}</button>
        </div>
      </li>)}</ul>
    </div>}
    {sync.skipped.length > 0 && <details className="overleaf-skipped"><summary><Icon name="chevronRight" size={13}/>{tn(sync.skipped.length, '{n} file not synced', '{n} files not synced')}</summary>{files(sync.skipped)}</details>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="button-row overleaf-footer">
      {stopping
        ? <button type="button" className="button danger compact" disabled={Boolean(busy)} onClick={() => void act('unlink', 'unlink').then(done => { if (done) onClose(); })}>{t('Stop syncing')}</button>
        : <button type="button" className="button ghost compact overleaf-stop" onClick={() => setStopping(true)}>{t('Stop syncing…')}</button>}
      <a className="button secondary compact" href={sync.url} target="_blank" rel="noreferrer"><Icon name="external" size={14}/>{t('Open in Overleaf')}</a>
      <button type="button" className="button primary compact" autoFocus onClick={onClose}>{t('Done')}</button>
    </div>
  </Dialog>;
}

/** Overleaf accounts in Settings. */
export function OverleafAccounts({ api, overleaf }: { api: Api; overleaf: OverleafState | undefined }) {
  const [adding, setAdding] = useState(false), [server, setServer] = useState(''), [busy, setBusy] = useState('');
  const accounts = overleaf?.accounts || [];
  const origin = (() => { try { return server.trim() ? new URL(/^[a-z]+:\/\//i.test(server.trim()) ? server.trim() : 'https://' + server.trim()).origin : OVERLEAF; } catch { return OVERLEAF; } })();
  return <section className="settings-card">
    {accounts.map(account => <div className="settings-row" key={account.origin}>
      <div className="settings-text"><span className="settings-name">{account.email || host(account.origin)}</span><p>{host(account.origin)}</p></div>
      <button type="button" disabled={busy === account.origin} onClick={() => { setBusy(account.origin); void api('/overleaf/sign-out', { origin: account.origin }).finally(() => setBusy('')); }}>{t('Sign out')}</button>
    </div>)}
    {!accounts.length || adding ? <div className="settings-row overleaf-add">
      <div className="settings-text"><span className="settings-name">{t('Overleaf server')}</span>
        <input aria-label={t('Overleaf server')} value={server} placeholder="overleaf.com" spellCheck={false} onChange={event => setServer(event.target.value)}/>
      </div>
      <OverleafSignIn api={api} origin={origin} onSignedIn={() => { setAdding(false); setServer(''); }}/>
    </div> : <div className="settings-row"><div className="settings-text"/><button type="button" onClick={() => setAdding(true)}>{t('Add account')}</button></div>}
  </section>;
}
