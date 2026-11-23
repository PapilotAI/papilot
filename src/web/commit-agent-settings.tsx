import { useId, useState } from 'react';
import { AgentPicker, type AgentOption } from './agent-picker.tsx';
import { agentLabel } from './agent-choice.ts';
import { saveCommitMessageAgent, useCommitMessageAgent, saveConflictAgent, useConflictAgent, type CommitMessageAgent, type CommitMessageChoice } from './commit-agent-preferences.ts';
import { t } from './i18n.ts';
import type { RefreshUsage } from './usage.tsx';

type AgentSettingsProps = { current: CommitMessageChoice; agents: AgentOption[]; reconnect?: () => Promise<void>; refreshUsage?: RefreshUsage };

export function CommitAgentSettings(props: AgentSettingsProps) {
  return <HelperAgentSettings {...props} preference={useCommitMessageAgent()} save={saveCommitMessageAgent}
    label={t('Commit-message agent')} follow={t('Follow current conversation')}
    detail={t('Use the conversation’s model and reasoning effort, or the new-task settings if none. An explicit choice applies only to commit messages and is saved in this browser.')}/>;
}

export function ConflictAgentSettings(props: AgentSettingsProps) {
  return <HelperAgentSettings {...props} preference={useConflictAgent()} save={saveConflictAgent}
    label={t('Conflict-resolution agent')} pickerLabel={t('Conflict-resolution agent')} follow={t('Follow current conversation for conflicts')}
    detail={t('Uses the current conversation or new-task settings. Your choice resolves Git conflicts and prepares merge suggestions for tasks that overlap the manuscript.')}/>;
}

function HelperAgentSettings({ current, agents, reconnect, refreshUsage, preference, save, label, pickerLabel, follow, detail }: AgentSettingsProps & {
  preference: CommitMessageAgent; save: (value: CommitMessageAgent) => void; label: string; pickerLabel?: string; follow: string; detail: string;
}) {
  const id = useId();
  const [reconnecting, setReconnecting] = useState(false), [error, setError] = useState('');
  const following = preference === 'conversation';
  const options = agents.some(item => item.value === current.agent) ? agents : [...agents, { value: current.agent, label: agentLabel(current.agent), runtime: { connected: false, authenticated: false, installed: false, account: null, error: null, models: [] } }];
  const models = options.find(item => item.value === current.agent)?.runtime?.models || [];
  const model = models.find(item => current.model ? item.id === current.model : item.isDefault);
  return <>
    <div className="settings-row settings-toggle">
      <div className="settings-text">
        <label className="settings-name" htmlFor={id}>{follow}</label>
        <p id={`${id}-detail`}>{detail}</p>
      </div>
      <input id={id} type="checkbox" role="switch" className="switch" aria-describedby={`${id}-detail`} checked={following} onChange={event => save(event.target.checked ? 'conversation' : current)}/>
    </div>
    <div className="settings-row settings-choice">
      <div className="settings-text"><span className="settings-name">{label}</span>{error && <p role="alert">{error}</p>}</div>
      <AgentPicker label={pickerLabel} refreshUsage={refreshUsage} agents={options} agent={current.agent} model={current.model} effort={current.effort} fast={Boolean(current.serviceTier && current.serviceTier !== 'default')}
        reconnecting={reconnecting} onReconnect={() => { if (!reconnect) return; setReconnecting(true); setError(''); void reconnect().catch(error => setError(error instanceof Error ? error.message : String(error))).finally(() => setReconnecting(false)); }}
        onSelect={(agent, selected) => {
          const next = options.find(item => item.value === agent)?.runtime?.models.find(item => selected ? item.id === selected : item.isDefault);
          save({ agent, model: selected, effort: next?.efforts.includes(current.effort) ? current.effort : '', ...(agent === 'codex' ? { serviceTier: current.agent === agent && next?.fastMode?.serviceTier === current.serviceTier ? current.serviceTier : 'default' } : {}) });
        }}
        onChange={change => save({ ...current, ...(change.effort !== undefined ? { effort: change.effort } : {}), ...(change.fast !== undefined ? { serviceTier: change.fast ? model?.fastMode?.serviceTier : 'default' } : {}) })}/>
    </div>
  </>;
}
