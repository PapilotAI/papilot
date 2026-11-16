import { useEffect, useRef, useState } from 'react';
import { AGENT_IDS, AGENT_NAMES, type AgentId, type RuntimeStatus, type Task } from '../shared.ts';
import { AgentPicker } from './agent-picker.tsx';
import { keepDialogFocus } from './focus.ts';
import { errorText, t } from './i18n.ts';

export interface RestartSettings { id: string; agent: AgentId; model: string; effort: string; serviceTier?: string; stop: boolean }
const newId = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
export function RestartTaskDialog({ task, runtimes, onClose, submit, onDone, reconnecting, onReconnect }: {
  task: Task; runtimes: Partial<Record<AgentId, RuntimeStatus>>; onClose: () => void;
  submit: (settings: RestartSettings) => Promise<Task>; onDone: (task: Task) => void;
  reconnecting: boolean; onReconnect: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), pending = useRef(false);
  const identity = useRef({ id: newId(), settings: '' });
  const agents = AGENT_IDS.filter(id => runtimes[id]?.connected && runtimes[id]?.authenticated && runtimes[id]?.models.length)
    .map(value => ({ value, label: AGENT_NAMES[value], runtime: runtimes[value] }));
  const [agent, setAgent] = useState<AgentId>(() => agents.find(option => option.value !== (task.agent || 'codex'))?.value || agents[0]?.value || 'codex');
  const [model, setModel] = useState(''), [effort, setEffort] = useState(''), [fast, setFast] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [stop, setStop] = useState(false);
  const runtime = runtimes[agent], selected = runtime?.models.find(item => model ? item.id === model : item.isDefault);
  const working = Boolean(task.preparation) || ['preparing', 'running', 'queued', 'waiting_input', 'building'].includes(task.status);
  const blocked = ['uncertain', 'deleting'].includes(task.status) || Boolean(task.pendingReview || task.delivery?.pending);
  useEffect(() => {
    const element = dialog.current!, opener = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  async function restart() {
    if (pending.current || !selected || blocked || (working && !stop)) return;
    pending.current = true; setBusy(true); setError('');
    const settings = JSON.stringify([agent, selected.id, effort, fast]);
    if (identity.current.settings && identity.current.settings !== settings) identity.current.id = newId();
    identity.current.settings = settings;
    try { onDone(await submit({ id: identity.current.id, agent, model: selected.id, effort, ...(agent === 'codex' ? { serviceTier: fast ? selected.fastMode?.serviceTier : 'default' } : {}), stop })); }
    catch (failure) { setError(errorText(failure instanceof Error ? failure.message : String(failure))); }
    finally { pending.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="modal-backdrop" aria-labelledby="restart-task-title" onKeyDown={keepDialogFocus} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <section className="modal delete-dialog">
      <h2 id="restart-task-title">{t('Restart with another agent')}</h2>
      <p className="delete-task-name">{task.title}</p>
      <p>{t('Rerun the original request in a new task. This task stays as it is.')}</p>
      {agents.length ? <AgentPicker agents={agents} agent={agent} model={selected?.id || ''} effort={effort} fast={fast} disabled={busy}
        reconnecting={reconnecting} onReconnect={onReconnect} allowUnknownDefault={false}
        onSelect={(value, id) => { setAgent(value); setModel(id); setEffort(''); setFast(false); }}
        onChange={patch => { if (patch.effort !== undefined) setEffort(patch.effort); if (patch.fast !== undefined) setFast(patch.fast); }}/>
        : <p role="status">{t('Connect an agent with an available model before restarting.')}</p>}
      {working && <label className="restart-stop"><input type="checkbox" checked={stop} disabled={busy} onChange={event => setStop(event.target.checked)}/>{t('Stop this task first')}</label>}
      {blocked && <p role="status">{t('Resolve the pending task action before restarting.')}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
        <button type="button" className="button primary" disabled={busy || !selected || !runtime?.connected || !runtime.authenticated || blocked || (working && !stop)} onClick={() => void restart()}>{busy ? t('Stopping and restarting…') : t('Restart task')}</button></div>
    </section>
  </dialog>;
}
