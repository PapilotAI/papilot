import { useEffect, useRef, useState } from 'react';
import type { Task } from '../shared.ts';
import { keepDialogFocus } from './focus.ts';

export function DeleteTaskDialog({ task, submit, onClose, onDeleted, refresh }: { task: Task; submit: () => Promise<unknown>; onClose: () => void; onDeleted: () => void; refresh: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const blocked = ['running', 'waiting_input', 'queued'].includes(task.status) ? 'Pause this task before deleting it.'
    : task.status === 'building' ? 'Wait for the PDF build to finish before deleting this task.'
    : task.status === 'uncertain' ? 'Check task status before deleting this task.' : '';
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal(); element.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    return () => { element.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  async function remove() {
    if (pending.current || blocked) return;
    pending.current = true; setBusy(true); setError('');
    try { await submit(); onDeleted(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); refresh(); }
    finally { pending.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="modal-backdrop" aria-labelledby="delete-title" aria-describedby="delete-description" onKeyDown={keepDialogFocus} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="modal delete-dialog">
      <h2 id="delete-title">Delete task?</h2>
      <p className="delete-task-name">{task.title}</p>
      <p id="delete-description">This permanently removes the task from Papilot, including its conversation, worktree, and PDF review files. Unaccepted edits and saved comments will be discarded, and review decisions can no longer be undone.</p>
      <p>Accepted changes in your manuscript stay in place. Other tasks are not affected.</p>
      {task.status === 'deleting' && <p className="muted">Deletion has already started. Retry to confirm the cleanup and remove the task.</p>}
      {blocked && <p className="inline-error" role="status">{blocked}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="button-row"><button data-cancel className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button danger" disabled={busy || Boolean(blocked)} onClick={() => void remove()}>{busy ? 'Deleting…' : task.status === 'deleting' ? 'Retry deletion' : 'Delete task'}</button></div>
    </section>
  </dialog>;
}
