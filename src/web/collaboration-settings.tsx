import { useEffect, useId, useRef, useState } from 'react';
import {
  AGENT_NAMES,
  BUILTIN_COLLABORATION_LANES,
  COLLABORATION_ROLES,
  COLLABORATION_WORKERS,
  DEFAULT_COLLABORATION_LANE_DEFS,
  MAX_COLLABORATION_LANES,
  MAX_COLLABORATION_RACERS,
  type AgentId,
  type BuiltinCollaborationLaneId,
  type CollaborationConfig,
  type CollaborationLane,
  type CollaborationResolved,
  type CollaborationRoute,
  type CollaborationSettings as Settings,
  type CollaborationWorkerAgent,
  type RuntimeStatus,
} from '../shared.ts';
import type { SkillIcon } from '../skill-icons.ts';
import { BrandIcon } from './brand-icon.tsx';
import { ChipSelect, type SelectOption } from './chip-select.tsx';
import { EffortSlider } from './effort-slider.tsx';
import { Icon } from './icons.tsx';
import { errorText, t } from './i18n.ts';
import { SkillIconPicker } from './skill-icon-picker.tsx';
import './skill-library.css';

export type CollaborationPatch = {
  enabled?: boolean;
  router?: CollaborationRoute | null;
  judge?: CollaborationRoute | null;
  routes?: Settings['routes'];
  racers?: CollaborationRoute[];
  lanes?: CollaborationLane[];
  reset?: boolean;
};

export interface CollaborationSettingsProps {
  enabled: boolean;
  online: boolean;
  runtimes: Partial<Record<AgentId, RuntimeStatus>>;
  load: () => Promise<Settings>;
  save: (change: CollaborationPatch) => Promise<Settings>;
}

type NodeSelection =
  | { kind: 'router' }
  | { kind: 'judge' }
  | { kind: 'laneModel'; laneId: string; index: number }
  | { kind: 'laneMeta'; laneId: string };

const AUTO_VALUE = '__auto__';

function builtinLaneCopy(id: BuiltinCollaborationLaneId) {
  switch (id) {
    case 'quick': return { name: t('Simple edits'), description: t('Typos, punctuation, word swaps, and minor mechanical fixes'), icon: 'bolt', tone: 'quick' };
    case 'polish': return { name: t('Prose & polish'), description: t('Clarity, flow, conciseness, phrasing, and academic tone'), icon: 'sparkles', tone: 'polish' };
    case 'rigorous': return { name: t('Math & rigorous'), description: t('Proofs, lemmas, typing rules, claims, citations, and technical correctness'), icon: 'scale', tone: 'rigorous' };
    case 'layout': return { name: t('Layout & LaTeX'), description: t('Tables, figures, spacing, macros, formatting, and visual layout'), icon: 'layers', tone: 'layout' };
  }
}

function laneVisual(lane: CollaborationLane) {
  if ((BUILTIN_COLLABORATION_LANES as string[]).includes(lane.id)) {
    const id = lane.id as BuiltinCollaborationLaneId;
    const def = DEFAULT_COLLABORATION_LANE_DEFS[id];
    const copy = builtinLaneCopy(id);
    return {
      icon: copy.icon,
      tone: copy.tone,
      name: lane.name === def.name ? copy.name : lane.name,
      description: lane.description === def.description ? copy.description : lane.description,
    };
  }
  return {
    icon: lane.icon || 'tag',
    tone: 'custom',
    name: lane.name,
    description: lane.description,
  };
}

function routeParts(route: CollaborationRoute | null | undefined, runtimes: Partial<Record<AgentId, RuntimeStatus>>) {
  if (!route) return null;
  const runtime = runtimes[route.agent];
  const model = route.model ? runtime?.models.find(item => item.id === route.model) : runtime?.models.find(item => item.isDefault);
  const name = model?.name || route.model || t('Default model');
  const fast = Boolean(route.serviceTier && route.serviceTier !== 'default');
  return { agent: route.agent, agentName: AGENT_NAMES[route.agent], name, effort: route.effort || null, fast, model };
}

function formatRoute(route: CollaborationRoute | null | undefined, runtimes: Partial<Record<AgentId, RuntimeStatus>>): string {
  const parts = routeParts(route, runtimes);
  if (!parts) return t('Not configured');
  const extras = [parts.effort, parts.fast ? t('Fast') : null].filter(Boolean);
  return `${parts.agentName} · ${parts.name}${extras.length ? ` (${extras.join(', ')})` : ''}`;
}

