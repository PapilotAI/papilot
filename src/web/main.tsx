import { createConversation, agentName, workingAgentName, ACTIVE, preparingLabel, touch } from './conversation.tsx';
import '../../engine/src/web/legacy-storage.ts';
import { TaskDocument } from './task-document.tsx';
import { requestApi, requestState } from './api.ts';
import { agentLabel, agentsSettled, canReviewWith, chosenAgent, defaultOfferedModel, noAgent, offeredAgents, shownModels } from './agent-choice.ts';
import { isPlayground, pdfAsset, wordAsset, requestPlaygroundDownload } from './playground-mode.ts';
import { annotationGroupState, canonicalGroup, groupsWithoutInstructions, noteGroups, type NoteGroup } from '../note-groups.ts';
import { NOTE_SORT_MODES, groupNoteEntries, isNoteSortMode, sortNoteEntries, type NoteSortMode } from '../note-sort.ts';
import { GroupCard, GroupInstruction, GroupPicker } from './note-groups.tsx';
import { SectionNotePicker } from './section-note-picker.tsx';
import { useNoteSelection } from './note-selection.tsx';
import { ClearAnnotationsDialog } from './clear-annotations-dialog.tsx';
import { useGroupInstructions, type GroupDraftChange } from './group-instructions.ts';
import { markText, NoteQuote } from './note-content.tsx';
import { NoteAttachButton, NoteEditButton, PdfNoteCard, TaskRemoveButton } from './pdf-suggestion.tsx';
import { StrictMode, Suspense, lazy, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal, flushSync } from 'react-dom';
import { ignorePattern } from '../commit.ts';
import { effectiveServiceTier, modelServiceTier, AGENT_IDS, isAgentId, isManualAgent, isTaskReviewNote, taskFinished } from '../shared.ts';
import type { ChatgptProSettings as ChatgptProSettingsState, TaskCommitReview, CompilerChoice, LatexInstallation, ZoteroStatus, AgentId, Annotation, AnnotationGroupEdit, AnnotationGroupState, AnnotationBatch, AnnotationBatchResult, NoteSection, PageReadingLayout, BuildRepairResult, MarkKind, GitDiff, GitFile, GitOverview, GitStatus, Manuscript, ManuscriptProblems, Project, RuntimeStatus, Skill, Snapshot, Task, TimelineItem } from '../shared.ts';
import { SkillPicker, skillName } from './skills.tsx';
import { reviewDraft, useReviewDraft, reviewSubmission } from './review-draft.ts';
import { ComposerDraft, sendsMessage, taskTitle, pendingReviewFeedback } from './composer.ts';
import { useAttachmentDraft } from './attachments.tsx';
import type { Attachment, CollaborationSettings as CollaborationSettingsState, NoteResult, NoteReturnReceipt, NoteReturnState, RemovedNoteReturn } from '../shared.ts';
import { ReadRequest, canStreamUpdates, mergeTimeline } from './refresh.ts';
import { browserStorage } from './storage.ts';
import { requestId } from './request-id.ts';
import { readPlace, savePlace } from './places.ts';
import { ModeSwitch, type PdfMode } from './mode-switch.tsx';
import { ReviewFrame, type ReviewSources } from './review-frame.tsx';
import { AiReviewView } from './ai-review.tsx';
import { keepDialogFocus } from './focus.ts';
import { DeleteTaskDialog } from './task-dialog.tsx';
import { BulkTaskDialog, type BulkTaskAction } from './bulk-task-dialog.tsx';
import { ActionMenu } from './action-menu.tsx';
import { Icon } from './icons.tsx';
import { BrandIcon } from './brand-icon.tsx';
import { UpdateNotice, versionLabel } from './update-notice.tsx';
import { chooseDirectory, DesktopWindowChrome, nativeFolders } from './desktop-chrome.tsx';
import { MainFileDialog } from './main-file-dialog.tsx';
import { PaperDialog } from './paper-dialog.tsx';
import { HostAccountMenu } from './host-account-menu.tsx';
import { NewPaperDialog } from './new-paper-dialog.tsx';
import { CompileButton } from './compile-button.tsx';
import { ProblemsButton, fixRequest, type ProblemsHandle } from './build-problems.tsx';
import { SourceTab, useSourceEdit } from './source-panel.tsx';
import type { OpenSource, ReviewChanges } from '../../engine/src/web/review-events.ts';
import { useTheme } from './theme.tsx';
import { SettingsDialog, type SettingsInitialPage } from './settings.tsx';
import { MemoryNudge, OPEN_MEMORY, shownSuggestions } from './memory-card.tsx';
import type { ZoteroApi } from './zotero-settings.tsx';
import type { QuickModel, QuickModelApi } from './model-default-settings.tsx';
import { EVIDENCE_CHANGED, PaperEvidence, useEvidenceMarks, type EvidenceActions } from './evidence-marks.tsx';
import { CitationCheckView, type ModelChoice } from './citation-check.tsx';
import { WorkspaceSwitcher } from './workspace-switcher.tsx';
import { workspaceModifier, workspaceShortcutLabel } from './workspace-switch.ts';
import { useSystemRequirements, missingTools, RequirementsBanner } from './system-requirements.tsx';
import { connectStamps } from './stamps.ts';
import { connectIndirectChanges } from './effect-preferences.ts';
import { connectNoteAlternatives } from './note-option-preferences.ts';
import type { DiagnosticReport, SystemRequirements, ActivityReport } from '../shared.ts';
import { CommitDialog } from './commit-dialog.tsx';
import { TaskConflict } from './task-conflict.tsx';
import { TaskApply } from './task-apply.tsx';
import { TaskApplyState } from './task-apply-state.ts';
import { taskSaveStatus } from './task-save-status.ts';
import { TaskSaved } from './task-saved.tsx';
import { GitRepository } from './git-overview.tsx';
import { useAdvancedGit, commitMessageLanguage } from './git-preferences.ts';
import { commitConversation, rememberCommitConversation, useCommitMessageAgent, useConflictAgent, type CommitMessageChoice } from './commit-agent-preferences.ts';
import { GitDiffView } from './git-diff-view.tsx';
import { VersionHistory, type HistorySelection } from './git-history.tsx';
import type { GitHistory, GitVersionDetail } from '../shared.ts';
import { citeRequest, LibraryPanel, problemCount, useLibrary, type LibraryFocus } from './library-panel.tsx';
import { errorText, locale, t, tn, useLanguage } from './i18n.ts';
import { notificationState, notify, notifying, subscribeNotifications, taskAlerts } from './notifications.ts';
import { Markdown } from './markdown.tsx';
import { ComparisonProgress } from './comparison-progress.tsx';
import { PapilotMark } from './papilot-mark.tsx';
import { AgentConnectionNotice, AgentPicker, NoAgentNotice, WriterSuggestion } from './agent-picker.tsx';
import { taskEffort } from './task-effort.ts';
import { readModelPreferences, readPermissionPreference, saveModelPreferences, savePermissionPreference, useAgentPreferenceChanges } from './agent-preferences.ts';
import { PermissionOptions } from './task-permissions.tsx';
import { TaskFlight, type TaskFlightData } from './task-flight.tsx';
import { returnNotes } from './note-flight.ts';
import { UsageSummary, type RefreshUsage } from './usage.tsx';
import { useNoteUndo } from './use-note-undo.ts';
import { NOTE_RETURN_HISTORY, NoteResultsProvider } from './note-results.tsx';
import { usePanelWidth } from './panel-width.tsx';
import { RepositoryFilesMenu } from './repository-files.tsx';
import { OverleafLinkDialog, OverleafPanel, OverleafRow } from './overleaf.tsx';
import { setPresence } from './overleaf-presence.ts';
import type { OutlineItem, PdfHandle, PdfHistoryActions, Rect } from './pdf-view.tsx';
import './style.css';
import './note-controls.css';
// pdf.js is large, so the PDF view loads the first time it opens.
const PlaygroundNotice = import.meta.env.MODE === 'playground' ? lazy(() => import('./playground/notice.tsx').then(module => ({ default: module.PlaygroundNotice }))) : null;
const PlaygroundPresets = import.meta.env.MODE === 'playground' ? lazy(() => import('./playground/preset-tasks.tsx').then(module => ({ default: module.PlaygroundPresets }))) : null;
const PdfView = lazy(() => import('./pdf-view.tsx').then(module => ({ default: module.PdfView })));

let token = '';
const uuid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(20)), b => b.toString(16).padStart(2, '0')).join('');
async function api<T = any>(route: string, body?: unknown, signal?: AbortSignal, _wait?: number, priority?: RequestPriority): Promise<T> {
  if (import.meta.env.MODE === 'playground') return (await import('./playground/api.ts')).playgroundApi<T>(route, body, signal);
  return requestApi<T>(route, token, body, signal, priority);
}
connectStamps(api);
const refreshUsage: RefreshUsage = async agent => import.meta.env.MODE === 'playground' ? null : (await api(`/runtime/${agent}/usage`, {})).usage;
connectIndirectChanges(api);
connectNoteAlternatives(api);
const { Activity, Composer } = createConversation(api);
const uploadAttachment = (projectId: string, file: File, signal: AbortSignal) => api<Attachment>(`/projects/${projectId}/attachments`, file, signal);
const detectLatexInstallation = (signal: AbortSignal) => api<LatexInstallation | null>('/runtime/latex', undefined, signal);
const quickModelApi: QuickModelApi = {
  load: () => api<{ choice: QuickModel | null }>('/quick-model'),
  save: choice => api<{ choice: QuickModel | null }>('/quick-model', choice ?? { agent: null }),
};
const zoteroApi: ZoteroApi = {
  load: (sync, signal) => api<ZoteroStatus>(`/library/zotero${sync ? '?sync=1' : ''}`, undefined, signal),
  connect: key => api<ZoteroStatus>('/library/zotero/account', { key }),
  disconnect: () => api<ZoteroStatus>('/library/zotero/account/remove', {}),
  use: use => api<ZoteroStatus>('/library/zotero/use', { use }),
  locate: dataDir => api<ZoteroStatus>('/library/zotero/location', { dataDir }),
  folders: api,
};
const chooseCompiler = (compiler?: CompilerChoice['compiler']) => api<CompilerChoice>('/runtime/compiler', compiler ? { compiler } : undefined);
const loadRequirements = (signal: AbortSignal) => api<SystemRequirements>('/runtime/requirements', undefined, signal);
const checkDiagnostics = (projectId: string | undefined, signal: AbortSignal) => api<DiagnosticReport>('/diagnostics', { projectId }, signal);
const loadActivity = (params: { tz: string; range: string; projectId?: string }, signal: AbortSignal) => {
  const query = new URLSearchParams({ tz: params.tz, range: params.range, ...(params.projectId ? { projectId: params.projectId } : {}) });
  return api<ActivityReport>(`/activity?${query.toString()}`, undefined, signal);
};
// A finished publication with no round is a valid answer-only result. Keep
// earlier comparisons available when a follow-up answer makes no new edits.
const noManuscriptChanges = (task: Task) => task.status === 'reviewing' && task.review?.round === null && task.review.state !== 'build_failed' && !task.review.counts.pending;
const statusNames = (): Record<string, string> => ({ preparing: t('Preparing…'), idle: t('Ready'), queued: t('Queued'), waiting_input: t('Needs your reply'), building: t('Preparing task results'), reviewing: t('Ready for review'), interrupted: t('Paused'), failed: t('Needs attention'), uncertain: t('Check task status'), deleting: t('Deleting task') });
// A new task is saved at once and gets its manuscript copy in the background.
function Status({ task }: { task: Task }) {
  const answered = noManuscriptChanges(task), done = task.status === 'reviewing' && task.review?.state === 'done';
  const saved = taskSaveStatus(task);
  const awaitingManual = task.status === 'waiting_input' && task.manualTurn?.status === 'awaiting_reply';
  return <span className={`status ${task.status}${saved ? ' done' : ''}`}><i/>{saved === 'committed' ? t('Committed') : saved === 'applied' ? t('Applied to manuscript') : answered ? t('Completed') : done ? t('Review complete') : awaitingManual ? t('Waiting for ChatGPT Pro') : task.status === 'running' ? t('{agent} is working', { agent: workingAgentName(task) }) : task.status === 'preparing' ? preparingLabel(task) : task.status === 'building' && task.review?.ready ? t('Ready for review') : statusNames()[task.status] || task.status}</span>;
}
function ago(timestamp: number) {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return t('now'); if (minutes < 60) return t('{n}m', { n: minutes });
  if (minutes < 1440) return t('{n}h', { n: Math.floor(minutes / 60) }); if (minutes < 10080) return t('{n}d', { n: Math.floor(minutes / 1440) });
  return new Date(timestamp).toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
}
// "5m ago", or "just now".
const agoText = (timestamp: number) => Date.now() - timestamp < 60000 ? t('just now') : t('{time} ago', { time: ago(timestamp) });
function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query), change = () => setMatches(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, [query]);
  return matches;
}

// Shorten an absolute repository path to its last folders for menus.
function shortPath(value: string) {
  const normalized = value.replaceAll('\\', '/'), parts = normalized.split('/').filter(Boolean);
  return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : normalized;
}
function gitSummary(git: GitStatus | null) {
  if (!Array.isArray(git?.files)) return '';
  const sync = [git.ahead ? `↑${git.ahead}` : '', git.behind ? `↓${git.behind}` : ''].filter(Boolean).join(' ');
  return [git.branch || t('detached'), git.files.length ? t('{n} changed', { n: git.files.length }) : t('clean'), sync].filter(Boolean).join(' · ');
}

// A source-control style summary: where the manuscript is, its last commit,
// and what is not committed yet (accepted review changes land here).
// Untracked build output is left out of a commit unless chosen, and can go
// into .gitignore. An agent can write the commit message.
const noReadOnlyAgent = 'Connect an agent that supports read-only tasks, such as Codex.';
const ignorable = (file: GitFile) => file.status === '?' && Boolean(ignorePattern(file.path));
type GitSelection = { path: string; list: 'staged' | 'changes' } | HistorySelection;
const gitNames = (): Record<string, string> => ({ M: t('Modified'), A: t('Added'), D: t('Deleted'), R: t('Renamed'), C: t('Copied'), U: t('Conflict'), '?': t('Untracked'), T: t('Type changed') });

