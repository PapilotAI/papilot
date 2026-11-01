import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.tsx';
import { keepDialogFocus } from './focus.ts';
import { t } from './i18n.ts';
import type { UpdateStatus } from '../shared.ts';
import './update-notice.css';

export type UpdateApi = <T = any>(route: string, body?: unknown) => Promise<T>;
const working = (status: UpdateStatus) => ['installing', 'waiting', 'restarting'].includes(status.phase);
// The sidebar notice and Settings may observe completion together.
let reloading = false;
export const versionLabel = (version: string) => version.replace(/(-dev\.[a-f0-9]{7})[a-f0-9]{33}$/, '$1');
function updateError(error: string) {
  if (error === 'The dev build needs at least 2 GB of free disk space. Free some space and retry.') return t('The dev build needs at least 2 GB of free disk space. Free some space and retry.');
  return error;
}
function useUpdates(api: UpdateApi, version?: string) {
  const [status, setState] = useState<UpdateStatus | null>(null);
  const revision = useRef(0);
  const setStatus = (value: UpdateStatus) => { revision.current++; setState(value); };
  const initialVersion = useRef(version);
  const current = useRef(status); current.current = status;
  useEffect(() => {
    let stopped = false, reading = false, timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      if (reading) return;
      reading = true;
      const request = ++revision.current;
      try {
        const next = await api<UpdateStatus>('/updates');
        if (stopped || request !== revision.current || !next?.currentVersion) return;
        initialVersion.current ??= next.currentVersion;
        setState(next);
        if (next.phase === 'updated' && next.currentVersion !== initialVersion.current && !reloading) {
          reloading = true; location.reload();
        }
      } catch { /* The old page stays usable while the server restarts. */ }
      finally { reading = false; if (!stopped) timer = setTimeout(read, current.current && working(current.current) ? 2000 : 30000); }
    };
    void read();
    const focus = () => { clearTimeout(timer); void read(); };
    window.addEventListener('online', focus); window.addEventListener('focus', focus);
    window.addEventListener('papilot:updates', focus);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener('online', focus); window.removeEventListener('focus', focus); window.removeEventListener('papilot:updates', focus); };
  }, [api, status?.phase]);
  return { status, setStatus };
}
export function UpdateNotice({ api, version }: { api: UpdateApi; version: string }) {
  const { status, setStatus } = useUpdates(api, version);
  const [open, setOpen] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null, element = dialog.current!;
    element.showModal();
    return () => { element.close(); if (opener?.isConnected) opener.focus(); };
  }, [open]);
  const currentVersion = <span className="brand-version" title={t('Papilot {version}', { version })}>v{versionLabel(version)}</span>;
  if (!status) return currentVersion;
  const busy = working(status), available = status.latestVersion && status.latestVersion !== status.currentVersion;
  if (!open && !busy && status.phase !== 'failed' && (!available || status.phase === 'idle')) return currentVersion;
  const label = status.phase === 'installing' ? t('Updating…') : status.phase === 'waiting' ? t('Update ready') : status.phase === 'restarting' ? t('Restarting…') : status.phase === 'failed' ? t('Update failed') : t('New version');
  const description = `${t('Papilot {version}', { version: versionLabel(version) })} · ${label}${status.latestVersion ? ` · v${versionLabel(status.latestVersion)}` : ''}`;
  async function install() {
    if (!status || sending) return;
    setSending(true); setError('');
    try { setStatus(await api<UpdateStatus>('/updates/install', { version: status.latestVersion })); }
    catch (error) { setError(error instanceof Error ? error.message : t('Could not start the update. Please retry.')); }
    finally { setSending(false); }
  }
  return <>
    <button type="button" className={'brand-version update-badge' + (status.phase === 'failed' ? ' failed' : '')} aria-label={description} aria-haspopup="dialog" aria-expanded={open} aria-busy={busy || undefined} title={description} onClick={() => setOpen(true)}>
      v{versionLabel(version)}
      <span className="update-dot" aria-hidden="true"/>
    </button>
    {open && <dialog ref={dialog} className="update-dialog" aria-labelledby="update-title" onCancel={event => { event.preventDefault(); setOpen(false); }} onKeyDown={keepDialogFocus} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="update-heading"><h2 id="update-title">{t('Update Papilot')}</h2><button className="icon-button" aria-label={t('Close')} onClick={() => setOpen(false)}><Icon name="close" size={16}/></button></div>
      <p className="update-versions"><span>{versionLabel(status.currentVersion)}</span><Icon name="arrowRight" size={14}/><strong>{versionLabel(status.latestVersion || status.currentVersion)}</strong></p>
      <p role="status">{status.phase === 'installing' ? t('Downloading and checking the new version…')
        : status.phase === 'waiting' ? t('The update is ready. Waiting for tasks and PDF builds to finish before restarting.')
        : status.phase === 'restarting' ? t('Restarting Papilot. This page will reconnect automatically; your drafts are kept.')
        : status.phase === 'failed' ? t('The update did not finish. Your current version is still available. You can retry here.')
        : t('Install the new version and restart automatically when tasks are idle. Your papers, tasks and settings stay in place.')}</p>
      {!status.canUpdate && <p className="inline-error">{t('Papilot cannot find npm on this computer. Updates are unavailable until npm is installed.')}</p>}
      {(error || status.error) && <p className="inline-error" role="alert">{updateError(error || status.error!)}</p>}
      <div className="update-actions"><button className="button ghost" onClick={() => setOpen(false)}>{busy ? t('Close') : t('Later')}</button>
        {!busy && <button className="button primary" disabled={sending || !status.canUpdate || !available} onClick={() => void install()}>{sending ? t('Updating…') : status.phase === 'failed' ? t('Retry update') : t('Update to {version}', { version: versionLabel(status.latestVersion || '') })}</button>}
      </div>
    </dialog>}
  </>;
}