function NodePillContent({ route, runtimes, custom, iconSize = 14 }: { route: CollaborationRoute | null | undefined; runtimes: Partial<Record<AgentId, RuntimeStatus>>; custom?: boolean; iconSize?: number }) {
  const parts = routeParts(route, runtimes);
  if (!parts) return <span className="collab-stage-empty">{t('Not configured')}</span>;
  const hasTags = Boolean(parts.effort || parts.fast);
  return <>
    <span className="collab-model-pill-main">
      <BrandIcon name={parts.agent} size={iconSize}/>
      <span className="collab-model-pill-name">{parts.name}</span>
      {custom && <span className="collab-custom-dot" aria-hidden="true"/>}
    </span>
    {hasTags && <span className="collab-model-pill-tags">
      {parts.effort && <span className="collab-micro-tag">{parts.effort}</span>}
      {parts.fast && <span className="collab-micro-tag collab-micro-fast"><Icon name="bolt" size={10}/>{t('Fast')}</span>}
    </span>}
  </>;
}

export function CollaborationSettings({ enabled, online, runtimes, load, save }: CollaborationSettingsProps) {
  const id = useId();
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [state, setState] = useState<Settings | null>(null);
  const [selected, setSelected] = useState<NodeSelection | null>(null);
  const [draftName, setDraftName] = useState(''), [draftDesc, setDraftDesc] = useState('');
  const inspectorRef = useRef<HTMLDivElement>(null);
  const shown = useRef<Settings | null>(null), confirmed = useRef<Settings | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve()), latest = useRef(0);
  shown.current = state;

  useEffect(() => {
    const request = ++latest.current;
    if (!online || !enabled) {
      confirmed.current = null;
      shown.current = null;
      setState(null);
      setSelected(null);
      return;
    }
    let current = true;
    load().then(settings => {
      if (current && request === latest.current) {
        confirmed.current = settings;
        shown.current = settings;
        setState(settings);
      }
    }, err => {
      if (current && request === latest.current) setError(errorText(err instanceof Error ? err.message : String(err)));
    });
    return () => { current = false; };
  }, [online, enabled]);

  async function change(update: CollaborationPatch) {
    const request = ++latest.current;
    if (shown.current && !update.reset) {
      const optimistic: Settings = {
        ...shown.current,
        ...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
        ...(update.router !== undefined ? { router: update.router } : {}),
        ...(update.judge !== undefined ? { judge: update.judge } : {}),
        ...(update.routes !== undefined ? { routes: update.routes } : {}),
        ...(update.racers !== undefined ? { racers: update.racers } : {}),
        ...(update.lanes !== undefined ? { lanes: update.lanes } : {}),
      };
      shown.current = optimistic;
      setState(optimistic);
    }
    setSaving(true); setError('');
    const saved = queue.current.then(() => save(update));
    queue.current = saved.catch(() => {});
    try {
      const settings = await saved;
      confirmed.current = settings;
      if (request === latest.current) {
        shown.current = settings;
        setState(settings);
      }
    } catch (err) {
      if (request === latest.current) {
        shown.current = confirmed.current;
        setState(confirmed.current);
        setError(errorText(err instanceof Error ? err.message : String(err)));
      }
    } finally { if (request === latest.current) setSaving(false); }
  }

  // Offer every connected/installed real agent on the host, excluding Collaboration mode itself.
  const offered: [CollaborationWorkerAgent, RuntimeStatus][] = COLLABORATION_WORKERS
    .map(agent => [agent, runtimes[agent]] as const)
    .filter((entry): entry is [CollaborationWorkerAgent, RuntimeStatus] => Boolean(entry[1] && !entry[1].hidden && entry[1].installed !== false && entry[1].models.length));

  function modelOptions(route: CollaborationRoute | null, autoLabel?: string, readOnlyOnly = false): SelectOption[] {
    const options: SelectOption[] = [];
    if (autoLabel) options.push({ value: AUTO_VALUE, label: autoLabel });
    for (const [agent, runtime] of offered) {
      if (readOnlyOnly && state?.readOnlyAgents?.[agent] === false && route?.agent !== agent) continue;
      const hidden = new Set(runtime.hiddenModels || []);
      const visible = runtime.models.filter(model => !hidden.has(model.id) || (route?.agent === agent && route.model === model.id));
      const fallback = visible.find(model => model.isDefault) || visible[0];
      options.push({
        value: JSON.stringify([agent, '']),
        label: fallback ? `${fallback.name || fallback.id} · ${t('Default')}` : t('Default model'),
        group: AGENT_NAMES[agent],
      });
      for (const model of visible) {
        options.push({ value: JSON.stringify([agent, model.id]), label: model.name || model.id, group: AGENT_NAMES[agent] });
      }
    }
    if (route) {
      const val = JSON.stringify([route.agent, route.model || '']);
      if (!options.some(option => option.value === val)) {
        options.push({ value: val, label: route.model || t('Default model'), group: AGENT_NAMES[route.agent] });
      }
    }
    return options;
  }

  const resolved: CollaborationResolved | undefined = state?.resolved;
  const savedLanes = state?.lanes ?? [];
  const savedLaneById = new Map(savedLanes.map(l => [l.id, l]));
  const baseLanes: CollaborationLane[] = resolved?.lanes?.length
    ? resolved.lanes
    : BUILTIN_COLLABORATION_LANES.map(bid => ({
      id: bid,
      ...DEFAULT_COLLABORATION_LANE_DEFS[bid],
      models: [],
    }));
  const lanes: CollaborationLane[] = [
    ...baseLanes.filter(l => (BUILTIN_COLLABORATION_LANES as string[]).includes(l.id)).map(l => {
      const saved = savedLaneById.get(l.id);
      return saved ? { ...l, name: saved.name || l.name, description: saved.description ?? l.description, models: saved.models.length ? saved.models : l.models } : l;
    }),
    ...savedLanes.filter(l => !(BUILTIN_COLLABORATION_LANES as string[]).includes(l.id)),
  ];
  const displayRouter = state?.router ?? resolved?.router ?? null;
  const displayJudge = state?.judge ?? resolved?.judge ?? null;
  const anyRacing = lanes.some(lane => lane.models.length >= 2);
  const hasCustom = Boolean(
    state && (
      state.router
      || state.judge
      || (state.racers?.length || 0) > 0
      || savedLanes.length > 0
      || COLLABORATION_ROLES.some(role => state.routes[role])
    ),
  );

  const currentConfig = (): CollaborationConfig => {
    const cur = shown.current;
    return cur
      ? { router: cur.router ?? null, judge: cur.judge ?? null, routes: cur.routes, racers: cur.racers ?? [], lanes: cur.lanes ?? [] }
      : { router: null, judge: null, routes: { quick: null, polish: null, rigorous: null }, racers: [], lanes: [] };
  };

  const effectiveModelId = (r: CollaborationRoute) => {
    if (r.model) return r.model;
    const rt = runtimes[r.agent];
    return rt?.models.find(m => m.isDefault)?.id || rt?.models[0]?.id || '';
  };

  const pickNextModel = (existing: CollaborationRoute[]): CollaborationRoute | null => {
    const used = new Set(existing.map(r => `${r.agent}:${effectiveModelId(r)}`));
    // First prefer any suggested cross-family racer not already in this lane.
    for (const r of resolved?.racers || []) {
      if (!used.has(`${r.agent}:${effectiveModelId(r)}`)) return r;
    }
    for (const [agent, runtime] of offered) {
      const hidden = new Set(runtime.hiddenModels || []);
      const model = runtime.models.find(m => !hidden.has(m.id) && !used.has(`${agent}:${m.id}`));
      if (model) {
        return {
          agent,
          model: model.id,
          effort: model.defaultEffort || null,
          ...(agent === 'codex' && model.fastMode ? { serviceTier: model.fastMode.serviceTier } : {}),
        };
      }
    }
    if (offered.length) {
      const [agent, runtime] = offered[0];
      const model = runtime.models.find(m => m.isDefault) || runtime.models[0];
      if (model) return { agent, model: model.id, effort: model.defaultEffort || null };
    }
    return null;
  };

  const saveLaneUpdate = (laneId: string, updater: (lane: CollaborationLane) => CollaborationLane | null) => {
    const cfg = currentConfig();
    const list = [...(cfg.lanes || [])];
    const resolvedLane = lanes.find(l => l.id === laneId);
    const existingIdx = list.findIndex(l => l.id === laneId);
    const base: CollaborationLane | null = existingIdx >= 0
      ? list[existingIdx]
      : resolvedLane ? { ...resolvedLane, models: [...resolvedLane.models] } : null;
    if (!base) return;
    const next = updater(base);
    if (next === null) {
      if (existingIdx >= 0) list.splice(existingIdx, 1);
    } else if (existingIdx >= 0) {
      list[existingIdx] = next;
    } else {
      list.push(next);
    }
    void change({ lanes: list });
  };

  const addModelToLane = (laneId: string) => {
    const resolvedLane = lanes.find(l => l.id === laneId);
    if (!resolvedLane || resolvedLane.models.length >= MAX_COLLABORATION_RACERS) return;
    const candidate = pickNextModel(resolvedLane.models);
    if (!candidate) return;
    const nextModels = [...resolvedLane.models, candidate].slice(0, MAX_COLLABORATION_RACERS);
    setSelected({ kind: 'laneModel', laneId, index: nextModels.length - 1 });
    saveLaneUpdate(laneId, lane => ({ ...lane, models: nextModels }));
  };

  const removeModelFromLane = (laneId: string, index: number) => {
    const resolvedLane = lanes.find(l => l.id === laneId);
    if (!resolvedLane || resolvedLane.models.length <= 1) return;
    const nextModels = resolvedLane.models.filter((_, i) => i !== index);
    if (selected?.kind === 'laneModel' && selected.laneId === laneId) {
      if (selected.index === index) setSelected(null);
      else if (selected.index > index) setSelected({ kind: 'laneModel', laneId, index: selected.index - 1 });
    }
    saveLaneUpdate(laneId, lane => ({ ...lane, models: nextModels }));
  };

  const addCustomLane = () => {
    if (lanes.length >= MAX_COLLABORATION_LANES) return;
    const existingIds = new Set(lanes.map(l => l.id));
    let n = 1;
    while (existingIds.has(`custom-${n}`)) n++;
    const newId = `custom-${n}`;
    const starter = resolved?.routes.rigorous || resolved?.routes.polish || pickNextModel([]);
    const created: CollaborationLane = {
      id: newId,
      name: t('Custom lane {n}', { n }),
      description: '',
      icon: 'tag',
      models: starter ? [starter] : [],
      custom: true,
    };
    const cfg = currentConfig();
    setDraftName(created.name);
    setDraftDesc(created.description);
    setSelected({ kind: 'laneMeta', laneId: newId });
    void change({ lanes: [...(cfg.lanes || []), created] });
  };

  const deleteCustomLane = (laneId: string) => {
    if ((BUILTIN_COLLABORATION_LANES as string[]).includes(laneId)) return;
    setSelected(null);
    saveLaneUpdate(laneId, () => null);
  };

  const resetBuiltinLane = (laneId: string) => {
    if (!(BUILTIN_COLLABORATION_LANES as string[]).includes(laneId)) return;
    if (selected && (selected.kind === 'laneModel' || selected.kind === 'laneMeta') && selected.laneId === laneId) setSelected(null);
    saveLaneUpdate(laneId, () => null);
  };

  useEffect(() => {
    if (selected?.kind === 'laneModel') {
      const lane = lanes.find(l => l.id === selected.laneId);
      if (!lane) setSelected(null);
      else if (selected.index >= lane.models.length) setSelected(lane.models.length ? { kind: 'laneModel', laneId: lane.id, index: lane.models.length - 1 } : null);
    } else if (selected?.kind === 'laneMeta') {
      const lane = lanes.find(l => l.id === selected.laneId);
      if (!lane) setSelected(null);
    }
  }, [selected, lanes]);

  useEffect(() => {
    if (selected) inspectorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const isSelected = (candidate: NodeSelection) => {
    if (!selected || selected.kind !== candidate.kind) return false;
    if (candidate.kind === 'laneModel' && selected.kind === 'laneModel') return selected.laneId === candidate.laneId && selected.index === candidate.index;
    if (candidate.kind === 'laneMeta' && selected.kind === 'laneMeta') return selected.laneId === candidate.laneId;
    return true;
  };

  const toggleNode = (candidate: NodeSelection) => {
    if (candidate.kind === 'laneMeta') {
      const lane = lanes.find(l => l.id === candidate.laneId);
      if (lane) {
        const vis = laneVisual(lane);
        setDraftName(vis.name);
        setDraftDesc(vis.description);
      }
    }
    setSelected(prev => {
      if (prev && prev.kind === candidate.kind) {
        if (candidate.kind === 'laneModel' && prev.kind === 'laneModel' && prev.laneId === candidate.laneId && prev.index === candidate.index) return null;
        if (candidate.kind === 'laneMeta' && prev.kind === 'laneMeta' && prev.laneId === candidate.laneId) return null;
        if (candidate.kind === 'router' || candidate.kind === 'judge') return null;
      }
      return candidate;
    });
  };

  const isEnabled = state?.enabled ?? enabled;
  const inspectorId = `${id}-inspector`;

  function renderInspector() {
    if (!selected || !state) return null;

    if (selected.kind === 'laneMeta') {
      const lane = lanes.find(l => l.id === selected.laneId);
      if (!lane) return null;
      const vis = laneVisual(lane);
      const isCustomLane = Boolean(lane.custom);
      const isCustomizedBuiltin = !isCustomLane && savedLaneById.has(lane.id);
      const commitMeta = () => {
        const cleanName = draftName.trim();
        const cleanDesc = draftDesc.trim();
        if (!cleanName) return;
        saveLaneUpdate(lane.id, cur => ({
          ...cur,
          name: isCustomLane ? cleanName : cur.name,
          description: cleanDesc,
        }));
      };
      return <div ref={inspectorRef} id={inspectorId} className="collab-inspector" data-inspecting={`lane:${lane.id}`} role="region" aria-labelledby={`${inspectorId}-title`}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setSelected(null); } }}>
        <div className="collab-inspector-head">
          {isCustomLane ? (
            <div className="collab-lane-icon-picker">
              <SkillIconPicker
                value={(lane.icon || 'tag') as SkillIcon}
                onChange={icon => saveLaneUpdate(lane.id, cur => ({ ...cur, icon }))}
                disabled={!online || saving}
                name={vis.name}
              />
            </div>
          ) : (
            <span className="collab-role-badge" data-tone={vis.tone} aria-hidden="true"><Icon name={vis.icon} size={14}/></span>
          )}
          <div className="collab-inspector-copy">
            <span className="settings-name" id={`${inspectorId}-title`}>{vis.name}</span>
            <p>{t('Router reads this description to send matching annotations into this lane.')}</p>
          </div>
          <div className="collab-inspector-actions">
            {isCustomizedBuiltin && <button type="button" className="collab-icon-btn" aria-label={t('Auto')} title={t('Auto')} disabled={!online || saving} onClick={() => resetBuiltinLane(lane.id)}><Icon name="restore" size={15}/></button>}
            {isCustomLane && <button type="button" className="collab-icon-btn collab-icon-danger" aria-label={t('Delete')} title={t('Delete')} disabled={!online || saving} onClick={() => deleteCustomLane(lane.id)}><Icon name="trash" size={15}/></button>}
            <button type="button" className="collab-icon-btn" aria-label={t('Close')} title={t('Close')} onClick={() => setSelected(null)}><Icon name="close" size={15}/></button>
          </div>
        </div>
        <form className="collab-lane-form" onSubmit={event => { event.preventDefault(); commitMeta(); }}>
          {isCustomLane && <div className="collab-field">
            <label htmlFor={`${inspectorId}-name`}>{t('Lane name')}</label>
            <input id={`${inspectorId}-name`} type="text" maxLength={60} value={draftName} disabled={!online || saving}
              placeholder={t('e.g. TikZ diagrams, Citations')}
              onChange={event => setDraftName(event.target.value)}
              onBlur={commitMeta}/>
          </div>}
          <div className="collab-field">
            <label htmlFor={`${inspectorId}-desc`}>{t('When to use this lane')}</label>
            <textarea id={`${inspectorId}-desc`} rows={2} maxLength={260} value={draftDesc} disabled={!online || saving}
              placeholder={t('Describe what kind of annotations Router should route here…')}
              onChange={event => setDraftDesc(event.target.value)}
              onBlur={commitMeta}/>
          </div>
          <div className="collab-lane-form-foot">
            <button type="submit" className="collab-icon-btn collab-icon-save" aria-label={t('Save')} title={t('Save')} disabled={!online || saving || (isCustomLane && !draftName.trim())}><Icon name="check" size={15}/></button>
          </div>
        </form>
      </div>;
    }

    let slotKey = '';
    let title = '';
    let detail = '';
    let icon = 'workflow';
    let tone = 'race';
    let route: CollaborationRoute | null = null;
    let resolvedRoute: CollaborationRoute | null = null;
    let allowAuto = true;
    let readOnlyOnly = false;
    let onUpdate: (next: CollaborationRoute | null) => void = () => {};
    let onRemove: (() => void) | null = null;

    if (selected.kind === 'router') {
      slotKey = 'router';
      title = t('Router');
      detail = t('Fast read-only classifier that routes each annotation into the matching task lane.');
      icon = 'workflow';
      tone = 'quick';
      route = state.router ?? null;
      resolvedRoute = resolved?.router || null;
      readOnlyOnly = true;
      onUpdate = next => void change({ router: next });
    } else if (selected.kind === 'judge') {
      slotKey = 'judge';
      title = t('Judge');
      detail = t('Rigorous read-only evaluator that blind-compares proposals whenever a lane has 2+ models.');
      icon = 'scale';
      tone = 'rigorous';
      route = state.judge ?? null;
      resolvedRoute = resolved?.judge || null;
      readOnlyOnly = true;
      onUpdate = next => void change({ judge: next });
    } else if (selected.kind === 'laneModel') {
      const lane = lanes.find(l => l.id === selected.laneId);
      const current = lane?.models[selected.index];
      if (!lane || !current) return null;
      const vis = laneVisual(lane);
      slotKey = `${lane.id}:${selected.index}`;
      title = lane.models.length >= 2 ? `${vis.name} · ${t('Model {n}', { n: selected.index + 1 })}` : vis.name;
      detail = vis.description || t('Handles annotations routed to this lane.');
      icon = vis.icon;
      tone = vis.tone;
      route = current;
      resolvedRoute = current;
      allowAuto = false;
      onUpdate = next => {
        if (!next) return;
        saveLaneUpdate(lane.id, cur => {
          const nextModels = [...cur.models];
          nextModels[selected.index] = next;
          return { ...cur, models: nextModels };
        });
      };
      onRemove = lane.models.length > 1 ? () => removeModelFromLane(lane.id, selected.index) : null;
    }

    const effective = route || resolvedRoute;
    const autoText = allowAuto ? (resolvedRoute ? `${t('Auto')} (${formatRoute(resolvedRoute, runtimes)})` : t('Auto')) : undefined;
    const options = modelOptions(route, autoText, readOnlyOnly);
    const value = route ? JSON.stringify([route.agent, route.model || '']) : AUTO_VALUE;
    const display = route ? formatRoute(route, runtimes) : autoText || t('Auto');
    const effParts = routeParts(effective, runtimes);
    const model = effParts?.model;
    const hasEffort = Boolean(effective && model?.efforts.length);
    const hasFast = Boolean(effective && effective.agent === 'codex' && model?.fastMode);
    const fastOn = Boolean(hasFast && effective?.serviceTier && effective.serviceTier !== 'default');
    const fastId = `${id}-${slotKey}-fast`;
    const fastDesc = model?.fastMode?.description || '';

    return <div ref={inspectorRef} id={inspectorId} className="collab-inspector" data-inspecting={slotKey} role="region" aria-labelledby={`${inspectorId}-title`}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setSelected(null); } }}>
      <div className="collab-inspector-head">
        <span className="collab-role-badge" data-tone={tone} aria-hidden="true"><Icon name={icon} size={14}/></span>
        <div className="collab-inspector-copy">
          <span className="settings-name" id={`${inspectorId}-title`}>{title}</span>
          <p>{detail}</p>
        </div>
        <div className="collab-inspector-actions">
          {allowAuto && route && <button type="button" className="collab-icon-btn" aria-label={t('Auto')} title={t('Auto')} disabled={!online || saving} onClick={() => onUpdate(null)}><Icon name="restore" size={15}/></button>}
          {onRemove && <button type="button" className="collab-icon-btn collab-icon-danger" aria-label={t('Remove')} title={t('Remove')} disabled={!online || saving} onClick={onRemove}><Icon name="trash" size={15}/></button>}
          <button type="button" className="collab-icon-btn" aria-label={t('Close')} title={t('Close')} onClick={() => setSelected(null)}><Icon name="close" size={15}/></button>
        </div>
      </div>

      <div className="collab-inspector-body">
        <div className="collab-inspector-model">
          {effective && <BrandIcon name={effective.agent} size={16}/>}
          <ChipSelect
            className="settings-model-select"
            label={title}
            display={display}
            value={value}
            options={options}
            disabled={!online || saving}
            onChange={chosen => {
              if (chosen === AUTO_VALUE) { onUpdate(null); return; }
              const [agent, modelId] = JSON.parse(chosen) as [CollaborationWorkerAgent, string];
              const nextRuntime = runtimes[agent];
              const nextModel = modelId ? nextRuntime?.models.find(m => m.id === modelId) : nextRuntime?.models.find(m => m.isDefault);
              onUpdate({
                agent,
                model: modelId || null,
                effort: nextModel?.defaultEffort || null,
                ...(agent === 'codex' && nextModel?.fastMode ? { serviceTier: nextModel.fastMode.serviceTier } : {}),
              });
            }}
          />
        </div>

        {hasEffort && effective && model && <div className="settings-row settings-effort">
          <EffortSlider efforts={model.efforts} value={effective.effort || ''} fallback={model.defaultEffort}
            onChange={effort => onUpdate({ ...effective, effort: effort || null })}/>
        </div>}

        {hasFast && effective && model?.fastMode && <div className="settings-row settings-toggle collaboration-fast">
          <div className="collaboration-fast-text">
            <label className="collaboration-fast-label" htmlFor={fastId}><Icon name="bolt" size={12}/>{t('Fast mode')}</label>
            {fastDesc && <p id={`${fastId}-desc`} className="collaboration-fast-hint">{fastDesc}</p>}
          </div>
          <input id={fastId} type="checkbox" className="switch" role="switch" aria-describedby={fastDesc ? `${fastId}-desc` : undefined} checked={fastOn} disabled={!online || saving}
            onChange={event => onUpdate({ ...effective, serviceTier: event.target.checked ? model.fastMode!.serviceTier : 'default' })}/>
        </div>}
      </div>
    </div>;
  }

  return <div className="settings-card collaboration-settings">
    <div className="settings-row settings-toggle collab-hero-row">
      <div className="settings-text collab-hero-head">
        <span className="collab-hero-icon" aria-hidden="true"><BrandIcon name="collaboration" size={16}/></span>
        <div className="collab-slot-copy">
          <label className="settings-name" htmlFor={id}>{t('Enable collaboration mode')}</label>
          <p id={id + '-detail'}>{t('Routes each annotation into a matching task lane; lanes with 1 model run directly and lanes with 2+ models race in parallel with blind judging.')}</p>
        </div>
      </div>
      <input id={id} type="checkbox" className="switch" role="switch" aria-describedby={id + '-detail'} checked={isEnabled} disabled={!online || saving} onChange={event => void change({ enabled: event.target.checked })}/>
    </div>

    {isEnabled && state && resolved && <div className="collaboration-summary collab-board">
      <div className="collab-pipeline-head">
        <div className="collab-pipeline-title">
          <span className="settings-name">{t('Active team')}</span>
          <span className="collab-mode-badge" data-custom={hasCustom ? 'true' : undefined}>{hasCustom ? t('Custom') : t('Auto')}</span>
          <span className="collab-board-hint">{t('Click any model to customize · + to race a lane')}</span>
        </div>
        {hasCustom && <button type="button" className="button secondary compact" disabled={!online || saving} onClick={() => { setSelected(null); void change({ reset: true }); }}><Icon name="restore" size={13}/>{t('Reset to auto')}</button>}
      </div>

      <div className="collab-stages">
        <div className="collab-stage collab-stage-side">
          <div className="collab-stage-head">
            <span className="collab-stage-label"><span className="collab-role-badge collab-stage-badge" data-tone="quick" aria-hidden="true"><Icon name="workflow" size={18}/></span>{t('Router')}</span>
          </div>
          <div className="collab-stage-models">
            <button type="button" className="collab-node" data-role="router" aria-expanded={isSelected({ kind: 'router' })} aria-controls={isSelected({ kind: 'router' }) ? inspectorId : undefined}
              disabled={!online} onClick={() => toggleNode({ kind: 'router' })} title={formatRoute(displayRouter, runtimes)}>
              <NodePillContent route={displayRouter} runtimes={runtimes} custom={Boolean(state.router)} iconSize={16}/>
            </button>
          </div>
          <span className="collab-stage-foot">{t('Classifies each note')}</span>
        </div>

        <span className="collab-stage-arrow" aria-hidden="true"><Icon name="arrowRight" size={13}/></span>

        <div className="collab-stage collab-stage-lanes" data-role="lanes">
          <div className="collab-stage-head">
            <span className="collab-stage-label">{t('Task lanes')}</span>
            <button type="button" className="collab-icon-btn collab-add-lane-btn" aria-label={t('Add lane')} title={t('Add lane')} disabled={!online || saving || lanes.length >= MAX_COLLABORATION_LANES || !offered.length}
              onClick={addCustomLane}><Icon name="plus" size={15}/></button>
          </div>
          <div className="collab-lanes-list">
            {lanes.map(lane => {
              const vis = laneVisual(lane);
              const racing = lane.models.length >= 2;
              const customized = Boolean(lane.custom || savedLaneById.has(lane.id));
              const metaActive = isSelected({ kind: 'laneMeta', laneId: lane.id });
              return <div key={lane.id} className="collab-lane" data-lane={lane.id} data-racing={racing ? 'true' : undefined}>
                <div className="collab-lane-head">
                  <button type="button" className="collab-lane-title" aria-expanded={metaActive} aria-controls={metaActive ? inspectorId : undefined}
                    disabled={!online} onClick={() => toggleNode({ kind: 'laneMeta', laneId: lane.id })} title={vis.description || vis.name}>
                    <span className="collab-role-badge collab-role-badge-sm" data-tone={vis.tone} aria-hidden="true"><Icon name={vis.icon} size={11}/></span>
                    <span className="collab-lane-name">{vis.name}</span>
                    <span className="collab-lane-mode" data-racing={racing ? 'true' : undefined}>{racing ? t('Race') : t('Direct')}</span>
                  </button>
                  <div className="collab-stage-controls">
                    {!lane.custom && savedLaneById.has(lane.id) && (
                      <button type="button" className="collab-icon-btn" aria-label={t('Auto')} title={t('Auto')} disabled={!online || saving} onClick={() => resetBuiltinLane(lane.id)}><Icon name="restore" size={13}/></button>
                    )}
                    <button type="button" className="collab-icon-btn collab-add-btn" aria-label={t('Add model to {lane}', { lane: vis.name })} title={t('Add model')}
                      disabled={!online || saving || lane.models.length >= MAX_COLLABORATION_RACERS || !offered.length}
                      onClick={() => addModelToLane(lane.id)}><Icon name="plus" size={14}/></button>
                  </div>
                </div>
                <div className="collab-lane-models">
                  {lane.models.length > 0 ? lane.models.map((racer, idx) => {
                    const active = isSelected({ kind: 'laneModel', laneId: lane.id, index: idx });
                    return <div key={`${racer.agent}:${racer.model || ''}:${idx}`} className="collab-lane-model-item">
                      {idx > 0 && <span className="collab-vs" aria-hidden="true">vs</span>}
                      <div className="collab-race-node-wrap">
                        <button type="button" className="collab-node collab-lane-node" data-lane-model={`${lane.id}:${idx}`} aria-expanded={active} aria-controls={active ? inspectorId : undefined}
                          disabled={!online} onClick={() => toggleNode({ kind: 'laneModel', laneId: lane.id, index: idx })} title={formatRoute(racer, runtimes)}>
                          <NodePillContent route={racer} runtimes={runtimes} custom={customized}/>
                        </button>
                        {lane.models.length > 1 && <button type="button" className="collab-icon-btn collab-remove-btn" aria-label={t('Remove model {n} from {lane}', { n: idx + 1, lane: vis.name })} title={t('Remove')}
                          disabled={!online || saving} onClick={() => removeModelFromLane(lane.id, idx)}><Icon name="minus" size={14}/></button>}
                      </div>
                    </div>;
                  }) : <span className="collab-stage-empty">{t('Not configured')}</span>}
                </div>
              </div>;
            })}
          </div>
        </div>

        <span className="collab-stage-arrow" data-idle={!anyRacing ? 'true' : undefined} aria-hidden="true"><Icon name="arrowRight" size={13}/></span>

        <div className="collab-stage collab-stage-side" data-idle={!anyRacing ? 'true' : undefined}>
          <div className="collab-stage-head">
            <span className="collab-stage-label"><span className="collab-role-badge collab-stage-badge" data-tone="rigorous" aria-hidden="true"><Icon name="scale" size={18}/></span>{t('Judge')}</span>
          </div>
          <div className="collab-stage-models">
            <button type="button" className="collab-node" data-role="judge" aria-expanded={isSelected({ kind: 'judge' })} aria-controls={isSelected({ kind: 'judge' }) ? inspectorId : undefined}
              disabled={!online} onClick={() => toggleNode({ kind: 'judge' })} title={formatRoute(displayJudge, runtimes)}>
              <NodePillContent route={displayJudge} runtimes={runtimes} custom={Boolean(state.judge)} iconSize={16}/>
            </button>
          </div>
          <span className="collab-stage-foot">{anyRacing ? t('Judges raced lanes') : t('Active when a lane has 2+ models')}</span>
        </div>
      </div>

      {renderInspector()}
    </div>}
    {error && <p role="alert" className="settings-card-body">{error}</p>}
  </div>;
}
