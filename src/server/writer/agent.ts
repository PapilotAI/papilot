import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentSession, AgentSessionEvent, AuthStorage, ExtensionFactory, ModelRegistry, ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { Api, ImageContent, Model } from '@mariozechner/pi-ai';
import type { TaskPermissionOption, TaskPermissions } from '../../shared.ts';
import { Adapter, type Item, type Thread, type Turn } from '../agents.ts';
import { imageType } from '../attachments.ts';
import { AUTH_FILE, WRITER_DIR, WriterCredentials, isCustomProvider, customModelUnavailable } from './auth.ts';
import { CHARTER, COMPACTION } from './charter.ts';
import { contextBreakdown } from './context.ts';
import { fromList, listModels } from './models.ts';
import { toolError, type WriterMode } from './policy.ts';
import { mapMessage, mapUpdate, paperMap, type BuildNote } from './paper-map.ts';
import { compiledPaper } from './build-map.ts';
import type { Approval, Question, ToolHost } from './tools.ts';

// Papilot Writer: Papilot's own paper-writing agent, built on the Pi agent
// harness (@mariozechner/pi-coding-agent, used only as an SDK). Each Papilot
// thread is one Pi session file in Papilot's data folder. Pi's own coding
// tools, extensions, skills and ~/.pi settings are never loaded: the system
// prompt, the tools (writer/tools.ts) and the context (the paper map that
// opens every request) are Papilot's. Approvals, questions and the review
// engine's build and pages go through the same requests as other agents.

type Sdk = typeof import('@mariozechner/pi-coding-agent');
type Ai = typeof import('@mariozechner/pi-ai');
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface WriterOptions {
  /** Where sessions and credentials live; Papilot's data folder by default. */
  dir?: string;
  /** Credentials to use instead of the file in dir (tests). */
  auth?: AuthStorage;
  env?: NodeJS.ProcessEnv;
  fetch?: Fetch;
  /** Called with the registry once it exists (tests register models here). */
  setup?: (registry: ModelRegistry, ai: Ai) => void;
}
interface Live {
  session: AgentSession; cwd: string; mode: WriterMode; build: BuildNote | null;
  chore: { reason: string } | null; choreChanged: boolean; turn: Turn | null; tools: string[];
  /** The paper map as last sent, whole or with its updates, so the next turn sends only what changed. */
  map?: string;
}
interface Wait { resolve: (value: any) => void; turn: Turn; kind: 'approval' | 'question' | 'tool'; count?: number }

