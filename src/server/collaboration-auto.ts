import {
  COLLABORATION_ROLES,
  COLLABORATION_WORKERS,
  MAX_COLLABORATION_RACERS,
  type AgentId,
  type AgentModel,
  type CollaborationConfig,
  type CollaborationResolved,
  type CollaborationRole,
  type CollaborationRoute,
  type CollaborationWorkerAgent,
  type RuntimeStatus,
} from '../shared.ts';

export type ModelFamily = 'openai' | 'google' | 'anthropic' | 'deepseek' | 'moonshot' | 'qwen' | 'zhipu' | 'xai' | 'other';

export interface CandidateModel {
  agent: CollaborationWorkerAgent;
  model: AgentModel;
  family: ModelFamily;
  readOnly: boolean;
  quotaReached: boolean;
}

export function modelFamily(agent: CollaborationWorkerAgent, id: string, name = ''): ModelFamily {
  const text = `${id} ${name}`.toLowerCase();
  if (/\bdeepseek\b|\bdsh\b/.test(text)) return 'deepseek';
  if (/\bclaude\b|\bopus\b|\bsonnet\b|\bhaiku\b|\banthropic\b/.test(text)) return 'anthropic';
  if (/\bgemini\b|\bgoogle\b|\bvertex\b/.test(text)) return 'google';
  if (/\bgpt\b|\bcodex\b|\bopenai\b|\bo[134](?:-|\b)/.test(text)) return 'openai';
  if (/\bkimi\b|\bmoonshot\b/.test(text)) return 'moonshot';
  if (/\bqwen\b|\bqwq\b/.test(text)) return 'qwen';
  if (/\bglm\b|\bzhipu\b|\bzai\b/.test(text)) return 'zhipu';
  if (/\bgrok\b|\bxai\b/.test(text)) return 'xai';
  if (agent === 'codex') return 'openai';
  if (agent === 'claude') return 'anthropic';
  if (agent === 'deepseek') return 'deepseek';
  if (agent === 'kimi') return 'moonshot';
  if (agent === 'qwen') return 'qwen';
  if (agent === 'glm') return 'zhipu';
  if (agent === 'grok') return 'xai';
  if (agent === 'antigravity') return 'google';
  return 'other';
}

const isCustomWriterModel = (agent: CollaborationWorkerAgent, id: string) => agent === 'papilot' && id.startsWith('custom/');

export function routeKey(route: CollaborationRoute) {
  return `${route.agent}\0${route.model || ''}\0${route.effort || ''}\0${route.serviceTier || ''}`;
}

export function eligibleModels(
  runtimes: Partial<Record<AgentId, RuntimeStatus>>,
  readOnlyAgents?: Partial<Record<CollaborationWorkerAgent, boolean>>,
): CandidateModel[] {
  const list: CandidateModel[] = [];
  for (const agent of COLLABORATION_WORKERS) {
    const runtime = runtimes[agent];
    if (!runtime || runtime.hidden || runtime.installed === false || !runtime.connected || !runtime.authenticated) continue;
    const hidden = new Set(runtime.hiddenModels || []);
    const readOnly = readOnlyAgents?.[agent] !== false;
    const quotaReached = Boolean(runtime.usage?.reached);
    for (const model of runtime.models || []) {
      if (!model?.id || hidden.has(model.id) || isCustomWriterModel(agent, model.id)) continue;
      list.push({ agent, model, family: modelFamily(agent, model.id, model.name), readOnly, quotaReached });
    }
  }
  return list;
}

function textOf(candidate: CandidateModel) {
  return `${candidate.model.id} ${candidate.model.name}`.toLowerCase();
}

const isOrchestrator = (text: string) => /\borchestrator\b/.test(text);
const isFastModel = (text: string) => /\b(ultrafast|ultra[- ]?fast|flash|mini|haiku|nano|lite|fast|spark|instant)\b/.test(text);
const isReasoner = (text: string) => /\b(reasoner|r1|thinking|o1|o3|o4)\b/.test(text);

