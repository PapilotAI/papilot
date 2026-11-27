import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import {
  AGENT_NAMES,
  isCollaborationStrategy,
  type AgentId,
  type CollaborationDispatchEntry,
  type CollaborationResolved,
  type CollaborationRole,
  type CollaborationRoute,
  type CollaborationStrategy,
  type CollaborationWorkerAgent,
  type MessageMeta,
  type NoteSummary,
  type PreparedNoteOptions,
  type RuntimeStatus,
  type TaskPermissionOption,
} from '../shared.ts';
import type { GroupInstructions } from '../note-groups.ts';
import { Adapter, type Thread, type Turn } from './agents.ts';
import { routeDisplayName, routeKey } from './collaboration-auto.ts';
import { captureWorkflowEdits, mergeWorkflowFiles, type WorkflowChange, type WorkflowConflict, type WorkflowEdit } from './collaboration-edits.ts';
import {
  buildRouterPrompt,
  clusterCurrentNotes,
  currentTurnNotes,
  deterministicFallbackPlan,
  extractPaperContext,
  parseRouterPlan,
  type NoteCluster,
} from './collaboration-plan.ts';
import {
  anonymizeCandidates,
  applyPatchesToBase,
  buildJudgePrompt,
  buildPreparedRaceOptions,
  buildPatchWorkerPrompt,
  checkCandidateFidelity,
  deduplicateCandidates,
  deterministicVerdict,
  diffFiles,
  parseJudgeVerdict,
  parsePatchReply,
  type RaceCandidate,
  type RaceVerdict,
} from './collaboration-race.ts';
import { runWorkflowHelper, type WorkflowActivity, type WorkflowStep } from './collaboration.ts';

export interface CollaborationTurnContext {
  taskId: string;
  runId: string;
  worktree: string;
  notes: NoteSummary[];
  groupInstructions?: GroupInstructions;
  request: string;
  history: string;
  memory: string;
  resolved: CollaborationResolved;
  runtimes: Partial<Record<AgentId, RuntimeStatus>>;
  readOnlyAgents: Partial<Record<CollaborationWorkerAgent, boolean>>;
}

export type CollaborationHelperCall = (
  worker: CollaborationRoute,
  prompt: string,
  signal: AbortSignal,
  edit?: WorkflowEdit,
  step?: (step: WorkflowStep) => void,
  activity?: WorkflowActivity,
  options?: { images?: string[]; fullWorkspace?: boolean; instructions?: string },
) => Promise<string>;

export interface CollaborationHost {
  availability(): { installed: boolean; ready: boolean };
  resolved(): CollaborationResolved;
  context(threadId: string, clientId?: string): CollaborationTurnContext | null;
  saveItem(taskId: string, item: { id: string; parent?: string; type: string; text: string; detail?: string; status: string; meta?: MessageMeta; changes?: WorkflowChange[] }): void;
  workerStep(taskId: string, parent: string, step: WorkflowStep): void;
  settleWorker(taskId: string, parent: string, runStopped: boolean): void;
  registerWorker(itemId: string, taskId: string, controller: AbortController): () => void;
  onNoteOptions(taskId: string, runId: string, options: PreparedNoteOptions[]): void;
  activity(taskId: string, event: Parameters<WorkflowActivity>[0]): void;
  generate?: CollaborationHelperCall;
}

const STRATEGY_MODELS = [
  { model: 'balanced', displayName: 'Balanced · Auto route & race', isDefault: true, supportedReasoningEfforts: [] },
  { model: 'fast', displayName: 'Fast · Route only', isDefault: false, supportedReasoningEfforts: [] },
  { model: 'thorough', displayName: 'Thorough · Race & verify', isDefault: false, supportedReasoningEfforts: [] },
];

