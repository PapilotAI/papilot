import { useEffect, useId, useRef, useState } from 'react';
import { AGENT_IDS, AGENT_NAMES, type AgentId, type ChatgptProSettings as Settings, type HelperChoice, type RuntimeStatus } from '../shared.ts';
import { agentOff, shownModels } from './agent-choice.ts';
import { ChipSelect, type SelectOption } from './chip-select.tsx';
import { EffortSlider } from './effort-slider.tsx';
import { errorText, t } from './i18n.ts';

export interface ChatgptProSettingsProps {
  enabled: boolean;
  online: boolean;
  runtimes: Partial<Record<AgentId, RuntimeStatus>>;
  load: () => Promise<Settings>;
  save: (change: { enabled?: boolean; executor?: HelperChoice | null; autoSyncGithub?: boolean }) => Promise<Settings>;
}

export function ChatgptProSettings({ enabled, online, runtimes, load, save }: ChatgptProSettingsProps) {
  const id = useId();
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [executor, setExecutor] = useState<HelperChoice | null | undefined>(undefined);
  const [autoSyncGithub, setAutoSyncGithub] = useState(false);
  const confirmed = useRef<{ executor: HelperChoice | null; autoSyncGithub: boolean }>({ executor: null, autoSyncGithub: false });
  const queue = useRef<Promise<unknown>>(Promise.resolve()), latest = useRef(0);

  useEffect(() => {
    if (!online || !enabled || executor !== undefined) return;
    let current = true;
    void load().then(
      settings => {
        if (!current) return;
        confirmed.current = { executor: settings.executor, autoSyncGithub: Boolean(settings.autoSyncGithub) };
        setExecutor(settings.executor);
        setAutoSyncGithub(Boolean(settings.autoSyncGithub));
      },
      failure => { if (current) setError(errorText(failure instanceof Error ? failure.message : String(failure))); },
    );
    return () => { current = false; };
  }, [online, enabled]);

  async function change(update: { enabled?: boolean; executor?: HelperChoice | null; autoSyncGithub?: boolean }) {
    const request = ++latest.current;
    if (update.executor !== undefined) setExecutor(update.executor);
    if (update.autoSyncGithub !== undefined) setAutoSyncGithub(update.autoSyncGithub);
    setSaving(true); setError('');
    const saved = queue.current.then(() => save(update));
    queue.current = saved.catch(() => {});
    try {
      const settings = await saved;
      confirmed.current = { executor: settings.executor, autoSyncGithub: Boolean(settings.autoSyncGithub) };
      if (request === latest.current) {
        setExecutor(settings.executor);
        setAutoSyncGithub(Boolean(settings.autoSyncGithub));
      }
    } catch (failure) {
      if (request === latest.current) {
        setExecutor(confirmed.current.executor);
        setAutoSyncGithub(confirmed.current.autoSyncGithub);
        setError(errorText(failure instanceof Error ? failure.message : String(failure)));
      }
    } finally {
      if (request === latest.current) setSaving(false);
    }
  }

  const localAgents = AGENT_IDS.filter(agent =>
    agent !== 'collaboration' && agent !== 'chatgpt' && !agentOff(agent, runtimes)
    && runtimes[agent] && runtimes[agent]!.installed !== false && runtimes[agent]!.models.length > 0,
  );
  const options: SelectOption[] = [
    { value: 'auto', label: t('Automatic') },
    ...localAgents.flatMap(agent => {
      const models = shownModels(runtimes[agent], executor?.agent === agent ? executor.model : undefined);
      const fallback = models.find(model => model.isDefault);
      return [
        { value: JSON.stringify([agent, '']), label: fallback ? `${fallback.name || fallback.id} · ${t('Default')}` : t('Default model'), group: AGENT_NAMES[agent] },
        ...models.map(model => ({ value: JSON.stringify([agent, model.id]), label: model.name || model.id, group: AGENT_NAMES[agent] })),
      ];
    }),
  ];
  const value = executor ? JSON.stringify([executor.agent, executor.model || '']) : 'auto';
  if (executor && !options.some(option => option.value === value)) {
    options.push({ value, label: executor.model || t('Default model'), group: AGENT_NAMES[executor.agent] });
  }
  const selected = options.find(option => option.value === value);
  const display = executor ? `${AGENT_NAMES[executor.agent]} · ${selected?.label || executor.model || t('Default model')}` : t('Automatic');
  const selectedRuntime = executor ? runtimes[executor.agent] : undefined;
  const selectedModel = executor ? (executor.model ? selectedRuntime?.models.find(item => item.id === executor.model) : selectedRuntime?.models.find(item => item.isDefault)) : undefined;

  return <div className="settings-card chatgpt-pro-settings">
    <div className="settings-row settings-toggle">
      <div className="settings-text">
        <label className="settings-name" htmlFor={id}>{t('Enable ChatGPT Pro (web)')}</label>
        <p id={`${id}-detail`}>{t('Use ChatGPT Pro manually inside normal tasks: copy the prompt, paste its reply, and let a local agent apply the edits.')}</p>
      </div>
      <input id={id} type="checkbox" className="switch" role="switch" aria-describedby={`${id}-detail`} checked={enabled} disabled={!online || saving} onChange={event => void change({ enabled: event.target.checked })}/>
    </div>
    {enabled && executor !== undefined && <>
      <div className="settings-row settings-choice">
        <div className="settings-text">
          <span className="settings-name">{t('Local agent for edits')}</span>
          <p>{t('Applies ChatGPT Pro’s reply to the manuscript and prepares the PDF comparison. Automatic uses your first connected local agent.')}</p>
        </div>
        <ChipSelect className="settings-model-select" label={t('Local agent for edits')} display={display} value={value} options={options} disabled={!online || saving} onChange={chosen => {
          if (chosen === 'auto') { void change({ executor: null }); return; }
          const [agent, model] = JSON.parse(chosen) as [AgentId, string];
          void change({ executor: { agent, ...(model ? { model } : {}) } });
        }}/>
      </div>
      {executor && selectedModel?.efforts.length ? <div className="settings-row settings-effort">
        <EffortSlider efforts={selectedModel.efforts} value={executor.effort || ''} fallback={selectedModel.defaultEffort} disabled={!online || saving} onChange={effort => void change({ executor: { ...executor, ...(effort ? { effort } : { effort: undefined }) } })}/>
      </div> : null}
      <div className="settings-row settings-toggle">
        <div className="settings-text">
          <label className="settings-name" htmlFor={`${id}-github`}>{t('Sync snapshot to GitHub automatically')}</label>
          <p id={`${id}-github-detail`}>{t('When a paper has a GitHub remote, push the task’s current files to a branch so ChatGPT Pro can read the full repository.')}</p>
        </div>
        <input id={`${id}-github`} type="checkbox" className="switch" role="switch" aria-describedby={`${id}-github-detail`} checked={autoSyncGithub} disabled={!online || saving} onChange={event => void change({ autoSyncGithub: event.target.checked })}/>
      </div>
    </>}
    {error && <p role="alert" className="settings-card-body">{error}</p>}
  </div>;
}
