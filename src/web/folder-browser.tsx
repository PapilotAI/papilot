import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FolderListing } from '../shared.ts';
import { chooseDirectory, nativeFolders } from './desktop-chrome.tsx';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './folder-browser.css';

type Api = <T = any>(route: string, body?: unknown, signal?: AbortSignal) => Promise<T>;

// The desktop app and a browser on the computer running Papilot use the system
// folder picker. `pick` resolves null when cancelled, or undefined on another
// device, such as a phone connected through Tailscale, where the page browses instead.
export function useFolderPicker(api: Api) {
  const [waiting, setWaiting] = useState(false), request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function pick(title: string, start: string): Promise<string | null | undefined> {
    if (nativeFolders) return chooseDirectory();
    const controller = new AbortController(); request.current = controller; setWaiting(true);
    try {
      const value = await api<{ path: string | null } | { unavailable: true }>('/folders/choose', { title, path: start }, controller.signal);
      return 'unavailable' in value ? undefined : value.path;
    } catch (failure) { if (controller.signal.aborted) return null; throw failure; }
    finally { if (request.current === controller) { request.current = null; setWaiting(false); } }
  }
  return { waiting, pick, cancel: () => request.current?.abort() };
}

// A folder path that can be typed, or chosen with Browse… Choosing a folder calls
// `onPicked`; typing only changes the value, so the form decides when to use it.
export function FolderField({ id, name = 'path', api, label, value, onChange, title, action, onPicked, onError, disabled, placeholder, describedBy, children }: {
  id: string; name?: string; api: Api; label: string; value: string; onChange: (path: string) => void; title: string; action: string;
  onPicked: (path: string) => void; onError: (message: string) => void; disabled: boolean; placeholder?: string; describedBy?: string; children?: ReactNode;
}) {
  const picker = useFolderPicker(api), [browsing, setBrowsing] = useState(false), edits = useRef(0);
  async function browse() {
    if (picker.waiting) return;
    if (browsing) { setBrowsing(false); return; }
    let path: string | null | undefined = null;
    try { path = await picker.pick(title, value); }
    catch (failure) { onError(failure instanceof Error ? failure.message : String(failure)); return; }
    if (path === undefined) setBrowsing(true);
    else if (path) onPicked(path);
  }
  return <>
    <label htmlFor={id}>{label}</label>
    <div className="folder-field-row">
      <div className="folder-field">
        <input id={id} name={name} value={value} required disabled={disabled} maxLength={4000} placeholder={placeholder} aria-describedby={describedBy} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={event => { edits.current++; picker.cancel(); onChange(event.target.value); }}/>
        <button type="button" className="folder-field-browse" disabled={disabled} aria-label={t('Browse…')} title={t('Browse…')} aria-busy={picker.waiting || undefined} aria-expanded={browsing} aria-controls={id + '-browser'} onClick={() => void browse()}><Icon name="folder" size={16}/></button>
      </div>
      {children}
    </div>
    {browsing && <FolderBrowser id={id + '-browser'} api={api} start={value} edits={edits} action={action} onPath={onChange} onChoose={path => { setBrowsing(false); document.getElementById(id)?.focus(); onPicked(path); }} onCancel={() => { setBrowsing(false); document.getElementById(id)?.focus(); }}/>}
  </>;
}

// Lists folders on the computer running Papilot. Entering a folder updates the
// path field unless it was edited meanwhile; the action chooses the folder shown.
function FolderBrowser({ id, api, start, edits, action, onPath, onChoose, onCancel }: { id: string; api: Api; start: string; edits: { current: number }; action: string; onPath: (path: string) => void; onChoose: (path: string) => void; onCancel: () => void }) {
  const [listing, setListing] = useState<FolderListing | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const current = useRef<HTMLDivElement>(null), request = useRef<AbortController | null>(null);
  async function load(target: string, focus: boolean) {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    const edited = edits.current;
    try {
      const value = await api<FolderListing>('/folders', { path: target }, controller.signal);
      setListing(value);
      // A path typed while the list loaded wins, and typing keeps focus.
      if (edits.current !== edited) return;
      onPath(value.path);
      // The activated folder button is replaced, so focus moves to the new location.
      if (focus) requestAnimationFrame(() => current.current?.focus());
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (request.current === controller) setLoading(false); }
  }
  useEffect(() => { void load(start, true); return () => request.current?.abort(); }, []);
  const name = listing ? listing.path.split(/[\\/]/).filter(Boolean).at(-1) || listing.path : '';
  return <div id={id} className="folder-browser" role="group" aria-labelledby={id + '-where'} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
    <div className="folder-browser-head">
      <button type="button" className="icon-button" aria-label={t('Parent folder')} title={t('Parent folder')} disabled={!listing?.parent || loading} onClick={() => void load(listing!.parent!, true)}><Icon name="arrowUp" size={16}/></button>
      <div ref={current} className="folder-browser-current" tabIndex={-1}>{listing ? <><strong>{name}</strong><span>{listing.path}</span></> : <span>{t('Loading folders…')}</span>}</div>
    </div>
    <div className="folder-browser-body">
      {error ? <p className="inline-error" role="alert">{error}</p>
        : !listing ? null
        : listing.folders.length ? <ul role="list" className="folder-browser-list" aria-label={listing.path} aria-busy={loading || undefined}>
          {listing.folders.map(folder => <li key={folder.path}><button type="button" disabled={loading} onClick={() => void load(folder.path, true)}><Icon name="folder" size={15}/><span>{folder.name}</span><Icon name="chevronRight" size={14}/></button></li>)}
        </ul>
        : <p className="folder-browser-note">{t('No folders inside.')}</p>}
    </div>
    <div className="folder-browser-actions">
      <span id={id + '-where'}>{t('Folders on the computer running Papilot')}</span>
      <div className="folder-browser-buttons">
        <button type="button" className="button ghost compact" onClick={onCancel}>{t('Cancel')}</button>
        <button type="button" className="button primary compact" disabled={!listing || loading || Boolean(error)} onClick={() => listing && onChoose(listing.path)}>{action}</button>
      </div>
    </div>
  </div>;
}
