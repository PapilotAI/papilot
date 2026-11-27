import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { killTree, spawnCommand } from '../../bin/agent-paths.mjs';
import { zcodeLaunch, zcodeVersion } from '../../bin/zcode-cli.mjs';
import { atomicWrite } from '../../engine/src/core/files.ts';
import type { TaskPermissionOption } from '../shared.ts';
import { Adapter, toolItem, type Item, type Thread, type Turn } from './agents.ts';
import { DATA } from './paths.ts';

const MODES = new Map([['workspace', 'edit'], ['full', 'yolo']]);
const SESSION_ID = /^sess_[\w-]+$/;
const FORCE_KILL_AFTER_MS = 7500;
const PROCESS_EXIT_DEADLINE_MS = 10000;

type Launch = NonNullable<ReturnType<typeof zcodeLaunch>>;
type NativeProcess = { stop: (signal?: NodeJS.Signals) => void; done: Promise<number | null> };

export class ZCodeAgent extends Adapter {
  readonly supportsReadOnlyTasks = false;
  private processes = new Map<string | symbol, NativeProcess>();

  constructor(private data = path.join(DATA, 'zcode'), private env = process.env) { super(); }
  detect() { return Boolean(zcodeLaunch(this.env)); }
  async start() {
    const cli = zcodeLaunch(this.env);
    if (!cli) {
      this.ready = false;
      throw new Error('ZCode CLI was not found. Install it on the Papilot host, then select Reconnect.');
    }
    const stdout = await this.probe(cli).catch(() => '');
    this.ready = Boolean(zcodeVersion(stdout));
    if (!this.ready) throw new Error('ZCode CLI could not be run. Install ZCode CLI 0.18.0 or newer, then select Reconnect.');
  }

  protected account() { return { account: null, requiresOpenaiAuth: false, authenticationUnchecked: true }; }

  permissionOptions(): TaskPermissionOption[] {
    return [
      { value: 'workspace', label: 'Accept edits', detail: 'Automatically approve edits without a command sandbox. Other permission requests are denied in print mode.' },
      { value: 'full', label: 'YOLO', detail: 'Skip approval prompts; native rules still apply' },
    ];
  }

  async request(method: string, params: any = {}) {
    if ((method === 'thread/start' || method === 'thread/resume') && params.sandbox === 'read-only') {
      throw new Error('The selected agent does not support read-only tasks. Select another agent.');
    }
    return super.request(method, params);
  }

  async closeThread(threadId: string) {
    for (const turn of this.turns.values()) if (turn.threadId === threadId && turn.status === 'inProgress') turn.stop();
    const child = this.processes.get(threadId);
    if (child) await this.waitForExit(child.done);
    this.threads.delete(threadId);
  }

  async closeWorktree(cwd: string) {
    await Promise.all([...this.threads].filter(([, thread]) => thread.cwd === cwd).map(([id]) => this.closeThread(id)));
  }

  async close(): Promise<void> {
    super.close();
    await Promise.all([...this.processes.values()].map(child => {
      child.stop();
      return this.waitForExit(child.done);
    }));
  }

