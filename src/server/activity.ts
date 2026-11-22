import { getModels, getProviders, type Api, type KnownProvider, type Model } from '@mariozechner/pi-ai';
import {
  ACTIVITY_CALENDAR_DAYS,
  ACTIVITY_RANGES,
  isAgentId,
  isTaskReviewNote,
  type ActivityAgentSummary,
  type ActivityCalendarDay,
  type ActivityCostSource,
  type ActivityDay,
  type ActivityMetrics,
  type ActivityModelSummary,
  type ActivityProjectSummary,
  type ActivityRange,
  type ActivityReport,
  type ActivityTokenTotals,
  type ActivityTotals,
  type ActivityTurnRole,
  type AgentId,
} from '../shared.ts';
import type { Store } from './store.ts';

export type { ActivityTokenTotals };
export type ActivityEventKind =
  | 'task_started'
  | 'agent_turn'
  | 'token_usage'
  | 'review_decision'
  | 'annotation_created'
  | 'annotations_sent'
  | 'task_delivered'
  | 'git_commit';

export interface ActivityEventInput {
  key: string;
  at: number;
  kind: ActivityEventKind;
  projectId?: string | null;
  taskId?: string | null;
  agent?: string | null;
  model?: string | null;
  data: Record<string, unknown>;
}

export interface ActivityEventRow {
  key: string;
  at: number;
  kind: ActivityEventKind;
  projectId: string | null;
  taskId: string | null;
  agent: string | null;
  model: string | null;
  undoneAt: number | null;
  data: Record<string, any>;
}

export const zeroTokens = (): ActivityTokenTotals => ({
  input: 0,
  cached: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  total: 0,
});

const safeInt = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
};

export function addTokens(target: ActivityTokenTotals, delta: Partial<ActivityTokenTotals>) {
  target.input += safeInt(delta.input);
  target.cached += safeInt(delta.cached);
  target.cacheWrite += safeInt(delta.cacheWrite);
  target.output += safeInt(delta.output);
  target.reasoning += safeInt(delta.reasoning);
  target.total += safeInt(delta.total);
}

// Codex reports OpenAI token breakdowns where inputTokens includes cached tokens
// and outputTokens includes reasoningOutputTokens. Normalize to disjoint buckets.
export function parseCodexBreakdown(raw: any): ActivityTokenTotals | null {
  if (!raw || typeof raw !== 'object') return null;
  const hasDetail = ['inputTokens', 'input_tokens', 'outputTokens', 'output_tokens', 'cachedInputTokens', 'cached_input_tokens']
    .some(field => raw[field] !== undefined);
  if (!hasDetail) return null;
  const rawInput = safeInt(raw.inputTokens ?? raw.input_tokens);
  const cached = Math.min(rawInput, safeInt(raw.cachedInputTokens ?? raw.cached_input_tokens));
  const cacheWrite = Math.min(Math.max(0, rawInput - cached), safeInt(raw.cacheWriteInputTokens ?? raw.cache_write_input_tokens));
  const input = Math.max(0, rawInput - cached - cacheWrite);
  const output = safeInt(raw.outputTokens ?? raw.output_tokens);
  const reasoning = Math.min(output, safeInt(raw.reasoningOutputTokens ?? raw.reasoning_output_tokens));
  const total = input + cached + cacheWrite + output;
  return { input, cached, cacheWrite, output, reasoning, total };
}

function diffTokens(current: ActivityTokenTotals, previous: ActivityTokenTotals): ActivityTokenTotals {
  const input = Math.max(0, current.input - previous.input);
  const cached = Math.max(0, current.cached - previous.cached);
  const cacheWrite = Math.max(0, current.cacheWrite - previous.cacheWrite);
  const output = Math.max(0, current.output - previous.output);
  const reasoning = Math.max(0, current.reasoning - previous.reasoning);
  return { input, cached, cacheWrite, output, reasoning, total: input + cached + cacheWrite + output };
}

// Tracks cumulative per-thread Codex usage so multi-step tool turns never double-count
// earlier steps and resumed threads after a server restart never re-count prior turns.
export class CodexUsageTracker {
  private totals = new Map<string, ActivityTokenTotals>();

  seedThread(threadId: string) {
    if (threadId) this.totals.set(threadId, zeroTokens());
  }

  seedBaseline(threadId: string, tokenUsage: any) {
    if (!threadId || !tokenUsage || typeof tokenUsage !== 'object') return;
    const total = parseCodexBreakdown(tokenUsage.total);
    if (total) this.totals.set(threadId, total);
  }

