import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { DATA } from '../paths.ts';
import type { WriterAuth, WriterCustomApi, WriterLogin, WriterProvider } from '../../shared.ts';

// Papilot Writer's credentials. They live in Papilot's own data folder, never
// in ~/.pi, so a Pi setup on the same host (its logins, extensions, settings)
// cannot change how Papilot works. Keys can also come from the environment.
// Subscriptions sign in with ChatGPT or GitHub Copilot. Claude is offered with
// an API key only: Anthropic does not allow its subscription login through
// other tools, so Claude subscription tokens are refused.

export const WRITER_DIR = path.join(DATA, 'papilot-writer');
export const AUTH_FILE = path.join(WRITER_DIR, 'auth.json');

// Providers offered in settings, in order. Others still work through their
// environment variables.
const KEY_PROVIDERS: { id: string; name: string; env: string }[] = [
  { id: 'anthropic', name: 'Anthropic (Claude)', env: 'ANTHROPIC_API_KEY' },
  { id: 'openai', name: 'OpenAI', env: 'OPENAI_API_KEY' },
  { id: 'google', name: 'Google Gemini', env: 'GEMINI_API_KEY' },
  { id: 'openrouter', name: 'OpenRouter', env: 'OPENROUTER_API_KEY' },
  { id: 'deepseek', name: 'DeepSeek', env: 'DEEPSEEK_API_KEY' },
  { id: 'xai', name: 'xAI (Grok)', env: 'XAI_API_KEY' },
  { id: 'moonshotai', name: 'Moonshot (Kimi)', env: 'MOONSHOT_API_KEY' },
  { id: 'zai', name: 'Z.ai (GLM)', env: 'ZAI_API_KEY' },
  { id: 'mistral', name: 'Mistral', env: 'MISTRAL_API_KEY' },
];
const LOGIN_PROVIDERS: { id: string; name: string }[] = [
  { id: 'openai-codex', name: 'ChatGPT Plus or Pro' },
  { id: 'github-copilot', name: 'GitHub Copilot' },
];
const SUBSCRIPTION_TOKEN = /^sk-ant-oat/;
const CUSTOM_API = 'custom-api';
export const GATEWAY_PROVIDER = 'model-gateway';
export type GatewayApiFormat = 'openai-responses' | 'anthropic-messages' | 'google-generative-ai' | 'openai-completions';
const GATEWAY_APIS = new Set<GatewayApiFormat>(['openai-responses', 'anthropic-messages', 'google-generative-ai', 'openai-completions']);
export interface WriterGatewayConfig {
  baseUrl: string;
  keyEnv: string;
  key: string;
  api: GatewayApiFormat;
  name: string;
  exclusive: boolean;
}
type CustomApi = WriterCustomApi & { key: string };
export const isCustomProvider = (id: string) => id.startsWith(`${CUSTOM_API}-`);
export const isGatewayProvider = (id: string) => id === GATEWAY_PROVIDER;
export const customModelUnavailable = () => new Error('This custom API model is unavailable. Choose an available model to continue.');
// A task's saved model identifies the endpoint as well as the model name.
const customId = (baseUrl: string) => `${CUSTOM_API}-${createHash('sha256').update(baseUrl).digest('hex').slice(0, 24)}`;

export function parseGatewayApi(value: unknown, fallback: GatewayApiFormat = 'openai-responses'): GatewayApiFormat {
  return typeof value === 'string' && GATEWAY_APIS.has(value as GatewayApiFormat) ? value as GatewayApiFormat : fallback;
}

/** Validates an HTTPS (or localhost HTTP) gateway URL without credentials,
 *  query string, or fragment. When `allowedOrigin` is given, rejects any
 *  cross-origin URL so model discovery cannot redirect credentials elsewhere. */