// A source-control panel in the shape of Cursor's. Changes: the commit
// message, Commit, and the staged and unstaged files, each with a diff and
// stage, unstage and discard actions. Commit takes what is staged, or with
// nothing staged, every file but build output as it is on disk. Then the
// commit graph, whose header fetches, pulls and pushes with the host's Git
// credentials, and the tasks' worktrees.
function DiscardDialog({ files, onCancel, onConfirm }: { files: GitFile[]; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!, opener = document.activeElement as HTMLElement | null;
    element.showModal(); element.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    return () => { element.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  const one = files.length === 1, untracked = files.filter(file => file.status === '?').length, name = files[0].path.slice(files[0].path.lastIndexOf('/') + 1);
  const deleting = one && untracked === 1;
  return <dialog ref={dialog} className="modal-backdrop" aria-labelledby="git-discard-title" onKeyDown={keepDialogFocus} onCancel={event => { event.preventDefault(); onCancel(); }} onClick={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="modal delete-dialog">
      <h2 id="git-discard-title">{deleting ? t('Delete {name}?', { name }) : one ? t('Discard changes in {name}?', { name }) : tn(files.length, 'Discard changes in {n} file?', 'Discard changes in {n} files?')}</h2>
      <p>{deleting ? t('This file is not tracked by Git, so it cannot be recovered.') : untracked ? t('Unstaged changes are lost for good and untracked files are deleted. Staged changes stay.') : t('Unstaged changes are lost for good. Staged changes stay.')}</p>
      <div className="button-row">
        <button type="button" data-cancel className="button secondary" onClick={onCancel}>{t('Cancel')}</button>
        <button type="button" className="button danger" onClick={onConfirm}>{deleting ? t('Delete file') : t('Discard changes')}</button>
      </div>
    </section>
  </dialog>;
}

type GitResolution = { merge: string; agent: AgentId; busy?: boolean; summary?: string; notice?: string; error?: string };

const gitMergeId = (git: GitStatus | null) => git?.merging ? [git.head?.hash, git.merging.head].join(':') : '';

function GitWorkspace({ projectId, navigation, git, onStatus, resolver, onChangeResolver, resolution, setResolution, messageWriter, tasks, onOpenTask }: { navigation?: React.ReactNode; tasks: Task[]; onOpenTask: (id: string) => void; projectId: string; git: GitStatus | null; onStatus: (status: GitStatus) => void; resolver: CommitMessageChoice; onChangeResolver: () => void; resolution?: GitResolution; setResolution: (value?: GitResolution) => void; messageWriter?: CommitMessageChoice }) {
  const advanced = useAdvancedGit();
  const [writingAgent, setWritingAgent] = useState<AgentId | null>(null);
  const displayedMessageAgent = writingAgent ?? messageWriter?.agent;
  const messageRequest = useRef(0);
  useEffect(() => () => { messageRequest.current++; }, []);
  const loadOverview = useCallback((signal: AbortSignal) => api<GitOverview>(`/projects/${projectId}/git/overview`, undefined, signal), [projectId]);
  const loadHistory = useCallback((before: string | null, signal: AbortSignal) => api<GitHistory>(`/projects/${projectId}/git/history${before ? '?before=' + before : ''}`, undefined, signal), [projectId]);
  const loadVersion = useCallback((hash: string, signal: AbortSignal) => api<GitVersionDetail>(`/projects/${projectId}/git/history/${hash}`, undefined, signal), [projectId]);
  const draftKey = `papilot:commit:${projectId}`;
  const [message, setMessage] = useState(() => browserStorage.getItem(draftKey) || '');
  const [operation, setBusy] = useState(''), [operationError, setError] = useState(''), [operationNotice, setNotice] = useState('');
  const busy = resolution?.busy ? 'resolve' : operation;
  const error = operationError || resolution?.error, notice = operationNotice || resolution?.notice;
  const [discarding, setDiscarding] = useState<GitFile[] | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<'changes' | 'history'>(() => readPlace('git-view:' + projectId) === 'history' ? 'history' : 'changes');
  const showDetail = (value: 'changes' | 'history') => { setDetail(value); savePlace('git-view:' + projectId, value); };
  const [source, setSource] = useState<GitSelection | null>(() => readPlace<GitSelection>('git-selection:' + projectId) || { path: '', list: 'changes' });
  const [diffRefresh, setDiffRefresh] = useState(0), [historyRefresh, setHistoryRefresh] = useState(0);
  const sourceOpener = useRef<HTMLElement | null>(null);
  const selectSource = (value: GitSelection | null) => { setSource(value); savePlace('git-selection:' + projectId, value); };
  const onOpenDiff = (value: GitSelection) => { sourceOpener.current = document.activeElement as HTMLElement | null; selectSource(value); showDetail('changes'); setDiffRefresh(value => value + 1); };
  const closeSource = () => { if (source?.list === 'history') { showDetail('history'); selectSource({ path: '', list: 'changes' }); } requestAnimationFrame(() => { if (sourceOpener.current?.isConnected) sourceOpener.current.focus({ preventScroll: true }); }); };
  const historyHash = source?.list === 'history' ? source.hash : null;
  const loadDiff = useCallback((path: string, signal: AbortSignal) => api<GitDiff>(historyHash ? `/projects/${projectId}/git/history/${historyHash}/diff?path=${encodeURIComponent(path)}` : `/projects/${projectId}/git/diff?path=${encodeURIComponent(path)}&scope=${source?.list === 'staged' ? 'staged' : 'unstaged'}`, undefined, signal), [projectId, historyHash, source?.list]);
  useEffect(() => {
    if (!git || source?.list === 'history') return;
    const file = git.files.find(file => file.path === source?.path) || git.files[0];
    if (!file) { if (source) selectSource(null); }
    else {
      const list = !git.merging && file.staged && (!file.unstaged || source?.list === 'staged') ? 'staged' : 'changes';
      if (source?.path !== file.path || source?.list !== list) selectSource({ path: file.path, list });
    }
  }, [git, source]);
  const selection = source;
  const latest = useRef({ busy, onStatus });
  latest.current = { busy, onStatus };
  // Discover incoming commits while this panel is visible; status alone only
  // sees the last fetched tracking ref. Fetch never changes manuscript files.
  useEffect(() => {
    if (!git?.remote) return;
    const controller = new AbortController();
    let fetching = false, checkedAt = 0;
    const check = async () => {
      if (document.hidden || latest.current.busy || fetching || Date.now() - checkedAt < 60_000) return;
      fetching = true; checkedAt = Date.now();
      try {
        const result = await api<{ git: GitStatus }>(`/projects/${projectId}/git/fetch`, {}, controller.signal);
        if (!controller.signal.aborted && !latest.current.busy) latest.current.onStatus(result.git);
      } catch { /* A manual sync reports network or authentication failures. */ }
      finally { fetching = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [projectId, git?.remote]);
  const files = git?.files || [];
  if (!git || !Array.isArray(git.files)) return <section className="git-workspace" aria-label={t('Version Management')}><div className="git-toolbar">{navigation}</div><p className="git-clean" role="status">{t('Loading version management…')}</p></section>;
  const staged = files.filter(file => file.staged), unstaged = files.filter(file => file.unstaged), chosen = staged.length ? staged : files.filter(file => !ignorable(file));
  const stage = (paths: string[], on: boolean) => { if (paths.length) void run('stage', () => api<{ git: GitStatus }>(`/projects/${projectId}/git/stage`, { paths, stage: on }), () => ''); };
  const saveMessage = (value: string) => { setMessage(value); if (value) browserStorage.setItem(draftKey, value); else browserStorage.removeItem(draftKey); };
  async function run<R extends { git: GitStatus }>(action: string, work: () => Promise<R>, done: (result: R) => string) {
    if (busy) return;
    setBusy(action); setError(''); setNotice('');
    try { const result = await work(); onStatus(result.git); setNotice(done(result)); setDiffRefresh(value => value + 1); }
    catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // A remote operation can fetch or commit before failing. Keep the
      // current counts, pending edits and conflict controls available.
      try { onStatus(await api<GitStatus>(`/projects/${projectId}/git`)); } catch { /* Keep the original failure. */ }
    }
    finally { setBusy(''); }
  }
  const merging = git.merging, publish = !git.upstream && git.remote && git.branch;
  const canPush = Boolean(git.remote && (git.upstream || publish) && !merging);
  const canSync = Boolean(canPush && git.branch);
  const synchronize = () => api<{ git: GitStatus }>(`/projects/${projectId}/git/sync`, {});
  const syncNotice = (status: GitStatus) => status.merging ? t('The merge stopped at conflicts.') : t('Synced with the remote. Uncommitted changes are kept.');
  const syncRemote = () => void run('sync', synchronize, result => syncNotice(result.git));
  // A failed sync or push leaves the successful local commit in place.
  const commit = (action: 'commit' | 'sync' | 'push' | 'amend' = 'commit') => {
    const text = message.trim();
    if (!text || !chosen.length) return;
    void run('commit', async () => {
      const result = await api<{ git: GitStatus; commit: string }>(`/projects/${projectId}/git/commit`, { ...(staged.length ? { message: text, staged: true } : { message: text, paths: chosen.map(file => file.path) }), ...(action === 'amend' ? { amend: true } : {}) });
      saveMessage('');
      if (action !== 'push' && action !== 'sync') return result;
      onStatus(result.git);
      setBusy(action);
      return { ...await (action === 'sync' ? synchronize() : api<{ git: GitStatus }>(`/projects/${projectId}/git/push`, {})), commit: result.commit };
    }, result => action === 'sync' ? (result.git.merging ? t('Committed {hash}.', { hash: result.commit }) + ' ' + t('The merge stopped at conflicts.') : t('Committed {hash} and synced.', { hash: result.commit }))
      : action === 'push' ? t('Committed {hash} and pushed.', { hash: result.commit }) : t('Committed {hash}.', { hash: result.commit }));
  };
  // Like Cursor's generate button: the chosen agent reads the chosen files' changes.
  // An empty box takes a message already written for them; a full one asks for a new one.
  async function generate() {
    if (busy || !chosen.length) return;
    if (!messageWriter) { setError(errorText(noReadOnlyAgent)); return; }
    const request = ++messageRequest.current;
    setBusy('message'); setWritingAgent(messageWriter.agent); setError(''); setNotice('');
    try {
      const result = await api<{ message: string }>(`/projects/${projectId}/git/message`, { paths: chosen.map(file => file.path), staged: staged.length > 0, ...messageWriter, language: commitMessageLanguage(), fresh: Boolean(message.trim()) });
      // Leaving and reopening Git may create a newer manual draft.
      if (request === messageRequest.current) saveMessage(result.message);
    } catch (e) { if (request === messageRequest.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (request === messageRequest.current) { setBusy(''); setWritingAgent(null); } }
  }
  const discard = (list: GitFile[]) => { setDiscarding(null); void run('discard', () => api<{ git: GitStatus }>(`/projects/${projectId}/git/discard`, { paths: list.map(file => file.path) }), () => tn(list.length, 'Discarded changes in {n} file.', 'Discarded changes in {n} files.')); };
  const reload = () => void run('reload', async () => ({ git: await api<GitStatus>(`/projects/${projectId}/git`) }), () => '');
  const ignored = files.filter(ignorable), patterns = [...new Set(ignored.map(file => ignorePattern(file.path)))];
  const ignore = () => void run('ignore', () => api(`/projects/${projectId}/git/ignore`, { paths: ignored.map(file => file.path) }), () => tn(patterns.length, 'Added {n} pattern to .gitignore.', 'Added {n} patterns to .gitignore.'));
  const remote = (action: 'fetch' | 'pull' | 'merge' | 'push') => void run(action, () => api<{ git: GitStatus }>(`/projects/${projectId}/git/${action}`, {}),
    result => action === 'fetch' ? (result.git.behind ? tn(result.git.behind, '{n} new commit on {upstream}.', '{n} new commits on {upstream}.', { upstream: result.git.upstream ?? '' }) : t('Up to date with the remote.'))
      : action === 'pull' ? t('Pulled the latest commits.')
      : action === 'merge' ? (result.git.merging ? t('The merge stopped at conflicts.') : t('Merged {upstream}.', { upstream: git.upstream ?? '' }))
      : result.git.upstream ? t('Pushed to {upstream}.', { upstream: result.git.upstream }) : t('Pushed to the remote.'));
  // A branch and its upstream that have both moved on are merged; conflicts
  // go to an agent, then the author reads the diffs and commits the merge.
  const diverged = Boolean(git.upstream && git.ahead > 0 && git.behind > 0 && !merging);
  const resolve = async () => {
    if (busy) return;
    const choice = resolver;
    const merge = gitMergeId(git);
    setError(''); setNotice('');
    setResolution({ merge, agent: choice.agent, busy: true });
    try {
      const result = await api<{ git: GitStatus; summary: string; remaining: string[]; agent: AgentId }>(`/projects/${projectId}/git/resolve`, choice);
      onStatus(result.git);
      setDiffRefresh(value => value + 1);
      const notice = result.remaining.length ? tn(result.remaining.length, '{n} file still has conflicts.', '{n} files still have conflicts.') : t('Conflicts resolved. Read the diffs, then commit the merge.');
      setResolution({ merge, agent: result.agent, summary: result.summary, notice });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      try { onStatus(await api<GitStatus>(`/projects/${projectId}/git`)); } catch { /* Keep the original failure. */ }
      setResolution({ merge, agent: choice.agent, error });
    }
  };
  const finish = () => void run('finish', () => api<{ git: GitStatus; commit: string }>(`/projects/${projectId}/git/finish`, {}), result => { setResolution(); return t('Committed {hash}.', { hash: result.commit }); });
  const abort = () => void run('abort', () => api<{ git: GitStatus }>(`/projects/${projectId}/git/abort`, {}), () => { setResolution(); return t('The merge was abandoned.'); });
  const commitTitle = staged.length ? tn(staged.length, 'Commit staged changes in 1 file', 'Commit staged changes in {n} files') : chosen.length === files.length ? tn(files.length, 'Commit 1 file', 'Commit all {n} files') : t('Commit {chosen} of {n} files', { chosen: chosen.length, n: files.length });
  const commitDisabled = Boolean(busy) || !message.trim() || !chosen.length;
  const syncPrimary = !chosen.length && canSync;
  const needsSync = Boolean(git.ahead || git.behind || publish);
  const syncing = busy === 'sync' || busy === 'push';
  const primaryLabel = busy === 'commit' ? t('Committing…') : syncing ? t('Syncing…') : syncPrimary ? (needsSync ? t('Sync') : t('Synced')) : t('Commit');
  const syncTitle = !git.remote ? t('This repository has no remote.') : !git.branch ? t('Check out a branch before syncing.') : t('Sync committed changes with the remote. Uncommitted changes are kept.');
  const primaryDisabled = syncPrimary ? Boolean(busy) || !needsSync : commitDisabled;
  const submitPrimary = () => { if (!primaryDisabled) { if (syncPrimary) syncRemote(); else commit(); } };
  const placeholder = busy === 'message' && displayedMessageAgent ? t('{agent} is writing a commit message…', { agent: agentLabel(displayedMessageAgent) })
    : git.branch && !touch() ? t('Message ({key} to commit on “{branch}”)', { key: '↵', branch: git.branch }) : t('Commit message');
  // One row per file and list. The staged list shows the index's status.
  const row = (file: GitFile, list: 'staged' | 'changes') => {
    const status = file.status === 'U' && merging && !merging.conflicts.includes(file.path) ? 'M' : list === 'staged' ? file.index || file.status : file.status;
    const slash = file.path.lastIndexOf('/'), code = status === '?' ? 'U' : status === 'U' ? '!' : status, key = list + ':' + file.path, selected = selection?.path === file.path && selection.list === list;
    const statusName = gitNames()[status] || status;
    const decorationLabel = file.incoming ? `${t('Incoming: {status}', { status: gitNames()[file.incoming] || file.incoming })} · ${t('Local: {status}', { status: statusName })}` : statusName;
    return <li key={key} className={selected ? 'selected' : undefined}>
      <div className="git-row">
        <button type="button" className="git-file" aria-pressed={selected} title={`${statusName}: ${file.from ? `${file.from} → ` : ''}${file.path}`} onClick={() => onOpenDiff({ path: file.path, list })}>
          <Icon name="paper" size={14}/><span className="git-name">{file.path.slice(slash + 1)}</span>{slash > 0 && <span className="git-dir">{file.path.slice(0, slash)}</span>}
        </button>
        {!merging && <span className="git-row-actions">
          {list === 'changes' && <button type="button" className="icon-button git-discard-action" aria-label={t('Discard changes in {path}', { path: file.path })} title={t('Discard changes')} disabled={Boolean(busy)} onClick={() => setDiscarding([file])}><Icon name="undo" size={16}/></button>}
          {list === 'changes'
            ? <button type="button" className="icon-button" aria-label={t('Stage {path}', { path: file.path })} title={t('Stage changes')} disabled={Boolean(busy)} onClick={() => stage([file.path], true)}><Icon name="plus" size={16}/></button>
            : <button type="button" className="icon-button" aria-label={t('Unstage {path}', { path: file.path })} title={t('Unstage changes')} disabled={Boolean(busy)} onClick={() => stage([file.path], false)}><Icon name="minus" size={16}/></button>}
        </span>}
        <span className={'git-code s-' + (status === '?' ? 'u' : status === 'U' ? 'conflict' : status.toLowerCase())} aria-label={decorationLabel} title={decorationLabel + (file.lines && !(file.staged && file.unstaged) ? ' · ' + t('{added} lines added, {deleted} lines removed', { added: file.lines[0], deleted: file.lines[1] }) : '')}>{file.incoming && <><span className={'git-incoming s-' + file.incoming.toLowerCase()}>↓{file.incoming}</span>, </>}{code}</span>
      </div>
    </li>;
  };
  const group = (list: 'staged' | 'changes', items: GitFile[]) => {
    const name = list === 'staged' ? t('Staged changes') : t('Changes'), shut = collapsed[list];
    const stageable = list === 'changes' ? items.filter(file => !ignorable(file)) : items;
    return <div className="git-group" role="group" aria-label={name}>
      <div className="git-group-header">
        <button type="button" className="git-group-toggle" aria-expanded={!shut} onClick={() => setCollapsed(current => ({ ...current, [list]: !shut }))}><Icon name={shut ? 'chevronRight' : 'chevronDown'} size={12}/><span>{name}</span><span className="git-count" aria-hidden="true">{items.length}</span></button>
        {!merging && <span className="git-row-actions">
          {list === 'changes' && <button type="button" className="icon-button git-discard-action" aria-label={t('Discard all changes')} title={t('Discard all changes')} disabled={Boolean(busy)} onClick={() => setDiscarding(items)}><Icon name="undo" size={15}/></button>}
          {list === 'changes'
            ? <button type="button" className="icon-button" aria-label={t('Stage all changes')} title={t('Stage all changes')} disabled={Boolean(busy) || !stageable.length} onClick={() => stage(stageable.map(file => file.path), true)}><Icon name="plus" size={15}/></button>
            : <button type="button" className="icon-button" aria-label={t('Unstage all changes')} title={t('Unstage all changes')} disabled={Boolean(busy)} onClick={() => stage(items.map(file => file.path), false)}><Icon name="minus" size={15}/></button>}
        </span>}
      </div>
      {!shut && <ul className="git-files">{items.map(file => row(file, list))}</ul>}
    </div>;
  };
  const sync = git.upstream && (git.ahead > 0 || git.behind > 0) ? <span className="git-sync">{git.ahead > 0 && <span>↑{git.ahead}</span>}{git.behind > 0 && <span>↓{git.behind}</span>}</span> : null;
  const switcher = <div className="git-detail-switcher view-selector" role="group" aria-label={t('Workspace view')}>
    <button type="button" aria-pressed={detail === 'changes'} onClick={() => { if (source?.list === 'history') selectSource({ path: '', list: 'changes' }); showDetail('changes'); }}><Icon name="diff" size={16}/><span>{t('Changes')}</span></button>
    <button type="button" aria-pressed={detail === 'history'} onClick={() => showDetail('history')}><Icon name="restore" size={16}/><span>{t('Version history')}</span></button>
  </div>;
  const diffOpen = detail === 'changes' && Boolean(source?.path);
  return <section className="git-workspace" data-git-detail={detail} aria-label={t('Version Management')} aria-busy={Boolean(busy)}>
    <div className="git-workspace-body">
    <section className={'git-panel' + (advanced ? ' git-advanced' : '')} aria-label={t('Changes')}>
    <div className="git-toolbar" role="group" aria-label={t('Version Management')}>
      {navigation}
      <span className="git-branch" title={git.upstream ? `${t('Tracking')} ${git.upstream}` : t('No upstream branch')}><Icon name="branch" size={14}/><code>{git.branch || t('detached HEAD')}</code>{sync}</span>
      <div className="git-toolbar-tools">
        {advanced && git.remote && <>
          <button type="button" className="icon-button" aria-label={t('Fetch from the remote')} title={t('Fetch from the remote')} disabled={Boolean(busy)} onClick={() => remote('fetch')}>{busy === 'fetch' ? <span className="spinner"/> : <Icon name="fetch" size={15}/>}</button>
          {git.upstream && <button type="button" className={'git-remote-action' + (git.behind > 0 ? ' has-count' : '')} aria-label={diverged ? t('Merge') : t('Pull')} title={diverged ? t('{branch} and {upstream} have both changed. Merge brings in the remote commits.', { branch: git.branch ?? '', upstream: git.upstream }) : t('Pull')} disabled={Boolean(busy) || Boolean(merging) || !git.behind} onClick={() => remote(diverged ? 'merge' : 'pull')}>{busy === 'pull' || busy === 'merge' ? <span className="spinner"/> : <Icon name="pull" size={14}/>}{git.behind > 0 && <span className="git-action-count" aria-hidden="true">{git.behind}</span>}</button>}
          {(git.upstream || publish) && <button type="button" className={'git-remote-action' + ((git.upstream && git.ahead > 0) || publish ? ' has-count' : '')} aria-label={git.upstream ? t('Push') : t('Publish branch')} title={git.upstream ? t('Push') : t('Publish branch')} disabled={Boolean(busy) || Boolean(merging) || Boolean(git.upstream && !git.ahead)} onClick={() => remote('push')}>{busy === 'push' ? <span className="spinner"/> : <Icon name="push" size={14}/>}{git.upstream && git.ahead > 0 && <span className="git-action-count" aria-hidden="true">{git.ahead}</span>}</button>}
        </>}
        <button type="button" className="icon-button" aria-label={t('Refresh changes')} title={t('Refresh changes')} disabled={Boolean(busy)} onClick={reload}>{busy === 'reload' ? <span className="spinner"/> : <Icon name="refresh" size={14}/>}</button>
      </div>
    </div>
    {error && <p className="inline-error git-message" role="alert">{error}</p>}
    {notice && !error && <p className={'git-message git-notice' + (merging ? ' git-warning' : '')} role="status"><Icon name={merging ? 'alert' : 'check'} size={14}/><span>{notice}</span></p>}
    <div className="git-panel-content">
      {merging && <div className={'git-merge' + (merging.conflicts.length ? '' : ' resolved')} role="group" aria-label={t('Merge in progress')}>
        <p><strong>{merging.conflicts.length ? tn(merging.conflicts.length, 'Merging: {n} file has conflicts', 'Merging: {n} files have conflicts') : t('Merging: no conflicts left')}</strong><span>{merging.message}</span></p>
        {resolution?.summary && <div className="git-merge-summary markdown" aria-label={t('{agent} on the merge', { agent: agentLabel(resolution.agent) })}><Markdown text={resolution.summary}/></div>}
        <div className="button-row">
          <button type="button" className="button secondary compact" disabled={Boolean(busy)} onClick={abort}>{busy === 'abort' ? t('Aborting…') : t('Abort merge')}</button>
          {(merging.conflicts.length > 0 || resolution?.busy) && <button type="button" className="button secondary compact" onClick={onChangeResolver}>{t('Change conflict agent')}</button>}
          {merging.conflicts.length || resolution?.busy
            ? <button type="button" className="button primary compact" disabled={Boolean(busy)} onClick={resolve}>{busy === 'resolve' ? <><span className="spinner"/>{t('{agent} is resolving…', { agent: agentLabel(resolution?.agent ?? resolver.agent) })}</> : <><Icon name="spark" size={14}/>{t('Resolve with {agent}', { agent: agentLabel(resolver.agent) })}</>}</button>
            : <button type="button" className="button primary compact" disabled={Boolean(busy)} onClick={finish}>{busy === 'finish' ? t('Committing…') : t('Commit merge')}</button>}
        </div>
      </div>}
      {!merging && <form className="git-commit-form" onSubmit={event => { event.preventDefault(); submitPrimary(); }}>
        <div className="git-message-box">
          <textarea aria-label={t('Commit message')} placeholder={placeholder} rows={1} value={message} readOnly={busy === 'commit' || busy === 'message'} onChange={event => saveMessage(event.target.value)} onKeyDown={event => { if (sendsMessage(event.nativeEvent, touch())) { event.preventDefault(); commit(); } }}/>
          <div className="git-compose-bar">
            <button type="button" className="icon-button git-generate" aria-label={t('Generate commit message')} title={displayedMessageAgent ? t('Write a commit message for the chosen files with {agent}', { agent: agentLabel(displayedMessageAgent) }) : errorText(noReadOnlyAgent)} disabled={Boolean(busy) || !chosen.length} onClick={() => void generate()}>{busy === 'message' ? <span className="spinner"/> : <Icon name="spark" size={15}/>}</button>
            <div className={'git-commit-split has-menu' + (busy === 'commit' || syncing ? ' is-busy' : '')}>
              <button className="button primary git-commit-button" aria-label={primaryLabel} title={syncPrimary ? needsSync ? syncTitle : t('Up to date with the remote.') : commitTitle} disabled={primaryDisabled}>{busy === 'commit' || syncing ? <span className="spinner light"/> : <Icon name={syncPrimary && needsSync ? 'refresh' : 'check'} size={14}/>}<span>{primaryLabel}</span>{syncPrimary && needsSync && sync}</button>
              <ActionMenu label={t('More commit actions')} className="button primary git-commit-more" disabled={Boolean(busy)} actions={[
                { label: t('Commit'), icon: 'check', disabled: commitDisabled, select: () => commit() },
                { label: t('Commit and sync'), icon: 'refresh', disabled: commitDisabled || !canSync, select: () => commit('sync') },
                { label: t('Sync'), icon: 'refresh', divider: true, disabled: !canSync, title: syncTitle, select: syncRemote },
                ...(advanced ? [{ label: t('Commit (Amend)'), icon: 'undo', disabled: commitDisabled || !git.head, divider: true, select: () => commit('amend') },
                  ...(canPush ? [{ label: t('Commit and push'), icon: 'push', disabled: commitDisabled, select: () => commit('push') }] : [])] : []),
              ]}><Icon name="chevronDown" size={13}/></ActionMenu>
            </div>
          </div>
        </div>
      </form>}
      <div className="git-file-lists">
      {ignored.length > 0 && !merging && <button type="button" className="git-ignore-banner" title={t('Untracked build output. Add to .gitignore adds:') + '\n' + patterns.join('\n')} disabled={Boolean(busy)} onClick={ignore}><Icon name="archive" size={14}/><span>{t('Add to .gitignore')}</span><small>{tn(ignored.length, '{n} build file', '{n} build files')}</small></button>}
      {merging ? files.length > 0 && group('changes', files) : <>
        {staged.length > 0 && group('staged', staged)}
        {unstaged.length > 0 && group('changes', unstaged)}
      </>}
      {!files.length && <p className="git-clean"><Icon name="check" size={14}/><span>{t('No uncommitted changes')}</span></p>}
      </div>
    </div>
    </section>
    <section className="git-details" aria-label={t('Workspace view')}>
      {!diffOpen && <div className="git-details-toolbar">
        {switcher}
        {detail === 'history' && !advanced && <button type="button" className="icon-button git-details-refresh" aria-label={t('Refresh version history')} title={t('Refresh version history')} disabled={Boolean(busy)} onClick={() => setHistoryRefresh(value => value + 1)}><Icon name="refresh" size={14}/></button>}
      </div>}
      <div className="git-file-preview" hidden={detail !== 'changes'}>
        {diffOpen && source ? <GitDiffView key={projectId + ':' + source.list + ':' + historyHash + ':' + source.path} lead={switcher} path={source.path} scopeLabel={source.list === 'history' ? source.subject : source.list === 'staged' ? t('Staged changes') : ''} revision={historyHash || JSON.stringify([git.head?.hash, git.files, diffRefresh])} live={source.list !== 'history'} load={loadDiff} onClose={closeSource}/>
          : <p className="git-empty-diff"><Icon name={files.length ? 'diff' : 'check'} size={18}/><span>{files.length ? t('Changes') : t('No uncommitted changes')}</span></p>}
      </div>
      <div className="git-repository-view" hidden={detail !== 'history'}>
    <VersionHistory git={git} busy={Boolean(busy)} collapsible={advanced} refreshKey={historyRefresh} load={loadHistory} loadVersion={loadVersion} selection={selection?.list === 'history' ? selection : null} onOpenDiff={onOpenDiff} restore={async (hash, head) => {
      if (busy) return;
      setBusy('restore'); setError(''); setNotice('');
      try {
        const result = await api<{ git: GitStatus }>(`/projects/${projectId}/git/restore`, { hash, head });
        onStatus(result.git); selectSource(null); showDetail('history'); setNotice(t('Version restored. Previous versions are kept in history.'));
      } catch (error) {
        try { onStatus(await api<GitStatus>(`/projects/${projectId}/git`)); } catch { /* Preserve the restoration error. */ }
        throw error;
      } finally { setBusy(''); }
    }}/>
    {advanced && <GitRepository git={git} load={loadOverview} tasks={tasks} onOpenTask={onOpenTask} taskStatus={task => <Status task={task}/>}/>}
      </div>
    </section>
    </div>
    {discarding && <DiscardDialog files={discarding} onCancel={() => setDiscarding(null)} onConfirm={() => discard(discarding)}/>}
  </section>;
}

// A note that asks for something by itself: a comment, or a deletion.
const actionable = (note: Annotation) => Boolean(note.comment.trim()) || note.kind === 'delete';
function noteWhere(note: Annotation) { return t('Page {n}', { n: note.page + 1 }) + (note.source ? ` · ${note.source.file}:${note.source.lines[0]}${note.source.lines[1] !== note.source.lines[0] ? `–${note.source.lines[1]}` : ''}` : ''); }

function NotePlacementWarning() {
  return <small className="note-placement-warning" title={t('The position in the new PDF could not be confirmed. The original text and note are kept.')}><Icon name="alert" size={12}/>{t('Position needs confirmation')}</small>;
}

const manuscriptDocument = (data: Manuscript | null) => data?.document ?? data?.build.document ?? null;

type NoteChange = { note: Annotation; selected?: boolean } & ({ kind: 'add' | 'remove' } | { kind: 'edit'; comment: string } | { kind: 'group'; group: NoteGroup | null });
type ClearedNotes = { kind: 'clear'; target: AnnotationBatch; selected: string[] };
type RegroupedNotes = { kind: 'groups'; before: AnnotationGroupState[]; after: AnnotationGroupState[]; draft?: GroupDraftChange };
type ReturnedNoteChange = { kind: 'return'; taskId: string; original: NoteResult; copyId: string; createdAt: number; time: number; replay?: string };
type AnnotationChange = NoteChange | ClearedNotes | RegroupedNotes | ReturnedNoteChange;
function keepAnnotationChange(entry: AnnotationChange, removed: Set<string>) {
  if (entry.kind === 'groups') {
    entry.before = entry.before.filter(edit => !removed.has(edit.id));
    entry.after = entry.after.filter(edit => !removed.has(edit.id));
    return entry.before.length > 0;
  }
  if (entry.kind === 'return') return !removed.has(entry.copyId);
  if (entry.kind !== 'clear') return !removed.has(entry.note.id);
  entry.target.ids = entry.target.ids.filter(id => !removed.has(id));
  entry.selected = entry.selected.filter(id => !removed.has(id));
  return entry.target.ids.length > 0;
}
interface NoteActions {
  history?: PdfHistoryActions;
  batch?: {
    document: string | null;
    name: string;
    disabled: boolean;
    clear: (target: AnnotationBatch) => Promise<AnnotationBatchResult>;
    undo: () => void;
    clearedCount: number;
    uncertain?: AnnotationBatch;
  };
  selection: ReturnType<typeof useNoteSelection>;
  instructions: ReturnType<typeof useGroupInstructions>;
  group: NoteGroup | null;
  setGroup: (group: NoteGroup | null) => void;
  add: (page: number, rect: Rect, rects: Rect[], quote: string, comment: string, group?: NoteGroup, options?: { reveal?: boolean; quote?: boolean; kind?: MarkKind; stamp?: string; key?: string }) => Promise<void>;
  edit: (note: Annotation, comment: string) => Promise<void>;
  regroup: (note: Annotation, group: NoteGroup | null) => Promise<void>;
  regroupMany: (notes: Annotation[], group: NoteGroup | null) => Promise<void>;
  remove: (note: Annotation) => Promise<void>;
  restore: (note: Annotation) => Promise<void>;
  onEditing: (editing: boolean) => void;
  onReviewBusy: (busy: boolean) => void;
  sending: boolean;
}

// My notes and the task's notes edit in place the same way: one draft per
// note, saved with Enter, Escape or a click elsewhere; errors stay beside it.
function useNoteCards(notes: Annotation[] | undefined, actions: NoteActions, onEditing?: (editing: boolean) => void, projectId?: string) {
  const [drafts, setDrafts] = useState<Record<string, { note: Annotation; value: string }>>({});
  const draftValues = useRef(drafts);
  const [lastDismissed, setDismissed] = useState<Annotation | null>(null);
  const pending = useRef(new Map<string, { note: Annotation; promise: Promise<boolean> }>());
  const [busyNotes, setBusyNotes] = useState<Annotation[]>([]), [failures, setErrors] = useState<Record<string, { note: Annotation; message: string }>>({});
  const inProject = (note: Annotation) => projectId === undefined || note.projectId === projectId;
  const dismissed = lastDismissed && inProject(lastDismissed) ? lastDismissed : null;
  const errors = Object.fromEntries(Object.entries(failures).filter(([, failure]) => inProject(failure.note)).map(([id, failure]) => [id, failure.message]));
  const editing = Object.values(drafts).some(entry => inProject(entry.note)), busy = busyNotes.some(inProject);
  useEffect(() => { onEditing?.(editing || busy); return () => onEditing?.(false); }, [editing, busy, onEditing]);
  useEffect(() => { if (dismissed && notes?.some(note => note.id === dismissed.id)) setDismissed(null); }, [notes, dismissed]);
  // Prune only annotations actually removed from a loaded paper, never notes
  // merely deselected, hidden by a skill, or belonging to another paper.
  useEffect(() => {
    if (!notes) return;
    for (const [id, entry] of Object.entries(draftValues.current)) if (inProject(entry.note) && !notes.some(note => note.id === id)) draft(id, null);
  }, [notes, projectId]);
  const editingRow = useRef<{ id: string; panel: Element } | null>(null);
  useLayoutEffect(() => {
    const row = editingRow.current;
    if (!row || drafts[row.id]) return;
    editingRow.current = null;
    if (document.activeElement === document.body) row.panel.querySelector<HTMLButtonElement>(`[data-note="${CSS.escape(row.id)}"] .group-note-edit`)?.focus({ preventScroll: true });
  }, [drafts]);
  function editGrouped(note: Annotation, button: HTMLButtonElement) {
    const panel = button.closest('.notes-panel, .task-notes-panel');
    if (panel) editingRow.current = { id: note.id, panel };
    clearError(note.id);
    draft(note.id, note.comment);
  }
  const clearError = (id: string) => setErrors(current => { const next = { ...current }; delete next[id]; return next; });
  function draft(id: string, value: string | null) {
    const next = { ...draftValues.current };
    if (value === null) delete next[id];
    else {
      const note = notes?.find(note => note.id === id) || next[id]?.note;
      if (!note) return;
      next[id] = { note, value };
    }
    draftValues.current = next; setDrafts(next);
  }
  function change(note: Annotation, work: () => Promise<void>): Promise<boolean> {
    const id = note.id;
    if (pending.current.has(id) || actions.sending) return Promise.resolve(false);
    clearError(id);
    const operation = Promise.resolve().then(work).then(() => true, e => { setErrors(current => ({ ...current, [id]: { note, message: e instanceof Error ? e.message : String(e) } })); return false; })
      .finally(() => { pending.current.delete(id); setBusyNotes([...pending.current.values()].map(entry => entry.note)); });
    pending.current.set(id, { note, promise: operation }); setBusyNotes([...pending.current.values()].map(entry => entry.note));
    return operation;
  }
  const save = (note: Annotation, comment: string, then?: () => void) => change(note, async () => {
    await actions.edit(note, comment); draft(note.id, null); then?.();
  });
  async function saveAll(ids?: string[]) {
    const included = (note: Annotation) => inProject(note) && (!ids || ids.includes(note.id));
    // Another editor can still report busy just after its save resolves.
    // An empty panel has no work to block that navigation on.
    if (![...pending.current.values()].some(entry => included(entry.note)) && !Object.values(draftValues.current).some(entry => included(entry.note))) return true;
    if (actions.sending || (await Promise.all([...pending.current.values()].filter(entry => included(entry.note)).map(entry => entry.promise))).some(saved => !saved)) return false;
    for (const [id, entry] of Object.entries(draftValues.current)) {
      if (!included(entry.note)) continue;
      const note = notes?.find(note => note.id === id) || entry.note, comment = entry.value.trim();
      if (comment !== note.comment && (comment || note.group || note.kind === 'delete')) { if (!await save(note, comment)) return false; }
      else draft(id, null);
    }
    return true;
  }
  // Deleting shows Undo right there, as in the PDF; phones have no ⌘Z.
  const remove = (note: Annotation) => change(note, async () => { await actions.remove(note); draft(note.id, null); setDismissed(note); });
  const undo = (disabled: boolean) => dismissed && <div className="note-dismissed" role="status">{dismissed.aiReview ? t('Suggestion ignored.') : t('Note deleted.')} <button type="button" disabled={disabled} onClick={() => void change(dismissed, async () => { await actions.restore(dismissed); setDismissed(null); })}>{t('Undo')}</button></div>;
  // The same card in both lists; `onToggle` adds the note to the task or takes it out.
  async function regroup(note: Annotation, group: NoteGroup | null) {
    const panel = document.activeElement?.closest('.notes-panel, .task-notes-panel');
    await change(note, () => actions.regroup(note, group));
    // Moving to another group can replace the row that held keyboard focus.
    if (panel) requestAnimationFrame(() => {
      if (document.activeElement === document.body) panel.querySelector<HTMLButtonElement>(`[data-note="${CSS.escape(note.id)}"] .group-select`)?.focus({ preventScroll: true });
    });
  }
  async function regroupMany(members: Annotation[], group: NoteGroup | null) {
    const panel = document.activeElement?.closest('.notes-panel, .task-notes-panel');
    await change(members[0], () => actions.regroupMany(members, group));
    if (panel) requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      const row = panel.querySelector(`[data-note="${CSS.escape(members[0].id)}"]`);
      (row?.closest('.annotation-group')?.querySelector<HTMLButtonElement>('.group-header .group-select') ||
        row?.querySelector<HTMLButtonElement>('.group-select'))?.focus({ preventScroll: true });
    });
  }
  const card = (note: Annotation, index: number, { currentKey, active, inTask, onShow, onToggle }: { currentKey?: string; active?: string; inTask?: boolean; onShow: (note: Annotation) => void; onToggle: () => void }) => <li key={note.id} data-note={note.id} data-selected={actions.selection.has(note.id)} className={(note.aiReview ? 'review-suggestion ' : '') + (active === note.id ? 'active ' : '') + (note.key !== currentKey ? 'stale' : '')}>
    <PdfNoteCard inline inTask={inTask} note={note} number={index + 1} index={0} total={1} selected={actions.selection.has(note.id)} busy={actions.sending || busyNotes.some(item => item.id === note.id)} error={errors[note.id] || ''}
      draft={drafts[note.id]?.value ?? null} onDraftChange={value => { draft(note.id, value); if (value !== null && drafts[note.id] === undefined) clearError(note.id); }}
      header={<div className="note-card-context"><div className="note-head"><button type="button" className="note-number" aria-label={note.aiReview ? t('Show suggestion {n} on the page', { n: index + 1 }) : t('Show note {n} on the page', { n: index + 1 })} disabled={note.key !== currentKey} onClick={() => onShow(note)}>{index + 1}</button><span className="note-where">{noteWhere(note)}{note.aiReview ? ' · ' + agentLabel(note.aiReview.agent) : note.author ? ' · ' + t('from {name}', { name: note.author.name }) : ''}</span></div><NoteQuote text={note.quote} kind={note.kind}/></div>}
      onGroupChange={isTaskReviewNote(note) ? undefined : group => void regroup(note, group)} onToggle={onToggle} onDismiss={() => void remove(note)}
      onSave={(comment, action) => save(note, comment, action === 'quote' ? onToggle : undefined)}>
      {note.key !== currentKey && <NotePlacementWarning/>}
    </PdfNoteCard>
  </li>;
  return { editing, busy, errors, dismissed, saveAll, remove, regroup, regroupMany, undo, drafts, editGrouped, forget: () => setDismissed(current => current && inProject(current) ? null : current), card };
}

function useSaveNotesOnLeave(save: () => Promise<boolean>) {
  const saveOnLeave = useRef(save); saveOnLeave.current = save;
  useEffect(() => () => { void saveOnLeave.current(); }, []);
}

const NOTE_SORT_STORAGE = 'papilot:note-sort';
function readNoteSort(): NoteSortMode {
  const saved = browserStorage.getItem(NOTE_SORT_STORAGE);
  return isNoteSortMode(saved) ? saved : 'original';
}
function noteSortLabel(mode: NoteSortMode) {
  switch (mode) {
    case 'position': return t('PDF position');
    case 'newest': return t('Newest first');
    default: return t('Original order');
  }
}

interface NotesHandle { save: () => Promise<boolean> }
function NotesPanel({ notes, sections = [], pageLayouts, currentKey, active, actions, onShow, onAdded, onClose, controller }: { sections?: NoteSection[]; pageLayouts?: Record<number, PageReadingLayout>; notes: Annotation[]; currentKey?: string; active: string; actions: NoteActions; onShow: (note: Annotation) => void; onAdded: () => void; onClose: () => void; controller: React.Ref<NotesHandle> }) {
  const list = useRef<HTMLElement>(null);
  const cards = useNoteCards(notes, actions, actions.onEditing);
  const [clearTarget, setClearTarget] = useState<AnnotationBatch | null>(null);
  const [sortMode, setSortMode] = useState<NoteSortMode>(readNoteSort);
  const [sortAnnouncement, setSortAnnouncement] = useState('');
  useSaveNotesOnLeave(cards.saveAll);
  const { editing, errors } = cards, locked = cards.busy || actions.sending;
  useEffect(() => { if (active) list.current?.querySelector(`[data-note="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  useImperativeHandle(controller, () => ({ save: cards.saveAll }));
  const selectionLocked = locked || editing;
  const toggle = (note: Annotation) => actions.selection.set([note.id], !actions.selection.has(note.id));
  const selectCard = (note: Annotation, index: number) => <NoteAttachButton number={index + 1} ai={Boolean(note.aiReview)} selected={actions.selection.has(note.id)} disabled={selectionLocked} onClick={() => toggle(note)}/>;
  const chooseSort = (next: NoteSortMode) => {
    const changed = next !== sortMode;
    setSortMode(next);
    if (next === 'original') browserStorage.removeItem(NOTE_SORT_STORAGE);
    else browserStorage.setItem(NOTE_SORT_STORAGE, next);
    if (changed) setSortAnnouncement(t('Notes sorted by {order}.', { order: noteSortLabel(next) }));
  };
  const nextSort = NOTE_SORT_MODES[(NOTE_SORT_MODES.indexOf(sortMode) + 1) % NOTE_SORT_MODES.length];
  const sortIcon = sortMode === 'position' ? 'sortPosition' : sortMode === 'newest' ? 'clock' : 'sort';
  const sortLabel = t('Sort notes: {order}', { order: noteSortLabel(sortMode) });
  const indexed = notes.map((note, index) => ({ note, index }));
  const ownNotes = notes.filter(note => !note.aiReview);
  const groups = groupNoteEntries(indexed.filter(({ note }) => !isTaskReviewNote(note)), sortMode, currentKey, pageLayouts);
  const individualNotes = sortNoteEntries(indexed.filter(({ note }) => !note.aiReview && !note.group), sortMode, currentKey, pageLayouts);
  const clearable = notes.filter(note => !isTaskReviewNote(note));
  const batch = actions.batch, clearDisabled = !batch || batch.disabled || selectionLocked || (!batch.uncertain && !clearable.length);
  const clearLabel = batch?.uncertain ? t('Retry clearing annotations…') : t('Clear all annotations…');
  const unplacedSuggestions = notes.filter(note => note.aiReview && note.key !== currentKey);
  const renderNote = (note: Annotation, index: number) => cards.card(note, index, { currentKey, active, onShow, onToggle: () => toggle(note) });
  return <>
    <div className="pdf-reading-notes-head">
      <strong>{t('My notes')}</strong>
      <div className="pdf-reading-notes-actions">
        <button type="button" className="icon-button notes-sort-trigger"
          data-sort={sortMode} aria-label={sortLabel} title={sortLabel}
          onClick={() => chooseSort(nextSort)}><Icon name={sortIcon} size={16}/></button>
        {batch && <button type="button" className="icon-button notes-clear-trigger" aria-label={clearLabel} title={clearLabel}
          aria-disabled={clearDisabled} aria-haspopup="dialog" onClick={() => {
            if (!clearDisabled) setClearTarget(batch.uncertain || { document: batch.document, batch: uuid(), ids: clearable.map(note => note.id) });
          }}><Icon name={batch.uncertain ? 'refresh' : 'trash'}/></button>}
        <SectionNotePicker key={currentKey} sections={sections.map(section => ({ ...section, notes: section.notes.filter(id => notes.some(note => note.id === id)) }))} notes={ownNotes.map(note => note.id)} disabled={selectionLocked} has={actions.selection.has} select={actions.selection.set} onAdded={onAdded}/>
        <button type="button" className="icon-button" aria-label={t('Close notes')} onClick={onClose}><Icon name="close" size={16}/></button>
      </div>
    </div>
    <p className="sr-only" role="status" aria-atomic="true">{sortAnnouncement}</p>
    {batch && batch.clearedCount > 0 && <div className="notes-clear-status">
      <span role="status">{tn(batch.clearedCount, '{n} annotation cleared.', '{n} annotations cleared.')}</span>
      <button type="button" className="button ghost compact" disabled={batch.disabled || selectionLocked || Boolean(batch.uncertain)} onClick={batch.undo}>{t('Undo')}</button>
    </div>}
    <section ref={list} className="notes-panel" aria-label={t('PDF notes')}>
    {currentKey && notes.some(note => note.key !== currentKey) && <p className="note-placement-summary" role="status">{t('Some note positions need confirmation. Their original text and comments are kept.')}</p>}
    {(ownNotes.length > 0 || groups.length > 0) && <section className="note-section" aria-label={t('My notes')}>
    {groups.map(({ group, entries }) => {
      const count = entries.filter(({ note }) => actions.selection.has(note.id)).length;
      return <GroupCard key={group} group={group} count={entries.length} onRegroup={next => void cards.regroupMany(entries.map(({ note }) => note), next)} regroupDisabled={selectionLocked} active={actions.group === group || entries.some(({ note }) => note.id === active)} selection={{ count, disabled: selectionLocked, toggle: () => actions.selection.set(entries.map(({ note }) => note.id), count !== entries.length) }}>
      <ol className="group-references">{entries.map(({ note, index }) => cards.drafts[note.id] ? renderNote(note, index) : <li className={'group-location note-card' + (note.id === active ? ' active' : '')} key={note.id} data-note={note.id} data-selected={actions.selection.has(note.id)}>
        <button type="button" className="note-number" aria-label={t('Show note {n} on the page', { n: index + 1 })} disabled={note.key !== currentKey} onClick={() => onShow(note)}>{index + 1}</button>
        <div className="group-location-target"><blockquote>{note.quote || t('Marked region')}</blockquote>{(note.comment || note.kind === 'delete' || note.stamp) && <p className="task-note-comment">{note.stamp && <span className="pdf-note-stamp"><Icon name="spark" size={12}/>{note.stamp}</span>}{markText(note)}</p>}<span>{noteWhere(note)}</span>{note.key !== currentKey && <NotePlacementWarning/>}</div>
        <div className="group-note-tools">
          <GroupPicker forNote value={note.group ?? null} onChange={next => void cards.regroup(note, next)} disabled={selectionLocked}/>
          <NoteEditButton grouped number={index + 1} disabled={selectionLocked} onEdit={event => cards.editGrouped(note, event.currentTarget)}/>
          <button type="button" className="icon-button group-location-remove" aria-label={t('Delete note {n}', { n: index + 1 })} disabled={locked} onClick={() => void cards.remove(note)}><Icon name="trash" size={14}/></button>
          {selectCard(note, index)}
        </div>
      </li>)}</ol>
    </GroupCard>; })}
    <ol className="note-list">{individualNotes.map(({ note, index }) => renderNote(note, index))}</ol>
    </section>}
    {unplacedSuggestions.length > 0 && <section className="note-section" aria-label={t('Unplaced suggestions')}><h3>{t('Unplaced suggestions')}</h3><ol className="note-list">{notes.map((note, index) => note.aiReview && note.key !== currentKey && renderNote(note, index))}</ol></section>}
    {cards.undo(selectionLocked)}
    {Object.entries(errors).filter(([id]) => !notes.some(note => note.id === id && !note.group)).map(([id, error]) => <p key={id} className="inline-error" role="alert">{error}</p>)}
    </section>
    {batch && clearTarget && <ClearAnnotationsDialog target={clearTarget} name={clearTarget.document || batch.name}
      unconfirmed={batch.uncertain?.batch === clearTarget.batch}
      disabled={batch.disabled || selectionLocked || clearTarget.document !== batch.document} clear={batch.clear} onClose={() => setClearTarget(null)}/>}
  </>;
}

// The composer receives only attachments the author explicitly chose in the PDF.
// Each one is the same card as in My notes: click the text or ✏️ to edit it,
// 🗑 deletes it (⌘Z brings it back), and × takes it out of the task.
function TaskNotes({ notes, currentKey, actions, onShow, controller, cards, headerSlot }: { notes: Annotation[]; currentKey?: string; actions: NoteActions; onShow: (note: Annotation) => void; controller: React.Ref<NotesHandle>; cards: ReturnType<typeof useNoteCards>; headerSlot?: HTMLElement | null }) {
  const panel = useRef<HTMLElement>(null);
  const chosen = notes.filter(note => actions.selection.has(note.id));
  // Saving can outlive this view; drafts, failures and busy state live in App.
  useSaveNotesOnLeave(cards.saveAll);
  useImperativeHandle(controller, () => ({ save: cards.saveAll }));
  const locked = cards.busy || actions.sending, selectionLocked = locked || cards.editing;
  // A note that left the task while its save failed still reports it here.
  const orphanErrors = Object.entries(cards.errors).filter(([id]) => !chosen.some(note => note.id === id && !note.group));
  if (!chosen.length && !cards.dismissed && !orphanErrors.length) return null;
  // Notes listed in My notes fly back there; placed AI suggestions stay on the page.
  const putBack = (list: Annotation[]) => {
    returnNotes(list.filter(note => !note.aiReview || note.key !== currentKey).flatMap(note => panel.current?.querySelector<HTMLElement>(`[data-note="${CSS.escape(note.id)}"]`) || []));
    actions.selection.set(list.map(note => note.id), false);
  };
  // Show each selected passage with its individual comment and group context.
  const reference = (note: Annotation, index: number) => cards.drafts[note.id] ? cards.card(note, index, { currentKey, inTask: true, onShow, onToggle: () => putBack([note]) }) : <li key={note.id} data-note={note.id} className="task-note-reference">
    <div className="note-head"><button type="button" className="note-number" aria-label={note.aiReview ? t('Show suggestion {n} on the page', { n: index + 1 }) : t('Show note {n} on the page', { n: index + 1 })} disabled={note.key !== currentKey} onClick={() => onShow(note)}>{index + 1}</button><span className="note-where">{noteWhere(note)}</span>{!isTaskReviewNote(note) && <>
      <GroupPicker forNote value={note.group ?? null} disabled={selectionLocked} onChange={next => void cards.regroup(note, next)}/>
      <NoteEditButton grouped number={index + 1} disabled={selectionLocked} onEdit={event => cards.editGrouped(note, event.currentTarget)}/>
    </>}<TaskRemoveButton number={index + 1} ai={Boolean(note.aiReview)} disabled={selectionLocked} onClick={() => putBack([note])}/></div>
    <NoteQuote text={note.quote} kind={note.kind}/>
    {(note.comment || note.kind === 'delete' || note.stamp) && <p className="task-note-comment">{note.stamp && <span className="pdf-note-stamp"><Icon name="spark" size={12}/>{note.stamp}</span>}{markText(note)}</p>}
    {note.key !== currentKey && <NotePlacementWarning/>}
  </li>;
  return <section ref={panel} className="task-notes-panel" aria-label={t('Notes in this task')}>
    {/* Beside the panel's tabs, whose count already says how many notes the task has; phones hide that header. */}
    {chosen.length > 0 && (headerSlot
      ? createPortal(<button type="button" className="note-select-all" disabled={selectionLocked} onClick={() => putBack(chosen)}>{t('Remove all from task')}</button>, headerSlot)
      : <div className="note-selection-head"><span>{t('Added to task: {n}', { n: chosen.length })}</span><button type="button" className="note-select-all" disabled={selectionLocked} onClick={() => putBack(chosen)}>{t('Remove all from task')}</button></div>)}
    {noteGroups(notes).map(({ group, entries }) => {
      const selected = entries.filter(({ note }) => actions.selection.has(note.id));
      const selectedNotes = selected.map(({ note }) => note);
      return selected.length > 0 && <GroupCard key={group} group={group} count={selected.length} onRegroup={selectedNotes.every(note => !isTaskReviewNote(note)) ? next => void cards.regroupMany(selectedNotes, next) : undefined} regroupDisabled={selectionLocked}>
        <GroupInstruction group={group} value={actions.instructions.get(group, selectedNotes)} disabled={actions.sending} onChange={value => actions.instructions.set(group, value, selectedNotes)}/>
        <ol className="task-note-list">{selected.map(({ note, index }) => reference(note, index))}</ol>
      </GroupCard>;
    })}
    <ol className="task-note-list task-note-cards">{notes.map((note, index) => !note.group && actions.selection.has(note.id) && cards.card(note, index, { currentKey, inTask: true, onShow, onToggle: () => putBack([note]) }))}</ol>
    {cards.undo(selectionLocked)}
    {orphanErrors.map(([id, error]) => <p key={id} className="inline-error" role="alert">{error}</p>)}
  </section>;
}

function PendingComparison({ task, busy, onBuild }: { task: Task; busy: boolean; onBuild: () => void }) {
  const answered = noManuscriptChanges(task);
  // A new publication may still have the previous round's job until its
  // first poll. Never display that job's progress or elapsed time.
  const job = task.review?.job && ['queued', 'running'].includes(task.review.job.status)
    && (!task.pendingBuild || task.pendingBuild.job === task.review.job.id) ? task.review.job : null;
  let title = answered ? t('No manuscript changes') : t('PDF comparison');
  let detail = answered ? t('This task did not change the manuscript. Read the answer in the chat.') : t('Only manuscript changes need a PDF comparison. Answers to questions are in the chat.');
  if (task.status === 'building') {
    title = t('Preparing task results…');
    detail = t('Checking for manuscript changes. A PDF comparison is generated only when needed.');
    if (job?.status === 'queued') title = t('Queued');
    else if (job?.phase === 'build') {
      title = t('Compiling the PDF…');
      detail = t('Preparing both versions for comparison. Large documents can take several minutes.');
    } else if (job?.phase === 'options') {
      title = t('Preparing option comparisons…');
      detail = job.options ? t('{current} of {total}', { current: job.options.completed, total: job.options.total }) : '';
    } else if (job?.phase === 'render') {
      title = t('PDF comparison');
      detail = t('Comparing the typeset pages…');
    }
  } else if (task.status === 'running' || task.status === 'queued') {
    title = task.status === 'running' ? t('{agent} is working', { agent: workingAgentName(task) }) : t('Queued');
    detail = t('If the task changes the manuscript, a PDF comparison will appear here. Otherwise, read the answer in the chat.');
  } else if (task.status === 'waiting_input') {
    title = task.manualTurn?.status === 'awaiting_reply' ? t('Waiting for ChatGPT Pro') : t('Needs your reply');
    detail = task.manualTurn?.status === 'awaiting_reply'
      ? t('Copy the prompt in the chat, then paste ChatGPT Pro’s reply there to apply edits.')
      : t('Reply in the chat to continue. A PDF comparison is needed only if the manuscript changes.');
  } else if (task.status === 'uncertain') {
    title = t('Check task status');
    detail = t('Confirm whether the task is still running before generating a PDF comparison.');
  }
  return <div className="review-placeholder">
    <div className="placeholder-icon">{task.status === 'building' ? <span className="spinner large"/> : <Icon name={answered ? 'chat' : 'diff'} size={22}/>}</div>
    <h2>{title}</h2><p>{detail}</p>
    {task.status === 'building' && <ComparisonProgress job={job}/>}
    {!answered && ['idle', 'interrupted', 'failed', 'reviewing'].includes(task.status) && <button type="button" className="button secondary" disabled={busy} onClick={onBuild}>{t('Generate PDF comparison')}</button>}
  </div>;
}

// A task has no copy of the manuscript until it is prepared. When that fails,
// the chat shows the error with Retry and Delete.
function PreparingTask({ task }: { task: Task }) {
  const failed = task.status !== 'preparing';
  return <div className="review-placeholder">
    <div className="placeholder-icon">{failed ? <Icon name="alert" size={22}/> : <span className="spinner large"/>}</div>
    <h2>{failed ? t('Could not prepare this task') : preparingLabel(task)}</h2>
    {failed && task.error && <p>{errorText(task.error)}</p>}
  </div>;
}

type ManuscriptPanel = 'pdf' | 'task' | 'source';
function ManuscriptView({ evidenceActions, evidenceFocus, onEvidenceShown, showsChecks = false, onOpenTask, returnedPlace, onPlaceShown, notesRequest, taskCards, navigationGuard, collapsed, setCollapsed, project, data, error, view, setView, region, setRegion, active, setActive, actions, newTask, tools, share, navigation, onGit, writer, reportError, onFixProblems, diagnoseBuild, openFile, onOpened, onEditing }: { returnedPlace?: string; onPlaceShown: (id: string) => void; notesRequest?: number; openFile?: { file: string; line?: number } | null; onOpened?: () => void; onEditing?: (file: string | null) => void; navigationGuard: React.Ref<NotesHandle>; collapsed: boolean; setCollapsed: React.Dispatch<React.SetStateAction<boolean>>; taskCards: ReturnType<typeof useNoteCards>; onFixProblems?: (request: string) => void; diagnoseBuild?: (failureId: string) => Promise<BuildRepairResult>; navigation?: React.ReactNode; newTask: (notes: React.ReactNode) => React.ReactNode; tools?: React.ReactNode; share?: React.ReactNode; onGit: (status: GitStatus) => void; writer?: CommitMessageChoice; reportError: (error: unknown) => void; project: Project; data: Manuscript | null; error: string; view: ManuscriptPanel; setView: (view: ManuscriptPanel) => void; region: boolean; setRegion: (on: boolean) => void; active: string; setActive: (id: string) => void; actions: NoteActions; onOpenTask: (id: string) => void; evidenceActions?: EvidenceActions; evidenceFocus?: { id: string; at: number } | null; onEvidenceShown?: () => void; showsChecks?: boolean }) {
  const build = data?.build, notes = data?.annotations || [], git = data?.git;
  // Marks are read only while a citation check of this paper is shown in it.
  const evidence = useEvidenceMarks(project.id, build?.key, api, !isPlayground && showsChecks);
  // A sentence shown from a cited work's PDF, once per request as soon as
  // its mark is known: the PDF on screen at its place, and its card open.
  const [shownEvidence, setShownEvidence] = useState<{ id: string; at: number } | undefined>(undefined);
  useEffect(() => {
    const mark = evidenceFocus && evidence.find(item => item.id === evidenceFocus.id);
    if (!evidenceFocus || !mark) return;
    setMode('pdf');
    if (window.matchMedia('(max-width: 680px)').matches) setView('pdf');
    setShownEvidence(evidenceFocus);
    onEvidenceShown?.();
    requestAnimationFrame(() => pdf.current?.showPlace(mark.page, [Math.min(...mark.rects.map(r => r[0])), Math.min(...mark.rects.map(r => r[1])), Math.max(...mark.rects.map(r => r[2])), Math.max(...mark.rects.map(r => r[3]))], { keep: true }));
  }, [evidenceFocus, evidence]);
  const pdf = useRef<PdfHandle>(null);
  // Each root document keeps its reading place, named with the build it
  // arrives with; the place saved before documents had their own goes to the
  // first one opened.
  const shownDocument = build?.document;
  const place = useMemo(() => {
    const paper = 'pdf:' + project.id, own = shownDocument ? `${paper}:${shownDocument}` : paper;
    if (own !== paper && readPlace(own) === undefined) {
      const saved = readPlace(paper);
      if (saved !== undefined) { savePlace(own, saved); savePlace(paper, undefined); }
    }
    return own;
  }, [project.id, shownDocument]);
  const [readingNotes, setReadingNotes] = useState(false);
  useEffect(() => { if (notesRequest) { showMode('pdf'); setReadingNotes(true); } }, [notesRequest]);
  useEffect(() => { if (returnedPlace) showMode('pdf'); }, [returnedPlace]);
  const notesPanel = useRef<NotesHandle>(null);
  const taskNotes = useRef<NotesHandle>(null);
  useImperativeHandle(navigationGuard, () => ({ save: async () => {
    if (pdf.current && !await pdf.current.save()) return false;
    if (taskNotes.current && !await taskNotes.current.save()) return false;
    if (notesPanel.current && !await notesPanel.current.save()) return false;
    return true;
  } }));
  async function closeReadingNotes() {
    if (readingNotes && notesPanel.current && !await notesPanel.current.save()) return false;
    setReadingNotes(false); return true;
  }
  const canCollapse = useMedia('(min-width: 681px)'), hidden = canCollapse && collapsed;
  const sideBySide = useMedia('(min-width: 901px)');
  const panelId = useId(), panelToggle = useRef<HTMLButtonElement>(null), taskTab = useRef<HTMLButtonElement>(null);
  const panel = usePanelWidth('papilot:manuscript-width', '--manuscript-width', '.manuscript-side', t('Resize manuscript panel'), sideBySide && !hidden, () => pdf.current?.fitWidth());
  useEffect(() => { browserStorage.setItem('papilot:manuscript-panel', collapsed ? 'hidden' : 'visible'); }, [collapsed]);
  const togglePanel = canCollapse && <button ref={panelToggle} type="button" className="icon-button manuscript-panel-toggle" aria-label={hidden ? t('Expand manuscript panel') : t('Collapse manuscript panel')} title={hidden ? t('Expand manuscript panel') : t('Collapse manuscript panel')} aria-expanded={!hidden} aria-controls={panelId} onClick={() => {
    setCollapsed(value => !value); pdf.current?.fitWidth();
    requestAnimationFrame(() => panelToggle.current?.focus());
  }}><Icon name={hidden ? 'panelExpand' : 'panelCollapse'} size={18}/></button>;
  // Sharing exports the paper, so it sits with the page's own tools.
  const [taskActions, setTaskActions] = useState<HTMLDivElement | null>(null), sideHeader = useMedia('(min-width: 681px)');
  const pageTools = <>{tools}{share}{hidden && togglePanel}</>;
  // PDF or Changes stays as the author left it when they come back to the paper.
  const [mode, showMode] = useState<PdfMode>(() => !isPlayground && readPlace('mode:' + project.id) === 'changes' ? 'changes' : 'pdf'), [committing, setCommitting] = useState(false);
  const setMode = (value: PdfMode) => {
    if (isPlayground && value === 'changes') { window.dispatchEvent(new CustomEvent('papilot:playground-open', { detail: 'example-clarity' })); return; }
    showMode(value); savePlace('mode:' + project.id, value); };
  // The last build's problems sit beside Recompile and open only when asked.
  const problems = useRef<ProblemsHandle>(null);
  // Editing a passage's LaTeX by hand, from a click on the PDF, in a tab
  // beside New task that exists while a passage is open.
  const review = useRef<ReviewSources>(null), modeRef = useRef<PdfMode>('pdf');
  // In Changes, moving to a changed line in the editor shows its change.
  const source = useSourceEdit({ api, projectId: project.id, build, head: git?.head?.hash ?? null, pdf, onProblems: () => problems.current?.open(),
    onLine: (file, line) => { if (modeRef.current === 'changes') review.current?.select(file, line); } });
  modeRef.current = mode;
  useEffect(() => { if (view === 'source' && !source.editing) setView(window.matchMedia('(max-width: 680px)').matches ? 'pdf' : 'task'); }, [source.editing, view]);
  // A file picked in the Manuscript row's file menu opens in the source tab.
  useEffect(() => {
    if (!openFile) return;
    setView('source'); setCollapsed(false); source.openFile(openFile.file, openFile.line); onOpened?.();
  }, [openFile]);
  useEffect(() => { onEditing?.(source.tab?.file || null); }, [source.tab?.file]);
  useEffect(() => () => onEditing?.(null), []);
  const problemsButton = <ProblemsButton ref={problems} counts={build?.problems} status={build?.status} failureId={build?.failureId} pdfKey={build?.key} logUrl={`/api/projects/${project.id}/manuscript/log`} diagnose={diagnoseBuild}
    load={() => api<ManuscriptProblems>(`/projects/${project.id}/manuscript/problems`)}
    onJump={problem => { if (problem.page === undefined || !problem.rect) return; if (phone()) setView('pdf'); const { page, rect } = problem; requestAnimationFrame(() => pdf.current?.showPlace(page, rect)); }}
    onFix={onFixProblems && ((list, diagnosis) => {
      const request = fixRequest(list);
      onFixProblems(diagnosis ? `Repair the project files in this task worktree as needed to resolve the errors. Preserve the scientific content.\n\nDiagnosis:\n${diagnosis}\n\n${request}` : request);
      setView('task'); setCollapsed(false);
    })}/>;
  // The button always says how many notes are saved, and pops as more arrive.
  const notesLabel = notes.length ? `${t('My notes')} · ${tn(notes.length, 'Note on the PDF', '{n} notes on the PDF')}` : t('My notes');
  const pdfTools = <>{tools}{problemsButton}<button type="button" data-notes-home="library" className={'icon-button' + (readingNotes ? ' active' : '')} aria-label={notesLabel} title={notesLabel} aria-pressed={readingNotes} onClick={() => { if (readingNotes) void closeReadingNotes(); else { setActive(''); setReadingNotes(true); } }}><Icon name="notes" size={16}/>{notes.length > 0 && <span className="notes-count" aria-hidden="true">{notes.length}</span>}</button>{share}{hidden && togglePanel}</>;
  const staged = Array.isArray(git?.files) && !git.merging ? git.files.filter(file => file.staged).map(file => file.path) : [];
  const reloadGit = () => void api<GitStatus>(`/projects/${project.id}/git`).then(onGit, () => undefined);
  const commitButton = (inFrame: boolean) => staged.length > 0 && (inFrame
    ? <><span className="commit-state">{tn(staged.length, '{n} file staged', '{n} files staged')}</span><button type="button" className="commit-button" onClick={() => setCommitting(true)}>{t('Commit…')}</button></>
    : <button type="button" className="button ghost compact commit-staged" title={t('Commit what is staged')} onClick={() => setCommitting(true)}><Icon name="commit" size={14}/><span>{t('Commit…')}</span></button>);
  const [outline, setOutline] = useState<OutlineItem[]>([]), [section, setSection] = useState(-1);
  const switcher = <>{navigation}<ModeSwitch mode={mode} onMode={async value => { if (await closeReadingNotes()) setMode(value); }}/>
  </>;
  const numbered = notes.map((note, index) => ({ note, number: index + 1 }));
  const phone = () => window.matchMedia('(max-width: 680px)').matches;
  const side = view === 'source' && source.panel ? 'source' : 'task';
  async function show(note: Annotation) {
    if (note.key !== build?.key || !await closeReadingNotes()) return;
    setMode('pdf');
    setActive(note.id);
    if (phone()) setView('pdf');
    requestAnimationFrame(() => pdf.current?.goToNote(note));
  }
  async function reviewAddedNotes() {
    if (!await closeReadingNotes()) return;
    setView('task'); setCollapsed(false);
    requestAnimationFrame(() => taskTab.current?.focus());
  }
  return <div className={'manuscript show-' + view + (hidden ? ' panel-collapsed' : '')} style={panel.style}>
    {panel.resizer}
    {mode === 'changes' ? <section className="manuscript-pages" aria-label={t('Uncommitted changes in the PDF')}>
      <ReviewFrame key={'changes:' + project.id} changesOf={project.id} lead={switcher} tools={<>{commitButton(false)}{pageTools}</>} completion={commitButton(true)} onDecided={reloadGit}
        sources={review} onOpenSource={isPlayground ? undefined : request => { if (phone()) return false; source.reveal(request.file, request.lines, request.marks); setView('source'); setCollapsed(false); return true; }}
        onCurrentChange={change => { if (!phone()) void source.follow(change, () => { setView('source'); setCollapsed(false); }); }}/>
    </section> : <section className="manuscript-pages" aria-label={t('PDF preview')} aria-busy={!build || build.status === 'building'}>
      {!build?.key && <div className="pdf-toolbar manuscript-lead" role="toolbar" aria-label={t('PDF controls')}>{switcher}<div className="pdf-toolbar-spacer"/>{pdfTools}</div>}
      {error && <div className="manuscript-note error" role="alert">{error}</div>}
      {build?.status === 'failed' && (build.key
        // The previous PDF stays readable; the details wait in the problem list.
        ? <div className="manuscript-note error brief" role="alert"><span>{t('The latest changes did not compile. This is the last PDF that did.')}</span><button type="button" className="note-link" onClick={() => problems.current?.open()}>{t('Show problems')}</button></div>
        : <div className="manuscript-note error" role="alert"><strong>{t('The manuscript did not compile.')}</strong><pre>{build.error}</pre></div>)}
      {build?.key ? <Suspense fallback={<div className="review-loading"><p role="status">{t('Opening the PDF…')}</p></div>}><PdfView key={place} ref={pdf} place={place} pdfKey={build.key} url={pdfAsset(`/api/projects/${project.id}/manuscript.pdf?key=${build.key}`)} words={wordAsset(`/api/projects/${project.id}/manuscript/words?key=${build.key}`)} keyedNotes revealNote={returnedPlace} onNoteShown={onPlaceShown} notes={numbered} active={active} region={region} setRegion={setRegion} group={actions.group} onGroupChange={actions.setGroup} markingDisabled={actions.sending}
          inFlightMarks={data?.inFlightMarks} onOpenTask={onOpenTask} margin={evidence.length && evidenceActions ? page => <PaperEvidence marks={evidence.filter(mark => mark.page === page)} actions={evidenceActions} focus={shownEvidence}/> : undefined}
          anchorApi={(action, body) => api(`/projects/${project.id}/manuscript/anchors${action === 'resolve' ? '/resolve' : ''}`, body)}
          history={actions.history} noteActions={{ has: actions.selection.has, toggle: note => actions.selection.set([note.id], !actions.selection.has(note.id)), remove: actions.remove, restore: actions.restore, edit: actions.edit, regroup: actions.regroup, onEditing: actions.onEditing, onBusy: actions.onReviewBusy, disabled: actions.sending }} onDeselect={() => setActive('')}
          onCreate={actions.add} onSelect={async note => { if (await closeReadingNotes()) setActive(note.id); }} outline={outline} section={section} onOutline={setOutline} onSection={setSection} lead={switcher} tools={pdfTools}
          onSource={async (target, key) => { if (!await closeReadingNotes()) return; setActive(''); setView('source'); setCollapsed(false); void source.open(target, key); }} passage={source.passage}/></Suspense>
        : !error && build?.status !== 'failed' && <div className="review-placeholder"><div className="placeholder-icon"><span className="spinner large"/></div><h2>{t('Compiling the PDF…')}</h2></div>}
      {returnedPlace && active === returnedPlace && notes.some(note => note.id === returnedPlace && note.key !== build?.key) && <div className="manuscript-note" role="status"><NotePlacementWarning/></div>}
      {readingNotes && <><div aria-hidden="true" className="pdf-reading-notes-scrim" onClick={() => void closeReadingNotes()}/><aside className="pdf-reading-notes" aria-label={t('PDF note library')}><NotesPanel key={project.id + ':' + (manuscriptDocument(data) || '')} controller={notesPanel} notes={notes} sections={data?.noteSections} pageLayouts={data?.notePageLayouts} currentKey={build?.key} active={active} actions={actions} onShow={show} onAdded={() => void reviewAddedNotes()} onClose={() => void closeReadingNotes()}/></aside></>}
    </section>}
    <aside id={panelId} className="manuscript-side" aria-label={t('Manuscript panels')} hidden={hidden}>
      <div className="manuscript-side-header">
        {!hidden && togglePanel}
        <div className="side-tabs" role="tablist" aria-label={t('Manuscript panels')}>
          <button ref={taskTab} role="tab" data-task-home aria-selected={side === 'task'} title={t('New task')} onClick={() => setView('task')}><Icon name="compose" size={14}/><span className="tab-label">{t('New task')}</span>{actions.selection.selected.length > 0 && <span className="count" aria-hidden="true">{actions.selection.selected.length}</span>}</button>
          {source.tab && <SourceTab tab={source.tab} selected={side === 'source'} onSelect={() => setView('source')} onClose={source.close}/>}
        </div>
        <div ref={setTaskActions} className="side-header-actions" hidden={side !== 'task'}/>
      </div>
      <div className="side-pane" hidden={side !== 'task'}>{newTask(<TaskNotes headerSlot={sideHeader ? taskActions : null} cards={taskCards} controller={taskNotes} notes={notes} currentKey={build?.key} actions={actions} onShow={show}/>)}</div>
      {source.panel && <div className="side-pane" hidden={side !== 'source'}>{source.panel}</div>}
    </aside>
    {committing && <CommitDialog branch={git?.branch ?? null} files={staged} staged remote={Boolean(git?.remote)} agent={writer && agentLabel(writer.agent)} onClose={() => setCommitting(false)}
      generate={writer && (fresh => api<{ message: string }>(`/projects/${project.id}/git/message`, { paths: staged, staged: true, ...writer, language: commitMessageLanguage(), fresh }).then(result => result.message))}
      commit={async (message, push) => {
        const result = await api<{ commit: string; git: GitStatus; pushError?: string }>(`/projects/${project.id}/git/commit`, { message, staged: true, push });
        onGit(result.git); setCommitting(false);
        // The commit stands even when the push fails; the author can push again.
        if (result.pushError) reportError(result.pushError);
      }}/>}
  </div>;
}

function App() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [savedTask] = useState(() => browserStorage.getItem('papilot:task'));
  const [selected, setSelected] = useState(savedTask || '');
  const [projectId, setProjectId] = useState(() => browserStorage.getItem('papilot:project') || '');
  const [timeline, setTimeline] = useState<{ taskId: string; items: TimelineItem[] }>({ taskId: '', items: [] });
  const [itemsLoading, setItemsLoading] = useState(false);
  const [timelineError, setTimelineError] = useState({ taskId: '', message: '' });
  const snapshotRef = useRef<Snapshot | null>(null);
  const timelineCache = useRef(new Map<string, TimelineItem[]>());
  const timelineRevisions = useRef(new Map<string, string>());
  // A tag (or untagged JSON); empty while the app shows a locally changed snapshot.
  const snapshotText = useRef('');
  const composers = useRef(new Map<string, ComposerDraft>());
  const answerDrafts = useRef(new Map<string, Record<string, string>>());
  const [snapshotRequest] = useState(() => new ReadRequest<{ value: (Snapshot & { csrf: string }) | null; tag: string }>());
  const [timelineRequest] = useState(() => new ReadRequest<{ items: TimelineItem[]; revision?: string; partial?: boolean }>());
  const [online, setOnline] = useState(true), [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const sidebarRef = useRef<HTMLElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [bulkTarget, setBulkTarget] = useState<BulkTaskAction | null>(null);
  const [modal, setModal] = useState<'project' | 'create' | 'overleaf' | null>(null);
  const [createPreset, setCreatePreset] = useState<{ id: string; version: string } | null>(null);
  const [openingFolder, setOpeningFolder] = useState(false), [mainChoice, setMainChoice] = useState<{ path: string; name: string; candidates: string[] } | null>(null);
  const folderRequest = useRef(false);
  // Commit drafts survive switching tasks or moving between review and chat.
  const applyStates = useRef(new Map<string, { key: string; draft: TaskApplyState }>());
  // Suggestions the author answered in this session, per task, so a remembered one keeps its Undo.
  const memoryAnswers = useRef(new Map<string, Set<string>>());
  const newTaskInput = useRef<HTMLTextAreaElement>(null);
  const [newDraft, setNewDraft] = useState(() => browserStorage.getItem('papilot:new-task') || '');
  const [newSkill, setNewSkill] = useState<Skill | null>(null);
  const [skills, setSkills] = useState<{ projectId: string; list: Skill[] }>({ projectId: '', list: [] });
  const [skillsRevision, setSkillsRevision] = useState(0);
  const [manualSettingsVersion, setManualSettingsVersion] = useState(0);
  // The agent, and each agent's model and reasoning effort, are remembered for
  // every new task, whether it starts from the composer or from PDF notes.
  useAgentPreferenceChanges();
  const [savedAgent, setAgentChoice] = useState<AgentId | null>(() => { const saved = browserStorage.getItem('papilot:agent'); return isAgentId(saved) ? saved : null; });
  const [agentModels, setAgentModels] = useState(() => Object.fromEntries(AGENT_IDS.map(id => [id, browserStorage.getItem(`papilot:model:${id}`) || ''])) as Record<AgentId, string>);
  const [creating, setCreating] = useState(false), [createError, setCreateError] = useState('');
  const [addedTask, setAddedTask] = useState<Pick<Task, 'id' | 'title'> | null>(null);
  const [flyingTask, setFlyingTask] = useState<TaskFlightData | null>(null);
  const taskArrived = useCallback((task: TaskFlightData) => {
    setFlyingTask(null); setAddedTask({ id: task.id, title: task.title });
  }, []);
  useEffect(() => {
    if (!addedTask) return;
    const timer = setTimeout(() => setAddedTask(null), 3600);
    return () => clearTimeout(timer);
  }, [addedTask]);
  const [sidebar, setSidebar] = useState(false);
  const actionRequests = useRef(new Set<string>());
  const [pendingActions, setPendingActions] = useState(new Set<string>());
  const [sidebarVisible, setSidebarVisible] = useState(() => browserStorage.getItem('papilot:sidebar') !== 'hidden');
  // Papilot opens tasks with the review and chat side by side. A chosen view
  // lasts until Papilot is closed, so one switch never changes the default.
  const [layout, setLayout] = useState<'split' | 'review' | 'conversation'>('split');
  const narrow = useMedia('(max-width: 900px)'), mobile = useMedia('(max-width: 680px)');
  const [mobileTab, setMobileTab] = useState('review');
  const layoutTransition = useRef<ViewTransition | null>(null);
  const [renaming, setRenaming] = useState('');
  const [taskSearch, setTaskSearch] = useState(''), [showArchived, setShowArchived] = useState(false);
  // Enter and Escape return focus to the renamed task; clicking elsewhere keeps that focus.
  const refocus = useRef('');
  useEffect(() => {
    if (renaming || !refocus.current) return;
    document.querySelector<HTMLElement>(`.task-row[data-task="${refocus.current}"] .task-link`)?.focus();
    refocus.current = '';
  }, [renaming]);
  const [editingPaper, setEditingPaper] = useState<Project | null>(null);
  // The open paper's Overleaf dialog: linking it, or its sync's details.
  const [overleafOpen, setOverleafOpen] = useState(false);
  const [manuscriptView, setManuscriptView] = useState<ManuscriptPanel>(() => window.matchMedia('(max-width: 680px)').matches ? 'pdf' : 'task');
  const manuscriptNavigationGuard = useRef<NotesHandle>(null);
  const [libraryRequest, setLibraryRequest] = useState(0);
  // A citation check's quote, opened from the paper's PDF: the Library shows the cited work's PDF there.
  const [libraryFocus, setLibraryFocus] = useState<LibraryFocus | null>(null);
  // A paper's sentence shown from a cited work's PDF, back in the paper.
  const [evidenceFocus, setEvidenceFocus] = useState<{ id: string; at: number } | null>(null);
  // A citation check starts at once, with the quick model from Settings or
  // else the default model; its page offers another model to check again.
  const startCheck = async () => {
    if (!project) return;
    const id = crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const quick = await api<{ choice: ModelChoice | null }>('/quick-model').then(result => result.choice, () => null);
    const fallback = readOnlyChoice(defaultSelection.agent);
    const choice = quick ?? (fallback && { agent: fallback.agent, model: fallback.model || null, effort: null });
    const runtime = choice && runtimes[choice.agent];
    if (runtime?.supportsReadOnlyTasks === false) throw new Error(errorText('The selected agent does not support read-only tasks. Select another agent.'));
    if (!choice || runtime?.hidden || runtime?.installed === false || (runtime?.connected && !runtime.authenticated)) throw new Error(errorText(noReadOnlyAgent));
    await api('/citation-checks', { id, projectId: project.id, agent: choice.agent, model: choice.model, effort: choice.effort, title: t('Check citations') });
    await refresh(true); setSelected(id); setSidebar(false);
  };
  const [manuscriptCollapsed, setManuscriptCollapsed] = useState(() => browserStorage.getItem('papilot:manuscript-panel') === 'hidden');
  // Without a task, the main area shows the manuscript or a tool from the
  // sidebar's Tools menu, such as the reference check.
  const [page, setPage] = useState<'manuscript' | 'library' | 'git'>(() => browserStorage.getItem('papilot:page') === 'git' ? 'git' : 'manuscript');
  useEffect(() => { browserStorage.setItem('papilot:page', page); }, [page]);
  const [region, setRegion] = useState(false);
  const [activeNote, setActiveNote] = useState('');
  const lastReturned = useRef(new Map<string, Annotation>());
  const seenReturns = useRef(new Map<string, number>());
  const returnClicks = useRef(new Map<string, string>());
  function rememberReturn(copy: Annotation) {
    if ((seenReturns.current.get(copy.id) ?? -1) >= copy.createdAt) return false;
    seenReturns.current.set(copy.id, copy.createdAt);
    const last = lastReturned.current.get(copy.projectId);
    if (!last || last.createdAt <= copy.createdAt) lastReturned.current.set(copy.projectId, copy);
    return true;
  }
  const [returnedPlace, setReturnedPlace] = useState('');
  const [noteGroup, setNoteGroup] = useState<NoteGroup | null>(null);
  const [marking, setMarking] = useState(0);
  // History belongs to this paper session. A restored note also returns to
  // the task draft it was in; late requests cannot populate another session.
  const annotationHistory = useRef({ projectId, undo: [] as AnnotationChange[], redo: [] as AnnotationChange[], busy: false, uncertain: new Map<string | null, AnnotationBatch>() });
  if (annotationHistory.current.projectId !== projectId) annotationHistory.current = { projectId, undo: [], redo: [], busy: false, uncertain: new Map() };
  const history = annotationHistory.current;
  const reviewUndoOrder = useRef(new Map<string, Map<string, number>>());
  function recordReviewOperation(decision?: string, undone?: string) {
    if (!task || (!decision && !undone)) return;
    const actions = reviewUndoOrder.current.get(task.id) ?? new Map<string, number>();
    if (decision && !actions.has(decision)) actions.set(decision, Date.now());
    if (undone) actions.delete(undone);
    reviewUndoOrder.current.set(task.id, actions);
  }
  const [, refreshHistory] = useState(0);
  const historyChanged = () => { if (annotationHistory.current === history) refreshHistory(value => value + 1); };
  const recordAnnotation = (entry: AnnotationChange) => {
    if (annotationHistory.current !== history) return;
    history.undo.push(entry); history.redo = []; historyChanged();
  };
  const noteEditVersion = useRef(0), noteWrites = useRef(new Map<string, { saved: Annotation; tail: Promise<void> }>());
  useEffect(() => { setNoteGroup(null); }, [projectId]);
  const [pdfNoteEditing, setNoteEditing] = useState(false);
  const [reviewNoteBusy, setReviewNoteBusy] = useState(false);
  const [manuscript, setManuscript] = useState<{ projectId: string; data: Manuscript | null; error: string }>({ projectId: '', data: null, error: '' });
  const latestManuscript = useRef(manuscript); latestManuscript.current = manuscript;
  const manuscriptRequest = useRef(0);
  const manuscriptBuildRequests = useRef(new Set<string>());
  const [pendingManuscriptBuilds, setPendingManuscriptBuilds] = useState(new Set<string>());
  const [git, setGit] = useState<{ projectId: string; status: GitStatus | null }>({ projectId: '', status: null });
  const [chatWidth, setChatWidth] = useState(() => Number(browserStorage.getItem('papilot:chat-width')) || 0);
  // Appearance, language and notifications live in Settings; a new language re-renders everything.
  const theme = useTheme(); const { language: uiLanguage } = useLanguage();
  const [settings, setSettings] = useState<false | SettingsInitialPage>(false);
  const [gitResolutions, setGitResolutions] = useState<Record<string, GitResolution>>({});
  const openSettings = useCallback(() => {
    const dialog = document.querySelector('.settings-dialog')?.closest('dialog');
    if (dialog?.open && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    setSettings(current => current || 'general');
  }, []);
  useEffect(() => window.papilotDesktop?.onOpenSettings?.(openSettings), [openSettings]);
  useEffect(() => {
    const shortcuts = () => setSettings('shortcuts'), quickNotes = () => setSettings('quickNotes'), memory = () => setSettings('memory');
    window.addEventListener('papilot:open-shortcuts', shortcuts); window.addEventListener('papilot:open-quick-notes', quickNotes); window.addEventListener(OPEN_MEMORY, memory);
    return () => { window.removeEventListener('papilot:open-shortcuts', shortcuts); window.removeEventListener('papilot:open-quick-notes', quickNotes); window.removeEventListener(OPEN_MEMORY, memory); };
  }, []);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const loaded = useRef(false);
  useEffect(() => {
    if (!narrow || !sidebar) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = sidebarRef.current;
    (panel?.querySelector<HTMLElement>('[aria-current="page"]') || panel?.querySelector<HTMLElement>('button'))?.focus();
    return () => { if (opener?.isConnected && opener.getClientRects().length) opener.focus(); };
  }, [narrow, sidebar]);
  useEffect(() => { setSidebar(false); }, [narrow]);
  useEffect(() => { browserStorage.setItem('papilot:sidebar', sidebarVisible ? 'visible' : 'hidden'); }, [sidebarVisible]);
  // Earlier versions saved the view and reopened it at every start.
  useEffect(() => { browserStorage.removeItem('papilot:layout'); }, []);
  useEffect(() => { if (chatWidth) browserStorage.setItem('papilot:chat-width', String(chatWidth)); else browserStorage.removeItem('papilot:chat-width'); }, [chatWidth]);
  useEffect(() => { if (newDraft) browserStorage.setItem('papilot:new-task', newDraft); else browserStorage.removeItem('papilot:new-task'); }, [newDraft]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const sync = () => {
      const style = document.documentElement.style;
      if (viewport && window.matchMedia('(max-width: 680px)').matches && viewport.scale === 1) {
        style.setProperty('--viewport-height', `${viewport.height}px`);
        style.setProperty('--viewport-top', `${viewport.offsetTop}px`);
      } else { style.removeProperty('--viewport-height'); style.removeProperty('--viewport-top'); }
    };
    sync(); viewport?.addEventListener('resize', sync); viewport?.addEventListener('scroll', sync); window.addEventListener('resize', sync);
    return () => { viewport?.removeEventListener('resize', sync); viewport?.removeEventListener('scroll', sync); window.removeEventListener('resize', sync); document.documentElement.style.removeProperty('--viewport-height'); document.documentElement.style.removeProperty('--viewport-top'); };
  }, []);
  useEffect(() => {
    if (!isPlayground) return;
    const open = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!['', 'example-clarity', 'example-math', 'example-review'].includes(id)) return;
      setSelected(id); setPage('manuscript'); setMobileTab('review'); setManuscriptView('pdf'); setSidebar(false);
      if (!id) setLibraryRequest(value => value + 1);
    };
    window.addEventListener('papilot:playground-open', open);
    return () => window.removeEventListener('papilot:playground-open', open);
  }, []);
  const reportError = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), []);
  const acceptSavedTask = useCallback((saved: Task) => {
    // A snapshot requested before the save must not restore the old permissions.
    snapshotRequest.cancel();
    const previous = snapshotRef.current;
    if (!previous) return;
    const next = { ...previous, tasks: previous.tasks.some(current => current.id === saved.id) ? previous.tasks.map(current => current.id === saved.id && current.updatedAt <= saved.updatedAt ? saved : current) : [...previous.tasks, saved] };
    snapshotRef.current = next; snapshotText.current = ''; setState(next);
  }, [snapshotRequest]);
  const refreshTimeline = useCallback(async (selection: string) => {
    if (selectedRef.current === selection && !timelineCache.current.has(selection)) setItemsLoading(true);
    try {
      // A cached timeline asks only for what changed since it was read.
      const cached = timelineCache.current.get(selection), since = cached && timelineRevisions.current.get(selection);
      await timelineRequest.run(selection, signal => api<{ items: TimelineItem[]; revision?: string; partial?: boolean }>('/tasks/' + selection + '/items' + (since ? '?since=' + encodeURIComponent(since) : ''), undefined, signal), timeline => {
        const current = timelineCache.current.get(selection);
        const items = timeline.partial && current ? mergeTimeline(current, timeline.items) : timeline.items;
        if (timeline.revision) timelineRevisions.current.set(selection, timeline.revision); else timelineRevisions.current.delete(selection);
        timelineCache.current.delete(selection);
        timelineCache.current.set(selection, items);
        // Bound the in-memory history cache while retaining quick back-and-forth navigation.
        if (timelineCache.current.size > 8) timelineCache.current.delete(timelineCache.current.keys().next().value!);
        if (selectedRef.current === selection) { if (items !== current) setTimeline({ taskId: selection, items }); setTimelineError(error => error.taskId === selection && !error.message ? error : { taskId: selection, message: '' }); }
      });
    } catch (e) { if (selectedRef.current === selection) setTimelineError({ taskId: selection, message: e instanceof Error ? e.message : String(e) }); }
    finally { if (selectedRef.current === selection) setItemsLoading(false); }
  }, [timelineRequest]);
  const refresh = useCallback(async (fresh = false) => {
    try {
      if (fresh) snapshotRequest.cancel();
      const load = (signal: AbortSignal) => import.meta.env.MODE === 'playground' ? api<Snapshot & { csrf: string }>('/state', undefined, signal).then(value => ({ value, tag: '' }))
        : requestState<Snapshot & { csrf: string }>(token, snapshotRef.current && /^(W\/)?"/.test(snapshotText.current) ? snapshotText.current : '', signal);
      await snapshotRequest.run('state', load, ({ value: next, tag }) => {
        // Most polls find nothing new; an identical snapshot leaves the app as it is.
        if (!next) { setOnline(true); setConnectionError(''); return; }
        const text = tag || JSON.stringify(next);
        if (text === snapshotText.current && snapshotRef.current) { setOnline(true); setConnectionError(''); return; }
        snapshotText.current = text;
        const selection = selectedRef.current, previous = snapshotRef.current;
        const removed = previous?.tasks.find(t => t.id === selection && !next.tasks.some(nextTask => nextTask.id === selection));
        if (removed) setProjectId(removed.projectId);
        token = next.csrf; snapshotRef.current = next; setState(next); setOnline(true); setConnectionError('');
        // Tell the author what changed while they were in another tab or app.
        if (previous && notifying() && (document.hidden || !document.hasFocus())) for (const alert of taskAlerts(previous, next, notificationState().events)) void notify(alert, id => { setSelected(id); setSidebar(false); setSettings(false); });
        for (const id of composers.current.keys()) if (!next.tasks.some(t => t.id === id)) { composers.current.delete(id); timelineCache.current.delete(id); browserStorage.removeItem('papilot:draft:' + id); }
        setDeleteTarget(current => current && !next.tasks.some(t => t.id === current.id) ? null : current);
        setEditingPaper(current => current && !next.projects.some(p => p.id === current.id) ? null : current);
        for (const id of answerDrafts.current.keys()) if (!next.requests.some(r => r.id === id)) answerDrafts.current.delete(id);
        if (selection && !next.tasks.some(t => t.id === selection)) setSelected('');
        // An empty saved task is the manuscript, not a missing preference.
        if (!loaded.current) { loaded.current = true; if (!isPlayground && savedTask === null && !selection) setSelected(next.tasks.filter(task => !task.archivedAt).at(-1)?.id || ''); }
      });
      const selection = selectedRef.current;
      if (!document.hidden && selection && snapshotRef.current?.tasks.some(t => t.id === selection)) await refreshTimeline(selection);
    } catch (e) { setOnline(false); setConnectionError(e instanceof Error ? e.message : String(e)); }
  }, [snapshotRequest, refreshTimeline, savedTask]);
  useEffect(() => {
    if (isPlayground) {
      const update = () => { if (!document.hidden) void refresh(); };
      void refresh();
      window.addEventListener('papilot:playground-change', update);
      document.addEventListener('visibilitychange', update);
      return () => { window.removeEventListener('papilot:playground-change', update); document.removeEventListener('visibilitychange', update); };
    }
    let generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
    let events: EventSource | undefined;
    const protocol = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.nextHopProtocol || '';
    function start() {
      const cycle = ++generation;
      clearTimeout(timer); events?.close(); events = undefined;
      // A hidden tab stops reading the host, unless it has notifications to give.
      if ((document.hidden && !notifying()) || !navigator.onLine) { snapshotRequest.cancel(); timelineRequest.cancel(); if (!navigator.onLine) { setOnline(false); setConnectionError(t('You are offline. Your draft is kept in this browser.')); } return; }
      if (canStreamUpdates(protocol)) {
        events = new EventSource('/api/events');
        events.addEventListener('change', () => { if (cycle === generation) void refresh(); });
        // A manuscript build started or ended: the open PDF view reloads now.
        events.addEventListener('manuscript', () => { if (cycle === generation) window.dispatchEvent(new Event('papilot:manuscript')); });
        // Coauthors' cursors on Overleaf, as they move.
        events.addEventListener('presence', event => { if (cycle === generation) { try { setPresence(JSON.parse((event as MessageEvent).data)); } catch { /* The next report replaces it. */ } } });
      }
      async function poll() {
        await refresh();
        if (cycle !== generation) return;
        const busy = snapshotRef.current?.tasks.some(t => ['preparing', 'running', 'waiting_input', 'queued', 'building'].includes(t.status));
        timer = setTimeout(() => void poll(), events?.readyState === EventSource.OPEN ? 10000 : document.hidden ? 5000 : busy ? 1000 : 2500);
      }
      void poll();
    }
    start();
    document.addEventListener('visibilitychange', start);
    window.addEventListener('online', start);
    window.addEventListener('offline', start);
    const unsubscribe = subscribeNotifications(start);
    return () => { generation++; clearTimeout(timer); events?.close(); snapshotRequest.cancel(); timelineRequest.cancel(); unsubscribe(); document.removeEventListener('visibilitychange', start); window.removeEventListener('online', start); window.removeEventListener('offline', start); };
  }, [refresh, snapshotRequest, timelineRequest]);
  useEffect(() => {
    browserStorage.setItem('papilot:task', selected);
    setTimeline({ taskId: selected, items: timelineCache.current.get(selected) || [] });
    setItemsLoading(Boolean(selected && !timelineCache.current.has(selected)));
    if (selected && snapshotRef.current?.tasks.some(t => t.id === selected)) void refreshTimeline(selected);
    return () => timelineRequest.cancel();
  }, [selected, refreshTimeline, timelineRequest]);
  const task = state?.tasks.find(t => t.id === selected);
  const demoRunning = isPlayground && state?.tasks.some(task => task.status === 'running' || task.status === 'building');
  useEffect(() => {
    if (!demoRunning) return;
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 150);
    return () => clearInterval(timer);
  }, [demoRunning, refresh]);
  // A new list on every render would scroll the chat to its end each time.
  const taskRequests = useMemo(() => state?.requests.filter(r => r.taskId === selected) || [], [state?.requests, selected]);
  if (task && !composers.current.has(task.id)) composers.current.set(task.id, new ComposerDraft('papilot:draft:' + task.id, browserStorage, uuid));
  const fullPdfUrl = task?.status !== 'deleting' && task?.review?.round ? pdfAsset(`/api/tasks/${task.id}/pdf?round=${task.review.round}`) : '';
  const project = state?.projects.find(p => p.id === (task?.projectId || projectId)) || state?.projects[0];
  // Keep the last visited conversation for this paper when navigation clears
  // selected. Resolve its live agent from the snapshot, never another paper's.
  const commitContextKey = project ? `papilot:commit-context:${project.id}:${project.path}` : '';
  useEffect(() => {
    if (task && task.status !== 'deleting' && commitContextKey) rememberCommitConversation(commitContextKey, task.id);
  }, [commitContextKey, task?.id, task?.status]);
  const commitPreference = useCommitMessageAgent(), conflictPreference = useConflictAgent();
  const commitContext = task || state?.tasks.find(item => item.id === commitConversation(commitContextKey) && item.projectId === project?.id && item.status !== 'deleting');
  // Remember the paper even when its manuscript is open, and replace stale
  // paper IDs only after the host has returned the accessible papers.
  useEffect(() => {
    if (!state) return;
    const id = project?.id || '';
    setProjectId(id);
    browserStorage.setItem('papilot:project', id);
  }, [project?.id, Boolean(state)]);
  useEffect(() => { setTaskSearch(''); setShowArchived(false); }, [project?.id]);
  useEffect(() => { if (task && !bulkTarget) setShowArchived(Boolean(task.archivedAt)); }, [task?.id, Boolean(task?.archivedAt)]);
  const requirements = useSystemRequirements(!isPlayground && Boolean(state) && online, loadRequirements);
  const setupPrompted = useRef(false);
  const firstSetupVisit = useRef(!browserStorage.getItem('papilot:setup-seen') && !browserStorage.getItem('papilot:project'));
  useEffect(() => {
    if (!requirements.report || setupPrompted.current) return;
    setupPrompted.current = true;
    browserStorage.setItem('papilot:setup-seen', '1');
    const tool = missingTools(requirements)[0];
    if (firstSetupVisit.current && tool && !document.querySelector('dialog[open]')) setSettings(tool);
  }, [requirements.report]);
  const newFiles = useAttachmentDraft(`papilot:files:new:${project?.id || projectId}`);
  const tasks = state?.tasks.filter(t => !project || t.projectId === project.id) || [];
  const listedTasks = tasks.filter(task => Boolean(task.archivedAt) === showArchived);
  const pinnedTaskIds = state?.pinnedTaskIds;
  const pinOrder = new Map((pinnedTaskIds || []).map((id, index) => [id, index]));
  const pinFocus = useRef<{ id: string; pinned: boolean; trigger: HTMLButtonElement | null } | null>(null);
  useLayoutEffect(() => {
    const focus = pinFocus.current;
    if (!focus || Boolean(pinnedTaskIds?.includes(focus.id)) !== focus.pinned) return;
    pinFocus.current = null;
    // The committed order can move a focused row. The task's timeline may
    // still be loading, so restore focus as soon as this list is rendered.
    if (focus.trigger?.isConnected && document.activeElement === document.body) focus.trigger.focus();
  }, [pinnedTaskIds]);
  const pinRank = (id: string) => showArchived ? 0 : pinOrder.get(id) ?? pinOrder.size;
  const searchTerms = taskSearch.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visibleTasks = listedTasks.filter(task => {
    const text = `${task.title}\n${task.instructions}`.toLocaleLowerCase();
    return searchTerms.every(term => text.includes(term));
  }).reverse().sort((a, b) => pinRank(a.id) - pinRank(b.id) || (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || b.createdAt - a.createdAt);
  const running = state?.tasks.filter(t => ['preparing', 'running', 'waiting_input', 'building'].includes(t.status)).length || 0;
  // One import entry offers links, folders and ZIPs. Desktop folder choices
  // open the original folder in place through the system picker.
  function createProject() { if (isPlayground) { requestPlaygroundDownload(); return; } setCreatePreset(null); setModal('create'); }
  function importProject() { if (isPlayground) { requestPlaygroundDownload(); return; } setCreatePreset(null); setModal('project'); }
  function syncOverleaf() { if (project) setOverleafOpen(true); else { setCreatePreset(null); setModal('overleaf'); } }
  async function openFolder(folder?: string, main?: string) {
    if (folderRequest.current) return;
    folderRequest.current = true;
    try {
      const path = folder ?? await chooseDirectory();
      if (!path) return;
      setModal(null); setCreatePreset(null); setOpeningFolder(true); setError('');
      const opened = await api<{ project: Project } | { name: string; candidates: string[] }>('/projects/open', { path, ...(main ? { main } : {}) });
      if ('candidates' in opened) { setMainChoice({ path, ...opened }); return; }
      // Select the paper once the state lists it; an unknown ID falls back to the first paper.
      await refresh(true);
      setMainChoice(null); setProjectId(opened.project.id); setSelected(''); setSidebar(false);
    } catch (failure) { if (main) throw failure; setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { folderRequest.current = false; setOpeningFolder(false); }
  }
  // File › Open Paper… in the desktop app's menu picks the folder natively.
  const openFolderRef = useRef(openFolder); openFolderRef.current = openFolder;
  useEffect(() => window.papilotDesktop?.onOpenFolder?.(folder => void openFolderRef.current(folder)), []);
  // A Universe link opens the new-paper dialog with its template chosen.
  useEffect(() => {
    const take = () => void window.papilotDesktop?.takeNewPaper?.().then(choice => { if (choice) { setCreatePreset(choice); setModal('create'); } }, () => undefined);
    take();
    return window.papilotDesktop?.onNewPaper?.(take);
  }, []);
  useEffect(() => window.papilotDesktop?.onOpenTask?.(id => {
    if (!snapshotRef.current?.tasks.some(task => task.id === id && task.status !== 'deleting')) return;
    setSelected(id); setSidebar(false); setSettings(false);
  }), []);
  // Fallbacks keep saved preferences intact in case they become available again.
  const runtimes: Partial<Record<AgentId, RuntimeStatus>> = state?.runtimes || (state ? { codex: state.runtime } : {});
  const settled = agentsSettled(runtimes);
  const isReviewDraft = newSkill?.output === 'annotations';
  const taskAgents = offeredAgents(runtimes);
  const offered = isReviewDraft ? taskAgents.filter(id => canReviewWith(id, runtimes[id])) : taskAgents;
  const defaultAgent = chosenAgent(savedAgent, taskAgents, runtimes);
  const agentChoice = isReviewDraft ? chosenAgent(savedAgent, offered, runtimes) : defaultAgent;
  const missingReadOnlyAgent = isReviewDraft && settled && !offered.length;
  const missingAgent = noAgent(runtimes, state?.allowedAgents) || missingReadOnlyAgent;
  useEffect(() => {
    // A later disconnect must keep the chosen agent and show its notice.
    // Nothing offered is not a choice: Codex is only the empty-state fallback.
    if (savedAgent === null && settled && taskAgents.includes(defaultAgent)) {
      setAgentChoice(defaultAgent); browserStorage.setItem('papilot:agent', defaultAgent);
    }
  }, [savedAgent, settled, defaultAgent, taskAgents]);
  // Authors who already picked another agent keep it; Papilot Writer is suggested once.
  const [writerDismissed, setWriterDismissed] = useState(() => browserStorage.getItem('papilot:writer-suggestion') === 'dismissed');
  const dismissWriter = () => { setWriterDismissed(true); browserStorage.setItem('papilot:writer-suggestion', 'dismissed'); };
  const writerReady = Boolean(runtimes.papilot?.connected && runtimes.papilot.authenticated);
  const suggestWriter = !writerDismissed && !missingAgent && savedAgent !== null && agentChoice !== 'papilot' && offered.includes('papilot');
  const effectivePermissions = readPermissionPreference(agentChoice, runtimes[agentChoice]);
  function modelSelection(id: AgentId) {
    const runtime = runtimes[id], models = runtime?.models || [], preferred = agentModels[id];
    const chosen = models.length && !models.some(model => model.id === preferred) ? '' : preferred;
    const model = models.find(model => model.id === chosen) || defaultOfferedModel(runtime);
    const pref = readModelPreferences(id, chosen, model) || { effort: isPlayground && id === 'codex' ? 'xhigh' : null, serviceTier: 'default' };
    const serviceTier = id === 'codex' ? modelServiceTier(model, pref.serviceTier) : undefined;
    return { chosen, pref, agent: { agent: id, model: model?.id || chosen, effort: taskEffort(pref.effort, model), serviceTier } };
  }
  const defaultSelection = modelSelection(defaultAgent);
  const { agent, pref } = agentChoice === defaultAgent ? defaultSelection : modelSelection(agentChoice);
  const readOnlyAgents = taskAgents.filter(id => id !== 'collaboration' && id !== 'chatgpt' && runtimes[id]?.supportsReadOnlyTasks !== false);
  // A read-only helper follows the editing choice when that runtime supports
  // it. Otherwise use an available read-only agent and its own model default.
  function readOnlyChoice(choice: CommitMessageChoice): CommitMessageChoice | undefined {
    if (readOnlyAgents.includes(choice.agent)) return choice;
    const ready = readOnlyAgents.find(id => runtimes[id]?.connected && runtimes[id]?.authenticated);
    if (ready) return { agent: ready, model: '', effort: '' };
  }
  function effectiveGitChoice(choice: CommitMessageChoice): CommitMessageChoice {
    if (choice.agent !== 'codex' || !choice.serviceTier) return choice;
    const runtime = runtimes.codex;
    const model = choice.model ? runtime?.models.find(model => model.id === choice.model)
      : defaultOfferedModel(runtime) ?? shownModels(runtime)[0];
    const serviceTier = effectiveServiceTier(model, choice.serviceTier);
    return serviceTier === choice.serviceTier ? choice : { ...choice, serviceTier };
  }
  const fallbackGitAgent = taskAgents.find(id => id !== 'collaboration' && !isManualAgent(id)) || 'codex';
  const conversationHelper = commitContext
    ? commitContext.agent === 'collaboration'
      ? { agent: fallbackGitAgent, model: '', effort: '' }
      : isManualAgent(commitContext.agent)
        ? commitContext.manualExecutor
          ? effectiveGitChoice({ agent: commitContext.manualExecutor.agent, model: commitContext.manualExecutor.model || '', effort: '' })
          : { agent: fallbackGitAgent, model: '', effort: '' }
        : effectiveGitChoice({
            agent: commitContext.agent || fallbackGitAgent, model: commitContext.model || '', effort: commitContext.effort || '',
            ...(commitContext.serviceTier ? { serviceTier: commitContext.serviceTier } : {}),
          })
    : defaultSelection.agent.agent === 'collaboration' || isManualAgent(defaultSelection.agent.agent)
      ? { agent: fallbackGitAgent, model: '', effort: '' }
      : defaultSelection.agent;
  const commitWriter = commitPreference === 'conversation' ? readOnlyChoice(conversationHelper)
    : runtimes[commitPreference.agent]?.supportsReadOnlyTasks === false ? undefined : effectiveGitChoice(commitPreference);
  const diagnosisAgent = readOnlyChoice(defaultSelection.agent);
  const conflictWriter = conflictPreference === 'conversation' ? conversationHelper : effectiveGitChoice(conflictPreference);
  const remember = (change: Partial<{ effort: string; serviceTier: string }>) => {
    saveModelPreferences(agentChoice, agent.model, { ...pref, ...change });
  };
  // One choice in the picker sets both the agent and its model.
  const chooseModel = (id: AgentId, model: string) => {
    setAgentChoice(id); browserStorage.setItem('papilot:agent', id);
    setAgentModels(current => ({ ...current, [id]: model })); browserStorage.setItem(`papilot:model:${id}`, model);
  };
  const agentOptions = (disabled: boolean) => <AgentPicker refreshUsage={refreshUsage} disabled={disabled} noAgent={missingAgent} agent={agentChoice} model={agent.model} effort={agent.effort} serviceTier={agent.serviceTier}
    agents={offered.map(id => ({ value: id, label: agentLabel(id), runtime: runtimes[id] }))}
    permissionMode={newSkill?.output !== 'annotations' ? effectivePermissions : undefined}
    permissions={newSkill?.output !== 'annotations' && <PermissionOptions runtime={runtimes[agentChoice]} value={effectivePermissions} disabled={disabled} onChange={value => savePermissionPreference(agentChoice, value)}/>}
    reconnecting={pendingActions.has('/reconnect')} onReconnect={() => void action('/reconnect')} onSelect={chooseModel} onChange={remember}/>;
  async function openPreparedTask(preset?: string, annotations?: string[]) {
    if (creating) return;
    setCreating(true); setCreateError('');
    try {
      const created = await api<Task>('/playground/tasks', { preset, annotations });
      timelineCache.current.delete(created.id); timelineRevisions.current.delete(created.id);
      await refresh(true);
      setTaskSearch(''); setShowArchived(false); setSelected(created.id); setPage('manuscript');
      setMobileTab(created.status === 'reviewing' ? 'review' : 'conversation'); setLayout('split'); setSidebar(false);
    } catch (e) { if (!(e instanceof Error && e.name === 'PlaygroundDownloadRequired')) setCreateError(e instanceof Error ? e.message : String(e)); }
    finally { setCreating(false); }
  }
  async function createTask() {
    if (missingAgent) return;
    const text = newDraft.trim(), target = project?.id || projectId, skill = newSkill;
    const reviewing = skill?.output === 'annotations';
    const attached = reviewing ? [] : noteSelection.selected, files = reviewing ? [] : newFiles.draft.getSnapshot().files;
    const groupInstructions = groupDrafts.forNotes(attached);
    if ((!text && !skill && !files.length && !attached.some(actionable) && !Object.keys(groupInstructions).length) || (!text && !skill && groupsWithoutInstructions(attached, groupInstructions).length > 0) || (!reviewing && newFiles.draft.getSnapshot().blocked) || creating || marking || noteEditing || reviewNoteBusy || history.busy || !target) return;
    if (isPlayground) {
      if (!text && !skill && !files.length && !Object.keys(groupInstructions).length && attached.length) await openPreparedTask(undefined, attached.map(note => note.id));
      else requestPlaygroundDownload();
      return;
    }
    const input = newTaskInput.current, submittedNotes = new Set(attached.map(note => note.id));
    const restoreFocus = input?.closest('form')?.contains(document.activeElement);
    setCreating(true); setCreateError('');
    try {
      // The ID is kept until creation succeeds, so a retried request cannot create a second task.
      const title = skill ? (text ? `${skillName(skill)}: ${taskTitle(text)}` : skillName(skill)).slice(0, 120) : text ? taskTitle(text) : attached.length === 1 ? taskTitle(attached[0].comment || (attached[0].group && groupInstructions[canonicalGroup(attached[0].group)]) || '') : attached.length ? t('Address {n} PDF notes', { n: attached.length }) : files[0].name.slice(0, 120);
      const body = { projectId: target, title, instructions: text, ...(skill ? { skill: skill.id } : {}), ...(attached.length ? { annotations: [...submittedNotes] } : {}), ...(Object.keys(groupInstructions).length ? { groupInstructions } : {}), ...(files.length ? { attachments: files.map(file => file.id) } : {}), agent: agent.agent, model: agent.model, effort: agent.effort, serviceTier: agent.serviceTier, permissions: reviewing ? 'workspace' : effectivePermissions };
      const id = requestId(browserStorage, 'papilot:new-task-request', JSON.stringify([target, text, skill?.id || '', [...submittedNotes], groupInstructions, files.map(file => file.id)]), uuid);
      // The task answers at once and gets its manuscript copy in the background.
      const created = await api<Task>('/tasks', { ...body, id });
      const source = input?.getBoundingClientRect();
      browserStorage.removeItem('papilot:new-task-request');
      newFiles.draft.clear(files); setNewDraft(''); setNewSkill(null); setTaskSearch(''); setShowArchived(false);
      // Add the confirmed task without moving the author away from their draft.
      // Cancel older snapshots before inserting it, so they cannot erase the row.
      snapshotRequest.cancel();
      if (snapshotRef.current) {
        const next = { ...snapshotRef.current, tasks: [...snapshotRef.current.tasks.filter(task => task.id !== created.id), created] };
        snapshotRef.current = next; snapshotText.current = ''; setState(next);
      }
      setAddedTask(null);
      if (source?.width) setFlyingTask({ id: created.id, title: created.title, source });
      else setAddedTask({ id: created.id, title: created.title });
      ++manuscriptRequest.current;
      setManuscript(current => current.projectId === target && current.data ? { ...current, data: { ...current.data, annotations: (current.data.annotations || []).filter(note => !submittedNotes.has(note.id)), inFlightMarks: [...(current.data.inFlightMarks || []).filter(mark => !submittedNotes.has(mark.note.id)), ...attached.map(note => ({ note: { ...note, taskId: created.id }, taskId: created.id, title: created.title, status: created.status }))] } } : current);
      if (!reviewing) { noteSelection.reset(target); taskCards.forget(); }
      groupDrafts.sent(target, attached, notes);
      setActiveNote(id => submittedNotes.has(id) ? '' : id);
      setNoteGroup(null);
      // A later Undo may restore a deleted annotation, but its inclusion belonged
      // to the submitted draft. It must not attach itself to the next task.
      for (const direction of ['undo', 'redo'] as const) history[direction] = history[direction]
        .filter(entry => keepAnnotationChange(entry, submittedNotes))
        .map(entry => reviewing ? entry : entry.kind === 'clear' ? { ...entry, selected: [] }
          : 'note' in entry && entry.note.projectId === target ? { ...entry, selected: false } : entry);
      historyChanged();
      if (restoreFocus && input?.isConnected && (document.activeElement === document.body || input.closest('form')?.contains(document.activeElement))) input.focus({ preventScroll: true });
      // Reload pending notes from the server: a retry may have returned an
      // earlier successful task, while newer notes still belong to the draft.
      if (notes.length) void loadManuscript(target);
      await refresh(true);
    } catch (e) { setCreateError(e instanceof Error ? e.message : String(e)); } finally { setCreating(false); }
  }
  async function action(route: string, body: Record<string, unknown> = {}, refreshAfter = true) {
    const key = route.startsWith('/tasks/') ? route.split('/').slice(0, 3).join('/') : route;
    if (actionRequests.current.has(key)) return;
    actionRequests.current.add(key); setPendingActions(new Set(actionRequests.current));
    try {
      const result = await api<{ noteReturns?: Omit<NoteReturnReceipt, 'key'>[] } | null>(route, body);
      if (result?.noteReturns?.length && route.startsWith('/tasks/')) applyReviewReturns(route.split('/')[2], result.noteReturns);
      if (refreshAfter) await refresh(true);
      return true;
    } catch (e) { reportError(e); }
    finally { actionRequests.current.delete(key); setPendingActions(new Set(actionRequests.current)); }
  }
  const taskActionBusy = Boolean(task && pendingActions.has('/tasks/' + task.id));
  // A task whose result is already in the manuscript is deleted without asking.
  async function deleteSavedTask(target: Task) {
    if (await action('/tasks/' + target.id + '/delete', { confirm: true }, false)) taskDeleted(target.id);
  }
  async function pinTask(target: Task, button?: HTMLButtonElement) {
    const taskRoute = '/tasks/' + target.id;
    if (actionRequests.current.has(taskRoute)) return;
    const pinned = !pinOrder.has(target.id);
    const trigger = button ?? sidebarRef.current?.querySelector<HTMLButtonElement>(`[data-task="${CSS.escape(target.id)}"] .more-button`) ?? null;
    const focus = { id: target.id, pinned, trigger };
    pinFocus.current = focus;
    if (!await action(taskRoute + '/pin', { pinned }) && pinFocus.current === focus) pinFocus.current = null;
  }
  async function archiveTask(target: Task) {
    const archived = !target.archivedAt;
    if (!await action('/tasks/' + target.id + '/archive', { archived }, false)) return;
    if (archived && selectedRef.current === target.id) { setProjectId(target.projectId); setSelected(''); }
    setShowArchived(false);
    await refresh(true);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.task-search input')?.focus());
  }
  const sidebarShown = narrow ? sidebar : sidebarVisible;
  function openBulkAction(action: BulkTaskAction['action']) {
    if (isPlayground) { requestPlaygroundDownload(); return; }
    if (!project || !listedTasks.length) return;
    setBulkTarget({ action, archived: showArchived, paper: project.name, tasks: [...listedTasks] });
  }
  function bulkTaskSucceeded(target: Task) {
    if (selectedRef.current === target.id) { setProjectId(target.projectId); setSelected(''); }
    if (bulkTarget?.action === 'delete') {
      browserStorage.removeItem('papilot:draft:' + target.id); composers.current.delete(target.id); timelineCache.current.delete(target.id);
    }
    snapshotText.current = '';
    setState(previous => previous ? bulkTarget?.action === 'archive'
      ? { ...previous, tasks: previous.tasks.map(task => task.id === target.id ? { ...task, archivedAt: Date.now() } : task) }
      : { ...previous, tasks: previous.tasks.filter(task => task.id !== target.id), pinnedTaskIds: previous.pinnedTaskIds?.filter(id => id !== target.id), requests: previous.requests.filter(request => request.taskId !== target.id) } : previous);
  }
  useLayoutEffect(() => {
    if (addedTask && sidebarShown) sidebarRef.current?.querySelector('.task-list')?.scrollTo({ top: 0 });
  }, [addedTask, sidebarShown]);
  function taskDeleted(id: string) {
    const removed = snapshotRef.current?.tasks.find(t => t.id === id); if (removed) setProjectId(removed.projectId);
    browserStorage.removeItem('papilot:draft:' + id); composers.current.delete(id); timelineCache.current.delete(id);
    setDeleteTarget(null);
    if (selectedRef.current === id) setSelected('');
    snapshotText.current = '';
    setState(previous => previous ? { ...previous, tasks: previous.tasks.filter(t => t.id !== id), pinnedTaskIds: previous.pinnedTaskIds?.filter(taskId => taskId !== id), requests: previous.requests.filter(r => r.taskId !== id) } : previous);
    void refresh(true);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(sidebarShown ? '.sidebar .manuscript-link' : '.main .sidebar-toggle')?.focus());
  }
  function hideSidebar() {
    if (narrow) { setSidebar(false); return; }
    setSidebarVisible(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.main .sidebar-toggle')?.focus());
  }

  async function rename(target: Task, value: string) {
    const title = value.trim().replace(/\s+/g, ' ').slice(0, 120);
    setRenaming('');
    if (!title || title === target.title) return;
    snapshotText.current = '';
    setState(previous => previous ? { ...previous, tasks: previous.tasks.map(t => t.id === target.id ? { ...t, title } : t) } : previous);
    try { await api('/tasks/' + target.id + '/rename', { title }); } catch (e) { reportError(e); }
    await refresh(true);
  }
  // The divider sets the chat width; CSS keeps both panels usable when the window narrows.
  function resizeChat(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget, grid = handle.parentElement!.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId); document.body.classList.add('resizing');
    const move = (e: PointerEvent) => setChatWidth(Math.round(Math.min(Math.max(grid.right - e.clientX, 300), grid.width - 360)));
    const stop = () => { document.body.classList.remove('resizing'); handle.removeEventListener('pointermove', move); handle.removeEventListener('lostpointercapture', stop); };
    handle.addEventListener('pointermove', move); handle.addEventListener('lostpointercapture', stop);
  }
  function nudgeChat(event: React.KeyboardEvent<HTMLDivElement>) {
    const current = event.currentTarget.parentElement!.querySelector<HTMLElement>('.activity-panel')?.offsetWidth || 400;
    const max = event.currentTarget.parentElement!.offsetWidth - 360;
    const next = event.key === 'ArrowLeft' ? current + 24 : event.key === 'ArrowRight' ? current - 24 : event.key === 'Home' ? max : event.key === 'End' ? 300 : null;
    if (event.key === 'Enter') { event.preventDefault(); setChatWidth(0); return; }
    if (next === null) return;
    event.preventDefault(); setChatWidth(Math.min(Math.max(next, 300), max));
  }
  // Older backends do not report this capability. A current backend always
  // supplies it; never restore a saved Git page when Git is missing there.
  const gitAvailable = Boolean(state) && state?.gitAvailable !== false;
  useEffect(() => { if (state?.gitAvailable === false) setPage(current => current === 'git' ? 'manuscript' : current); }, [state?.gitAvailable]);
  const manuscriptOpen = !task && Boolean(project) && (page === 'manuscript' || page === 'git' && !gitAvailable);
  useEffect(() => { if (!manuscriptOpen) setLibraryRequest(0); }, [manuscriptOpen]);
  const libraryOpen = !task && Boolean(project) && page === 'library';
  const gitOpen = !task && Boolean(project) && page === 'git' && gitAvailable;
  const switchContext = useRef({ project: project?.id, path: project?.path, task: task?.id, page });
  if (switchContext.current.project !== project?.id || switchContext.current.path !== project?.path || switchContext.current.task !== task?.id || switchContext.current.page !== page) {
    switchContext.current = { project: project?.id, path: project?.path, task: task?.id, page };
  }
  const switchRequest = useRef(0);
  async function switchWorkspace(id: string, openReview = false) {
    try {
      const request = ++switchRequest.current, context = switchContext.current;
      const returned = !id && project && lastReturned.current.get(project.id);
      if (!returned && id === (task?.id ?? (manuscriptOpen ? '' : null))) { setSidebar(false); return; }
      if (manuscriptNavigationGuard.current && !await manuscriptNavigationGuard.current.save()) return;
      // A later shortcut or mouse navigation supersedes a slow note save.
      if (request !== switchRequest.current || context !== switchContext.current) return;
      // Saving a note can take time; recheck the destination before navigating.
      if (id && !snapshotRef.current?.tasks.some(next => next.id === id && next.projectId === project?.id && next.status !== 'deleting' && (openReview || !next.archivedAt))) return;
      if (returned && project) {
        if (returned.document && returned.document !== manuscriptDocument(manuscriptData.data)) {
          await api(`/projects/${project.id}/document`, { annotation: returned.id });
          if (request !== switchRequest.current || context !== switchContext.current) return;
          await loadManuscript(project.id);
          if (request !== switchRequest.current || context !== switchContext.current) return;
        }
        if (lastReturned.current.get(project.id) === returned) lastReturned.current.delete(project.id);
        setReturnedPlace(returned.id); setActiveNote(returned.id); setManuscriptView('pdf');
      } else setReturnedPlace('');
      setSelected(id); setPage('manuscript'); setRegion(false); setSidebar(false); setTaskSearch('');
      if (!id && mobile) setManuscriptView('pdf');
      if (openReview) { setMobileTab('review'); setLayout(current => current === 'conversation' ? 'split' : current); }
    } catch (error) { reportError(error); }
  }
  async function openGit() {
    if (!gitAvailable) return;
    if (manuscriptNavigationGuard.current && !await manuscriptNavigationGuard.current.save()) return;
    if (snapshotRef.current?.gitAvailable === false) return;
    if (mobile && project) savePlace('git-view:' + project.id, 'changes');
    setSelected(''); setPage('git'); setRegion(false); setSidebar(false);
  }
  const loadManuscript = useCallback(async (projectId: string, rebuild = false) => {
    // A background read must not replace the result of an in-flight compile.
    if (manuscriptBuildRequests.current.has(projectId)) return;
    const request = ++manuscriptRequest.current;
    if (rebuild) { manuscriptBuildRequests.current.add(projectId); setPendingManuscriptBuilds(new Set(manuscriptBuildRequests.current)); }
    try {
      const data = await api<Manuscript>(`/projects/${projectId}/manuscript`, rebuild ? {} : undefined);
      if (request !== manuscriptRequest.current) return;
      setManuscript({ projectId, data, error: '' }); setGit({ projectId, status: data.git });
    } catch (e) { if (request === manuscriptRequest.current) setManuscript(current => ({ projectId, data: current.projectId === projectId ? current.data : null, error: e instanceof Error ? e.message : String(e) })); }
    finally { if (rebuild) { manuscriptBuildRequests.current.delete(projectId); setPendingManuscriptBuilds(new Set(manuscriptBuildRequests.current)); } }
  }, []);
  const needsManuscript = manuscriptOpen || Boolean(task && (task.mode !== 'review' || task.preparation));
  const manuscriptBuilding = manuscript.projectId === project?.id && manuscript.data?.build.status === 'building';
  useEffect(() => {
    if (!needsManuscript || !project) return;
    void loadManuscript(project.id);
    const focus = () => void loadManuscript(project.id);
    window.addEventListener('focus', focus);
    window.addEventListener('papilot:manuscript', focus);
    return () => { ++manuscriptRequest.current; window.removeEventListener('focus', focus); window.removeEventListener('papilot:manuscript', focus); };
  }, [needsManuscript, project?.id, project?.path, loadManuscript]);
  // Starting a compile switches to fast polling immediately, including a
  // manual retry made between the regular working-tree refreshes.
  useEffect(() => {
    if ((!manuscriptOpen && !manuscriptBuilding) || !needsManuscript || !project) return;
    // Papilot compiles after its own writes and tells the view; this notices
    // edits saved by another editor.
    const delay = manuscriptBuilding ? 1500 : 5000;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => { await loadManuscript(project.id); if (!stopped) timer = setTimeout(() => void tick(), delay); };
    timer = setTimeout(() => void tick(), delay);
    return () => { stopped = true; clearTimeout(timer); };
  }, [manuscriptOpen, needsManuscript, project?.id, manuscriptBuilding, loadManuscript]);
  // Accepting a change updates the working tree, so the status reloads with
  // the tasks' reviews as well as every 20 seconds.
  const reviewKey = (state?.tasks || []).filter(t => t.projectId === project?.id).map(t => `${t.review?.files?.join()}:${t.review?.counts?.accepted}`).join('|');
  useEffect(() => {
    if (!project || manuscriptOpen || !gitAvailable) return;
    let live = true;
    const load = () => void api<GitStatus>(`/projects/${project.id}/git`).then(status => { if (live) setGit({ projectId: project.id, status }); }).catch(() => undefined);
    load(); const timer = setInterval(load, gitOpen ? 5000 : 20000);
    window.addEventListener('focus', load);
    return () => { live = false; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [project?.id, project?.path, manuscriptOpen, gitOpen, gitAvailable, reviewKey]);
  // A skill chosen for one paper may not exist on another.
  useEffect(() => setNewSkill(null), [project?.id, project?.path]);
  // Skills come from Papilot, ~/.papilot/skills and the paper's .papilot/skills,
  // read again on return to the window so a new skill file appears.
  useEffect(() => {
    if (!project) return;
    let live = true;
    const load = () => void api<{ skills?: Skill[] }>(`/projects/${project.id}/skills`).then(result => {
      if (!live) return;
      const list = Array.isArray(result.skills) ? result.skills : [];
      setSkills({ projectId: project.id, list });
      setNewSkill(current => current ? list.find(skill => skill.id === current.id) || null : null);
    }, () => undefined);
    load(); window.addEventListener('focus', load);
    return () => { live = false; window.removeEventListener('focus', load); };
  }, [project?.id, project?.path, skillsRevision]);
  const projectGit = git.projectId === project?.id ? git.status : null;
  const mergeId = gitMergeId(projectGit), resolution = gitResolutions[commitContextKey];
  useEffect(() => {
    if (!projectGit || !resolution || resolution.busy || resolution.merge === mergeId) return;
    setGitResolutions(current => {
      if (current[commitContextKey] !== resolution) return current;
      const { [commitContextKey]: _, ...others } = current;
      return others;
    });
  }, [commitContextKey, mergeId, projectGit, resolution]);
  const overleafSync = state?.overleaf?.syncs.find(sync => sync.projectId === project?.id);
  // Coauthors' cursors come with each state read, and between reads with
  // the event stream when there is one.
  useEffect(() => { if (state?.overleaf) setPresence(Object.fromEntries(state.overleaf.syncs.map(sync => [sync.projectId, sync.cursors ?? []]))); }, [state?.overleaf]);
  const projectSkills = skills.projectId === project?.id ? skills.list : [];
  // "Fix with an agent…" fills the new-task composer; nothing starts until it is sent.
  function fixProblems(request: string) {
    const skill = projectSkills.find(item => item.id === 'latex-warnings');
    if (skill) setNewSkill(skill);
    setNewDraft(draft => draft.trim() ? `${draft.trimEnd()}\n\n${request}` : request);
    setTimeout(() => newTaskInput.current?.focus(), 0);
  }
  const updateGit = (projectId: string, status: GitStatus) => { setGit({ projectId, status }); setManuscript(current => current.projectId === projectId && current.data ? { ...current, data: { ...current.data, git: status } } : current); };
  const manuscriptData = manuscript.projectId === project?.id ? manuscript : { data: null, error: '' };
  const [openFile, setOpenFile] = useState<{ file: string; line?: number } | null>(null), [editingFile, setEditingFile] = useState<string | null>(null);
  function openRepositoryFile(file: string, line?: number) {
    setSelected(''); setPage('manuscript'); setSidebar(false); setOpenFile({ file, line });
  }
  async function compileDocument(file: string) {
    if (!project) return;
    try {
      const request = ++switchRequest.current, context = switchContext.current;
      if (manuscriptNavigationGuard.current && !await manuscriptNavigationGuard.current.save()) return;
      if (request !== switchRequest.current || context !== switchContext.current) return;
      await api(`/projects/${project.id}/document`, { main: file });
      if (request !== switchRequest.current || context !== switchContext.current) return;
      setSelected(''); setPage('manuscript'); setSidebar(false);
      window.dispatchEvent(new Event('papilot:manuscript'));
    } catch (error) { reportError(error); }
  }
  // The library reads the bibliography while it is open, again when
  // the working tree changes; the sidebar keeps its last count.
  const library = useLibrary(project?.id || '', JSON.stringify(projectGit?.files?.map(file => [file.path, file.lines]) || []), api, libraryOpen);
  const problems = problemCount(library.report);
  // An agent looks into the problems as a new task the author can edit first.
  const draftInvestigation = (text: string) => {
    setNewDraft(current => current.trim() ? current.trimEnd() + '\n\n' + text : text);
    setSelected(''); setPage('manuscript'); setManuscriptView('task'); setRegion(false);
  };
  // What the paper's checked citations and suggestions do: a quote opens the
  // cited work in the Library, a suggestion becomes a task draft or goes.
  const evidenceActions: EvidenceActions = {
    open: (target, evidence) => { setLibraryFocus({ entry: target.entry, hash: target.hash, evidence, at: Date.now() }); setSelected(''); setPage('library'); },
    cite: suggestion => draftInvestigation(citeRequest(suggestion)),
    dismiss: suggestion => { void library.dismissSuggestion(suggestion.id).then(() => window.dispatchEvent(new Event(EVIDENCE_CHANGED))); },
  };
  // A note being saved shows its new text everywhere at once, over the saved
  // notes, so the same note opened in another list starts from it. A failed
  // save just uncovers the saved text again.
  const [pendingComments, setPendingComments] = useState<Record<string, { comment: string; version: number }>>({});
  const savedNotes = manuscriptData.data?.annotations;
  const notes = useMemo(() => (savedNotes || []).map(note => pendingComments[note.id] ? { ...note, comment: pendingComments[note.id].comment } : note), [savedNotes, pendingComments]);
  const shownManuscript = useMemo(() => manuscriptData.data && { ...manuscriptData.data, annotations: notes }, [manuscriptData.data, notes]);

  const noteSelection = useNoteSelection(project?.id || '', notes);
  const groupDrafts = useGroupInstructions(project?.id || '');
  const groupDirections = groupDrafts.forNotes(noteSelection.selected);
  const missingGroupDirections = !newDraft.trim() && !newSkill && groupsWithoutInstructions(noteSelection.selected, groupDirections).length > 0;
  const withNotes = (update: (list: Annotation[]) => Annotation[], document?: string | null) => {
    // A poll started before this write must not put an old comment or a deleted note back.
    ++manuscriptRequest.current;
    setManuscript(current => current.projectId === project?.id && current.data && (document === undefined || manuscriptDocument(current.data) === document)
      ? { ...current, data: { ...current.data, annotations: update(current.data.annotations || []) } } : current);
  };
  async function writeNote(note: Annotation, edit: { comment: string } | { group: NoteGroup | null }) {
    const queue = noteWrites.current.get(note.id) || { saved: savedNotes?.find(item => item.id === note.id) || note, tail: Promise.resolve() };
    const write = queue.tail.then(async () => {
      const before = queue.saved;
      const saved = await api<Annotation>(`/projects/${note.projectId}/annotations/${note.id}`, edit);
      queue.saved = saved;
      if (annotationHistory.current !== history) return;
      withNotes(list => list.map(item => item.id === note.id ? saved : item));
      if ('group' in edit && before.group !== saved.group) recordAnnotation({ kind: 'group', note: before, group: saved.group ?? null });
      if ('comment' in edit && before.comment !== saved.comment) recordAnnotation({ kind: 'edit', note: before, comment: saved.comment });
    });
    // Later writes may proceed after a failure; this caller still receives it.
    const tail = write.catch(() => undefined);
    queue.tail = tail; noteWrites.current.set(note.id, queue);
    try { await write; }
    finally {
      if (noteWrites.current.get(note.id) === queue && queue.tail === tail) noteWrites.current.delete(note.id);
    }
  }
  async function writeGroups(id: string, edits: AnnotationGroupEdit[]) {
    const result = await api<{ annotations: Annotation[] }>(`/projects/${id}/annotations/regroup`, edits);
    if (annotationHistory.current === history) {
      const updated = new Map(result.annotations.map(note => [note.id, note]));
      withNotes(list => list.map(note => updated.get(note.id) ?? note));
    }
    return result;
  }
  const noteActions: NoteActions = {
    selection: { ...noteSelection, set(ids, checked) {
      // Every deselection entry point (PDF, library and task) waits for the
      // task draft to save. A failed save leaves it attached and recoverable.
      if (checked) noteSelection.set(ids, true);
      else void taskCards.saveAll(ids).then(saved => { if (saved) noteSelection.set(ids, false); });
    } },
    instructions: groupDrafts,
    group: noteGroup, setGroup: setNoteGroup,
    async add(page, rect, rects, quote, comment, group, options) {
      if (!project || !manuscriptData.data?.build.key) throw new Error(t('Wait for the PDF to compile.'));
      setMarking(value => value + 1);
      try {
        // The pages that were marked, which a newer pass may have replaced since.
        const kind = options?.kind, stamp = options?.stamp, key = options?.key || manuscriptData.data.build.key;
        const note = await api<Annotation>(`/projects/${project.id}/annotations`, { key, page, rect, ...(rects.length ? { rects, quote } : kind === 'point' ? { quote } : {}), comment, ...(group ? { group } : {}), ...(kind ? { kind } : {}), ...(stamp ? { stamp } : {}) });
        if (annotationHistory.current !== history) return;
        withNotes(list => [...list, note]);
        // A note made on earlier pages appears on the current ones once placed there.
        if (note.key !== manuscriptData.data.build.key) window.dispatchEvent(new Event('papilot:manuscript'));
        // Quick marks stay on the page without opening a card.
        const quick = Boolean(group || stamp || kind === 'delete');
        if (quick) setActiveNote(''); else if (options?.reveal !== false) setActiveNote(note.id);
        if (options?.quote) noteSelection.set([note.id], true);
        recordAnnotation({ kind: 'add', note });
      } finally { setMarking(value => value - 1); }
    },
    // Each queue retains the last successful server value, independently of
    // optimistic text. Failed writes must never become an Undo destination.
    async edit(note, comment) {
      const version = ++noteEditVersion.current;
      setPendingComments(current => ({ ...current, [note.id]: { comment, version } }));
      try { await writeNote(note, { comment }); }
      finally {
        setPendingComments(current => {
          if (current[note.id]?.version !== version) return current;
          const next = { ...current }; delete next[note.id]; return next;
        });
      }
    },
    regroup: (note, group) => writeNote(note, { group }),
    async regroupMany(members, group) {
      const source = members[0]?.group;
      if (!project || !source || (group && canonicalGroup(source) === canonicalGroup(group))) return;
      if (historyDisabled || history.busy || noteWrites.current.size) throw new Error(t('Wait for the annotations to finish saving.'));
      const target = group ? notes.filter(note => note.group && canonicalGroup(note.group) === canonicalGroup(group)) : [];
      const targetSelected = target.filter(note => noteSelection.has(note.id));
      const selectedMembers = members.filter(note => noteSelection.has(note.id));
      const direction = group ? target.length ? groupDrafts.get(group, targetSelected.length ? targetSelected : target) : groupDrafts.get(source, selectedMembers.length ? selectedMembers : members) : '';
      const before = members.map(annotationGroupState);
      history.busy = true; historyChanged();
      try {
        const result = await writeGroups(project.id, before.map((from, index) => ({
          id: from.id, createdAt: from.createdAt, from, group,
          groupInstruction: group ? direction.trim() || (!target.length ? members[index].groupInstruction : undefined) : undefined,
        })));
        if (annotationHistory.current !== history) return;
        const after = result.annotations.map(annotationGroupState);
        const merged = [...targetSelected, ...result.annotations.filter(note => noteSelection.has(note.id))];
        const draft = group && selectedMembers.length ? groupDrafts.regroup(group, direction, merged) : undefined;
        recordAnnotation({ kind: 'groups', before, after, draft });
      } finally { history.busy = false; historyChanged(); }
    },
    async remove(note) {
      const selected = noteSelection.has(note.id);
      await api(`/projects/${note.projectId}/annotations/${note.id}/delete`, {});
      if (annotationHistory.current !== history) return;
      noteSelection.set([note.id], false);
      withNotes(list => list.filter(item => item.id !== note.id));
      setActiveNote(id => id === note.id ? '' : id);
      recordAnnotation({ kind: 'remove', note, selected });
    },
    // The deletion toast shares history with the rail and keyboard shortcuts.
    async restore(note) {
      const restored = await api<{ annotations: Annotation[] }>(`/projects/${note.projectId}/annotations/${note.id}/restore`, {});
      if (annotationHistory.current !== history) return;
      const deletion = history.undo.filter(entry => entry.kind === 'remove' && entry.note.id === note.id).at(-1);
      history.undo = history.undo.filter(entry => !(entry.kind === 'remove' && entry.note.id === note.id));
      if (deletion) history.redo.push(deletion);
      historyChanged();
      withNotes(() => restored.annotations); setActiveNote(note.id);
      if (deletion && 'selected' in deletion && deletion.selected) noteSelection.set([note.id], true);
    },
    onEditing: setNoteEditing,
    onReviewBusy: setReviewNoteBusy,
    sending: creating || reviewNoteBusy || history.busy,
  };
  // Keep task editors alive across tabs, skills and paper switches. Undefined
  // notes mean the paper is still loading, so its drafts must not be pruned.
  const taskCards = useNoteCards(manuscriptData.data ? notes : undefined, noteActions, undefined, project?.id || projectId);
  const noteEditing = pdfNoteEditing || taskCards.editing || taskCards.busy;
  const batchDocument = manuscriptDocument(manuscriptData.data);
  const activeDocument = useRef(batchDocument);
  activeDocument.current = batchDocument;
  const historyDisabled = creating || Boolean(marking) || noteEditing || reviewNoteBusy || history.busy || noteWrites.current.size > 0;
  async function changeAnnotationBatch(target: AnnotationBatch, undo?: ClearedNotes) {
    if (!project || activeDocument.current !== target.document) throw new Error(t('The manuscript document changed. Open My notes again.'));
    if (historyDisabled || history.busy || noteWrites.current.size) throw new Error(t('Wait for the annotations to finish saving.'));
    history.busy = true;
    historyChanged();
    const selected = target.ids.filter(noteSelection.has);
    try {
      const result = await api<AnnotationBatchResult>(`/projects/${project.id}/annotations/${undo ? 'undo-clear' : 'clear'}`, target);
      if (annotationHistory.current !== history) return result;
      if (!undo && history.uncertain.get(target.document)?.batch === target.batch) history.uncertain.delete(target.document);
      const changed = new Set(result.changed);
      if (undo) {
        undo.target.ids = undo.target.ids.filter(id => !changed.has(id));
        if (!undo.target.ids.length) history.undo = history.undo.filter(entry => entry !== undo);
      } else if (changed.size) {
        const prev = history.undo.findLast((entry): entry is ClearedNotes => entry.kind === 'clear' && entry.target.batch === target.batch);
        if (prev) {
          prev.target.ids = [...new Set([...prev.target.ids, ...result.changed])];
          prev.selected = [...new Set([...prev.selected, ...selected.filter(id => changed.has(id))])];
        } else history.undo.push({ kind: 'clear', target: { ...target, ids: result.changed }, selected: selected.filter(id => changed.has(id)) });
        history.redo = [];
      }
      if (activeDocument.current !== target.document) return result;
      withNotes(() => result.annotations, target.document);
      if (undo) noteSelection.set(undo.selected.filter(id => result.restoredIds?.includes(id)), true);
      else {
        noteSelection.set(result.changed, false);
        setActiveNote(id => changed.has(id) ? '' : id);
      }
      window.dispatchEvent(new Event('papilot:manuscript'));
      return result;
    } catch (error) {
      if (!undo) history.uncertain.set(target.document, target);
      throw error;
    } finally {
      history.busy = false;
      historyChanged();
    }
  }
  const undoClear = (entry: ClearedNotes) => {
    void changeAnnotationBatch(entry.target, entry).then(result => {
      if (result.failed.length) reportError(new Error(result.failed.map(note => errorText(note.error)).join(' ')));
    }, reportError);
  };
  const cleared = history.undo.findLast((entry): entry is ClearedNotes => entry.kind === 'clear' && entry.target.document === batchDocument);
  const uncertain = history.uncertain.get(batchDocument);
  if (project) noteActions.batch = {
    document: batchDocument, name: project.name, disabled: historyDisabled, uncertain,
    clearedCount: cleared?.target.ids.length ?? 0,
    clear: target => changeAnnotationBatch(target),
    undo: () => { if (cleared) undoClear(cleared); },
  };
  const replayAnnotation = (direction: 'undo' | 'redo') => {
    const entry = history[direction].at(-1);
    if (!entry || (entry.kind !== 'return' ? !manuscriptOpen : !manuscriptOpen && entry.taskId !== task?.id)) return false;
    if (entry.kind === 'return' && !manuscriptOpen) {
      const actions = reviewUndoOrder.current.get(entry.taskId);
      if ((actions && [...actions.values()].some(time => time > entry.time)) || reviewDraft(entry.taskId).newestUndo() > entry.time) return false;
    }
    // The note panel can still be releasing focus after moving its rows.
    // Its group transaction has already unlocked the shared history.
    if (history.busy || creating || marking || reviewNoteBusy || noteWrites.current.size ||
        (noteEditing && entry.kind !== 'groups' && entry.kind !== 'return')) return true;
    if (entry.kind === 'clear') {
      if (direction !== 'undo' || entry.target.document !== batchDocument || uncertain) return false;
      undoClear(entry);
      return true;
    }
    history.busy = true; historyChanged();
    setError('');
    void (async () => {
      try {
        if (entry.kind === 'groups') {
          const [from, to] = direction === 'undo' ? [entry.after, entry.before] : [entry.before, entry.after];
          const byId = new Map(from.map(edit => [edit.id, edit]));
          await writeGroups(history.projectId, to.map(edit => ({ ...edit, from: byId.get(edit.id)! })));
          if (entry.draft && annotationHistory.current === history) groupDrafts.apply(entry.draft, direction);
        } else if (entry.kind === 'return') {
          const redo = direction === 'redo' ? { replay: entry.replay ??= uuid(), expected: entry.createdAt } : undefined;
          const result = await changeReturnedNote(entry.taskId, entry.original.note.id!, direction === 'undo' ? entry.createdAt : undefined, undefined, redo);
          if (result.returned !== (direction === 'redo') || (result.returned && result.undoReturnAt === undefined)) {
            // A newer generation or a submitted copy can no longer be undone.
            history[direction] = history[direction].filter(item => item !== entry);
            throw new Error('A selected PDF note is no longer available. Refresh the manuscript and try again.');
          }
          entry.createdAt = result.undoReturnAt ?? entry.createdAt;
          if (direction === 'redo') { entry.time = Date.now(); entry.replay = undefined; }
          window.dispatchEvent(new CustomEvent(NOTE_RETURN_HISTORY, { detail: { taskId: entry.taskId, receipt: { ...result, key: entry.original.key, moved: true } } }));
        } else {
          const { note } = entry;
          if (entry.kind === 'edit' || entry.kind === 'group') {
            const edit = entry.kind === 'edit' ? direction === 'undo' ? { comment: note.comment, ...(!note.comment && !note.group ? { group: null } : {}) } : { comment: entry.comment }
              : direction === 'undo' ? { group: note.group ?? null, groupInstruction: note.groupInstruction } : { group: entry.group };
            const saved = await api<Annotation>(`/projects/${note.projectId}/annotations/${note.id}`, edit);
            if (annotationHistory.current !== history) return;
            withNotes(list => list.map(item => item.id === note.id ? saved : item));
          } else if ((entry.kind === 'add') === (direction === 'undo')) {
            const selected = noteSelection.has(note.id);
            await api(`/projects/${note.projectId}/annotations/${note.id}/delete`, {});
            if (annotationHistory.current !== history) return;
            withNotes(list => list.filter(item => item.id !== note.id));
            entry.selected = selected; noteSelection.set([note.id], false); setActiveNote(id => id === note.id ? '' : id);
          } else {
            const restored = await api<{ annotations: Annotation[] }>(`/projects/${note.projectId}/annotations/${note.id}/restore`, {});
            if (annotationHistory.current !== history) return;
            withNotes(() => restored.annotations);
            if (entry.selected) noteSelection.set([note.id], true);
            if (entry.kind === 'remove') setActiveNote(note.id);
          }
        }
        if (annotationHistory.current !== history) return;
        history[direction] = history[direction].filter(item => item !== entry);
        history[direction === 'undo' ? 'redo' : 'undo'].push(entry);
      } catch (error) { reportError(error); }
      finally { history.busy = false; historyChanged(); }
    })();
    return true;
  };
  noteActions.history = {
    canUndo: !historyDisabled && history.undo.length > 0 && (history.undo.at(-1)?.kind !== 'clear' || (!uncertain && history.undo.at(-1) === cleared)),
    canRedo: Boolean(history.redo.length) && !historyDisabled,
    undo: () => { replayAnnotation('undo'); }, redo: () => { replayAnnotation('redo'); },
  };
  useNoteUndo(() => replayAnnotation('undo'), undefined, () => replayAnnotation('redo'));

  const waiting = state?.tasks.filter(t => t.status === 'waiting_input').length || 0;
  useEffect(() => { document.title = isPlayground ? 'Papilot Demo' : (waiting ? `(${waiting}) ` : '') + (task ? `${task.title} · Papilot` : gitOpen && project ? `${t('Version Management')} · ${project.name} · Papilot` : manuscriptOpen && project ? `${project.name} · Papilot` : 'Papilot'); }, [waiting, task?.title, manuscriptOpen, gitOpen, project?.name, uiLanguage]);
  const replyNeeded = Boolean(task && state?.requests.some(r => r.taskId === task.id));
  const pending = task?.review?.counts?.pending || 0;
  const localReview = useReviewDraft(task?.id || '');
  const hasReviewFeedback = Boolean(reviewSubmission(localReview).notes.length || pendingReviewFeedback(task?.review || null));
  // Notes and comments ask the agent for a revision, so saving waits for them.
  // Rejections are decisions: the rejected edits are simply left out, and
  // telling the agent about them stays optional.
  const asksRevision = Boolean(reviewSubmission(localReview).notes.length || (pendingReviewFeedback(task?.review || null) && (task?.review?.comments ?? task?.review?.counts?.commented ?? 0) > 0));
  const active = Boolean(task && ACTIVE.includes(task.status));
  const taskLayout = layout, taskTab = mobileTab;
  const conversationVisible = mobile ? taskTab === 'conversation' : taskLayout !== 'review';
  // On a computer, a change's source opens beside the conversation, in the
  // editor the manuscript uses, with the round's changes in the text and
  // Accept and Reject on each; the editor and the review follow each other.
  // A save there is reviewed like an edit in the review, which keeps its place.
  const [taskSide, setTaskSide] = useState<'chat' | 'source'>('chat');
  const taskReview = useRef<ReviewSources>(null);
  const [taskChanges, setTaskChanges] = useState<ReviewChanges | null>(null);
  useEffect(() => setTaskChanges(null), [task?.id]);
  // The viewer sees a new round first, and a reject that returned text.
  const taskVersion = `${task?.review?.round}:${taskChanges?.round}:${taskChanges?.changes.filter(change => change.confirmed === 'rejected').map(change => change.id).join(',')}`;
  const taskSource = useSourceEdit({ api, projectId: task?.projectId ?? '', taskId: task?.id, version: taskVersion,
    onTaskSaved: (next, file, line) => taskReview.current?.saved(next, file, line),
    onLine: (file, line) => taskReview.current?.select(file, line),
    review: { changes: taskChanges, decide: (changes, action) => { if (taskChanges) taskReview.current?.decide(taskChanges.round, changes, action); } } });
  useEffect(() => { if (!taskSource.editing) setTaskSide('chat'); }, [taskSource.editing]);
  // Phones and the static demo, which has no files to edit, keep the review's
  // own inline LaTeX.
  const openTaskSource = mobile || isPlayground ? undefined : (request: OpenSource) => {
    taskSource.reveal(request.file, request.lines, request.marks);
    setTaskSide('source');
    setLayout(current => current === 'review' ? 'split' : current);
    return true;
  };
  const taskSourceSide = taskSource.tab && taskSource.panel ? {
    selected: taskSide === 'source', panel: taskSource.panel,
    tabs: <div className="side-tabs panel-tabs" role="tablist" aria-label={t('Task panels')}>
      <button role="tab" aria-selected={taskSide === 'chat'} onClick={() => setTaskSide('chat')}><Icon name="chat" size={14}/><span className="tab-label">{t('Chat')}</span></button>
      <SourceTab tab={taskSource.tab} selected={taskSide === 'source'} onSelect={() => setTaskSide('source')} onClose={taskSource.close}/>
    </div>,
  } : undefined;
  const pause = () => { if (task) void action('/tasks/' + task.id + '/interrupt'); };
  // With only the chat in view, the feedback bar moves to the end of the conversation.
  const chatOnly = mobile ? taskTab === 'conversation' : taskLayout === 'conversation';
  const saved = task ? taskSaveStatus(task) : null;
  const savedResult = (message: string) => <TaskSaved message={message} disabled={taskActionBusy} onArchive={task && saved && !task.archivedAt && taskFinished(task) ? () => void archiveTask(task) : undefined}
    onDelete={task && saved && taskFinished(task) ? () => void deleteSavedTask(task) : undefined}/>;
  const merging = task?.reconciliation;
  const mergeWaiting = Boolean(merging && (!merging.ready || (task?.review?.round ?? 0) <= merging.round));
  const deliveryReady = !asksRevision && task?.deferred && (task.status === 'reviewing' || task.status === 'interrupted' && !mergeWaiting) && !task.pendingReview && task.review?.state === 'done' && !task.review.counts.pending
    && (Boolean(task.review.files?.length) || task.delivery?.mode === 'branch' || task.delivery?.pending || merging);
  const delivery = task?.delivery;
  const pendingDelivery = delivery?.pending && delivery.mode !== 'branch' ? delivery.mode : undefined;
  const preservedMessage = merging?.intent?.message;
  const applyKey = JSON.stringify([task?.id, delivery?.mode !== 'branch' && !delivery?.pending ? delivery?.accepted : null, preservedMessage ? merging?.id : null]);
  let applyEntry = task ? applyStates.current.get(task.id) : undefined;
  if (task && deliveryReady && (!applyEntry || (!pendingDelivery && applyEntry.key !== applyKey))) {
    applyEntry = { key: applyKey, draft: new TaskApplyState(preservedMessage || (isPlayground ? task.title : '')) };
    applyStates.current.set(task.id, applyEntry);
  }
  const saveTask = async (mode: 'workspace' | 'commit', message?: string, confirmation?: string) => {
    if (!task) return;
    // A queued merge suggestion resolves the saved choice when its agent starts.
    const result = await api<{ git?: GitStatus; commitReview?: TaskCommitReview }>(`/tasks/${task.id}/apply`, { mode, message, confirmation, keepCurrent: mergeWaiting && merging?.ready,
      ...(conflictPreference === 'conversation' ? {} : { conflictAgent: conflictPreference }) });
    if (result.git) updateGit(task.projectId, result.git);
    await refresh(true);
    return result;
  };
  const applicationStep = task && (deliveryReady && applyEntry ? <TaskApply key={applyEntry.key} draft={applyEntry.draft} merging={Boolean(merging)} keepCurrent={mergeWaiting && merging?.ready} disabled={taskActionBusy}
    branch={projectGit?.branch ?? null} canCommit={Boolean(task.review?.files?.length || task.delivery?.mode === 'branch' || task.delivery?.pending)} preferred={merging?.intent?.mode}
    pending={pendingDelivery} autoGenerate={!isPlayground && online}
    apply={() => saveTask('workspace')} commit={(message, confirmation) => saveTask('commit', message, confirmation)}
    agent={commitWriter && agentLabel(commitWriter.agent)} generate={commitWriter && (fresh => api<{ message: string }>(`/tasks/${task.id}/commit-message`, { ...commitWriter, fresh, language: commitMessageLanguage() }).then(result => result.message))}
    shown={isPlayground ? undefined : () => void api(`/tasks/${task.id}/predict`, {}).catch(() => undefined)}/>
    : merging ? <TaskConflict status={task.status} waiting={mergeWaiting} onChat={() => selectLayout('conversation')}/>
    : saved === 'committed' && task.delivery ? savedResult(t('Committed {hash} to {branch}', { hash: task.delivery.commit?.slice(0, 7) || '', branch: task.delivery.branch || '' }))
    : saved === 'applied' ? savedResult(t('Applied to manuscript')) : null);
  // What Papilot noticed in the author's reviews comes up beside saving, below the save step.
  const answered = task ? memoryAnswers.current.get(task.id) || memoryAnswers.current.set(task.id, new Set()).get(task.id)! : undefined;
  const memoryNudge = task && answered && shownSuggestions(task, answered).length ? <MemoryNudge key={task.id} task={task} answered={answered} api={api} onChange={() => void refresh(true)}/> : null;
  const completion = applicationStep || memoryNudge ? <>{applicationStep}{memoryNudge}</> : null;
  const reviewFeedback = (card: boolean) => task?.mode === 'review' ? (card && task.aiReview?.notes ? <button type="button" className="ai-review-link" onClick={() => { setMobileTab('review'); setLayout(current => current === 'conversation' ? 'split' : current); }}><Icon name="notes" size={14}/>{tn(task.aiReview.notes, 'View {n} review suggestion', 'View {n} review suggestions')}<Icon name="arrowRight" size={13}/></button> : null) : null;
  const sidebarToggle = (narrow || !sidebarVisible) && <button className="icon-button sidebar-toggle" aria-label={t('Show task list')} title={t('Show task list')} aria-expanded={sidebarShown} aria-controls="task-sidebar" onClick={() => narrow ? setSidebar(true) : setSidebarVisible(true)}><Icon name={narrow ? 'menu' : 'sidebar'} size={20}/>{addedTask && !sidebarShown && <span key={addedTask.id} className="task-added-dot" aria-hidden="true"/>}</button>;
  function selectLayout(next: typeof layout) {
    if (next === (mobile ? mobileTab : layout) && !layoutTransition.current) return;
    layoutTransition.current?.skipTransition();
    layoutTransition.current = null;
    const update = () => {
      flushSync(() => {
        if (!mobile) setLayout(next);
        if (next !== 'split') setMobileTab(next);
      });
      // Keep keyboard focus with the switcher as it moves between toolbars.
      // With a view transition this runs a frame or more after the click; if
      // the author has moved on, say into the composer, focus stays there.
      const focused = document.activeElement;
      if (!focused || focused === document.body || focused.closest('.workspace-view-selector')) document.querySelector<HTMLElement>('.workspace-view-selector [aria-pressed="true"]')?.focus({ preventScroll: true });
    };
    if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.classList.remove('switching-workspace');
      update();
      return;
    }
    document.documentElement.classList.add('switching-workspace');
    const transition = document.startViewTransition(() => {
      // A newer click wins even if the previous snapshot is still being taken.
      if (layoutTransition.current === transition) update();
    });
    layoutTransition.current = transition;
    const finish = () => {
      if (layoutTransition.current !== transition) return;
      layoutTransition.current = null;
      document.documentElement.classList.remove('switching-workspace');
    };
    // A skipped or timed-out animation can reject ready independently of
    // finished. Observe every promise; the layout update still takes effect.
    void transition.ready.catch(() => {});
    void transition.updateCallbackDone.catch(() => {});
    void transition.finished.then(finish, finish);
  }
  const taskStateActions = task && (
        <div className="task-state-actions">
          {task.status === 'deleting' ? <button className="button secondary compact" onClick={() => setDeleteTarget(task)}>{t('Retry deletion')}</button> : task.status === 'uncertain' ? <button className="button secondary compact" disabled={taskActionBusy} aria-busy={taskActionBusy} onClick={() => void action('/tasks/' + task.id + '/reconcile')}><Icon name="refresh" size={14}/>{t('Check status')}</button> : active && !conversationVisible ? <button className="button secondary compact" aria-label={t('Pause task')} title={t('Pause {agent}', { agent: agentName(task) })} disabled={taskActionBusy} aria-busy={taskActionBusy} onClick={pause}><Icon name="pause" size={14}/><span className="button-label">{t('Pause')}</span></button> : task.error && !conversationVisible ? <button className="button secondary compact" onClick={() => { setMobileTab('conversation'); setLayout(current => current === 'review' ? 'split' : current); }}>{t('View details')}</button> : null}
        </div>
  );
  const workspaceViews = task && <div className="view-selector workspace-view-selector" role="group" aria-label={t('Workspace view')}>{mobile ? <>
          <button aria-label={pending ? t('Review, {n} to decide', { n: pending }) : t('Review')} aria-pressed={mobileTab === 'review'} onClick={() => selectLayout('review')}><Icon name="paper" size={16}/><span>{t('Review')}</span>{pending > 0 && <b className="view-count" aria-hidden="true">{pending}</b>}</button>
          <button aria-label={replyNeeded ? t('Chat (reply needed)') : t('Chat')} aria-pressed={mobileTab === 'conversation'} onClick={() => selectLayout('conversation')}><Icon name="chat" size={16}/><span>{t('Chat')}</span>{replyNeeded && <i className="attention-dot" aria-hidden="true"/>}</button>
        </> : <>
          <button aria-label={t('Review')} title={t('PDF review only')} aria-pressed={layout === 'review'} onClick={() => selectLayout('review')}><Icon name="paper" size={16}/><span>{t('Review')}</span></button>
          <button aria-label={t('Split')} title={t('Review and chat side by side')} aria-pressed={layout === 'split'} onClick={() => selectLayout('split')}><Icon name="split" size={16}/><span>{t('Split')}</span></button>
          <button aria-label={replyNeeded ? t('Chat (reply needed)') : t('Chat')} title={noManuscriptChanges(task) ? t('This conversation has no manuscript changes.') : t('Chat only')} aria-pressed={layout === 'conversation'} onClick={() => selectLayout('conversation')}><Icon name="chat" size={16}/><span>{t('Chat')}</span>{replyNeeded && <i className="attention-dot" aria-hidden="true"/>}</button>
        </>}</div>;
  const totalNotes = project && state?.manuscriptNoteCounts ? state.manuscriptNoteCounts[project.id] ?? 0 : savedNotes?.length;
  const manuscriptCount = totalNotes !== undefined && <span className="manuscript-note-count" aria-hidden="true">{totalNotes}</span>;
  const countDescription = totalNotes === undefined ? undefined : tn(totalNotes, '{n} annotation', '{n} annotations');
  const manuscriptShortcut = !sidebarShown && <button data-notes-home="manuscript" type="button" className="manuscript-shortcut"
    aria-label={t('Manuscript')} aria-description={countDescription} onClick={() => void switchWorkspace('')}>
    <Icon name="pdf" size={16}/><span className="manuscript-shortcut-label">{t('Manuscript')}</span>{manuscriptCount}</button>;
  const taskControls = task && <>{taskStateActions}{manuscriptShortcut}{workspaceViews}</>;
  // Before the first comparison the task shows the manuscript PDF, so a turn
  // that stopped (for example on an agent error) builds one from the toolbar.
  // Without a manuscript PDF the placeholder offers it; answers need none.
  const firstComparison = task && !fullPdfUrl && !task.preparation && task.mode !== 'review' && Boolean(manuscriptData.data?.build.key)
    && ['idle', 'interrupted', 'failed', 'reviewing', 'building'].includes(task.status) && !noManuscriptChanges(task);
  const comparisonRetryBusy = Boolean(task && (['running', 'waiting_input', 'queued', 'building', 'uncertain', 'deleting'].includes(task.status) || taskActionBusy));
  const reviewTools = task && (fullPdfUrl || firstComparison) ? <>
    {fullPdfUrl && <a className="icon-button full-pdf-link" href={fullPdfUrl} target="_blank" rel="noreferrer" aria-label={t('Full PDF')} title={t('Open the full PDF')}><Icon name="pdf" size={16}/></a>}
    <CompileButton key={task.id} className="review-rebuild" label={fullPdfUrl ? t('Regenerate PDF comparison') : t('Generate PDF comparison')} status={task.status === 'building' ? 'building' : task.review?.job?.status === 'failed' || task.review?.state === 'build_failed' ? 'failed' : fullPdfUrl ? 'ready' : 'idle'} disabled={comparisonRetryBusy} onCompile={() => action('/tasks/' + task.id + '/publish')}/>
  </> : null;

  // Open or save the compiled PDF, or save it with the notes drawn on it.
  const pdfKey = manuscriptData.data?.build.key, hasNotes = Boolean(pdfKey && manuscriptData.data?.annotations.some(note => note.key === pdfKey));
  // i18n: menu button, shown as a share icon, for opening or exporting the compiled PDF
  const manuscriptShare = project && pdfKey && <ActionMenu label={t('Share')} className="icon-button" actions={[
    { label: t('Open PDF'), icon: 'external', href: pdfAsset(`/api/projects/${project.id}/manuscript.pdf?key=${pdfKey}`) },
    { label: t('Export PDF'), icon: 'download', href: pdfAsset(`/api/projects/${project.id}/manuscript.pdf?key=${pdfKey}&download=1`), download: true },
    { label: t('Export PDF with notes'), icon: 'notes', ...(isPlayground ? { select: requestPlaygroundDownload } : { href: `/api/projects/${project.id}/manuscript/annotated.pdf?key=${pdfKey}`, download: true }), disabled: !hasNotes, title: hasNotes ? undefined : t('No notes on this PDF yet') },
  ]}><Icon name="share" size={16}/></ActionMenu>;
  const manuscriptTools = project && <>
    <CompileButton key={project.id} label={t('Recompile PDF')} status={pendingManuscriptBuilds.has(project.id) ? 'building' : manuscriptData.error ? 'unknown' : manuscriptData.data?.build.status || 'unknown'} disabled={!manuscriptData.data && !manuscriptData.error} onCompile={async () => isPlayground ? requestPlaygroundDownload() : loadManuscript(project.id, true)}/>
  </>;
  const manuscriptNavigation = manuscriptOpen && project && <>
    <div className="view-selector manuscript-view-selector" role="group" aria-label={t('Manuscript view')}>
          <button aria-label="PDF" data-notes-home="pdf" aria-pressed={manuscriptView === 'pdf'} onClick={() => setManuscriptView('pdf')}><Icon name="pdf" size={16}/><span>PDF</span></button>
          <button aria-label={t('New task')} data-task-home aria-pressed={manuscriptView === 'task'} onClick={() => { setManuscriptView('task'); setRegion(false); }}><Icon name="compose" size={16}/><span>{t('New task')}</span>{noteSelection.selected.length > 0 && <b className="view-count" aria-hidden="true">{noteSelection.selected.length}</b>}</button>
        </div>
    {manuscriptView === 'pdf' && <div className="workspace-nav-end">{manuscriptTools}{manuscriptShare}</div>}
  </>;
  const overleafEntry = !isPlayground && gitAvailable && <button type="button" className="button secondary" onClick={syncOverleaf}><BrandIcon name="overleaf" size={16}/>{overleafSync ? t('Overleaf sync…') : t('Sync with Overleaf')}</button>;
  const newTaskPanel = (attachments: React.ReactNode) => <section className={'new-task-panel' + (noteSelection.selected.length ? ' has-notes' : '')} aria-label={t('New task')}>
    <div className="new-task-start">
    {!noteSelection.selected.length && <div className="new-task-welcome"><PapilotMark size={44}/><h2>{t('What are we revising next?')}</h2></div>}
    {newSkill?.output !== 'annotations' && attachments}
    {missingAgent && <NoAgentNotice message={missingReadOnlyAgent ? errorText(noReadOnlyAgent) : undefined} reconnecting={pendingActions.has('/reconnect')} onReconnect={() => void action('/reconnect')} onAdd={() => setSettings('agents')}/>}
    {suggestWriter && <WriterSuggestion ready={writerReady} onUse={() => { chooseModel('papilot', runtimes.papilot?.models.find(model => model.isDefault)?.id || ''); dismissWriter(); }} onSetUp={() => setSettings('agents')} onDismiss={dismissWriter}/>}
    <Composer attachments={newSkill?.output === 'annotations' ? undefined : newFiles.draft} upload={(file, signal) => uploadAttachment(project!.id, file, signal)} imageHint={agentChoice === 'antigravity' && newFiles.files.some(file => file.mime.startsWith('image/'))} autoFocus inputRef={newTaskInput} label={t('Describe the revision')} value={newDraft} onChange={setNewDraft} readOnly={creating} onSubmit={() => void createTask()} placeholder={noteSelection.selected.length ? t('Add overall instructions (optional)') : t('Describe the revision')}
      skills={projectSkills} skill={newSkill} onSkill={setNewSkill}
      footer={attach => <div className="composer-options">
        <SkillPicker onAttach={newSkill?.output === 'annotations' ? undefined : attach} skills={projectSkills} selected={newSkill} disabled={creating} onPick={skill => { setNewSkill(skill); newTaskInput.current?.focus(); }}/>
        {agentOptions(creating)}
      </div>}
      action={<button className="send-button" type="submit" aria-label={t('Start task')} title={missingGroupDirections ? t('Add instructions to the selected color groups above.') : t('Start task (Enter)')} disabled={missingAgent || creating || reviewNoteBusy || noteEditing || history.busy || (newSkill?.output !== 'annotations' && (newFiles.blocked || marking > 0 || missingGroupDirections)) || (!newDraft.trim() && !newSkill && !newFiles.files.length && !noteSelection.selected.some(actionable) && !Object.keys(groupDirections).length)} aria-busy={creating}>{creating ? <span className="spinner light"/> : <Icon name="arrowUp" size={18}/>}</button>}/>
    {createError && <p className="inline-error" role="alert">{createError}</p>}
    {PlaygroundPresets && <Suspense fallback={null}><PlaygroundPresets selected={noteSelection.selected} open={id => openPreparedTask(id)} disabled={creating}/></Suspense>}
    {runtimes[agentChoice]?.usage && <UsageSummary agent={agentLabel(agentChoice)} usage={runtimes[agentChoice]!.usage!}/>}
    </div>
  </section>;

  function forgetReturnedNote(taskId: string, removed: RemovedNoteReturn) {
    const { id, projectId, createdAt, originalId } = removed;
    if ((seenReturns.current.get(id) ?? -1) > createdAt) return false;
    seenReturns.current.set(id, createdAt);
    const last = lastReturned.current.get(projectId);
    if (last?.id === id && last.createdAt === createdAt) lastReturned.current.delete(projectId);
    reviewDraft(taskId).forgetReturn(originalId, createdAt);
    const loaded = latestManuscript.current;
    const displayed = loaded.projectId === projectId && loaded.data?.annotations.find(copy => copy.id === id);
    if ([last, displayed].some(copy => copy && copy.id === id && copy.createdAt > createdAt)) return false;
    if (annotationHistory.current === history && projectId === history.projectId) {
      // Discard history entries and draft selections for this return generation.
      noteSelection.set([id], false);
      const ids = new Set([id]);
      const keep = (entry: AnnotationChange) => entry.kind === 'return' || keepAnnotationChange(entry, ids);
      history.undo = history.undo.filter(keep);
      history.redo = history.redo.filter(keep);
      historyChanged();
      withNotes(list => list.filter(note => note.id !== id || note.createdAt !== createdAt));
      setActiveNote(current => current === id ? '' : current);
    }
    return true;
  }
  function applyReviewReturns(taskId: string, receipts: (Omit<NoteReturnReceipt, 'key'>)[]) {
    const affected = new Set<string>();
    for (const { annotation, removed } of receipts) {
      if (annotation && rememberReturn(annotation)) affected.add(annotation.id);
      if (removed && forgetReturnedNote(taskId, removed)) affected.add(removed.id);
    }
    if (affected.size) window.dispatchEvent(new Event('papilot:manuscript'));
    return affected;
  }
  async function changeReturnedNote(id: string, note: string, undoReturnAt?: number, clicked?: NoteResult, redo?: { replay: string; expected: number }) {
    const route = `/tasks/${id}/notes/${encodeURIComponent(note)}`;
    let result: NoteReturnState | undefined;
    if (undoReturnAt === undefined) {
      const replay = clicked ? returnClicks.current.get(route) ?? uuid() : undefined;
      if (replay) returnClicks.current.set(route, replay);
      const input = { receipt: true, replay, ...redo };
      const save = () => api<Annotation & { moved?: boolean }>(route + '/return', input);
      const copy = await save().catch(error => {
        if (error instanceof TypeError && input.replay) return save();
        throw error;
      });
      if (replay) returnClicks.current.delete(route);
      if (redo && copy.moved === false) return { returned: false };
      result = copy.deletedAt === undefined ? { returned: true, undoReturnAt: copy.taskId ? undefined : copy.createdAt } : { returned: false };
      if (result.undoReturnAt !== undefined && rememberReturn(copy) && clicked && copy.moved !== false)
        recordAnnotation({ kind: 'return', taskId: id, original: clicked, copyId: copy.id, createdAt: copy.createdAt, time: Date.now() });
    } else {
      const { removed, ...state } = await api<NoteReturnState & { removed?: string }>(route + '/undo-return', { createdAt: undoReturnAt });
      if (removed && project && !forgetReturnedNote(id, {
        id: removed, projectId: project.id, originalId: note, createdAt: undoReturnAt,
      })) {
        const displayed = latestManuscript.current.data?.annotations.find(copy => copy.id === removed);
        const last = lastReturned.current.get(project.id);
        const newer = Math.max(seenReturns.current.get(removed) ?? -1, displayed?.createdAt ?? -1, last?.id === removed ? last.createdAt : -1);
        if (newer > undoReturnAt) result = { returned: true, undoReturnAt: newer };
      }
      if (removed && clicked && annotationHistory.current === history) {
        const keep = (entry: AnnotationChange) => entry.kind !== 'return' || entry.copyId !== removed || entry.createdAt !== undoReturnAt;
        history.undo = history.undo.filter(keep); history.redo = history.redo.filter(keep); historyChanged();
      }
      result ??= state;
    }
    void refresh(true);
    window.dispatchEvent(new Event('papilot:manuscript'));
    return result;
  }
  return <NoteResultsProvider reviewOperation={recordReviewOperation} replayReturn={direction => history[direction].at(-1)?.kind === 'return' && replayAnnotation(direction)} onDecisionReturns={receipts => {
    const fresh = task ? applyReviewReturns(task.id, receipts) : new Set<string>();
    if (fresh.size) void refresh(true);
    return fresh;
  }} task={task} items={task ? timeline.taskId === task.id ? timeline.items : timelineCache.current.get(task.id) || [] : []} read={id => api(`/tasks/${id}/note-results`)} returnRequest={isPlayground ? undefined : changeReturnedNote} optionsRequest={(id, key, body) => body ? api(`/tasks/${id}/note-options`, { key, ...body }) : api(`/tasks/${id}/note-options?key=${encodeURIComponent(key)}`)} previewRequest={(id, key, round, option, retry, version, background) => api(`/tasks/${id}/note-options/preview?key=${encodeURIComponent(key)}&round=${round}&option=${encodeURIComponent(option)}${retry ? '&retry=1' : ''}${background ? '&background=1' : ''}${version ? '&comparison=' + encodeURIComponent(version) : ''}`, undefined, undefined, undefined, background ? 'low' : 'auto')} openReview={() => { setMobileTab('review'); setLayout(current => current === 'conversation' ? 'split' : current); }} openChat={() => { setMobileTab('conversation'); setLayout(current => current === 'review' ? 'split' : current); }}><div className={'app-shell' + (sidebarVisible ? '' : ' sidebar-collapsed')}>
    <DesktopWindowChrome/>
    {project && <WorkspaceSwitcher key={project.id} active={task?.id ?? (manuscriptOpen ? '' : null)}
      items={[{ id: '', title: t('Manuscript') }, ...[...tasks].reverse().filter(item => item.status !== 'deleting' && (!item.archivedAt || item.id === task?.id)).map(item => ({ id: item.id, title: item.title }))]}
      onSelect={id => void switchWorkspace(id)}/>}
    <aside ref={sidebarRef} role={narrow && sidebar ? 'dialog' : undefined} aria-modal={narrow && sidebar ? true : undefined} onKeyDown={e => { if (!narrow || !sidebar || modal || editingPaper) return; if (e.key === 'Escape') { e.preventDefault(); setSidebar(false); } else keepDialogFocus(e); }} id="task-sidebar" className={'sidebar ' + (sidebar ? 'is-open' : '')} aria-label={t('Papers and tasks')}>
      <div className="sidebar-header">
        {state?.host?.homeUrl && <a href={state.host.homeUrl} className="icon-button host-home-link" aria-label={t('All projects')} title={t('All projects')}><Icon name="arrowLeft" size={16}/></a>}
        {state?.projects.length && project ? state.singlePaper ? <button type="button" className="project-switcher single-paper-title" title={project.name} aria-label={t('Edit {name}', { name: project.name })} onClick={() => setEditingPaper(project)}><span className="project-switcher-name">{project.name}</span></button>
          : <ActionMenu label={t('Paper: {name}', { name: project.name })} className="project-switcher" menuClassName="paper-menu" align="start" actions={[
            ...state.projects.map(p => ({ id: p.id, label: p.name, detail: shortPath(p.path), title: p.path, checked: p.id === project.id, select: p.id === project.id ? undefined : () => { setProjectId(p.id); setSelected(''); }, edit: { label: t('Edit {name}', { name: p.name }), select: () => setEditingPaper(p) } })),
            { label: t('New paper…'), icon: 'plus', divider: true, select: createProject },
            { label: t('Import or open'), icon: 'download', select: importProject },
            ...(!isPlayground && gitAvailable ? [{ label: overleafSync ? t('Overleaf sync…') : t('Sync with Overleaf…'), icon: <BrandIcon name="overleaf" size={16}/>, divider: true, select: () => setOverleafOpen(true) }] : []),
          ]}><span className="project-switcher-name">{project.name}</span><Icon name="chevronDown" size={13}/></ActionMenu>
          : !state?.singlePaper && <button className="add-project" disabled={!state} onClick={importProject}><Icon name="download" size={16}/>{t('Import or open')}</button>}
        <button className="icon-button" aria-label={t('Hide task list')} title={t('Hide task list')} onClick={hideSidebar}><Icon name={narrow ? 'close' : 'sidebar'} size={18}/></button>
      </div>
      <div className="sidebar-actions">
        {project && <>
          <div className="manuscript-row"><button data-notes-home="manuscript" aria-label={t('Manuscript')} aria-description={countDescription} className={'nav-link manuscript-link' + (manuscriptOpen ? ' active' : '')} aria-current={manuscriptOpen ? 'page' : undefined} title={t('Switch tasks and manuscript') + ' (' + workspaceShortcutLabel + ')'} aria-keyshortcuts={workspaceModifier + '+`'} onClick={() => void switchWorkspace('')}><Icon name="pdf" size={16}/><span className="nav-label">{t('Manuscript')}</span>{manuscriptCount}</button>{!isPlayground && gitAvailable && <RepositoryFilesMenu key={project.id} api={api} projectId={project.id} version={`${manuscriptData.data?.build?.tree}:${manuscriptData.data?.build?.document}`} shownDocument={manuscriptData.data?.build?.document} editing={manuscriptOpen ? editingFile : null} onOpen={openRepositoryFile} onCompile={compileDocument}/>}</div>
          <button className={'nav-link git-link' + (gitOpen ? ' active' : '')} disabled={!gitAvailable} aria-describedby={!gitAvailable ? 'git-install-hint' : undefined} aria-label={gitAvailable && projectGit?.files?.length ? t('Version Management, {n} changed', { n: projectGit.files.length }) : t('Version Management')} aria-current={gitOpen ? 'page' : undefined} title={gitAvailable ? t('Version management of the manuscript') + '\n' + gitSummary(projectGit) : t('Install Git in this environment to use version management.')} onClick={openGit}><Icon name="restore" size={16}/><span className="nav-label">{t('Version Management')}</span><span className="nav-meta">{gitAvailable && projectGit?.files?.length ? <span className="count">{projectGit.files.length}</span> : null}</span></button>
          {overleafSync && <OverleafRow sync={overleafSync} onOpen={() => { setOverleafOpen(true); setSidebar(false); }}/>}
          {!gitAvailable && <p className="git-install-hint" id="git-install-hint"><a href="https://git-scm.com/install/" target="_blank" rel="noreferrer">{t('Install Git in this environment to use version management.')}</a></p>}
          <button className={'nav-link library-link' + (libraryOpen ? ' active' : '')} aria-current={libraryOpen ? 'page' : undefined} title={t('The PDFs of the works you cite')} onClick={() => { if (isPlayground) { requestPlaygroundDownload(); return; } setSelected(''); setPage('library'); setSidebar(false); }}><Icon name="library" size={16}/><span className="nav-label">{t('Library')}</span><span className="nav-meta">{problems ? <span className="count">{problems}</span> : null}</span></button>
        </>}
      </div>
      <div className="task-list-tools" role="group" aria-label={showArchived ? t('Archived tasks') : t('Tasks')}>
        <div className="task-search"><Icon name="search" size={14}/><input type="search" aria-label={t('Search tasks')} placeholder={showArchived ? t('Search archived tasks…') : t('Search tasks…')} title={t('Search task titles and instructions')} value={taskSearch} onChange={event => setTaskSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && taskSearch) { event.preventDefault(); event.stopPropagation(); setTaskSearch(''); } }}/>{taskSearch && <button type="button" className="icon-button" aria-label={t('Clear task search')} onClick={() => { setTaskSearch(''); document.querySelector<HTMLInputElement>('.task-search input')?.focus(); }}><Icon name="close" size={13}/></button>}</div>
        <button type="button" className="icon-button archive-toggle" aria-pressed={showArchived} aria-label={showArchived ? t('Show current tasks') : t('Show archived tasks')} title={showArchived ? t('Show current tasks') : t('Show archived tasks')} onClick={() => setShowArchived(value => !value)}><Icon name="archive" size={15}/></button>
        <ActionMenu label={t('Task list actions')} disabled={!listedTasks.length || !online} actions={[
          ...(!showArchived ? [{ label: t('Archive all tasks…'), icon: 'archive', select: () => openBulkAction('archive') }] : []),
          { label: showArchived ? t('Delete all archived tasks…') : t('Delete all current tasks…'), icon: 'trash', danger: true, select: () => openBulkAction('delete') },
        ]}/>
      </div>
      <nav className="task-list" aria-label={t('Task list')}>{visibleTasks.length ? visibleTasks.map(row => {
        const canPin = !isPlayground && !row.archivedAt && row.status !== 'deleting';
        const pinned = pinOrder.has(row.id);
        const pinDisabled = !online || pendingActions.has('/tasks/' + row.id);
        const pinLabel = pinned ? t('Unpin task') : t('Pin task');
        return <div key={row.id} data-task={row.id} className={'task-row ' + (row.id === selected ? 'active' : '') + (row.id === flyingTask?.id ? ' task-arriving' : '') + (row.id === addedTask?.id ? ' task-added' : '')}>
          {renaming === row.id ? <form className="task-rename" onSubmit={e => { e.preventDefault(); refocus.current = row.id; e.currentTarget.querySelector('input')?.blur(); }}>
            <input name="title" aria-label={t('Rename {name}', { name: row.title })} defaultValue={row.title} maxLength={120} autoFocus onFocus={e => e.currentTarget.select()} onBlur={e => void rename(row, e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); refocus.current = row.id; e.currentTarget.value = row.title; e.currentTarget.blur(); } }}/>
          </form>
          : <button aria-current={row.id === selected ? 'page' : undefined} className={'task-link ' + (row.id === selected ? 'active' : '')} onClick={() => { setSelected(row.id); setSidebar(false); }} onDoubleClick={() => { if (row.status !== 'deleting') setRenaming(row.id); }}><span className="task-title" id={'task-title-' + row.id} title={row.title}>{row.title}</span><span className="task-meta"><Status task={row}/><span className="task-time">{ago(row.updatedAt)}</span></span></button>}
          {canPin && <button type="button" className="icon-button task-pin"
            aria-label={t('Pin task')} aria-describedby={renaming === row.id ? undefined : 'task-title-' + row.id}
            aria-pressed={pinned} aria-disabled={pinDisabled}
            title={pinLabel}
            onClick={event => { if (!pinDisabled) void pinTask(row, event.currentTarget); }}><Icon name="pin"/></button>}
          <div className="task-row-actions">
            {row.review?.counts?.pending ? <span className="task-badge" title={tn(row.review.counts.pending, '{n} change to decide', '{n} changes to decide')}>{row.review.counts.pending}</span> : null}
            <ActionMenu label={t('Task actions for {title}', { title: row.title })} actions={[
              ...(row.status === 'deleting' ? [] : [{ label: t('Rename…'), icon: 'pencil', select: () => setRenaming(row.id) }]),
              ...(row.status === 'deleting' ? [] : [{ label: row.titleGeneration === 'pending' ? t('Generating task title…') : row.titleGeneration === 'failed' ? t('Retry title generation') : t('Generate task title'), icon: 'spark', disabled: row.titleGeneration === 'pending' || pendingActions.has('/tasks/' + row.id), select: () => void action('/tasks/' + row.id + '/title') }]),
              ...(canPin ? [{ label: pinLabel, icon: pinned ? 'unpin' : 'pin', disabled: pinDisabled, select: () => void pinTask(row) }] : []),
              ...(row.status === 'deleting' ? [] : [{ label: row.archivedAt ? t('Restore task') : t('Archive task'), icon: row.archivedAt ? 'restore' : 'archive', disabled: pendingActions.has('/tasks/' + row.id), select: () => void archiveTask(row) }]),
              ...(ACTIVE.includes(row.status) ? [{ label: t('Pause task'), icon: 'pause', disabled: pendingActions.has('/tasks/' + row.id), select: () => void action('/tasks/' + row.id + '/interrupt') }] : []),
              ...(row.status === 'uncertain' ? [{ label: t('Check status'), icon: 'refresh', disabled: pendingActions.has('/tasks/' + row.id), select: () => void action('/tasks/' + row.id + '/reconcile') }] : []),
              { label: row.status === 'deleting' ? t('Retry deletion…') : t('Delete task…'), icon: 'trash', danger: true, select: () => setDeleteTarget(row) },
            ]}/>
          </div>
        </div>;
      }) : <div className="task-list-empty" role="status">{searchTerms.length ? t('No matching tasks') : showArchived ? t('No archived tasks') : t('No tasks yet')}</div>}</nav>
      <div className="sidebar-footer">
        <div className="sidebar-status">
          {state && (!online || running > 0) && <div className={'host-status' + (online ? '' : ' reconnecting')} role="status" title={online ? t('Connected') : t('Reconnecting')}>
            <span className={'connection-dot' + (online ? ' connected' : '')} aria-hidden="true"/>
            <span className="host-state">{!online ? t('Reconnecting') : tn(running, '{n} active task', '{n} active tasks')}</span>
          </div>}
        </div>
        {state?.host && (state.host.user || state.host.accountUrl || state.host.billingUrl || state.host.logoutUrl)
          ? <HostAccountMenu host={state.host} onOpenSettings={openSettings}/>
          : <>
            <div className="brand">
              <a href="/" className="brand-home" aria-label="Papilot" onClick={e => { e.preventDefault(); setSelected(''); setPage('manuscript'); if (mobile) setManuscriptView('pdf'); setSidebar(false); }}><PapilotMark size={16} className="brand-mark"/><span>Papilot</span></a>
              {state && (!isPlayground ? <UpdateNotice api={api} version={state.version}/> : <span className="brand-version" title={t('Papilot {version}', { version: state.version })}>v{versionLabel(state.version)}</span>)}
            </div>
            <button type="button" className="icon-button settings-link" aria-label={t('Settings')} title={t('Settings')} aria-haspopup="dialog" onClick={openSettings}><Icon name="settings" size={18}/></button>
          </>}
      </div>
    </aside>
    {sidebar && narrow && <button tabIndex={-1} className="sidebar-scrim" aria-label={t('Close task list')} onClick={() => setSidebar(false)}/>}
    <main className="main" inert={narrow && sidebar}>
      <h1 className="sr-only">{task ? task.title : manuscriptOpen ? t('Manuscript') : libraryOpen ? t('Library') : gitOpen ? t('Version Management') : 'Papilot'}</h1>
      {flyingTask && <TaskFlight task={flyingTask} sidebarShown={sidebarShown} onArrive={taskArrived}/>}
      <span className="sr-only" role="status" aria-atomic="true">{addedTask ? t('Task added: {title}', { title: addedTask.title }) : ''}</span>
      {!gitOpen && (mobile || (!task && !manuscriptOpen)) && (sidebarToggle || task || manuscriptOpen) && <div className="workspace-navigation">
        {sidebarToggle}{taskControls}{manuscriptNavigation}
      </div>}
      {state && <RequirementsBanner state={requirements} onOpen={setSettings}/>}
      {state && !online && <div className="connection-banner" role="status"><Icon name="alert" size={15}/><span>{t('Connection lost. Showing the last update; your draft is kept.')}</span><button onClick={() => void refresh(true)}>{t('Retry connection')}</button></div>}
      {task?.mode === 'citations' ? <CitationCheckView key={task.id} task={task} load={api} agents={readOnlyAgents.map(id => ({ value: id, label: agentLabel(id), runtime: runtimes[id] }))} reconnect={async () => { await api('/reconnect', {}); await refresh(true); }} lead={!mobile ? sidebarToggle : null} onOpen={(target, evidence) => evidenceActions.open?.(target, evidence)} onCite={suggestion => draftInvestigation(citeRequest(suggestion))}/>
      : task ? <div className={`task-grid layout-${taskLayout} show-${taskTab}`} style={chatWidth ? { '--chat-width': `${chatWidth}px` } as React.CSSProperties : undefined}>
          {!mobile && taskLayout === 'split' && <div className="panel-resizer" role="separator" aria-orientation="vertical" aria-label={t('Resize chat panel')} aria-valuenow={chatWidth || undefined} aria-valuemin={300} tabIndex={0} title={t('Drag to resize · Double-click to reset')} onPointerDown={resizeChat} onDoubleClick={() => setChatWidth(0)} onKeyDown={nudgeChat}/>}
          <section id="review-panel" className="review-panel" aria-label={t('PDF review')}>
          {!mobile && !chatOnly && task.status === 'deleting' && (sidebarToggle || !conversationVisible) && <div className="review-placeholder-toolbar">{sidebarToggle}{!conversationVisible && <>{manuscriptShortcut}{workspaceViews}</>}<div className="panel-tools">{!conversationVisible && taskStateActions}</div></div>}
          {(task.review?.state === 'build_failed' || task.status === 'failed' && task.review?.job?.status === 'failed') && <div className="review-build-error" role="status"><Icon name="alert" size={15}/><span>{t('Could not generate the PDF comparison.')}</span><button className="button secondary compact" disabled={taskActionBusy} onClick={() => void action('/tasks/' + task.id + '/publish')}>{t('Retry build')}</button></div>}
          {task.status === 'deleting' ? <div className="review-placeholder"><div className="placeholder-icon"><Icon name="trash" size={22}/></div><h2>{t('Deletion is in progress')}</h2><p>{t('This task is reserved until its worktree cleanup is confirmed. Use Retry deletion if the connection was interrupted.')}</p></div> : !task.preparation && task.mode === 'review' ? <AiReviewView key={task.id} task={task} api={api} onCopied={() => void loadManuscript(task.projectId)} lead={!mobile && !chatOnly && (sidebarToggle || !conversationVisible) ? <>{sidebarToggle}{!conversationVisible && <>{manuscriptShortcut}{workspaceViews}</>}</> : null} tools={!mobile && !conversationVisible ? taskStateActions : null}/> : <TaskDocument key={task.id} projectId={task.projectId} manuscript={manuscriptData.data} placeholder={task.preparation ? <PreparingTask task={task}/> : <PendingComparison task={task} busy={taskActionBusy} onBuild={() => void action('/tasks/' + task.id + '/publish')}/>} task={task} sources={taskReview} onOpenSource={openTaskSource} onRetryComparison={isPlayground ? undefined : () => void action('/tasks/' + task.id + '/publish')} retryBusy={comparisonRetryBusy} onChanges={next => setTaskChanges(current => JSON.stringify(current) === JSON.stringify(next) ? current : next)} onCurrentChange={change => { if (taskSource.editing && taskSide === 'source') void taskSource.follow(change, () => undefined); }} onDecided={() => void refresh(true)} lead={!mobile && !chatOnly && (sidebarToggle || !conversationVisible) ? <>{sidebarToggle}{!conversationVisible && <>{manuscriptShortcut}{workspaceViews}</>}</> : null} tools={<>{reviewTools}{!mobile && !conversationVisible && taskStateActions}</>} completion={chatOnly ? null : completion} onComment={() => { setMobileTab('conversation'); setTaskSide('chat'); setLayout(current => current === 'review' ? 'split' : current); }}/>}
        </section><Activity key={task.id} runtimes={runtimes} manualSettingsVersion={manualSettingsVersion} relatedTasks={state?.tasks.filter(other => other.id === task.restart?.taskId || other.restart?.taskId === task.id) || []} onOpenTask={id => { setSelected(id); setSidebar(false); }} source={taskSourceSide} onRevealQuote={() => { setMobileTab('review'); setLayout(current => current === 'conversation' ? 'split' : current); }} task={task} lead={!mobile && chatOnly ? sidebarToggle : null} tools={!mobile && conversationVisible ? taskControls : null} connection={<AgentConnectionNotice name={agentName(task)} runtime={runtimes[task.agent || 'codex']} reconnecting={pendingActions.has('/reconnect')} onReconnect={() => void action('/reconnect')}/>} runtime={runtimes[task.agent || 'codex']} reconnecting={pendingActions.has('/reconnect')} onReconnect={() => void action('/reconnect')} composer={composers.current.get(task.id)!} answerDrafts={answerDrafts.current} items={timeline.taskId === task.id ? timeline.items : timelineCache.current.get(task.id) || []} loading={timeline.taskId === task.id ? itemsLoading : !timelineCache.current.has(task.id)} loadError={timelineError.taskId === task.id ? timelineError.message : ''} retry={() => void refreshTimeline(task.id)} requests={taskRequests} refresh={() => void refresh(true)} errorActions={task.preparation && task.status === 'failed' ? <div className="task-error-actions">
            <button type="button" className="button secondary compact" disabled={taskActionBusy} aria-busy={taskActionBusy} onClick={() => void action('/tasks/' + task.id + '/prepare')}><Icon name="refresh" size={14}/>{t('Retry')}</button>
            <button type="button" className="button secondary compact" onClick={() => setDeleteTarget(task)}><Icon name="trash" size={14}/>{t('Delete task…')}</button>
          </div> : chatOnly && task.mode !== 'review' && ['failed', 'interrupted'].includes(task.status) ? <div className="task-error-actions">
            <button type="button" className="button secondary compact" disabled={taskActionBusy} aria-busy={taskActionBusy} onClick={() => void action('/tasks/' + task.id + '/publish')}><Icon name="diff" size={14}/>{task.review?.round ? t('Regenerate PDF comparison') : t('Generate PDF comparison')}</button>
          </div> : null} onTaskSaved={acceptSavedTask} reportError={reportError} pause={pause} pausing={taskActionBusy} skills={projectSkills} feedback={chatOnly ? <>{reviewFeedback(true)}{completion && <div className="review-feedback card commit-card task-delivery">{completion}</div>}</> : null} openReview={chatOnly ? () => { setMobileTab('review'); setLayout(current => current === 'conversation' ? 'split' : current); } : undefined}/></div>
      : manuscriptOpen && project ? <ManuscriptView evidenceActions={evidenceActions} evidenceFocus={evidenceFocus} onEvidenceShown={() => setEvidenceFocus(null)} showsChecks={Boolean(state?.tasks.some(item => item.projectId === project.id && item.mode === 'citations' && item.citationCheck?.show))} onOpenTask={id => void switchWorkspace(id, true)} returnedPlace={returnedPlace} onPlaceShown={id => setReturnedPlace(current => id === current ? '' : current)} notesRequest={libraryRequest} taskCards={taskCards} key={project.id + project.path} navigationGuard={manuscriptNavigationGuard} collapsed={manuscriptCollapsed} setCollapsed={setManuscriptCollapsed} navigation={!mobile ? sidebarToggle : null} project={project} data={shownManuscript} error={manuscriptData.error} view={manuscriptView} setView={setManuscriptView} region={region} setRegion={setRegion} active={activeNote} setActive={setActiveNote} actions={noteActions} newTask={newTaskPanel} tools={!mobile ? manuscriptTools : null} share={!mobile ? manuscriptShare : null} onFixProblems={fixProblems} diagnoseBuild={isPlayground || !diagnosisAgent ? undefined : failureId => api<BuildRepairResult>(`/projects/${project.id}/manuscript/repair`, { failureId, agent: diagnosisAgent.agent, model: diagnosisAgent.model })} onGit={status => updateGit(project.id, status)} writer={commitWriter} reportError={reportError} openFile={openFile} onOpened={() => setOpenFile(null)} onEditing={setEditingFile}/>
      : gitOpen && project ? <GitWorkspace key={project.id + project.path} projectId={project.id} navigation={sidebarToggle} git={projectGit} onStatus={status => updateGit(project.id, status)} resolver={conflictWriter} resolution={resolution?.busy || resolution?.merge === mergeId ? resolution : undefined} setResolution={value => setGitResolutions(resolutions => {
        if (value) return { ...resolutions, [commitContextKey]: value };
        const { [commitContextKey]: _, ...others } = resolutions;
        return others;
      })} onChangeResolver={() => setSettings('git-conflicts')} messageWriter={commitWriter} tasks={state?.tasks.filter(task => task.projectId === project.id) || []} onOpenTask={id => { setSelected(id); setSidebar(false); }}/>
      : libraryOpen && project ? <section className="library-page" aria-label={t('Library')}>
          <header className="library-page-head"><h2>{t('Library')}</h2><span>{project.name}</span></header>
          <LibraryPanel key={project.id} projectId={project.id} place={'library:' + project.id} data={library} onInvestigate={draftInvestigation} onCheck={isPlayground ? undefined : () => void startCheck().catch(reportError)} focus={libraryFocus} onFocused={() => setLibraryFocus(null)} onShowInPaper={use => { setEvidenceFocus({ id: use.sentenceId, at: Date.now() }); setSelected(''); setPage('manuscript'); }}/>
        </section>
      : !state ? <div className="home"><div className="home-inner"><div className="home-mark"><span className="spinner"/></div><h1>{t('Opening your workspace')}</h1><p className="home-copy" role="status">{connectionError || t('Connecting to your papers and tasks…')}</p>{connectionError && <button className="button secondary" onClick={() => void refresh(true)}>{t('Retry connection')}</button>}</div></div>
      : <div className="home"><div className="home-inner"><PapilotMark size={52} className="home-logo"/><h1>{t('Add your first paper')}</h1><div className="home-paper-actions"><button className="button primary" onClick={createProject}><Icon name="plus" size={16}/>{t('New paper')}</button><button className="button secondary" onClick={importProject}><Icon name="download" size={16}/>{t('Import or open')}</button></div>{overleafEntry && <div className="home-integrations">{overleafEntry}</div>}</div></div>}
    </main>
    {error && !modal && <div role="alert" className="toast"><Icon name="alert" size={16}/><span>{error}</span><button className="icon-button" aria-label={t('Dismiss error')} onClick={() => setError('')}><Icon name="close" size={14}/></button></div>}
    {settings && <SettingsDialog refreshUsage={refreshUsage} commitWriter={commitWriter} conflictWriter={conflictWriter} activity={loadActivity} memory={!isPlayground ? { project, api } : undefined} workflow={isPlayground || (state?.allowedAgents && !state.allowedAgents.includes('collaboration')) ? undefined : { enabled: runtimes.collaboration?.hidden === false, online, runtimes, load: () => api<CollaborationSettingsState>('/collaboration'), save: async change => { const result = await api<CollaborationSettingsState>('/collaboration', change); await refresh(true); return result; } }} chatgptPro={isPlayground || (state?.allowedAgents && !state.allowedAgents.includes('chatgpt')) ? undefined : { enabled: runtimes.chatgpt?.hidden === false, online, runtimes, load: () => api<ChatgptProSettingsState>('/chatgpt-pro'), save: async change => { const result = await api<ChatgptProSettingsState>('/chatgpt-pro', change); setManualSettingsVersion(value => value + 1); await refresh(true); return result; } }} requirements={isPlayground ? undefined : { state: requirements, online }} modelDefaults={{ agents: taskAgents.map(id => ({ value: id, label: agentLabel(id), runtime: runtimes[id] })), agent: defaultAgent, model: defaultSelection.chosen, effort: defaultSelection.agent.effort, onSelect: chooseModel, onEffort: effort => saveModelPreferences(defaultAgent, defaultSelection.agent.model, { ...defaultSelection.pref, effort }), ...(!isPlayground ? { quick: quickModelApi } : {}) }} updates={!isPlayground ? api : undefined} overleaf={!isPlayground ? { api, state: state?.overleaf } : undefined} zotero={!isPlayground ? zoteroApi : undefined} initialPage={settings} theme={theme.theme} onTheme={theme.setTheme} resolved={theme.resolved} appearance={theme.appearance} onAppearance={theme.setAppearance} onClose={() => setSettings(false)} diagnostics={!isPlayground ? { online, runtimes, allowedAgents: state?.allowedAgents, project, check: checkDiagnostics, latex: detectLatexInstallation, compiler: chooseCompiler, reconnect: async () => { await api('/reconnect', {}); await refresh(true); }, writer: (route: string, body?: unknown) => api('/writer' + route, body), agentSettings: async change => { await api('/agent-settings', change); await refresh(true); } } : undefined} skills={!isPlayground ? { project, api, onChanged: () => setSkillsRevision(value => value + 1) } : undefined}/>}
    {deleteTarget && <DeleteTaskDialog task={state?.tasks.find(t => t.id === deleteTarget.id) || deleteTarget} submit={() => api('/tasks/' + deleteTarget.id + '/delete', { confirm: true })} onClose={() => setDeleteTarget(null)} onDeleted={() => taskDeleted(deleteTarget.id)} refresh={() => void refresh(true)}/>}
    {bulkTarget && <BulkTaskDialog target={bulkTarget}
      submit={target => api('/tasks/' + target.id + '/' + bulkTarget.action, bulkTarget.action === 'archive' ? { archived: true } : { confirm: true })}
      onSuccess={bulkTaskSucceeded} refresh={() => void refresh(true)} onClose={() => { setShowArchived(bulkTarget.archived); setBulkTarget(null); }}/>}
    {overleafOpen && project && (overleafSync
      ? <OverleafPanel key={project.id} api={api} sync={overleafSync} overleaf={state?.overleaf} onClose={() => setOverleafOpen(false)} onOpenFile={openRepositoryFile}/>
      : <OverleafLinkDialog key={project.id} api={api} projectId={project.id} overleaf={state?.overleaf} onClose={() => setOverleafOpen(false)}/>)}
    {editingPaper && <PaperDialog key={editingPaper.id} paper={editingPaper} singlePaper={Boolean(state?.singlePaper)} onClose={() => setEditingPaper(null)} save={async form => {
      const paper = editingPaper, pathChanged = form.path !== paper.path;
      await api(`/projects/${paper.id}/${pathChanged ? 'path' : 'rename'}`, pathChanged ? form : { name: form.name });
      if (pathChanged) { ++manuscriptRequest.current; setManuscript({ projectId: '', data: null, error: '' }); setGit({ projectId: '', status: null }); }
      await refresh(true);
      if (pathChanged && project?.id === paper.id && manuscriptOpen) await loadManuscript(paper.id);
    }} remove={async () => {
      const paper = editingPaper;
      await api(`/projects/${paper.id}/remove`, {});
      if (task?.projectId === paper.id) setSelected('');
      snapshotText.current = '';
      setState(previous => previous ? { ...previous, projects: previous.projects.filter(p => p.id !== paper.id), tasks: previous.tasks.filter(t => t.projectId !== paper.id) } : previous);
      await refresh(true);
    }}/>}
    {mainChoice && <MainFileDialog key={mainChoice.path} name={mainChoice.name} candidates={mainChoice.candidates} open={main => openFolder(mainChoice.path, main)} onClose={() => setMainChoice(null)}/>}
    {openingFolder && !mainChoice && <div role="status" className="toast toast-status"><span className="spinner"/><span>{t('Reading paper files…')}</span></div>}
    {modal && <NewPaperDialog key={createPreset ? createPreset.id + '@' + createPreset.version : 'new'} initialTab={modal === 'create' ? 'blank' : 'import'} source={modal === 'overleaf' ? 'overleaf' : undefined} preset={createPreset ?? undefined} api={api} agent={agentChoice} canRepair={Object.values(runtimes).some(runtime => runtime?.connected && runtime.authenticated)} onChooseFolder={nativeFolders ? async () => { const path = await chooseDirectory(); if (path) await openFolder(path); } : undefined} onClose={() => { setModal(null); setCreatePreset(null); }} onDone={async paper => {
      setCreatePreset(null);
      await refresh(true);
      setProjectId(paper.id); setSelected(''); setPage('manuscript'); setManuscriptView('pdf'); setModal(null); setSidebar(false);
    }}/>}

  </div></NoteResultsProvider>;
}

function Root() {
  if (PlaygroundNotice) return <Suspense fallback={null}><div className="playground-root"><PlaygroundNotice/><App/></div></Suspense>;
  return <App/>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root/></StrictMode>);
