import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.tsx';
import { keepDialogFocus } from './focus.ts';
import { t } from './i18n.ts';
import type { UpdateStatus } from '../shared.ts';
import './update-notice.css';

type Api = <T = any>(route: string, body?: unknown) => Promise<T>;
const working = (status: UpdateStatus) => ['installing', 'waiting', 'restarting'].includes(status.phase);
export function UpdateNotice({ api, version }: { api: Api; version: string }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null), [open, setOpen] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState('');
  const initialVersion = useRef(version), reloading = useRef(false), dialog = useRef<HTMLDialogElement>(null);
  const current = useRef(status); current.current = status;
  useEffect(() => {
    let stopped = false, reading = false, timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await api<UpdateStatus>('/updates');
        if (stopped || !next?.currentVersion) return;
        setStatus(next);
        if (next.phase === 'updated' && next.currentVersion !== initialVersion.current && !reloading.current) {
          reloading.current = true; location.reload();
        }
      } catch { /* The old page stays usable while the server restarts. */ }
      finally { reading = false; if (!stopped) timer = setTimeout(read, current.current && working(current.current) ? 2000 : 30000); }
    };
    void read();
    const focus = () => { clearTimeout(timer); void read(); };
    window.addEventListener('online', focus); window.addEventListener('focus', focus);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener('online', focus); window.removeEventListener('focus', focus); };
  }, [api, status?.phase]);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null, element = dialog.current!;
    element.showModal();
    return () => { element.close(); if (opener?.isConnected) opener.focus(); };
  }, [open]);
  if (!status) return null;
  const busy = working(status), available = status.latestVersion && status.latestVersion !== status.currentVersion;
  if (!open && !busy && status.phase !== 'failed' && (!available || status.phase === 'idle')) return null;
  const label = status.phase === 'installing' ? t('Updating…') : status.phase === 'waiting' ? t('Update ready') : status.phase === 'restarting' ? t('Restarting…') : status.phase === 'failed' ? t('Update failed') : t('New version');
  async function install() {
    if (!status || sending) return;
    setSending(true); setError('');
    try { setStatus(await api<UpdateStatus>('/updates/install', { version: status.latestVersion })); }
    catch (error) { setError(error instanceof Error ? error.message : t('Could not start the update. Please retry.')); }
    finally { setSending(false); }
  }
  return <>
    <button type="button" className={'update-badge' + (status.phase === 'failed' ? ' failed' : '')} aria-haspopup="dialog" title={t('Papilot {version}', { version: status.latestVersion || status.currentVersion })} onClick={() => setOpen(true)}>
      {busy ? <span className="spinner"/> : <Icon name={status.phase === 'failed' ? 'alert' : 'arrowUp'} size={13}/>}<span>{label}</span>
    </button>
    {open && <dialog ref={dialog} className="update-dialog" aria-labelledby="update-title" onCancel={event => { event.preventDefault(); setOpen(false); }} onKeyDown={keepDialogFocus} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="update-heading"><h2 id="update-title">{t('Update Papilot')}</h2><button className="icon-button" aria-label={t('Close')} onClick={() => setOpen(false)}><Icon name="close" size={16}/></button></div>
      <p className="update-versions"><span>{status.currentVersion}</span><Icon name="arrowRight" size={14}/><strong>{status.latestVersion || status.currentVersion}</strong></p>
      <p role="status">{status.phase === 'installing' ? t('Downloading and checking the new version…')
        : status.phase === 'waiting' ? t('The update is ready. Waiting for tasks and PDF builds to finish before restarting.')
        : status.phase === 'restarting' ? t('Restarting Papilot. This page will reconnect automatically; your drafts are kept.')
        : status.phase === 'failed' ? t('The update did not finish. Your current version is still available. You can retry here.')
        : t('Install the new version and restart automatically when tasks are idle. Your papers, tasks and settings stay in place.')}</p>
      {!status.canUpdate && <p className="inline-error">{t('Papilot cannot find npm on this computer. Updates are unavailable until npm is installed.')}</p>}
      {(error || status.error) && <p className="inline-error" role="alert">{error || status.error}</p>}
      <div className="update-actions"><button className="button ghost" onClick={() => setOpen(false)}>{busy ? t('Close') : t('Later')}</button>
        {!busy && <button className="button primary" disabled={sending || !status.canUpdate || !available} onClick={() => void install()}>{sending ? t('Updating…') : status.phase === 'failed' ? t('Retry update') : t('Update to {version}', { version: status.latestVersion || '' })}</button>}
      </div>
    </dialog>}
  </>;
}