export function validateGatewayBaseUrl(rawUrl: unknown, allowedOrigin?: string): string | null {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmed || trimmed.length > 2048 || /[?#]/.test(trimmed)) return null;
  const parsed = URL.parse(trimmed);
  const loopback = parsed && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (!parsed || (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) || parsed.username || parsed.password) return null;
  if (allowedOrigin && parsed.origin !== allowedOrigin) return null;
  return parsed.href.replace(/\/+$/, '');
}

const isGatewayOnlyEnv = (env: NodeJS.ProcessEnv) => env.PAPILOT_WRITER_GATEWAY_ONLY === '1' || env.PAPILOT_WRITER_GATEWAY_ONLY === 'true';

function readGatewayConfig(env: NodeJS.ProcessEnv): WriterGatewayConfig | undefined {
  const baseUrl = validateGatewayBaseUrl(env.PAPILOT_WRITER_GATEWAY_URL);
  if (!baseUrl) return undefined;
  const parsed = new URL(baseUrl);
  const keyEnv = (typeof env.PAPILOT_WRITER_GATEWAY_KEY_ENV === 'string' && env.PAPILOT_WRITER_GATEWAY_KEY_ENV.trim()) || 'PAPILOT_WRITER_GATEWAY_KEY';
  const key = typeof env[keyEnv] === 'string' ? env[keyEnv]!.trim() : '';
  if (!key || key.length > 4096 || /[^!-~]/.test(key)) return undefined;
  const api = parseGatewayApi(env.PAPILOT_WRITER_GATEWAY_API, 'openai-responses');
  const name = (typeof env.PAPILOT_WRITER_GATEWAY_NAME === 'string' && env.PAPILOT_WRITER_GATEWAY_NAME.trim()) || parsed.host || 'Model Gateway';
  return { baseUrl, keyEnv, key, api, name, exclusive: isGatewayOnlyEnv(env) };
}

function customApi(input: Record<string, unknown>, previous?: CustomApi): CustomApi {
  const base = typeof input.baseUrl === 'string' && input.baseUrl.length <= 2048 ? input.baseUrl.trim() : '';
  const url = URL.parse(base);
  const loopback = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url) url.pathname = url.pathname.replace(/(?:\/+chat\/completions)+\/*$/, '').replace(/\/+$/, '');
  const baseUrl = url?.href.replace(/\/$/, '') ?? '';
  if (!url || baseUrl.length > 2048 || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || /[?#]/.test(base)) {
    throw new Error('Enter an HTTPS API base URL, or an HTTP URL on localhost, without credentials, a query or a fragment.');
  }
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model || model.length > 160 || /\s|[\u0000-\u001f\u007f]/.test(model)) throw new Error('Enter a model ID without spaces and with at most 160 characters.');
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (input.key !== undefined && typeof input.key !== 'string') throw new Error('Paste the API key exactly as the provider shows it.');
  if (key && (/[^!-~]/.test(key) || key.length > 4096 || claudeSubscription(key))) throw new Error('Paste the API key exactly as the provider shows it.');
  const saved = key || (previous?.baseUrl === baseUrl ? previous.key : '');
  if (!saved) throw new Error('Enter an API key for this endpoint.');
  return { baseUrl, model, key: saved };
}

/** Whether a Claude credential is a subscription token rather than an API key. */
export const claudeSubscription = (key: string | undefined) => Boolean(key && SUBSCRIPTION_TOKEN.test(key.trim()));

interface Pending { resolve: (value: string) => void; reject: (error: Error) => void }
interface Login extends WriterLogin { abort: AbortController; prompt?: Pending; code?: Pending }

export class WriterCredentials {
  private logins = new Map<string, Login>();
  private custom?: CustomApi;
  private gatewayConfig?: WriterGatewayConfig;
  private exclusiveGateway: boolean;
  constructor(
    private storage: AuthStorage, private env: NodeJS.ProcessEnv = process.env, private changed: () => void = () => {},
    private customStore?: { file: string; registry: ModelRegistry },
  ) {
    this.exclusiveGateway = isGatewayOnlyEnv(this.env);
    this.gatewayConfig = readGatewayConfig(this.env);
    if (this.gatewayConfig) {
      this.storage.setRuntimeApiKey(GATEWAY_PROVIDER, this.gatewayConfig.key);
      // Enable Authorization: Bearer across every wire format (including Google Gemini).
      customStore?.registry.registerProvider(GATEWAY_PROVIDER, {
        name: this.gatewayConfig.name,
        baseUrl: this.gatewayConfig.baseUrl,
        api: this.gatewayConfig.api,
        apiKey: GATEWAY_PROVIDER,
        authHeader: true,
        models: [],
      });
    }
    if (!customStore || this.exclusiveGateway) return;
    try { this.applyCustom(customApi(JSON.parse(fs.readFileSync(customStore.file, 'utf8')))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Could not read the Papilot Writer custom API configuration.'); }
  }

  gateway(): WriterGatewayConfig | undefined { return this.gatewayConfig; }
  gatewayOnly(): boolean { return this.exclusiveGateway; }
  private rejectIfGatewayOnly() {
    if (this.exclusiveGateway) throw new Error('This host manages Papilot Writer through a configured model gateway.');
  }

  private applyCustom(next?: CustomApi) {
    const registry = this.customStore!.registry;
    const previousId = this.custom && customId(this.custom.baseUrl), nextId = next && customId(next.baseUrl);
    if (previousId && previousId !== nextId) {
      this.storage.removeRuntimeApiKey(previousId);
      registry.unregisterProvider(previousId);
    }
    if (next && nextId) {
      this.storage.setRuntimeApiKey(nextId, next.key);
      registry.registerProvider(nextId, {
        name: new URL(next.baseUrl).host,
        baseUrl: next.baseUrl, api: 'openai-completions',
        // Pi requires a configured key for registration. The literal key
        // above takes precedence over its config-value resolver.
        apiKey: CUSTOM_API,
        models: [{
          id: next.model, name: next.model, reasoning: false, input: ['text'],
          contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: { supportsStore: false, supportsStrictMode: false },
        }],
      });
    }
    this.custom = next;
  }

  setCustomApi(input: Record<string, unknown>) {
    this.rejectIfGatewayOnly();
    if (!this.customStore) throw new Error('Custom API setup is unavailable.');
    const next = customApi(input, this.custom), file = this.customStore.file;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
    this.applyCustom(next);
    this.changed();
  }

  redactCustomErrors(provider: string) {
    const key = provider === GATEWAY_PROVIDER
      ? (this.gatewayConfig?.key || '')
      : (this.custom && customId(this.custom.baseUrl) === provider ? this.custom.key : '');
    return (message: string) => key ? message.replaceAll(key, '[redacted]') : message;
  }

  /** Whether a provider's credential may be used. */
  usable(provider: string) {
    if (provider === GATEWAY_PROVIDER) return Boolean(this.gatewayConfig);
    if (this.exclusiveGateway) return false;
    if (provider === CUSTOM_API) return Boolean(this.custom);
    if (provider !== 'anthropic') return this.storage.hasAuth(provider);
    const stored = this.storage.get('anthropic');
    if (stored) return stored.type === 'api_key' && !claudeSubscription(stored.key);
    return Boolean(this.env.ANTHROPIC_API_KEY) && !claudeSubscription(this.env.ANTHROPIC_API_KEY);
  }

  status(): WriterAuth {
    const gw = this.gatewayConfig;
    const gatewayProvider: WriterProvider[] = gw
      ? [{ id: GATEWAY_PROVIDER, name: gw.name, kind: 'gateway', env: gw.keyEnv, configured: true, source: 'environment' }]
      : [];
    if (this.exclusiveGateway) {
      return { providers: gatewayProvider, logins: [], gatewayOnly: true };
    }
    const providers: WriterProvider[] = [
      ...gatewayProvider,
      ...LOGIN_PROVIDERS.map(({ id, name }) => ({ id, name, kind: 'login' as const, configured: this.storage.get(id)?.type === 'oauth', source: this.storage.get(id)?.type === 'oauth' ? 'stored' as const : null })),
      ...KEY_PROVIDERS.map(({ id, name, env }) => {
        const stored = this.storage.get(id)?.type === 'api_key', fromEnv = Boolean(this.env[env]) && !(id === 'anthropic' && claudeSubscription(this.env[env]));
        return { id, name, kind: 'key' as const, env, configured: stored || fromEnv, source: stored ? 'stored' as const : fromEnv ? 'environment' as const : null };
      }),
    ];
    if (this.customStore) providers.push({
      id: CUSTOM_API, name: 'Custom API', kind: 'custom', configured: Boolean(this.custom), source: this.custom ? 'stored' : null,
    });
    const custom = this.custom;
    return {
      providers, logins: [...this.logins.values()].map(({ abort: _a, prompt: _p, code: _c, ...login }) => login),
      ...(custom && { customApi: { baseUrl: custom.baseUrl, model: custom.model } }),
    };
  }

  setKey(provider: string, key: string) {
    this.rejectIfGatewayOnly();
    if (!KEY_PROVIDERS.some(item => item.id === provider)) throw new Error('This provider does not take an API key here.');
    key = key.trim();
    if (!key || key.length > 4096 || /\s/.test(key)) throw new Error('Paste the API key exactly as the provider shows it.');
    if (provider === 'anthropic' && claudeSubscription(key)) throw new Error('This is a Claude subscription token. Papilot Writer can use Claude only with an Anthropic API key.');
    this.storage.set(provider, { type: 'api_key', key });
    this.changed();
  }
  remove(provider: string) {
    this.rejectIfGatewayOnly();
    if (provider === CUSTOM_API && this.customStore) {
      fs.rmSync(this.customStore.file, { force: true });
      this.applyCustom();
      this.changed();
      return;
    }
    if (![...KEY_PROVIDERS, ...LOGIN_PROVIDERS].some(item => item.id === provider)) throw new Error('Unknown provider.');
    this.storage.remove(provider);
    this.changed();
  }

  /** Starts a subscription sign-in. Its progress is read through status(). */
  login(provider: string, enterprise = '') {
    this.rejectIfGatewayOnly();
    const known = LOGIN_PROVIDERS.find(item => item.id === provider);
    if (!known) throw new Error('This provider has no sign-in here.');
    for (const other of this.logins.values()) if (other.provider === provider && other.status === 'waiting') this.cancel(other.id);
    const login: Login = { id: randomUUID(), provider, name: known.name, status: 'waiting', url: null, instructions: null, error: null, startedAt: Date.now(), abort: new AbortController() };
    this.logins.set(login.id, login);
    const ask = (field: 'prompt' | 'code') => new Promise<string>((resolve, reject) => { login[field] = { resolve, reject }; });
    void this.storage.login(provider, {
      signal: login.abort.signal,
      onAuth: ({ url, instructions }) => { login.url = url; login.instructions = instructions || null; this.changed(); },
      onProgress: message => { login.instructions = message; this.changed(); },
      // Copilot first asks for a GitHub Enterprise domain: github.com unless one was given.
      onPrompt: async ({ message }) => /enterprise/i.test(message) ? enterprise : ask('prompt'),
      onManualCodeInput: () => ask('code'),
    }).then(() => { login.status = 'done'; login.instructions = null; }, error => {
      if (login.status === 'cancelled') return;
      login.status = 'failed'; login.error = error instanceof Error ? error.message : String(error);
    }).finally(() => {
      this.changed();
      // Finished sign-ins disappear after a while.
      setTimeout(() => { if (login.status !== 'waiting') this.logins.delete(login.id); }, 10 * 60000).unref();
    });
    this.changed();
    return login.id;
  }
  /** The code or redirect URL the author pasted, for a sign-in whose browser callback cannot reach this host. */
  input(id: string, value: string) {
    const login = this.logins.get(id);
    if (!login || login.status !== 'waiting') throw new Error('This sign-in has ended. Start it again.');
    const waiting = login.code || login.prompt;
    if (!waiting) throw new Error('This sign-in is not waiting for a code.');
    login.code = login.prompt = undefined;
    waiting.resolve(value.trim());
  }
  cancel(id: string) {
    const login = this.logins.get(id);
    if (!login || login.status !== 'waiting') return;
    login.status = 'cancelled';
    login.abort.abort();
    for (const waiting of [login.code, login.prompt]) waiting?.reject(new Error('Sign-in cancelled.'));
    this.changed();
  }
  close() { for (const id of this.logins.keys()) this.cancel(id); }
}