  private async waitForExit(done: NativeProcess['done']) {
    let deadline: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([done, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error('ZCode did not exit. Close its process before resuming the task.')), PROCESS_EXIT_DEADLINE_MS);
      })]);
    } finally { clearTimeout(deadline); }
  }

  private async probe(cli: Launch) {
    const { child, stop, done } = this.launch(Symbol(), cli, ['doctor', '--json']);
    let stdout = '';
    child.on('error', () => {});
    child.stdout!.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr!.resume();
    const timeout = setTimeout(() => stop('SIGKILL'), PROCESS_EXIT_DEADLINE_MS);
    try { return await this.waitForExit(done) === 0 ? stdout : ''; }
    finally { clearTimeout(timeout); }
  }

  private launch(id: string | symbol, cli: Launch, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
    const child = spawnCommand(cli.command, [...cli.args, ...args], {
      env: cli.env, ...options, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pid = child.pid;
    let stopping = false;
    let force: NodeJS.Timeout | undefined;
    const killGroup = () => {
      if (!pid) return;
      try { process.kill(-pid, 'SIGKILL'); } catch { /* The process group already exited. */ }
    };
    const stop = (signal: NodeJS.Signals = 'SIGTERM') => {
      if (!pid || (stopping && signal === 'SIGTERM')) return;
      stopping = true;
      killTree(pid, signal);
      if (signal === 'SIGTERM' && process.platform !== 'win32') {
        // ZCode can use six seconds to finish shutting down its detached tools.
        force = setTimeout(killGroup, FORCE_KILL_AFTER_MS).unref();
      }
    };
    const done = new Promise<number | null>(resolve => {
      child.once('close', code => {
        clearTimeout(force);
        // The CLI may exit before its tools. Stop the group before releasing a worktree.
        if (stopping && process.platform !== 'win32') killGroup();
        this.processes.delete(id);
        resolve(code);
      });
    });
    this.processes.set(id, { stop, done });
    return { child, stop, done };
  }

  protected run(turn: Turn, thread: Thread, text: string, _effort: string | null, images: string[]) {
    const cli = zcodeLaunch(this.env);
    if (!cli) throw new Error('ZCode CLI was not found. Install it on the Papilot host, then select Reconnect.');
    const mode = MODES.get(thread.permissions || 'workspace');
    if (!mode) throw new Error('This agent does not support the selected permissions.');
    if (this.processes.has(turn.threadId)) throw new Error('This task already has a running turn.');

    const file = thread.ephemeral ? undefined : path.join(this.data, 'sessions', path.basename(turn.threadId));
    let session = '';
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      try { session = fs.readFileSync(file, 'utf8').trim(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (session && !SESSION_ID.test(session)) throw new Error('ZCode could not restore this task’s session.');
    const prompt = session ? `Papilot task follow-up:\n\n${text}` : `${thread.instructions}\n\nPapilot task request:\n\n${text}`;
    const args = ['--prompt', prompt, '--cwd', thread.cwd, '--mode', mode, '--output-format', 'stream-json', '--no-color'];
    if (session) args.push('--resume', session);
    for (const image of images) args.push('--attach', image);
    const temporary = thread.ephemeral ? fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-zcode-session-')) : undefined;
    // Rollouts and tool artifacts share ZCode's native storage root with its provider configuration.
    const env: NodeJS.ProcessEnv = {
      ...cli.env, ZCODE_SESSION_DB_PATH: path.join(temporary || this.data, 'sessions.db'),
      ...(temporary ? { ZCODE_LOG_DIR: path.join(temporary, 'logs') } : {}),
    };
    // ZCode also accepts the legacy alias, with the last environment entry taking precedence.
    delete env.ZCODE_SESSION_DB;
    const cleanup = () => { if (temporary) fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); };
    let launched: ReturnType<ZCodeAgent['launch']>;
    try { launched = this.launch(turn.threadId, cli, args, { cwd: thread.cwd, env }); }
    catch (error) { cleanup(); throw error; }
    const { child, stop } = launched;
    let stopped = false, failed = false, failure = '', stderr = '', result: { response: string; usage?: Record<string, unknown> } | undefined;
    let model: string | undefined, pendingReply: { id: string; text: string } | undefined, lastReply: typeof pendingReply;
    const tools = new Map<string, Item>();
    const finishReply = () => {
      if (!pendingReply) return;
      this.item(turn, { ...pendingReply, type: 'agentMessage' });
      lastReply = pendingReply;
      pendingReply = undefined;
    };
    turn.stop = () => { stopped = true; stop(); };
    child.once('close', code => {
      turn.stop = () => {};
      try { cleanup(); } catch (error) { failure ||= String(error); }
      if (stopped) { this.finish(turn, 'interrupted'); return; }
      finishReply();
      if (failed || failure || code !== 0 || !result) {
        const detail = failure || stderr.trim();
        if (detail) this.finish(turn, 'failed', detail);
        else this.finish(turn, 'failed', 'ZCode stopped without a result.');
        return;
      }
      const response = result.response.trim();
      if (response && response !== lastReply?.text.trim()) {
        this.item(turn, { id: lastReply?.id || `${turn.id}:reply`, type: 'agentMessage', text: response });
      }
      if (result.usage) {
        const { cacheReadTokens: cached, cacheWriteTokens: cacheWrite, reasoningTokens: reasoning, ...usage } = result.usage;
        this.notify('turn/usage', { threadId: turn.threadId, turnId: turn.id, model, usage: { ...usage, cached, cacheWrite, reasoning } });
      }
      this.finish(turn, 'completed');
    });
    child.once('error', error => { failure = error.message; });
    child.stderr!.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    createInterface({ input: child.stdout! }).on('line', line => {
      if (stopped) return;
      let event: any;
      try { event = JSON.parse(line); } catch { return; }
      if (!SESSION_ID.test(event?.sessionId || '') || (session && session !== event.sessionId)) return;
      if (!session && (event.type === 'turn.started' || event.type === 'result')) {
        try { if (file) atomicWrite(file, event.sessionId, 0o600); session = event.sessionId; }
        catch (error) { failure = String(error); stop(); return; }
      }
      if (!session) return;
      const payload = event.payload || {};
      if (event.type === 'result' && typeof event.response === 'string') result = event;
      if (event.type === 'session.updated' && typeof payload.modelId === 'string') model = payload.modelId;
      if (event.type === 'turn.failed') {
        failed = true;
        if (typeof payload.error?.message === 'string') failure = payload.error.message;
      }
      if (event.type === 'turn.completed') {
        finishReply();
        if (payload.resultType && payload.resultType !== 'success') failed = true;
      }
      if (event.type === 'model.streaming') {
        const id = `${turn.id}:${payload.assistantMessageId || event.turnId || 'text'}`;
        if (payload.kind === 'text_delta' && typeof payload.delta === 'string' && payload.delta) {
          if (pendingReply?.id !== id) { finishReply(); pendingReply = { id, text: '' }; }
          pendingReply!.text += payload.delta;
          this.notify('item/agentMessage/delta', { threadId: turn.threadId, turnId: turn.id, itemId: id, delta: payload.delta });
        } else if (payload.kind === 'finish' && pendingReply?.id === id) finishReply();
      }
      const toolUpdated = event.type === 'tool.updated';
      const denied = event.type === 'permission.resolved' && payload.decision === 'deny';
      if ((toolUpdated || denied) && typeof payload.toolCallId === 'string') {
        const id = `${turn.id}:tool:${payload.toolCallId}`;
        if (toolUpdated && payload.kind === 'scheduled' && typeof payload.toolName === 'string') {
          const item = toolItem(id, payload.toolName, payload.input || {});
          tools.set(id, item);
          this.item(turn, item, false);
        }
        const item = tools.get(id);
        if (item && (denied || payload.kind === 'result' || payload.kind === 'error')) {
          tools.delete(id);
          this.item(turn, { ...item, status: denied || payload.kind === 'error' || payload.result?.isError ? 'failed' : 'completed' });
        }
      }
    });
  }
}