// The model each provider starts with, when the author has not chosen one.
const DEFAULT_MODELS: Record<string, string> = {
  'openai-codex': 'gpt-5.5', anthropic: 'claude-opus-4-7', 'github-copilot': 'gpt-5.4', openai: 'gpt-5.4', google: 'gemini-3.1-pro-preview',
  openrouter: 'anthropic/claude-opus-4.7', deepseek: 'deepseek-v4-pro', xai: 'grok-4.20-0309-reasoning', moonshotai: 'kimi-k2.6', zai: 'glm-5.1', mistral: 'mistral-large-latest',
};
const PROVIDER_ORDER = Object.keys(DEFAULT_MODELS);
const CHORE_TOOLS = new Set(['run_command']);
const FILE_TOOLS = new Set(['edit_file', 'write_file', 'move_file', 'delete_file', 'add_reference']);
const PER_PROVIDER = 30;
// How long a provider's model list is trusted before it is fetched again.
const CATALOG_TTL = 10 * 60 * 1000;
// The Codex backend lists the models a client of this version can use; Papilot bundles this Codex.
const CODEX_CLIENT_VERSION = (() => {
  try { const pkg = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')); return String(pkg.dependencies?.['@openai/codex'] || pkg.devDependencies?.['@openai/codex'] || '').replace(/^[^\d]*/, '') || '0.164.0'; }
  catch { return '0.164.0'; }
})();
interface Listing { models: Model<Api>[]; efforts: Map<string, string[]>; at: number }
export const modelId = (model: Pick<Model<Api>, 'provider' | 'id'>) => `${model.provider}/${model.id}`;

export class WriterAgent extends Adapter {
  readonly name = 'Papilot Writer';
  private sdk?: Sdk;
  private ai?: Ai;
  private storage?: AuthStorage;
  private registry?: ModelRegistry;
  credentials?: WriterCredentials;
  private live = new Map<string, Live>();
  // Each provider's own model list, when it could be fetched.
  private catalog = new Map<string, Listing>();
  private listing?: Promise<void>;
  private waits = new Map<string, Wait>();
  private dir: string;
  constructor(private options: WriterOptions = {}) { super(); this.dir = options.dir || WRITER_DIR; }

  // Built into Papilot, so always present; it still needs a model provider.
  detect() { return true; }
  async preload() { await this.load(); }
  async start() { await this.load(); this.ready = true; }
  private async load() {
    if (this.registry) return;
    const [sdk, ai] = await Promise.all([import('@mariozechner/pi-coding-agent'), import('@mariozechner/pi-ai')]);
    if (this.registry) return;
    this.sdk = sdk; this.ai = ai;
    this.storage = this.options.auth || sdk.AuthStorage.create(this.options.dir ? path.join(this.dir, 'auth.json') : AUTH_FILE);
    // Load only bundled models and the endpoint saved in Papilot settings.
    this.registry = sdk.ModelRegistry.inMemory(this.storage);
    this.credentials = new WriterCredentials(this.storage, this.options.env || process.env, () => { this.catalog.clear(); this.emit('credentials'); },
      { file: path.join(this.dir, 'custom-api.json'), registry: this.registry });
    this.options.setup?.(this.registry, ai);
  }

  permissionOptions(): TaskPermissionOption[] {
    return [
      { value: 'workspace', label: 'Paper edits', detail: 'Read, edit LaTeX and BibTeX, compile, view pages and add verified references without asking. Ask before other files change, files are moved or deleted, and before chore mode runs shell commands.' },
      { value: 'full', label: 'Full access', detail: 'Never ask: every edit, deletion and chore-mode command runs without approval, still only inside the task worktree.' },
    ];
  }
  async taskPermissionConfig(value: TaskPermissions) {
    if (!this.permissionOptions().some(option => option.value === value)) throw new Error('This agent does not support the selected permissions.');
    return { thread: { taskPermissions: value }, turn: { taskPermissions: value } };
  }

  /** The models the author can use now, best first per provider. */
  available(): Model<Api>[] {
    if (!this.registry || !this.credentials) return [];
    this.registry.refresh();
    const usable = this.registry.getAvailable().filter(model => this.credentials!.usable(model.provider));
    const providers = [...new Set(usable.map(model => model.provider))].sort((a, b) => (PROVIDER_ORDER.indexOf(a) + 1 || 99) - (PROVIDER_ORDER.indexOf(b) + 1 || 99));
    return providers.flatMap(provider => {
      const listed = this.catalog.get(provider)?.models;
      // A provider's own list is already in its order of preference.
      const models = listed || usable.filter(model => model.provider === provider).reverse();
      // The Codex backend ranks its list; other lists come in no useful order.
      const preferred = provider === 'openai-codex' && listed ? listed[0] : models.find(model => model.id === DEFAULT_MODELS[provider]);
      return [...(preferred ? [preferred] : []), ...models.filter(model => model !== preferred)].slice(0, PER_PROVIDER);
    });
  }
  /** Fetches the model list of each configured provider whose list is missing or old. */
  async refreshModels() {
    await this.load();
    this.listing ||= (async () => {
      const registry = this.registry!, fetcher = this.options.fetch || fetch;
      registry.refresh();
      const usable = registry.getAvailable().filter(model => !isCustomProvider(model.provider) && this.credentials!.usable(model.provider));
      await Promise.all([...new Set(usable.map(model => model.provider))].map(async provider => {
        const cached = this.catalog.get(provider);
        if (cached && Date.now() - cached.at < CATALOG_TTL) return;
        const builtins = usable.filter(model => model.provider === provider);
        try {
          const token = await registry.getApiKeyForProvider(provider);
          const listed = token ? await listModels(provider, token, builtins[0], fetcher, CODEX_CLIENT_VERSION) : null;
          const models = listed ? fromList(listed, builtins) : [];
          if (models.length) this.catalog.set(provider, { models, efforts: new Map(listed!.filter(entry => entry.efforts?.length).map(entry => [entry.id, entry.efforts!])), at: Date.now() });
          else this.catalog.delete(provider);
        } catch {
          // Offline or refused: keep the last list, or fall back to Pi's built-in entries.
          if (cached) cached.at = Date.now() - CATALOG_TTL + 60000;
        }
      }));
    })().finally(() => { this.listing = undefined; });
    await this.listing;
  }
  private defaultModel() { return this.available()[0]; }
  protected account() {
    const configured = this.credentials?.status().providers.filter(provider => provider.configured && this.credentials!.usable(provider.id)) || [];
    if (!configured.length || !this.defaultModel()) return { account: null, requiresOpenaiAuth: true, reason: 'Papilot Writer needs a model provider. Sign in with ChatGPT or GitHub Copilot, or add an API key, in Settings → Agents → Papilot Writer.' };
    return { account: { type: configured.map(provider => provider.name).join(', ') }, requiresOpenaiAuth: false };
  }
  protected async models() {
    await this.refreshModels();
    const available = this.available();
    const fallback = available[0];
    // The picker groups models by provider, under the names Papilot's settings use.
    const sources = new Map(this.credentials!.status().providers.map(provider => [provider.id, provider.name]));
    return { data: available.map(model => {
      const listed = this.catalog.get(model.provider)?.efforts.get(model.id);
      const efforts = listed || (model.reasoning ? this.ai!.getSupportedThinkingLevels(model).filter(level => level !== 'off') : []);
      return {
        model: modelId(model), displayName: model.name, source: sources.get(model.provider) || this.registry!.getProviderDisplayName(model.provider), isDefault: model === fallback,
        supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort })), defaultReasoningEffort: efforts.includes('medium') ? 'medium' : efforts[0] || null,
      };
    }) };
  }

  respond(id: string | number, result: any) {
    const wait = this.waits.get(String(id));
    if (!wait) throw new Error('This request has ended.');
    this.waits.delete(String(id));
    if (wait.kind === 'approval') {
      wait.resolve(result?.decision === 'accept');
      if (result?.decision === 'cancel') wait.turn.stop();
    } else if (wait.kind === 'question') wait.resolve(Array.from({ length: wait.count || 0 }, (_, index) => String(result?.answers?.[index]?.answers?.[0] ?? result?.answers?.[String(index)]?.answers?.[0] ?? '')));
    else wait.resolve({ success: Boolean(result?.success), text: (result?.contentItems || []).map((item: { text?: string }) => item.text || '').join('\n') });
  }
  reject(id: string | number, message: string) {
    const wait = this.waits.get(String(id));
    if (!wait) return;
    this.waits.delete(String(id));
    wait.resolve(wait.kind === 'approval' ? false : wait.kind === 'question' ? [] : { success: false, text: message });
  }
  // Sends a request to Papilot and waits for the answer, or for the turn to stop.
  private send<T>(turn: Turn, kind: Wait['kind'], method: string, params: Record<string, unknown>, fallback: T, signal?: AbortSignal, count?: number) {
    return new Promise<T>(resolve => {
      const id = randomUUID();
      const end = () => { if (this.waits.delete(id)) { resolve(fallback); this.notify('serverRequest/resolved', { threadId: turn.threadId, requestId: id }); } };
      if (signal?.aborted || turn.status !== 'inProgress') { resolve(fallback); return; }
      signal?.addEventListener('abort', end, { once: true });
      this.waits.set(id, { kind, turn, count, resolve: value => { signal?.removeEventListener('abort', end); resolve(value); } });
      this.emit('request', { id, method, params: { threadId: turn.threadId, turnId: turn.id, ...params } });
    });
  }

  /** This turn's paper map: whole, as an update, or nothing when nothing changed. */
  private async paperMap(live: Live) {
    const map = await paperMap(live.cwd, { compiled: await compiledPaper(this.host(live)), note: live.build });
    // Compaction summarizes old turns away; without a whole map left in the
    // history, the next one is whole again.
    const kept = live.map != null && live.session.messages.some((message: any) => message.role === 'user'
      && (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).includes('<paper-map>'));
    const update = kept ? mapUpdate(live.map!, map.text) : null;
    live.map = map.text;
    return update === null ? mapMessage(map) : update;
  }
  private host(live: Live): ToolHost {
    const turn = () => { if (!live.turn) throw toolError('No turn is running.'); return live.turn; };
    return {
      cwd: live.cwd,
      mode: () => live.mode,
      fetch: this.options.fetch,
      approve: (request: Approval, signal) => this.send(turn(), 'approval', request.kind === 'command' ? 'item/commandExecution/requestApproval' : 'item/fileChange/requestApproval',
        { reason: `${request.title}. ${request.reason}`, command: request.kind === 'command' ? request.command : request.title }, false, signal),
      ask: (questions: Question[], signal) => this.send<string[]>(turn(), 'question', 'item/tool/requestUserInput',
        { questions: questions.map((q, index) => ({ id: String(index), header: q.header || 'Question', question: q.question, options: q.options, isOther: true })) }, [], signal, questions.length),
      papilot: (tool, args, signal, callId) => this.send(turn(), 'tool', 'item/tool/call', { callId: callId || randomUUID(), tool, arguments: args }, { success: false, text: 'The turn stopped before Papilot answered.' }, signal),
      lastBuild: () => live.build,
      recordBuild: note => { live.build = note; },
      chore: () => live.chore,
      enterChore: async (reason, plan, signal) => {
        const ok = live.mode === 'full' || await this.send(turn(), 'approval', 'item/commandExecution/requestApproval',
          { reason: `Enter chore mode: ${reason}. Papilot Writer will be able to run shell commands in the task worktree until the chore is done.`, command: plan || reason }, false, signal);
        if (ok) { live.chore = { reason }; live.choreChanged = true; }
        return ok;
      },
      exitChore: () => { live.chore = null; live.choreChanged = true; },
    };
  }

  // The tools Pi offers in the next request: run_command only in chore mode.
  private activate(live: Live) {
    live.session.setActiveToolsByName(live.tools.filter(name => live.chore || !CHORE_TOOLS.has(name)));
    live.choreChanged = false;
  }

  private async open(threadId: string, thread: Thread, model: Model<Api>): Promise<Live> {
    const known = this.live.get(threadId);
    const mode: WriterMode = thread.readOnly ? 'read-only' : thread.permissions === 'full' ? 'full' : 'paper';
    if (known && known.cwd === thread.cwd && (known.mode === 'read-only') === (mode === 'read-only')) { known.mode = mode; return known; }
    known?.session.dispose();
    const sdk = this.sdk!, sessions = path.join(this.dir, 'sessions');
    fs.mkdirSync(sessions, { recursive: true });
    // Papilot's helper turns (titles, commit messages) keep no session file.
    const sessionManager = thread.ephemeral ? sdk.SessionManager.inMemory(thread.cwd) : sdk.SessionManager.open(path.join(sessions, `${threadId}.jsonl`), sessions, thread.cwd);
    const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: true } });
    const live: Live = { session: undefined as never, cwd: thread.cwd, mode, build: null, chore: null, choreChanged: false, turn: null, tools: [] };
    // Earlier turns are summarized with Papilot Writer's own priorities.
    const compaction: ExtensionFactory = pi => {
      pi.on('session_before_compact', async (event, ctx) => {
        if (!ctx.model) return undefined;
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
        if (!auth.ok || !auth.apiKey) return undefined;
        const result = await sdk.compact(event.preparation, ctx.model, auth.apiKey, auth.headers, [COMPACTION, event.customInstructions].filter(Boolean).join('\n\n'), event.signal);
        return { compaction: result };
      });
    };
    const loader = new sdk.DefaultResourceLoader({
      cwd: thread.cwd, agentDir: this.dir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: `${CHARTER}\n\n# Papilot task\n\n${thread.instructions}`,
      agentsFilesOverride: () => ({ agentsFiles: projectInstructions(thread.cwd) }),
      extensionFactories: [compaction],
    });
    await loader.reload();
    const { writerTools } = await import('./tools.ts');
    const tools: ToolDefinition[] = writerTools(this.host(live));
    live.tools = tools.map(tool => tool.name);
    const { session } = await sdk.createAgentSession({
      cwd: thread.cwd, agentDir: this.dir, authStorage: this.storage, modelRegistry: this.registry, model,
      tools: live.tools, customTools: tools, resourceLoader: loader, sessionManager, settingsManager,
    });
    live.session = session;
    this.activate(live);
    this.live.set(threadId, live);
    return live;
  }
  private async resolve(id: string | null) {
    await this.refreshModels();
    const available = this.available();
    const chosen = id && available.find(model => modelId(model) === id);
    if (id && !chosen && (isCustomProvider(id) || (available[0] && isCustomProvider(available[0].provider)))) throw customModelUnavailable();
    return chosen || available[0];
  }

  protected run(turn: Turn, thread: Thread, text: string, effort: string | null, images: string[]) { void this.execute(turn, thread, text, effort, images); }
  private async execute(turn: Turn, thread: Thread, text: string, effort: string | null, images: string[]) {
    let error: string | null = null, stopped = false, live: Live | undefined, unsubscribe = () => {};
    let redactError = (message: string) => message;
    turn.stop = () => {
      stopped = true;
      for (const [id, wait] of this.waits) if (wait.turn === turn) this.reject(id, 'The turn was stopped.');
      void live?.session.abort();
      this.finish(turn, 'interrupted');
    };
    try {
      await this.load();
      const model = await this.resolve(thread.model);
      if (!model) throw new Error(String(this.account().reason || 'Papilot Writer has no model available.'));
      const redact = this.credentials!.redactCustomErrors(model.provider);
      redactError = message => redact(this.credentials!.redactCustomErrors(model.provider)(message));
      live = await this.open(turn.threadId, thread, model);
      if (stopped) return;
      live.turn = turn;
      const session = live.session;
      if (session.model?.provider !== model.provider || session.model?.id !== model.id) await session.setModel(model);
      const levels = model.reasoning ? this.ai!.getSupportedThinkingLevels(model) : ['off'];
      session.setThinkingLevel((effort && levels.includes(effort as never) ? effort : levels.includes('medium' as never) ? 'medium' : levels[0]) as never);
      unsubscribe = this.translate(turn, session, value => { error = redactError(value); }, redactError);
      const pictures: ImageContent[] = [];
      for (const file of images) {
        const bytes = await fs.promises.readFile(file), mime = imageType(bytes);
        if (!mime) throw new Error('This image format is not supported.');
        pictures.push({ type: 'image', data: bytes.toString('base64'), mimeType: mime });
      }
      // The paper map opens the request: whole the first time, then only what
      // changed. Earlier maps stay in the history, so the provider's prompt
      // cache stays valid from one turn to the next.
      const map = await this.paperMap(live);
      let prompt = map ? `${map}\n\n${text}` : text;
      for (let rounds = 0; !stopped && rounds < 20; rounds++) {
        await session.prompt(prompt, rounds === 0 && pictures.length ? { images: pictures } : undefined);
        // Pi fixes a run's tools when it starts, so entering chore mode ends
        // the run and the next one starts with run_command.
        if (!live.choreChanged || error || stopped) break;
        this.activate(live);
        if (!live.chore) break;
        prompt = `Chore mode is now on for: ${live.chore.reason}. run_command is available. Carry out the chore, call exit_chore_mode when it is done, then finish the author's request.`;
      }
      if (!stopped) this.finish(turn, error ? 'failed' : 'completed', error || undefined);
    } catch (e) {
      if (!stopped) this.finish(turn, 'failed', redactError(e instanceof Error ? e.message : String(e)));
    } finally {
      unsubscribe();
      if (live) {
        live.turn = null;
        // A chore never outlives the turn the author approved it in.
        if (live.chore || live.choreChanged) { live.chore = null; this.activate(live); }
      }
    }
  }

  // Pi's events as the items Papilot shows in the conversation.
  private translate(turn: Turn, session: AgentSession, fail: (error: string) => void, redactError: (error: string) => string) {
    let message = 0, text = '';
    const shown = new Map<string, Item>();
    return session.subscribe((event: AgentSessionEvent) => {
      if (turn.status !== 'inProgress') return;
      if (event.type === 'message_start' && event.message.role === 'assistant') { message++; text = ''; }
      else if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        text += event.assistantMessageEvent.delta;
        this.notify('item/agentMessage/delta', { threadId: turn.threadId, turnId: turn.id, itemId: `${turn.id}:text:${message}`, delta: event.assistantMessageEvent.delta });
      } else if (event.type === 'message_end' && event.message.role === 'assistant') {
        const final = event.message.content.filter(part => part.type === 'text').map(part => (part as { text: string }).text).join('') || text;
        if (final.trim()) this.item(turn, { id: `${turn.id}:text:${message}`, type: 'agentMessage', text: final });
        if (event.message.stopReason === 'error') fail(event.message.errorMessage || 'The model provider returned an error.');
        const stepUsage = event.message.usage;
        if (stepUsage) {
          const activeModel = session.model;
          const priced = Boolean(activeModel && (activeModel.cost.input > 0 || activeModel.cost.output > 0 || activeModel.cost.cacheRead > 0 || activeModel.cost.cacheWrite > 0)) || Number(stepUsage.cost?.total) > 0;
          const resolvedModel = activeModel ? modelId(activeModel) : event.message.provider && event.message.model ? `${event.message.provider}/${event.message.model}` : event.message.model || null;
          this.notify('turn/usage', {
            threadId: turn.threadId,
            turnId: turn.id,
            model: resolvedModel,
            usage: {
              input: stepUsage.input,
              cached: stepUsage.cacheRead,
              cacheWrite: stepUsage.cacheWrite,
              output: stepUsage.output,
              total: stepUsage.totalTokens,
              ...(priced && typeof stepUsage.cost?.total === 'number' ? { costUsd: stepUsage.cost.total, costSource: 'estimated' } : {}),
            },
          });
        }
        const usage = session.getContextUsage();
        if (usage?.tokens) this.notify('thread/tokenUsage/updated', { threadId: turn.threadId, turnId: turn.id, tokenUsage: { last: { totalTokens: usage.tokens }, modelContextWindow: usage.contextWindow },
          breakdown: contextBreakdown(session, usage.tokens, usage.contextWindow) });
      } else if (event.type === 'tool_execution_start') {
        const item = toolItem(event.toolCallId, event.toolName, event.args || {});
        shown.set(event.toolCallId, item);
        this.item(turn, item, false);
      } else if (event.type === 'tool_execution_end') {
        const started = shown.get(event.toolCallId) || toolItem(event.toolCallId, event.toolName, {});
        const details = event.result?.details || {};
        let item: Item = { ...started, status: event.isError ? 'failed' : 'completed' };
        if (started.type === 'fileChange' && (event.isError || !details.changed)) item = { id: started.id, type: 'toolCall', text: `${event.toolName} ${String((started.changes as { path: string }[])[0]?.path || '')}`, status: event.isError ? 'failed' : 'completed' };
        // An edit carries its diff, which the chat shows.
        if (item.type === 'fileChange' && typeof details.diff === 'string') item = { ...item, changes: [{ path: String(details.path || (started.changes as { path: string }[])[0]?.path || ''), diff: details.diff }] };
        if (started.type === 'commandExecution') item = { ...item, aggregatedOutput: details.output ?? resultText(event.result), exitCode: details.exitCode ?? null };
        if (started.type === 'dynamicToolCall') item = { ...item, success: !event.isError };
        // A read says which file and lines it ended up reading, and where they are in the paper.
        if (started.kind === 'read' && !event.isError) item = { ...item, ...(details.path ? { target: details.path } : {}), ...(details.lines ? { lines: details.lines } : {}), ...(details.place ? { place: details.place } : {}) };
        this.item(turn, item);
      } else if (event.type === 'auto_retry_start') {
        this.item(turn, { id: `${turn.id}:retry:${event.attempt}`, type: 'toolCall', text: `Retrying after a provider error (${event.attempt}/${event.maxAttempts}): ${redactError(event.errorMessage).slice(0, 160)}`, status: 'completed' });
      } else if (event.type === 'compaction_end' && event.result) {
        this.item(turn, { id: `${turn.id}:compaction:${Date.now()}`, type: 'toolCall', text: 'Summarized earlier turns to make room in the context', status: 'completed' });
      }
    });
  }

  async closeThread(threadId: string) {
    const live = this.live.get(threadId);
    if (live) { try { live.session.dispose(); } catch { /* Already closed. */ } this.live.delete(threadId); }
    await super.closeThread(threadId);
  }

  close() {
    super.close();
    for (const id of [...this.waits.keys()]) this.reject(id, 'Papilot is closing.');
    for (const live of this.live.values()) live.session.dispose();
    this.live.clear();
    this.credentials?.close();
  }
}

