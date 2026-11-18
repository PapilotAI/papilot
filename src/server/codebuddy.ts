import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnCommand } from '../../bin/agent-paths.mjs';
import type { TaskPermissionOption } from '../shared.ts';
import type { AgentRuntime } from './agents.ts';
import { AcpAgent, ACP_PROFILES, type AcpProfile } from './acp.ts';
import { RpcResponseError } from './codex.ts';

const sameCwd = (left: string, right: string) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

// CodeBuddy's ACP server uses the process working directory, not session/new's
// cwd. Give each task its own process, including after a restart, so concurrent
// papers cannot share a workspace or native session state.
export class SessionAcpAgent extends EventEmitter implements AgentRuntime {
  ready = false;
  get supportsReadOnlyTasks() { return this.profile.readOnly !== false; }
  private starting: Promise<void> | null = null;
  private generation = 0;
  private probe: { client: AcpAgent; cwd: string } | null = null;
  private clients = new Map<AcpAgent, { cwd: string; retiring: boolean }>();
  private sessions = new Map<string, { cwd: string; client: AcpAgent; params: any; running: boolean }>();
  private turns = new Map<string, AcpAgent>();
  private approvals = new Map<string, AcpAgent>();
  private permissions: TaskPermissionOption[] = [];
  private catalog: any = { data: [] };
  private account: any = { account: null, requiresOpenaiAuth: true };

  constructor(private profile: AcpProfile, private binary?: string, private launch: typeof spawnCommand = spawnCommand) { super(); }
  detect() { return new AcpAgent(this.profile, this.binary, this.launch).detect(); }
  permissionOptions() { return this.permissions; }
  async taskPermissionConfig(value: string) {
    if (!this.permissions.some(option => option.value === value)) throw new Error('This agent does not support the selected permissions.');
    return { thread: { taskPermissions: value }, turn: { taskPermissions: value } };
  }

