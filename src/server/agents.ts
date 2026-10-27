import { randomUUID } from 'node:crypto';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AccountInfo, ModelInfo, Options, PermissionResult, Query, SDKMessage, SDKRateLimitInfo, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentId } from '../shared.ts';
import { DATA } from './paths.ts';

// Papilot drives every agent through the request and notification surface of
// the Codex app-server: thread/start, thread/resume, turn/start,
// turn/interrupt and thread/read, item and turn notifications, and approval
// requests answered with respond(). Claude and Antigravity get small adapters
// that translate their own interfaces into that surface, so the task
// lifecycle (queueing, approvals, pausing, review rounds) stays in one place.
export interface AgentRuntime extends EventEmitter {
  ready: boolean;
  start(): Promise<void>;
  request(method: string, params: any, timeout?: number): Promise<any>;
  respond(id: string | number, result: unknown): void;
  reject(id: string | number, message: string): void;
  close(): void;
}

export const AGENT_NAMES: Record<AgentId, string> = { codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity' };

interface Thread { cwd: string; instructions: string; model: string | null; started: boolean }
interface Turn { id: string; threadId: string; clientId?: string; status: 'inProgress' | 'completed' | 'interrupted' | 'failed'; stop: () => void }
interface Item { id: string; type: string; [key: string]: unknown }

// Shared bookkeeping: threads, turns and the notifications Papilot expects.
abstract class Adapter extends EventEmitter implements AgentRuntime {
  ready = false;
  protected threads = new Map<string, Thread>();
  protected turns = new Map<string, Turn>();
  abstract start(): Promise<void>;
  protected abstract run(turn: Turn, thread: Thread, text: string, effort: string | null): void;
  protected account(): unknown { return { account: null, requiresOpenaiAuth: false }; }
  protected models(): unknown { return { data: [] }; }
  protected limits(): unknown { throw new Error('This agent does not report usage.'); }
  async request(method: string, params: any = {}): Promise<any> {
    if (method === 'account/read') return this.account();
    if (method === 'model/list') return this.models();
    if (method === 'account/rateLimits/read') return this.limits();
    if (method === 'thread/start' || method === 'thread/resume') {
      const id = method === 'thread/start' ? randomUUID() : String(params.threadId);
      const known = this.threads.get(id);
      this.threads.set(id, { cwd: params.cwd, instructions: params.developerInstructions || '', model: params.model || known?.model || null, started: method === 'thread/resume' || Boolean(known?.started) });
      return { thread: { id }, model: params.model || null };
    }
    if (method === 'turn/start') {
      const thread = this.threads.get(String(params.threadId));
      if (!thread) throw new Error('Start or resume the thread before starting a turn.');
      const text = (params.input || []).map((part: { text?: string }) => part.text || '').join('\n');
      const turn: Turn = { id: randomUUID(), threadId: String(params.threadId), clientId: params.clientUserMessageId, status: 'inProgress', stop: () => {} };
      this.turns.set(turn.id, turn);
      // Papilot records the turn ID before the first event arrives.
      setImmediate(() => this.run(turn, { ...thread, cwd: params.cwd || thread.cwd }, text, params.effort || null));
      return { turn: { id: turn.id } };
    }
    if (method === 'turn/interrupt') { this.turns.get(String(params.turnId))?.stop(); return {}; }
    if (method === 'thread/read') {
      const turns = [...this.turns.values()].filter(turn => turn.threadId === params.threadId)
        .map(turn => ({ id: turn.id, status: turn.status, items: turn.clientId ? [{ type: 'userMessage', clientId: turn.clientId }] : [] }));
      return { thread: { id: params.threadId, status: { type: 'loaded' }, turns } };
    }
    throw new Error(`${method} is not supported by this agent.`);
  }
  respond(_id: string | number, _result: unknown) {}
  reject(_id: string | number, _message: string) {}
  close() { for (const turn of this.turns.values()) if (turn.status === 'inProgress') turn.stop(); }
  protected notify(method: string, params: Record<string, unknown>) { this.emit('notification', { method, params }); }
  protected item(turn: Turn, item: Item, done = true) { this.notify(done ? 'item/completed' : 'item/started', { threadId: turn.threadId, turnId: turn.id, item }); }
  protected finish(turn: Turn, status: Turn['status'], error?: string) {
    if (turn.status !== 'inProgress') return;
    turn.status = status;
    this.notify('turn/completed', { threadId: turn.threadId, turn: { id: turn.id, status, ...(error ? { error: { message: error } } : {}) } });
  }
}

// Tool calls shown in the conversation: commands, file edits, and the rest by name.
function toolItem(id: string, name: string, input: Record<string, any>): Item {
  const file = input.file_path || input.notebook_path || input.Path || input.TargetFile || input.AbsolutePath;
  if (name === 'Bash' || name === 'run_command') return { id, type: 'commandExecution', command: String(input.command || input.CommandLine || ''), status: 'inProgress' };
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'write_to_file', 'write_file', 'edit_file', 'create_file', 'replace_file_content', 'multi_replace_file_content', 'sed_file', 'notebook_edit'].includes(name) && file) return { id, type: 'fileChange', changes: [{ path: String(file) }], status: 'inProgress' };
  const target = file || input.pattern || input.Query || input.query || input.url || input.SearchPath || input.DirectoryPath || input.description || '';
  return { id, type: 'toolCall', text: `${name}${target ? ` ${String(target).slice(0, 200)}` : ''}`, status: 'inProgress' };
}