function pickEffort(model: AgentModel, preferred: string[]): string | null {
  if (!model.efforts?.length) return null;
  for (const level of preferred) if (model.efforts.includes(level)) return level;
  return model.defaultEffort && model.efforts.includes(model.defaultEffort) ? model.defaultEffort : model.efforts[0];
}

function toRoute(candidate: CandidateModel, effortPreference: string[], wantFastTier = false): CollaborationRoute {
  const effort = pickEffort(candidate.model, effortPreference);
  const serviceTier = wantFastTier && candidate.agent === 'codex' && candidate.model.fastMode ? candidate.model.fastMode.serviceTier : undefined;
  return { agent: candidate.agent, model: candidate.model.id, effort, ...(serviceTier ? { serviceTier } : {}) };
}

function fastScore(candidate: CandidateModel): number {
  const text = textOf(candidate);
  let score = 0;
  if (candidate.quotaReached) score -= 120;
  if (isOrchestrator(text)) score -= 90;
  if (/ultrafast|ultra[- ]?fast/.test(text)) score += 75;
  else if (/\bflash\b/.test(text)) score += 52;
  else if (/\b(mini|haiku|nano|lite|instant|spark)\b/.test(text)) score += 42;
  else if (/\bfast\b/.test(text)) score += 32;
  if (candidate.family === 'deepseek') score += 22;
  if (candidate.agent === 'deepseek') score += 10;
  if (/\bv4\.1\b/.test(text)) score += 8;
  if (/\bopus\b|\bpro\b|\bneon\b|\bmax\b|\bREASONER\b/i.test(text) && !isFastModel(text)) score -= 25;
  if (candidate.model.isDefault) score += 4;
  return score;
}

function rigorousScore(candidate: CandidateModel): number {
  const text = textOf(candidate);
  let score = 0;
  if (candidate.quotaReached) score -= 120;
  if (isOrchestrator(text)) score -= 90;
  if (isFastModel(text) && !/\bcodex\b|\bsol\b|\bopus\b/.test(text)) score -= 55;
  if (candidate.family === 'openai') {
    score += 55;
    if (candidate.agent === 'codex') score += 14;
    if (/\bgpt-6\.2\b/.test(text)) score += 18;
    else if (/\bgpt-6\b/.test(text)) score += 12;
    else if (/\bgpt-5\b/.test(text)) score += 8;
    if (/\bsol\b/.test(text)) score += 10;
    if (candidate.model.fastMode) score += 6;
  } else if (candidate.family === 'anthropic') {
    score += 52;
    if (/\bopus\b/.test(text)) score += 14;
    else if (/\bsonnet\b/.test(text)) score += 8;
  } else if (candidate.family === 'google') {
    score += 34;
    if (/\bneon\b|\bpro\b/.test(text)) score += 10;
  } else if (candidate.family === 'deepseek') {
    score += isReasoner(text) ? 40 : 12;
  } else {
    score += 20;
  }
  if (candidate.model.efforts.includes('xhigh')) score += 6;
  else if (candidate.model.efforts.includes('high')) score += 3;
  if (candidate.model.isDefault) score += 6;
  return score;
}

function polishScore(candidate: CandidateModel, rigorousFamily?: ModelFamily): number {
  const text = textOf(candidate);
  let score = 0;
  if (candidate.quotaReached) score -= 120;
  if (isOrchestrator(text)) score -= 90;
  if (isFastModel(text)) score -= 55;
  if (candidate.family === 'google') {
    score += 56;
    if (/\bneon\b/.test(text)) score += 16;
    else if (/\bpro\b|\bcarbon\b|\bargon\b/.test(text)) score += 10;
  } else if (candidate.family === 'anthropic') {
    score += 54;
    if (/\bsonnet\b/.test(text)) score += 12;
    else if (/\bopus\b/.test(text)) score += 10;
  } else if (candidate.family === 'openai') {
    score += 38;
    if (/\bgpt-6\.2\b/.test(text)) score += 10;
  } else if (candidate.family === 'deepseek') {
    score += 14;
  } else {
    score += 22;
  }
  // Prefer a different model family from rigorous so prose and rigor complement each other.
  if (rigorousFamily && candidate.family !== rigorousFamily) score += 28;
  if (candidate.model.efforts.includes('xhigh')) score += 5;
  else if (candidate.model.efforts.includes('high')) score += 3;
  if (candidate.model.isDefault) score += 6;
  return score;
}

