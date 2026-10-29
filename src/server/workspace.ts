import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from './store.ts';
import { Codex, RpcResponseError } from './codex.ts';
import { AGENT_NAMES, AntigravityAgent, ClaudeAgent, type AgentRuntime } from './agents.ts';
import { reviewClient, taskRoute, confirmedReviewResponse, type ReviewClient } from './review.ts';
import { VERSION } from './paths.ts';
import { findSkill, type SkillFile } from './skills.ts';
import { buildFixPrompt, reviewInstructions, skillPrompt, summarizeFeedback } from '../conversation.ts';
import { commitMessageFrom } from '../commit.ts';
import { commitChanges, conflictMarkers, gitCommit, gitRemote, gitStatus, mergeConflicts, mergeInProgress } from './manuscript.ts';
import type { Task, Run, TimelineItem, PendingRequest, RuntimeStatus, Snapshot, PendingReview, AgentModel, Usage, AgentId, MessageMeta, FeedbackSummary, BuildFailure, Author } from '../shared.ts';

const execute = promisify(execFile);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
// A Codex model/list entry with the reasoning efforts it supports.
export const agentModel = (m: any): AgentModel => ({
  id: m.model || m.id, name: m.displayName || m.model || m.id, isDefault: Boolean(m.isDefault),
  efforts: (m.supportedReasoningEfforts || []).map((e: any) => e?.reasoningEffort).filter((e: unknown) => typeof e === 'string'),
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
// Review builds that fail on the agent's own edits (see the review engine's
// publish.ts), and the request keys of the turns that send them back to it.
const FIXABLE = /^(Some edits are outside the task scope|The revised document could not be compiled)/;
const BUILD_FIX = 'build-fix-';

const AGENTS: AgentId[] = ['codex', 'claude', 'antigravity'];
// The small model an agent offers for short text such as a commit message,
// by the names agents give them (GPT Luna and mini, Claude Haiku, Gemini Flash).
const LIGHT = /\b(?:luna|mini|nano|haiku|flash|lite)\b/i;
export const lightModel = (models: AgentModel[]) => models.find(model => LIGHT.test(model.id) || LIGHT.test(model.name));
// A commit message's agent sees the changes in its prompt and needs no tools.
const commitInstructions = 'You write Git commit messages for the repository of a LaTeX paper. Reply with the commit message only, without a preamble, quotes or a code fence: a subject line in the imperative mood under 72 characters and, only when the change needs more explanation, a blank line and a body of a few short plain sentences. Describe what changed in the paper, such as its wording, sections, equations, figures or references, rather than listing files. Follow the style and language of the recent commit subjects, or write in English when there are none. Everything you need is in the message: do not run commands, read files or edit anything.';
// A merge's agent edits the conflicted files in the manuscript checkout and nothing else.
const mergeInstructions = 'You resolve Git merge conflicts in the repository of a LaTeX paper. Edit only the files listed as conflicted, and in each one remove every conflict marker (<<<<<<<, ||||||| , =======, >>>>>>>) so that the text reads as one coherent version. Keep the changes from both sides wherever they are compatible; where both sides rewrote the same passage, combine their intent, and where they truly contradict each other, prefer the version that is more complete and correct and say so. Keep the LaTeX valid: balanced environments and braces, labels, references and citations. You may read any file to understand the context. Do not edit other files, and do not run Git commands that change the repository, such as add, commit, merge, checkout, reset, restore or stash: the author reviews the result and commits the merge.';
const blankRuntime = (): RuntimeStatus => ({ connected: false, authenticated: false, account: null, error: null, models: [] });

export class Workspace extends EventEmitter {
  // Each task runs on one agent; `runtime` is Codex's status, kept for older clients.
  runtimes: Record<AgentId, RuntimeStatus> = { codex: blankRuntime(), claude: blankRuntime(), antigravity: blankRuntime() };
  runtime = this.runtimes.codex;
  agents: Record<AgentId, AgentRuntime>;
  requests = new Map<string, PendingRequest & { rpcId: string | number; agent: AgentId }>();
  private active = new Map<string, Run>();
  private loaded = new Set<string>();
  private preparing = new Set<string>();
  private reviewWrites = new Set<string>();
  // Papers with a commit in progress: no review write may change their files meanwhile.
  private committing = new Set<string>();
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
  private usageTimers = new Map<AgentId, NodeJS.Timeout>();
  // Commit messages by agent, model and prompt, kept or still being written,
  // so one written ahead for a finished review is there when the dialog opens.
  private messages = new Map<string, Promise<{ message: string; agent: AgentId }>>();
  constructor(public store: Store, public codex: AgentRuntime = new Codex(), private concurrency = 2, private connectReview = reviewClient, others: Partial<Record<AgentId, AgentRuntime>> = {}) {
    super();
    this.agents = { codex, claude: others.claude || new ClaudeAgent(), antigravity: others.antigravity || new AntigravityAgent() };
    store.on('change', () => this.emit('change'));
    for (const id of AGENTS) {
      const agent = this.agents[id];
      agent.on('notification', message => void this.notification(message, id).catch(e => console.error(`${AGENT_NAMES[id]} event:`, errorText(e))));
      agent.on('request', message => this.serverRequest(message, id));
      agent.on('disconnected', e => this.disconnected(id, e));
    }
  }
  private agentOf(task: Task): AgentId { return task.agent && AGENTS.includes(task.agent) ? task.agent : 'codex'; }
  private disconnected(id: AgentId, e: unknown) {
    this.runtimes[id].connected = false; this.runtimes[id].error = errorText(e);
    for (const [key, request] of this.requests) if (request.agent === id) this.requests.delete(key);
    for (const [taskId, run] of this.active) {
      const task = this.store.task(taskId);
      if (this.agentOf(task) !== id) continue;
      if (task.threadId) this.loaded.delete(task.threadId);
      this.earlyCompletions.delete(taskId); this.earlyRequests.delete(taskId); this.active.delete(taskId);
      this.store.saveRun({ ...run, status: 'interrupted', finishedAt: Date.now() });
      this.store.updateTask(taskId, { status: 'interrupted', turnId: null, error: `${AGENT_NAMES[id]} disconnected. You can resume the same task.` });
    }
    if (id === 'codex') this.loaded.clear();
    this.emit('change');
  }
  snapshot(): Snapshot { return { version: VERSION, projects: this.store.projects(), tasks: this.store.tasks(), requests: [...this.requests.values()].map(({ rpcId: _, agent: __, ...r }) => r), runtime: this.runtime, runtimes: this.runtimes }; }
  async connect() {
    if (this.connecting) return this.connecting;
    this.connecting = Promise.all(AGENTS.map(id => this.connectAgent(id))).then(() => { this.emit('change'); this.schedule(); }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  private async connectAgent(id: AgentId) {
    const agent = this.agents[id], runtime = this.runtimes[id], name = AGENT_NAMES[id];
    try {
      await agent.start();
      const account = await agent.request('account/read', { refreshToken: false });
      runtime.connected = true;
      runtime.authenticated = Boolean(account.account) || account.requiresOpenaiAuth === false;
      runtime.account = account.account?.email || account.account?.type || (runtime.authenticated ? `Local ${name} configuration` : null);
      runtime.error = runtime.authenticated ? null : account.reason || `Sign in to ${name} on this host, then select Reconnect.`;
      try {
        const models = await agent.request('model/list', {}, 20000);
        runtime.models = (models.data || []).map(agentModel);
      } catch { /* Tasks can still use the account's configured default model. */ }
      await this.readUsage(id);
    } catch (e) { runtime.error = errorText(e); runtime.connected = false; }
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
  renameProject(projectId: string, name: string) {
    const project = { ...this.store.project(projectId), name };
    this.store.saveProject(project); return project;
  }
  // A task can start from a skill; its instructions are then the author's own words, possibly none.
  async createTask(input: { projectId: string; title: string; instructions: string; skill?: string; agent?: AgentId; model?: string; effort?: string; id: string; author?: Author }) {
    if (!/^[\w-]{16,64}$/.test(input.id)) throw new Error('Invalid task ID.');
    if (this.store.taskDeleted(input.id)) throw new Error('This task was deleted. Create a new task instead.');
    // A retried request returns its task; an ID from another paper is refused.
    const existing = this.store.tasks().find(t => t.id === input.id);
    if (existing) { if (existing.projectId !== input.projectId) throw new Error('Invalid task ID.'); return existing; }
    if (this.preparing.has(input.id)) throw new Error('This task is being created. Refresh in a moment.');
    this.preparing.add(input.id);
    try {
      const project = this.store.project(input.projectId), skill = input.skill ? findSkill(project.path, input.skill) : undefined;
      if (!skill && !input.instructions.trim()) throw new Error('Describe the revision, or choose a skill.');
      const client = await this.connectReview(project.path);
      const name = 'p-' + input.id.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48);
      const info = await client.post('/api/tasks', { name, title: input.title });
      const task: Task = { id: input.id, projectId: project.id, name, title: input.title, instructions: skill ? skillPrompt(skill, input.instructions) : input.instructions,
        worktree: info.worktree, threadId: null, turnId: null, agent: input.agent || 'codex', model: input.model || null, effort: input.effort || null, status: 'idle',
        createdAt: Date.now(), updatedAt: Date.now(), feedbackCursor: 0, error: null, review: null };
      this.store.saveTask(task);
      await this.enqueue(task.id, input.instructions, 'initial-' + task.id, false, { skill, author: input.author });
      return this.store.task(task.id);
    } finally { this.preparing.delete(input.id); }
  }
  // The author's message, a skill run with or without one, the review
  // feedback alone, or a build the agent broke. The chat keeps what happened;
  // the agent gets the prompt.
  async enqueue(taskId: string, text: string, requestKey: string, includeFeedback = true, options: { skill?: SkillFile; feedback?: boolean; build?: BuildFailure; author?: Author } = {}) {
    const task = this.store.task(taskId);
    if (task.status === 'deleting') throw new Error('This task is being deleted.');
    const existing = this.store.runByKey(requestKey);
    if (existing) { if (existing.taskId !== taskId) throw new Error('This request ID is already in use by another task.'); return existing; }
    if (task.status === 'uncertain') throw new Error('Check the task status before sending more instructions.');
    const pauseVersion = task.pauseVersion || 0;
    if (this.store.runs().some(r => r.taskId === taskId && r.status === 'queued')) throw new Error('This task already has queued instructions. Wait or pause it first.');
    let prompt = options.build ? buildFixPrompt(options.build) : options.feedback ? reviewInstructions : options.skill ? skillPrompt(options.skill, text) : text.trim(), cursor = task.feedbackCursor;
    let summary: FeedbackSummary | undefined;
    if (includeFeedback) {
      const client = await this.connectReview(this.store.project(task.projectId).path);
      const feedback = await client.get(`${taskRoute(task.name)}/feedback?after=${task.feedbackCursor}`);
      cursor = feedback.cursor; summary = summarizeFeedback(feedback);
      if (options.feedback && !summary) throw new Error('There is no new review feedback to send.');
      if (feedback.feedback?.length || feedback.build_error) prompt += '\n\nPapilot review feedback (bound to the specified review round and source changes):\n' + JSON.stringify(feedback, null, 2);
      if (task.error) prompt += '\n\nLatest task/review error:\n' + task.error + '\nThe latest accepted manuscript is at ' + this.store.project(task.projectId).path + '. You may read it to understand accepted changes, but must only edit your isolated task worktree. Prepare a revised proposal for another review; never write to or accept changes in the manuscript checkout.';
    }
    const run: Run = { id: randomUUID(), taskId, requestKey, prompt, feedbackCursor: cursor, status: 'queued', createdAt: Date.now(), finishedAt: null };
    const meta: MessageMeta = { ...(options.skill ? { skill: { id: options.skill.id, name: options.skill.name } } : {}), ...(summary ? { feedback: summary } : {}), ...(options.feedback ? { sendsFeedback: true } : {}), ...(options.build ? { build: options.build } : {}), ...(options.author ? { author: options.author } : {}) };
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
      this.store.saveItem({ id: run.id, taskId, type: 'user', text: options.feedback || options.build ? '' : text.trim(), createdAt: run.createdAt, ...(Object.keys(meta).length ? { meta } : {}) });
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
    if (this.closing) return;
    for (const run of this.store.runs().filter(r => r.status === 'queued')) {
      if (this.active.size >= this.concurrency) break;
      const agent = this.agentOf(this.store.task(run.taskId));
      if (!this.agents[agent].ready || !this.runtimes[agent].authenticated) continue;
      if (this.active.has(run.taskId) || this.reviewWrites.has(run.taskId) || this.publishing.has(run.taskId) || BUSY.has(this.store.task(run.taskId).status)) continue;
      this.active.set(run.taskId, run);
      void this.startRun(run).catch(e => this.failRun(run, e));
    }
  }
  // The paths a task's review covers, or none when it covers the whole worktree.
  private async reviewScope(task: Task): Promise<string[]> {
    try {
      const client = await this.connectReview(this.store.project(task.projectId).path);
      const files: string[] = (await client.get(taskRoute(task.name))).scope?.files || [];
      return files.some(file => file === '' || file === '.') ? [] : files;
    } catch { return []; }
  }
  private instructions(task: Task, scope: string[] = []) {
    return `You are ${this.agentOf(task) === 'codex' ? 'the official Codex agent' : AGENT_NAMES[this.agentOf(task)]} running inside Papilot, a paper editing and review workspace.
Your task is already created. Your editable working directory is ${task.worktree}.
Original task: ${task.instructions}
Only edit this isolated task worktree. Never edit the manuscript checkout, other task worktrees, or Papilot's own source/state. Never commit, push, stash, or accept/reject/undo review decisions.
${scope.length ? `The review covers only ${scope.join(', ')} in this worktree, and an edit to any other file stops the PDF build. Leave other files unchanged even when project instructions ask for a matching update; mention that update in your summary instead.\n` : ''}Papilot owns the LaTeX review lifecycle: it compiles and publishes automatically AFTER your turn finishes, and delivers review feedback in a new turn. Do not create another review task, invoke publish, or wait on feedback --wait. This application workflow replaces the standalone latex-review skill's publish-and-wait loop. End your turn after completing the requested edits, with a concise summary for the author of what you changed and why; do not describe Papilot's review workflow.
Preserve meaning and mathematical correctness. Read relevant project instructions. Treat reviewer comments as instructions tied to their round, file and changes. Rejected edits must not be reintroduced unless explicitly requested. If there is a conflict with accepted text, explain it and propose a revision for a new review round; never overwrite the accepted manuscript.
${this.agentOf(task) === 'antigravity' ? 'Shell commands are not available to you here and any attempt is refused, which ends your turn: read, search and edit files in the task worktree with your file tools only.' : 'You may run tools in the task worktree to inspect and validate your changes.'} If a decision requires the user, ask through the available user-input tool or explain it in your final response. Use English for your progress updates, questions, and final summaries unless the user explicitly requests another language. Preserve the manuscript language unless asked to translate it.`;
  }
  private async startRun(run: Run) {
    let task = this.store.task(run.taskId);
    const agent = this.agents[this.agentOf(task)], name = AGENT_NAMES[this.agentOf(task)];
    this.earlyCompletions.delete(task.id); this.earlyRequests.delete(task.id);
    this.store.saveRun({ ...run, status: 'running' });
    this.store.updateTask(task.id, { status: 'running', turnId: null, error: null });
    if (!task.threadId || !this.loaded.has(task.threadId)) {
      const options = { cwd: task.worktree, approvalPolicy: 'on-request', sandbox: 'workspace-write', developerInstructions: this.instructions(task, await this.reviewScope(task)), ...(task.model ? { model: task.model } : {}) };
      const result = task.threadId
        ? await agent.request('thread/resume', { ...options, threadId: task.threadId, excludeTurns: true })
        : await agent.request('thread/start', options);
      if (this.active.get(task.id)?.id !== run.id) return;
      task = this.store.updateTask(task.id, { threadId: result.thread.id, model: result.model || task.model });
      this.loaded.add(result.thread.id);
    }
    this.store.updateTask(task.id, { pendingRunId: run.id });
    let result: any;
    try { result = await agent.request('turn/start', { threadId: task.threadId, input: [{ type: 'text', text: run.prompt }], cwd: task.worktree, clientUserMessageId: run.id, ...(task.effort ? { effort: task.effort } : {}) }); }
    catch (error) {
      if (this.active.get(task.id)?.id !== run.id) return;
      if (error instanceof RpcResponseError) throw error;
      this.store.saveRun({ ...run, status: 'uncertain' });
      this.store.updateTask(task.id, { status: 'uncertain', error: `${name} did not confirm whether this turn started. Select Check status before continuing. ` + errorText(error) });
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
    for (const request of requests) this.serverRequest(request, this.agentOf(task));
    if (completion) await this.notification(completion, this.agentOf(task));
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
  // Usage is shown on the new-task page. Agents report changes after turns;
  // read the full snapshot again rather than merging their sparse updates.
  async readUsage(id: AgentId = 'codex') {
    try { this.runtimes[id].usage = accountUsage(await this.agents[id].request('account/rateLimits/read', { excludeResetCreditDetails: true }, 20000)); }
    catch { this.runtimes[id].usage = null; }
    this.emit('change');
  }
  private async notification(message: any, agent: AgentId = 'codex') {
    const p = message.params || {}, method = message.method;
    if (method === 'account/rateLimits/updated') {
      clearTimeout(this.usageTimers.get(agent));
      this.usageTimers.set(agent, setTimeout(() => { this.usageTimers.delete(agent); void this.readUsage(agent); }, 1500));
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
      if (item.type === 'toolCall') entry.type = 'tool';
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
      if (status === 'completed') await this.publish(task.id, run);
    } else if (method === 'error' && !p.willRetry) {
      if (!this.active.has(task.id) || (eventTurn && !task.turnId)) return;
      this.store.updateTask(task.id, { error: p.error?.message || `${AGENT_NAMES[agent]} encountered an error.` });
    }
  }
  private serverRequest(message: any, agent: AgentId = 'codex') {
    const task = this.store.tasks().find(t => t.threadId === message.params?.threadId), runtime = this.agents[agent];
    const allowed = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput'];
    if (!task || this.agentOf(task) !== agent || !this.active.has(task.id) || !allowed.includes(message.method)) { runtime.reject(message.id, 'This request is not supported or its turn is no longer active.'); return; }
    if (message.params?.turnId && task.turnId && message.params.turnId !== task.turnId) { runtime.reject(message.id, 'This turn is no longer active.'); return; }
    if (!task.turnId && message.params?.turnId) {
      const pending = this.earlyRequests.get(task.id) || [];
      if (pending.length < 32) { pending.push(message); this.earlyRequests.set(task.id, pending); }
      else runtime.reject(message.id, 'Too many pending requests.');
      return;
    }
    const id = randomUUID();
    this.requests.set(id, { id, taskId: task.id, rpcId: message.id, agent, method: message.method, params: message.params, createdAt: Date.now() });
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
    this.agents[request.agent].respond(request.rpcId, response);
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
      if (!task.turnId) throw new Error(`${AGENT_NAMES[this.agentOf(task)]} is starting. Try pausing again in a moment.`);
      await this.agents[this.agentOf(task)].request('turn/interrupt', { threadId: task.threadId, turnId: task.turnId });
    } else if (task.status === 'uncertain') throw new Error('Check the task status before pausing this turn.');
    else this.store.updateTask(taskId, { status: 'interrupted' });
  }
  async reconcile(taskId: string) {
    const task = this.store.task(taskId);
    if (task.status === 'deleting') throw new Error('Retry deletion to confirm this task was removed.');
    if (task.status !== 'uncertain') return task;
    if (task.pendingReview) return this.reconcileReview(task);
    const run = this.active.get(taskId) || this.store.runs().find(r => r.id === task.pendingRunId && r.taskId === taskId);
    const name = AGENT_NAMES[this.agentOf(task)];
    if (!run || !task.threadId) throw new Error(`The pending turn could not be identified. Reconnect ${name} and check again.`);
    const { thread } = await this.agents[this.agentOf(task)].request('thread/read', { threadId: task.threadId, includeTurns: true }, 20000);
    if (this.store.task(taskId).status !== 'uncertain') return this.store.task(taskId);
    const turn = thread.turns?.find((turn: any) => turn.id === task.turnId || turn.items?.some((item: any) => item.type === 'userMessage' && item.clientId === run.id));
    if (!turn) throw new Error(`${name} has not confirmed this turn yet. Check again in a moment.`);
    const completion = this.earlyCompletions.get(taskId)?.get(turn.id);
    this.earlyCompletions.delete(taskId);
    this.active.set(taskId, run);
    this.store.updateTask(taskId, { turnId: turn.id, pendingRunId: null, error: null, feedbackCursor: Math.max(task.feedbackCursor, run.feedbackCursor || 0) });
    if (completion) {
      await this.notification(completion, this.agentOf(task));
    } else if (turn.status === 'inProgress' && thread.status?.type !== 'notLoaded') {
      this.store.saveRun({ ...run, status: 'running' });
      this.store.updateTask(taskId, { status: 'running' });
      const requests = this.earlyRequests.get(taskId) || [];
      this.earlyRequests.delete(taskId);
      for (const request of requests) this.serverRequest(request, this.agentOf(task));
    } else {
      await this.notification({ method: 'turn/completed', params: { threadId: task.threadId, turn: turn.status === 'inProgress' ? { ...turn, status: 'interrupted' } : turn } }, this.agentOf(task));
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
    if (this.committing.has(task.projectId)) throw new Error('A commit is in progress. Try again when it finishes.');
    if (mergeInProgress(this.store.project(task.projectId).path)) throw new Error('Finish or abort the merge in the Git panel before accepting, rejecting, or undoing changes.');
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
  // A build is automatic after the agent's run `after` completes. When its
  // edits break the build, the agent gets the error in a new turn, once.
  publish(taskId: string, after?: Run): Promise<void> {
    const task = this.store.task(taskId), automatic = Boolean(after);
    if (task.status === 'deleting') throw new Error('This task is being deleted.');
    if (this.active.has(taskId)) throw new Error('Pause Codex before building a review.');
    if (this.reviewWrites.has(taskId)) throw new Error('Wait for the current review action before building a review.');
    if (this.publishing.has(taskId) || (!automatic && (BUSY.has(task.status) || task.status === 'queued'))) throw new Error('This task is busy. Wait for it to finish or pause it first.');
    this.publishing.add(taskId);
    this.store.updateTask(taskId, { status: 'building', error: null });
    return this.buildReview(task, Boolean(after && !after.requestKey.startsWith(BUILD_FIX))).finally(() => { this.publishing.delete(taskId); this.schedule(); });
  }
  private async buildReview(task: Task, sendBack: boolean) {
    const taskId = task.id;
    try {
      const client = await this.connectReview(this.store.project(task.projectId).path);
      const job = await client.post(`${taskRoute(task.name)}/publish`, {});
      for (;;) {
        if (this.closing) return;
        const current = await client.get(`/api/jobs/${job.job}`);
        const summary = await client.get(taskRoute(task.name));
        this.store.updateTask(taskId, { review: { ...this.store.task(taskId).review, state: summary.state, round: summary.round, counts: summary.counts, job: current } });
        if (current.status === 'done' || current.status === 'completed' || current.status === 'succeeded') break;
        if (current.status === 'failed') {
          const failure: BuildFailure = { error: current.error || 'PDF build failed.', details: current.details || [], ...(current.log ? { log: current.log } : {}) };
          // Instructions the author queued meanwhile go first; the build after them sends any error that remains.
          if (sendBack && FIXABLE.test(failure.error) && await this.enqueue(taskId, '', BUILD_FIX + job.job, false, { build: failure }).then(() => true, () => false)) {
            this.store.updateTask(taskId, { status: 'queued', error: null });
            return;
          }
          throw new Error([failure.error, ...failure.details].join('\n'));
        }
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
      const project = this.store.project(task.projectId), client = await this.connectReview(project.path);
      const summary = await client.get(taskRoute(task.name));
      const { unsent, comments } = await this.unsentReviewFeedback(client, this.store.task(taskId));
      const files = await acceptedFiles(project.path, task.name, task.committed?.accepted);
      const current = this.store.task(taskId);
      if (current.status !== 'deleting') this.store.updateTask(taskId, { review: { state: summary.state, round: summary.round, counts: summary.counts, job: current.review?.job, unsent, comments, files } });
    } catch { /* The task remains visible even if its project is temporarily unavailable. */ }
  }
  // Review decisions, comments and undo updates the agent has not received yet.
  // The engine excludes decisions undone before delivery. A queued or in-flight message
  // already carries the feedback up to its own cursor. Comments and notes ask for a revision.
  private async unsentReviewFeedback(client: ReviewClient, task: Task) {
    const after = Math.max(task.feedbackCursor, ...this.store.runs().filter(r => r.taskId === task.id && ['queued', 'running', 'uncertain'].includes(r.status)).map(r => r.feedbackCursor || 0));
    const feedback = await client.get<{ feedback?: { kind?: string }[] }>(`${taskRoute(task.name)}/feedback?after=${after}`);
    const items = feedback.feedback || [];
    return { unsent: items.length, comments: items.filter(item => item.kind === 'comment' || item.kind === 'note').length };
  }
  // The agent that writes a commit message or resolves a merge: the one the
  // author chose, or else the first that is signed in, with the chosen model
  // or the default one; light asks for the agent's small model when it has one.
  private helper(choice: { agent?: AgentId; model?: string }, task: string, light = false) {
    const usable = (id: AgentId) => this.agents[id].ready && this.runtimes[id].authenticated;
    const id = choice.agent && usable(choice.agent) ? choice.agent : AGENTS.find(usable);
    if (!id) throw new Error(`Sign in to Codex, Claude or Antigravity to ${task}.`);
    const models = this.runtimes[id].models;
    return { id, model: (light ? lightModel(models) : undefined) || models.find(item => item.id === choice.model) || models.find(item => item.isDefault) };
  }
  // One turn on a thread the agent does not keep, outside any task: its
  // reply is returned and no chat shows it.
  private async oneOff(id: AgentId, options: { cwd: string; sandbox: 'read-only' | 'workspace-write'; instructions: string; prompt: string; model?: AgentModel; effort?: string | null; timeout: number; what: string }) {
    const agent = this.agents[id], name = AGENT_NAMES[id];
    const thread = await agent.request('thread/start', { cwd: options.cwd, approvalPolicy: 'never', sandbox: options.sandbox, ephemeral: true, developerInstructions: options.instructions, ...(options.model ? { model: options.model.id } : {}) });
    const threadId = thread.thread.id;
    return new Promise<string>((resolve, reject) => {
      let text = '', turnId = '';
      const listen = (message: any) => {
        const p = message.params || {};
        if (p.threadId !== threadId) return;
        if (message.method === 'item/completed' && p.item?.type === 'agentMessage') text = p.item.text || text;
        else if (message.method === 'turn/completed') finish(p.turn?.status === 'completed' ? null : new Error(p.turn?.error?.message || `${name} stopped before it could ${options.what}.`));
      };
      const timer = setTimeout(() => {
        if (turnId) agent.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
        finish(new Error(`${name} did not ${options.what} in time. Try again.`));
      }, options.timeout);
      const finish = (error: Error | null) => { clearTimeout(timer); agent.off('notification', listen); if (error) reject(error); else resolve(text); };
      agent.on('notification', listen);
      agent.request('turn/start', { threadId, input: [{ type: 'text', text: options.prompt }], cwd: options.cwd, ...(options.effort ? { effort: options.effort } : {}) })
        .then(result => { turnId = result?.turn?.id || ''; }, error => finish(error instanceof Error ? error : new Error(String(error))));
    });
  }
  // Writes a commit message for the chosen manuscript files, like Cursor's
  // generate button: one read-only turn on the agent's small model, with the
  // lightest reasoning it offers. The same changes get the message already
  // written, or being written, for them unless the author asks for a fresh one.
  async commitMessage(projectId: string, paths: string[], choice: { agent?: AgentId; fresh?: boolean } = {}) {
    const project = this.store.project(projectId), { id, model } = this.helper(choice, 'write a commit message', true);
    const { files, patch, recent } = await commitChanges(project.path, paths);
    const tasks = this.store.tasks().filter(task => task.projectId === projectId && task.review?.files?.some(file => paths.includes(file))).map(task => task.title);
    const prompt = [
      recent.length ? `Recent commit subjects in this repository:\n${recent.map(subject => `- ${subject}`).join('\n')}` : 'This repository has no commits yet.',
      tasks.length ? `Papilot tasks whose accepted changes are in these files:\n${tasks.map(title => `- ${title}`).join('\n')}` : '',
      `Changed files:\n${files.map(file => `${file.status === '?' ? 'A' : file.status} ${file.from ? `${file.from} -> ` : ''}${file.path}`).join('\n')}`,
      `Diff:\n${patch}`,
    ].filter(Boolean).join('\n\n');
    const key = createHash('sha256').update(`${id}\0${model?.id ?? ''}\0${prompt}`).digest('hex'), kept = this.messages.get(key);
    if (kept && !choice.fresh) return kept;
    const written = this.oneOff(id, { cwd: project.path, sandbox: 'read-only', instructions: commitInstructions, prompt, model, effort: model?.efforts[0], timeout: 120000, what: 'write a commit message' }).then(reply => {
      const message = commitMessageFrom(reply);
      if (!message) throw new Error(`${AGENT_NAMES[id]} did not return a commit message. Try again.`);
      return { message, agent: id };
    });
    // Only the latest few messages are kept, and never a failed one.
    this.messages.delete(key); this.messages.set(key, written);
    for (const old of this.messages.keys()) { if (this.messages.size <= 20) break; this.messages.delete(old); }
    written.catch(() => { if (this.messages.get(key) === written) this.messages.delete(key); });
    return written;
  }
  // A finished review offers to commit what it accepted, so after the
  // author's last decision its commit message is written ahead.
  async prepareCommitMessage(taskId: string) {
    try {
      const task = this.store.task(taskId), files = task.review?.files || [];
      if (task.status !== 'reviewing' || task.review?.counts?.pending || !files.length) return;
      const project = this.store.project(task.projectId), git = await gitStatus(project.path);
      const paths = git.merging ? [] : files.filter(file => git.files.some(item => item.path === file));
      if (paths.length) await this.commitMessage(project.id, paths, { agent: this.agentOf(task) });
    } catch { /* The commit dialog writes the message when it opens. */ }
  }
  // Resolves a merge's conflicts in the manuscript checkout itself: the agent
  // edits only the conflicted files, at the model's default reasoning, and
  // leaves committing the merge to the author once they have read the diffs.
  async resolveConflicts(projectId: string, choice: { agent?: AgentId; model?: string } = {}) {
    const project = this.store.project(projectId), { id, model } = this.helper(choice, 'resolve conflicts');
    const { files, branch, upstream, ours, theirs } = await mergeConflicts(project.path);
    if (!files.length) throw new Error('No file has conflict markers left. Commit the merge.');
    const list = (items: string[]) => items.length ? items.map(item => `- ${item}`).join('\n') : '- (none listed)';
    const prompt = [
      `${branch} is being merged with ${upstream} in ${project.path}, and these files have conflicts:\n${list(files)}`,
      `Commits on ${branch} since the two diverged:\n${list(ours)}`,
      `Commits from ${upstream} being merged in:\n${list(theirs)}`,
      'Resolve every conflict in those files, then reply with a short summary for the author: how you resolved each conflict, and any place where you had to choose one side.',
    ].join('\n\n');
    const summary = await this.oneOff(id, { cwd: project.path, sandbox: 'workspace-write', instructions: mergeInstructions, prompt, model, effort: model?.defaultEffort, timeout: 600000, what: 'resolve the conflicts' });
    return { summary: summary.trim(), remaining: files.filter(file => conflictMarkers(project.path, file)), agent: id, git: await gitStatus(project.path) };
  }
  // Commits what the author accepted from this task since its last commit,
  // with the message they confirmed, and pushes it if they asked. Other
  // uncommitted files stay as they are; a file another task also changed is
  // committed as it is on disk.
  async commitTask(taskId: string, message: string, push = false) {
    const task = this.store.task(taskId);
    if (task.status === 'deleting') throw new Error('This task is being deleted.');
    if (task.pendingReview) throw new Error('Wait for the current review action before committing.');
    const project = this.store.project(task.projectId);
    return this.exclusiveCommit(project.id, async () => {
      const accepted = await acceptedCommit(project.path, task.name);
      const files = accepted ? await acceptedFiles(project.path, task.name, this.store.task(taskId).committed?.accepted) : [];
      const paths = (await gitStatus(project.path)).files.filter(file => files.includes(file.path)).map(file => file.path);
      if (!paths.length) throw new Error('This task has no accepted changes left to commit.');
      const hash = await gitCommit(project.path, message, paths);
      this.store.updateTask(taskId, { committed: { hash, accepted: accepted!, at: Date.now() } });
      void this.refresh(taskId);
      // The commit stands even when the push fails; the author can push again.
      let pushError: string | undefined;
      if (push) try { await gitRemote(project.path, 'push'); } catch (error) { pushError = errorText(error); }
      return { commit: hash, git: await gitStatus(project.path), ...(pushError ? { pushError } : {}) };
    });
  }
  // A commit reads the working tree that accepting, rejecting and undoing
  // write, so neither starts while the other runs on the same paper.
  async exclusiveCommit<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    if (this.committing.has(projectId)) throw new Error('A commit is already in progress. Wait for it to finish.');
    if ([...this.reviewWrites].some(id => this.store.task(id).projectId === projectId)) throw new Error('Wait for the current review action before committing.');
    this.committing.add(projectId);
    try { return await work(); } finally { this.committing.delete(projectId); }
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
  close() { this.closing = true; for (const timer of this.usageTimers.values()) clearTimeout(timer); this.flush(); for (const id of AGENTS) this.agents[id].close(); }
}

// The review engine records each task's accepted text as a commit beside the
// one it started from; their difference is what the task put in the
// manuscript, and the difference from the accepted text at the task's last
// commit is what it has added since. A rename counts as both of its paths.
export async function acceptedFiles(root: string, name: string, since?: string) {
  try {
    const { stdout } = await execute('git', ['-C', root, 'diff', '--name-only', '--no-renames', '-z', since || `refs/latex-review/${name}/base`, `refs/latex-review/${name}/accepted`, '--']);
    return stdout.split('\0').filter(Boolean);
  } catch { return []; }
}
export async function acceptedCommit(root: string, name: string) {
  try { return (await execute('git', ['-C', root, 'rev-parse', '--verify', '-q', `refs/latex-review/${name}/accepted^{commit}`])).stdout.trim() || undefined; }
  catch { return undefined; }
}
