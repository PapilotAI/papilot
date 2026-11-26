import { useEffect, useSyncExternalStore } from 'react';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import type { TaskApplyState } from './task-apply-state.ts';
import './task-commit.css';

export function TaskApply({ draft, merging, keepCurrent, disabled, branch, canCommit, pending, preferred, apply, commit, agent, generate, autoGenerate, shown }: {
  draft: TaskApplyState; merging: boolean; keepCurrent?: boolean; disabled: boolean; branch: string | null;
  canCommit: boolean; agent?: string; pending?: 'workspace' | 'commit'; preferred?: 'workspace' | 'commit';
  apply: () => Promise<unknown>; commit: (message?: string, confirmation?: string) => Promise<unknown>; generate?: (fresh: boolean) => Promise<string>; autoGenerate: boolean;
  /** Called once when this step appears, to prepare what saving will need. */
  shown?: () => void;
}) {
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot), busy = disabled || state.busy;
  useEffect(() => { shown?.(); }, []);
  useEffect(() => {
    if (generate && autoGenerate && canCommit && branch && !pending && !disabled) draft.prepare(() => generate(false), agent);
  }, [autoGenerate, canCommit, branch, pending, disabled, draft, generate, agent]);
  const displayedAgent = state.writing ? state.writingAgent : agent;
  const writingLabel = state.writing && displayedAgent ? t('{agent} is writing a commit message…', { agent: displayedAgent }) : undefined;
  const applyFirst = preferred === 'workspace' || !canCommit;
  return <div className="task-commit task-apply" aria-label={t('Save accepted changes')}>
    {(state.commitReview || keepCurrent) && <p className="task-commit-hint">{state.commitReview ? t('This passage includes earlier edits that have not been committed. You can commit the reviewed result together, or apply it without committing.') : t('Keep the latest wording in overlapping passages and save the other accepted changes.')}</p>}
    {state.commitReview && <details className="task-commit-preview"><summary>{t('View changes included in this commit')}</summary><pre>{state.commitReview.diff}</pre></details>}
    <div className="task-commit-compose">
      {!pending && <textarea aria-label={t('Commit message')} rows={1} value={state.message} placeholder={writingLabel || t('Commit message')} readOnly={busy} maxLength={5000} onChange={event => draft.edit(event.target.value)}/>}
      <div className="task-commit-toolbar">
        <span className="task-commit-branch" title={branch ? t('Commit to {branch}', { branch }) : t('Open a branch to commit')}><Icon name="branch" size={13}/><span>{branch || t('Open a branch to commit')}</span></span>
        {state.writing && <progress className="task-commit-progress" aria-label={writingLabel || t('Generate commit message')}/>}
        {generate && <button type="button" className="task-commit-generate" title={displayedAgent ? t('Write a commit message for the chosen files with {agent}', { agent: displayedAgent }) : undefined} aria-label={t('Generate commit message')} aria-busy={state.writing} disabled={busy || state.writing || !canCommit || Boolean(pending)} onClick={() => void draft.write(() => generate(true), agent)}>
          {state.writing ? <span className="task-commit-spinner" aria-hidden="true"/> : <Icon name="spark" size={15}/>}
        </button>}
        <div className="task-commit-actions">
          <button type="button" className={applyFirst ? 'task-commit-primary' : 'task-commit-alternative'} aria-label={state.busy && state.action === 'workspace' ? t('Applying…') : state.commitReview ? t('Apply without committing') : keepCurrent ? t('Keep latest wording and apply') : merging ? t('Confirm and apply') : t('Apply to workspace')} title={t('Apply without committing')} disabled={busy || pending === 'commit'} onClick={() => void draft.apply(apply)}>
            {state.busy && state.action === 'workspace' ? t('Applying…') : keepCurrent ? t('Keep latest wording and apply') : t('Apply')}
          </button>
          <button type="button" className={applyFirst ? 'task-commit-alternative' : 'task-commit-primary'} aria-label={state.busy && state.action === 'commit' ? t('Committing…') : state.commitReview ? t('Commit together') : keepCurrent ? t('Keep latest wording and commit') : merging ? t('Confirm and commit') : t('Commit to manuscript')} title={branch ? t('Commit to {branch}', { branch }) : t('Open a branch to commit')} disabled={busy || pending === 'workspace' || !canCommit || !branch || (pending !== 'commit' && !state.message.trim())} onClick={() => void draft.apply(() => commit(pending === 'commit' ? undefined : state.message.trim(), state.commitReview?.token), 'commit')}>
            {state.busy && state.action === 'commit' ? t('Committing…') : state.commitReview ? t('Commit together') : keepCurrent ? t('Keep latest wording and commit') : t('Commit')}<Icon name="arrowRight" size={14}/>
          </button>
        </div>
      </div>
    </div>
    {state.error && <p className="task-commit-error" role="alert">{state.error}</p>}
  </div>;
}