// Claude runs through the Claude Agent SDK, which runs the Claude Code binary
// with the login already on this host (a Claude subscription, or an API key
// if ANTHROPIC_API_KEY is set). Papilot never reads or stores the credential.
// Edits in the task worktree are accepted, commands run in Claude Code's
// sandbox, and anything that needs approval comes to Papilot as a request.
export class ClaudeAgent extends Adapter {
  private info: { account: AccountInfo | null; models: ModelInfo[] } = { account: null, models: [] };
  private rateLimits = new Map<string, SDKRateLimitInfo>();
  private defaults = new Map<string, string>();
  private approvals = new Map<string, { resolve: (result: PermissionResult) => void; input: Record<string, unknown>; kind: 'tool' | 'question'; questions: string[] }>();
  constructor(private load: () => Promise<typeof import('@anthropic-ai/claude-agent-sdk')['query']> = () => import('@anthropic-ai/claude-agent-sdk').then(sdk => sdk.query)) { super(); }
  async start() {
    if (this.ready) return;
    const query = await this.load();
    // Reading the account and models starts Claude Code without sending a prompt.
    let finish = () => {};
    const idle = (async function* (): AsyncGenerator<SDKUserMessage> { await new Promise<void>(resolve => { finish = resolve; }); })();
    const probe = query({ prompt: idle, options: { cwd: os.homedir(), settingSources: [] } });
    try {
      const [account, models] = await Promise.all([probe.accountInfo(), probe.supportedModels()]);
      this.info = { account, models };
      this.ready = true;
    } finally { finish(); probe.close(); }
  }
  // Claude tasks need an API key (or a cloud provider's own credentials):
  // Anthropic does not accept a Claude subscription login through the SDK.
  protected account() {
    const account = this.info.account, keyed = Boolean(account?.apiKeySource && !['none', 'oauth'].includes(account.apiKeySource));
    const external = Boolean(account?.apiProvider && account.apiProvider !== 'firstParty');
    if (keyed || external) return { account: { email: account?.email, type: external ? account!.apiProvider : 'API key' }, requiresOpenaiAuth: false };
    return { account: null, requiresOpenaiAuth: true, reason: 'Claude needs an Anthropic API key: Anthropic does not allow a Claude subscription login through the Claude Agent SDK. Start Papilot with ANTHROPIC_API_KEY set to use Claude.' };
  }
  protected models() {
    const all = this.info.models, preferred = all.find(model => model.value === 'default');
    const data = all.filter(model => model.value !== 'default').map(model => ({
      model: model.value, displayName: model.displayName,
      isDefault: Boolean(preferred?.resolvedModel ? model.resolvedModel === preferred.resolvedModel : model.value === 'opus'),
      supportedReasoningEfforts: (model.supportedEffortLevels || []).map(effort => ({ reasoningEffort: effort })),
      defaultReasoningEffort: this.defaults.get(model.value) || null,
    }));
    return { data };
  }
  // Rolling limit windows come with each turn's rate limit events.
  protected limits() {
    const windows = (['five_hour', 'seven_day'] as const).map(type => this.rateLimits.get(type)).filter((info): info is SDKRateLimitInfo => Boolean(info && typeof info.utilization === 'number'))
      .map(info => ({ usedPercent: info.utilization! <= 1 ? info.utilization! * 100 : info.utilization!, windowDurationMins: info.rateLimitType === 'five_hour' ? 300 : 10080, resetsAt: info.resetsAt ? (info.resetsAt > 1e12 ? Math.round(info.resetsAt / 1000) : info.resetsAt) : null }));
    if (!windows.length) throw new Error('Claude has not reported usage yet.');
    const rejected = [...this.rateLimits.values()].some(info => info.status === 'rejected');
    return { ordinaryUsageAllowed: !rejected, rateLimits: { planType: this.info.account?.subscriptionType?.replace(/^Claude\s+/i, '').toLowerCase() || null, primary: windows[0], secondary: windows[1] || null, credits: null, rateLimitReachedType: rejected ? 'rate_limit_reached' : null } };
  }
  respond(id: string | number, result: any) {
    const wait = this.approvals.get(String(id));
    if (!wait) throw new Error('This request has ended.');
    this.approvals.delete(String(id));
    if (wait.kind === 'question') {
      const answers = Object.fromEntries(wait.questions.map((question, index) => [question, String(result?.answers?.[index]?.answers?.[0] || '')]));
      wait.resolve({ behavior: 'allow', updatedInput: { ...wait.input, answers } });
    } else wait.resolve(result?.decision === 'accept' ? { behavior: 'allow', updatedInput: wait.input } : { behavior: 'deny', message: 'The user declined this action.', interrupt: result?.decision === 'cancel' });
  }
  reject(id: string | number, message: string) {
    const wait = this.approvals.get(String(id));
    if (wait) { this.approvals.delete(String(id)); wait.resolve({ behavior: 'deny', message }); }
  }
  protected run(turn: Turn, thread: Thread, text: string, effort: string | null) { void this.execute(turn, thread, text, effort); }
  private async execute(turn: Turn, thread: Thread, text: string, effort: string | null) {
    const abort = new AbortController();
    turn.stop = () => abort.abort();
    const tools = new Map<string, Item>(), texts = new Map<string, string>();
    let error = '';
    try {
      const query = await this.load();
      const options: Options = {
        cwd: thread.cwd, abortController: abort, includePartialMessages: true,
        ...(thread.model ? { model: thread.model } : {}), ...(effort ? { effort: effort as Options['effort'] } : {}),
        // The thread ID is the Claude session ID, so a later turn resumes it.
        ...(thread.started ? { resume: turn.threadId } : { sessionId: turn.threadId }),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: thread.instructions },
        settingSources: ['project'], permissionMode: 'acceptEdits',
        sandbox: { enabled: true, autoAllowBashIfSandboxed: true },
        canUseTool: (name, input, { signal, title, decisionReason }) => new Promise<PermissionResult>(resolve => {
          const id = randomUUID(), question = name === 'AskUserQuestion' && Array.isArray(input.questions);
          const questions = question ? (input.questions as { question: string; header?: string; options?: { label: string; description?: string }[] }[]) : [];
          this.approvals.set(id, { resolve, input, kind: question ? 'question' : 'tool', questions: questions.map(q => q.question) });
          signal.addEventListener('abort', () => { if (this.approvals.delete(id)) { resolve({ behavior: 'deny', message: 'The turn was stopped.' }); this.notify('serverRequest/resolved', { threadId: turn.threadId, requestId: id }); } }, { once: true });
          const shown = toolItem(id, name, input);
          this.emit('request', question
            ? { id, method: 'item/tool/requestUserInput', params: { threadId: turn.threadId, turnId: turn.id, questions: questions.map((q, index) => ({ id: String(index), header: q.header, question: q.question, options: q.options })) } }
            : { id, method: shown.type === 'fileChange' ? 'item/fileChange/requestApproval' : 'item/commandExecution/requestApproval', params: { threadId: turn.threadId, turnId: turn.id, reason: title || decisionReason || `Claude wants to use ${name}.`, command: shown.type === 'commandExecution' ? shown.command : shown.type === 'fileChange' ? `Edit ${(shown.changes as { path: string }[])[0].path}` : shown.text } });
        }),
      };
      for await (const message of query({ prompt: text, options }) as AsyncIterable<SDKMessage>) {
        if (!thread.started && 'session_id' in message && message.session_id) { thread.started = true; this.threads.set(turn.threadId, { ...thread, started: true }); }
        this.translate(turn, thread, message, tools, texts, value => { error = value; });
      }
      this.finish(turn, abort.signal.aborted ? 'interrupted' : error ? 'failed' : 'completed', error ? explain(error) : undefined);
    } catch (e) {
      this.finish(turn, abort.signal.aborted ? 'interrupted' : 'failed', abort.signal.aborted ? undefined : explain(e instanceof Error ? e.message : String(e)));
    }
  }
  private translate(turn: Turn, thread: Thread, message: SDKMessage, tools: Map<string, Item>, texts: Map<string, string>, fail: (error: string) => void) {
    if (message.type === 'system' && message.subtype === 'init') {
      if (message.effort && thread.model) this.defaults.set(thread.model, message.effort);
    } else if (message.type === 'stream_event' && !message.parent_tool_use_id) {
      const event = message.event as { type: string; index?: number; message?: { id: string }; delta?: { type: string; text?: string } };
      if (event.type === 'message_start' && event.message) texts.set('current', event.message.id);
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        this.notify('item/agentMessage/delta', { threadId: turn.threadId, turnId: turn.id, itemId: `${texts.get('current')}:${event.index}`, delta: event.delta.text });
      }
    } else if (message.type === 'assistant' && !message.parent_tool_use_id) {
      message.message.content.forEach((block, index) => {
        if (block.type === 'text' && block.text.trim()) this.item(turn, { id: `${message.message.id}:${index}`, type: 'agentMessage', text: block.text });
        else if (block.type === 'tool_use') { const item = toolItem(block.id, block.name, block.input as Record<string, any>); tools.set(block.id, item); this.item(turn, item, false); }
      });
    } else if (message.type === 'user' && !message.parent_tool_use_id && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type !== 'tool_result' || !tools.has(block.tool_use_id)) continue;
        const item = tools.get(block.tool_use_id)!, output = typeof block.content === 'string' ? block.content : (block.content || []).map(part => part.type === 'text' ? part.text : '').join('\n');
        this.item(turn, { ...item, status: block.is_error ? 'failed' : 'completed', ...(item.type === 'commandExecution' ? { aggregatedOutput: output.slice(-40000) } : {}) });
      }
    } else if (message.type === 'rate_limit_event') {
      if (message.rate_limit_info.rateLimitType) this.rateLimits.set(message.rate_limit_info.rateLimitType, message.rate_limit_info);
      this.notify('account/rateLimits/updated', {});
    } else if (message.type === 'result' && message.subtype !== 'success') fail(message.errors?.join(' ') || 'Claude stopped with an error.');
    else if (message.type === 'result' && message.is_error) fail(message.result || 'Claude stopped with an error.');
  }
}

