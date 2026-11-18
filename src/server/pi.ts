import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { agentPath, execCommand, killTree, spawnCommand } from '../../bin/agent-paths.mjs';
import { piExecutable, PI_MIN_VERSION, supportedPi } from '../../bin/pi-cli.mjs';
import { Adapter, toolItem, type Item, type Thread, type Turn } from './agents.ts';
import { DATA } from './paths.ts';
import { imageType } from './attachments.ts';
import type { TaskPermissions } from '../shared.ts';

type RecordValue = Record<string, any>;
interface Model { provider: string; id: string; name?: string; reasoning?: boolean; thinkingLevelMap?: Record<string, unknown> }
function efforts(model: Model) {
  return model.reasoning ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].filter(level => {
    const mapped = model.thinkingLevelMap?.[level];
    return mapped !== null && (!['xhigh', 'max'].includes(level) || mapped !== undefined);
  }) : [];
}
const modelId = (model?: Model) => model ? `${model.provider}/${model.id}` : '';
const textOf = (content: any) => Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text || '').join('\n') : typeof content === 'string' ? content : '';
interface Options {
  dir?: string;
  find?: () => string | null;
  version?: (binary: string) => Promise<string>;
  launch?: typeof spawnCommand;
}

// Pi's native CLI owns credentials, providers, extensions and tools. Writer
// deliberately uses a different SDK setup and never shares these sessions.
export class PiAgent extends Adapter {
  private binary = '';
  private connecting?: Promise<void>;
  private epoch = 0;
  private catalog: Model[] = [];
  private defaultModel = '';
  private defaultEffort = 'off';
  private processes = new Set<PiRpc>();
  private running = new Map<string, { rpc: PiRpc; turn: Turn; done: Promise<void> }>();
  private waits = new Map<string, { rpc: PiRpc; turn: Turn; request: RecordValue; timer?: NodeJS.Timeout }>();
  private dir: string;
  constructor(private options: Options = {}) { super(); this.dir = options.dir || path.join(DATA, 'pi', 'sessions'); }
  detect() { return Boolean((this.options.find || piExecutable)()); }
  async taskPermissionConfig(value: TaskPermissions) {
    // Pi has no built-in sandbox or approval modes. Extensions can ask through
    // the RPC UI bridge below; never label the host tools as sandboxed edits.
    if (value !== 'workspace') throw new Error('Pi uses its own tool permissions.');
    return { thread: { taskPermissions: value }, turn: { taskPermissions: value } };
  }
  async start() {
    if (!this.connecting) {
      const connecting = this.connect(this.epoch).finally(() => { if (this.connecting === connecting) this.connecting = undefined; });
      this.connecting = connecting;
    }
    return this.connecting;
  }
  private async connect(epoch: number) {
    this.binary = (this.options.find || piExecutable)() || '';
    if (!this.binary) throw new Error('Pi was not found. Install the Pi CLI or set PAPILOT_PI_BIN, then reconnect.');
    const version = await (this.options.version || (binary => execCommand(binary, ['--version'], { timeout: 20000 })))(this.binary);
    if (epoch !== this.epoch) throw new Error('This request has ended.');
    if (!supportedPi(version)) throw new Error(`Pi ${PI_MIN_VERSION} or newer is required. Update the Pi CLI, then reconnect.`);
    const rpc = this.open(['--no-session'], os.homedir());
    try {
      const state = await rpc.request('get_state');
      const result = await rpc.request('get_available_models');
      if (epoch !== this.epoch) throw new Error('This request has ended.');
      this.catalog = result.models || [];
      this.defaultModel = modelId(state.model);
      this.defaultEffort = state.thinkingLevel || 'off';
      this.ready = true;
    } finally { await rpc.close(); }
  }
  protected account() {
    return this.catalog.length ? { account: { type: 'Local Pi configuration' }, requiresOpenaiAuth: false }
      : { account: null, requiresOpenaiAuth: true, reason: 'Pi has no configured model. Run pi on this host and use /login or configure a provider, then reconnect.' };
  }
  protected models() {
    return { data: this.catalog.map(model => ({ model: modelId(model), displayName: model.name || model.id, source: model.provider,
      isDefault: modelId(model) === this.defaultModel,
      supportedReasoningEfforts: efforts(model).map(reasoningEffort => ({ reasoningEffort })),
      defaultReasoningEffort: model.reasoning ? efforts(model).includes(this.defaultEffort) ? this.defaultEffort : efforts(model)[0] : null })) };
  }
  private open(args: string[], cwd: string) {
    const child = (this.options.launch || spawnCommand)(this.binary, ['--mode', 'rpc', ...args], { cwd, env: { ...process.env, PATH: agentPath() }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    const rpc = new PiRpc(child, event => {
      // Extensions may ask during session_start, including the discovery probe.
      if (event.type === 'extension_ui_request' && ['confirm', 'select', 'input', 'editor'].includes(event.method)) rpc.send({ type: 'extension_ui_response', id: event.id, cancelled: true });
    });
    this.processes.add(rpc);
    void rpc.exited.then(() => this.processes.delete(rpc));
    return rpc;
  }
  private sessionFile(id: string) {
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) throw new Error('Invalid Pi thread ID.');
    return path.join(this.dir, `${id}.jsonl`);
  }
  async request(method: string, params: any = {}) {
    if (method === 'thread/resume') {
      const file = this.sessionFile(String(params.threadId));
      if (!params.ephemeral && !fs.existsSync(file)) throw new Error('The Pi session file is missing. Restart this task to begin a new conversation.');
    }
    if (method === 'turn/start' && [...this.turns.values()].some(turn => turn.threadId === String(params.threadId) && turn.status === 'inProgress')) throw new Error('This Pi thread is still running.');
    return super.request(method, params);
  }
  protected run(turn: Turn, thread: Thread, text: string, effort: string | null, images: string[]) {
    void this.execute(turn, thread, text, effort, images).catch(error => this.finish(turn, 'failed', error instanceof Error ? error.message : String(error)));
  }
  private async execute(turn: Turn, thread: Thread, text: string, effort: string | null, images: string[]) {
    const file = this.sessionFile(turn.threadId);
    if (!thread.ephemeral) fs.mkdirSync(this.dir, { recursive: true });
    const args = thread.ephemeral ? ['--no-session'] : ['--session', file];
    if (thread.instructions) args.push('--append-system-prompt', thread.instructions);
    // Helpers already have their context in the prompt and run in disposable
    // folders. Disable tools and extensions for these read-only generations.
    if (thread.readOnly) args.push('--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates');
    const rpc = this.open(args, thread.cwd);
    let resolveDone!: () => void;
    const done = new Promise<void>(resolve => { resolveDone = resolve; });
    this.running.set(turn.threadId, { rpc, turn, done });
    let error: string | undefined, aborted = false, output = false, settled = false, handled = false, started = false;
    let messageId = randomUUID();
    const toolItems = new Map<string, Item>();
    const finish = () => { settled = true; resolveDone(); };
    turn.stop = () => {
      aborted = true;
      // Await the actual process exit before releasing a task worktree.
      void rpc.request('abort').catch(() => {}).finally(() => void rpc.close().then(finish));
    };
    rpc.onFailure = failure => { if (!settled) { error = failure.message; finish(); } };
    rpc.onEvent = event => {
      if (settled) return;
      if (event.type === 'agent_start') started = true;
      if (event.type === 'extension_ui_request') { this.extension(rpc, turn, event); return; }
      if (event.type === 'message_start' && event.message?.role === 'assistant') messageId = randomUUID();
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        this.notify('item/agentMessage/delta', { threadId: turn.threadId, turnId: turn.id, itemId: messageId, delta: event.assistantMessageEvent.delta });
      }
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        const message = event.message, reply = textOf(message.content);
        error = message.stopReason === 'error' ? message.errorMessage || 'Pi could not complete the response.' : undefined;
        aborted ||= message.stopReason === 'aborted';
        if (reply) { output = true; this.item(turn, { id: messageId, type: 'agentMessage', text: reply }); }
      }
      if (event.type === 'tool_execution_start') {
        const input = event.args || {}, name = event.toolName;
        const item = toolItem(String(event.toolCallId), name === 'bash' ? 'Bash' : name === 'write' ? 'Write' : name === 'edit' ? 'Edit' : name, { ...input, file_path: input.path });
        toolItems.set(item.id, item); output = true; this.item(turn, item, false);
      }
      if (event.type === 'tool_execution_end') {
        const item = toolItems.get(String(event.toolCallId));
        if (item) { this.item(turn, { ...item, status: event.isError ? 'failed' : 'completed', aggregatedOutput: textOf(event.result?.content) }); toolItems.delete(item.id); }
      }
      // agent_end can be followed by automatic retries or compaction. Pi's
      // session-level settled event is the only completion boundary we use.
      if (event.type === 'agent_settled') { aborted ||= Boolean(event.aborted); finish(); }
    };
    try {
      await rpc.request('get_state');
      if (aborted || settled) return;
      if (thread.model) {
        const slash = thread.model.indexOf('/');
        if (slash < 1) throw new Error('Choose a Pi provider and model.');
        await rpc.request('set_model', { provider: thread.model.slice(0, slash), modelId: thread.model.slice(slash + 1) });
      }
      await rpc.request('set_thinking_level', { level: effort || this.defaultEffort });
      if (aborted || settled) return;
      const nativeImages = images.map(file => {
        const bytes = fs.readFileSync(file), mimeType = imageType(bytes);
        if (!mimeType) throw new Error('Pi could not read the attached image.');
        return { type: 'image', data: bytes.toString('base64'), mimeType };
      });
      const response = await rpc.request('prompt', { message: text, ...(nativeImages.length ? { images: nativeImages } : {}) }, 0);
      if (response?.disposition === 'handled') {
        handled = true;
        // A command can consume the input and start a model run of its own.
        // Only a handled command with no active work completes immediately.
        const state = await rpc.request('get_state');
        if (!started && !state.isStreaming && !state.isCompacting && !state.pendingMessageCount) finish();
      }
      await done;
    } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    finally {
      settled = true;
      for (const [id, wait] of this.waits) if (wait.rpc === rpc) this.reject(id, 'The turn ended.');
      await rpc.close();
      this.running.delete(turn.threadId);
      resolveDone();
      this.finish(turn, aborted ? 'interrupted' : error || (!output && !handled) ? 'failed' : 'completed', error || (!output && !handled ? 'Pi returned no response.' : undefined));
    }
  }
  private extension(rpc: PiRpc, turn: Turn, request: RecordValue) {
    if (request.method === 'notify') {
      this.item(turn, { id: randomUUID(), type: 'toolCall', text: String(request.message || ''), status: 'completed' });
      return;
    }
    if (!['confirm', 'select', 'input', 'editor'].includes(request.method)) return;
    const id = randomUUID();
    const timer = Number.isFinite(request.timeout) && request.timeout > 0 ? setTimeout(() => {
      this.reject(id, 'The Pi extension request expired.');
      this.notify('serverRequest/resolved', { threadId: turn.threadId, requestId: id });
    }, request.timeout) : undefined;
    this.waits.set(id, { rpc, turn, request, timer });
    const params = { threadId: turn.threadId, turnId: turn.id };
    if (request.method === 'confirm') this.emit('request', { id, method: 'item/commandExecution/requestApproval', params: { ...params, reason: request.message, command: request.title || 'Pi extension' } });
    else this.emit('request', { id, method: 'item/tool/requestUserInput', params: { ...params, questions: [{ id: 'value', header: 'Pi', question: [request.title, request.placeholder, request.prefill].filter(Boolean).join('\n'), ...(request.method === 'select' ? { isOther: false, options: (request.options || []).map((label: string) => ({ label, description: '' })) } : {}) }] } });
  }
  respond(id: string | number, result: any) {
    const wait = this.waits.get(String(id));
    if (!wait) throw new Error('This request has ended.');
    clearTimeout(wait.timer);
    this.waits.delete(String(id));
    const value = result?.answers?.value?.answers?.[0];
    const answer = wait.request.method === 'confirm' ? { confirmed: result?.decision === 'accept' }
      : typeof value === 'string' && (wait.request.method !== 'select' || wait.request.options?.includes(value)) ? { value } : { cancelled: true };
    wait.rpc.send({ type: 'extension_ui_response', id: wait.request.id, ...answer });
    if (result?.decision === 'cancel') wait.turn.stop();
  }
  reject(id: string | number, _message: string) {
    const wait = this.waits.get(String(id));
    if (wait) { clearTimeout(wait.timer); this.waits.delete(String(id)); wait.rpc.send({ type: 'extension_ui_response', id: wait.request.id, cancelled: true }); }
  }
  async closeThread(id: string) {
    // turn/start returns before Adapter schedules run(). Stop that queued turn
    // too, so deletion cannot release a worktree just before Pi starts in it.
    for (const turn of this.turns.values()) if (turn.threadId === id && turn.status === 'inProgress') turn.stop();
    const live = this.running.get(id);
    if (live) { await live.rpc.close(); await live.done; }
    this.threads.delete(id);
  }
  close() { this.epoch++; this.connecting = undefined; this.ready = false; super.close(); for (const rpc of this.processes) void rpc.close(); }
}

