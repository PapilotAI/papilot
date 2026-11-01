import type { AgentId } from '../shared.ts';
import type { AgentOption } from './agent-picker.tsx';
import { EffortSlider } from './effort-slider.tsx';
import { t } from './i18n.ts';

export interface ModelDefaultSettingsProps {
  agents: AgentOption[];
  agent: AgentId;
  model: string;
  effort: string;
  onSelect: (agent: AgentId, model: string) => void;
  onEffort: (effort: string) => void;
}

// Use the same catalog and saved choices as the new-task composer.
export function ModelDefaultSettings({ agents, agent, model, effort, onSelect, onEffort }: ModelDefaultSettingsProps) {
  const groups = agents.map(option => ({
    ...option,
    choices: [
      { id: '', name: t('Model default') },
      ...(option.runtime?.models || []),
      ...(option.value === agent && model && !option.runtime?.models.some(item => item.id === model) ? [{ id: model, name: model }] : []),
    ],
  }));
  const current = groups.find(item => item.value === agent);
  const models = current?.runtime?.models || [];
  const selected = models.find(item => item.id === model) || models.find(item => item.isDefault);
  const label = `${current?.label || agent} · ${current?.choices.find(item => item.id === model)?.name || t('Model default')}`;
  const value = JSON.stringify([agent, model]);
  return <>
    <div className="settings-row settings-choice">
      <div className="settings-text"><span className="settings-name">{t('Default model')}</span><p>{t('Used for new tasks. Saved in this browser.')}</p></div>
      <label className="chip-select settings-model-select" title={label}><span className="chip-value">{label}</span>
        <select aria-label={t('Default model')} value={value} onChange={event => {
          for (const group of groups) {
            const choice = group.choices.find(item => JSON.stringify([group.value, item.id]) === event.target.value);
            if (choice) { onSelect(group.value, choice.id); break; }
          }
        }}>
          {groups.map(group => <optgroup key={group.value} label={group.label}>{group.choices.map(item => <option key={item.id} value={JSON.stringify([group.value, item.id])}>{item.name}</option>)}</optgroup>)}
        </select>
      </label>
    </div>
    <div className="settings-row settings-effort">
      {selected?.efforts.length ? <EffortSlider efforts={selected.efforts} value={effort} fallback={selected.defaultEffort} onChange={onEffort}
        label={t('Default reasoning effort')} description={t('Available levels depend on the selected model.')}/>
        : <div className="settings-text"><span className="settings-name">{t('Default reasoning effort')}</span><p>{t('This model uses its own reasoning settings.')}</p></div>}
    </div>
  </>;
}