// Anthropic answers 403 when a Claude subscription login is used through the
// Agent SDK; say so instead of the bare status.
function explain(error: string) {
  return /403[^\n]*Request not allowed/i.test(error)
    ? `Anthropic refused the request (${error.trim()}). A Claude subscription login cannot be used through the Claude Agent SDK; give Papilot an Anthropic API key (ANTHROPIC_API_KEY) to run Claude.`
    : error;
}

// Antigravity runs as `agy -p` with streamed JSON, one process per turn,
// resuming its conversation by ID. Headless agy cannot ask for permission, so
// it runs in accept-edits mode: it edits files inside the task worktree, and
// anything else that needs approval (shell commands, edits elsewhere) is
// declined by agy itself and reported in the conversation.
export class AntigravityAgent extends Adapter {
  private catalog: { model: string; displayName: string; efforts: string[]; ids: Record<string, string>; isDefault: boolean; defaultEffort: string | null }[] = [];
  private conversations: Record<string, string> = {};
  constructor(private binary = process.env.PAPILOT_AGY_BIN || 'agy', private file = path.join(DATA, 'antigravity-conversations.json'),
    private launch: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess = (command, args, options) => spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })) {
    super();
    try { this.conversations = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* None yet. */ }
  }
  // Some regions need a proxy for Antigravity; PAPILOT_AGY_PROXY applies only to agy.
  private env() {
    const proxy = process.env.PAPILOT_AGY_PROXY;
    return proxy ? { ...process.env, HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy, NO_PROXY: '127.0.0.1,localhost' } : process.env;
  }
  async start() {
    if (this.ready) return;
    const { stdout } = await promisify(execFile)(this.binary, ['models'], { env: this.env(), timeout: 60000 });
    let preferred = '';
    try { preferred = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.gemini/antigravity-cli/settings.json'), 'utf8')).model || ''; } catch { /* No saved choice. */ }
    this.catalog = groupModels(stdout, preferred);
    this.ready = true;
  }
  protected account() { return { account: this.ready ? { type: 'Google account' } : null, requiresOpenaiAuth: false }; }
  protected models() {
    return { data: this.catalog.map(model => ({ model: model.model, displayName: model.displayName, isDefault: model.isDefault, supportedReasoningEfforts: model.efforts.map(effort => ({ reasoningEffort: effort })), defaultReasoningEffort: model.defaultEffort })) };
  }
  protected run(turn: Turn, thread: Thread, text: string, effort: string | null) {
    const conversation = this.conversations[turn.threadId], entry = this.catalog.find(model => model.model === thread.model);
    const model = entry ? entry.ids[effort || entry.defaultEffort || ''] || Object.values(entry.ids)[0] : thread.model;
    // agy has no separate system prompt: the first turn carries Papilot's instructions.
    const prompt = conversation ? text : `${thread.instructions}\n\n---\n\n${text}`;
    const child = this.launch(this.binary, ['-p', prompt, '--output-format', 'stream-json', '--mode', 'accept-edits', ...(model ? ['--model', model] : []), ...(conversation ? ['--conversation', conversation] : [])], { cwd: thread.cwd, env: this.env() });
    let stopped = false, result: { status?: string; error?: string; denied_actions?: { display_name?: string; action?: string }[] } | null = null, stderr = '';
    turn.stop = () => { stopped = true; child.kill('SIGINT'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); };
    const texts = new Map<number, string>();
    createInterface({ input: child.stdout! }).on('line', line => {
      let event: any;
      try { event = JSON.parse(line); } catch { if (line.trim()) stderr = (stderr + '\n' + line).slice(-4000); return; }
      if (event.event === 'init' && event.conversation_id && !conversation) { this.conversations[turn.threadId] = event.conversation_id; this.save(); }
      const step = event.step_update;
      if (step?.step_type === 'agent_response') {
        const id = `${turn.id}:${step.step_index}`;
        if (step.text_delta) { texts.set(step.step_index, (texts.get(step.step_index) || '') + step.text_delta); this.notify('item/agentMessage/delta', { threadId: turn.threadId, turnId: turn.id, itemId: id, delta: step.text_delta }); }
        if (step.state === 'DONE' && texts.get(step.step_index)?.trim()) this.item(turn, { id, type: 'agentMessage', text: texts.get(step.step_index)!.trim() });
      } else if (step?.step_type === 'tool' && step.tool_name) {
        const item = toolItem(`${turn.id}:${step.step_index}`, step.tool_name, step.tool_info?.parameters || {});
        if (step.state === 'ACTIVE') this.item(turn, item, false);
        else this.item(turn, { ...item, status: step.state === 'ERROR' ? 'failed' : 'completed', ...(item.type === 'commandExecution' && step.tool_info?.error?.message ? { aggregatedOutput: step.tool_info.error.message } : {}) });
      }
      if (event.event === 'result') result = event.result;
    });
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on('error', error => this.finish(turn, 'failed', error.message));
    child.on('close', () => {
      if (stopped) return this.finish(turn, 'interrupted');
      const denied = (result?.denied_actions || []).map(action => action.display_name || action.action).filter(Boolean);
      if (denied.length) this.item(turn, { id: `${turn.id}:denied`, type: 'agentMessage', text: `Antigravity could not run ${[...new Set(denied)].join(', ')}: in Papilot it works without approval prompts, so it edits files in the task worktree but does not run commands.` });
      if (result?.status === 'SUCCESS') this.finish(turn, 'completed');
      else this.finish(turn, 'failed', result?.error || stderr.trim().split('\n').filter(line => !line.startsWith('{')).slice(-3).join(' ') || 'Antigravity stopped without a result.');
    });
  }
  private save() {
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.conversations)); } catch { /* A later turn starts a new conversation. */ }
  }
}

