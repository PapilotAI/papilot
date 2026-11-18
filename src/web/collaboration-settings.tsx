import { useEffect, useId, useRef, useState } from 'react';
import { AGENT_NAMES, COLLABORATION_ROLES, type AgentId, type CollaborationRole, type CollaborationRoute, type CollaborationRoutes, type CollaborationSettings as Settings, type RuntimeStatus } from '../shared.ts';
import { ChipSelect, type SelectOption } from './chip-select.tsx';
import { EffortSlider } from './effort-slider.tsx';
import { errorText, t } from './i18n.ts';

export interface CollaborationSettingsProps {
  enabled: boolean; online: boolean;
  runtimes: Partial<Record<AgentId, RuntimeStatus>>;
  load: () => Promise<Settings>;
  save: (change: { enabled?: boolean; routes?: CollaborationRoutes }) => Promise<Settings>;
}

const roleText = (role: CollaborationRole) => ({
  quick: { name: t('Quick edits'), detail: t('Typos, word choice and small LaTeX fixes') },
  polish: { name: t('Polishing'), detail: t('Clarity and flow of passages') },
  rigorous: { name: t('Checks and reasoning'), detail: t('Math, facts, references and formatting') },
})[role];

export function CollaborationSettings({ enabled, online, runtimes, load, save }: CollaborationSettingsProps) {
  const id = useId();
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [routes, setRoutes] = useState<CollaborationRoutes | null>(null);
  // Saves go one at a time, in order. The latest selection stays shown, and a
  // failed save returns to what the host last confirmed.
  const shown = useRef<CollaborationRoutes | null>(null), confirmed = useRef<CollaborationRoutes | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve()), latest = useRef(0);
  shown.current = routes;
  // Roles show only while enabled; turning it on returns them with the saved settings.
  useEffect(() => {
    if (!online || !enabled || routes) return;
    let current = true;
    load().then(settings => { if (current) { confirmed.current = settings.routes; setRoutes(settings.routes); } }, error => { if (current) setError(errorText(error instanceof Error ? error.message : String(error))); });
    return () => { current = false; };
  }, [online, enabled]);
  async function change(update: { enabled?: boolean; routes?: CollaborationRoutes }) {
    const request = ++latest.current;
    if (update.routes) { shown.current = update.routes; setRoutes(update.routes); }
    setSaving(true); setError('');
    const saved = queue.current.then(() => save(update));
    queue.current = saved.catch(() => {});
    try {
      const settings = await saved;
      confirmed.current = settings.routes;
      if (request === latest.current) setRoutes(settings.routes);
    } catch (error) {
      if (request === latest.current) { setRoutes(confirmed.current); setError(errorText(error instanceof Error ? error.message : String(error))); }
    } finally { if (request === latest.current) setSaving(false); }
  }
  // Codex workers share the coordinator's catalog; other workers appear once found on the host.
  const catalogs: [CollaborationRoute['agent'], RuntimeStatus | undefined][] = [
    ['codex', runtimes.collaboration?.models.length ? runtimes.collaboration : runtimes.codex],
    ['antigravity', runtimes.antigravity], ['opencode', runtimes.opencode],
  ];
  const offered = catalogs.filter(([agent, runtime]) => agent === 'codex' || (runtime && runtime.installed !== false && runtime.models.length));
  function choices(route: CollaborationRoute): SelectOption[] {
    const options = offered.flatMap(([agent, runtime]) => {
      const models = runtime?.models || [], fallback = models.find(model => model.isDefault);
      return [
        { value: JSON.stringify([agent, '']), label: agent === 'codex' ? t('Same as coordinator') : fallback ? `${fallback.name || fallback.id} · ${t('Default')}` : t('Default model'), group: AGENT_NAMES[agent] },
        ...models.map(model => ({ value: JSON.stringify([agent, model.id]), label: model.name || model.id, group: AGENT_NAMES[agent] })),
      ];
    });
    // Keep a saved choice visible even when its worker is not connected right now.
    const value = JSON.stringify([route.agent, route.model || '']);
    return options.some(option => option.value === value) ? options : [...options, { value, label: route.model || t('Default model'), group: AGENT_NAMES[route.agent] }];
  }
  return <div className="settings-card collaboration-settings">
    <div className="settings-row settings-toggle">
      <div className="settings-text">
        <label className="settings-name" htmlFor={id}>{t('Enable collaboration mode')}</label>
        <p id={id + '-detail'}>{t('Codex assigns annotations to the workers below and checks every one before publishing.')}</p>
      </div>
      <input id={id} type="checkbox" className="switch" role="switch" aria-describedby={id + '-detail'} checked={enabled} disabled={!online || saving} onChange={event => void change({ enabled: event.target.checked })}/>
    </div>
    {enabled && routes && COLLABORATION_ROLES.map(role => {
      const route = routes[role], options = choices(route), value = JSON.stringify([route.agent, route.model || '']);
      const runtime = catalogs.find(([agent]) => agent === route.agent)?.[1];
      const model = route.model ? runtime?.models.find(item => item.id === route.model) : route.agent === 'codex' ? undefined : runtime?.models.find(item => item.isDefault);
      const text = roleText(role), selected = options.find(option => option.value === value);
      const update = (next: CollaborationRoute) => void change({ routes: { ...(shown.current || routes), [role]: next } });
      // A labelled group tells the role's model and effort apart from the other roles'.
      return <div key={role} className="collaboration-route" data-role={role} role="group" aria-labelledby={`${id}-${role}`}>
        <div className="settings-row settings-choice">
          <div className="settings-text"><span className="settings-name" id={`${id}-${role}`}>{text.name}</span><p>{text.detail}</p></div>
          <ChipSelect className="settings-model-select" label={text.name} display={`${AGENT_NAMES[route.agent]} · ${selected?.label || route.model}`} value={value} options={options} disabled={!online || saving}
            onChange={chosen => { const [agent, id] = JSON.parse(chosen) as [CollaborationRoute['agent'], string]; update({ agent, model: id || null, effort: null }); }}/>
        </div>
        {model?.efforts.length ? <div className="settings-row settings-effort">
          <EffortSlider efforts={model.efforts} value={route.effort || ''} fallback={model.defaultEffort} onChange={effort => update({ ...route, effort: effort || null })}/>
        </div> : null}
      </div>;
    })}
    {error && <p role="alert" className="settings-card-body">{error}</p>}
  </div>;
}