function bestOf(candidates: CandidateModel[], score: (c: CandidateModel) => number): CandidateModel | null {
  if (!candidates.length) return null;
  let winner = candidates[0], best = score(winner);
  for (let i = 1; i < candidates.length; i++) {
    const value = score(candidates[i]);
    if (value > best) { winner = candidates[i]; best = value; }
  }
  return winner;
}

function routeAvailable(route: CollaborationRoute | null, runtimes: Partial<Record<AgentId, RuntimeStatus>>, requireReadOnly: boolean, readOnlyAgents?: Partial<Record<CollaborationWorkerAgent, boolean>>) {
  if (!route) return false;
  const runtime = runtimes[route.agent];
  if (!runtime || runtime.hidden || runtime.installed === false || !runtime.connected || !runtime.authenticated) return false;
  if (requireReadOnly && readOnlyAgents?.[route.agent] === false) return false;
  if (route.model && runtime.models.length && !runtime.models.some(model => model.id === route.model) && route.agent !== 'codex') return false;
  return true;
}

function hydrateExplicit(route: CollaborationRoute, runtimes: Partial<Record<AgentId, RuntimeStatus>>): CollaborationRoute {
  const runtime = runtimes[route.agent];
  if (!runtime) return route;
  const model = route.model ? runtime.models.find(item => item.id === route.model) : runtime.models.find(item => item.isDefault);
  const serviceTier = route.agent === 'codex' && route.serviceTier && model?.fastMode?.serviceTier === route.serviceTier ? route.serviceTier : undefined;
  return { agent: route.agent, model: route.model, effort: route.effort, ...(serviceTier ? { serviceTier } : {}) };
}

