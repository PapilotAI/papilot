import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ZoteroStatus } from '../shared.ts';
import { Icon } from './icons.tsx';
import { locale, t } from './i18n.ts';
import { FolderField } from './folder-browser.tsx';

export interface ZoteroApi {
  load: (sync: boolean, signal: AbortSignal) => Promise<ZoteroStatus>;
  connect: (key: string) => Promise<ZoteroStatus>;
  disconnect: () => Promise<ZoteroStatus>;
  use: (use: boolean) => Promise<ZoteroStatus>;
  /** Choose Zotero's data directory on this host, or null for the one Zotero's settings name. */
  locate: (dataDir: string | null) => Promise<ZoteroStatus>;
  /** Browses folders on this host for the folder field. */
  folders: <T = any>(route: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
}

// The Zotero libraries the Library takes PDFs from. Zotero on this host is
// found by itself and read, never changed, with nothing to sign in to. A
// computer without Zotero uses the author's Zotero account instead, through
// an API key that stays on the server Papilot runs on.
export function ZoteroSettings({ api, hosted = false }: { api: ZoteroApi; hosted?: boolean }) {
  const [status, setStatus] = useState<ZoteroStatus | null>(null), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const [switching, setSwitching] = useState(false), [useError, setUseError] = useState('');
  const [key, setKey] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const keyInput = useRef<HTMLInputElement>(null);
  const accountTitle = useId(), keyId = useId(), keyHelp = useId(), keyError = useId(), placeId = useId(), placeHelp = useId();
  // Choosing the data directory: the folder typed or browsed to, and why it was refused.
  const [place, setPlace] = useState<string | null>(null), [placing, setPlacing] = useState(false), [placeError, setPlaceError] = useState('');
  async function locate(dataDir: string | null) {
    setPlacing(true); setPlaceError('');
    try { setStatus(await api.locate(dataDir)); setPlace(null); }
    catch (failure) { setPlaceError((failure as Error).message); }
    finally { setPlacing(false); }
  }
  // Opening the page, or Detect again, looks for Zotero here and syncs the account.
  useEffect(() => {
    const controller = new AbortController();
    setStatus(null); setFailed(false);
    void api.load(true, controller.signal).then(value => { if (!controller.signal.aborted) setStatus(value); }, () => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [api, attempt]);
  // A sync in progress is followed until it ends, through a missed answer too.
  useEffect(() => {
    if (!status?.account?.syncing) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void api.load(false, controller.signal).then(value => { if (!controller.signal.aborted) setStatus(value); }, () => {
      if (!controller.signal.aborted) setStatus(current => current && { ...current });
    }), 1500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [api, status]);
  async function change(action: () => Promise<ZoteroStatus>) {
    setBusy(true); setError('');
    try { setStatus(await action()); setKey(''); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  // A refused key is corrected in its field, once it can take focus again.
  useEffect(() => { if (error && !busy) keyInput.current?.focus(); }, [error, busy]);
  function connect(event: FormEvent) {
    event.preventDefault();
    if (key.trim()) void change(() => api.connect(key.trim()));
    else setError(t('Paste the API key you created on zotero.org.'));
  }
  async function switchUse(use: boolean) {
    setSwitching(true); setUseError('');
    try { setStatus(await api.use(use)); }
    catch (failure) { setUseError((failure as Error).message); }
    finally { setSwitching(false); }
  }
  const count = (n: number) => n.toLocaleString(locale());
  const local = status?.local, account = status?.account;
  const sum = (field: 'items' | 'withPdf' | 'citationKeys') => count(account?.libraries.reduce((total, library) => total + library[field], 0) ?? 0);
  const names = account ? new Intl.ListFormat(locale(), { type: 'conjunction' }).format(account.libraries.map(library => library.name ?? t('My Library'))) : '';
  return <div className="settings-page">
    {!hosted && <section className="settings-card settings-card-body" aria-label={t('Zotero on this computer')}>
      <header className="settings-tool-header">
        <h3>{t('Zotero on this computer')}</h3>
        <button type="button" className="icon-button" aria-label={t('Detect again')} title={t('Detect again')} disabled={!status && !failed} onClick={() => setAttempt(value => value + 1)}><Icon name="refresh" size={16}/></button>
      </header>
      {failed ? <p role="alert" className="settings-intro">{t('Could not look for Zotero. Try again.')}</p>
        : !local ? <p role="status" className="settings-intro">{t('Looking for Zotero…')}</p>
        : local.state === 'missing' ? <p role="status" className="settings-intro">{local.chosen ? t('No Zotero library is at {path} now.', { path: local.chosen }) : t('No Zotero library was found on this host.')}</p>
        : <>
          <dl className="settings-facts">
            <div><dt>{t('Data directory')}</dt><dd><code>{local.dataDir}</code>{local.chosen && <span className="zotero-chosen">{t('Chosen by you')}</span>}</dd></div>
            {local.state === 'ready' && <>
              <div><dt>{t('Items')}</dt><dd>{count(local.items)}</dd></div>
              <div><dt>{t('Items with a PDF')}</dt><dd>{count(local.withPdf)}</dd></div>
              <div><dt>{t('Items with a citation key')}</dt><dd>{count(local.citationKeys)}</dd></div>
            </>}
          </dl>
          {local.state === 'unreadable' && <p role="alert" className="settings-intro">{t('Could not read the Zotero database. Try again.')}</p>}
        </>}
      {local && (place === null
        ? <div className="zotero-location-actions">
          <button type="button" className="button secondary compact" onClick={() => { setPlaceError(''); setPlace(local.chosen ?? (local.state === 'missing' ? '' : local.dataDir)); }}>{local.state === 'missing' && !local.chosen ? t('Choose folder…') : t('Change…')}</button>
          {local.chosen && <button type="button" className="button ghost compact" disabled={placing} onClick={() => void locate(null)}>{t('Use the detected location')}</button>}
        </div>
        : <form className="zotero-location" noValidate onSubmit={event => { event.preventDefault(); if (place.trim()) void locate(place); else setPlaceError(t('Choose Zotero\'s data directory, the folder with zotero.sqlite and storage.')); }}>
          <FolderField id={placeId} api={api.folders} label={t('Zotero data directory')} value={place} onChange={setPlace} title={t('Zotero data directory')} action={t('Use this folder')} describedBy={placeHelp}
            onPicked={path => { setPlace(path); void locate(path); }} onError={setPlaceError} disabled={placing}>
            <button type="submit" className="button primary compact" disabled={placing}>{placing && <span className="spinner light"/>}{t('Use')}</button>
            <button type="button" className="button ghost compact" disabled={placing} onClick={() => { setPlace(null); setPlaceError(''); }}>{t('Cancel')}</button>
          </FolderField>
          {placeError && <p role="alert" className="settings-warning">{placeError}</p>}
          <p id={placeHelp} className="settings-intro">{t('The folder with zotero.sqlite and storage. Zotero shows it in Settings, under Advanced, Files and Folders.')}</p>
        </form>)}
    </section>}
    {(status || hosted) && <section className="settings-card settings-card-body" aria-labelledby={accountTitle}>
      <header className="settings-tool-header">
        <h3 id={accountTitle}>{t('Zotero account')}</h3>
        {hosted && <button type="button" className="icon-button" aria-label={t('Refresh')} title={t('Refresh')} disabled={!status && !failed} onClick={() => setAttempt(value => value + 1)}><Icon name="refresh" size={16}/></button>}
      </header>
      {!status ? (failed ? <p role="alert" className="settings-intro">{t('Could not look for Zotero. Try again.')}</p>
        : <p role="status" className="settings-intro">{t('Looking for Zotero…')}</p>)
      : account ? <>
        <dl className="settings-facts">
          <div><dt>{t('Account')}</dt><dd>{account.username}</dd></div>
          {account.libraries.length > 0 && <>
            <div><dt>{t('Libraries')}</dt><dd>{names}</dd></div>
            <div><dt>{t('Items')}</dt><dd>{sum('items')}</dd></div>
            <div><dt>{t('Items with a PDF')}</dt><dd>{sum('withPdf')}</dd></div>
            <div><dt>{t('Items with a citation key')}</dt><dd>{sum('citationKeys')}</dd></div>
          </>}
          <div><dt>{t('Last synced')}</dt><dd role="status">{account.syncing ? t('Syncing…') : account.synced ? new Date(account.synced).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : t('Not yet')}</dd></div>
        </dl>
        {account.problem && !account.syncing && <p role="alert" className="settings-intro">{account.problem === 'revoked' ? t('Zotero no longer accepts this key. Disconnect, then connect with a new key.') : t('Could not reach zotero.org. Papilot tries again the next time the library opens.')}</p>}
        {error && <p role="alert" className="settings-intro">{error}</p>}
        <div className="zotero-account-actions"><button type="button" disabled={busy} onClick={() => void change(api.disconnect)}>{t('Disconnect')}</button></div>
      </> : <form className="zotero-key" aria-labelledby={accountTitle} noValidate onSubmit={connect}>
        <label htmlFor={keyId}>{t('API key')}</label>
        <div className="zotero-key-row">
          <input ref={keyInput} id={keyId} type="password" value={key} required spellCheck={false} autoCapitalize="none" autoCorrect="off" enterKeyHint="done"
            aria-invalid={error ? true : undefined} aria-describedby={error ? `${keyError} ${keyHelp}` : keyHelp} disabled={busy} onChange={event => { setKey(event.target.value); setError(''); }}/>
          <button type="submit" className="button primary compact" disabled={busy}>{busy && <span className="spinner light"/>}{t('Connect account')}</button>
        </div>
        {error && <p id={keyError} role="alert" className="settings-warning">{error}</p>}
        <p id={keyHelp} className="settings-intro">{!hosted && <>{t('For a computer without Zotero: PDFs are downloaded from Zotero\'s online storage.')} </>}<a href="https://www.zotero.org/settings/keys/new" target="_blank" rel="noopener noreferrer">{t('Create a key with library access')}</a></p>
      </form>}
    </section>}
    <section className="settings-card">
      <div className="settings-row settings-toggle">
        <div className="settings-text">
          <label className="settings-name" htmlFor="settings-zotero">{t('Use PDFs from Zotero')}</label>
          <p id="settings-zotero-detail">{t('Match bibliography entries with your Zotero libraries by citation key, DOI or title, and use their PDFs. Zotero is never changed.')}</p>
          {useError && <p role="alert" className="settings-warning">{useError}</p>}
        </div>
        <input id="settings-zotero" type="checkbox" role="switch" className="switch" aria-describedby="settings-zotero-detail" checked={status?.use ?? true} disabled={!status || switching} onChange={event => void switchUse(event.target.checked)}/>
      </div>
    </section>
  </div>;
}
