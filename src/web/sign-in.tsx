import { useEffect, useState } from 'react';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { t } from './i18n.ts';
import { Icon } from './icons.tsx';
import logo from './logo.svg';

type Api = <T = any>(route: string, body?: unknown) => Promise<T>;
// The browser's own passkey prompt was dismissed or timed out.
const cancelled = (error: unknown) => error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

// Shown at the public URL to anyone not signed in: one button, the passkey.
export function SignIn({ api, onSignedIn }: { api: Api; onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function signIn() {
    setBusy(true); setError('');
    try {
      const optionsJSON = await api('/auth/options', {});
      const response = await startAuthentication({ optionsJSON });
      await api('/auth/verify', { response });
      onSignedIn();
    } catch (e) { setError(cancelled(e) ? t('Signing in was cancelled. Try again when you are ready.') : message(e)); }
    finally { setBusy(false); }
  }
  return <div className="home sign-in"><div className="home-inner">
    <img className="home-logo" src={logo} alt=""/>
    <h1>{t('Sign in to Papilot')}</h1>
    {browserSupportsWebAuthn() ? <>
      <p className="home-copy">{t('Use the passkey you created from your invite link.')}</p>
      <button className="button primary" disabled={busy} aria-busy={busy} onClick={() => void signIn()}><Icon name="key" size={16}/>{busy ? t('Waiting for your passkey…') : t('Sign in with a passkey')}</button>
    </> : <p className="home-copy">{t('This browser cannot use passkeys. Open this page in a current version of Safari, Chrome, Edge or Firefox.')}</p>}
    {error && <p className="inline-error home-error" role="alert">{error}</p>}
    <p className="home-copy muted sign-in-help">{t('No passkey on this device? Ask the person who invited you for a new invite link.')}</p>
  </div></div>;
}

interface InviteInfo { name: string; owner: boolean; inviter: string; papers: string[]; adding: boolean }
// An invite link opens here. Its token lives in the address's fragment, which
// browsers never send to a server; it is cleared from the address at once.
export function Invite({ api, onDone }: { api: Api; onDone: () => void }) {
  const [token] = useState(() => location.hash.slice(1));
  const [info, setInfo] = useState<InviteInfo | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    history.replaceState(null, '', '/invite');
    if (!token) { setError(t('This invite link is incomplete. Copy the whole link and open it again.')); return; }
    api<InviteInfo>('/auth/invite', { token }).then(setInfo, e => setError(message(e)));
  }, []);
  async function join() {
    setBusy(true); setError('');
    try {
      const optionsJSON = await api('/auth/invite/options', { token });
      const response = await startRegistration({ optionsJSON });
      await api('/auth/invite/verify', { token, response });
      history.replaceState(null, '', '/');
      onDone();
    } catch (e) { setError(cancelled(e) ? t('Creating the passkey was cancelled. The link still works; try again when you are ready.') : message(e)); }
    finally { setBusy(false); }
  }
  const papers = info?.papers.join(t(', ')) || '';
  return <div className="home sign-in"><div className="home-inner">
    <img className="home-logo" src={logo} alt=""/>
    <h1>{info?.adding ? t('Add a passkey') : t('Join Papilot')}</h1>
    {info && <p className="home-copy">{info.owner ? t('Create a passkey to sign in to your Papilot from anywhere.')
      : info.adding ? t('Create a passkey on this device to sign in as {name}.', { name: info.name })
      : papers ? t('{inviter} invited you to work on {papers}. You will appear as {name}.', { inviter: info.inviter, papers, name: info.name })
      : t('{inviter} invited you to Papilot. You will appear as {name}.', { inviter: info.inviter, name: info.name })}</p>}
    {info && (browserSupportsWebAuthn()
      ? <button className="button primary" disabled={busy} aria-busy={busy} onClick={() => void join()}><Icon name="key" size={16}/>{busy ? t('Waiting for your passkey…') : t('Create a passkey')}</button>
      : <p className="home-copy">{t('This browser cannot use passkeys. Open this page in a current version of Safari, Chrome, Edge or Firefox.')}</p>)}
    {!info && !error && <p className="home-copy" role="status"><span className="spinner"/></p>}
    {error && <p className="inline-error home-error" role="alert">{error}</p>}
    {info && <p className="home-copy muted sign-in-help">{t('A passkey signs you in with Face ID, Touch ID, Windows Hello or your phone. Papilot never sees a password.')}</p>}
  </div></div>;
}