  start(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.discover().finally(() => { this.starting = null; });
    return this.starting;
  }
  private async discover() {
    const generation = this.generation;
    // A failed shutdown or directory removal retains the old probe. Finish
    // releasing it before allocating another disposable workspace or process.
    await this.cleanupProbe();
    if (generation !== this.generation) throw new Error(`${this.profile.name} disconnected.`);
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `papilot-${this.profile.id}-catalog-`));
    const probe = new AcpAgent(this.profile, this.binary, this.launch, cwd);
    this.probe = { client: probe, cwd };
    let catalog: any, account: any, permissions: TaskPermissionOption[];
    try {
      await probe.start();
      catalog = await probe.request('model/list');
      account = await probe.request('account/read');
      permissions = probe.permissionOptions();
    } finally {
      await this.cleanupProbe();
    }
    // Discovery includes releasing its disposable workspace. A cleanup failure
    // must not publish a ready account while start() rejects the connection.
    if (generation !== this.generation) throw new Error(`${this.profile.name} disconnected.`);
    this.catalog = catalog;
    this.account = account;
    this.permissions = permissions!;
    this.ready = true;
  }

  private async cleanupProbe() {
    const probe = this.probe;
    if (!probe) return;
    await probe.client.shutdown();
    // Windows can retain a recently exited process's directory handles for
    // a short time. Node retries EPERM/EBUSY without blocking the server.
    await fs.promises.rm(probe.cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (this.probe === probe) this.probe = null;
  }

  private client(cwd: string) {
    const client = new AcpAgent(this.profile, this.binary, this.launch, cwd);
    this.clients.set(client, { cwd, retiring: false });
    client.on('notification', message => {
      if (this.clients.get(client)?.retiring !== false) return;
      if (message.method === 'turn/completed') {
        this.turns.delete(message.params.turn.id);
        const session = this.sessions.get(message.params.threadId);
        if (session?.client === client) session.running = false;
      }
      if (message.method === 'serverRequest/resolved') this.approvals.delete(String(message.params.requestId));
      this.emit('notification', message);
      // Completed tasks resume from native session storage on the next turn;
      // keeping an idle process per paper would accumulate background runtimes.
      if (message.method === 'turn/completed') this.forget(client, true);
    });
    client.on('request', message => {
      if (this.clients.get(client)?.retiring !== false) return;
      this.approvals.set(String(message.id), client);
      this.emit('request', message);
    });
    // A task process exiting must not disconnect another paper's process. Its
    // pending RPCs already fail and report the affected turn through AcpAgent.
    return client;
  }
  private forget(client: AcpAgent, retain = false) {
    const tracked = this.clients.get(client);
    if (tracked) tracked.retiring = true;
    for (const [id, entry] of this.sessions) if (entry.client === client) {
      if (retain) entry.running = false;
      else this.sessions.delete(id);
    }
    for (const [id, owner] of this.turns) if (owner === client) this.turns.delete(id);
    for (const [id, owner] of this.approvals) if (owner === client) this.approvals.delete(id);
    // A failed start has no session ID yet. Keep its process ownership until
    // exit so a retry in the same worktree cannot bypass cleanup.
    void client.shutdown().then(() => { this.clients.delete(client); }, () => {});
  }

  async request(method: string, params: any = {}): Promise<any> {
    const generation = this.generation;
    const connected = () => {
      if (!this.ready || generation !== this.generation) throw new Error(`${this.profile.name} disconnected. Reconnect to resume.`);
    };
    if (method === 'account/read') return this.account;
    if (method === 'model/list') return this.catalog;
    if (method === 'account/rateLimits/read') throw new Error(`${this.profile.name} does not report usage to Papilot.`);
    if (method === 'thread/start' || method === 'thread/resume') {
      if (params.sandbox === 'read-only' && this.profile.readOnly === false) throw new Error(`${this.profile.name} does not support read-only tasks through ACP. Select another agent for this task.`);
      if (typeof params.cwd !== 'string' || !path.isAbsolute(params.cwd)) throw new Error(`${this.profile.name} needs an absolute task working directory.`);
      connected();
      const cwd = path.resolve(params.cwd), id = method === 'thread/resume' ? String(params.threadId) : null;
      const known = id ? this.sessions.get(id) : undefined;
      if (known && !sameCwd(known.cwd, cwd)) throw new Error(`${this.profile.name} cannot move an active session to another working directory.`);
      if (known?.running) throw new Error('Pause the task before restoring its session.');
      for (const [client, entry] of this.clients) if (entry.retiring && sameCwd(entry.cwd, cwd)) {
        await client.shutdown();
        connected();
        this.clients.delete(client);
      }
      if (known?.client.ready) {
        const result = await known.client.request(method, params);
        connected();
        known.params = { ...known.params, ...params, threadId: result.thread.id };
        return result;
      }
      if (known) {
        await known.client.shutdown();
        connected();
        this.forget(known.client);
      }
      const client = this.client(cwd);
      try {
        if (id && known) client.inheritThread(id, known.client);
        await client.start();
        connected();
        const result = await client.request(method, params);
        connected();
        if (this.sessions.has(result.thread.id)) throw new Error(`${this.profile.name} returned a duplicate session ID.`);
        this.sessions.set(result.thread.id, { cwd, client, params: { ...params, threadId: result.thread.id }, running: false });
        return result;
      } catch (error) {
        this.forget(client);
        // A failed restore may still hold the worktree while its process exits.
        // Keep that worker, not the previously stopped one, so retries and
        // deletion wait for the process that actually needs to release it.
        if (id && !this.sessions.has(id)) this.sessions.set(id, {
          cwd, client, params: { ...known?.params, ...params, threadId: id }, running: false,
        });
        throw error;
      }
    }
    if (method === 'turn/start') {
      try {
        connected();
        let session = this.sessions.get(String(params.threadId));
        if (!session) throw new Error(`Start or resume the ${this.profile.name} task before using it.`);
        if (session.running) throw new Error('This task already has a running turn.');
        // Workspace retains loaded idle threads across reconnects. A worker may
        // also exit independently; restore that session before accepting a turn.
        const selection = { ...(params.model !== undefined ? { model: params.model } : {}),
          ...(params.taskPermissions !== undefined ? { taskPermissions: params.taskPermissions } : {}) };
        if (!session.client.ready) {
          await this.request('thread/resume', { ...session.params, ...selection });
          connected();
          session = this.sessions.get(String(params.threadId))!;
        }
        session.params = { ...session.params, ...selection };
        session.running = true;
        try {
          const result = await session.client.request(method, params);
          this.turns.set(result.turn.id, session.client);
          return result;
        } catch (error) { session.running = false; throw error; }
      } catch (error) {
        // No turn ID or prompt exists yet, so Workspace can safely retry a
        // rejected restore instead of treating it as an uncertain submission.
        throw new RpcResponseError(error instanceof Error ? error.message : String(error));
      }
    }
    const client = method === 'turn/interrupt'
      ? this.turns.get(String(params.turnId))
      : this.sessions.get(String(params.threadId))?.client;
    if (!client) throw new Error(`Start or resume the ${this.profile.name} task before using it.`);
    const result = await client.request(method, params);
    return result;
  }
  respond(id: string | number, result: unknown) {
    const client = this.approvals.get(String(id));
    if (!client) throw new Error('This request has ended.');
    this.approvals.delete(String(id));
    client.respond(id, result);
  }
  reject(id: string | number, message: string) {
    const client = this.approvals.get(String(id));
    this.approvals.delete(String(id));
    client?.reject(id, message);
  }
  async closeThread(threadId: string) {
    const client = this.sessions.get(threadId)?.client;
    if (!client) return;
    const stopped = client.shutdown();
    // A failed shutdown must remain retryable, including after reconnecting.
    this.forget(client, true);
    await stopped;
    this.forget(client);
  }
  async closeWorktree(cwd: string) {
    const directory = path.resolve(cwd);
    const clients = new Set([
      ...[...this.clients].filter(([, entry]) => sameCwd(entry.cwd, directory)).map(([client]) => client),
      ...[...this.sessions.values()].filter(entry => sameCwd(entry.cwd, directory)).map(entry => entry.client),
    ]);
    await Promise.all([...clients].map(client => {
      const stopped = client.shutdown();
      this.forget(client, true);
      return stopped;
    }));
    // Retain every session until all processes release the directory. A failed
    // shutdown must remain attached so deletion can retry safely.
    for (const client of clients) this.forget(client);
  }
  close() {
    this.generation++;
    this.ready = false;
    this.account = { account: null, requiresOpenaiAuth: true };
    this.catalog = { data: [] };
    this.permissions = [];
    this.probe?.client.close();
    // Keep only metadata for threads Workspace may still consider loaded.
    for (const client of [...this.clients.keys()]) this.forget(client, true);
  }
}

export class CodeBuddyAgent extends SessionAcpAgent {
  constructor(binary?: string, launch?: typeof spawnCommand) { super(ACP_PROFILES.codebuddy, binary, launch); }
}
