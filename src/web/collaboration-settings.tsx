import { useEffect, useId, useRef, useState } from 'react';
import {
  AGENT_NAMES,
  COLLABORATION_ROLES,
  COLLABORATION_WORKERS,
  MAX_COLLABORATION_RACERS,
  type AgentId,
  type CollaborationConfig,
  type CollaborationResolved,
  type CollaborationRole,
  type CollaborationRoute,
  type CollaborationSettings as Settings,
  type CollaborationWorkerAgent,
  type RuntimeStatus,
} from '../shared.ts';
import { BrandIcon } from './brand-icon.tsx';
import { ChipSelect, type SelectOption } from './chip-select.tsx';
import { EffortSlider } from './effort-slider.tsx';
import { Icon } from './icons.tsx';
import { errorText, t } from './i18n.ts';

export type CollaborationPatch = {
  enabled?: boolean;
  router?: CollaborationRoute | null;
  judge?: CollaborationRoute | null;
  routes?: Settings['routes'];
  racers?: CollaborationRoute[];
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
  | { kind: 'role'; role: CollaborationRole }
  | { kind: 'racer'; index: number };

const roleMeta = (role: CollaborationRole) => ({
  quick: { short: t('Quick'), name: t('Quick & routing'), detail: t('Fast dispatcher and simple mechanical edits'), icon: 'bolt', tone: 'quick' },
  polish: { short: t('Polish'), name: t('Polishing'), detail: t('Natural, readable prose and flow'), icon: 'sparkles', tone: 'polish' },
  rigorous: { short: t('Rigorous'), name: t('Rigorous & judging'), detail: t('Math, formal claims, blind race judging and conflict resolution'), icon: 'scale', tone: 'rigorous' },
})[role];

const AUTO_VALUE = '__auto__';

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

function NodePillContent({ route, runtimes, custom }: { route: CollaborationRoute | null | undefined; runtimes: Partial<Record<AgentId, RuntimeStatus>>; custom?: boolean }) {
  const parts = routeParts(route, runtimes);
  if (!parts) return <span className="collab-stage-empty">{t('Not configured')}</span>;
  const hasTags = Boolean(parts.effort || parts.fast);
  return <>
    <span className="collab-model-pill-main">
      <BrandIcon name={parts.agent} size={14}/>
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

  const racers = state?.racers ?? [];
  const resolved: CollaborationResolved | undefined = state?.resolved;
  const resolvedRacers = resolved?.racers ?? [];
  const displayedRacers = racers.length ? racers : resolvedRacers;
  const hasCustom = Boolean(state && (state.router || state.judge || racers.length || COLLABORATION_ROLES.some(role => state.routes[role])));
  const currentConfig = (): CollaborationConfig => {
    const cur = shown.current;
    return cur
      ? { router: cur.router ?? null, judge: cur.judge ?? null, routes: cur.routes, racers: cur.racers ?? [] }
      : { router: null, judge: null, routes: { quick: null, polish: null, rigorous: null }, racers: [] };
  };
  const effectiveModelId = (r: CollaborationRoute) => {
    if (r.model) return r.model;
    const rt = runtimes[r.agent];
    return rt?.models.find(m => m.isDefault)?.id || rt?.models[0]?.id || '';
  };

  // Clamp racer selection if racers shrunk.
  useEffect(() => {
    if (selected?.kind === 'racer' && selected.index >= displayedRacers.length) {
      setSelected(displayedRacers.length ? { kind: 'racer', index: displayedRacers.length - 1 } : null);
    }
  }, [selected, displayedRacers.length]);

  useEffect(() => {
    if (selected) inspectorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const isSelected = (candidate: NodeSelection) => {
    if (!selected || selected.kind !== candidate.kind) return false;
    if (candidate.kind === 'role' && selected.kind === 'role') return selected.role === candidate.role;
    if (candidate.kind === 'racer' && selected.kind === 'racer') return selected.index === candidate.index;
    return true;
  };
  const toggleNode = (candidate: NodeSelection) => {
    setSelected(prev => {
      if (prev && prev.kind === candidate.kind) {
        if (candidate.kind === 'role' && prev.kind === 'role' && prev.role === candidate.role) return null;
        if (candidate.kind === 'racer' && prev.kind === 'racer' && prev.index === candidate.index) return null;
        if (candidate.kind === 'router' || candidate.kind === 'judge') return null;
      }
      return candidate;
    });
  };

  const addRacer = () => {
    const cfg = currentConfig();
    const basePool = cfg.racers.length ? [...cfg.racers] : [...resolvedRacers];
    if (basePool.length >= MAX_COLLABORATION_RACERS) return;
    const used = new Set(basePool.map(r => `${r.agent}:${effectiveModelId(r)}`));
    let candidate: CollaborationRoute | null = null;
    for (const [agent, runtime] of offered) {
      const hidden = new Set(runtime.hiddenModels || []);
      const model = runtime.models.find(m => !hidden.has(m.id) && !used.has(`${agent}:${m.id}`));
      if (model) {
        candidate = {
          agent,
          model: model.id,
          effort: model.defaultEffort || null,
          ...(agent === 'codex' && model.fastMode ? { serviceTier: model.fastMode.serviceTier } : {}),
        };
        break;
      }
    }
    if (!candidate && offered.length) {
      const [agent, runtime] = offered[0];
      const model = runtime.models.find(m => m.isDefault) || runtime.models[0];
      if (model) candidate = { agent, model: model.id, effort: model.defaultEffort || null };
    }
    if (candidate) {
      const next = [...basePool, candidate].slice(0, MAX_COLLABORATION_RACERS);
      setSelected({ kind: 'racer', index: next.length - 1 });
      void change({ racers: next });
    }
  };

  const removeRacer = (index: number) => {
    const cfg = currentConfig();
    const basePool = cfg.racers.length ? [...cfg.racers] : [...resolvedRacers];
    const next = basePool.filter((_, i) => i !== index);
    if (selected?.kind === 'racer') {
      if (next.length === 0) setSelected(null);
      else if (selected.index === index) setSelected(null);
      else if (selected.index > index) setSelected({ kind: 'racer', index: selected.index - 1 });
    }
    void change({ racers: next });
  };

  const updateRacer = (index: number, nextRoute: CollaborationRoute) => {
    const cfg = currentConfig();
    const basePool = cfg.racers.length ? [...cfg.racers] : [...resolvedRacers];
    basePool[index] = nextRoute;
    void change({ racers: basePool });
  };

  const isEnabled = state?.enabled ?? enabled;
  const inspectorId = `${id}-inspector`;

  function renderInspector() {
    if (!selected || !state) return null;
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
      detail = t('Fast read-only dispatcher that assigns or races each annotation cluster.');
      icon = 'network';
      tone = 'quick';
      route = state.router ?? null;
      resolvedRoute = resolved?.router || null;
      readOnlyOnly = true;
      onUpdate = next => void change({ router: next });
    } else if (selected.kind === 'judge') {
      slotKey = 'judge';
      title = t('Judge');
      detail = t('Rigorous read-only evaluator that blind-compares race candidates and catches claim drift.');
      icon = 'shield';
      tone = 'rigorous';
      route = state.judge ?? null;
      resolvedRoute = resolved?.judge || null;
      readOnlyOnly = true;
      onUpdate = next => void change({ judge: next });
    } else if (selected.kind === 'role') {
      const meta = roleMeta(selected.role);
      slotKey = selected.role;
      title = meta.name;
      detail = meta.detail;
      icon = meta.icon;
      tone = meta.tone;
      route = state.routes[selected.role];
      resolvedRoute = resolved?.routes[selected.role] || null;
      onUpdate = next => void change({ routes: { ...currentConfig().routes, [selected.role]: next } });
    } else if (selected.kind === 'racer') {
      const idx = selected.index;
      const current = displayedRacers[idx];
      if (!current) return null;
      slotKey = `racer-${idx}`;
      title = t('Race model {n}', { n: idx + 1 });
      detail = t('Models competing in parallel on raced annotations.');
      icon = 'sparkles';
      tone = 'race';
      route = current;
      resolvedRoute = current;
      allowAuto = false;
      onUpdate = next => { if (next) updateRacer(idx, next); };
      onRemove = displayedRacers.length > 1 || racers.length > 0 ? () => removeRacer(idx) : null;
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
        <span className="collab-role-badge" data-tone={tone} aria-hidden="true"><Icon name={icon} size={13}/></span>
        <div className="collab-inspector-copy">
          <span className="settings-name" id={`${inspectorId}-title`}>{title}</span>
          <p>{detail}</p>
        </div>
        <div className="collab-inspector-actions">
          {allowAuto && route && <button type="button" className="button secondary compact" disabled={!online || saving} onClick={() => onUpdate(null)}>{t('Auto')}</button>}
          {onRemove && <button type="button" className="button secondary compact" disabled={!online || saving} onClick={onRemove}>{t('Remove')}</button>}
          <button type="button" className="icon-button collab-inspector-close" aria-label={t('Close')} title={t('Close')} onClick={() => setSelected(null)}><Icon name="close" size={14}/></button>
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
          <p id={id + '-detail'}>{t('Routes simple edits to a fast model and races subjective or technical annotations across connected models, with a rigorous judge picking the default proposal.')}</p>
        </div>
      </div>
      <input id={id} type="checkbox" className="switch" role="switch" aria-describedby={id + '-detail'} checked={isEnabled} disabled={!online || saving} onChange={event => void change({ enabled: event.target.checked })}/>
    </div>

    {isEnabled && state && resolved && <div className="collaboration-summary collab-board">
      <div className="collab-pipeline-head">
        <div className="collab-pipeline-title">
          <span className="settings-name">{t('Active team')}</span>
          <span className="collab-mode-badge" data-custom={hasCustom ? 'true' : undefined}>{hasCustom ? t('Custom') : t('Auto')}</span>
          <span className="collab-board-hint">{t('Click any model to customize')}</span>
        </div>
        {hasCustom && <button type="button" className="button secondary compact" disabled={!online || saving} onClick={() => { setSelected(null); void change({ reset: true }); }}>{t('Reset to auto')}</button>}
      </div>

      <div className="collab-stages">
        <div className="collab-stage">
          <div className="collab-stage-head">
            <span className="collab-stage-label"><Icon name="bolt" size={11}/>{t('Router')}</span>
          </div>
          <div className="collab-stage-models">
            <button type="button" className="collab-node" data-role="router" aria-expanded={isSelected({ kind: 'router' })} aria-controls={isSelected({ kind: 'router' }) ? inspectorId : undefined}
              disabled={!online} onClick={() => toggleNode({ kind: 'router' })} title={formatRoute(resolved.router, runtimes)}>
              <NodePillContent route={resolved.router} runtimes={runtimes} custom={Boolean(state.router)}/>
            </button>
          </div>
        </div>

        <span className="collab-stage-arrow" aria-hidden="true"><Icon name="arrowRight" size={13}/></span>

        <div className="collab-stage collab-stage-race" data-role="racers">
          <div className="collab-stage-head">
            <span className="collab-stage-label"><Icon name="sparkles" size={11}/>{t('Race')}</span>
            <div className="collab-stage-controls">
              {racers.length > 0 && <button type="button" className="collab-stage-reset" disabled={!online || saving} onClick={() => { if (selected?.kind === 'racer') setSelected(null); void change({ racers: [] }); }}>{t('Auto')}</button>}
              <button type="button" className="collab-step-btn collab-add-btn" aria-label={t('Add model')} title={t('Add model')}
                disabled={!online || saving || displayedRacers.length >= MAX_COLLABORATION_RACERS || !offered.length}
                onClick={addRacer}><Icon name="plus" size={12}/></button>
            </div>
          </div>
          <div className="collab-stage-models collab-race-list">
            {displayedRacers.length > 0 ? displayedRacers.map((racer, index) => {
              const active = isSelected({ kind: 'racer', index });
              const canRemove = displayedRacers.length > 1 || racers.length > 0;
              return <div key={`${racer.agent}:${racer.model || ''}:${index}`} className="collab-race-item collaboration-racer-row">
                {index > 0 && <span className="collab-vs" aria-hidden="true">vs</span>}
                <div className="collab-race-node-wrap">
                  <button type="button" className="collab-node" data-racer={index} aria-expanded={active} aria-controls={active ? inspectorId : undefined}
                    disabled={!online} onClick={() => toggleNode({ kind: 'racer', index })} title={formatRoute(racer, runtimes)}>
                    <NodePillContent route={racer} runtimes={runtimes} custom={racers.length > 0}/>
                  </button>
                  {canRemove && <button type="button" className="collab-step-btn collab-remove-btn" aria-label={t('Remove race model {n}', { n: index + 1 })} title={t('Remove')}
                    disabled={!online || saving} onClick={() => removeRacer(index)}><Icon name="minus" size={12}/></button>}
                </div>
              </div>;
            }) : <span className="collab-stage-empty">{t('Connect at least two models to race annotations in parallel.')}</span>}
            {displayedRacers.length === 1 && <span className="collab-stage-note">{t('Add a second model to race annotations in parallel.')}</span>}
          </div>
        </div>

        <span className="collab-stage-arrow" aria-hidden="true"><Icon name="arrowRight" size={13}/></span>

        <div className="collab-stage">
          <div className="collab-stage-head">
            <span className="collab-stage-label"><Icon name="scale" size={11}/>{t('Judge')}</span>
          </div>
          <div className="collab-stage-models">
            <button type="button" className="collab-node" data-role="judge" aria-expanded={isSelected({ kind: 'judge' })} aria-controls={isSelected({ kind: 'judge' }) ? inspectorId : undefined}
              disabled={!online} onClick={() => toggleNode({ kind: 'judge' })} title={formatRoute(resolved.judge, runtimes)}>
              <NodePillContent route={resolved.judge} runtimes={runtimes} custom={Boolean(state.judge)}/>
            </button>
          </div>
        </div>
      </div>

      <div className="collab-direct-branch">
        <div className="collab-direct-head">
          <span className="collab-stage-label"><Icon name="branch" size={11}/>{t('Direct roles')}</span>
          <span className="collab-direct-sub">{t('Used when an annotation is routed directly to one model')}</span>
        </div>
        <div className="collab-direct-grid">
          {COLLABORATION_ROLES.map(role => {
            const meta = roleMeta(role);
            const active = isSelected({ kind: 'role', role });
            const resolvedRole = resolved.routes[role];
            const isCustom = Boolean(state.routes[role]);
            return <button key={role} type="button" className="collab-node collab-direct-node" data-role={role} aria-expanded={active} aria-controls={active ? inspectorId : undefined}
              disabled={!online} onClick={() => toggleNode({ kind: 'role', role })} title={`${meta.name}: ${formatRoute(resolvedRole, runtimes)}`}>
              <span className="collab-direct-role-head">
                <span className="collab-role-badge collab-role-badge-sm" data-tone={meta.tone} aria-hidden="true"><Icon name={meta.icon} size={11}/></span>
                <span className="collab-direct-role-name">{meta.short}</span>
              </span>
              <NodePillContent route={resolvedRole} runtimes={runtimes} custom={isCustom}/>
            </button>;
          })}
        </div>
      </div>

      {renderInspector()}
    </div>}
    {error && <p role="alert" className="settings-card-body">{error}</p>}
  </div>;
}
