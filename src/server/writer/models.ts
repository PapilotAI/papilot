import type { Api, Model } from '@mariozechner/pi-ai';
import { toolError } from './policy.ts';

// Papilot Writer offers the models each provider says the author can use
// now, not Pi's built-in list, which ships with the package and goes stale:
// a ChatGPT account may not serve a model the list names, and newer models
// are missing from it. Each provider's own model list is fetched with the
// author's credential; Pi's built-in entries serve only as templates for how
// to talk to a model (API, endpoint, headers). When a list cannot be fetched,
// the built-in entries are offered instead.

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
/** What a provider's list says about one model. */
export interface Listed { id: string; name?: string; contextWindow?: number; maxTokens?: number; input?: ('text' | 'image')[]; efforts?: string[]; endpoints?: string[] }

const TIMEOUT = 15000;
// Models in OpenAI-compatible lists that do not hold a conversation.
const NOT_CHAT = /(embed|tts|whisper|transcri|audio|realtime|speech|image|dall-e|moderation|search|davinci|babbage|instruct|rerank|ocr|guard)/i;

async function get(fetcher: Fetch, url: string, headers: Record<string, string>) {
  const response = await fetcher(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!response.ok) throw toolError(`${new URL(url).hostname} answered ${response.status} for its model list.`);
  return response.json() as Promise<any>;
}
const trimSlash = (url: string) => url.replace(/\/+$/, '');

// The ChatGPT account id is a claim in the Codex access token.
function chatgptAccount(token: string) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))?.['https://api.openai.com/auth']?.chatgpt_account_id || null; } catch { return null; }
}

/** A provider's own model list, or null when it has none Papilot can read. */
export async function listModels(provider: string, token: string, template: Model<Api>, fetcher: Fetch, clientVersion: string): Promise<Listed[] | null> {
  const base = trimSlash(template.baseUrl || '');
  if (provider === 'openai-codex') {
    const account = chatgptAccount(token);
    const body = await get(fetcher, `${base || 'https://chatgpt.com/backend-api'}/codex/models?client_version=${encodeURIComponent(clientVersion)}`, { Authorization: `Bearer ${token}`, originator: 'pi', ...(account ? { 'chatgpt-account-id': account } : {}) });
    return [...(body?.models || [])]
      .filter((model: any) => model?.slug && (model.visibility === undefined || model.visibility === 'list'))
      .sort((a: any, b: any) => (a.priority ?? 999) - (b.priority ?? 999))
      .map((model: any) => ({
        id: String(model.slug), name: model.display_name || undefined, contextWindow: Number(model.context_window) || undefined,
        efforts: (model.supported_reasoning_levels || []).map((level: any) => String(level?.effort || level)).filter(Boolean),
        input: Array.isArray(model.input_modalities) ? (model.input_modalities.includes('image') ? ['text', 'image'] : ['text']) : undefined,
      }));
  }
  if (provider === 'github-copilot') {
    const body = await get(fetcher, `${base}/models`, { ...(template.headers || {}), Authorization: `Bearer ${token}` });
    return (body?.data || [])
      .filter((model: any) => model?.id && model.capabilities?.type === 'chat' && model.model_picker_enabled !== false && model.policy?.state !== 'disabled')
      .map((model: any) => ({
        id: String(model.id), name: model.name || undefined, endpoints: Array.isArray(model.supported_endpoints) ? model.supported_endpoints : undefined,
        contextWindow: Number(model.capabilities?.limits?.max_context_window_tokens) || undefined, maxTokens: Number(model.capabilities?.limits?.max_output_tokens) || undefined,
        input: model.capabilities?.supports?.vision ? ['text', 'image'] : undefined,
      }));
  }
  if (provider === 'anthropic') {
    const body = await get(fetcher, 'https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': token, 'anthropic-version': '2023-06-01' });
    return (body?.data || []).filter((model: any) => model?.id).map((model: any) => ({ id: String(model.id), name: model.display_name || undefined }));
  }
  if (provider === 'google') {
    const body = await get(fetcher, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': token });
    return (body?.models || [])
      .filter((model: any) => /^models\/gemini/.test(model?.name || '') && (model.supportedGenerationMethods || []).includes('generateContent') && !NOT_CHAT.test(model.name))
      .map((model: any) => ({ id: String(model.name).replace(/^models\//, ''), name: model.displayName || undefined, contextWindow: Number(model.inputTokenLimit) || undefined, maxTokens: Number(model.outputTokenLimit) || undefined }));
  }
  // OpenAI and the OpenAI-compatible providers (OpenRouter, DeepSeek, xAI, Moonshot, Z.ai, Mistral).
  if (!base) return null;
  const body = await get(fetcher, `${base}/models`, { Authorization: `Bearer ${token}` });
  return (body?.data || [])
    .filter((model: any) => model?.id && !NOT_CHAT.test(model.id) && (provider !== 'openai' || /^(gpt-|o\d|chatgpt-)/.test(model.id)))
    .map((model: any) => ({ id: String(model.id), name: model.name || undefined, contextWindow: Number(model.context_length) || undefined, maxTokens: Number(model.top_provider?.max_completion_tokens) || undefined }));
}

// Copilot names the endpoint each model speaks; Pi's API names follow it.
const ENDPOINT_API: Record<string, Api> = { '/v1/messages': 'anthropic-messages', '/responses': 'openai-responses', '/chat/completions': 'openai-completions' };
const shared = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

/** The built-in entry to copy request settings from: the same id, else the most similar one. */
export function templateFor(entry: Listed, builtins: Model<Api>[]): Model<Api> {
  const same = builtins.find(model => model.id === entry.id);
  if (same) return same;
  const apis = (entry.endpoints || []).map(endpoint => ENDPOINT_API[endpoint]).filter(Boolean);
  const pool = apis.length && builtins.some(model => apis.includes(model.api)) ? builtins.filter(model => apis.includes(model.api)) : builtins;
  // Ties go to the later entry, which is usually the newer model of a family.
  return pool.reduce((best, model) => shared(model.id, entry.id) >= shared(best.id, entry.id) ? model : best);
}

/** Pi models for a provider's list, built from its built-in entries. */
export function fromList(listed: Listed[], builtins: Model<Api>[]): Model<Api>[] {
  if (!builtins.length) return [];
  const seen = new Set<string>();
  return listed.filter(entry => !seen.has(entry.id) && seen.add(entry.id)).map(entry => {
    const template = templateFor(entry, builtins), same = template.id === entry.id;
    const efforts = entry.efforts?.length ? entry.efforts : null;
    return {
      ...template, id: entry.id, name: entry.name || (same ? template.name : entry.id),
      contextWindow: entry.contextWindow || template.contextWindow, maxTokens: entry.maxTokens || template.maxTokens,
      input: entry.input || template.input, reasoning: efforts ? true : template.reasoning,
      // Prices of a model Pi does not know are unknown, not the template's.
      cost: same ? template.cost : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  });
}
