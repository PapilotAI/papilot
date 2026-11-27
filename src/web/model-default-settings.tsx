import { useEffect, useState } from 'react';
import type { AgentId } from '../shared.ts';
import type { AgentOption } from './agent-picker.tsx';
import { shownModels } from './agent-choice.ts';
import { ChipSelect } from './chip-select.tsx';
import { EffortSlider } from './effort-slider.tsx';
import { t } from './i18n.ts';

export interface ModelDefaultSettingsProps {
  agents: AgentOption[];
  agent: AgentId;
  model: string;
  effort: string;
  onSelect: (agent: AgentId, model: string) => void;
  onEffort: (effort: string) => void;
  quick?: QuickModelApi;
}
export interface QuickModel { agent: AgentId; model: string | null; effort: string | null }
export interface QuickModelApi { load: () => Promise<{ choice: QuickModel | null }>; save: (choice: QuickModel | null) => Promise<{ choice: QuickModel | null }> }

// Use the same catalog and saved choices as the new-task composer.
export function ModelDefaultSettings({ agents, agent, model, effort, onSelect, onEffort, quick }: ModelDefaultSettingsProps) {
  const groups = agents.map(option => {
    const models = shownModels(option.runtime, option.value === agent ? model : undefined), fallback = models.find(item => item.isDefault);
    return { ...option, choices: [
      { id: '', name: fallback ? `${fallback.name || fallback.id} · ${t('Default')}` : t('Default model') },
      ...models,
      ...(option.value === agent && model && !models.some(item => item.id === model) ? [{ id: model, name: model }] : []),
    ] };
  });
  const current = groups.find(item => item.value === agent);
  const models = current?.runtime?.models || [];
  const selected = model ? models.find(item => item.id === model) : models.find(item => item.isDefault);
  const label = `${current?.label || agent} · ${current?.choices.find(item => item.id === model)?.name || t('Default model')}`;
  const value = JSON.stringify([agent, model]);
  return <>
    <div className="settings-row settings-choice">
      <div className="settings-text"><span className="settings-name">{t('Default model')}</span><p>{t('Used for new tasks. Saved in this browser.')}</p></div>
      <ChipSelect className="settings-model-select" label={t('Default model')} display={label} value={value} options={groups.flatMap(group => group.choices.map(item => ({ value: JSON.stringify([group.value, item.id]), label: item.name, group: group.label })))} onChange={chosen => {
        for (const group of groups) {
          const choice = group.choices.find(item => JSON.stringify([group.value, item.id]) === chosen);
          if (choice) { onSelect(group.value, choice.id); break; }
        }
      }}/>
    </div>
    <div className="settings-row settings-effort">
      {selected?.efforts.length ? <EffortSlider efforts={selected.efforts} value={effort} fallback={selected.defaultEffort} onChange={onEffort}
        label={t('Default reasoning effort')} description={t('Available levels depend on the selected model.')}/>
        : <div className="settings-text"><span className="settings-name">{t('Default reasoning effort')}</span><p>{t('This model uses its own reasoning settings.')}</p></div>}
    </div>
    {quick && <QuickModelSettings agents={agents.filter(option => option.value !== 'collaboration' && option.runtime?.supportsReadOnlyTasks !== false)} api={quick}/>}
  </>;
}

// The model for quick background jobs, saved on the Papilot host because
// those jobs run there: checking citations and naming tasks.
function QuickModelSettings({ agents, api }: { agents: AgentOption[]; api: QuickModelApi }) {
  const [choice, setChoice] = useState<QuickModel | null | undefined>(undefined), [error, setError] = useState('');
  useEffect(() => { void api.load().then(result => setChoice(result.choice), failure => setError(failure instanceof Error ? failure.message : String(failure))); }, [api]);
  const options = [{ value: 'auto', label: t('Automatic') },
    ...agents.flatMap(option => shownModels(option.runtime, choice?.agent === option.value ? choice.model ?? undefined : undefined).map(item => ({ value: JSON.stringify([option.value, item.id]), label: item.name || item.id, group: option.label })))];
  const value = choice ? JSON.stringify([choice.agent, choice.model]) : 'auto';
  if (choice && !options.some(option => option.value === value)) options.push({ value, label: choice.model || choice.agent, group: agents.find(option => option.value === choice.agent)?.label || choice.agent });
  const save = (next: QuickModel | null) => { setError(''); void api.save(next).then(result => setChoice(result.choice), failure => setError(failure instanceof Error ? failure.message : String(failure))); };
  return <div className="settings-row settings-choice">
    <div className="settings-text"><span className="settings-name">{t('Quick model')}</span><p>{t('Checks citations and names tasks. Automatic uses each agent’s small model.')}</p>{error && <p role="alert">{error}</p>}</div>
    <ChipSelect className="settings-model-select" label={t('Quick model')} value={value} disabled={choice === undefined} options={options} onChange={chosen => {
      if (chosen === 'auto') return save(null);
      const [agent, model] = JSON.parse(chosen) as [AgentId, string];
      save({ agent, model, effort: null });
    }}/>
  </div>;
}
