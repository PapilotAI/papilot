import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Adapter, type Item, type Thread, type Turn } from './agents.ts';
import { imageType } from './attachments.ts';
import { VERSION } from './paths.ts';

interface Choice { value: string; name: string }
interface ConfigOption { id: string; category?: string; currentValue: string; options: (Choice | { options: Choice[] })[] }
interface Session { sessionId: string; configOptions?: ConfigOption[]; modes?: { availableModes: { id: string }[] }; models?: { currentModelId: string; availableModels: { modelId: string; name: string }[] } }
interface LiveTurn { turn: Turn; text: string; message: string; tools: Map<string, any>; received: boolean; stopped: boolean }
const choices = (option?: ConfigOption): Choice[] => (option?.options || []).flatMap(value => 'options' in value ? value.options : [value]);
const setup = 'Install Kimi Code CLI and run kimi login on this host, then select Reconnect. Set PAPILOT_KIMI_BIN if kimi is not on PATH.';

// ACP sessions are the thread IDs persisted by Papilot. Kimi owns credentials
// and conversation storage; the adapter only translates JSON-RPC over stdio.
export class KimiAgent extends Adapter {
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout }>();
  private approvals = new Map<string, { rpcId: string | number; turn: Turn; options: { optionId: string; kind: string; name?: string }[]; question: boolean }>();
  private live = new Map<string, LiveTurn>();
  private sessions = new Map<string, Session>();
  private capabilities: any = {};
  private catalog: any[] = [];
  private defaultModel: string | null = null;
  constructor(private binary = process.env.PAPILOT_KIMI_BIN || 'kimi', private launch: typeof spawn = spawn) { super(); }

  start(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.connect().finally(() => { this.starting = null; });
    return this.starting;
  }
  private async connect() {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-kimi-'));
    try {
      // The probe folder is removed below, so Kimi itself runs from the home folder.
      const child = this.launch(this.binary, ['acp'], { cwd: os.homedir(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      const failed = (error: Error) => { if (this.child === child) this.disconnect(error); };
      createInterface({ input: child.stdout! }).on('line', line => {
        let message: any;
        try { message = JSON.parse(line); } catch { return; }
        if (this.child === child) this.receive(message);
      });
      child.stderr?.resume();
      child.stdin?.on('error', failed);
      child.once('error', failed);
      child.once('close', (code, signal) => failed(new Error(`Kimi exited (${signal || code}). ${setup}`)));
      const init = await this.rpc('initialize', { protocolVersion: 1, clientInfo: { name: 'papilot', version: VERSION }, clientCapabilities: {} });
      if (init.protocolVersion !== 1) throw new Error('Kimi returned an unsupported ACP version. Update Kimi Code CLI.');
      this.capabilities = init.agentCapabilities || {};
      // No generation: a disposable session checks configuration and exposes models.
      const probe: Session = await this.rpc('session/new', { cwd, mcpServers: [] });
      this.catalog = [];
      this.readModels(probe, true);
      const sessionCapabilities = this.capabilities.sessionCapabilities || {};
      if (sessionCapabilities.delete) await this.rpc('session/delete', { sessionId: probe.sessionId });
      else if (sessionCapabilities.close) await this.rpc('session/close', { sessionId: probe.sessionId });
      this.ready = true;
    } catch (error) {
      this.close();
      throw new Error(`Kimi is unavailable: ${error instanceof Error ? error.message : String(error)}. ${setup}`);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }
  protected account() { return { account: this.ready ? { type: 'Local Kimi configuration' } : null, requiresOpenaiAuth: !this.ready }; }
  protected models() { return { data: this.catalog }; }

  async request(method: string, params: any = {}): Promise<any> {
    if (method === 'thread/start' || method === 'thread/resume') {
      const resumed = method === 'thread/resume';
      const session = await this.session(resumed ? String(params.threadId) : null, params.cwd, params.model);
      const known = this.threads.get(session.sessionId);
      this.threads.set(session.sessionId, { cwd: params.cwd, instructions: params.developerInstructions || '', model: params.model || known?.model || null, started: resumed });
      return { thread: { id: session.sessionId }, model: params.model || this.defaultModel };
    }
    return super.request(method, params);
  }
  private async session(id: string | null, cwd: string, model?: string | null): Promise<Session> {
    let session = id ? this.sessions.get(id) : undefined;
    if (!session) {
      if (id && !this.capabilities.loadSession && !this.capabilities.sessionCapabilities?.resume) throw new Error('This Kimi version cannot resume sessions. Update Kimi Code CLI.');
      const result = await this.rpc(id ? this.capabilities.sessionCapabilities?.resume ? 'session/resume' : 'session/load' : 'session/new', { ...(id ? { sessionId: id } : {}), cwd, mcpServers: [] });
      session = { ...result, sessionId: id || result.sessionId };
      if (!session!.sessionId) throw new Error('Kimi did not return a session ID.');
      // Do not inherit an auto-approve mode from the user's global configuration.
      if (!session!.modes?.availableModes.some(mode => mode.id === 'default')) throw new Error('Kimi does not offer manual approvals. Update Kimi Code CLI.');
      await this.rpc('session/set_mode', { sessionId: session!.sessionId, modeId: 'default' });
      this.sessions.set(session!.sessionId, session!);
    }
    if (model) {
      const option = session!.configOptions?.find(option => option.category === 'model' || option.id === 'model');
      if (option) {
        const result = await this.rpc('session/set_config_option', { sessionId: session!.sessionId, configId: option.id, value: model });
        if (result.configOptions) session!.configOptions = result.configOptions;
      } else await this.rpc('session/set_model', { sessionId: session!.sessionId, modelId: model });
    }
    this.readModels(session!);
    return session!;
  }
  private readModels(session: Session, initial = false) {
    const model = session.configOptions?.find(option => option.category === 'model' || option.id === 'model');
    const thinking = session.configOptions?.find(option => option.category === 'thought_level' || option.id === 'thinking');
    const current = model?.currentValue || session.models?.currentModelId || null;
    if (initial) this.defaultModel = current;
    const available = model ? choices(model) : (session.models?.availableModels || []).map(model => ({ value: model.modelId, name: model.name }));
    for (const option of available) {
      const previous = this.catalog.find(entry => entry.model === option.value);
      const entry = { model: option.value, displayName: option.name, isDefault: option.value === this.defaultModel,
        supportedReasoningEfforts: option.value === current ? choices(thinking).map(choice => ({ reasoningEffort: choice.value })) : previous?.supportedReasoningEfforts || [],
        defaultReasoningEffort: option.value === current ? thinking?.currentValue || null : previous?.defaultReasoningEffort || null };
      if (previous) Object.assign(previous, entry); else this.catalog.push(entry);
    }
  }
  protected run(turn: Turn, thread: Thread, text: string, effort: string | null, images: string[]) { void this.execute(turn, thread, text, effort, images); }
  private async execute(turn: Turn, thread: Thread, text: string, effort: string | null, images: string[]) {
    let stopped = false, prompting = false;
    let cancelTimer: NodeJS.Timeout | undefined;
    const live: LiveTurn = { turn, text: '', message: randomUUID(), tools: new Map(), received: false, stopped: false };
    turn.stop = () => {
      stopped = true; live.stopped = true;
      this.clearApprovals(turn);
      if (prompting) {
        this.send({ method: 'session/cancel', params: { sessionId: turn.threadId } });
        // A broken server must not leave paused tasks waiting forever.
        cancelTimer ??= setTimeout(() => this.disconnect(new Error('Kimi did not acknowledge cancellation. Reconnect to resume.')), 5000);
        cancelTimer.unref();
      }
    };
    try {
      const session = await this.session(turn.threadId, thread.cwd, thread.model);
      if (effort) {
        const option = session.configOptions?.find(option => option.category === 'thought_level' || option.id === 'thinking');
        if (!option || !choices(option).some(choice => choice.value === effort)) throw new Error(`Kimi does not support reasoning effort ${effort} for this model.`);
        await this.rpc('session/set_config_option', { sessionId: turn.threadId, configId: option.id, value: effort });
      }
      const prompt: any[] = [{ type: 'text', text: thread.started ? text : `${thread.instructions}\n\n---\n\n${text}` }];
      if (images.length && !this.capabilities.promptCapabilities?.image) throw new Error('This Kimi version does not support image input. Update Kimi Code CLI.');
      for (const file of images) {
        const bytes = await fs.promises.readFile(file), mimeType = imageType(bytes);
        if (!mimeType) throw new Error('This image format is not supported.');
        prompt.push({ type: 'image', data: bytes.toString('base64'), mimeType });
      }
      if (stopped) return this.finish(turn, 'interrupted');
      this.live.set(turn.threadId, live);
      prompting = true;
      // The response arrives at the end of the turn; user approvals can take any amount of time.
      const result = await this.rpc('session/prompt', { sessionId: turn.threadId, prompt }, 0);
      this.threads.set(turn.threadId, { ...thread, started: true });
      this.flush(live);
      if (stopped || result.stopReason === 'cancelled') this.finish(turn, 'interrupted');
      else if (result.stopReason === 'end_turn' && live.received) this.finish(turn, 'completed');
      else if (result.stopReason === 'end_turn') this.finish(turn, 'failed', 'Kimi returned no response. Check the Kimi login and model configuration, then retry.');
      else this.finish(turn, 'failed', `Kimi stopped: ${result.stopReason || 'no stop reason returned'}.`);
    } catch (error) {
      this.flush(live);
      this.finish(turn, stopped ? 'interrupted' : 'failed', stopped ? undefined : error instanceof Error ? error.message : String(error));
    } finally {
      if (cancelTimer) clearTimeout(cancelTimer);
      this.clearApprovals(turn);
      this.live.delete(turn.threadId);
    }
  }
  private flush(live: LiveTurn) {
    if (live.text.trim()) this.item(live.turn, { id: live.message, type: 'agentMessage', text: live.text });
    live.text = ''; live.message = randomUUID();
  }
  private update(params: any) {
    const live = this.live.get(params.sessionId), update = params.update;
    if (!live || !update) return; // Includes history replay while loading a session.
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      if (update.content.text?.trim()) live.received = true;
      live.text += update.content.text;
      this.notify('item/agentMessage/delta', { threadId: live.turn.threadId, turnId: live.turn.id, itemId: live.message, delta: update.content.text });
    } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      live.received = true;
      this.flush(live);
      const tool = { ...live.tools.get(update.toolCallId), ...update };
      live.tools.set(update.toolCallId, tool);
      const paths = (tool.locations || []).map((location: any) => location.path).concat((tool.content || []).filter((part: any) => part.type === 'diff').map((part: any) => part.path));
      const id = `${live.turn.id}:${tool.toolCallId}`;
      const status = tool.status === 'failed' ? 'failed' : tool.status === 'completed' ? 'completed' : 'inProgress';
      const output = (tool.content || []).map((part: any) => part.type === 'content' && part.content?.type === 'text' ? part.content.text : '').join('\n');
      const item: Item = tool.kind === 'execute' ? { id, type: 'commandExecution', command: tool.rawInput?.command || tool.title || 'Kimi command', aggregatedOutput: output.slice(-40000), status }
        : tool.kind === 'edit' && paths.length ? { id, type: 'fileChange', changes: [...new Set(paths)].map(file => ({ path: file })), status }
        : { id, type: 'toolCall', text: tool.title || 'Kimi tool', status };
      this.item(live.turn, item, status !== 'inProgress');
    }
  }
  private receive(message: any) {
    if (!message.method) {
      const wait = this.pending.get(message.id);
      if (!wait) return;
      if (wait.timer) clearTimeout(wait.timer);
      this.pending.delete(message.id);
      if (message.error) wait.reject(new Error(message.error.message || 'Kimi request failed.'));
      else wait.resolve(message.result);
      return;
    }
    if (message.method === 'session/update') { this.update(message.params); return; }
    if (message.id === undefined) return;
    const live = this.live.get(message.params?.sessionId);
    if (message.method !== 'session/request_permission' || !live || live.turn.status !== 'inProgress') {
      this.send({ id: message.id, error: { code: -32601, message: 'This client does not support this request, or the turn has ended.' } }); return;
    }
    if (live.stopped) { this.send({ id: message.id, result: { outcome: { outcome: 'cancelled' } } }); return; }
    const id = randomUUID(), update = message.params.toolCall || {};
    const tool = { ...live.tools.get(update.toolCallId), ...update };
    const file = tool.locations?.[0]?.path || tool.rawInput?.file_path || tool.rawInput?.path;
    const edit = tool.kind === 'edit' || ['Write', 'Edit', 'StrReplaceFile', 'WriteFile'].includes(tool.title);
    const options = message.params.options || [];
    const question = options.filter((option: any) => option.kind === 'allow_once').length > 1;
    this.approvals.set(id, { rpcId: message.id, turn: live.turn, options, question });
    if (question) {
      // An ACP permission answer can only select an option, never carry free text.
      this.emit('request', { id, method: 'item/tool/requestUserInput', params: { threadId: live.turn.threadId, turnId: live.turn.id,
        questions: [{ id: 'choice', question: tool.title || 'Kimi needs your input.', isOther: false, options: options.filter((option: any) => option.kind === 'allow_once').map((option: any) => ({ label: option.name || option.optionId })) }] } });
      return;
    }
    this.emit('request', { id, method: edit ? 'item/fileChange/requestApproval' : 'item/commandExecution/requestApproval',
      params: { threadId: live.turn.threadId, turnId: live.turn.id, reason: tool.title || 'Kimi requests permission.', command: tool.rawInput?.command || (edit && file ? `Edit ${file}` : tool.title || 'Kimi tool') } });
  }
  respond(id: string | number, result: any) {
    const wait = this.approvals.get(String(id));
    if (!wait) throw new Error('This request has ended.');
    const kind = result?.decision === 'accept' ? 'allow_once' : result?.decision === 'decline' ? 'reject_once' : null;
    const answer = result?.answers?.choice?.answers?.[0];
    const option = wait.question
      ? wait.options.find(option => option.kind === 'allow_once' && (option.name || option.optionId) === answer)
      : wait.options.find(option => option.kind === kind);
    this.approvals.delete(String(id));
    this.send({ id: wait.rpcId, result: { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } } });
  }
  reject(id: string | number, _message: string) { if (this.approvals.has(String(id))) this.respond(id, { decision: 'decline' }); }
  private clearApprovals(turn: Turn) {
    for (const [id, wait] of this.approvals) if (wait.turn === turn) {
      this.respond(id, { decision: 'cancel' });
      this.notify('serverRequest/resolved', { threadId: turn.threadId, requestId: id });
    }
  }
  private send(message: Record<string, unknown>) {
    const child = this.child;
    child?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n', error => { if (error && this.child === child) this.disconnect(error); });
  }
  private rpc(method: string, params: unknown, timeout = 20000): Promise<any> {
    if (!this.child) return Promise.reject(new Error('Kimi is not connected.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = timeout ? setTimeout(() => { this.pending.delete(id); reject(new Error(`Kimi request timed out: ${method}.`)); }, timeout) : undefined;
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  private disconnect(error: Error, notify = true) {
    const child = this.child;
    this.child = null; this.ready = false; this.sessions.clear();
    for (const wait of this.pending.values()) { if (wait.timer) clearTimeout(wait.timer); wait.reject(error); }
    this.pending.clear(); this.approvals.clear();
    child?.stdin?.end(); child?.kill('SIGTERM');
    if (child && notify) this.emit('disconnected', error);
  }
  close() { this.disconnect(new Error('Kimi disconnected.'), false); }
}