const resultText = (result: any) => (result?.content || []).filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join('\n');

/** A tool call as Papilot shows it: file changes, commands, page views, the rest by name. */
export function toolItem(id: string, name: string, args: Record<string, any>): Item {
  if (FILE_TOOLS.has(name)) return { id, type: 'fileChange', changes: [{ path: String(args.path || args.bib_file || args.from || '') }], status: 'inProgress' };
  if (name === 'run_command') return { id, type: 'commandExecution', command: String(args.command || ''), status: 'inProgress' };
  if (name === 'view_pages') return { id, type: 'dynamicToolCall', tool: 'view_pdf', arguments: args, status: 'inProgress' };
  const label: Record<string, string> = { paper_outline: 'Outline', read_file: 'Read', search_text: 'Search text', search_source: 'Search source', find_references: 'Find references', list_files: 'List files',
    check_build: 'Compile', lookup_reference: 'Look up reference', read_webpage: 'Read webpage', ask_author: 'Ask the author', enter_chore_mode: 'Enter chore mode', exit_chore_mode: 'End chore mode' };
  const target = String(args.section || args.path || args.query || args.pattern || args.name || args.url || args.chore || '').slice(0, 200);
  const lines = !args.section && args.start_line ? `${args.start_line}${args.end_line ? `-${args.end_line}` : ''}` : '';
  // text is the plain fallback; kind and target let the chat word and group the call.
  return { id, type: 'toolCall', text: `${label[name] || name}${target ? ` ${target}${lines ? `:${lines}` : ''}` : ''}`, status: 'inProgress',
    ...(TOOL_KINDS[name] ? { kind: TOOL_KINDS[name], target, ...(lines ? { lines } : {}) } : {}) };
}
// The kinds of Writer tool call the chat words, groups and gives an icon.
const TOOL_KINDS: Record<string, string> = { paper_outline: 'outline', read_file: 'read', search_text: 'search', search_source: 'search', find_references: 'references', list_files: 'list',
  check_build: 'build', lookup_reference: 'lookup', read_webpage: 'web', ask_author: 'ask', enter_chore_mode: 'chore', exit_chore_mode: 'chore-end' };

// The paper's own agent instructions, from the top of the worktree only.
function projectInstructions(cwd: string) {
  return ['AGENTS.md', 'CLAUDE.md'].flatMap(name => {
    const file = path.join(cwd, name);
    try { return fs.statSync(file).isFile() ? [{ path: name, content: fs.readFileSync(file, 'utf8').slice(0, 20000) }] : []; } catch { return []; }
  });
}