// `agy models` lists effort variants as separate models ("Gemini 4 Argon (High)");
// group them so effort is chosen like other agents' reasoning effort.
export function groupModels(listing: string, preferred = '') {
  const order = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  const groups = new Map<string, { model: string; displayName: string; efforts: string[]; ids: Record<string, string>; isDefault: boolean; defaultEffort: string | null }>();
  for (const line of listing.split('\n')) {
    const [id, name] = line.split('\t').map(part => part?.trim());
    if (!id || !name || id.includes(' ')) continue;
    const variant = /^(.*) \((Minimal|Low|Medium|High|XHigh|Max)\)$/.exec(name), level = variant?.[2].toLowerCase();
    const base = variant && id.endsWith('-' + level) ? id.slice(0, -level!.length - 1) : id;
    const group = groups.get(base) || { model: base, displayName: variant && id !== base ? variant[1] : name, efforts: [], ids: {}, isDefault: false, defaultEffort: null };
    if (variant && id !== base) { group.efforts.push(level!); group.ids[level!] = id; } else group.ids[''] = id;
    if (name === preferred) { group.isDefault = true; if (variant && id !== base) group.defaultEffort = level!; }
    groups.set(base, group);
  }
  for (const group of groups.values()) {
    group.efforts.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    group.defaultEffort ||= group.efforts.includes('medium') ? 'medium' : group.efforts[0] || null;
  }
  return [...groups.values()];
}
