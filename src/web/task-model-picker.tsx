import { agentLabel, agentOff, canReviewWith } from './agent-choice.ts';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AGENT_IDS, effectiveServiceTier, modelServiceTier, type AgentId, type RuntimeStatus, type Task } from '../shared.ts';
import { AgentPicker } from './agent-picker.tsx';
import { t } from './i18n.ts';
import type { RefreshUsage } from './usage.tsx';
import { readModelPreferences, readPermissionPreference, saveModelPreferences, savePermissionPreference } from './agent-preferences.ts';
import { taskEffort } from './task-effort.ts';

type Settings = Pick<Task, 'model' | 'effort' | 'serviceTier'>;
const settingsOf = (task: Settings): Settings => ({ model: task.model, effort: task.effort, serviceTier: task.serviceTier });
interface AgentSettings { agent: AgentId; model: string; effort: string; serviceTier?: string; permissions: string; stop: boolean }

export function TaskModelPicker({ task, runtime, runtimes, disabled, reconnecting, onReconnect, save, onSaving, refresh, reportError, permissions, switchAgent, refreshUsage }: {
  task: Task; runtime?: RuntimeStatus; disabled: boolean; reconnecting: boolean; onReconnect: () => void;
  runtimes: Partial<Record<AgentId, RuntimeStatus>>;
  save: (settings: { model: string; effort: string; serviceTier?: string }) => Promise<Task>;
  onSaving: (saving: boolean) => void; refresh: () => void; reportError: (error: unknown) => void;
  permissions?: ReactNode;
  refreshUsage?: RefreshUsage;
  // Another agent's model moves the task to that agent, stopping a turn in progress.
  switchAgent: (settings: AgentSettings) => Promise<void>;
}) {
  const [choice, setChoice] = useState(() => settingsOf(task));
  const [switching, setSwitching] = useState(false);
  const switchPending = useRef(false);
  const current = useRef(choice), saved = useRef(choice), pending = useRef(0), queue = useRef(Promise.resolve());
  useEffect(() => {
    if (pending.current) return;
    current.current = saved.current = settingsOf(task); setChoice(current.current);
  }, [task.agent, task.model, task.effort, task.serviceTier]);
  const agent = task.agent || 'codex';
  function remember(settings: Settings) {
    const model = settings.model || runtime?.models.find(model => model.isDefault)?.id || '';
    saveModelPreferences(agent, model, { effort: settings.effort || '', serviceTier: settings.serviceTier || 'default' });
  }
  function modelSettings(id: string | null, previous: Settings): Settings {
    if (previous.model === id) return previous;
    const model = runtime?.models.find(model => id ? model.id === id : model.isDefault);
    const preference = readModelPreferences(agent, id || '', model);
    const effort = preference ? taskEffort(preference.effort, model) : previous.effort;
    return { model: id, effort: model?.efforts.includes(effort || '') ? effort : null,
      serviceTier: modelServiceTier(model, preference?.serviceTier ?? previous.serviceTier) };
  }
  function change(update: (previous: Settings) => Settings) {
    if (disabled || switchPending.current) return;
    const next = update(current.current);
    current.current = next; setChoice(next); pending.current++; onSaving(true);
    // Serialize rapid slider/model changes, keeping the menu open while saving.
    queue.current = queue.current.then(async () => {
      try {
        // Resolve model switches after preceding saves, including rapid A/B/A.
        const next = update(saved.current);
        const model = runtime?.models.find(model => next.model ? model.id === next.model : model.isDefault);
        const serviceTier = effectiveServiceTier(model, next.serviceTier) || 'default';
        const result = await save({ model: next.model || '', effort: next.effort || '', ...(agent === 'codex' ? { serviceTier } : {}) });
        remember(saved.current); saved.current = settingsOf(result); remember(saved.current);
      }
      catch (error) { reportError(error); }
      finally {
        if (--pending.current === 0) {
          current.current = saved.current; setChoice(saved.current); onSaving(switchPending.current); refresh();
        }
      }
    });
  }
  function select(nextAgent: AgentId, id: string) {
    if (disabled || switchPending.current) return;
    if (nextAgent === agent) {
      change(previous => modelSettings(id, previous));
      return;
    }
    switchPending.current = true; setSwitching(true); onSaving(true);
    // Finish any queued model edits before stopping the current turn.
    queue.current = queue.current.then(async () => {
      try {
        remember(saved.current);
        if (task.mode !== 'review') savePermissionPreference(agent, task.permissions || 'workspace');
        const runtime = runtimes[nextAgent], model = runtime?.models.find(model => id ? model.id === id : model.isDefault);
        const preference = readModelPreferences(nextAgent, id, model);
        await switchAgent({ agent: nextAgent, model: id, effort: preference ? taskEffort(preference.effort, model) : '',
          ...(nextAgent === 'codex' ? { serviceTier: modelServiceTier(model, preference?.serviceTier) } : {}),
          permissions: task.mode === 'review' ? 'workspace' : readPermissionPreference(nextAgent, runtime), stop: true });
      }
      catch (error) { reportError(error); }
      finally { switchPending.current = false; setSwitching(false); onSaving(false); refresh(); }
    });
  }
  const options = AGENT_IDS.filter(id => {
    if (id === agent) return true;
    const other = runtimes[id];
    return !agentOff(id, runtimes) && (task.mode !== 'review' || canReviewWith(id, other))
      && Boolean(other?.models.length || (other?.connected && other.authenticated));
  }).map(value => ({
    value, label: agentLabel(value), runtime: value === agent ? runtime : runtimes[value],
    allowUnknownDefault: value === agent ? !choice.model : !runtimes[value]?.models.length,
  }));
  return <><AgentPicker refreshUsage={refreshUsage} agents={options} agent={agent}
    permissions={permissions}
    permissionMode={task.mode !== 'review' ? task.permissions || 'workspace' : undefined}
    model={choice.model || ''} effort={choice.effort || ''} serviceTier={agent === 'codex' ? choice.serviceTier || 'default' : undefined}
    disabled={disabled || switching} reconnecting={reconnecting} onReconnect={onReconnect} description={pending.current ? t('Saving…') : t('Next turn')}
    onSelect={select}
    onChange={patch => {
      const id = current.current.model;
      change(previous => ({ ...modelSettings(id, previous), ...(patch.effort !== undefined ? { effort: patch.effort || null } : {}), ...(patch.serviceTier !== undefined ? { serviceTier: patch.serviceTier } : {}) }));
    }}/>{switching && <span className="spinner" role="status" aria-label={t('Saving…')} title={t('Saving…')}/>}</>;
}
