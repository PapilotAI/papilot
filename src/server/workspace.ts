import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from './store.ts';
import { Codex, RpcResponseError } from './codex.ts';
import { reviewClient, taskRoute, confirmedReviewResponse, type ReviewClient } from './review.ts';
import type { Task, Run, TimelineItem, PendingRequest, RuntimeStatus, Snapshot, PendingReview, AgentModel, Usage } from '../shared.ts';

const execute = promisify(execFile);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
// A Codex model/list entry with the reasoning efforts it supports.
export const agentModel = (m: any): AgentModel => ({
  id: m.model || m.id, name: m.displayName || m.model || m.id, isDefault: Boolean(m.isDefault),
  efforts: (m.supportedReasoningEfforts || []).filter((e: any) => typeof e?.reasoningEffort === 'string').map((e: any) => ({ id: e.reasoningEffort, description: e.description || '' })),
  defaultEffort: typeof m.defaultReasoningEffort === 'string' ? m.defaultReasoningEffort : null,
});
// An account/rateLimits/read response as the usage Papilot shows; null when
// the account reports neither limits nor credits (for example, an API key).
export function accountUsage(response: any): Usage | null {
  const limits = response?.rateLimits;
  if (!limits) return null;
  const windows = [limits.primary, limits.secondary].filter((w: any) => typeof w?.usedPercent === 'number')
    .map((w: any) => ({ usedPercent: Math.min(100, Math.max(0, w.usedPercent)), minutes: typeof w.windowDurationMins === 'number' ? w.windowDurationMins : null, resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : null }));
  const balance = Number(limits.credits?.balance);
  const credits = limits.credits?.hasCredits || limits.credits?.unlimited ? { unlimited: Boolean(limits.credits.unlimited), balance: Number.isFinite(balance) ? balance : null } : null;
  if (!windows.length && !credits) return null;
  return { plan: typeof limits.planType === 'string' ? limits.planType : null, windows, credits, reached: Boolean(limits.rateLimitReachedType) || response.ordinaryUsageAllowed === false };
}
const BUSY = new Set(['running', 'waiting_input', 'building', 'uncertain', 'deleting']);

