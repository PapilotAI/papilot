import { agentLabel } from './agent-choice.ts';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AGENT_IDS, type AgentId, type RuntimeStatus, type Task } from '../shared.ts';
import { AgentPicker } from './agent-picker.tsx';
import { t } from './i18n.ts';
import type { RefreshUsage } from './usage.tsx';
import { requestId } from './request-id.ts';
import { browserStorage } from './storage.ts';
import { readModelPreferences, readPermissionPreference, saveModelPreferences, savePermissionPreference } from './agent-preferences.ts';
import { taskEffort } from './task-effort.ts';

type Settings = Pick<Task, 'model' | 'effort' | 'serviceTier'>;
const settingsOf = (task: Settings): Settings => ({ model: task.model, effort: task.effort, serviceTier: task.serviceTier });
interface RestartSettings { id: string; agent: AgentId; model: string; effort: string; serviceTier?: string; permissions: string; stop: boolean }
const newId = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

export function TaskModelPicker({ task, runtime, runtimes, disabled, reconnecting, onReconnect, save, onSaving, refresh, reportError, permissions, restart, refreshUsage }: {
  task: Task; runtime?: RuntimeStatus; disabled: boolean; reconnecting: boolean; onReconnect: () => void;
  runtimes: Partial<Record<AgentId, RuntimeStatus>>;
  save: (settings: { model: string; effort: string; serviceTier?: string }) => Promise<Task>;
  onSaving: (saving: boolean) => void; refresh: () => void; reportError: (error: unknown) => void;
  permissions?: ReactNode;
  refreshUsage?: RefreshUsage;
  restart: (settings: RestartSettings) => Promise<void>;
}) {
  const [choice, setChoice] = useState(() => settingsOf(task));
  const [restarting, setRestarting] = useState(false);
  const restartPending = useRef(false);
  const current = useRef(choice), saved = useRef(choice), pending = useRef(0), queue = useRef(Promise.resolve());
  useEffect(() => {
    if (pending.current) return;
    current.current = saved.current = settingsOf(task); setChoice(current.current);
  }, [task.model, task.effort, task.serviceTier]);
  const agent = task.agent || 'codex';
  function remember(settings: Settings) {
    const model = settings.model || runtime?.models.find(model => model.isDefault)?.id || '';
    saveModelPreferences(agent, model, { effort: settings.effort || '', fast: Boolean(settings.serviceTier && settings.serviceTier !== 'default') });
  }
  function modelSettings(id: string | null, previous: Settings): Settings {
    if (previous.model === id) return previous;
    const model = runtime?.models.find(model => id ? model.id === id : model.isDefault);
    const preference = readModelPreferences(agent, id || '', model);
    const effort = preference ? taskEffort(preference.effort, model) : previous.effort;
    return { model: id, effort: model?.efforts.includes(effort || '') ? effort : null,
      serviceTier: (preference ? preference.fast : previous.serviceTier === model?.fastMode?.serviceTier) && model?.fastMode ? model.fastMode.serviceTier : 'default' };
  }
  function change(update: (previous: Settings) => Settings) {
    if (disabled || restartPending.current) return;
    const next = update(current.current);
    current.current = next; setChoice(next); pending.current++; onSaving(true);
    // Serialize rapid slider/model changes, keeping the menu open while saving.
    queue.current = queue.current.then(async () => {
      try {
        // Resolve model switches after preceding saves, including rapid A/B/A.
        const next = update(saved.current);
        const result = await save({ model: next.model || '', effort: next.effort || '', ...(agent === 'codex' ? { serviceTier: next.serviceTier || 'default' } : {}) });
        remember(saved.current); saved.current = settingsOf(result); remember(saved.current);
      }
      catch (error) { reportError(error); }
      finally {
        if (--pending.current === 0) {
          current.current = saved.current; setChoice(saved.current); onSaving(restartPending.current); refresh();
        }
      }
    });
  }
  function select(nextAgent: AgentId, id: string) {
    if (disabled || restartPending.current) return;
    if (nextAgent === agent) {
      change(previous => modelSettings(id, previous));
      return;
    }
    restartPending.current = true; setRestarting(true); onSaving(true);
    // Retry a lost response with the same identity, so it cannot create two replacements.
    const key = 'papilot:restart:' + task.id;
    const replacementId = requestId(browserStorage, key, JSON.stringify([nextAgent, id]), newId);
    const savedRequest = browserStorage.getItem(key);
    // Finish any queued model edits before stopping the original task.
    queue.current = queue.current.then(async () => {
      try {
        remember(saved.current);
        if (task.mode !== 'review') savePermissionPreference(agent, task.permissions || 'workspace');
        const runtime = runtimes[nextAgent], model = runtime?.models.find(model => id ? model.id === id : model.isDefault);
        const preference = readModelPreferences(nextAgent, id, model);
        await restart({ id: replacementId, agent: nextAgent, model: id, effort: preference ? taskEffort(preference.effort, model) : '',
          ...(nextAgent === 'codex' ? { serviceTier: preference?.fast && model?.fastMode ? model.fastMode.serviceTier : 'default' } : {}),
          permissions: task.mode === 'review' ? 'workspace' : readPermissionPreference(nextAgent, runtime), stop: true });
        if (browserStorage.getItem(key) === savedRequest) browserStorage.removeItem(key);
      }
      catch (error) { reportError(error); }
      finally { restartPending.current = false; setRestarting(false); onSaving(false); refresh(); }
    });
  }
  return <><AgentPicker refreshUsage={refreshUsage} agents={AGENT_IDS.filter(id => id === agent || ((id !== 'collaboration' || (runtimes.collaboration?.hidden === false && task.mode !== 'review')) && runtimes[id]?.models.length))
    .map(value => ({ value, label: agentLabel(value), runtime: value === agent ? runtime : runtimes[value], allowUnknownDefault: value === agent && !choice.model, restartsTask: value !== agent }))} agent={agent}
    permissions={permissions}
    permissionMode={task.mode !== 'review' ? task.permissions || 'workspace' : undefined}
    model={choice.model || ''} effort={choice.effort || ''} fast={Boolean(choice.serviceTier && choice.serviceTier !== 'default')}
    disabled={disabled || restarting} reconnecting={reconnecting} onReconnect={onReconnect} description={pending.current ? t('Saving…') : t('Next turn')}
    onSelect={select}
    onChange={patch => {
      const id = current.current.model, model = runtime?.models.find(model => id ? model.id === id : model.isDefault);
      change(previous => ({ ...modelSettings(id, previous), ...(patch.effort !== undefined ? { effort: patch.effort || null } : {}), ...(patch.fast !== undefined ? { serviceTier: patch.fast ? model?.fastMode?.serviceTier : 'default' } : {}) }));
    }}/>{restarting && <span className="spinner" role="status" aria-label={t('Stopping and restarting…')} title={t('Stopping and restarting…')}/>}</>;
}
