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
import { ChipSelect, type SelectOption } from './chip-select.tsx';
import { EffortSlider } from './effort-slider.tsx';
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

const roleText = (role: CollaborationRole) => ({
  quick: { name: t('Quick & routing'), detail: t('Fast dispatcher and simple mechanical edits') },
  polish: { name: t('Polishing'), detail: t('Natural, readable prose and flow') },
  rigorous: { name: t('Rigorous & judging'), detail: t('Math, formal claims, blind race judging and conflict resolution') },
})[role];

const AUTO_VALUE = '__auto__';

function formatRoute(route: CollaborationRoute | null | undefined, runtimes: Partial<Record<AgentId, RuntimeStatus>>): string {
  if (!route) return t('Not configured');
  const runtime = runtimes[route.agent];
  const model = route.model ? runtime?.models.find(item => item.id === route.model) : runtime?.models.find(item => item.isDefault);
  const name = model?.name || route.model || t('Default model');
  const extras = [route.effort, route.serviceTier && route.serviceTier !== 'default' ? t('Fast') : null].filter(Boolean);
  return `${AGENT_NAMES[route.agent]} · ${name}${extras.length ? ` (${extras.join(', ')})` : ''}`;
}

export function CollaborationSettings({ enabled, online, runtimes, load, save }: CollaborationSettingsProps) {
  const id = useId();
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [state, setState] = useState<Settings | null>(null);
  const shown = useRef<Settings | null>(null), confirmed = useRef<Settings | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve()), latest = useRef(0);
  shown.current = state;

  useEffect(() => {
    const request = ++latest.current;
    if (!online || !enabled) {
      confirmed.current = null;
      shown.current = null;
      setState(null);
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

  function renderSlotControls(
    slotKey: string,
    title: string,
    detail: string,
    route: CollaborationRoute | null,
    resolvedRoute: CollaborationRoute | null,
    onUpdate: (next: CollaborationRoute | null) => void,
    allowAuto = true,
    readOnlyOnly = false,
  ) {
    const autoText = allowAuto ? (resolvedRoute ? `${t('Auto')} (${formatRoute(resolvedRoute, runtimes)})` : t('Auto')) : undefined;
    const options = modelOptions(route, autoText, readOnlyOnly);
    const value = route ? JSON.stringify([route.agent, route.model || '']) : AUTO_VALUE;
    const runtime = route ? runtimes[route.agent] : undefined;
    const model = route ? (route.model ? runtime?.models.find(item => item.id === route.model) : runtime?.models.find(item => item.isDefault)) : undefined;
    const display = route ? formatRoute(route, runtimes) : autoText || t('Auto');
    const hasFast = Boolean(route && route.agent === 'codex' && model?.fastMode);
    const fastOn = Boolean(hasFast && route?.serviceTier && route.serviceTier !== 'default');
    const fastId = `${id}-${slotKey}-fast`;
    const fastDesc = model?.fastMode?.description || '';

    return <div key={slotKey} className="collaboration-route" data-role={slotKey} role="group" aria-labelledby={`${id}-${slotKey}`}>
      <div className="settings-row settings-choice">
        <div className="settings-text"><span className="settings-name" id={`${id}-${slotKey}`}>{title}</span><p>{detail}</p></div>
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
      {route && model?.efforts.length ? <div className="settings-row settings-effort">
        <EffortSlider efforts={model.efforts} value={route.effort || ''} fallback={model.defaultEffort} onChange={effort => onUpdate({ ...route, effort: effort || null })}/>
      </div> : null}
      {route && hasFast && <div className="settings-row settings-toggle collaboration-fast">
        <div className="collaboration-fast-text">
          <label className="collaboration-fast-label" htmlFor={fastId}>{t('Fast mode')}</label>
          {fastDesc && <p id={`${fastId}-desc`} className="collaboration-fast-hint">{fastDesc}</p>}
        </div>
        <input id={fastId} type="checkbox" className="switch" role="switch" aria-describedby={fastDesc ? `${fastId}-desc` : undefined} checked={fastOn} disabled={!online || saving}
          onChange={event => onUpdate({ ...route, serviceTier: event.target.checked ? model!.fastMode!.serviceTier : 'default' })}/>
      </div>}
    </div>;
  }

  const racers = state?.racers ?? [];
  const resolved: CollaborationResolved | undefined = state?.resolved;
  const resolvedRacers = resolved?.racers ?? [];
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
  const addRacer = () => {
    const cfg = currentConfig();
    const basePool = cfg.racers.length ? [...cfg.racers] : [...resolvedRacers];
    if (basePool.length >= MAX_COLLABORATION_RACERS) return;
    // Pick the first offered model not already in the pool (resolving default-model aliases).
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
    if (candidate) void change({ racers: [...basePool, candidate].slice(0, MAX_COLLABORATION_RACERS) });
  };
  const isEnabled = state?.enabled ?? enabled;

  return <div className="settings-card collaboration-settings">
    <div className="settings-row settings-toggle">
      <div className="settings-text">
        <label className="settings-name" htmlFor={id}>{t('Enable collaboration mode')}</label>
        <p id={id + '-detail'}>{t('Routes simple edits to a fast model and races subjective or technical annotations across connected models, with a rigorous judge picking the default proposal.')}</p>
      </div>
      <input id={id} type="checkbox" className="switch" role="switch" aria-describedby={id + '-detail'} checked={isEnabled} disabled={!online || saving} onChange={event => void change({ enabled: event.target.checked })}/>
    </div>

    {isEnabled && state && <>
      {resolved && <div className="settings-row collaboration-summary">
        <div className="settings-text">
          <span className="settings-name">{t('Active team')}</span>
          <p>
            {t('Router')}: {formatRoute(resolved.router, runtimes)} · {t('Race')}: {resolvedRacers.length >= 2 ? resolvedRacers.map(r => formatRoute(r, runtimes)).join(' vs ') : t('Needs 2+ models')} · {t('Judge')}: {formatRoute(resolved.judge, runtimes)}
          </p>
        </div>
        {hasCustom && <button type="button" className="button secondary compact" disabled={!online || saving} onClick={() => void change({ reset: true })}>{t('Reset to auto')}</button>}
      </div>}

      {COLLABORATION_ROLES.map(role => {
        const text = roleText(role);
        return renderSlotControls(
          role,
          text.name,
          text.detail,
          state.routes[role],
          resolved?.routes[role] || null,
          next => void change({ routes: { ...currentConfig().routes, [role]: next } }),
        );
      })}

      <div className="collaboration-route collaboration-racers" data-role="racers" role="group" aria-labelledby={`${id}-racers`}>
        <div className="settings-row settings-choice">
          <div className="settings-text">
            <span className="settings-name" id={`${id}-racers`}>{t('Race pool')}</span>
            <p>{racers.length >= 2 ? t('Models competing in parallel on raced annotations.') : racers.length === 1 ? t('Add a second model to race annotations in parallel.') : resolvedRacers.length ? `${t('Auto')}: ${resolvedRacers.map(r => formatRoute(r, runtimes)).join(' vs ')}` : t('Connect at least two models to race annotations in parallel.')}</p>
          </div>
          <div className="collaboration-racer-actions">
            {racers.length > 0 && <button type="button" className="button secondary compact" disabled={!online || saving} onClick={() => void change({ racers: [] })}>{t('Auto')}</button>}
            {(racers.length ? racers.length : resolvedRacers.length) < MAX_COLLABORATION_RACERS && offered.length > 0 && (
              <button type="button" className="button secondary compact" disabled={!online || saving} onClick={addRacer}>{t('Add model')}</button>
            )}
          </div>
        </div>
        {racers.length > 0 && <div className="collaboration-racer-list">
          {racers.map((racer, index) => {
            const options = modelOptions(racer);
            const value = JSON.stringify([racer.agent, racer.model || '']);
            const runtime = runtimes[racer.agent];
            const model = racer.model ? runtime?.models.find(item => item.id === racer.model) : runtime?.models.find(item => item.isDefault);
            const hasFast = Boolean(racer.agent === 'codex' && model?.fastMode);
            const fastOn = Boolean(hasFast && racer.serviceTier && racer.serviceTier !== 'default');
            const fastId = `${id}-racer-${index}-fast`;
            const fastDesc = model?.fastMode?.description || '';
            const updateRacer = (next: CollaborationRoute) => {
              const list = [...currentConfig().racers];
              list[index] = next;
              void change({ racers: list });
            };
            const removeRacer = () => {
              const list = currentConfig().racers.filter((_, i) => i !== index);
              void change({ racers: list });
            };
            return <div key={index} className="collaboration-racer-row" role="group" aria-label={t('Race model {n}', { n: index + 1 })}>
              <div className="settings-row settings-choice">
                <ChipSelect
                  className="settings-model-select"
                  label={t('Race model {n}', { n: index + 1 })}
                  display={formatRoute(racer, runtimes)}
                  value={value}
                  options={options}
                  disabled={!online || saving}
                  onChange={chosen => {
                    const [agent, modelId] = JSON.parse(chosen) as [CollaborationWorkerAgent, string];
                    const nextRuntime = runtimes[agent];
                    const nextModel = modelId ? nextRuntime?.models.find(m => m.id === modelId) : nextRuntime?.models.find(m => m.isDefault);
                    updateRacer({ agent, model: modelId || null, effort: nextModel?.defaultEffort || null, ...(agent === 'codex' && nextModel?.fastMode ? { serviceTier: nextModel.fastMode.serviceTier } : {}) });
                  }}
                />
                <button type="button" className="button secondary compact" aria-label={t('Remove race model {n}', { n: index + 1 })} disabled={!online || saving} onClick={removeRacer}>{t('Remove')}</button>
              </div>
              {model?.efforts.length ? <div className="settings-row settings-effort">
                <EffortSlider efforts={model.efforts} value={racer.effort || ''} fallback={model.defaultEffort} onChange={effort => updateRacer({ ...racer, effort: effort || null })}/>
              </div> : null}
              {hasFast && <div className="settings-row settings-toggle collaboration-fast">
                <div className="collaboration-fast-text">
                  <label className="collaboration-fast-label" htmlFor={fastId}>{t('Fast mode')}</label>
                  {fastDesc && <p id={`${fastId}-desc`} className="collaboration-fast-hint">{fastDesc}</p>}
                </div>
                <input id={fastId} type="checkbox" className="switch" role="switch" aria-describedby={fastDesc ? `${fastId}-desc` : undefined} checked={fastOn} disabled={!online || saving}
                  onChange={event => updateRacer({ ...racer, serviceTier: event.target.checked ? model!.fastMode!.serviceTier : 'default' })}/>
              </div>}
            </div>;
          })}
        </div>}
      </div>

      <details className="collaboration-advanced">
        <summary>{t('Advanced overrides')}</summary>
        {renderSlotControls(
          'router',
          t('Router'),
          t('Fast read-only dispatcher that assigns or races each annotation cluster.'),
          state.router ?? null,
          resolved?.router || null,
          next => void change({ router: next }),
          true,
          true,
        )}
        {renderSlotControls(
          'judge',
          t('Judge'),
          t('Rigorous read-only evaluator that blind-compares race candidates and catches claim drift.'),
          state.judge ?? null,
          resolved?.judge || null,
          next => void change({ judge: next }),
          true,
          true,
        )}
      </details>
    </>}
    {error && <p role="alert" className="settings-card-body">{error}</p>}
  </div>;
}