export class Workspace extends EventEmitter {
  runtime: RuntimeStatus = { connected: false, authenticated: false, account: null, error: null, models: [] };
  requests = new Map<string, PendingRequest & { rpcId: string | number }>();
  private active = new Map<string, Run>();
  private loaded = new Set<string>();
  private preparing = new Set<string>();
  private reviewWrites = new Set<string>();
  private commentWrites = new Map<string, number>();
  private deletions = new Set<string>();
  private publishing = new Set<string>();
  private earlyCompletions = new Map<string, Map<string, any>>();
  private earlyRequests = new Map<string, any[]>();
  private queued = false;
  private closing = false;
  private liveItems = new Map<string, TimelineItem>();
  private flushTimer: NodeJS.Timeout | null = null;
  private connecting: Promise<void> | null = null;
  private usageTimer: NodeJS.Timeout | null = null;
  constructor(public store: Store, public codex = new Codex(), private concurrency = 2, private connectReview = reviewClient) {
    super();
    store.on('change', () => this.emit('change'));
    codex.on('notification', message => void this.notification(message).catch(e => console.error('Codex event:', errorText(e))));
    codex.on('request', message => this.serverRequest(message));
    codex.on('disconnected', e => {
      this.runtime.connected = false; this.runtime.error = errorText(e); this.loaded.clear(); this.requests.clear(); this.earlyCompletions.clear(); this.earlyRequests.clear();
      for (const [taskId, run] of this.active) {
        this.store.saveRun({ ...run, status: 'interrupted', finishedAt: Date.now() });
        this.store.updateTask(taskId, { status: 'interrupted', turnId: null, error: 'Codex disconnected. You can resume the same task.' });
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
        this.runtime.account = account.account?.email || account.account?.type || (this.runtime.authenticated ? 'Local Codex configuration' : null);
        this.runtime.error = this.runtime.authenticated ? null : 'Sign in to Codex on this host, then select Reconnect.';
        try {
          const models = await this.codex.request('model/list', {}, 20000);
          this.runtime.models = (models.data || []).map(agentModel);
        } catch { /* Tasks can still use the account's configured default model. */ }
        await this.readUsage();
      } catch (e) { this.runtime.error = errorText(e); this.runtime.connected = false; }
      this.emit('change'); this.schedule();
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async addProject(input: string, name?: string) {
    const expanded = input.startsWith('~/') ? path.join(process.env.HOME!, input.slice(2)) : input;
    const root = fs.realpathSync(expanded);
    const git = await execute('git', ['-C', root, 'rev-parse', '--show-toplevel']);
    if (fs.realpathSync(git.stdout.trim()) !== root) throw new Error('Select the root directory of the Git repository.');
    await execute('git', ['-C', root, 'rev-parse', '--verify', 'HEAD']);
    const existing = this.store.projectByPath(root); if (existing) return existing;
    const client = await this.connectReview(root);
    await client.get('/api/tasks');
    const project = { id: randomUUID(), name: name?.trim() || path.basename(root), path: root, createdAt: Date.now() };
    this.store.saveProject(project); return project;
  }
  async createTask(input: { projectId: string; title: string; instructions: string; model?: string; effort?: string; id: string }) {
    if (!/^[\w-]{16,64}$/.test(input.id)) throw new Error('Invalid task ID.');
    if (this.store.taskDeleted(input.id)) throw new Error('This task was deleted. Create a new task instead.');
    const existing = this.store.tasks().find(t => t.id === input.id); if (existing) return existing;
    if (this.preparing.has(input.id)) throw new Error('This task is being created. Refresh in a moment.');
    this.preparing.add(input.id);
    try {
      const project = this.store.project(input.projectId), client = await this.connectReview(project.path);
      const name = 'p-' + input.id.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48);
      const info = await client.post('/api/tasks', { name, title: input.title });
      const task: Task = { id: input.id, projectId: project.id, name, title: input.title, instructions: input.instructions,
        worktree: info.worktree, threadId: null, turnId: null, model: input.model || null, effort: input.effort || null, status: 'idle',
        createdAt: Date.now(), updatedAt: Date.now(), feedbackCursor: 0, error: null, review: null };
      this.store.saveTask(task);
      await this.enqueue(task.id, input.instructions, 'initial-' + task.id, false);
      return this.store.task(task.id);
    } finally { this.preparing.delete(input.id); }
  }
  async enqueue(taskId: string, text: string, requestKey: string, includeFeedback = true) {
    const task = this.store.task(taskId);
    if (task.status === 'deleting') throw new Error('This task is being deleted.');
    const existing = this.store.runByKey(requestKey);
    if (existing) { if (existing.taskId !== taskId) throw new Error('This request ID is already in use by another task.'); return existing; }
    if (task.status === 'uncertain') throw new Error('Check the task status before sending more instructions.');
    const pauseVersion = task.pauseVersion || 0;
    if (this.store.runs().some(r => r.taskId === taskId && r.status === 'queued')) throw new Error('This task already has queued instructions. Wait or pause it first.');
    let prompt = text.trim(), cursor = task.feedbackCursor;
    if (includeFeedback) {
      const client = await this.connectReview(this.store.project(task.projectId).path);
      const feedback = await client.get(`${taskRoute(task.name)}/feedback?after=${task.feedbackCursor}`);
      cursor = feedback.cursor;
      if (feedback.feedback?.length || feedback.build_error) prompt += '\n\nPapilot review feedback (bound to the specified review round and source changes):\n' + JSON.stringify(feedback, null, 2);
      if (task.error) prompt += '\n\nLatest task/review error:\n' + task.error + '\nThe latest accepted manuscript is at ' + this.store.project(task.projectId).path + '. You may read it to understand accepted changes, but must only edit your isolated task worktree. Prepare a revised proposal for another review; never write to or accept changes in the manuscript checkout.';
    }
    const run: Run = { id: randomUUID(), taskId, requestKey, prompt, feedbackCursor: cursor, status: 'queued', createdAt: Date.now(), finishedAt: null };
    const saved = this.store.transaction(() => {
      // Feedback loading yields to other requests. Recheck identity, queue, and
      // task status together before committing; none of the earlier reads own a lock.
      const duplicate = this.store.runByKey(requestKey);
      if (duplicate) {
        if (duplicate.taskId !== taskId) throw new Error('This request ID is already in use by another task.');
        return duplicate;
      }
      if (this.store.runs().some(r => r.taskId === taskId && r.status === 'queued')) throw new Error('This task already has queued instructions. Wait or pause it first.');
      const current = this.store.task(taskId);
      if (current.status === 'deleting') throw new Error('This task is being deleted. Your instructions were not queued.');
      if ((current.pauseVersion || 0) !== pauseVersion) throw new Error('The task was paused before these instructions were queued. Your draft has been kept.');
      if (current.status === 'uncertain') throw new Error('Check the task status before sending more instructions.');
      this.store.saveRun(run);
      if (!BUSY.has(current.status)) this.store.updateTask(taskId, { status: 'queued', error: null });
      this.store.saveItem({ id: run.id, taskId, type: 'user', text: text.trim(), createdAt: run.createdAt });
      return run;
    });
    this.schedule();
    if (includeFeedback) void this.refresh(taskId);
    return saved;
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
      if (this.active.has(run.taskId) || this.reviewWrites.has(run.taskId) || this.publishing.has(run.taskId) || BUSY.has(this.store.task(run.taskId).status)) continue;
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
You may run tools in the task worktree to inspect and validate your changes. If a decision requires the user, ask through the available user-input tool or explain it in your final response. Use English for your progress updates, questions, and final summaries unless the user explicitly requests another language. Preserve the manuscript language unless asked to translate it.`;
  }
  private async startRun(run: Run) {
    let task = this.store.task(run.taskId);
    this.earlyCompletions.delete(task.id); this.earlyRequests.delete(task.id);
    this.store.saveRun({ ...run, status: 'running' });
    this.store.updateTask(task.id, { status: 'running', turnId: null, error: null });
    if (!task.threadId || !this.loaded.has(task.threadId)) {
      const options = { cwd: task.worktree, approvalPolicy: 'on-request', sandbox: 'workspace-write', developerInstructions: this.instructions(task), ...(task.model ? { model: task.model } : {}) };
      const result = task.threadId
        ? await this.codex.request('thread/resume', { ...options, threadId: task.threadId, excludeTurns: true })
        : await this.codex.request('thread/start', options);
      if (this.active.get(task.id)?.id !== run.id) return;
      task = this.store.updateTask(task.id, { threadId: result.thread.id, model: result.model || task.model });
      this.loaded.add(result.thread.id);
    }
    this.store.updateTask(task.id, { pendingRunId: run.id });
    let result: any;
    try { result = await this.codex.request('turn/start', { threadId: task.threadId, input: [{ type: 'text', text: run.prompt }], cwd: task.worktree, clientUserMessageId: run.id, ...(task.effort ? { effort: task.effort } : {}) }); }
    catch (error) {
      if (this.active.get(task.id)?.id !== run.id) return;
      if (error instanceof RpcResponseError) throw error;
      this.store.saveRun({ ...run, status: 'uncertain' });
      this.store.updateTask(task.id, { status: 'uncertain', error: 'Codex did not confirm whether this turn started. Select Check status before continuing. ' + errorText(error) });
      return;
    }
    if (this.active.get(task.id)?.id !== run.id) return;
    // A cancelled queued message has not delivered its comments. Advance only
    // after Codex acknowledges starting the turn that contains that feedback.
    if (run.feedbackCursor !== undefined) this.store.updateTask(task.id, { feedbackCursor: Math.max(this.store.task(task.id).feedbackCursor, run.feedbackCursor) });
    this.store.updateTask(task.id, { turnId: result.turn.id, pendingRunId: null });
    const requests = this.earlyRequests.get(task.id) || [];
    const completion = this.earlyCompletions.get(task.id)?.get(result.turn.id);
    this.earlyRequests.delete(task.id); this.earlyCompletions.delete(task.id);
    for (const request of requests) this.serverRequest(request);
    if (completion) await this.notification(completion);
  }
  private failRun(run: Run, error: unknown) {
    if (this.active.get(run.taskId)?.id !== run.id) return;
    this.active.delete(run.taskId);
    this.earlyCompletions.delete(run.taskId); this.earlyRequests.delete(run.taskId);
    this.store.saveRun({ ...run, status: 'failed', finishedAt: Date.now() });
    this.store.updateTask(run.taskId, { status: 'failed', turnId: null, pendingRunId: null, error: errorText(error) });
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
  // Usage is shown on the new-task page. Codex reports changes after turns;
  // read the full snapshot again rather than merging its sparse updates.
  async readUsage() {
    try { this.runtime.usage = accountUsage(await this.codex.request('account/rateLimits/read', { excludeResetCreditDetails: true }, 20000)); }
    catch { this.runtime.usage = null; }
    this.emit('change');
  }
  private async notification(message: any) {
    const p = message.params || {}, method = message.method;
    if (method === 'account/rateLimits/updated') {
      if (this.usageTimer) clearTimeout(this.usageTimer);
      this.usageTimer = setTimeout(() => { this.usageTimer = null; void this.readUsage(); }, 1500);
      return;
    }
    const task = this.store.tasks().find(t => t.threadId === p.threadId);
    if (!task || task.status === 'deleting') return;
    const eventTurn = p.turnId || p.turn?.id;
    if (eventTurn && task.turnId && eventTurn !== task.turnId) return;
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
      const buffered = this.earlyRequests.get(task.id);
      if (buffered) this.earlyRequests.set(task.id, buffered.filter(request => String(request.id) !== String(p.requestId)));
      let removed = false;
      for (const [key, request] of this.requests) if (request.taskId === task.id && String(request.rpcId) === String(p.requestId)) { this.requests.delete(key); removed = true; }
      if (removed && task.status === 'waiting_input' && ![...this.requests.values()].some(r => r.taskId === task.id) && this.active.has(task.id)) this.store.updateTask(task.id, { status: 'running' });
      this.emit('change');
    } else if (method === 'turn/completed') {
      if (!eventTurn || !this.active.has(task.id)) return;
      if (!task.turnId) {
        // Very short turns can finish before the turn/start response arrives.
        const pending = this.earlyCompletions.get(task.id) || new Map<string, any>();
        if (pending.size < 32) pending.set(eventTurn, message);
        this.earlyCompletions.set(task.id, pending);
        return;
      }
      this.flush();
      const run = this.active.get(task.id); if (!run) return;
      this.active.delete(task.id);
      for (const [key, r] of this.requests) if (r.taskId === task.id) this.requests.delete(key);
      const status = p.turn.status === 'completed' ? 'completed' : p.turn.status === 'interrupted' ? 'interrupted' : 'failed';
      this.store.saveRun({ ...run, status, finishedAt: Date.now() });
      this.store.updateTask(task.id, { turnId: null, pendingRunId: null, status: status === 'completed' ? 'building' : status, error: p.turn.error?.message || null });
      this.schedule();
      if (status === 'completed') await this.publish(task.id, true);
    } else if (method === 'error' && !p.willRetry) {
      if (!this.active.has(task.id) || (eventTurn && !task.turnId)) return;
      this.store.updateTask(task.id, { error: p.error?.message || 'Codex encountered an error.' });
    }
  }
  private serverRequest(message: any) {
    const task = this.store.tasks().find(t => t.threadId === message.params?.threadId);
    const allowed = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput'];
    if (!task || !this.active.has(task.id) || !allowed.includes(message.method)) { this.codex.reject(message.id, 'This request is not supported or its turn is no longer active.'); return; }
    if (message.params?.turnId && task.turnId && message.params.turnId !== task.turnId) { this.codex.reject(message.id, 'This turn is no longer active.'); return; }
    if (!task.turnId && message.params?.turnId) {
      const pending = this.earlyRequests.get(task.id) || [];
      if (pending.length < 32) { pending.push(message); this.earlyRequests.set(task.id, pending); }
      else this.codex.reject(message.id, 'Too many pending requests.');
      return;
    }
    const id = randomUUID();
    this.requests.set(id, { id, taskId: task.id, rpcId: message.id, method: message.method, params: message.params, createdAt: Date.now() });
    this.store.updateTask(task.id, { status: 'waiting_input' });
  }
  answer(id: string, input: { decision?: string; answers?: Record<string, string> }) {
    const request = this.requests.get(id); if (!request) throw new Error('This request has ended or the connection has restarted.');
    if (this.store.task(request.taskId).status === 'deleting') throw new Error('This task is being deleted.');
    let response: unknown;
    if (request.method === 'item/tool/requestUserInput') {
      const questions = request.params.questions || [];
      response = { answers: Object.fromEntries(questions.map((q: any) => {
        const answer = input.answers?.[q.id]?.trim(); if (!answer) throw new Error('Answer every question before submitting.');
        return [q.id, { answers: [answer] }];
      })) };
    } else {
      if (!['accept', 'decline', 'cancel'].includes(input.decision || '')) throw new Error('Invalid approval decision.');
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
    if (task.status === 'deleting') throw new Error('This task is being deleted. Retry deletion to finish cleanup.');
    if (task.status === 'building') throw new Error('The PDF is building. Wait for this build to finish.');
    this.store.updateTask(taskId, { pauseVersion: (task.pauseVersion || 0) + 1 });
    for (const run of this.store.runs().filter(r => r.taskId === taskId && r.status === 'queued')) this.store.saveRun({ ...run, status: 'interrupted', finishedAt: Date.now() });
    void this.refresh(taskId);
    if (this.active.has(taskId)) {
      if (!task.turnId) throw new Error('Codex is starting. Try pausing again in a moment.');
      await this.codex.request('turn/interrupt', { threadId: task.threadId, turnId: task.turnId });
    } else if (task.status === 'uncertain') throw new Error('Check the task status before pausing this turn.');
    else this.store.updateTask(taskId, { status: 'interrupted' });
  }
  async reconcile(taskId: string) {
    const task = this.store.task(taskId);
    if (task.status === 'deleting') throw new Error('Retry deletion to confirm this task was removed.');
    if (task.status !== 'uncertain') return task;
    if (task.pendingReview) return this.reconcileReview(task);
    const run = this.active.get(taskId) || this.store.runs().find(r => r.id === task.pendingRunId && r.taskId === taskId);
    if (!run || !task.threadId) throw new Error('The pending turn could not be identified. Reconnect Codex and check again.');
    const { thread } = await this.codex.request('thread/read', { threadId: task.threadId, includeTurns: true }, 20000);
    if (this.store.task(taskId).status !== 'uncertain') return this.store.task(taskId);
    const turn = thread.turns?.find((turn: any) => turn.id === task.turnId || turn.items?.some((item: any) => item.type === 'userMessage' && item.clientId === run.id));
    if (!turn) throw new Error('Codex has not confirmed this turn yet. Check again in a moment.');
    const completion = this.earlyCompletions.get(taskId)?.get(turn.id);
    this.earlyCompletions.delete(taskId);
    this.active.set(taskId, run);
    this.store.updateTask(taskId, { turnId: turn.id, pendingRunId: null, error: null, feedbackCursor: Math.max(task.feedbackCursor, run.feedbackCursor || 0) });
    if (completion) {
      await this.notification(completion);
    } else if (turn.status === 'inProgress' && thread.status?.type !== 'notLoaded') {
      this.store.saveRun({ ...run, status: 'running' });
      this.store.updateTask(taskId, { status: 'running' });
      const requests = this.earlyRequests.get(taskId) || [];
      this.earlyRequests.delete(taskId);
      for (const request of requests) this.serverRequest(request);
    } else {
      await this.notification({ method: 'turn/completed', params: { threadId: task.threadId, turn: turn.status === 'inProgress' ? { ...turn, status: 'interrupted' } : turn } });
    }
    return this.store.task(taskId);
  }
  private async reconcileReview(task: Task) {
    if (this.reviewWrites.has(task.id)) throw new Error('The review action is still being checked. Wait for it to finish.');
    this.reviewWrites.add(task.id);
    try {
      const pending = task.pendingReview!;
      const client = await this.connectReview(this.store.project(task.projectId).path);
      // Replay exactly the original action identity. Decisions are idempotent;
      // undo is bound to its original action ID and cannot undo a different one.
      const response = await fetch(client.url + pending.route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': client.token }, body: JSON.stringify(pending.body), signal: AbortSignal.timeout(120000), redirect: 'error' });
      const value = await response.json() as { error?: string };
      if (!confirmedReviewResponse(response.status, value, task.name)) throw new Error('The review engine could not confirm this action. Check again when it is available.');
      await this.refresh(task.id);
      this.store.updateTask(task.id, { pendingReview: null, status: this.store.runs().some(r => r.taskId === task.id && r.status === 'queued') ? 'queued' : pending.previousStatus, error: response.ok ? null : value.error || 'Check the review result before continuing.' });
      return this.store.task(task.id);
    } finally { this.reviewWrites.delete(task.id); this.schedule(); }
  }
  async reviewWrite<T>(taskId: string, writesFiles: boolean, operation: () => Promise<T>, pending?: Omit<PendingReview, 'previousStatus'>): Promise<T> {
    const task = this.store.task(taskId);
    if (task.status === 'deleting') throw new Error('This task is being deleted.');
    if (!writesFiles) {
      this.commentWrites.set(taskId, (this.commentWrites.get(taskId) || 0) + 1);
      try { return await operation(); }
      finally {
        const remaining = (this.commentWrites.get(taskId) || 1) - 1;
        if (remaining) this.commentWrites.set(taskId, remaining); else this.commentWrites.delete(taskId);
      }
    }
    if (this.active.has(taskId) || this.publishing.has(taskId) || BUSY.has(task.status) || task.status === 'queued') throw new Error('Pause the task before accepting, rejecting, or undoing changes. Wait for any PDF build to finish.');
    if (this.reviewWrites.has(taskId)) throw new Error('A review action is already in progress. Wait for it to finish.');
    this.reviewWrites.add(taskId);
    if (pending) this.store.updateTask(taskId, { pendingReview: { ...pending, previousStatus: task.status } });
    try {
      const result = await operation();
      if (pending) this.store.updateTask(taskId, { pendingReview: null });
      return result;
    } catch (error) {
      if (pending) this.store.updateTask(taskId, { status: 'uncertain', error: 'The review action could not be confirmed. Select Check status before continuing. ' + errorText(error) });
      throw error;
    }
    finally { this.reviewWrites.delete(taskId); this.schedule(); }
  }
  publish(taskId: string, automatic = false): Promise<void> {
    const task = this.store.task(taskId);
    if (task.status === 'deleting') throw new Error('This task is being deleted.');
    if (this.active.has(taskId)) throw new Error('Pause Codex before building a review.');
    if (this.reviewWrites.has(taskId)) throw new Error('Wait for the current review action before building a review.');
    if (this.publishing.has(taskId) || (!automatic && (BUSY.has(task.status) || task.status === 'queued'))) throw new Error('This task is busy. Wait for it to finish or pause it first.');
    this.publishing.add(taskId);
    this.store.updateTask(taskId, { status: 'building', error: null });
    return this.buildReview(task).finally(() => { this.publishing.delete(taskId); this.schedule(); });
  }
  private async buildReview(task: Task) {
    const taskId = task.id;
    try {
      const client = await this.connectReview(this.store.project(task.projectId).path);
      const job = await client.post(`${taskRoute(task.name)}/publish`, {});
      for (;;) {
        if (this.closing) return;
        const current = await client.get(`/api/jobs/${job.job}`);
        const summary = await client.get(taskRoute(task.name));
        this.store.updateTask(taskId, { review: { state: summary.state, round: summary.round, counts: summary.counts, job: current, unsent: this.store.task(taskId).review?.unsent } });
        if (current.status === 'done' || current.status === 'completed' || current.status === 'succeeded') break;
        if (current.status === 'failed') throw new Error([current.error, ...(current.details || [])].filter(Boolean).join('\n') || 'PDF build failed.');
        await delay(1500);
      }
      this.store.updateTask(taskId, { status: this.store.runs().some(r => r.taskId === taskId && r.status === 'queued') ? 'queued' : 'reviewing', error: null });
      await this.refresh(taskId);
    } catch (e) { this.store.updateTask(taskId, { status: 'failed', error: errorText(e) }); }
  }
  async refresh(taskId: string) {
    try {
      const task = this.store.task(taskId);
      if (task.status === 'deleting') return;
      const client = await this.connectReview(this.store.project(task.projectId).path);
      const summary = await client.get(taskRoute(task.name));
      const unsent = await this.unsentComments(client, this.store.task(taskId));
      const current = this.store.task(taskId);
      if (current.status !== 'deleting') this.store.updateTask(taskId, { review: { state: summary.state, round: summary.round, counts: summary.counts, job: current.review?.job, unsent } });
    } catch { /* The task remains visible even if its project is temporarily unavailable. */ }
  }
  // Review comments Codex has not received yet. A queued or in-flight message
  // already carries the feedback up to its own cursor.
  private async unsentComments(client: ReviewClient, task: Task) {
    const after = Math.max(task.feedbackCursor, ...this.store.runs().filter(r => r.taskId === task.id && ['queued', 'running', 'uncertain'].includes(r.status)).map(r => r.feedbackCursor || 0));
    const feedback = await client.get<{ feedback?: { kind?: string }[] }>(`${taskRoute(task.name)}/feedback?after=${after}`);
    return (feedback.feedback || []).filter(item => item.kind === 'comment').length;
  }
  renameTask(taskId: string, title: string) {
    if (this.store.task(taskId).status === 'deleting') throw new Error('This task is being deleted.');
    return this.store.updateTask(taskId, { title });
  }
  async deleteTask(taskId: string): Promise<{ ok: true }> {
    if (this.preparing.has(taskId)) throw new Error('Wait for task creation to finish before deleting it.');
    if (this.deletions.has(taskId)) throw new Error('Deletion is already in progress. Wait for it to finish.');
    const task = this.store.tasks().find(t => t.id === taskId);
    if (!task) return { ok: true };
    if (!['idle', 'interrupted', 'reviewing', 'failed', 'deleting'].includes(task.status)
      || this.active.has(taskId) || this.publishing.has(taskId) || this.reviewWrites.has(taskId) || this.commentWrites.has(taskId)
      || task.pendingReview || this.store.runs().some(run => run.taskId === taskId && run.status === 'queued')) {
      throw new Error('Pause the task and wait for its current work or review action to finish before deleting it. Resolve any uncertain action first.');
    }
    // Persist the reservation before connecting to the engine. A restart or
    // lost response must not let queued instructions reuse a removed worktree.
    this.deletions.add(taskId);
    this.store.updateTask(taskId, { status: 'deleting', pauseVersion: (task.pauseVersion || 0) + 1, error: null });
    try {
      const client = await this.connectReview(this.store.project(task.projectId).path);
      const state = await client.get(`${taskRoute(task.name)}/state`);
      if (!confirmedReviewResponse(200, state, task.name)) throw new Error('The review engine could not confirm this task’s cleanup status.');
      if (!state.closed) {
        const result = await client.post(`${taskRoute(task.name)}/finish`, { force: true });
        if (result?.task !== task.name || result.finished !== true) throw new Error('The review engine did not confirm task deletion.');
      }
      // All file cleanup belongs to the review engine. Drop only Papilot data
      // after an identified closed state or explicit finish acknowledgement.
      for (const [id, item] of this.liveItems) if (item.taskId === taskId) this.liveItems.delete(id);
      for (const [id, request] of this.requests) if (request.taskId === taskId) this.requests.delete(id);
      this.earlyCompletions.delete(taskId); this.earlyRequests.delete(taskId);
      if (task.threadId) this.loaded.delete(task.threadId);
      this.store.deleteTask(taskId);
      return { ok: true };
    } catch (error) {
      this.store.updateTask(taskId, { status: 'deleting', error: 'Deletion has not been confirmed. Retry deletion to finish cleanup. ' + errorText(error) });
      throw error;
    } finally { this.deletions.delete(taskId); this.schedule(); }
  }
  close() { this.closing = true; if (this.usageTimer) clearTimeout(this.usageTimer); this.flush(); this.codex.close(); }
}
