import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AuthStorage } from '@mariozechner/pi-coding-agent';
import { DATA } from '../paths.ts';
import type { WriterAuth, WriterLogin, WriterProvider } from '../../shared.ts';

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

/** Whether a Claude credential is a subscription token rather than an API key. */
export const claudeSubscription = (key: string | undefined) => Boolean(key && SUBSCRIPTION_TOKEN.test(key.trim()));

interface Pending { resolve: (value: string) => void; reject: (error: Error) => void }
interface Login extends WriterLogin { abort: AbortController; prompt?: Pending; code?: Pending }

export class WriterCredentials {
  private logins = new Map<string, Login>();
  constructor(private storage: AuthStorage, private env: NodeJS.ProcessEnv = process.env, private changed: () => void = () => {}) {}

  /** Whether a provider's credential may be used. */
  usable(provider: string) {
    if (provider !== 'anthropic') return this.storage.hasAuth(provider);
    const stored = this.storage.get('anthropic');
    if (stored) return stored.type === 'api_key' && !claudeSubscription(stored.key);
    return Boolean(this.env.ANTHROPIC_API_KEY) && !claudeSubscription(this.env.ANTHROPIC_API_KEY);
  }

  status(): WriterAuth {
    const providers: WriterProvider[] = [
      ...LOGIN_PROVIDERS.map(({ id, name }) => ({ id, name, kind: 'login' as const, configured: this.storage.get(id)?.type === 'oauth', source: this.storage.get(id)?.type === 'oauth' ? 'stored' as const : null })),
      ...KEY_PROVIDERS.map(({ id, name, env }) => {
        const stored = this.storage.get(id)?.type === 'api_key', fromEnv = Boolean(this.env[env]) && !(id === 'anthropic' && claudeSubscription(this.env[env]));
        return { id, name, kind: 'key' as const, env, configured: stored || fromEnv, source: stored ? 'stored' as const : fromEnv ? 'environment' as const : null };
      }),
    ];
    return { providers, logins: [...this.logins.values()].map(({ abort: _a, prompt: _p, code: _c, ...login }) => login) };
  }

  setKey(provider: string, key: string) {
    if (!KEY_PROVIDERS.some(item => item.id === provider)) throw new Error('This provider does not take an API key here.');
    key = key.trim();
    if (!key || key.length > 4096 || /\s/.test(key)) throw new Error('Paste the API key exactly as the provider shows it.');
    if (provider === 'anthropic' && claudeSubscription(key)) throw new Error('This is a Claude subscription token. Papilot Writer can use Claude only with an Anthropic API key.');
    this.storage.set(provider, { type: 'api_key', key });
    this.changed();
  }
  remove(provider: string) {
    if (![...KEY_PROVIDERS, ...LOGIN_PROVIDERS].some(item => item.id === provider)) throw new Error('Unknown provider.');
    this.storage.remove(provider);
    this.changed();
  }

  /** Starts a subscription sign-in. Its progress is read through status(). */
  login(provider: string, enterprise = '') {
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