class ConcurrencyLimiter {
  private globalRunning = 0;
  private perAgent = new Map<string, number>();
  private queue: (() => void)[] = [];
  constructor(private maxGlobal = 4, private maxPerAgent = 2) {}
  async run<T>(agent: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    await this.acquire(agent, signal);
    try { return await work(); }
    finally { this.release(agent); }
  }
  private acquire(agent: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error('Stopped.'));
    const count = this.perAgent.get(agent) || 0;
    if (this.globalRunning < this.maxGlobal && count < this.maxPerAgent) {
      this.globalRunning++;
      this.perAgent.set(agent, count + 1);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const idx = this.queue.indexOf(tryAcquire);
        if (idx >= 0) this.queue.splice(idx, 1);
        reject(new Error('Stopped.'));
      };
      const tryAcquire = () => {
        if (signal.aborted) { onAbort(); return; }
        const cur = this.perAgent.get(agent) || 0;
        if (this.globalRunning < this.maxGlobal && cur < this.maxPerAgent) {
          signal.removeEventListener('abort', onAbort);
          this.globalRunning++;
          this.perAgent.set(agent, cur + 1);
          resolve();
        } else {
          this.queue.push(tryAcquire);
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.queue.push(tryAcquire);
    });
  }
  private release(agent: string) {
    this.globalRunning = Math.max(0, this.globalRunning - 1);
    const cur = Math.max(0, (this.perAgent.get(agent) || 1) - 1);
    if (cur) this.perAgent.set(agent, cur); else this.perAgent.delete(agent);
    const pending = this.queue.splice(0, this.queue.length);
    for (const wake of pending) wake();
  }
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export class CollaborationRuntime extends Adapter {
  private readonly invoke: CollaborationHelperCall;
  constructor(private host: CollaborationHost) {
    super();
    this.invoke = host.generate || ((worker, prompt, signal, edit, step, activity, options) =>
      runWorkflowHelper(worker, prompt, signal, edit, step, undefined, activity, options));
  }
  detect() { return this.host.availability().installed; }
  async start() { this.ready = true; }
  permissionOptions(): TaskPermissionOption[] {
    return [
      { value: 'workspace', label: 'Workspace access', detail: 'Isolated read-only routing and judging, with manuscript edits scoped to this task worktree.' },
    ];
  }
  protected account() {
    const { ready } = this.host.availability();
    return { account: ready ? { type: 'Papilot Collaboration Mode' } : null, requiresOpenaiAuth: false };
  }
  protected models() { return { data: STRATEGY_MODELS }; }

  protected run(turn: Turn, thread: Thread, text: string, _effort: string | null, images: string[]) {
    const controller = new AbortController();
    let stopped = false;
    let settled!: () => void;
    const done = new Promise<void>(resolve => { settled = resolve; });
    // Wait for any in-flight atomic worktree merge to complete before emitting
    // `turn/completed (interrupted)` so callers never race with a file write.
    turn.stop = () => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      void done.then(() => this.finish(turn, 'interrupted'));
    };

    void this.execute(turn, thread, text, images, controller.signal)
      .then(reply => {
        if (stopped || controller.signal.aborted) return;
        this.item(turn, { id: `${turn.id}:reply`, type: 'agentMessage', text: reply });
        this.finish(turn, 'completed');
      }, error => {
        controller.abort();
        if (stopped || (error instanceof Error && error.name === 'CollaborationStoppedError')) {
          this.finish(turn, 'interrupted');
          return;
        }
        if (controller.signal.aborted && stopped) return;
        this.finish(turn, 'failed', errorMessage(error));
      })
      .finally(() => {
        controller.abort();
        settled();
      });
  }

  private async execute(turn: Turn, thread: Thread, text: string, images: string[], signal: AbortSignal): Promise<string> {
    const ctx = this.host.context(turn.threadId, turn.clientId);
    // Ephemeral / read-only fallback when invoked outside a stored task turn.
    if (!ctx || thread.ephemeral || thread.readOnly) {
      const resolved = this.host.resolved();
      const worker = resolved.router || resolved.routes.rigorous || resolved.routes.quick || resolved.routes.polish;
      if (!worker) throw new Error('Connect at least one agent to use Collaboration mode.');
      return await this.invoke(worker, text, signal, undefined, undefined, undefined, { instructions: thread.instructions || undefined });
    }

    const { taskId, runId, worktree, resolved, runtimes, readOnlyAgents } = ctx;
    const strategy: CollaborationStrategy = isCollaborationStrategy(thread.model) ? thread.model : 'balanced';
    const labelOf = (route: CollaborationRoute | null) => route ? `${AGENT_NAMES[route.agent]} · ${routeDisplayName(route, runtimes)}` : 'Unavailable';
    const shortModel = (route: CollaborationRoute) => routeDisplayName(route, runtimes);
    const activity: WorkflowActivity = event => this.host.activity(taskId, event);
    const limiter = new ConcurrencyLimiter(4, 2);
    const live = () => !signal.aborted;

    const primaryWorker = resolved.routes.rigorous || resolved.routes.polish || resolved.routes.quick || resolved.router;
    if (!primaryWorker) throw new Error('Connect at least one agent in Settings → Agents to use Collaboration mode.');

    const turnNotes = currentTurnNotes(ctx.notes, runId, ctx.groupInstructions);
    const { clusters, unanchored } = clusterCurrentNotes(worktree, turnNotes);

    // Holistic / global turn: 0 localized annotations (plain prompt, review follow-up, build fix, or image-only task).
    if (!clusters.length) {
      return await this.runGlobalPass({
        ctx, turn, worker: primaryWorker, label: labelOf(primaryWorker),
        prompt: this.globalPrompt(text, ctx.history, ctx.memory),
        images, signal, activity,
      });
    }

    // Read base snapshots for every cluster file before any edits start.
    const fileBase = new Map<string, string>();
    for (const cluster of clusters) {
      if (!fileBase.has(cluster.file)) {
        fileBase.set(cluster.file, fs.readFileSync(path.join(worktree, cluster.file), 'utf8'));
      }
    }
    const paperContext = extractPaperContext(worktree);

    // Stage 1: Fast Router
    const routeItemId = `${taskId}:${turn.id}:route`;
    const routerWorker = resolved.router || primaryWorker;
    const routerMeta = { agent: routerWorker.agent, model: shortModel(routerWorker) };
    const routerCanReadOnly = readOnlyAgents[routerWorker.agent] !== false;
    this.host.saveItem(taskId, {
      id: routeItemId, type: 'tool', text: 'workflow_route',
      detail: `${labelOf(routerWorker)}\nStrategy: ${strategy} · ${clusters.length} cluster${clusters.length === 1 ? '' : 's'}`,
      status: 'inProgress',
      meta: { dispatch: { strategy, router: routerMeta, entries: [] } },
    });

    const activeLanes = resolved.lanes?.length ? resolved.lanes : undefined;
    const laneOf = (laneId: string) => activeLanes?.find(l => l.id === laneId);
    const roleRoute = (role: CollaborationRole) => resolved.routes[role] || primaryWorker;
    const laneRacers = (laneId: string) => {
      const lane = laneOf(laneId);
      if (lane && lane.models.length >= 2) return lane.models;
      return resolved.racers.length >= 2 ? resolved.racers : [lane?.models[0] || primaryWorker];
    };
    const answerWorkerOf = () => {
      const answerCandidates = [resolved.routes.rigorous, resolved.judge, routerWorker, resolved.routes.polish, resolved.routes.quick]
        .filter((r): r is CollaborationRoute => Boolean(r));
      return answerCandidates.find(r => readOnlyAgents[r.agent] !== false) || answerCandidates[0];
    };

    let plan = deterministicFallbackPlan(clusters, strategy, resolved.racers.length, activeLanes);
    if (routerCanReadOnly) {
      const routerPrompt = buildRouterPrompt({
        clusters, request: ctx.request || text, strategy,
        racerCount: resolved.racers.length, roles: resolved.routes, lanes: activeLanes, memory: ctx.memory,
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const reply = await limiter.run(routerWorker.agent, signal, () =>
            this.invoke(routerWorker, routerPrompt, signal, undefined, undefined, activity),
          );
          const parsed = parseRouterPlan(reply, clusters, strategy, resolved.racers.length, activeLanes);
          plan = parsed;
          if (!parsed.fallback) break;
        } catch (error) {
          if (signal.aborted) {
            this.host.saveItem(taskId, {
              id: routeItemId, type: 'tool', text: 'workflow_route',
              detail: `${labelOf(routerWorker)}\nStopped by author.`,
              status: 'interrupted',
              meta: { dispatch: { strategy, router: routerMeta, entries: [] } },
            });
            throw error;
          }
          if (attempt === 1) plan = { ...deterministicFallbackPlan(clusters, strategy, resolved.racers.length, activeLanes), reason: `Router fallback (${errorMessage(error)})` };
        }
      }
    }
    const judgeWorker = resolved.judge || primaryWorker;
    const dispatchEntries: CollaborationDispatchEntry[] = plan.units.map(u => {
      const cluster = clusters.find(c => c.id === u.clusterId)!;
      const lane = laneOf(u.lane);
      const laneId = lane?.id || u.lane || u.role;
      const laneName = lane?.name || u.lane || u.role;
      const notes = cluster.notes.map(n => n.noteNumber);
      if (u.mode === 'answer') {
        const worker = answerWorkerOf();
        const itemId = `${taskId}:${turn.id}:answer:${cluster.id}`;
        return {
          clusterId: cluster.id, notes, file: cluster.file, laneId: 'answer', laneName: 'Answer', mode: 'answer',
          itemId, workers: [{ itemId, agent: worker.agent, model: shortModel(worker) }],
        };
      }
      if (u.mode === 'race') {
        const racers = laneRacers(u.lane);
        const raceItemId = `${taskId}:${turn.id}:race:${cluster.id}`;
        return {
          clusterId: cluster.id, notes, file: cluster.file, laneId, laneName, ...(lane?.icon ? { laneIcon: lane.icon } : {}), mode: 'race',
          itemId: raceItemId,
          workers: racers.map((racer, idx) => ({ itemId: `${raceItemId}:r${idx}`, agent: racer.agent, model: shortModel(racer) })),
          ...(readOnlyAgents[judgeWorker.agent] !== false ? { judge: { itemId: `${raceItemId}:judge`, agent: judgeWorker.agent, model: shortModel(judgeWorker) } } : {}),
        };
      }
      const worker = lane?.models[0] || roleRoute(u.role);
      const itemId = `${taskId}:${turn.id}:assign:${cluster.id}`;
      return {
        clusterId: cluster.id, notes, file: cluster.file, laneId, laneName, ...(lane?.icon ? { laneIcon: lane.icon } : {}), mode: 'assign',
        itemId, workers: [{ itemId, agent: worker.agent, model: shortModel(worker) }],
      };
    });
    const planLines = plan.units.map(u => {
      const cluster = clusters.find(c => c.id === u.clusterId)!;
      const nums = cluster.notes.map(n => `#${n.noteNumber}`).join(', ');
      const lane = laneOf(u.lane);
      const laneName = lane?.name || u.lane || u.role;
      return u.mode === 'race'
        ? `${nums} (${cluster.file}): ${laneName} · race (${laneRacers(u.lane).map(shortModel).join(' vs ')})`
        : u.mode === 'answer'
          ? `${nums} (${cluster.file}): answer`
          : `${nums} (${cluster.file}): ${laneName} → ${shortModel(lane?.models[0] || roleRoute(u.role))}`;
    });
    this.host.saveItem(taskId, {
      id: routeItemId, type: 'tool', text: 'workflow_route',
      detail: `${labelOf(routerWorker)}\n${planLines.join('\n')}${plan.reason ? `\n${plan.reason}` : ''}`,
      status: 'completed',
      meta: { dispatch: { strategy, router: routerMeta, entries: dispatchEntries, ...(plan.reason ? { reason: plan.reason } : {}) } },
    });

    // Stage 2: Execute clusters concurrently (assign + race + answer)
    const completedRaces: { cluster: NoteCluster; base: Record<string, string>; verdict: RaceVerdict }[] = [];
    const conflicts: { cluster: NoteCluster; conflict: WorkflowConflict }[] = [];
    const answers: { cluster: NoteCluster; text: string }[] = [];
    const reportLines: string[] = [];

    const runOneCandidate = async (
      cluster: NoteCluster,
      worker: CollaborationRoute,
      role: CollaborationRole,
      instruction: string,
      itemId: string,
      parentId: string | undefined,
      title: string,
      base: Record<string, string>,
    ): Promise<{ candidate: RaceCandidate; changes: WorkflowChange[] } | { error: string; stopped?: boolean }> => {
      const own = new AbortController();
      const unregister = this.host.registerWorker(itemId, taskId, own);
      const combined = AbortSignal.any([signal, own.signal]);
      const noteNums = cluster.notes.map(n => n.noteNumber).join(', ');
      this.host.saveItem(taskId, {
        id: itemId, ...(parentId ? { parent: parentId } : {}), type: 'tool', text: title,
        detail: `${labelOf(worker)}\nNotes: ${noteNums}\n${instruction}`,
        status: 'inProgress',
      });
      const otherClusters = clusters.filter(c => c.id !== cluster.id);
      try {
        const usePatchMode = readOnlyAgents[worker.agent] !== false;
        let files: Record<string, string>;
        let summary = '';
        let changes: WorkflowChange[] = [];
        if (usePatchMode) {
          const prompt = buildPatchWorkerPrompt({
            cluster, instruction, role, base, paperContext,
            overallRequest: ctx.request || text, memory: ctx.memory,
          });
          const reply = await limiter.run(worker.agent, combined, () =>
            this.invoke(worker, prompt, combined, undefined, s => {
              if (live() && !own.signal.aborted && s.item?.type !== 'agentMessage') this.host.workerStep(taskId, itemId, s);
            }, activity),
          );
          const parsed = parsePatchReply(reply, [cluster.file]);
          summary = parsed.summary;
          files = applyPatchesToBase(base, parsed.edits);
          changes = diffFiles(base, files);
        } else {
          // Edit-only agent (e.g. Qoder/CodeBuddy/WorkBuddy): run in isolated temp copy with file-whitelist verification.
          const captured = await limiter.run(worker.agent, combined, () =>
            captureWorkflowEdits(worktree, [{ file: cluster.file, source: base[cluster.file] }], edit =>
              this.invoke(worker, `Edit ONLY the assigned passage in ${cluster.file} (lines ${cluster.lines[0]}-${cluster.lines[1]}).\n${JSON.stringify({ instruction, notes: cluster.notes.map(n => ({ note: n.noteNumber, quote: n.note.quote, comment: n.note.comment, ...(n.instruction ? { groupInstruction: n.instruction } : {}) })), overallRequest: ctx.request || text })}`, combined, edit, s => { if (live() && !own.signal.aborted) this.host.workerStep(taskId, itemId, s); }, activity),
            combined, () => live() && !own.signal.aborted),
          );
          summary = captured.summary;
          files = captured.files;
          changes = captured.changes;
        }
        const fidelity = checkCandidateFidelity(base, files, cluster, otherClusters);
        const candidate: RaceCandidate = {
          id: randomUUID(), route: worker, role, modelName: shortModel(worker),
          summary, files, diffs: changes, fidelity,
        };
        const statusNote = fidelity.hardFail
          ? `Rejected (${fidelity.outOfScope ? 'edited outside target passage' : fidelity.latexErrors[0] || 'no changes'})`
          : fidelity.droppedCitations.length
            ? `Done with warning: dropped ${fidelity.droppedCitations.slice(0, 2).join(', ')}`
            : summary || 'Completed';
        this.host.saveItem(taskId, {
          id: itemId, ...(parentId ? { parent: parentId } : {}), type: 'tool', text: title,
          detail: `${labelOf(worker)}\nNotes: ${noteNums}\n${statusNote}`,
          status: fidelity.hardFail ? 'failed' : 'completed',
          ...(changes.length ? { changes } : {}),
        });
        return { candidate, changes };
      } catch (error) {
        const userStopped = own.signal.aborted && !signal.aborted;
        const msg = userStopped ? 'Stopped by author.' : errorMessage(error);
        this.host.saveItem(taskId, {
          id: itemId, ...(parentId ? { parent: parentId } : {}), type: 'tool', text: title,
          detail: `${labelOf(worker)}\nNotes: ${noteNums}\n${msg}`,
          status: userStopped ? 'interrupted' : 'failed',
        });
        return { error: msg, stopped: userStopped };
      } finally {
        unregister();
        this.host.settleWorker(taskId, itemId, signal.aborted);
      }
    };

    const raceReports = new Map<string, { noteNums: string; file: string; laneLabel: string; racersText: string; winnerLabel: string; summary: string; warnNames: string[]; noteNumbers: number[] }>();
    const settledUnits = await Promise.allSettled(plan.units.map(async unit => {
      if (signal.aborted) return;
      const cluster = clusters.find(c => c.id === unit.clusterId)!;
      const noteNums = cluster.notes.map(n => `#${n.noteNumber}`).join(', ');
      const base = { [cluster.file]: fileBase.get(cluster.file)! };

      if (unit.mode === 'answer') {
        const answerWorker = answerWorkerOf();
        const itemId = `${taskId}:${turn.id}:answer:${cluster.id}`;
        const plainNums = cluster.notes.map(n => n.noteNumber).join(', ');
        const own = new AbortController();
        const unregister = this.host.registerWorker(itemId, taskId, own);
        const combined = AbortSignal.any([signal, own.signal]);
        this.host.saveItem(taskId, { id: itemId, type: 'tool', text: `workflow_delegate · answer`, detail: `${labelOf(answerWorker)}\nNotes: ${plainNums}\n${unit.instruction}`, status: 'inProgress' });
        try {
          if (readOnlyAgents[answerWorker.agent] === false) throw new Error(`${AGENT_NAMES[answerWorker.agent]} does not support read-only answers.`);
          const reply = await limiter.run(answerWorker.agent, combined, () =>
            this.invoke(answerWorker, `Answer the author's question about this LaTeX passage concisely without proposing file edits.\n${JSON.stringify({ file: cluster.file, excerpt: cluster.excerpt, notes: cluster.notes.map(n => ({ note: n.noteNumber, quote: n.note.quote, comment: n.note.comment })), request: ctx.request || text })}`, combined, undefined, undefined, activity),
          );
          answers.push({ cluster, text: reply.trim() });
          this.host.saveItem(taskId, { id: itemId, type: 'tool', text: `workflow_delegate · answer`, detail: `${labelOf(answerWorker)}\nNotes: ${plainNums}\nAnswered in chat.`, status: 'completed' });
        } catch (error) {
          if (signal.aborted) return;
          const userStopped = own.signal.aborted && !signal.aborted;
          const msg = userStopped ? 'Stopped by author.' : errorMessage(error);
          this.host.saveItem(taskId, { id: itemId, type: 'tool', text: `workflow_delegate · answer`, detail: `${labelOf(answerWorker)}\nNotes: ${plainNums}\n${msg}`, status: userStopped ? 'interrupted' : 'failed' });
          reportLines.push(`- **${noteNums}** (${cluster.file}): ${userStopped ? 'Stopped.' : `Could not answer (${msg}).`}`);
        } finally {
          unregister();
          this.host.settleWorker(taskId, itemId, signal.aborted);
        }
        return;
      }

      if (unit.mode === 'assign') {
        const lane = laneOf(unit.lane);
        const worker = lane?.models[0] || roleRoute(unit.role);
        const laneLabel = lane?.name || unit.lane || unit.role;
        const itemId = `${taskId}:${turn.id}:assign:${cluster.id}`;
        let res = await runOneCandidate(cluster, worker, unit.role, unit.instruction, itemId, undefined, `workflow_delegate · ${unit.lane || unit.role}`, base);
        // If quick/polish failed or produced a hard-broken edit, fall back once to rigorous worker.
        if (!signal.aborted && ('error' in res ? !res.stopped : res.candidate.fidelity.hardFail) && resolved.routes.rigorous && routeKey(worker) !== routeKey(resolved.routes.rigorous)) {
          const fallbackId = `${taskId}:${turn.id}:fallback:${cluster.id}`;
          res = await runOneCandidate(cluster, resolved.routes.rigorous, 'rigorous', unit.instruction, fallbackId, undefined, 'workflow_delegate · rigorous', base);
        }
        if (signal.aborted) return;
        if ('error' in res) {
          reportLines.push(`- **${noteNums}** (${cluster.file}): ${res.stopped ? 'Stopped' : `Failed (${res.error})`}.`);
          return;
        }
        if (res.candidate.fidelity.hardFail) {
          reportLines.push(`- **${noteNums}** (${cluster.file}): Skipped unsafe proposal (${res.candidate.fidelity.latexErrors[0] || 'no valid change'}).`);
          return;
        }
        try {
          const merged = await mergeWorkflowFiles(worktree, base, res.candidate.files, signal, live);
          if (merged.conflicts.length) {
            for (const conflict of merged.conflicts) conflicts.push({ cluster, conflict });
            reportLines.push(`- **${noteNums}** (${cluster.file}): Assigned to **${res.candidate.modelName}** (reconciling overlap).`);
          } else {
            reportLines.push(`- **${noteNums}** (${cluster.file}): **${laneLabel}** → **${res.candidate.modelName}**${res.candidate.summary ? ` — ${res.candidate.summary.replace(/\.+$/, '')}` : ''}.`);
          }
        } catch (error) {
          if (signal.aborted) return;
          reportLines.push(`- **${noteNums}** (${cluster.file}): Could not merge edit (${errorMessage(error)}).`);
        }
        return;
      }

      // Per-annotation Race mode (using this lane's competing models)!
      const lane = laneOf(unit.lane);
      const laneLabel = lane?.name || unit.lane || unit.role;
      const racers = laneRacers(unit.lane);
      const raceItemId = `${taskId}:${turn.id}:race:${cluster.id}`;
      this.host.saveItem(taskId, {
        id: raceItemId, type: 'tool', text: `workflow_race · Notes ${cluster.notes.map(n => n.noteNumber).join(', ')}`,
        detail: `${laneLabel}: ${racers.map(shortModel).join(' vs ')}\n${unit.instruction}`,
        status: 'inProgress',
      });

      const results = await Promise.all(racers.map((racer, idx) => {
        const racerRole: CollaborationRole = resolved.routes.rigorous && routeKey(racer) === routeKey(resolved.routes.rigorous) ? 'rigorous' : 'polish';
        return runOneCandidate(
          cluster, racer, racerRole, unit.instruction,
          `${raceItemId}:r${idx}`, raceItemId,
          `workflow_racer · ${shortModel(racer)}`, base,
        );
      }));
      if (signal.aborted) return;

      const valid = results.flatMap(r => ('candidate' in r && !r.candidate.fidelity.hardFail ? [r.candidate] : []));
      if (!valid.length) {
        const firstErr = results.find((r): r is { error: string; stopped?: boolean } => 'error' in r)?.error || 'No valid proposal was produced.';
        this.host.saveItem(taskId, { id: raceItemId, type: 'tool', text: `workflow_race · Notes ${cluster.notes.map(n => n.noteNumber).join(', ')}`, detail: `All racers failed: ${firstErr}`, status: 'failed' });
        reportLines.push(`- **${noteNums}** (${cluster.file}): Race failed (${firstErr}).`);
        return;
      }

      const unique = deduplicateCandidates(valid);
      let verdict: RaceVerdict;
      const judgeWorker = resolved.judge || primaryWorker;
      if (unique.length === 1) {
        const sole = unique[0];
        const agreed = (sole.consensus?.length || 1) > 1;
        verdict = deterministicVerdict([sole], agreed ? `All ${sole.consensus!.length} models agreed.` : 'Single valid proposal.');
      } else if (readOnlyAgents[judgeWorker.agent] === false) {
        verdict = deterministicVerdict(unique, 'Selected by deterministic checks (no read-only judge connected).');
      } else {
        const judgeItemId = `${raceItemId}:judge`;
        const anonymized = anonymizeCandidates(cluster.id, unique);
        this.host.saveItem(taskId, {
          id: judgeItemId, parent: raceItemId, type: 'tool', text: `workflow_judge · ${shortModel(judgeWorker)}`,
          detail: `Blind rigor & prose evaluation of ${anonymized.length} candidates`, status: 'inProgress',
        });
        try {
          const judgePrompt = buildJudgePrompt({ cluster, overallRequest: ctx.request || text, anonymized, memory: ctx.memory });
          const judgeReply = await limiter.run(judgeWorker.agent, signal, () =>
            this.invoke(judgeWorker, judgePrompt, signal, undefined, undefined, activity),
          );
          verdict = parseJudgeVerdict({
            reply: judgeReply, anonymized, base, cluster,
            otherClusters: clusters.filter(c => c.id !== cluster.id),
            judgeRoute: judgeWorker, judgeName: shortModel(judgeWorker),
          });
          this.host.saveItem(taskId, {
            id: judgeItemId, parent: raceItemId, type: 'tool', text: `workflow_judge · ${shortModel(judgeWorker)}`,
            detail: `Recommended: ${verdict.winner.label}\n${verdict.judgeSummary}`, status: 'completed',
          });
        } catch (error) {
          if (signal.aborted) return;
          verdict = deterministicVerdict(unique, `Deterministic fallback (${errorMessage(error)})`);
          this.host.saveItem(taskId, {
            id: judgeItemId, parent: raceItemId, type: 'tool', text: `workflow_judge · ${shortModel(judgeWorker)}`,
            detail: `Fallback: ${verdict.winner.label} (${errorMessage(error)})`, status: 'completed',
          });
        }
      }

      try {
        const merged = await mergeWorkflowFiles(worktree, base, verdict.winner.candidate.files, signal, live);
        if (merged.conflicts.length) {
          for (const conflict of merged.conflicts) conflicts.push({ cluster, conflict });
        }
      } catch (error) {
        if (signal.aborted) return;
        this.host.saveItem(taskId, { id: raceItemId, type: 'tool', text: `workflow_race · Notes ${cluster.notes.map(n => n.noteNumber).join(', ')}`, detail: `Could not merge winner: ${errorMessage(error)}`, status: 'failed' });
        reportLines.push(`- **${noteNums}** (${cluster.file}): Could not merge winning proposal (${errorMessage(error)}).`);
        return;
      }
      completedRaces.push({ cluster, base, verdict });

      const warnAlts = verdict.alternatives.filter(a => a.rigor === 'warn');
      const winnerFile = verdict.winner.candidate.files[cluster.file];
      const winnerItemIds = verdict.winner.candidate.synthesized
        ? []
        : results.flatMap((r, idx) => ('candidate' in r && !r.candidate.fidelity.hardFail && r.candidate.files[cluster.file] === winnerFile ? [`${raceItemId}:r${idx}`] : []));
      this.host.saveItem(taskId, {
        id: raceItemId, type: 'tool', text: `workflow_race · Notes ${cluster.notes.map(n => n.noteNumber).join(', ')}`,
        detail: `Selected: ${verdict.winner.label}\n${verdict.judgeSummary}`,
        status: 'completed',
        meta: {
          raceResult: {
            winnerModel: verdict.winner.label,
            winnerItemIds,
            ...(verdict.winner.candidate.synthesized ? { synthesized: true } : {}),
          },
        },
        ...(verdict.winner.candidate.diffs.length ? { changes: verdict.winner.candidate.diffs } : {}),
      });
      raceReports.set(cluster.id, {
        noteNums,
        file: cluster.file,
        laneLabel,
        racersText: racers.map(shortModel).join(' vs '),
        winnerLabel: verdict.winner.label,
        summary: verdict.judgeSummary,
        warnNames: warnAlts.map(a => a.candidate.modelName),
        noteNumbers: cluster.notes.map(n => n.noteNumber),
      });
    }));
    void settledUnits;

    if (signal.aborted) throw new Error('Stopped.');

    // Stage 3: Conflict reconciliation and unanchored notes (if any) via rigorous worker
    if (conflicts.length) {
      const reconId = `${taskId}:${turn.id}:reconcile`;
      const reconWorker = resolved.routes.rigorous || primaryWorker;
      const own = new AbortController();
      const unregister = this.host.registerWorker(reconId, taskId, own);
      const combined = AbortSignal.any([signal, own.signal]);
      this.host.saveItem(taskId, { id: reconId, type: 'tool', text: 'workflow_delegate · reconcile', detail: `${labelOf(reconWorker)}\nReconciling ${conflicts.length} overlapping edit(s)`, status: 'inProgress' });
      try {
        const conflictPayload = conflicts.map(c => {
          const incomingDiff = createTwoFilesPatch(c.conflict.file, c.conflict.file, c.conflict.base, c.conflict.incoming, 'base', 'incoming', { context: 4 });
          const conflictWindow = (() => {
            if (!c.conflict.candidate) return undefined;
            const lines = c.conflict.candidate.split('\n');
            const lo = Math.max(0, c.cluster.window[0] - 12);
            const hi = Math.min(lines.length, c.cluster.window[1] + 12);
            return lines.slice(lo, hi).join('\n');
          })();
          return {
            file: c.conflict.file,
            targetLines: c.cluster.lines,
            notes: c.cluster.notes.map(n => ({ note: n.noteNumber, quote: n.note.quote, comment: n.note.comment })),
            incomingDiff,
            ...(conflictWindow ? { conflictWindow } : {}),
          };
        });
        await this.invoke(reconWorker, `Reconcile these overlapping edits cleanly in the manuscript files while preserving all requested changes and LaTeX validity. Read the current file on disk around targetLines before editing:\n${JSON.stringify(conflictPayload)}`, combined, { cwd: worktree, files: [...new Set(conflicts.map(c => c.conflict.file))] }, s => { if (live() && !own.signal.aborted) this.host.workerStep(taskId, reconId, s); }, activity, { fullWorkspace: true });
        this.host.saveItem(taskId, { id: reconId, type: 'tool', text: 'workflow_delegate · reconcile', detail: `${labelOf(reconWorker)}\nReconciled ${conflicts.length} overlap(s).`, status: 'completed' });
      } catch (error) {
        if (signal.aborted) throw error;
        const userStopped = own.signal.aborted && !signal.aborted;
        const msg = userStopped ? 'Stopped by author.' : errorMessage(error);
        this.host.saveItem(taskId, { id: reconId, type: 'tool', text: 'workflow_delegate · reconcile', detail: `${labelOf(reconWorker)}\n${msg}`, status: userStopped ? 'interrupted' : 'failed' });
        reportLines.push(`- **Merge overlap**: ${userStopped ? 'Stopped by author.' : `Needs follow-up (${msg}).`}`);
      } finally {
        unregister();
        this.host.settleWorker(taskId, reconId, signal.aborted);
      }
    }

    if (unanchored.length) {
      try {
        const extraReply = await this.runGlobalPass({
          ctx, turn, worker: resolved.routes.rigorous || primaryWorker, label: labelOf(resolved.routes.rigorous || primaryWorker),
          prompt: `Address these unanchored notes in the manuscript:\n${JSON.stringify(unanchored.map(n => ({ note: n.noteNumber, where: n.note.where, quote: n.note.quote, comment: n.note.comment, ...(n.instruction ? { groupInstruction: n.instruction } : {}) })))}\n\n${ctx.request ? `Overall request: ${ctx.request}` : ''}`,
          images, signal, activity, suffix: 'unanchored',
        });
        if (extraReply.trim()) reportLines.push(`- **Additional notes (${unanchored.map(n => `#${n.noteNumber}`).join(', ')})**: ${extraReply.trim()}`);
      } catch (error) {
        if (signal.aborted) throw error;
        reportLines.push(`- **Additional notes (${unanchored.map(n => `#${n.noteNumber}`).join(', ')})**: Could not finish (${errorMessage(error)}).`);
      }
    }

    // Stage 4: Build PreparedNoteOptions from final merged files so #316 shows race tabs inline on the PDF!
    const prepared = buildPreparedRaceOptions(completedRaces, file => {
      try { return fs.readFileSync(path.join(worktree, file), 'utf8'); } catch { return null; }
    });
    if (prepared.length) this.host.onNoteOptions(taskId, runId, prepared);

    // Emit race report lines accurately reflecting the actually prepared alternatives.
    for (const info of raceReports.values()) {
      const preparedForCluster = prepared.find(p => info.noteNumbers.includes(p.note));
      const altCount = preparedForCluster?.options.length || 0;
      const altSummary = altCount
        ? ` (${altCount} alternative${altCount === 1 ? '' : 's'} available in PDF card${info.warnNames.length ? `; rigor note on ${info.warnNames.join(', ')}` : ''})`
        : '';
      reportLines.push(`- **${info.noteNums}** (${info.file}): **${info.laneLabel}** raced (${info.racersText}) → **${info.winnerLabel}** — ${info.summary}${altSummary}`);
    }

    // Stage 5: Concise Markdown summary
    const racedSummary = [...new Set([...raceReports.values()].map(r => `${r.laneLabel}: ${r.racersText}`))].join('; ');
    const teamLine = `**Collaboration (${strategy})** · Router: ${shortModel(routerWorker)}${completedRaces.length ? ` · Raced (${racedSummary}) · Judge: ${shortModel(resolved.judge || primaryWorker)}` : ''}`;
    const sections = [teamLine];
    if (reportLines.length) sections.push(reportLines.join('\n'));
    if (answers.length) {
      sections.push(answers.map(a => `**Notes ${a.cluster.notes.map(n => `#${n.noteNumber}`).join(', ')} (${a.cluster.file})**\n${a.text}`).join('\n\n'));
    }
    if (prepared.length) {
      sections.push('Open any raced change card on the PDF to switch between competing model proposals and accept your preferred wording directly.');
    }
    return sections.join('\n\n');
  }

  private globalPrompt(text: string, history: string, memory: string) {
    return [
      history ? `Previous conversation context:\n${history}` : '',
      memory ? `Author writing preferences:\n${memory}` : '',
      text,
    ].filter(Boolean).join('\n\n');
  }

  private async runGlobalPass(options: {
    ctx: CollaborationTurnContext;
    turn: Turn;
    worker: CollaborationRoute;
    label: string;
    prompt: string;
    images: string[];
    signal: AbortSignal;
    activity: WorkflowActivity;
    suffix?: string;
  }): Promise<string> {
    const { ctx, turn, worker, label, prompt, images, signal, activity, suffix } = options;
    const itemId = `${ctx.taskId}:${turn.id}:global${suffix ? `:${suffix}` : ''}`;
    const own = new AbortController();
    const unregister = this.host.registerWorker(itemId, ctx.taskId, own);
    const combined = AbortSignal.any([signal, own.signal]);
    this.host.saveItem(ctx.taskId, { id: itemId, type: 'tool', text: 'workflow_delegate · rigorous', detail: `${label}\nWhole-task edit`, status: 'inProgress' });
    try {
      const reply = await this.invoke(
        worker, prompt, combined,
        { cwd: ctx.worktree, files: [] },
        s => { if (!combined.aborted) this.host.workerStep(ctx.taskId, itemId, s); },
        activity,
        { images, fullWorkspace: true },
      );
      this.host.saveItem(ctx.taskId, { id: itemId, type: 'tool', text: 'workflow_delegate · rigorous', detail: `${label}\nCompleted`, status: 'completed' });
      return reply;
    } catch (error) {
      const userStopped = own.signal.aborted && !signal.aborted;
      this.host.saveItem(ctx.taskId, { id: itemId, type: 'tool', text: 'workflow_delegate · rigorous', detail: `${label}\n${userStopped ? 'Stopped by author.' : errorMessage(error)}`, status: userStopped ? 'interrupted' : 'failed' });
      if (userStopped) {
        const stoppedErr = new Error('Stopped by author.');
        stoppedErr.name = 'CollaborationStoppedError';
        throw stoppedErr;
      }
      throw error;
    } finally {
      unregister();
      this.host.settleWorker(ctx.taskId, itemId, signal.aborted);
    }
  }
}
