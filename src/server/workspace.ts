import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from './store.ts';
import { Codex } from './codex.ts';
import { reviewClient, taskRoute } from './review.ts';
import type { Task, Run, TimelineItem, PendingRequest, RuntimeStatus, Snapshot } from '../shared.ts';

const execute = promisify(execFile);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const BUSY = new Set(['running', 'waiting_input', 'building']);

export class Workspace extends EventEmitter {
  runtime: RuntimeStatus = { connected: false, authenticated: false, account: null, error: null, models: [] };
  requests = new Map<string, PendingRequest & { rpcId: string | number }>();
  private active = new Map<string, Run>();
  private loaded = new Set<string>();
  private preparing = new Set<string>();
  private queued = false;
  private closing = false;
  private liveItems = new Map<string, TimelineItem>();
  private flushTimer: NodeJS.Timeout | null = null;
  private connecting: Promise<void> | null = null;
  constructor(public store: Store, public codex = new Codex(), private concurrency = 2) {
    super();
    store.on('change', () => this.emit('change'));
    codex.on('notification', message => void this.notification(message).catch(e => console.error('Codex event:', errorText(e))));
    codex.on('request', message => this.serverRequest(message));
    codex.on('disconnected', e => {
      this.runtime.connected = false; this.runtime.error = errorText(e); this.loaded.clear(); this.requests.clear();
      for (const [taskId, run] of this.active) {
        this.store.saveRun({ ...run, status: 'interrupted', finishedAt: Date.now() });
        this.store.updateTask(taskId, { status: 'interrupted', turnId: null, error: 'Codex 连接已断开，可以继续原任务。' });
      }
      this.active.clear(); this.emit('change');
    });
  }
  snapshot(): Snapshot { return { version: '0.1.0', projects: this.store.projects(), tasks: this.store.tasks(), requests: [...this.requests.values()].map(({ rpcId: _, ...r }) => r), runtime: this.runtime }; }
  async connect() {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        await this.codex.start();
        const account = await this.codex.request('account/read', { refreshToken: false });
        this.runtime.connected = true;
        this.runtime.authenticated = Boolean(account.account) || account.requiresOpenaiAuth === false;
        this.runtime.account = account.account?.email || account.account?.type || (this.runtime.authenticated ? '本机 Codex 配置' : null);
        this.runtime.error = this.runtime.authenticated ? null : '请先在 Mac mini 上运行 Codex 登录，再点击重新连接。';
        try {
          const models = await this.codex.request('model/list', {}, 20000);
          this.runtime.models = (models.data || []).map((m: any) => ({ id: m.model || m.id, name: m.displayName || m.model || m.id, isDefault: Boolean(m.isDefault) }));
        } catch { /* Tasks can still use the account's configured default model. */ }
      } catch (e) { this.runtime.error = errorText(e); this.runtime.connected = false; }
      this.emit('change'); this.schedule();
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async addProject(input: string, name?: string) {
    const expanded = input.startsWith('~/') ? path.join(process.env.HOME!, input.slice(2)) : input;
    const root = fs.realpathSync(expanded);
    const git = await execute('git', ['-C', root, 'rev-parse', '--show-toplevel']);
    if (fs.realpathSync(git.stdout.trim()) !== root) throw new Error('请选择 Git 仓库根目录');
    await execute('git', ['-C', root, 'rev-parse', '--verify', 'HEAD']);
    const existing = this.store.projectByPath(root); if (existing) return existing;
    const client = await reviewClient(root);
    await client.get('/api/tasks');
    const project = { id: randomUUID(), name: name?.trim() || path.basename(root), path: root, createdAt: Date.now() };
    this.store.saveProject(project); return project;
  }
  async createTask(input: { projectId: string; title: string; instructions: string; model?: string; id: string }) {
    if (!/^[\w-]{16,64}$/.test(input.id)) throw new Error('任务标识无效');
    const existing = this.store.tasks().find(t => t.id === input.id); if (existing) return existing;
    if (this.preparing.has(input.id)) throw new Error('任务正在创建，请稍后刷新');
    this.preparing.add(input.id);
    try {
      const project = this.store.project(input.projectId), client = await reviewClient(project.path);
      const name = 'p-' + input.id.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48);
      const info = await client.post('/api/tasks', { name, title: input.title });
      const task: Task = { id: input.id, projectId: project.id, name, title: input.title, instructions: input.instructions,
        worktree: info.worktree, threadId: null, turnId: null, model: input.model || null, status: 'idle',
        createdAt: Date.now(), updatedAt: Date.now(), feedbackCursor: 0, error: null, review: null };
      this.store.saveTask(task);
      await this.enqueue(task.id, input.instructions, 'initial-' + task.id, false);
      return this.store.task(task.id);
    } finally { this.preparing.delete(input.id); }
  }
  async enqueue(taskId: string, text: string, requestKey: string, includeFeedback = true) {
    const existing = this.store.runByKey(requestKey);
    if (existing) { if (existing.taskId !== taskId) throw new Error('请求标识已被其他任务使用'); return existing; }
    const task = this.store.task(taskId);
    if (this.store.runs().some(r => r.taskId === taskId && r.status === 'queued')) throw new Error('这个任务已有待执行的指令，请等待或先暂停');
    let prompt = text.trim(), cursor = task.feedbackCursor;
    if (includeFeedback) {
      const client = await reviewClient(this.store.project(task.projectId).path);
      const feedback = await client.get(`${taskRoute(task.name)}/feedback?after=${task.feedbackCursor}`);
      cursor = feedback.cursor;
      if (feedback.feedback?.length || feedback.build_error) prompt += '\n\nPapilot review feedback (bound to the specified review round and source changes):\n' + JSON.stringify(feedback, null, 2);
      if (task.error) prompt += '\n\nLatest task/review error:\n' + task.error + '\nThe latest accepted manuscript is at ' + this.store.project(task.projectId).path + '. You may read it to understand accepted changes, but must only edit your isolated task worktree. Prepare a revised proposal for another review; never write to or accept changes in the manuscript checkout.';
    }
    const run: Run = { id: randomUUID(), taskId, requestKey, prompt, status: 'queued', createdAt: Date.now(), finishedAt: null };
    this.store.transaction(() => {
      this.store.saveRun(run);
      this.store.updateTask(taskId, { feedbackCursor: cursor, ...(!BUSY.has(task.status) ? { status: 'queued' as const, error: null } : {}) });
      this.store.saveItem({ id: run.id, taskId, type: 'user', text: text.trim(), createdAt: run.createdAt });
    });
    this.schedule(); return run;
  }
  private schedule() {
    if (this.queued || this.closing) return;
    this.queued = true;
    setImmediate(() => { this.queued = false; void this.drain(); });
  }
  private async drain() {
    if (!this.codex.ready || !this.runtime.authenticated || this.closing) return;
    for (const run of this.store.runs().filter(r => r.status === 'queued')) {
      if (this.active.size >= this.concurrency) break;
      if (this.active.has(run.taskId) || BUSY.has(this.store.task(run.taskId).status)) continue;
      this.active.set(run.taskId, run);
      void this.startRun(run).catch(e => this.failRun(run, e));
    }
  }
  private instructions(task: Task) {
    return `You are the official Codex agent running inside Papilot, a paper editing and review workspace.
Your task is already created. Your editable working directory is ${task.worktree}.
Original task: ${task.instructions}
Only edit this isolated task worktree. Never edit the manuscript checkout, other task worktrees, or Papilot's own source/state. Never commit, push, stash, or accept/reject/undo review decisions.
Papilot owns the LaTeX review lifecycle: it compiles and publishes automatically AFTER your turn finishes, and delivers review feedback in a new turn. Do not create another review task, invoke publish, or wait on feedback --wait. This application workflow replaces the standalone latex-review skill's publish-and-wait loop. End your turn after completing the requested edits, with a concise summary.
Preserve meaning and mathematical correctness. Read relevant project instructions. Treat reviewer comments as instructions tied to their round, file and changes. Rejected edits must not be reintroduced unless explicitly requested. If there is a conflict with accepted text, explain it and propose a revision for a new review round; never overwrite the accepted manuscript.
You may run tools in the task worktree to inspect and validate your changes. If a decision requires the user, ask through the available user-input tool or explain it in your final response. Use Chinese for your brief progress and final summaries unless the user requests otherwise.`;
  }
  private async startRun(run: Run) {
    let task = this.store.task(run.taskId);
    this.store.saveRun({ ...run, status: 'running' });
    this.store.updateTask(task.id, { status: 'running', error: null });
    if (!task.threadId || !this.loaded.has(task.threadId)) {
      const options = { cwd: task.worktree, approvalPolicy: 'on-request', sandbox: 'workspace-write', developerInstructions: this.instructions(task), ...(task.model ? { model: task.model } : {}) };
      const result = task.threadId
        ? await this.codex.request('thread/resume', { ...options, threadId: task.threadId, excludeTurns: true })
        : await this.codex.request('thread/start', options);
      task = this.store.updateTask(task.id, { threadId: result.thread.id, model: result.model || task.model });
      this.loaded.add(result.thread.id);
    }
    const result = await this.codex.request('turn/start', { threadId: task.threadId, input: [{ type: 'text', text: run.prompt }], cwd: task.worktree, clientUserMessageId: run.id });
    if (this.active.get(task.id)?.id === run.id) this.store.updateTask(task.id, { turnId: result.turn.id });
  }
  private failRun(run: Run, error: unknown) {
    this.active.delete(run.taskId);
    this.store.saveRun({ ...run, status: 'failed', finishedAt: Date.now() });
    this.store.updateTask(run.taskId, { status: 'failed', turnId: null, error: errorText(error) });
    this.schedule();
  }
  private flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer); this.flushTimer = null;
    for (const item of this.liveItems.values()) this.store.saveItem(item);
    this.liveItems.clear();
  }
  private appendDelta(task: Task, params: any, type: string) {
    const id = `${task.id}:${params.turnId}:${params.itemId}`;
    const item = this.liveItems.get(id) || this.store.items(task.id).find(item => item.id === id) || { id, taskId: task.id, type, text: '', createdAt: Date.now() };
    if (type === 'command') item.detail = ((item.detail || '') + (params.delta || '')).slice(-40000);
    else item.text += params.delta || '';
    this.liveItems.set(id, item);
    this.flushTimer ??= setTimeout(() => this.flush(), 350);
  }
  private async notification(message: any) {
    const p = message.params || {}, method = message.method;
    const task = this.store.tasks().find(t => t.threadId === p.threadId);
    if (!task) return;
    if (method === 'item/agentMessage/delta') this.appendDelta(task, p, 'assistant');
    else if (method === 'item/commandExecution/outputDelta') this.appendDelta(task, p, 'command');
    else if ((method === 'item/started' || method === 'item/completed') && p.item) {
      const item = p.item, id = `${task.id}:${p.turnId}:${item.id}`;
      if (['userMessage', 'reasoning'].includes(item.type)) return;
      this.flush();
      const previous = this.store.items(task.id).find(i => i.id === id);
      const entry: TimelineItem = { id, taskId: task.id, createdAt: previous?.createdAt || Date.now(), type: item.type, text: item.text || item.command || '', status: item.status || (method === 'item/completed' ? 'completed' : 'inProgress') };
      if (item.type === 'agentMessage') entry.type = 'assistant';
      if (item.type === 'commandExecution') { entry.type = 'command'; entry.detail = String(item.aggregatedOutput || previous?.detail || '').slice(-40000); }
      if (item.type === 'fileChange') { entry.type = 'files'; entry.text = (item.changes || []).map((change: any) => change.path).join('\n'); }
      if (item.type === 'mcpToolCall') { entry.type = 'tool'; entry.text = `${item.server} / ${item.tool}`; }
      if (entry.text || entry.detail) this.store.saveItem(entry);
    } else if (method === 'serverRequest/resolved') {
      for (const [key, request] of this.requests) if (String(request.rpcId) === String(p.requestId)) this.requests.delete(key);
      if (![...this.requests.values()].some(r => r.taskId === task.id) && this.active.has(task.id)) this.store.updateTask(task.id, { status: 'running' });
      this.emit('change');
    } else if (method === 'turn/completed') {
      this.flush();
      const run = this.active.get(task.id); if (!run) return;
      this.active.delete(task.id);
      for (const [key, r] of this.requests) if (r.taskId === task.id) this.requests.delete(key);
      const status = p.turn.status === 'completed' ? 'completed' : p.turn.status === 'interrupted' ? 'interrupted' : 'failed';
      this.store.saveRun({ ...run, status, finishedAt: Date.now() });
      this.store.updateTask(task.id, { turnId: null, status: status === 'completed' ? 'building' : status, error: p.turn.error?.message || null });
      this.schedule();
      if (status === 'completed') await this.publish(task.id);
    } else if (method === 'error' && !p.willRetry) {
      this.store.updateTask(task.id, { error: p.error?.message || 'Codex 执行遇到错误' });
    }
  }
  private serverRequest(message: any) {
    const task = this.store.tasks().find(t => t.threadId === message.params?.threadId);
    const allowed = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput'];
    if (!task || !allowed.includes(message.method)) { this.codex.reject(message.id, 'This request is not supported by Papilot v0.1. Ask the user in a normal message.'); return; }
    const id = randomUUID();
    this.requests.set(id, { id, taskId: task.id, rpcId: message.id, method: message.method, params: message.params, createdAt: Date.now() });
    this.store.updateTask(task.id, { status: 'waiting_input' });
  }
  answer(id: string, input: { decision?: string; answers?: Record<string, string> }) {
    const request = this.requests.get(id); if (!request) throw new Error('这个请求已结束或连接已经重启');
    let response: unknown;
    if (request.method === 'item/tool/requestUserInput') {
      const questions = request.params.questions || [];
      response = { answers: Object.fromEntries(questions.map((q: any) => {
        const answer = input.answers?.[q.id]?.trim(); if (!answer) throw new Error('请回答所有问题');
        return [q.id, { answers: [answer] }];
      })) };
    } else {
      if (!['accept', 'decline', 'cancel'].includes(input.decision || '')) throw new Error('无效的审批决定');
      response = request.method === 'item/permissions/requestApproval'
        ? { permissions: input.decision === 'accept' ? request.params.permissions : {}, scope: 'turn' }
        : { decision: input.decision };
    }
    this.codex.respond(request.rpcId, response);
    this.requests.delete(id);
    if (![...this.requests.values()].some(r => r.taskId === request.taskId)) this.store.updateTask(request.taskId, { status: 'running' });
  }
  async interrupt(taskId: string) {
    const task = this.store.task(taskId);
    for (const run of this.store.runs().filter(r => r.taskId === taskId && r.status === 'queued')) this.store.saveRun({ ...run, status: 'interrupted', finishedAt: Date.now() });
    if (this.active.has(taskId)) {
      if (!task.turnId) throw new Error('Codex 正在启动，请稍后再次暂停');
      await this.codex.request('turn/interrupt', { threadId: task.threadId, turnId: task.turnId });
    } else if (task.status === 'building') throw new Error('PDF 正在生成，请等待本轮生成结束');
    else this.store.updateTask(taskId, { status: 'interrupted' });
  }
  async publish(taskId: string) {
    const task = this.store.task(taskId);
    if (this.active.has(taskId)) throw new Error('请先暂停 Codex，再生成审阅');
    this.store.updateTask(taskId, { status: 'building', error: null });
    try {
      const client = await reviewClient(this.store.project(task.projectId).path);
      const job = await client.post(`${taskRoute(task.name)}/publish`, {});
      for (;;) {
        if (this.closing) return;
        const current = await client.get(`/api/jobs/${job.job}`);
        const summary = await client.get(taskRoute(task.name));
        this.store.updateTask(taskId, { review: { state: summary.state, round: summary.round, counts: summary.counts, job: current } });
        if (current.status === 'done' || current.status === 'completed' || current.status === 'succeeded') break;
        if (current.status === 'failed') throw new Error([current.error, ...(current.details || [])].filter(Boolean).join('\n') || 'PDF 生成失败');
        await delay(1500);
      }
      this.store.updateTask(taskId, { status: this.store.runs().some(r => r.taskId === taskId && r.status === 'queued') ? 'queued' : 'reviewing', error: null });
    } catch (e) { this.store.updateTask(taskId, { status: 'failed', error: errorText(e) }); }
    this.schedule();
  }
  async refresh(taskId: string) {
    const task = this.store.task(taskId);
    try {
      const client = await reviewClient(this.store.project(task.projectId).path);
      const summary = await client.get(taskRoute(task.name));
      this.store.updateTask(taskId, { review: { state: summary.state, round: summary.round, counts: summary.counts, job: task.review?.job } });
    } catch { /* The task remains visible even if its project is temporarily unavailable. */ }
  }
  close() { this.closing = true; this.flush(); this.codex.close(); }
}
