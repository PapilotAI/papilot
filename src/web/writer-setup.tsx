import { useEffect, useId, useRef, useState } from 'react';
import type { RuntimeStatus, WriterAuth, WriterCustomApi, WriterProvider } from '../shared.ts';
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
export function WriterSetup({ writer, online, runtime }: {
  writer: (route: string, body?: unknown) => Promise<WriterAuth>;
  online: boolean;
  runtime?: RuntimeStatus;
}) {
  const [auth, setAuth] = useState<WriterAuth | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({}), [code, setCode] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const editorId = useId();
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
    setError(null);
  }
  if (!auth) return error ? <p className="runtime-agent-error" role="alert">{errorText(error)}</p> : <p className="runtime-agent-note" role="status">{t('Checking…')}</p>;
  const gatewayFailed = Boolean(auth.gatewayOnly && runtime && (!runtime.authenticated || runtime.error));
  const connected = auth.providers.filter(provider => provider.configured && !(provider.kind === 'gateway' && gatewayFailed)).length;
  const loginProviders = auth.providers.filter(provider => provider.kind === 'login');
  const gatewayProviders = auth.providers.filter(provider => provider.kind === 'gateway');
  const keyProviders = auth.providers.filter(provider => provider.kind !== 'login' && provider.kind !== 'gateway');
  const unavailable = !online || Boolean(busy);
  const status = (provider: WriterProvider) => provider.configured ? provider.kind === 'login' ? t('Signed in') : provider.source === 'environment' ? t('Environment variable') : t('Saved') : t('API key');
  const providerName = (provider: WriterProvider) => provider.kind === 'custom' ? t('Custom API') : provider.name;
  const renderProviderTiles = (list: WriterProvider[]) => <ul className="writer-providers">
    {list.map(provider => {
      const ok = provider.configured && !(provider.kind === 'gateway' && gatewayFailed);
      return <li key={provider.id}>
        <button type="button" className="writer-provider" disabled={Boolean(busy)} ref={element => { providerButtons.current[provider.id] = element; }} data-configured={ok} aria-expanded={selected === provider.id} aria-controls={selected === provider.id ? editorId : undefined} onClick={() => { if (selected === provider.id) closeEditor(); else { setError(null); setSelected(provider.id); } }}>
          <ProviderMark id={provider.id}/>
          <span className="writer-provider-copy"><strong>{providerName(provider)}</strong><small className={'writer-provider-status' + (ok ? ' connected' : '')}>{ok && <Icon name="check" size={11}/>}<span>{status(provider)}</span></small></span>
          <Icon name={selected === provider.id ? 'chevronUp' : 'chevronRight'} size={13}/>
        </button>
      </li>;
    })}
  </ul>;
  const selectedEditor = selectedProvider && <div className="writer-key-editor" id={editorId} ref={editor} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) closeEditor(); } }}>
    <header><div><ProviderMark id={selectedProvider.id}/><h6 id={`${editorId}-title`} tabIndex={-1}>{providerName(selectedProvider)}</h6></div><button type="button" className="icon-button" aria-label={t('Close')} disabled={Boolean(busy)} onClick={closeEditor}><Icon name="close" size={15}/></button></header>
    {selectedProvider.kind === 'custom' ? <CustomApiEditor config={auth.customApi} title={`${editorId}-title`} disabled={unavailable} error={error}
      save={body => void act(selectedProvider.id, '/custom-api', body).then(ok => { if (ok) closeEditor(); })}
      remove={() => void act(selectedProvider.id, `/providers/${selectedProvider.id}/remove`).then(ok => { if (ok) closeEditor(); })}/>
    : selectedProvider.configured ? <div className="writer-key-connected">
      <p><Icon name={selectedProvider.kind === 'gateway' && gatewayFailed ? 'info' : 'check'} size={15}/>{selectedProvider.source === 'environment' ? t('From {variable}', { variable: selectedProvider.env || '' }) : t('Saved')}</p>
      {selectedProvider.source === 'stored' && <button type="button" className="button secondary compact" disabled={unavailable} onClick={() => void act(selectedProvider.id, `/providers/${selectedProvider.id}/remove`)}>{t('Remove')}</button>}
    </div> : <form onSubmit={event => { event.preventDefault(); void act(selectedProvider.id, '/keys', { provider: selectedProvider.id, key: keys[selectedProvider.id] || '' }).then(ok => { if (ok) closeEditor(); }); }}>
      <label htmlFor="writer-api-key">{t('API key for {provider}', { provider: selectedProvider.name })}</label>
      <div className="writer-key"><input id="writer-api-key" type="password" autoComplete="off" spellCheck={false} placeholder={selectedProvider.env} value={keys[selectedProvider.id] || ''} onChange={event => setKeys(current => ({ ...current, [selectedProvider.id]: event.target.value }))}/><button type="submit" className="button primary compact" disabled={unavailable || !keys[selectedProvider.id]?.trim()}>{busy === selectedProvider.id && <span className="spinner"/>}{t('Save')}</button></div>
    </form>}
  </div>;
  return <section className="writer-setup" aria-label={t('Model providers')}>
    <header className="writer-intro">
      <span className="writer-intro-mark" aria-hidden="true"><BrandIcon name="papilot" size={32}/><span><Icon name="spark" size={13}/></span></span>
      <div><h5>{t('Model providers')}</h5>{!auth.gatewayOnly && <p>{t('Sign in with a subscription or add an API key.')}</p>}</div>
      {connected > 0 && <span className="writer-connected"><span/>{connected} {t('Connected')}</span>}
    </header>
    {gatewayProviders.length > 0 && <section aria-labelledby="writer-gateway-title">
      <div className="writer-section-heading"><h5 id="writer-gateway-title">{t('Environment variable')}</h5><Icon name="globe" size={14}/></div>
      {renderProviderTiles(gatewayProviders)}
      {selectedProvider?.kind === 'gateway' && selectedEditor}
    </section>}
    {loginProviders.length > 0 && <section aria-labelledby="writer-subscriptions-title">
      <div className="writer-section-heading"><h5 id="writer-subscriptions-title">{t('Subscriptions')}</h5><Icon name="key" size={14}/></div>
      <ul className="writer-subscriptions">
        {loginProviders.map(provider => {
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
    </section>}
    {keyProviders.length > 0 && <section aria-labelledby="writer-keys-title">
      <div className="writer-section-heading"><h5 id="writer-keys-title">{t('API keys')}</h5><Icon name="key" size={14}/></div>
      {renderProviderTiles(keyProviders)}
      {selectedProvider && selectedProvider.kind !== 'gateway' && selectedEditor}
    </section>}
    {error && selectedProvider?.kind !== 'custom' && <p className="runtime-agent-error writer-error" role="alert">{errorText(error)}</p>}
    {!auth.gatewayOnly && <details className="writer-storage-note"><summary><Icon name="info" size={13}/>{t('Installation & setup')}<Icon name="chevronDown" size={13}/></summary><p>{t('Claude works with an Anthropic API key only. Papilot keeps these credentials in its own data folder, separate from any Pi installation.')}</p></details>}
  </section>;
}

function CustomApiEditor({ config, title, disabled, error, save, remove }: {
  config?: WriterCustomApi; title: string; disabled: boolean; error: string | null;
  save: (body: WriterCustomApi & { key: string }) => void; remove: () => void;
}) {
  const id = useId(), errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const textInput = { autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'none', spellCheck: false } as const;
  return <form className="writer-custom-api" aria-labelledby={title} method="post" onSubmit={event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save({ baseUrl: String(form.get('baseUrl')), model: String(form.get('model')), key: String(form.get('key')) });
  }}>
    <div>
      <label htmlFor={`${id}-url`}>{t('API base URL')}</label>
      <input {...textInput} id={`${id}-url`} name="baseUrl" type="url" required maxLength={2048} defaultValue={config?.baseUrl} placeholder="https://example.com/v1" aria-describedby={`${id}-url-help`}/>
      <p id={`${id}-url-help`}>{t('Use an OpenAI-compatible Chat Completions endpoint.')}</p>
    </div>
    <div>
      <label htmlFor={`${id}-model`}>{t('Model ID')}</label>
      <input {...textInput} id={`${id}-model`} name="model" required maxLength={160} defaultValue={config?.model}/>
    </div>
    <div>
      <label htmlFor={`${id}-key`}>{t('API key')}</label>
      <input id={`${id}-key`} name="key" type="password" autoComplete="new-password" spellCheck={false} required={!config} maxLength={4096} aria-describedby={config ? `${id}-key-help` : undefined}/>
      {config && <p id={`${id}-key-help`}>{t('Leave blank to keep the saved key for this URL.')}</p>}
    </div>
    {error && <p ref={errorRef} className="runtime-agent-error writer-error" role="alert" tabIndex={-1}>{errorText(error)}</p>}
    <div className="writer-custom-actions">
      {config && <button type="button" className="button secondary compact" disabled={disabled} onClick={remove}>{t('Remove')}</button>}
      <button type="submit" className="button primary compact" disabled={disabled}>{t('Save')}</button>
    </div>
  </form>;
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
