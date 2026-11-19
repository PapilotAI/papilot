import { useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { TypelessStatus } from '../../desktop/typeless-control.ts';
import { browserStorage } from './storage.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

export const typelessAvailable = Boolean(window.papilotDesktop?.platform === 'darwin' && window.papilotDesktop.typelessShortcut);
const KEY = 'papilot:typeless';
const listeners = new Set<() => void>();
const read = () => typelessAvailable && browserStorage.getItem(KEY) === 'on';
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
window.addEventListener('storage', event => { if (event.key === KEY || event.key === null) listeners.forEach(listener => listener()); });
function useEnabled() { return useSyncExternalStore(subscribe, read); }

function description(info: TypelessStatus): string {
  switch (info.status) {
    case 'ready': return t('Shortcut: {shortcut}', { shortcut: info.shortcut! });
    case 'sent': return t('{shortcut} sent', { shortcut: info.shortcut! });
    case 'not-detected': return t('Install Typeless first.');
    case 'shortcut-unavailable': return t('Check your Typeless shortcut.');
    case 'permission': return t('Allow Papilot in macOS Accessibility settings.');
    case 'not-running': return t('Open Typeless first.');
    case 'keys-held': return t('Release modifier keys and retry.');
    default: return t('Shortcut failed. Try again.');
  }
}

export function TypelessExperiment() {
  const id = useId(), enabled = useEnabled();
  const [info, setInfo] = useState<TypelessStatus | null>(null), [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true);
    try { setInfo(await window.papilotDesktop!.typelessStatus!()); }
    catch { setInfo({ status: 'unavailable' }); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (typelessAvailable) void refresh(); }, []);
  if (!typelessAvailable) return null;
  return <div className="settings-card typeless-experiment">
    <div className="settings-row settings-toggle">
      <div className="settings-text">
        <label className="settings-name" htmlFor={id}>{t('Typeless voice notes')}</label>
        <p id={id + '-detail'}>{t('Dictate PDF notes with Typeless.')}</p>
        <p role="status">{info ? description(info) : t('Loading…')}</p>
        <button type="button" className="button secondary compact" onClick={() => void refresh()} disabled={loading}>{t('Refresh')}</button>
      </div>
      <input id={id} type="checkbox" role="switch" className="switch" checked={enabled} aria-describedby={id + '-detail'} disabled={!enabled && (loading || info?.status !== 'ready')} onChange={event => {
        browserStorage.setItem(KEY, event.target.checked ? 'on' : 'off');
        listeners.forEach(listener => listener());
      }}/>
    </div>
  </div>;
}

export function useTypelessNote(input: RefObject<HTMLTextAreaElement | null>, eligible: boolean) {
  const inputId = useId(), enabled = useEnabled(), attempted = useRef(false), pending = useRef(false);
  const [sending, setSending] = useState(false), [info, setInfo] = useState<TypelessStatus | null>(null);
  const available = enabled && eligible;
  useEffect(() => {
    if (info?.status !== 'sent') return;
    const timer = setTimeout(() => setInfo(null), 1600);
    return () => clearTimeout(timer);
  }, [info]);
  useEffect(() => {
    // Keep the target stable for the short native delivery handshake. This
    // also stops an unconsumed shortcut reaching the note's Enter/Escape paths.
    const hold = (event: Event) => { if (pending.current) { event.preventDefault(); event.stopImmediatePropagation(); } };
    window.addEventListener('pointerdown', hold, true);
    window.addEventListener('click', hold, true);
    window.addEventListener('keydown', hold, true);
    return () => { window.removeEventListener('pointerdown', hold, true); window.removeEventListener('click', hold, true); window.removeEventListener('keydown', hold, true); };
  }, []);
  async function send() {
    const element = input.current;
    if (!available || pending.current || !element?.isConnected) return;
    element.focus({ preventScroll: true });
    pending.current = true; setSending(true); setInfo(null);
    try { setInfo(await window.papilotDesktop!.typelessShortcut!(inputId)); }
    catch { setInfo({ status: 'unavailable' }); }
    finally { pending.current = false; setSending(false); }
  }
  useEffect(() => {
    if (attempted.current || !eligible) return;
    const frame = requestAnimationFrame(() => {
      attempted.current = true;
      if (available && input.current === document.activeElement) void send();
    });
    return () => cancelAnimationFrame(frame);
  }, [available, eligible]);
  // No recording state is inferred from key delivery. In particular, closing
  // the card must never send a speculative toggle that could start recording.
  const label = t('Toggle dictation');
  const sent = info?.status === 'sent';
  return {
    inputId,
    pending,
    button: available && <button type="button" className="icon-button typeless-note-button" data-state={sending ? 'sending' : sent ? 'sent' : 'idle'} aria-label={label} aria-busy={sending} aria-describedby={info ? inputId + '-status' : undefined} title={label} disabled={sending} onPointerDown={event => event.preventDefault()} onClick={event => { if (event.detail < 2) void send(); }}>{sending ? <span className="spinner" aria-hidden="true"/> : <Icon name={sent ? 'check' : 'microphone'} size={16}/>}</button>,
    hint: available && <p id={inputId + '-status'} className={'typeless-note-status' + (!info || sent ? ' sr-only' : '')} role="status">{info ? description(info) : ''}</p>,
  };
}