/** Resolve Auto slots (`null` / empty `racers`) into concrete live host models. */
export function resolveCollaborationConfig(
  config: CollaborationConfig,
  runtimes: Partial<Record<AgentId, RuntimeStatus>>,
  readOnlyAgents?: Partial<Record<CollaborationWorkerAgent, boolean>>,
): CollaborationResolved {
  const all = eligibleModels(runtimes, readOnlyAgents);
  const readOnly = all.filter(candidate => candidate.readOnly);

  const autoRigorous = bestOf(readOnly.length ? readOnly : all, rigorousScore);
  const explicitJudge = config.judge ? hydrateExplicit(config.judge, runtimes) : null;
  const rigorousRoute = config.routes.rigorous
    ? hydrateExplicit(config.routes.rigorous, runtimes)
    : explicitJudge
      ? explicitJudge
      : autoRigorous ? toRoute(autoRigorous, ['xhigh', 'high', 'medium'], true) : null;

  const rigorousFamily = rigorousRoute
    ? modelFamily(rigorousRoute.agent, rigorousRoute.model || '', runtimes[rigorousRoute.agent]?.models.find(m => m.id === rigorousRoute.model)?.name || '')
    : autoRigorous?.family;

  const autoQuick = bestOf(readOnly.length ? readOnly : all, fastScore);
  const explicitRouter = config.router ? hydrateExplicit(config.router, runtimes) : null;
  const quickRoute = config.routes.quick
    ? hydrateExplicit(config.routes.quick, runtimes)
    : explicitRouter
      ? explicitRouter
      : autoQuick ? toRoute(autoQuick, ['low', 'off', 'medium'], true) : rigorousRoute;

  // Router defaults to Quick when Quick is read-only; otherwise picks the fastest read-only model.
  const autoRouter = bestOf(readOnly, fastScore);
  const routerRoute = explicitRouter
    ? explicitRouter
    : routeAvailable(quickRoute, runtimes, true, readOnlyAgents) ? quickRoute
      : autoRouter ? toRoute(autoRouter, ['low', 'off', 'medium'], true) : null;

  // Judge defaults to Rigorous when Rigorous is read-only; otherwise picks the strongest read-only model.
  const autoJudge = bestOf(readOnly, rigorousScore);
  const judgeRoute = explicitJudge
    ? explicitJudge
    : routeAvailable(rigorousRoute, runtimes, true, readOnlyAgents) ? rigorousRoute
      : autoJudge ? toRoute(autoJudge, ['xhigh', 'high', 'medium'], true) : routerRoute;

  // When a custom race pool is configured without an explicit Polish override,
  // derive Polish from the race pool (preferring a racer distinct from Judge).
  const hydratedRacers = config.racers.map(route => hydrateExplicit(route, runtimes)).slice(0, MAX_COLLABORATION_RACERS);
  const judgeKey = judgeRoute ? routeKey(judgeRoute) : '';
  const racerPolish = hydratedRacers.find(r => routeKey(r) !== judgeKey) || hydratedRacers[0] || null;

  const autoPolish = bestOf(all, c => polishScore(c, rigorousFamily));
  const polishRoute = config.routes.polish
    ? hydrateExplicit(config.routes.polish, runtimes)
    : racerPolish
      ? racerPolish
      : autoPolish ? toRoute(autoPolish, ['xhigh', 'high', 'medium'], true) : rigorousRoute;

  // Race pool defaults to cross-family [Rigorous, Polishing] when distinct.
  let racers: CollaborationRoute[] = [];
  if (hydratedRacers.length) {
    racers = hydratedRacers;
  } else {
    const pool: CollaborationRoute[] = [];
    const pushUnique = (route: CollaborationRoute | null) => {
      if (!route) return;
      const key = routeKey(route);
      if (!pool.some(existing => routeKey(existing) === key)) pool.push(route);
    };
    pushUnique(rigorousRoute);
    pushUnique(polishRoute);
    // If rigorous and polish collapsed to the same model, try a second distinct strong model.
    if (pool.length < 2 && all.length >= 2) {
      const firstKey = pool[0] ? routeKey(pool[0]) : '';
      const second = bestOf(
        all.filter(c => routeKey(toRoute(c, ['xhigh', 'high', 'medium'], true)) !== firstKey),
        c => polishScore(c, rigorousFamily),
      );
      if (second) pushUnique(toRoute(second, ['xhigh', 'high', 'medium'], true));
    }
    racers = pool.slice(0, MAX_COLLABORATION_RACERS);
  }

  return {
    router: routerRoute,
    judge: judgeRoute,
    routes: {
      quick: quickRoute,
      polish: polishRoute,
      rigorous: rigorousRoute,
    },
    racers,
  };
}

export function routeDisplayName(route: CollaborationRoute | null, runtimes: Partial<Record<AgentId, RuntimeStatus>>) {
  if (!route) return '';
  const runtime = runtimes[route.agent];
  const model = route.model ? runtime?.models.find(item => item.id === route.model) : runtime?.models.find(item => item.isDefault);
  const label = model?.name || route.model || 'Default';
  const tags = [route.effort, route.serviceTier && route.serviceTier !== 'default' ? 'fast' : null].filter(Boolean);
  return tags.length ? `${label} (${tags.join(', ')})` : label;
}

export function collaborationReady(runtimes: Partial<Record<AgentId, RuntimeStatus>>) {
  const installed = COLLABORATION_WORKERS.some(id => runtimes[id] && runtimes[id]!.installed !== false);
  const ready = COLLABORATION_WORKERS.some(id => {
    const rt = runtimes[id];
    return Boolean(rt && !rt.hidden && rt.installed !== false && rt.connected && rt.authenticated);
  });
  return { installed, ready };
}

export function hasRole(role: string): role is CollaborationRole {
  return (COLLABORATION_ROLES as string[]).includes(role);
}