  forgetThread(threadId: string) {
    this.totals.delete(threadId);
  }

  clear() {
    this.totals.clear();
  }

  consume(threadId: string, tokenUsage: any): ActivityTokenTotals | null {
    if (!threadId || !tokenUsage || typeof tokenUsage !== 'object') return null;
    const total = parseCodexBreakdown(tokenUsage.total);
    const last = parseCodexBreakdown(tokenUsage.last);
    if (total) {
      const previous = this.totals.get(threadId);
      this.totals.set(threadId, total);
      if (previous && total.total >= previous.total) {
        const delta = diffTokens(total, previous);
        return delta.total > 0 ? delta : null;
      }
      const fallback = last ?? total;
      return fallback.total > 0 ? fallback : null;
    }
    return last && last.total > 0 ? last : null;
  }
}

type PricedModel = Pick<Model<Api>, 'id' | 'provider' | 'cost'>;
let catalogByProvider: Map<string, Map<string, PricedModel>> | null = null;

function pricedCatalog() {
  if (catalogByProvider) return catalogByProvider;
  catalogByProvider = new Map();
  for (const provider of getProviders()) {
    const entries = new Map<string, PricedModel>();
    for (const model of getModels(provider)) {
      if (model.cost.input > 0 || model.cost.output > 0 || model.cost.cacheRead > 0 || model.cost.cacheWrite > 0) {
        entries.set(model.id, model);
      }
    }
    if (entries.size) catalogByProvider.set(provider, entries);
  }
  return catalogByProvider;
}

const AGENT_PROVIDERS: Partial<Record<AgentId, KnownProvider[]>> = {
  codex: ['openai-codex', 'openai'],
  collaboration: ['openai-codex', 'openai'],
  claude: ['anthropic'],
  deepseek: ['deepseek'],
  kimi: ['moonshotai', 'moonshotai-cn'],
  grok: ['xai'],
  antigravity: ['google', 'google-vertex', 'anthropic'],
  copilot: ['openai-codex', 'openai', 'anthropic', 'google', 'google-vertex', 'xai'],
  cursor: ['anthropic', 'openai-codex', 'openai', 'google', 'xai'],
  opencode: ['opencode', 'opencode-go', 'anthropic', 'openai-codex', 'openai', 'google', 'deepseek', 'moonshotai', 'xai'],
  papilot: ['openai-codex', 'anthropic', 'openai', 'google', 'google-vertex', 'deepseek', 'xai', 'moonshotai', 'mistral', 'openrouter'],
  pi: ['openai-codex', 'anthropic', 'openai', 'google', 'google-vertex', 'deepseek', 'xai', 'moonshotai', 'mistral', 'openrouter'],
};

const CANONICAL_FALLBACK_PROVIDERS: KnownProvider[] = [
  'openai-codex', 'openai', 'anthropic', 'google', 'google-vertex', 'deepseek', 'moonshotai', 'xai', 'mistral', 'opencode', 'openrouter',
];

function findExactPricedModel(agent: AgentId | null, modelName: string | null): PricedModel | null {
  if (!modelName) return null;
  const trimmed = modelName.trim();
  if (!trimmed) return null;
  const catalog = pricedCatalog();
  const slash = trimmed.indexOf('/');
  if (slash > 0) {
    const provider = trimmed.slice(0, slash), id = trimmed.slice(slash + 1);
    const direct = catalog.get(provider)?.get(id);
    if (direct) return direct;
    const openrouter = catalog.get('openrouter')?.get(trimmed);
    if (openrouter) return openrouter;
    // Subscription wrappers such as github-copilot carry 0 built-in rates in pi-ai;
    // match the exact underlying model ID against first-party API catalogs only.
    for (const candidate of CANONICAL_FALLBACK_PROVIDERS) {
      const found = catalog.get(candidate)?.get(id);
      if (found) return found;
    }
    return null;
  }
  const providers = (agent && AGENT_PROVIDERS[agent]) || CANONICAL_FALLBACK_PROVIDERS;
  for (const provider of providers) {
    const found = catalog.get(provider)?.get(trimmed);
    if (found) return found;
  }
  return null;
}

export function estimateModelCostUsd(agent: AgentId | null, modelName: string | null, tokens: ActivityTokenTotals): number | null {
  if (tokens.total <= 0) return null;
  const model = findExactPricedModel(agent, modelName);
  if (!model) return null;
  const usd = (
    model.cost.input * tokens.input +
    model.cost.cacheRead * tokens.cached +
    model.cost.cacheWrite * tokens.cacheWrite +
    model.cost.output * tokens.output
  ) / 1_000_000;
  return Number.isFinite(usd) && usd >= 0 ? usd : null;
}

