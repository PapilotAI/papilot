import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.tsx';
import { ChipSelect } from './chip-select.tsx';
import { keepDialogFocus } from './focus.ts';
import { LANGUAGES, browserLanguage, setLanguage, t, useLanguage, type LanguageChoice } from './i18n.ts';
import { setNotifications, testNotification, useNotifications } from './notifications.ts';
import type { Theme } from './theme.tsx';

// Preferences for this browser: appearance, interface language and
// notifications. Each takes effect at once; there is nothing to save.
export function SettingsDialog({ theme, onTheme, onClose }: { theme: Theme; onTheme: (theme: Theme) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { choice } = useLanguage();
  const notifications = useNotifications();
  const [asking, setAsking] = useState(false), [test, setTest] = useState<'' | 'sent' | 'failed'>('');
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal(); element.querySelector<HTMLInputElement>('input:checked')?.focus();
    return () => { element.close(); if (opener?.isConnected && opener.getClientRects().length) opener.focus(); };
  }, []);
  const granted = notifications.permission === 'granted', on = notifications.on && granted;
  const blocked = notifications.permission === 'unsupported' ? t('This browser cannot show notifications.')
    : notifications.permission === 'insecure' ? t('Browsers show notifications only on HTTPS or localhost. Open Papilot at a secure address to use them.')
    : notifications.permission === 'denied' ? t('Notifications are blocked for this site. Allow them in the browser’s site settings, then turn them on here.') : '';
  async function toggle(value: boolean) {
    setAsking(true); setTest('');
    try { await setNotifications(value); } finally { setAsking(false); }
  }
  const browserName = LANGUAGES.find(item => item.id === browserLanguage())!.name;
  return <dialog ref={dialog} className="modal-backdrop" aria-labelledby="settings-title" onKeyDown={keepDialogFocus} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal settings-dialog">
      <button className="modal-close icon-button" aria-label={t('Close')} onClick={onClose}><Icon name="close"/></button>
      <h2 id="settings-title">{t('Settings')}</h2>
      <p className="modal-description">{t('These preferences apply to this browser.')}</p>
      <div className="settings-row">
        <span className="settings-name" id="settings-appearance">{t('Appearance')}</span>
        <div className="segmented" role="radiogroup" aria-labelledby="settings-appearance">
          {(['light', 'dark', 'system'] as const).map(value => <label key={value} className={theme === value ? 'checked' : undefined}>
            <input type="radio" name="theme" value={value} checked={theme === value} onChange={() => onTheme(value)}/>
            <Icon name={value === 'light' ? 'sun' : value === 'dark' ? 'moon' : 'monitor'} size={15}/>{value === 'light' ? t('Light') : value === 'dark' ? t('Dark') : t('System')}
          </label>)}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-name">{t('Language')}</span>
        <ChipSelect label={t('Language')} value={choice} onChange={value => setLanguage(value as LanguageChoice)}
          options={[{ value: 'system', label: t('Browser default ({language})', { language: browserName }) }, ...LANGUAGES.map(item => ({ value: item.id, label: item.name }))]}/>
      </div>
      <div className="settings-row settings-notifications">
        <div className="settings-text">
          <label className="settings-name" htmlFor="settings-notify">{t('Notifications')}</label>
          <p id="settings-notify-detail">{blocked || t('Notify me when a task needs my reply, its review is ready, or it stops with an error, while Papilot is in the background.')}</p>
        </div>
        <input id="settings-notify" type="checkbox" role="switch" className="switch" aria-describedby="settings-notify-detail" checked={on} disabled={asking || (Boolean(blocked) && !on)} onChange={event => void toggle(event.target.checked)}/>
      </div>
      {on && <div className="settings-test">
        <button type="button" className="button secondary compact" onClick={() => setTest(testNotification() ? 'sent' : 'failed')}><Icon name="bell" size={14}/>{t('Send a test notification')}</button>
        {test && <span role="status">{test === 'sent' ? t('Sent. If nothing appeared, allow notifications for this browser in your system settings.') : t('This browser could not show the notification.')}</span>}
      </div>}
    </section>
  </dialog>;
}
