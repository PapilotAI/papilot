import { useEffect, useRef, useState } from 'react';
import type { WriterAuth, WriterProvider } from '../shared.ts';
import { BrandIcon, type Brand } from './brand-icon.tsx';
import { Icon } from './icons.tsx';
import { errorText, t } from './i18n.ts';
import './writer-setup.css';

function ProviderMark({ id }: { id: string }) {
  const brands: Record<string, Brand> = { 'openai-codex': 'openai', 'github-copilot': 'copilot', anthropic: 'claude', openai: 'openai', google: 'gemini', openrouter: 'openrouter', mistral: 'mistral', deepseek: 'deepseek', xai: 'grok', moonshotai: 'kimi', zai: 'glm' };
  return <span className="writer-provider-mark" aria-hidden="true">{brands[id] ? <BrandIcon name={brands[id]} size={23}/> : <Icon name="globe" size={23}/>}</span>;
}

// Provider credentials remain local to Papilot. Only the selected key editor is
// mounted; subscription sign-ins keep their existing polling and redirect flow.
export function WriterSetup({ writer, online }: { writer: (route: string, body?: unknown) => Promise<WriterAuth>; online: boolean }) {
  const [auth, setAuth] = useState<WriterAuth | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({}), [code, setCode] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const editor = useRef<HTMLDivElement>(null), providerButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const returnFocus = useRef<string | null>(null);
  const selectedProvider = auth?.providers.find(provider => provider.id === selected);
  const waiting = auth?.logins.some(login => login.status === 'waiting');
  useEffect(() => {
    let stopped = false;
    const load = () => writer('/auth').then(value => { if (!stopped) { setAuth(value); setError(null); } }, e => { if (!stopped) setError(e instanceof Error ? e.message : String(e)); });
    void load();
    const timer = waiting ? setInterval(load, 1500) : undefined;
    return () => { stopped = true; if (timer) clearInterval(timer); };
  }, [writer, waiting]);
  useEffect(() => {
    if (!selected) return;
    const target = editor.current?.querySelector<HTMLElement>('input') || editor.current?.querySelector<HTMLElement>('h6');
    target?.focus({ preventScroll: true });
    editor.current?.scrollIntoView({ block: 'nearest' });
  }, [selected, selectedProvider?.configured]);
  useEffect(() => {
    if (selected === null && !busy && returnFocus.current) {
      providerButtons.current[returnFocus.current]?.focus();
      returnFocus.current = null;
    }
  }, [selected, busy]);
  async function act(key: string, route: string, body: unknown = {}) {
    setBusy(key); setError(null);
    try { setAuth(await writer(route, body)); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(null); }
  }
  function closeEditor() {
    if (selected) {
      returnFocus.current = selected;
      setKeys(current => ({ ...current, [selected]: '' }));
    }
    setSelected(null);
  }
  if (!auth) return error ? <p className="runtime-agent-error" role="alert">{errorText(error)}</p> : <p className="runtime-agent-note" role="status">{t('Checking…')}</p>;
  const connected = auth.providers.filter(provider => provider.configured).length;
  const unavailable = !online || Boolean(busy);
  const status = (provider: WriterProvider) => provider.configured ? provider.kind === 'login' ? t('Signed in') : provider.source === 'environment' ? t('Environment variable') : t('Saved') : t('API key');
  return <section className="writer-setup" aria-label={t('Model providers')}>
    <header className="writer-intro">
      <span className="writer-intro-mark" aria-hidden="true"><BrandIcon name="papilot" size={32}/><span><Icon name="spark" size={13}/></span></span>
      <div><h5>{t('Model providers')}</h5><p>{t('Sign in with a subscription or add an API key.')}</p></div>
      {connected > 0 && <span className="writer-connected"><span/>{connected} {t('Connected')}</span>}
    </header>
    <section aria-labelledby="writer-subscriptions-title">
      <div className="writer-section-heading"><h5 id="writer-subscriptions-title">{t('Subscriptions')}</h5><Icon name="key" size={14}/></div>
      <ul className="writer-subscriptions">
        {auth.providers.filter(provider => provider.kind === 'login').map(provider => {
          const login = auth.logins.filter(item => item.provider === provider.id).at(-1);
          const live = login?.status === 'waiting';
          return <li key={provider.id} className="writer-subscription" data-configured={provider.configured} data-waiting={live || undefined}>
            <div className="writer-subscription-heading"><ProviderMark id={provider.id}/><strong>{provider.name}</strong></div>
            <div className="writer-subscription-footer">
              <span className={'writer-provider-status' + (provider.configured ? ' connected' : '')}>{provider.configured ? <><Icon name="check" size={13}/>{t('Signed in')}</> : live ? <><span className="spinner"/>{t('Connecting…')}</> : t('Subscriptions')}</span>
              {!live && <button type="button" className={'button compact ' + (provider.configured ? 'secondary' : 'primary')} disabled={unavailable} onClick={() => void act(provider.id, provider.configured ? `/providers/${provider.id}/remove` : '/logins', provider.configured ? {} : { provider: provider.id })}>{busy === provider.id ? <span className="spinner"/> : null}{provider.configured ? t('Sign out') : t('Sign in')}{!provider.configured && <Icon name="arrowRight" size={14}/>}</button>}
            </div>
            {live && <div className="writer-login" role="status">
              {login.instructions && <p className="writer-login-instructions">{login.instructions}</p>}
              <div className="runtime-setup-actions">
                {login.url && <a className="button compact" href={login.url} target="_blank" rel="noopener noreferrer">{t('Open sign-in page')}<Icon name="external" size={12}/></a>}
                {login.url && <CopyLink url={login.url}/>}
                <button type="button" className="button secondary compact" disabled={unavailable} onClick={() => void act(login.id, `/logins/${login.id}/cancel`)}>{t('Cancel')}</button>
              </div>
              {provider.id === 'openai-codex' && <details className="writer-redirect"><summary>{t('Paste the redirect URL if the sign-in page cannot finish')}</summary><form className="writer-key" onSubmit={event => { event.preventDefault(); void act(login.id, `/logins/${login.id}/code`, { code }).then(ok => { if (ok) setCode(''); }); }}>
                <input type="text" autoComplete="off" spellCheck={false} aria-label={t('Paste the redirect URL if the sign-in page cannot finish')} value={code} onChange={event => setCode(event.target.value)}/>
                <button type="submit" className="button secondary compact" disabled={unavailable || !code.trim()}>{t('Save')}</button>
              </form></details>}
            </div>}
            {login?.status === 'failed' && <p className="runtime-agent-error" role="alert">{errorText(login.error || '')}</p>}
          </li>;
        })}
      </ul>
    </section>
    <section aria-labelledby="writer-keys-title">
      <div className="writer-section-heading"><h5 id="writer-keys-title">{t('API keys')}</h5><Icon name="key" size={14}/></div>
      <ul className="writer-providers">
        {auth.providers.filter(provider => provider.kind === 'key').map(provider => <li key={provider.id}>
          <button type="button" className="writer-provider" disabled={Boolean(busy)} ref={element => { providerButtons.current[provider.id] = element; }} data-configured={provider.configured} aria-expanded={selected === provider.id} aria-controls={selected === provider.id ? 'writer-key-editor' : undefined} onClick={() => selected === provider.id ? closeEditor() : setSelected(provider.id)}>
            <ProviderMark id={provider.id}/>
            <span className="writer-provider-copy"><strong>{provider.name}</strong><small className={'writer-provider-status' + (provider.configured ? ' connected' : '')}>{provider.configured && <Icon name="check" size={11}/>}<span>{status(provider)}</span></small></span>
            <Icon name={selected === provider.id ? 'chevronUp' : 'chevronRight'} size={13}/>
          </button>
        </li>)}
      </ul>
      {selectedProvider && <div className="writer-key-editor" id="writer-key-editor" ref={editor} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeEditor(); } }}>
        <header><div><ProviderMark id={selectedProvider.id}/><h6 tabIndex={-1}>{selectedProvider.name}</h6></div><button type="button" className="icon-button" aria-label={t('Close')} onClick={closeEditor}><Icon name="close" size={15}/></button></header>
        {selectedProvider.configured ? <div className="writer-key-connected">
          <p><Icon name="check" size={15}/>{selectedProvider.source === 'environment' ? t('From {variable}', { variable: selectedProvider.env || '' }) : t('Saved')}</p>
          {selectedProvider.source === 'stored' && <button type="button" className="button secondary compact" disabled={unavailable} onClick={() => void act(selectedProvider.id, `/providers/${selectedProvider.id}/remove`)}>{t('Remove')}</button>}
        </div> : <form onSubmit={event => { event.preventDefault(); void act(selectedProvider.id, '/keys', { provider: selectedProvider.id, key: keys[selectedProvider.id] || '' }).then(ok => { if (ok) closeEditor(); }); }}>
          <label htmlFor="writer-api-key">{t('API key for {provider}', { provider: selectedProvider.name })}</label>
          <div className="writer-key"><input id="writer-api-key" type="password" autoComplete="off" spellCheck={false} placeholder={selectedProvider.env} value={keys[selectedProvider.id] || ''} onChange={event => setKeys(current => ({ ...current, [selectedProvider.id]: event.target.value }))}/><button type="submit" className="button primary compact" disabled={unavailable || !keys[selectedProvider.id]?.trim()}>{busy === selectedProvider.id && <span className="spinner"/>}{t('Save')}</button></div>
        </form>}
      </div>}
    </section>
    {error && <p className="runtime-agent-error writer-error" role="alert">{errorText(error)}</p>}
    <details className="writer-storage-note"><summary><Icon name="info" size={13}/>{t('Installation & setup')}<Icon name="chevronDown" size={13}/></summary><p>{t('Claude works with an Anthropic API key only. Papilot keeps these credentials in its own data folder, separate from any Pi installation.')}</p></details>
  </section>;
}

// For signing in from another browser or device, where opening the page here does not help.
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; }
    catch {
      const area = document.createElement('textarea');
      area.value = url; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.append(area); area.select();
      try { ok = document.execCommand('copy'); } finally { area.remove(); }
    }
    setCopied(ok);
  }
  return <button type="button" className="button secondary compact" onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} size={12}/>{copied ? t('Copied') : t('Copy link')}</button>;
}