export interface NormalizedUsageEvent {
  model: string | null;
  tokens: ActivityTokenTotals;
  costUsd: number | null;
  costSource: 'reported' | 'estimated' | 'unknown';
}

export function normalizeTurnUsage(agent: AgentId | null, fallbackModel: string | null, raw: any, explicitModel?: string | null): NormalizedUsageEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const model = (typeof explicitModel === 'string' && explicitModel.trim())
    || (typeof raw.model === 'string' && raw.model.trim())
    || (typeof fallbackModel === 'string' && fallbackModel.trim())
    || null;
  const rawInput = safeInt(raw.input ?? raw.inputTokens ?? raw.input_tokens ?? raw.prompt_tokens);
  const cached = safeInt(
    raw.cached ?? raw.cacheRead ?? raw.cachedReadTokens ?? raw.cacheReadInputTokens ??
    raw.cache_read_input_tokens ?? raw.cached_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? raw.input_tokens_details?.cached_tokens,
  );
  const cacheWrite = safeInt(
    raw.cacheWrite ?? raw.cachedWriteTokens ?? raw.cacheCreationInputTokens ?? raw.cache_creation_input_tokens,
  );
  const output = safeInt(raw.output ?? raw.outputTokens ?? raw.output_tokens ?? raw.completion_tokens);
  const reasoning = Math.min(output, safeInt(
    raw.reasoning ?? raw.thinkingTokens ?? raw.thoughtTokens ?? raw.reasoning_tokens ??
    raw.completion_tokens_details?.reasoning_tokens ?? raw.output_tokens_details?.reasoning_tokens,
  ));
  const rawTotal = safeInt(raw.total ?? raw.totalTokens ?? raw.total_tokens);
  const inclusiveInput = raw.input === undefined && (cached + cacheWrite > 0) && (
    raw.prompt_tokens !== undefined ||
    (rawTotal > 0 && rawInput >= cached + cacheWrite && rawInput + output === rawTotal)
  );
  const input = inclusiveInput ? Math.max(0, rawInput - cached - cacheWrite) : rawInput;
  const computedTotal = input + cached + cacheWrite + output;
  const total = computedTotal > 0 ? computedTotal : rawTotal;
  if (total <= 0) return null;
  const tokens: ActivityTokenTotals = {
    input: computedTotal > 0 ? input : total,
    cached,
    cacheWrite,
    output,
    reasoning,
    total,
  };
  const rawCost = typeof raw.costUsd === 'number' && Number.isFinite(raw.costUsd) && raw.costUsd >= 0 ? raw.costUsd : null;
  if (rawCost !== null && raw.costSource === 'reported') return { model, tokens, costUsd: rawCost, costSource: 'reported' };
  if (rawCost !== null && raw.costSource === 'estimated') return { model, tokens, costUsd: rawCost, costSource: 'estimated' };
  const estimated = estimateModelCostUsd(agent, model, tokens);
  if (estimated !== null) return { model, tokens, costUsd: estimated, costSource: 'estimated' };
  return { model, tokens, costUsd: null, costSource: 'unknown' };
}

export function normalizeCodexUsage(agent: AgentId, model: string | null, tokens: ActivityTokenTotals): NormalizedUsageEvent | null {
  if (tokens.total <= 0) return null;
  const estimated = estimateModelCostUsd(agent, model, tokens);
  return {
    model: model?.trim() || null,
    tokens,
    costUsd: estimated,
    costSource: estimated !== null ? 'estimated' : 'unknown',
  };
}

