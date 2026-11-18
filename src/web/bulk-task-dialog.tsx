import { useLayoutEffect, useId, useRef, useState } from 'react';
import type { Task } from '../shared.ts';
import { t, tn } from './i18n.ts';

export interface BulkTaskAction {
  action: 'archive' | 'delete';
  archived: boolean;
  paper: string;
  tasks: Task[];
}

export function BulkTaskDialog({ target, submit, onSuccess, refresh, onClose }: {
  target: BulkTaskAction;
  submit: (task: Task) => Promise<unknown>;
  onSuccess: (task: Task) => void;
  refresh: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), pending = useRef(false);
  const id = useId();
  const [busy, setBusy] = useState(false), [processed, setProcessed] = useState(0);
  const [remaining, setRemaining] = useState(target.tasks);
  const [failures, setFailures] = useState<{ task: Task; error: string }[]>([]);
  const deleting = target.action === 'delete';
  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      // Native focus restoration cannot return to a now-empty list's disabled menu.
      requestAnimationFrame(() => {
        if (!opener?.isConnected || opener.matches(':disabled')) document.querySelector<HTMLInputElement>('.task-search input')?.focus();
      });
    };
  }, []);
  async function run() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setProcessed(0); setFailures([]);
    const failed: typeof failures = [];
    // Keep the confirmed IDs fixed and serialize cleanup of task worktrees.
    for (const [index, task] of remaining.entries()) {
      try { await submit(task); onSuccess(task); }
      catch (error) { failed.push({ task, error: error instanceof Error ? error.message : String(error) }); }
      setProcessed(index + 1);
    }
    setFailures(failed); setRemaining(failed.map(item => item.task));
    pending.current = false; setBusy(false); refresh();
    if (!failed.length) onClose();
  }
  return <dialog ref={dialog} className="modal-backdrop bulk-task-backdrop" aria-labelledby={id + '-title'} aria-describedby={id + '-description'}
    closedby={busy ? 'none' : 'closerequest'}
    onCancel={event => { event.preventDefault(); if (!pending.current) onClose(); }}>
    <section className="modal delete-dialog">
      <h2 id={id + '-title'}>{deleting ? target.archived ? t('Delete all archived tasks?') : t('Delete all current tasks?') : t('Archive all tasks?')}</h2>
      <p id={id + '-description'} className="delete-task-name">{target.paper} · {tn(target.tasks.length, '{n} task', '{n} tasks')}</p>
      {deleting && <p>{t('Cannot be undone. Manuscript changes are kept.')}</p>}
      {busy && <p><progress max={remaining.length} value={processed} aria-label={t('Task progress')}/> {t('{done} of {total}', { done: processed, total: remaining.length })}</p>}
      {failures.length > 0 && <div role="alert">
        <p>{tn(failures.length, '{n} task failed.', '{n} tasks failed.')}</p>
        <ul className="bulk-task-errors">{failures.map(({ task, error }) => <li key={task.id}><strong>{task.title}</strong><span>{error}</span></li>)}</ul>
      </div>}
      <div className="button-row">
        <button type="button" autoFocus className="button secondary" disabled={busy} onClick={onClose}>{failures.length ? t('Close') : t('Cancel')}</button>
        <button type="button" className={'button ' + (deleting ? 'danger' : 'primary')} disabled={busy} onClick={() => void run()}>{busy ? deleting ? t('Deleting…') : t('Archiving…') : failures.length ? t('Retry') : deleting ? t('Delete all') : t('Archive all')}</button>
      </div>
    </section>
  </dialog>;
}
