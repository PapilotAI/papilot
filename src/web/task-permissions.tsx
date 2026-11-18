import { useId, useState } from 'react';
import { type RuntimeStatus, type Task, type TaskPermissions } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

// Keep runtime-provided text discoverable by the locale catalog extractor.
export function permissionText(text: string) {
  const messages: Record<string, string> = {
    "Workspace access": t("Workspace access"),
    "Full access": t("Full access"),
    "Sandboxed edits": t("Sandboxed edits"),
    "Bypass permissions": t("Bypass permissions"),
    "Default": t("Default"),
    "Plan": t("Plan"),
    "Auto": t("Auto"),
    "YOLO": t("YOLO"),
    "Auto edit": t("Auto edit"),
    "Allow all": t("Allow all"),
    "Sandbox": t("Sandbox"),
    "Unrestricted": t("Unrestricted"),
    "Accept edits": t("Accept edits"),
    "Always proceed": t("Always proceed"),
    "Paper edits": t("Paper edits"),
  };
  return messages[text] || text;
}

// Keep the provider's approval behavior explicit without displaying long tool descriptions.
function permissionDetail(detail: string) {
  const messages: Record<string, string> = {
    "Ask before tools": t("Ask before tools"),
    "Approve edits": t("Approve edits"),
    "Read-only planning": t("Read-only planning"),
    "Approve safe operations": t("Approve safe operations"),
    "Approve all tools": t("Approve all tools"),
    "Native approvals": t("Native approvals"),
    "Sandboxed tools": t("Sandboxed tools"),
    "No sandbox": t("No sandbox"),
    "Other requests denied": t("Other requests denied"),
    "Ask before commands": t("Ask before commands"),
    "Fixed ACP preset": t("Fixed ACP preset"),
    "Plan first": t("Plan first"),
    "Plan before editing": t("Plan first"),
    "Skip approval prompts; native rules still apply": t("Skip approval prompts; native rules still apply"),
    "Approve edits; ask before commands": `${t("Approve edits")}; ${t("Ask before commands")}`,
    "Plan changes; may write planning files": t("Plan changes; may write planning files"),
    "Bypass tool approvals": t("Approve all tools"),
    "Sandboxed; exceptions need approval": t("Sandboxed; exceptions need approval"),
    "Bypass sandbox and approvals": t("Bypass sandbox and approvals"),
    "Write within the workspace and configured writable roots, with network access. Ask before exceeding sandbox restrictions.": t("Sandboxed; exceptions need approval"),
    "Disable the sandbox and run tools without approval, subject to managed settings.": t("Bypass sandbox and approvals"),
    "Automatically approve edits and sandboxed commands. Other permission requests are denied in print mode.": t("Sandboxed; other requests denied"),
    "Automatically approve edits and sandboxed commands. Ask before other actions.": t("Sandboxed; exceptions need approval"),
    "Automatically approve edits without a command sandbox. Other permission requests are denied in print mode.": `${t("No sandbox")}; ${t("Other requests denied")}`,
    "Automatically approve edits without a command sandbox. Ask before other actions.": `${t("No sandbox")}; ${t("Native approvals")}`,
    "Disable the command sandbox and bypass tool approvals, subject to managed settings.": t("Bypass sandbox and approvals"),
    "Read, edit LaTeX and BibTeX, compile, view pages and add verified references without asking. Ask before other files change, files are moved or deleted, and before chore mode runs shell commands.": t("LaTeX edits run; other changes ask first"),
    "Never ask: every edit, deletion and chore-mode command runs without approval, still only inside the task worktree.": t("Never ask; stays in the task worktree"),
  };
  return messages[detail] || '';
}

export function PermissionOptions({ runtime, value, disabled, hint, onChange }: { runtime?: RuntimeStatus; value: TaskPermissions; disabled?: boolean; hint?: string; onChange: (value: TaskPermissions) => void }) {
  const id = useId();
  const options = runtime?.permissionOptions || [];
  if (!options.length) return null;
  const selected = options.find(option => option.value === value);
  return <div className="task-permissions"><fieldset disabled={disabled} aria-describedby={`${id}-detail${hint ? ` ${id}-hint` : ''}`}>
    <legend>{t('Permissions')}</legend>
    <div className="task-permission-choices">{options.map(option => <label key={option.value} className="task-permission-option" title={permissionDetail(option.detail)}>
      <input type="radio" name={id} value={option.value} checked={value === option.value} aria-labelledby={`${id}-${option.value}-label`} aria-description={permissionDetail(option.detail)} onChange={() => onChange(option.value)}/>
      <Icon name="check" size={13}/><span id={`${id}-${option.value}-label`}>{permissionText(option.label)}</span>
    </label>)}</div>
    <p id={`${id}-detail`} className="task-permission-detail">{selected && permissionDetail(selected.detail)}</p>
    {hint && <p id={`${id}-hint`} className="task-permissions-hint">{hint}</p>}
  </fieldset></div>;
}

export function TaskPermissionOptions({ task, runtime, disabled, save, onSaved, onSaving, refresh, reportError }: {
  task: Task; runtime?: RuntimeStatus; disabled: boolean; save: (permissions: TaskPermissions) => Promise<Task>;
  onSaved: (task: Task) => void; onSaving: (value: boolean) => void; refresh: () => void; reportError: (error: unknown) => void;
}) {
  const [saving, setSaving] = useState(false);
  const busy = ['running', 'waiting_input', 'building', 'uncertain', 'queued', 'deleting'].includes(task.status);
  if (task.mode === 'review') return null;
  // A task being prepared starts in a moment; it cannot be paused.
  return <PermissionOptions runtime={runtime} value={task.permissions || 'workspace'} disabled={disabled || busy || task.status === 'preparing' || saving} hint={busy ? t('Pause to change') : undefined}
    onChange={async permissions => {
      setSaving(true); onSaving(true);
      try { onSaved(await save(permissions)); }
      catch (error) { reportError(error); }
      finally { refresh(); setSaving(false); onSaving(false); }
    }}/>;
}