// One-time historical backfill when upgrading an existing workspace database.
export function backfillActivity(store: Store) {
  if (store.preference<boolean>('activity-backfilled-v1')) return;
  const projects = new Map(store.projects().map(project => [project.id, project.name]));
  const tasks = store.tasks();
  const tasksById = new Map(tasks.map(task => [task.id, task]));

  for (const task of tasks) {
    const projectName = projects.get(task.projectId);
    // Decisions of the latest round that feedback already sent back.
    const sent = { accepted: 0, rejected: 0, commented: 0 };
    store.recordActivity({
      key: `task:${task.id}`,
      at: task.createdAt || Date.now(),
      kind: 'task_started',
      projectId: task.projectId,
      taskId: task.id,
      agent: task.agent || 'codex',
      model: task.model,
      data: { mode: task.mode === 'review' ? 'review' : 'edit', title: task.title, ...(projectName ? { projectName } : {}) },
    });
    if (task.delivery && !task.delivery.pending && task.delivery.mode !== 'branch') {
      store.recordActivity({
        key: `delivery:${task.id}:${task.delivery.accepted || task.delivery.commit || task.delivery.mode}`,
        at: task.updatedAt || task.createdAt || Date.now(),
        kind: 'task_delivered',
        projectId: task.projectId,
        taskId: task.id,
        agent: task.agent || 'codex',
        model: task.model,
        data: { mode: task.delivery.mode === 'commit' ? 'commit' : 'workspace', ...(projectName ? { projectName } : {}) },
      });
    }
    for (const item of store.items(task.id)) {
      if (item.type !== 'user') continue;
      if (item.meta?.notes?.length) {
        store.recordActivity({
          key: `notes-sent:${item.id}`,
          at: item.createdAt || task.createdAt || Date.now(),
          kind: 'annotations_sent',
          projectId: task.projectId,
          taskId: task.id,
          agent: task.agent || 'codex',
          model: task.model,
          data: { count: item.meta.notes.length, ...(projectName ? { projectName } : {}) },
        });
      }
      const feedback = item.meta?.feedback;
      if (feedback) {
        if (task.review && feedback.round === task.review.round) {
          sent.accepted += feedback.accepted;
          sent.rejected += feedback.rejected;
          sent.commented += feedback.comments?.length || 0;
        }
        if (feedback.accepted > 0) {
          store.recordActivity({
            key: `backfill:feedback:${item.id}:accept`,
            at: item.createdAt || task.updatedAt || Date.now(),
            kind: 'review_decision',
            projectId: task.projectId,
            taskId: task.id,
            agent: task.agent || 'codex',
            model: task.model,
            data: { action: 'accept', count: feedback.accepted, source: 'task', ...(projectName ? { projectName } : {}) },
          });
        }
        if (feedback.rejected > 0) {
          store.recordActivity({
            key: `backfill:feedback:${item.id}:reject`,
            at: item.createdAt || task.updatedAt || Date.now(),
            kind: 'review_decision',
            projectId: task.projectId,
            taskId: task.id,
            agent: task.agent || 'codex',
            model: task.model,
            data: { action: 'reject', count: feedback.rejected, source: 'task', ...(projectName ? { projectName } : {}) },
          });
        }
        if (feedback.comments?.length) {
          store.recordActivity({
            key: `backfill:feedback:${item.id}:comment`,
            at: item.createdAt || task.updatedAt || Date.now(),
            kind: 'review_decision',
            projectId: task.projectId,
            taskId: task.id,
            agent: task.agent || 'codex',
            model: task.model,
            data: { action: 'comment', count: feedback.comments.length, source: 'task', ...(projectName ? { projectName } : {}) },
          });
        }
      }
    }
    // Review counts cover only the latest round: add the decisions no feedback
    // has sent back yet, whether the task had one round or later ones.
    if (task.review?.counts) {
      for (const [field, action] of [['accepted', 'accept'], ['rejected', 'reject'], ['commented', 'comment']] as const) {
        const count = safeInt(task.review.counts[field]) - sent[field];
        if (count <= 0) continue;
        store.recordActivity({
          key: `backfill:review:${task.id}:${action}`,
          at: task.updatedAt || task.createdAt || Date.now(),
          kind: 'review_decision',
          projectId: task.projectId,
          taskId: task.id,
          agent: task.agent || 'codex',
          model: task.model,
          data: { action, count, source: 'task', ...(projectName ? { projectName } : {}) },
        });
      }
    }
  }

  for (const run of store.runs()) {
    if (run.status === 'queued') continue;
    const task = tasksById.get(run.taskId);
    const projectName = task ? projects.get(task.projectId) : undefined;
    store.recordActivity({
      key: `turn:${run.id}`,
      at: run.createdAt || Date.now(),
      kind: 'agent_turn',
      projectId: task?.projectId,
      taskId: run.taskId,
      agent: task?.agent || 'codex',
      model: task?.model,
      data: {
        role: task?.mode === 'review' ? 'review' : 'edit',
        status: run.status,
        finishedAt: run.finishedAt,
        ...(projectName ? { projectName } : {}),
      },
    });
  }

  for (const [projectId, projectName] of projects) {
    for (const note of store.annotations(projectId, true)) {
      if (note.returnAction) continue;
      if (note.aiReview?.sourceId) {
        const reviewTask = tasksById.get(note.aiReview.taskId);
        store.recordActivity({
          key: `decision:ai-review:${note.aiReview.taskId}:${note.aiReview.sourceId}:copy`,
          at: note.createdAt || Date.now(),
          kind: 'review_decision',
          projectId,
          taskId: note.aiReview.taskId,
          agent: note.aiReview.agent,
          model: reviewTask?.model,
          data: { action: 'accept', count: 1, source: 'ai-review', projectName },
        });
        continue;
      }
      const source = isTaskReviewNote(note) ? 'ai-review' : note.agentAnnotation ? 'agent' : 'author';
      const linkedTask = note.aiReview ? tasksById.get(note.aiReview.taskId) : note.agentAnnotation ? tasksById.get(note.agentAnnotation.taskId) : undefined;
      store.recordActivity({
        key: `note:${note.id}`,
        at: note.createdAt || Date.now(),
        kind: 'annotation_created',
        projectId,
        taskId: linkedTask?.id ?? note.aiReview?.taskId ?? note.agentAnnotation?.taskId,
        agent: note.aiReview?.agent ?? linkedTask?.agent,
        model: linkedTask?.model,
        data: { source, ...(note.group ? { group: note.group } : {}), ...(note.kind ? { markKind: note.kind } : {}), projectName },
      });
      if (isTaskReviewNote(note) && note.deletedAt !== undefined && !note.aiReview?.copiedTo) {
        store.recordActivity({
          key: `decision:ai-review:${note.aiReview!.taskId}:${note.id}`,
          at: note.deletedAt,
          kind: 'review_decision',
          projectId,
          taskId: note.aiReview!.taskId,
          agent: note.aiReview!.agent,
          model: linkedTask?.model,
          data: { action: 'reject', count: 1, source: 'ai-review', projectName },
        });
      }
    }
  }

  store.savePreference('activity-backfilled-v1', true);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

export function resolveTimezone(requested?: string): string {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (!requested || typeof requested !== 'string' || requested.length > 80) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: requested });
    return requested;
  } catch {
    return fallback;
  }
}

function getFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    if (formatters.size > 32) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function localDateHour(epochMs: number, timeZone: string): { date: string; hour: number } {
  const parts = getFormatter(timeZone).formatToParts(new Date(epochMs));
  let year = '1970', month = '01', day = '01', hour = 0;
  for (const part of parts) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
    else if (part.type === 'hour') hour = Math.min(23, Math.max(0, Number(part.value) % 24));
  }
  return { date: `${year}-${month}-${day}`, hour };
}

function shiftCalendarDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return utc.toISOString().slice(0, 10);
}

function blankMetrics(): ActivityMetrics {
  return {
    tokens: zeroTokens(),
    costUsd: null,
    reportedCostUsd: 0,
    estimatedCostUsd: 0,
    pricedTokens: 0,
    unpricedTokens: 0,
    tasksStarted: 0,
    editTasksStarted: 0,
    reviewTasksStarted: 0,
    turns: 0,
    completedTurns: 0,
    failedTurns: 0,
    interruptedTurns: 0,
    turnsByRole: { edit: 0, review: 0, worker: 0, helper: 0 },
    accepted: 0,
    rejected: 0,
    commented: 0,
    undone: 0,
    tasksApplied: 0,
    tasksCommitted: 0,
    gitCommits: 0,
    annotationsCreated: 0,
    authorAnnotations: 0,
    agentAnnotations: 0,
    aiReviewAnnotations: 0,
    annotationsSent: 0,
  };
}

function blankDay(date: string): ActivityDay {
  return {
    date,
    ...blankMetrics(),
    hours: Array(24).fill(0),
    turnHours: Array(24).fill(0),
    tokenHours: Array(24).fill(0),
  };
}

type CountedMetric = { [K in keyof ActivityMetrics]: ActivityMetrics[K] extends number ? K : never }[keyof ActivityMetrics];
const COUNTED_METRICS = Object.entries(blankMetrics())
  .filter(([, value]) => typeof value === 'number')
  .map(([key]) => key as CountedMetric);

// Totals are the sum of the selected range's days; costUsd is settled by the caller.
function addMetrics(target: ActivityMetrics, source: ActivityMetrics) {
  addTokens(target.tokens, source.tokens);
  for (const role of Object.keys(target.turnsByRole) as ActivityTurnRole[]) target.turnsByRole[role] += source.turnsByRole[role];
  for (const key of COUNTED_METRICS) target[key] += source[key];
}

const hasDayActivity = (day: ActivityDay) =>
  day.tokens.total > 0 ||
  day.tasksStarted > 0 ||
  day.turns > 0 ||
  day.accepted > 0 ||
  day.rejected > 0 ||
  day.commented > 0 ||
  day.undone > 0 ||
  day.tasksApplied > 0 ||
  day.tasksCommitted > 0 ||
  day.gitCommits > 0 ||
  day.annotationsCreated > 0 ||
  day.annotationsSent > 0;