// One JSONL transport per invocation. No shell interpolation, model calls
// during discovery, or credential parsing in Papilot.
class PiRpc {
  onEvent: (event: RecordValue) => void;
  onFailure: (error: Error) => void = () => {};
  readonly exited: Promise<void>;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout }>();
  private failure?: Error;
  private closing?: Promise<void>;
  private stderr = '';
  constructor(private child: ChildProcess, event: (event: RecordValue) => void) {
    this.onEvent = event;
    this.exited = new Promise(resolve => {
      child.once('close', (code, signal) => { this.fail(new Error(`Pi exited (${signal || code}). ${this.stderr}`.trim())); resolve(); });
    });
    child.once('error', error => this.fail(error));
    child.stdin!.on('error', error => this.fail(error));
    child.stderr!.setEncoding('utf8').on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-8000); });
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', chunk => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message: RecordValue;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type !== 'response') { this.onEvent(message); continue; }
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.success) pending.resolve(message.data || {}); else pending.reject(new Error(message.error || `Pi rejected ${message.command}.`));
      }
    });
  }
  send(message: RecordValue) {
    if (!this.failure && !this.child.stdin!.destroyed && !this.child.stdin!.writableEnded) this.child.stdin!.write(JSON.stringify(message) + '\n', error => { if (error) this.fail(error); });
  }
  request(type: string, params: RecordValue = {}, timeout = 20000): Promise<any> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = timeout ? setTimeout(() => { this.pending.delete(id); reject(new Error(`Pi timed out: ${type}.`)); }, timeout) : undefined;
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, type, ...params });
    });
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.onFailure(error);
  }
  close() {
    this.closing ||= (async () => {
      // EOF lets Pi finish session writes and OAuth refreshes. Force termination
      // only if shutdown stalls, and do not release a worktree before exit.
      this.child.stdin!.end();
      const timer = setTimeout(() => { if (this.child.pid) killTree(this.child.pid, 'SIGKILL'); else this.child.kill('SIGKILL'); }, 10000);
      try { await this.exited; } finally { clearTimeout(timer); }
    })();
    return this.closing;
  }
}
