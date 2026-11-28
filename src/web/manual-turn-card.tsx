import { useEffect, useId, useRef, useState } from 'react';
import type { AgentId, ManualGithubContext } from '../shared.ts';
import { BrandIcon } from './brand-icon.tsx';
import { Icon } from './icons.tsx';
import { errorText, t } from './i18n.ts';
import { copyText } from './owner-window.ts';

type Api = <T>(route: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
export interface ManualExecutorPreview {
  agent: AgentId;
  name: string;
  model: string | null;
  effort?: string | null;
}
export interface ManualPromptResponse {
  runId: string;
  prompt: string;
  executor: ManualExecutorPreview | null;
  github?: ManualGithubContext;
}

export function ManualTurnCard({ taskId, runId, api, refreshKey, onExecutor }: {
  taskId: string;
  runId: string;
  api: Api;
  refreshKey?: string;
  onExecutor?: (executor: ManualExecutorPreview | null | undefined) => void;
}) {
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastAnnouncement = useRef('');
  const syncController = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);
  const mounted = useRef(true);
  const [data, setData] = useState<ManualPromptResponse | null>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      syncController.current?.abort();
      clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    syncController.current?.abort();
    requestSeq.current += 1;
    setData(null);
    setShow(false);
    setCopied(false);
    setStatus('');
    setSyncing(false);
    setSyncError('');
    onExecutor?.(undefined);
  }, [taskId, runId]);

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++requestSeq.current;
    setError('');
    void api<ManualPromptResponse>(`/tasks/${encodeURIComponent(taskId)}/manual-prompt`, undefined, controller.signal).then(
      value => {
        if (controller.signal.aborted || !mounted.current || seq !== requestSeq.current) return;
        setData(value);
        setSyncError(value.github?.syncError ? errorText(value.github.syncError) : '');
        onExecutor?.(value.executor ?? null);
      },
      failure => {
        if (controller.signal.aborted || !mounted.current || seq !== requestSeq.current) return;
        setError(errorText(failure instanceof Error ? failure.message : String(failure)));
      },
    );
    return () => { controller.abort(); };
  }, [api, taskId, runId, attempt, refreshKey]);

  // If background auto-sync is running on the server, refresh once it finishes.
  useEffect(() => {
    if (!data?.github?.syncing) return;
    const poll = setTimeout(() => setAttempt(value => value + 1), 1200);
    return () => clearTimeout(poll);
  }, [data?.github?.syncing, attempt]);

  function announce(message: string, ok: boolean) {
    clearTimeout(timer.current);
    const next = message === lastAnnouncement.current ? `${message}\u00a0` : message;
    lastAnnouncement.current = next;
    setCopied(ok);
    setStatus(next);
    timer.current = setTimeout(() => { setCopied(false); setStatus(''); }, 2200);
  }

  async function copyPrompt(button: HTMLElement) {
    if (!data?.prompt) return;
    const ok = await copyText(data.prompt, button);
    if (ok) {
      announce(t('Copied'), true);
      return;
    }
    setShow(true);
    announce(t('Copy the prompt from the field below.'), false);
    requestAnimationFrame(() => { field.current?.focus(); field.current?.select(); });
  }

  async function syncGithub(remoteName: string) {
    if (syncing) return;
    syncController.current?.abort();
    const controller = new AbortController();
    syncController.current = controller;
    setSyncing(true);
    setSyncError('');
    try {
      const updated = await api<ManualPromptResponse>(`/tasks/${encodeURIComponent(taskId)}/manual-github-sync`, { remote: remoteName }, controller.signal);
      if (controller.signal.aborted || !mounted.current || syncController.current !== controller) return;
      requestSeq.current += 1;
      setData(updated);
      onExecutor?.(updated.executor ?? null);
      announce(t('GitHub context ready'), false);
    } catch (failure) {
      if (controller.signal.aborted || !mounted.current || syncController.current !== controller) return;
      setSyncError(errorText(failure instanceof Error ? failure.message : String(failure)));
    } finally {
      if (mounted.current && syncController.current === controller) {
        syncController.current = null;
        setSyncing(false);
      }
    }
  }

  const github = data?.github;
  const primaryRemote = github?.remotes[0];
  const synced = github?.synced ?? null;
  const isSyncing = syncing || Boolean(github?.syncing);

  return <div className="request-card manual-turn-card">
    <h3><BrandIcon name="chatgpt" size={16}/>{t('ChatGPT Pro (web)')}</h3>
    <p>{synced
      ? t('This prompt points ChatGPT Pro to your synced GitHub repo for full-manuscript context. Copy it into ChatGPT Pro, then paste its reply below.')
      : t('Copy this prompt into your ChatGPT Pro conversation, then paste its reply below.')}</p>
    {error ? <div className="manual-turn-actions">
      <p className="inline-error" role="alert">{error}</p>
      <button type="button" className="button secondary compact" onClick={() => setAttempt(value => value + 1)}>{t('Try again')}</button>
    </div> : !data ? <p className="muted"><span className="spinner" aria-hidden="true"/> {t('Preparing prompt…')}</p> : <>
      {primaryRemote && <div className="manual-github-row">
        <div className="manual-github-meta">
          <BrandIcon name="github" size={14}/>
          {isSyncing ? (
            <span><span className="spinner" aria-hidden="true"/> {t('Syncing snapshot to GitHub…')}</span>
          ) : synced ? (
            <>
              <a className="manual-github-link" href={synced.url} target="_blank" rel="noopener noreferrer">{synced.repository} · {synced.branch}</a>
              <code className="manual-github-sha">{synced.commit.slice(0, 7)}</code>
            </>
          ) : (
            <span className="manual-github-repo">{primaryRemote.repository}</span>
          )}
          {!isSyncing && synced && <span className="manual-github-badge">{t('GitHub context ready')}</span>}
        </div>
        {!synced && !isSyncing && (
          <button type="button" className="button secondary compact" onClick={() => void syncGithub(primaryRemote.name)}>
            {t('Sync to GitHub')}
          </button>
        )}
      </div>}
      {syncError && <p className="inline-error manual-github-error" role="alert">{syncError}</p>}
      <div className="manual-turn-actions">
        <button type="button" className="button primary compact" data-copied={copied ? '' : undefined} disabled={isSyncing} onClick={event => void copyPrompt(event.currentTarget)}>
          <Icon name={copied ? 'check' : 'copy'} size={14}/>{t('Copy prompt')}
        </button>
        <button type="button" className="button secondary compact" aria-expanded={show} aria-controls={fieldId} onClick={() => setShow(value => !value)}>
          {show ? t('Hide prompt') : t('Show prompt')}
        </button>
        <span className="manual-copy-status" role="status">{status}</span>
      </div>
      <textarea ref={field} id={fieldId} className="manual-prompt-field" aria-label={t('Prompt for ChatGPT Pro')} hidden={!show} readOnly value={data.prompt} spellCheck={false} rows={7}/>
    </>}
  </div>;
}
