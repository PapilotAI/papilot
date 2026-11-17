import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AGENT_IDS, AGENT_NAMES, type AgentId, type RuntimeStatus, type Task } from '../shared.ts';
import { AgentPicker } from './agent-picker.tsx';
import { t } from './i18n.ts';
import { requestId } from './request-id.ts';
import { browserStorage } from './storage.ts';

type Settings = Pick<Task, 'model' | 'effort' | 'serviceTier'>;
const settingsOf = (task: Settings): Settings => ({ model: task.model, effort: task.effort, serviceTier: task.serviceTier });
interface RestartSettings { id: string; agent: AgentId; model: string; effort: string; stop: boolean }
const newId = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

export function TaskModelPicker({ task, runtime, runtimes, disabled, reconnecting, onReconnect, save, onSaving, refresh, reportError, permissions, restart }: {
  task: Task; runtime?: RuntimeStatus; disabled: boolean; reconnecting: boolean; onReconnect: () => void;
  runtimes: Partial<Record<AgentId, RuntimeStatus>>;
  save: (settings: { model: string; effort: string; serviceTier?: string }) => Promise<Task>;
  onSaving: (saving: boolean) => void; refresh: () => void; reportError: (error: unknown) => void;
  permissions?: ReactNode;
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
  function change(next: Settings) {
    if (disabled || restartPending.current) return;
    current.current = next; setChoice(next); pending.current++; onSaving(true);
    // Serialize rapid slider/model changes, keeping the menu open while saving.
    queue.current = queue.current.then(async () => {
      try { saved.current = settingsOf(await save({ model: next.model || '', effort: next.effort || '', ...(agent === 'codex' ? { serviceTier: next.serviceTier || 'default' } : {}) })); }
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
      const model = runtime?.models.find(model => model.id === id), previous = current.current;
      change({ model: id, effort: model?.efforts.includes(previous.effort || '') ? previous.effort : null,
        serviceTier: previous.serviceTier === model?.fastMode?.serviceTier ? previous.serviceTier : 'default' });
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
        await restart({ id: replacementId, agent: nextAgent, model: id, effort: '', stop: true });
        if (browserStorage.getItem(key) === savedRequest) browserStorage.removeItem(key);
      }
      catch (error) { reportError(error); }
      finally { restartPending.current = false; setRestarting(false); onSaving(false); refresh(); }
    });
  }
  return <><AgentPicker agents={AGENT_IDS.filter(id => id === agent || runtimes[id]?.models.length)
    .map(value => ({ value, label: AGENT_NAMES[value], runtime: value === agent ? runtime : runtimes[value], allowUnknownDefault: value === agent && !choice.model, restartsTask: value !== agent }))} agent={agent}
    permissions={permissions}
    permissionMode={task.mode !== 'review' ? task.permissions || 'workspace' : undefined}
    model={choice.model || ''} effort={choice.effort || ''} fast={Boolean(choice.serviceTier && choice.serviceTier !== 'default')}
    disabled={disabled || restarting} reconnecting={reconnecting} onReconnect={onReconnect} description={pending.current ? t('Saving…') : t('Next turn')}
    onSelect={select}
    onChange={patch => {
      const previous = current.current, model = runtime?.models.find(model => previous.model ? model.id === previous.model : model.isDefault);
      change({ ...previous, ...(patch.effort !== undefined ? { effort: patch.effort || null } : {}), ...(patch.fast !== undefined ? { serviceTier: patch.fast ? model?.fastMode?.serviceTier : 'default' } : {}) });
    }}/>{restarting && <span className="spinner" role="status" aria-label={t('Stopping and restarting…')} title={t('Stopping and restarting…')}/>}</>;
}