export function resolveActivityRange(value?: string): ActivityRange {
  return value && ACTIVITY_RANGES.includes(value as ActivityRange) ? value as ActivityRange : '30d';
}

export function buildActivityReport(
  store: Store,
  options: { tz?: string; projectId?: string; range?: string; now?: number } = {},
): ActivityReport {
  const timezone = resolveTimezone(options.tz);
  const range = resolveActivityRange(options.range);
  const generatedAt = options.now ?? Date.now();
  const { date: today } = localDateHour(generatedAt, timezone);
  const windowDays = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 0;
  const startDate = windowDays > 0 ? shiftCalendarDate(today, -(windowDays - 1)) : null;

  const knownProjects = store.projects();
  const projectMap = new Map<string, ActivityProjectSummary>(
    knownProjects.map(project => [project.id, {
      id: project.id,
      name: project.name,
      tasksStarted: 0,
      turns: 0,
      tokens: 0,
      costUsd: null,
      accepted: 0,
      rejected: 0,
      annotationsCreated: 0,
    }]),
  );
  const projectHasCost = new Set<string>();

  const selectedProject = options.projectId && options.projectId.trim() ? options.projectId.trim() : null;
  const events = store.activityEvents();

  const daysByDate = new Map<string, ActivityDay>();
  const dayHasCost = new Set<string>();

  const agentsMap = new Map<AgentId, ActivityAgentSummary & { hasCost: boolean }>();
  const modelsMap = new Map<string, ActivityModelSummary & { hasReported: boolean; hasEstimated: boolean }>();

  const getDay = (date: string) => {
    let day = daysByDate.get(date);
    if (!day) {
      day = blankDay(date);
      daysByDate.set(date, day);
    }
    return day;
  };

  const getAgent = (id: AgentId) => {
    let entry = agentsMap.get(id);
    if (!entry) {
      entry = {
        agent: id,
        tasksStarted: 0,
        turns: 0,
        tokens: zeroTokens(),
        costUsd: null,
        reportedCostUsd: 0,
        estimatedCostUsd: 0,
        unpricedTokens: 0,
        hasCost: false,
      };
      agentsMap.set(id, entry);
    }
    return entry;
  };

  const getModel = (agent: AgentId, model: string) => {
    const key = `${agent}\0${model}`;
    let entry = modelsMap.get(key);
    if (!entry) {
      entry = {
        agent,
        model,
        turns: 0,
        tokens: zeroTokens(),
        costUsd: null,
        costSource: 'unknown',
        hasReported: false,
        hasEstimated: false,
      };
      modelsMap.set(key, entry);
    }
    return entry;
  };

  // Days in the selected range feed the totals, papers, agents and models; days
  // of the past-year calendar feed the heatmap whatever the range.
  const inRange = (date: string) => !startDate || (date >= startDate && date <= today);
  const calendarStart = shiftCalendarDate(today, -(ACTIVITY_CALENDAR_DAYS - 1));
  const inCalendar = (date: string) => date >= calendarStart && date <= today;

  for (const event of events) {
    const { date, hour } = localDateHour(event.at, timezone);
    const counted = inRange(date);
    if (!counted && !inCalendar(date)) {
      // Still track undone events whose undo happened inside the selected range.
      if (event.kind === 'review_decision' && event.undoneAt !== null && (!selectedProject || event.projectId === selectedProject)) {
        const undoneSlot = localDateHour(event.undoneAt, timezone);
        if (inRange(undoneSlot.date)) getDay(undoneSlot.date).undone += Math.max(1, safeInt(event.data.count) || 1);
      }
      continue;
    }

    const agentId = event.agent && isAgentId(event.agent) ? event.agent : null;
    const modelName = typeof event.model === 'string' && event.model.trim() ? event.model.trim() : null;
    let resolvedUsage: { delta: ActivityTokenTotals; costUsd: number | null; costSource: 'reported' | 'estimated' | 'unknown' } | null = null;
    if (event.kind === 'token_usage') {
      const rawTokens = event.data.tokens || {};
      const delta: ActivityTokenTotals = {
        input: safeInt(rawTokens.input),
        cached: safeInt(rawTokens.cached),
        cacheWrite: safeInt(rawTokens.cacheWrite),
        output: safeInt(rawTokens.output),
        reasoning: safeInt(rawTokens.reasoning),
        total: safeInt(rawTokens.total),
      };
      if (delta.total <= 0) continue;
      let costUsd = typeof event.data.costUsd === 'number' && Number.isFinite(event.data.costUsd) && event.data.costUsd >= 0
        ? event.data.costUsd
        : null;
      let costSource: 'reported' | 'estimated' | 'unknown' = event.data.costSource === 'reported'
        ? 'reported'
        : event.data.costSource === 'estimated'
        ? 'estimated'
        : 'unknown';
      if (costUsd === null) {
        const estimated = estimateModelCostUsd(agentId, modelName, delta);
        if (estimated !== null) {
          costUsd = estimated;
          costSource = 'estimated';
        }
      }
      resolvedUsage = { delta, costUsd, costSource };
    }

    // Populate per-paper summaries across all papers in the chosen date range so the paper selector stays complete.
    if (counted && event.projectId) {
      let projectSummary = projectMap.get(event.projectId);
      if (!projectSummary) {
        projectSummary = {
          id: event.projectId,
          name: typeof event.data.projectName === 'string' && event.data.projectName.trim() ? event.data.projectName.trim() : event.projectId.slice(0, 8),
          removed: true,
          tasksStarted: 0,
          turns: 0,
          tokens: 0,
          costUsd: null,
          accepted: 0,
          rejected: 0,
          annotationsCreated: 0,
        };
        projectMap.set(event.projectId, projectSummary);
      } else if (projectSummary.removed && typeof event.data.projectName === 'string' && event.data.projectName.trim()) {
        projectSummary.name = event.data.projectName.trim();
      }
      if (event.kind === 'task_started') projectSummary.tasksStarted++;
      else if (event.kind === 'agent_turn') projectSummary.turns++;
      else if (event.kind === 'token_usage' && resolvedUsage) {
        projectSummary.tokens += resolvedUsage.delta.total;
        if (resolvedUsage.costUsd !== null) {
          projectSummary.costUsd = (projectSummary.costUsd ?? 0) + resolvedUsage.costUsd;
          projectHasCost.add(event.projectId);
        }
      } else if (event.kind === 'review_decision' && event.undoneAt === null) {
        const count = Math.max(1, safeInt(event.data.count) || 1);
        if (event.data.action === 'accept') projectSummary.accepted += count;
        else if (event.data.action === 'reject') projectSummary.rejected += count;
      } else if (event.kind === 'annotation_created') {
        projectSummary.annotationsCreated++;
      }
    }

    if (selectedProject && event.projectId !== selectedProject) continue;

    const day = getDay(date);
    const agent = counted ? agentId : null;

    if (event.kind === 'task_started') {
      day.tasksStarted++;
      if (event.data.mode === 'review') day.reviewTasksStarted++;
      else day.editTasksStarted++;
      if (agent) getAgent(agent).tasksStarted++;
    } else if (event.kind === 'agent_turn') {
      const role: ActivityTurnRole = ['edit', 'review', 'worker', 'helper'].includes(event.data.role) ? event.data.role : 'edit';
      const status = event.data.status;
      day.turns++;
      day.turnsByRole[role]++;
      if (status === 'completed') day.completedTurns++;
      else if (status === 'failed') day.failedTurns++;
      else if (status === 'interrupted') day.interruptedTurns++;
      day.hours[hour]++;
      day.turnHours[hour]++;
      if (agent) {
        getAgent(agent).turns++;
        if (modelName) getModel(agent, modelName).turns++;
      }
    } else if (event.kind === 'token_usage' && resolvedUsage) {
      const { delta, costUsd, costSource } = resolvedUsage;
      addTokens(day.tokens, delta);
      day.tokenHours[hour] += delta.total;

      if (costUsd !== null) {
        dayHasCost.add(date);
        day.pricedTokens += delta.total;
        if (costSource === 'reported') day.reportedCostUsd += costUsd;
        else day.estimatedCostUsd += costUsd;
      } else {
        day.unpricedTokens += delta.total;
      }

      if (agent) {
        const agentEntry = getAgent(agent);
        addTokens(agentEntry.tokens, delta);
        if (costUsd !== null) {
          agentEntry.hasCost = true;
          if (costSource === 'reported') agentEntry.reportedCostUsd += costUsd;
          else agentEntry.estimatedCostUsd += costUsd;
        } else {
          agentEntry.unpricedTokens += delta.total;
        }
        if (modelName) {
          const modelEntry = getModel(agent, modelName);
          addTokens(modelEntry.tokens, delta);
          if (costUsd !== null) {
            modelEntry.costUsd = (modelEntry.costUsd ?? 0) + costUsd;
            if (costSource === 'reported') modelEntry.hasReported = true;
            else modelEntry.hasEstimated = true;
          }
        }
      }
    } else if (event.kind === 'review_decision') {
      const count = Math.max(1, safeInt(event.data.count) || 1);
      if (event.undoneAt !== null) {
        const undoneSlot = localDateHour(event.undoneAt, timezone);
        if (inRange(undoneSlot.date)) getDay(undoneSlot.date).undone += count;
        continue;
      }
      const action = event.data.action;
      if (action === 'accept') day.accepted += count;
      else if (action === 'reject') day.rejected += count;
      else if (action === 'comment') day.commented += count;
      day.hours[hour]++;
    } else if (event.kind === 'annotation_created') {
      const source = event.data.source;
      day.annotationsCreated++;
      if (source === 'ai-review') day.aiReviewAnnotations++;
      else if (source === 'agent') day.agentAnnotations++;
      else {
        day.authorAnnotations++;
        day.hours[hour]++;
      }
    } else if (event.kind === 'annotations_sent') {
      day.annotationsSent += Math.max(1, safeInt(event.data.count) || 1);
    } else if (event.kind === 'task_delivered') {
      if (event.data.mode === 'commit') day.tasksCommitted++;
      else day.tasksApplied++;
      day.hours[hour]++;
    } else if (event.kind === 'git_commit') {
      day.gitCommits++;
      day.hours[hour]++;
    }
  }

  const totals: ActivityTotals = { ...blankMetrics(), activeDays: 0 };
  const hours = Array<number>(24).fill(0);
  const turnHours = Array<number>(24).fill(0);
  const tokenHours = Array<number>(24).fill(0);
  let totalHasCost = false;
  for (const [date, day] of daysByDate) {
    day.costUsd = dayHasCost.has(date) ? day.reportedCostUsd + day.estimatedCostUsd : null;
    if (!inRange(date)) continue;
    addMetrics(totals, day);
    for (let h = 0; h < 24; h++) {
      hours[h] += day.hours[h];
      turnHours[h] += day.turnHours[h];
      tokenHours[h] += day.tokenHours[h];
    }
    if (day.costUsd !== null) totalHasCost = true;
  }
  totals.costUsd = totalHasCost ? totals.reportedCostUsd + totals.estimatedCostUsd : null;

  const activeDays = [...daysByDate.values()].filter(hasDayActivity).sort((a, b) => a.date.localeCompare(b.date));
  const days = activeDays.filter(day => inRange(day.date));
  totals.activeDays = days.length;

  const calendar: ActivityCalendarDay[] = activeDays
    .filter(day => inCalendar(day.date))
    .map(day => ({
      date: day.date,
      tokens: day.tokens.total,
      costUsd: day.costUsd,
      reportedCostUsd: day.reportedCostUsd,
      estimatedCostUsd: day.estimatedCostUsd,
      turns: day.turns,
      accepted: day.accepted,
      rejected: day.rejected,
      commented: day.commented,
      annotationsCreated: day.annotationsCreated,
    }));

  const agents: ActivityAgentSummary[] = [...agentsMap.values()]
    .map(({ hasCost, ...entry }) => ({
      ...entry,
      costUsd: hasCost ? entry.reportedCostUsd + entry.estimatedCostUsd : null,
    }))
    .sort((a, b) => b.tokens.total - a.tokens.total || b.turns - a.turns || b.tasksStarted - a.tasksStarted);

  const models: ActivityModelSummary[] = [...modelsMap.values()]
    .map(({ hasReported, hasEstimated, ...entry }) => {
      const costSource: ActivityCostSource = hasReported && hasEstimated
        ? 'mixed'
        : hasReported
        ? 'reported'
        : hasEstimated
        ? 'estimated'
        : 'unknown';
      return { ...entry, costSource };
    })
    .sort((a, b) => b.tokens.total - a.tokens.total || b.turns - a.turns);

  const projects = [...projectMap.values()]
    .map(project => ({
      ...project,
      costUsd: projectHasCost.has(project.id) ? project.costUsd : null,
    }))
    .filter(project => !project.removed || project.tasksStarted > 0 || project.turns > 0 || project.tokens > 0 || project.accepted > 0 || project.rejected > 0 || project.annotationsCreated > 0);

  return {
    timezone,
    today,
    range,
    generatedAt,
    projectId: selectedProject,
    projects,
    totals,
    hours,
    turnHours,
    tokenHours,
    days,
    calendar,
    agents,
    models,
  };
}