export function UpdateSettings({ api }: { api: UpdateApi }) {
  const { status, setStatus } = useUpdates(api);
  const [sending, setSending] = useState(false), [error, setError] = useState('');
  async function send(route: string, body: unknown = {}) {
    setSending(true); setError('');
    try { setStatus(await api<UpdateStatus>(route, body)); window.dispatchEvent(new Event('papilot:updates')); }
    catch (error) { setError(error instanceof Error ? error.message : t('Could not check for updates. Try again when connected.')); }
    finally { setSending(false); }
  }
  if (!status) return <div role="status"><p>{t('Reading update status…')}</p><button className="button secondary" disabled={sending} onClick={() => void send('/updates/check')}>{t('Check for updates')}</button>{error && <p className="inline-error" role="alert">{error}</p>}</div>;
  const busy = working(status), available = status.latestVersion && status.latestVersion !== status.currentVersion && status.phase !== 'idle' && status.phase !== 'checking';
  return <div className="update-settings">
    <div className="settings-row"><span className="settings-name">{t('Current version')}</span><code title={status.currentVersion}>{versionLabel(status.currentVersion)}</code></div>
    <div className="settings-row"><label className="settings-name" htmlFor="update-channel">{t('Update channel')}</label>
      <select id="update-channel" value={status.channel || 'stable'} disabled={sending || busy} onChange={event => void send('/updates/channel', { channel: event.target.value })}>
        <option value="stable">{t('Stable')}</option><option value="dev">{t('Dev (GitHub main)')}</option>
      </select>
    </div>
    <p className="settings-about-intro">{status.channel === 'dev' ? t('Try the latest changes from GitHub main. Dev versions may be less reliable; you can switch back to Stable here.') : t('Use published releases from npm.')}</p>
    {status.latestVersion && <div className="settings-row"><span className="settings-name">{t('Latest version')}</span><code title={status.latestVersion}>{versionLabel(status.latestVersion)}</code></div>}
    <p role="status">{status.phase === 'installing' ? status.channel === 'dev' ? t('Downloading and building the selected GitHub commit…') : t('Downloading and checking the new version…')
      : status.phase === 'waiting' ? t('The update is ready. Waiting for tasks and PDF builds to finish before restarting.')
      : status.phase === 'restarting' ? t('Restarting Papilot. This page will reconnect automatically; your drafts are kept.')
      : status.phase === 'checking' ? t('Checking for updates…')
      : status.phase === 'failed' ? t('The update did not finish. Your current version is still available. You can retry here.')
      : available ? t('Install the new version and restart automatically when tasks are idle. Your papers, tasks and settings stay in place.')
      : status.latestVersion ? t('You are using the latest version on this channel.') : t('Check for updates to see the latest version.')}</p>
    {!status.canUpdate && <p className="inline-error">{t('Papilot cannot find npm on this computer. Updates are unavailable until npm is installed.')}</p>}
    {(error || status.error) && <p className="inline-error" role="alert">{updateError(error || status.error!)}</p>}
    <div className="update-actions">
      <button className="button secondary" disabled={sending || busy || status.phase === 'checking'} onClick={() => void send('/updates/check')}>{t('Check for updates')}</button>
      {available && !busy && <button className="button primary" disabled={sending || !status.canUpdate} onClick={() => void send('/updates/install', { version: status.latestVersion })}>{status.phase === 'failed' ? t('Retry update') : t('Update to {version}', { version: versionLabel(status.latestVersion!) })}</button>}
    </div>
  </div>;
}
