import { StrictMode, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { readNotesInstructions, type NoteSummary } from '../notes.ts';
import type { AgentId, AgentModel, Annotation, GitDiff, GitStatus, Manuscript, PendingRequest, Project, RuntimeStatus, Snapshot, Task, TimelineItem } from '../shared.ts';
import { ComposerDraft, sendsMessage, taskTitle } from './composer.ts';
import { ReadRequest, canStreamUpdates } from './refresh.ts';
import { browserStorage } from './storage.ts';
import { ReviewFrame } from './review-frame.tsx';
import { keepDialogFocus } from './focus.ts';
import { DeleteTaskDialog } from './task-dialog.tsx';
import { ActionMenu } from './action-menu.tsx';
import { Icon } from './icons.tsx';
import { Markdown } from './markdown.tsx';
import logo from './logo.svg';
import { ChipSelect } from './chip-select.tsx';
import { EffortPicker, effortName } from './effort-picker.tsx';
import { UsageSummary } from './usage.tsx';
import type { OutlineItem, PdfHandle, Rect } from './pdf-view.tsx';
// pdf.js is large, so the PDF view loads the first time it opens.
const PdfView = lazy(() => import('./pdf-view.tsx').then(module => ({ default: module.PdfView })));
import './style.css';

let token = '';
const uuid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(20)), b => b.toString(16).padStart(2, '0')).join('');
async function api<T = any>(route: string, body?: unknown, signal?: AbortSignal, wait = body === undefined ? 15000 : 30000): Promise<T> {
  const timeout = AbortSignal.timeout(wait);
  try { const response = await fetch('/api' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Papilot-Token': token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Request failed. Please try again.'); return value;
  }
  catch (error) {
    if (timeout.aborted) throw new Error(body === undefined ? 'The connection is taking too long. Check your network and try again.' : 'The request timed out and may still be processing. Check the task status before retrying.');
    throw error;
  }
}
const AGENT_IDS: AgentId[] = ['codex', 'claude', 'antigravity'];
const AGENT_LABELS: Record<AgentId, string> = { codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity' };
const agentName = (task: Task) => AGENT_LABELS[task.agent || 'codex'] || 'Codex';
const statusNames: Record<string, string> = { idle: 'Ready', queued: 'Queued', running: 'Codex is editing', waiting_input: 'Needs your reply', building: 'Building PDF review', reviewing: 'Ready for review', interrupted: 'Paused', failed: 'Needs attention', uncertain: 'Check task status', deleting: 'Deleting task' };
const ACTIVE = ['running', 'waiting_input', 'queued'];
function Status({ task }: { task: Task }) {
  const done = task.status === 'reviewing' && task.review?.state === 'done';
  return <span className={`status ${task.status}${done ? ' done' : ''}`}><i/>{done ? 'Review complete' : task.status === 'running' ? `${agentName(task)} is editing` : statusNames[task.status] || task.status}</span>;
}
function time(timestamp: number) { return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
function ago(timestamp: number) {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'now'; if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`; if (minutes < 10080) return `${Math.floor(minutes / 1440)}d`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const touch = () => window.matchMedia('(pointer: coarse)').matches;
function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query), change = () => setMatches(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, [query]);
  return matches;
}

// One composer for new tasks and follow-ups: grows with its text, sends on
// Enter (see sendsMessage), and keeps its actions inside the same surface.
function Composer({ label, value, placeholder, onChange, onSubmit, readOnly, autoFocus, inputRef, footer, action, large }: { label: string; value: string; placeholder: string; onChange: (value: string) => void; onSubmit: () => void; readOnly?: boolean; autoFocus?: boolean; inputRef?: React.RefObject<HTMLTextAreaElement | null>; footer: React.ReactNode; action: React.ReactNode; large?: boolean }) {
  const fallback = useRef<HTMLTextAreaElement>(null), input = inputRef || fallback;
  useLayoutEffect(() => { const element = input.current; if (!element) return; element.style.height = 'auto'; element.style.height = `${element.scrollHeight}px`; }, [input, value]);
  useEffect(() => { if (autoFocus && !touch()) input.current?.focus(); }, [autoFocus, input]);
  return <form className={'composer' + (large ? ' large' : '')} onSubmit={e => { e.preventDefault(); onSubmit(); }} onPointerDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); } }}>
    <textarea ref={input} rows={1} aria-label={label} maxLength={20000} placeholder={placeholder} value={value} readOnly={readOnly} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (sendsMessage(e.nativeEvent, touch())) { e.preventDefault(); onSubmit(); } }}/>
    <div className="composer-footer">{footer}{action}</div>
  </form>;
}

function RequestCard({ request, agent, answerDrafts, onDone }: { request: PendingRequest; agent: string; answerDrafts: Map<string, Record<string, string>>; onDone: () => void }) {
  const [answers, updateAnswers] = useState<Record<string, string>>(() => answerDrafts.get(request.id) || {});
  function setAnswers(next: Record<string, string>) { answerDrafts.set(request.id, next); updateAnswers(next); }
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const questions = request.method.endsWith('requestUserInput') ? request.params.questions || [] : [];
  async function respond(decision?: string) { setBusy(true); setError(''); try { await api('/requests/' + request.id, { decision, answers }); answerDrafts.delete(request.id); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <div className="request-card"><h3><Icon name={questions.length ? 'chat' : 'alert'} size={16}/>{questions.length ? `${agent} needs your input` : 'Approve this action'}</h3>
    {questions.map((q: any) => <fieldset className="question" key={q.id}><legend>{q.question || q.header}</legend>{q.options?.length > 0 && <div className="answer-options">{q.options.map((option: any) => <button type="button" disabled={busy} aria-pressed={answers[q.id] === option.label} className={answers[q.id] === option.label ? 'selected' : ''} key={option.label} onClick={() => setAnswers({ ...answers, [q.id]: option.label })}>{option.label}{option.description && <small>{option.description}</small>}</button>)}</div>}<input disabled={busy} aria-label={q.question || q.header} placeholder="Or type your own answer" value={answers[q.id] || ''} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })}/></fieldset>)}
    {!questions.length && <><p>{request.params.reason || `${agent} is requesting permission for this action.`}</p><pre>{request.params.command || (request.params.permissions ? JSON.stringify(request.params.permissions, null, 2) : request.params.grantRoot || 'Apply file changes')}</pre></>}
    {error && <p className="inline-error" role="alert">{error}</p>}<div className="button-row">{!questions.length && <button disabled={busy} className="button secondary" onClick={() => void respond('decline')}>Decline</button>}<button disabled={busy || questions.some((q: any) => !answers[q.id]?.trim())} className="button primary" onClick={() => void respond(questions.length ? undefined : 'accept')}>{busy ? 'Submitting…' : questions.length ? `Reply to ${agent}` : 'Allow this action'}</button></div>
  </div>;
}

// Clipboard access needs a secure context; Tailscale HTTP falls back to a hidden selection.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const area = document.createElement('textarea'); area.value = text; area.readOnly = true; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.append(area); area.select(); document.execCommand('copy'); area.remove();
    }
    setCopied(true);
  }
  return <button type="button" className="message-action" aria-label={copied ? 'Copied' : 'Copy message'} onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} size={14}/><span>{copied ? 'Copied' : 'Copy'}</span></button>;
}

// Commands arrive wrapped in the login shell that ran them, and files with
// absolute paths; the chat shows the command itself and paths in the task.
const shellCommand = (text: string) => text.match(/^\/bin\/(?:ba|z)?sh -lc (['"])([\s\S]*)\1$/)?.[2] ?? text;
const taskPath = (file: string, root: string) => root && file.startsWith(root + '/') ? file.slice(root.length + 1) : file;
const editedFiles = (item: TimelineItem, root: string) => item.text.split('\n').filter(Boolean).map(file => taskPath(file, root));
const toolState = (item: TimelineItem) => item.status === 'inProgress' ? 'running' : item.status && item.status !== 'completed' ? 'failed' : '';

// A first message built from PDF notes shows the notes, not the instructions around them.
function NotesMessage({ item, notes }: { item: TimelineItem; notes: NoteSummary[] }) {
  return <article className="message user notes-message" aria-label={`You, ${time(item.createdAt)}`}><div className="message-body" title={time(item.createdAt)}>
    <div className="sent-notes-head"><Icon name="notes" size={14}/>{notes.length === 1 ? 'Note on the PDF' : `${notes.length} notes on the PDF`}</div>
    <ol className="sent-notes">{notes.map((note, index) => <li key={index}>
      <span className="sent-note-where">{note.where}</span>
      {note.quote ? <blockquote>{note.quote}</blockquote> : <span className="sent-note-region">Marked region</span>}
      <p>{note.comment}</p>
    </li>)}</ol>
  </div></article>;
}

function TimelineEntry({ item, agent, root }: { item: TimelineItem; agent: string; root: string }) {
  if (item.type === 'user') {
    const notes = readNotesInstructions(item.text);
    if (notes) return <NotesMessage item={item} notes={notes}/>;
    return <article className="message user" aria-label={`You, ${time(item.createdAt)}`}><div className="message-body" title={time(item.createdAt)}>{item.text}</div></article>;
  }
  if (item.type === 'assistant') return <article className="message assistant" aria-label={`${agent}, ${time(item.createdAt)}`}><div className="message-body markdown"><Markdown text={item.text}/></div><div className="message-actions"><CopyButton text={item.text}/><time dateTime={new Date(item.createdAt).toISOString()}>{time(item.createdAt)}</time></div></article>;
  const files = item.type === 'files' ? editedFiles(item, root) : [];
  const label = item.type === 'command' ? shellCommand(item.text) || 'Run command' : item.type === 'files' ? (files.length === 1 ? `Edited ${files[0]}` : `Edited ${files.length} files`) : item.text || 'Run tool';
  const detail = item.type === 'files' ? files.join('\n') : item.detail;
  const state = toolState(item);
  return <details className={'tool-item ' + state}><summary><Icon name={item.type === 'command' ? 'terminal' : item.type === 'files' ? 'diff' : 'tool'} size={14}/><span className="tool-label">{label}</span>{state === 'running' ? <span className="spinner" aria-label="Running"/> : state && <span className="tool-status">{item.status === 'declined' ? 'Declined' : 'Failed'}</span>}</summary>{detail && <pre>{detail}</pre>}</details>;
}

// Consecutive commands, edits and tool calls fold into one line that opens to the list.
function ToolGroup({ items, agent, root }: { items: TimelineItem[]; agent: string; root: string }) {
  const commands = items.filter(item => item.type === 'command').length, edits = items.filter(item => item.type === 'files');
  const files = [...new Set(edits.flatMap(item => editedFiles(item, root)))], tools = items.length - commands - edits.length;
  const running = items.some(item => toolState(item) === 'running'), failed = items.filter(item => toolState(item) === 'failed').length;
  const parts = [commands ? `ran ${commands} ${commands === 1 ? 'command' : 'commands'}` : '', files.length ? (files.length === 1 ? `edited ${files[0]}` : `edited ${files.length} files`) : '', tools ? `used ${tools} ${tools === 1 ? 'tool' : 'tools'}` : ''].filter(Boolean).join(', ');
  return <details className="tool-group"><summary><Icon name={commands ? 'terminal' : files.length ? 'diff' : 'tool'} size={14}/><span className="tool-group-label">{parts[0].toUpperCase() + parts.slice(1)}</span>{running ? <span className="spinner" aria-label="Running"/> : failed ? <span className="tool-status">{failed} failed</span> : null}<Icon name="chevronDown" size={13}/></summary>
    <div className="tool-group-items">{items.map(item => <TimelineEntry key={item.id} item={item} agent={agent} root={root}/>)}</div>
  </details>;
}

function timelineEntries(items: TimelineItem[]) {
  const entries: TimelineItem[][] = [];
  for (const item of items) {
    const tool = item.type !== 'user' && item.type !== 'assistant', last = entries[entries.length - 1];
    if (tool && last && last[0].type !== 'user' && last[0].type !== 'assistant') last.push(item); else entries.push([item]);
  }
  return entries;
}

function Activity({ task, models, composer, answerDrafts, items, loading, loadError, retry, requests, refresh, reportError, pause, pausing, openReview }: { task: Task; models: AgentModel[]; composer: ComposerDraft; answerDrafts: Map<string, Record<string, string>>; items: TimelineItem[]; loading: boolean; loadError: string; retry: () => void; requests: PendingRequest[]; refresh: () => void; reportError: (e: unknown) => void; pause: () => void; pausing: boolean; openReview?: () => void }) {
  const { text: draft, sending, sendingSource } = useSyncExternalStore(composer.subscribe, composer.getSnapshot);
  const scroller = useRef<HTMLDivElement>(null);
  const shouldFollow = useRef(true);
  const [following, setFollowing] = useState(true);
  function latest() { shouldFollow.current = true; setFollowing(true); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }
  useEffect(() => { if (shouldFollow.current) latest(); }, [items, requests]);
  useEffect(() => {
    if (!scroller.current) return;
    const observer = new ResizeObserver(() => { if (shouldFollow.current) latest(); });
    observer.observe(scroller.current); return () => observer.disconnect();
  }, []);
  async function submit(source: 'draft' | 'feedback') {
    if (composer.sending || ['uncertain', 'deleting'].includes(task.status)) return;
    const pending = composer.submit(source, message => api('/tasks/' + task.id + '/messages', message));
    try { if (await pending) { shouldFollow.current = true; refresh(); } }
    catch (e) { reportError(e); }
  }
  const active = ACTIVE.includes(task.status), blocked = ['uncertain', 'deleting'].includes(task.status);
  const unsent = task.review?.unsent ?? task.review?.counts?.commented ?? 0;
  const hint = task.status === 'deleting' ? 'This task is being deleted' : task.status === 'uncertain' ? 'Check task status before sending' : sendingSource === 'feedback' ? 'Sending feedback…' : sending ? 'Sending…'
    : unsent ? `${unsent} review ${unsent === 1 ? 'comment' : 'comments'} will be sent with this message` : active ? `${agentName(task)} is working · new instructions run next` : touch() ? '' : 'Enter to send · Shift+Enter for a new line';
  // Name the model the next turn uses: the chosen one, or the host's current default.
  const model = models.find(m => m.id === task.model) || (task.model ? undefined : models.find(m => m.isDefault));
  const modelName = model?.name || task.model || 'Default model';
  return <section id="conversation-panel" className="activity-panel" aria-label={`${agentName(task)} conversation`}><div className="panel-heading"><span className="panel-title">Chat</span><span className="model-chip" title={`${agentName(task)} · ${task.model ? modelName : `the default model on this host${model ? ` (${model.name})` : ''}`}`}>{task.agent && task.agent !== 'codex' ? `${agentName(task)} · ` : ''}{modelName}{task.effort ? ` · ${effortName(task.effort)}` : ''}</span></div>
    <div className="conversation-history"><div className="messages" ref={scroller} onScroll={() => { if (scroller.current) { const el = scroller.current; shouldFollow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; setFollowing(shouldFollow.current); } }}><div className="thread">
      {loading && <p className="muted" role="status">Loading conversation…</p>}
      {loadError && <div className="conversation-error" role="alert"><p>{loadError}</p><button className="button secondary compact" onClick={retry}>Retry conversation</button></div>}
      {timelineEntries(items).map(entry => entry.length > 1 ? <ToolGroup key={entry[0].id} items={entry} agent={agentName(task)} root={task.worktree}/> : <TimelineEntry key={entry[0].id} item={entry[0]} agent={agentName(task)} root={task.worktree}/>)}
      {requests.map(r => <RequestCard key={r.id} request={r} agent={agentName(task)} answerDrafts={answerDrafts} onDone={refresh}/>)}
      {task.status === 'running' && <div className="working"><span className="working-dots"><i/><i/><i/></span>{agentName(task)} is working on this task</div>}
      {task.status === 'queued' && <p className="muted">Task saved. Waiting for an available {agentName(task)} session.</p>}
      {openReview && task.status === 'reviewing' && task.review?.counts?.pending ? <div className="review-ready"><Icon name="paper" size={16}/><span>Round {task.review.round} is ready · {task.review.counts.pending} {task.review.counts.pending === 1 ? 'change' : 'changes'} to decide</span><button className="button secondary compact" onClick={openReview}>Open review</button></div> : null}
      {task.error && <div className="task-error"><Icon name="alert" size={16}/><div><strong>This step needs attention</strong><p>{task.error}</p></div></div>}
    </div></div>{!following && <button className="jump-latest" onClick={latest}><Icon name="arrowDown" size={14}/>Latest messages</button>}</div>
    <div className="composer-wrap">
      <Composer label={`Instructions for ${agentName(task)}`} value={draft} onChange={value => composer.edit(value)} onSubmit={() => void submit('draft')} placeholder={active ? 'Queue instructions for the next turn…' : 'Ask for another revision…'}
        footer={<span className="composer-hint">{hint}</span>}
        action={<div className="composer-actions">
          {active && <button type="button" className="send-button stop" aria-label="Pause task" title={`Pause ${agentName(task)}`} disabled={pausing} aria-busy={pausing} onClick={pause}><Icon name="stop" size={18}/></button>}
          {(!active || draft.trim() || sending) && <button aria-label="Send instructions" title="Send (Enter) · New line (Shift+Enter)" disabled={!draft.trim() || sending || blocked} className="send-button" type="submit"><Icon name="arrowUp" size={18}/></button>}
        </div>}/>
    </div>
  </section>;
}

function ReviewFeedback({ task, composer, refresh, reportError, onSent }: { task: Task; composer: ComposerDraft; refresh: () => void; reportError: (error: unknown) => void; onSent: () => void }) {
  const { sending, sendingSource } = useSyncExternalStore(composer.subscribe, composer.getSnapshot);
  // Older summaries have no unsent count; fall back to every commented change.
  const count = task.review?.unsent ?? task.review?.counts?.commented ?? 0;
  if (!count || task.status === 'deleting') return null;
  async function send() {
    if (task.status === 'uncertain') return;
    try { if (await composer.submit('feedback', message => api('/tasks/' + task.id + '/messages', message))) { refresh(); onSent(); } }
    catch (error) { reportError(error); }
  }
  return <div className="review-feedback"><span><Icon name="chat" size={15}/>{count} {count === 1 ? 'comment' : 'comments'} not sent yet</span><button className="button primary compact" disabled={sending || task.status === 'uncertain'} onClick={() => void send()}>{sendingSource === 'feedback' ? 'Sending feedback…' : 'Send feedback'}<Icon name="arrowRight" size={14}/></button></div>;
}


// Shorten an absolute repository path to its last folders for menus.
function shortPath(value: string) { const parts = value.split('/').filter(Boolean); return (parts.length > 2 ? '…/' : '/') + parts.slice(-2).join('/'); }
function gitSummary(git: GitStatus | null) {
  if (!Array.isArray(git?.files)) return '';
  const sync = [git.ahead ? `↑${git.ahead}` : '', git.behind ? `↓${git.behind}` : ''].filter(Boolean).join(' ');
  return [git.branch || 'detached', git.files.length ? `${git.files.length} changed` : 'clean', sync].filter(Boolean).join(' · ');
}

// A source-control style summary: where the manuscript is, its last commit,
// and what is not committed yet (accepted review changes land here).
// LaTeX build output is left out of a commit unless chosen.
const BUILD_OUTPUT = /\.(aux|log|out|toc|lof|lot|lol|fls|fdb_latexmk|synctex(\.gz)?|bbl|blg|bcf|run\.xml|nav|snm|vrb|xdv|dvi|idx|ilg|ind|glo|gls|glg|ist|thm|loa)$/;
const GIT_NAMES: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', U: 'Conflict', '?': 'Untracked', T: 'Type changed' };

function DiffView({ diff }: { diff: GitDiff }) {
  const all = diff.diff.split('\n'), start = all.findIndex(line => line.startsWith('@@'));
  const lines = start < 0 ? all.filter(line => line.startsWith('Binary')) : all.slice(start, start + 3000);
  if (!lines.length) return <p className="git-diff-note">No textual changes.</p>;
  // A context line's leading space is non-breaking, so a long first word wraps in place.
  return <><pre className="git-diff">{lines.map((line, index) => <span key={index} className={line.startsWith('@@') ? 'hunk' : line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : line.startsWith('\\') ? 'note' : undefined}>{line.startsWith(' ') ? '\u00a0' + line.slice(1) : line || ' '}{'\n'}</span>)}</pre>
    {(diff.truncated || all.length - start > 3000) && <p className="git-diff-note">The diff is too long to show in full.</p>}</>;
}

// A source-control panel: the branch and its remote, the last commit, and the
// uncommitted changes with their diffs. Chosen files are committed exactly as
// they are on disk; fetch, pull (fast-forward only) and push use the host's
// Git credentials.
function GitPanel({ projectId, git, onStatus }: { projectId: string; git: GitStatus | null; onStatus: (status: GitStatus) => void }) {
  const draftKey = `papilot:commit:${projectId}`;
  const [message, setMessage] = useState(() => browserStorage.getItem(draftKey) || '');
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const seen = useRef(new Set<string>());
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [open, setOpen] = useState(''), [diff, setDiff] = useState<{ path: string; result: GitDiff | null; error: string } | null>(null);
  const files = git?.files || [];
  // New build output starts unchecked; everything else starts checked.
  useEffect(() => {
    const fresh = files.filter(file => !seen.current.has(file.path));
    fresh.forEach(file => seen.current.add(file.path));
    if (fresh.some(file => file.status === '?' && BUILD_OUTPUT.test(file.path))) setExcluded(current => new Set([...current, ...fresh.filter(file => file.status === '?' && BUILD_OUTPUT.test(file.path)).map(file => file.path)]));
  }, [files.map(file => file.path).join('\0')]);
  const openFile = files.find(file => file.path === open);
  useEffect(() => {
    if (!openFile) { setDiff(null); return; }
    let live = true;
    setDiff(current => current?.path === open ? current : { path: open, result: null, error: '' });
    api<GitDiff>(`/projects/${projectId}/git/diff?path=${encodeURIComponent(open)}`).then(result => { if (live) setDiff({ path: open, result, error: '' }); }, e => { if (live) setDiff({ path: open, result: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [projectId, open, openFile?.status, openFile?.lines?.join()]);
  if (!git || !Array.isArray(git.files)) return <section className="git-panel" aria-label="Git status"><p className="git-clean">Reading Git status…</p></section>;
  const chosen = files.filter(file => !excluded.has(file.path));
  const added = files.reduce((sum, file) => sum + (file.lines?.[0] || 0), 0), removed = files.reduce((sum, file) => sum + (file.lines?.[1] || 0), 0);
  const saveMessage = (value: string) => { setMessage(value); if (value) browserStorage.setItem(draftKey, value); else browserStorage.removeItem(draftKey); };
  async function run(action: string, work: () => Promise<{ git: GitStatus; commit?: string }>, done: (result: { git: GitStatus; commit?: string }) => string) {
    if (busy) return;
    setBusy(action); setError(''); setNotice('');
    try { const result = await work(); onStatus(result.git); setNotice(done(result)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  }
  const commit = () => {
    const text = message.trim();
    if (!text || !chosen.length) return;
    void run('commit', () => api(`/projects/${projectId}/git/commit`, { message: text, paths: chosen.map(file => file.path) }), result => { saveMessage(''); return `Committed ${result.commit}.`; });
  };
  const remote = (action: 'fetch' | 'pull' | 'push') => void run(action, () => api(`/projects/${projectId}/git/${action}`, {}, undefined, 130000),
    result => action === 'fetch' ? (result.git.behind ? `${result.git.behind} new ${result.git.behind === 1 ? 'commit' : 'commits'} on ${result.git.upstream}.` : 'Up to date with the remote.') : action === 'pull' ? 'Pulled the latest commits.' : `Pushed to ${result.git.upstream || 'the remote'}.`);
  const publish = !git.upstream && git.remote && git.branch;
  return <section className="git-panel" aria-label="Git status" aria-busy={Boolean(busy)}>
    <div className="git-branch"><Icon name="branch" size={16}/><code>{git.branch || 'detached HEAD'}</code>
      {git.upstream && <span className="git-sync" title={`Compared with ${git.upstream}`}>{git.ahead || git.behind ? <>{git.ahead > 0 && <span>↑{git.ahead}</span>}{git.behind > 0 && <span>↓{git.behind}</span>}</> : 'up to date'}</span>}
      {git.remote && <span className="git-remote">
        {git.upstream && git.behind > 0 && <button type="button" className="button secondary compact" disabled={Boolean(busy)} onClick={() => remote('pull')}>{busy === 'pull' ? 'Pulling…' : 'Pull'}</button>}
        {(git.upstream ? git.ahead > 0 : publish) && <button type="button" className="button secondary compact" disabled={Boolean(busy)} onClick={() => remote('push')}>{busy === 'push' ? 'Pushing…' : git.upstream ? 'Push' : 'Publish branch'}</button>}
        <button type="button" className="icon-button" aria-label="Fetch from the remote" title="Fetch from the remote" disabled={Boolean(busy)} onClick={() => remote('fetch')}>{busy === 'fetch' ? <span className="spinner"/> : <Icon name="refresh" size={15}/>}</button>
      </span>}
    </div>
    {git.upstream && <p className="git-upstream">Tracking <code>{git.upstream}</code></p>}
    {git.head && <div className="git-commit"><Icon name="commit" size={16}/><div><p>{git.head.subject}</p><small><code>{git.head.hash}</code> · {ago(git.head.date)} ago</small></div></div>}
    {error && <p className="inline-error git-message" role="alert">{error}</p>}
    {notice && !error && <p className="git-message git-notice" role="status"><Icon name="check" size={14}/>{notice}</p>}
    <h3 className="git-section">{files.length > 0 && <input type="checkbox" aria-label="Include all changes" checked={chosen.length === files.length} ref={box => { if (box) box.indeterminate = chosen.length > 0 && chosen.length < files.length; }} onChange={event => setExcluded(event.target.checked ? new Set() : new Set(files.map(file => file.path)))}/>}<span>Uncommitted changes</span>{files.length > 0 && <span className="count">{files.length}</span>}{added || removed ? <span className="git-total"><ins>+{added}</ins> <del>−{removed}</del></span> : null}</h3>
    {files.length ? <>
      <form className="git-commit-form" onSubmit={event => { event.preventDefault(); commit(); }}>
        <textarea aria-label="Commit message" placeholder="Commit message" rows={2} value={message} readOnly={busy === 'commit'} onChange={event => saveMessage(event.target.value)} onKeyDown={event => { if (sendsMessage(event.nativeEvent, touch())) { event.preventDefault(); commit(); } }}/>
        <button className="button primary" disabled={Boolean(busy) || !message.trim() || !chosen.length}>{busy === 'commit' ? 'Committing…' : chosen.length === files.length ? `Commit ${files.length === 1 ? '1 file' : `all ${files.length} files`}` : `Commit ${chosen.length} of ${files.length} files`}</button>
      </form>
      <ul className="git-files">{files.map(file => {
        const slash = file.path.lastIndexOf('/'), code = file.status === '?' ? 'U' : file.status, expanded = open === file.path;
        return <li key={file.path} className={expanded ? 'open' : undefined}>
          <div className="git-row">
            <input type="checkbox" aria-label={`Include ${file.path}`} checked={!excluded.has(file.path)} onChange={event => setExcluded(current => { const next = new Set(current); if (event.target.checked) next.delete(file.path); else next.add(file.path); return next; })}/>
            <button type="button" className="git-file" aria-expanded={expanded} title={`${GIT_NAMES[file.status] || file.status}: ${file.from ? `${file.from} → ` : ''}${file.path}`} onClick={() => setOpen(expanded ? '' : file.path)}>
              <span className="git-name">{file.path.slice(slash + 1)}</span>{slash > 0 && <span className="git-dir">{file.path.slice(0, slash)}</span>}
            </button>
            {file.lines && <span className="git-lines"><ins>+{file.lines[0]}</ins> <del>−{file.lines[1]}</del></span>}
            <span className={'git-code s-' + (file.status === '?' ? 'u' : file.status.toLowerCase())} aria-label={GIT_NAMES[file.status] || file.status}>{code}</span>
          </div>
          {expanded && <div className="git-diff-wrap" aria-label={`Changes in ${file.path}`} role="region">
            {diff?.path === file.path && diff.result ? <DiffView diff={diff.result}/> : diff?.error ? <p className="inline-error">{diff.error}</p> : <p className="git-diff-note">Loading the diff…</p>}
          </div>}
        </li>;
      })}</ul>
    </> : <p className="git-clean"><Icon name="check" size={15}/>No uncommitted changes</p>}
  </section>;
}

function noteWhere(note: Annotation) { return `Page ${note.page + 1}` + (note.source ? ` · ${note.source.file}:${note.source.lines[0]}${note.source.lines[1] !== note.source.lines[0] ? `–${note.source.lines[1]}` : ''}` : ''); }

interface NoteActions { add: (page: number, rect: Rect, rects: Rect[], quote: string, comment: string) => Promise<void>; remove: (note: Annotation) => void; send: () => void; sending: boolean; options: React.ReactNode }

function NotesPanel({ notes, currentKey, active, actions, onShow }: { notes: Annotation[]; currentKey?: string; active: string; actions: NoteActions; onShow: (note: Annotation) => void }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { if (active) list.current?.querySelector(`[data-note="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  return <section className="notes-panel" aria-label="PDF notes">
    {notes.length ? <ol ref={list} className="note-list">{notes.map((note, index) => <li key={note.id} data-note={note.id} className={(active === note.id ? 'active ' : '') + (note.key !== currentKey ? 'stale' : '')}>
      <div className="note-head"><button type="button" className="note-number" aria-label={`Show note ${index + 1} on the page`} onClick={() => onShow(note)}>{index + 1}</button><span className="note-where">{noteWhere(note)}</span><button type="button" className="icon-button" aria-label={`Delete note ${index + 1}`} title="Delete note" onClick={() => actions.remove(note)}><Icon name="close" size={14}/></button></div>
      {note.source?.excerpt ? <pre className="note-source" title={`${note.source.file}, the LaTeX that produced the marked region`}>{note.source.excerpt}</pre> : note.quote && <blockquote>{note.quote}</blockquote>}
      <p>{note.comment}</p>
      {note.key !== currentKey && <small className="muted">Marked on an earlier version of the PDF.</small>}
    </li>)}</ol>
      : <p className="muted notes-empty">Select text in the PDF and choose Add note, or use Mark region for a figure or equation. All notes go to the agent as one task.</p>}
    <div className="notes-send">
      <div className="composer-options">{actions.options}</div>
      <button type="button" className="button primary" disabled={!notes.length || actions.sending} onClick={actions.send}>{actions.sending ? 'Sending…' : `Send ${notes.length || ''} ${notes.length === 1 ? 'note' : 'notes'} to the agent`.replace('  ', ' ')}</button>
    </div>
  </section>;
}

type ManuscriptPanel = 'pdf' | 'notes' | 'git';
function ManuscriptView({ project, data, error, view, setView, region, setRegion, active, setActive, actions, onGit }: { onGit: (status: GitStatus) => void; project: Project; data: Manuscript | null; error: string; view: ManuscriptPanel; setView: (view: ManuscriptPanel) => void; region: boolean; setRegion: (on: boolean) => void; active: string; setActive: (id: string) => void; actions: NoteActions }) {
  const build = data?.build, notes = data?.annotations || [];
  const pdf = useRef<PdfHandle>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]), [section, setSection] = useState(-1);
  const numbered = notes.map((note, index) => ({ note, number: index + 1 }));
  const phone = () => window.matchMedia('(max-width: 680px)').matches;
  const side = view === 'git' ? 'git' : 'notes';
  function show(note: Annotation) {
    setActive(note.id);
    if (phone()) setView('pdf');
    requestAnimationFrame(() => pdf.current?.goToNote(note));
  }
  return <div className={'manuscript show-' + view}>
    <section className="manuscript-pages" aria-label="PDF preview" aria-busy={!build || build.status === 'building'}>
      {error && <div className="manuscript-note error" role="alert">{error}</div>}
      {build?.status === 'failed' && <div className="manuscript-note error" role="alert"><strong>The manuscript did not compile.</strong><pre>{build.error}</pre></div>}
      {build?.status === 'building' && build.key && <div className="manuscript-note">Compiling the latest changes…</div>}
      {build?.key ? <Suspense fallback={<div className="review-loading"><p role="status">Opening the PDF…</p></div>}><PdfView ref={pdf} url={`/api/projects/${project.id}/manuscript.pdf?key=${build.key}`} notes={numbered.filter(item => item.note.key === build.key)} active={active} region={region} setRegion={setRegion}
          onCreate={actions.add} onSelect={note => { setActive(note.id); if (!phone()) setView('notes'); }} outline={outline} section={section} onOutline={setOutline} onSection={setSection}/></Suspense>
        : !error && build?.status !== 'failed' && <div className="review-placeholder"><div className="placeholder-icon"><span className="spinner large"/></div><h2>Compiling the PDF…</h2><p>The first build of a paper can take a minute.</p></div>}
    </section>
    <aside className="manuscript-side" aria-label="Notes and Git">
      <div className="side-tabs" role="tablist" aria-label="PDF panels">
        <button role="tab" aria-selected={side === 'notes'} onClick={() => setView('notes')}>Notes{notes.length > 0 && <span className="count">{notes.length}</span>}</button>
        <button role="tab" aria-selected={side === 'git'} onClick={() => setView('git')}>Git{data?.git?.files?.length ? <span className="count">{data.git.files.length}</span> : null}</button>
      </div>
      {side === 'git' ? <GitPanel key={project.id} projectId={project.id} git={data?.git || null} onStatus={onGit}/> : <NotesPanel notes={notes} currentKey={build?.key} active={active} actions={actions} onShow={show}/>}
    </aside>
  </div>;
}

function App() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState(browserStorage.getItem('papilot:task') || '');
  const [projectId, setProjectId] = useState('');
  const [timeline, setTimeline] = useState<{ taskId: string; items: TimelineItem[] }>({ taskId: '', items: [] });
  const [itemsLoading, setItemsLoading] = useState(false);
  const [timelineError, setTimelineError] = useState({ taskId: '', message: '' });
  const snapshotRef = useRef<Snapshot | null>(null);
  const timelineCache = useRef(new Map<string, TimelineItem[]>());
  const composers = useRef(new Map<string, ComposerDraft>());
  const answerDrafts = useRef(new Map<string, Record<string, string>>());
  const [snapshotRequest] = useState(() => new ReadRequest<Snapshot & { csrf: string }>());
  const [timelineRequest] = useState(() => new ReadRequest<{ items: TimelineItem[] }>());
  const [online, setOnline] = useState(true), [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const sidebarRef = useRef<HTMLElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [modal, setModal] = useState<'project' | null>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const modalOpener = useRef<HTMLElement | null>(null);
  const formTaskId = useRef(uuid());
  const newTaskInput = useRef<HTMLTextAreaElement>(null);
  const [newDraft, setNewDraft] = useState(() => browserStorage.getItem('papilot:new-task') || '');
  // The agent, and each agent's model and reasoning effort, are remembered for
  // every new task, whether it starts from the composer or from PDF notes.
  const [agentChoice, setAgentChoice] = useState<AgentId>(() => { const saved = browserStorage.getItem('papilot:agent'); return saved === 'claude' || saved === 'antigravity' ? saved : 'codex'; });
  const [agentPrefs, setAgentPrefs] = useState(() => Object.fromEntries(AGENT_IDS.map(id => [id, {
    model: browserStorage.getItem(`papilot:model:${id}`) ?? (id === 'codex' ? browserStorage.getItem('papilot:model') : null) ?? '',
    effort: browserStorage.getItem(`papilot:effort:${id}`) ?? (id === 'codex' ? browserStorage.getItem('papilot:effort') : null) ?? '',
  }])) as Record<AgentId, { model: string; effort: string }>);
  const [creating, setCreating] = useState(false), [createError, setCreateError] = useState('');
  const [busy, setBusy] = useState(false), [sidebar, setSidebar] = useState(false);
  const actionRequests = useRef(new Set<string>());
  const [pendingActions, setPendingActions] = useState(new Set<string>());
  const [sidebarVisible, setSidebarVisible] = useState(() => browserStorage.getItem('papilot:sidebar') !== 'hidden');
  const [layout, setLayout] = useState<'split' | 'review' | 'conversation'>(() => {
    const saved = browserStorage.getItem('papilot:layout');
    return saved === 'review' || saved === 'conversation' ? saved : 'split';
  });
  const narrow = useMedia('(max-width: 900px)'), mobile = useMedia('(max-width: 680px)');
  const [mobileTab, setMobileTab] = useState('review');
  const [renaming, setRenaming] = useState('');
  // Enter and Escape return focus to the renamed task; clicking elsewhere keeps that focus.
  const refocus = useRef('');
  useEffect(() => {
    if (renaming || !refocus.current) return;
    document.querySelector<HTMLElement>(`.task-row[data-task="${refocus.current}"] .task-link`)?.focus();
    refocus.current = '';
  }, [renaming]);
  const [renamingPaper, setRenamingPaper] = useState(false);
  const refocusPaper = useRef(false);
  useEffect(() => {
    if (renamingPaper || !refocusPaper.current) return;
    document.querySelector<HTMLElement>('.breadcrumb .project-name')?.focus();
    refocusPaper.current = false;
  }, [renamingPaper]);
  const [page, setPage] = useState<'home' | 'manuscript'>('home');
  const [manuscriptView, setManuscriptView] = useState<ManuscriptPanel>(() => window.matchMedia('(max-width: 680px)').matches ? 'pdf' : 'notes');
  const [region, setRegion] = useState(false);
  const [activeNote, setActiveNote] = useState('');
  const [sendingNotes, setSendingNotes] = useState(false);
  const notesTaskId = useRef(uuid());
  const [manuscript, setManuscript] = useState<{ projectId: string; data: Manuscript | null; error: string }>({ projectId: '', data: null, error: '' });
  const [git, setGit] = useState<{ projectId: string; status: GitStatus | null }>({ projectId: '', status: null });
  const building = useRef(false);
  const [chatWidth, setChatWidth] = useState(() => Number(browserStorage.getItem('papilot:chat-width')) || 0);
  const [form, setForm] = useState({ path: '', name: '' });
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const loaded = useRef(false);
  useEffect(() => {
    const dialog = modalRef.current;
    if (!modal || !dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('input')?.focus();
    return () => { dialog.close(); if (modalOpener.current?.isConnected) modalOpener.current.focus(); };
  }, [modal]);
  useEffect(() => {
    if (!narrow || !sidebar) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = sidebarRef.current;
    (panel?.querySelector<HTMLElement>('[aria-current="page"]') || panel?.querySelector<HTMLElement>('button'))?.focus();
    return () => { if (opener?.isConnected && opener.getClientRects().length) opener.focus(); };
  }, [narrow, sidebar]);
  useEffect(() => { setSidebar(false); }, [narrow]);
  useEffect(() => { browserStorage.setItem('papilot:sidebar', sidebarVisible ? 'visible' : 'hidden'); }, [sidebarVisible]);
  useEffect(() => { browserStorage.setItem('papilot:layout', layout); }, [layout]);
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
  const reportError = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), []);
  const refreshTimeline = useCallback(async (selection: string) => {
    if (selectedRef.current === selection && !timelineCache.current.has(selection)) setItemsLoading(true);
    try {
      await timelineRequest.run(selection, signal => api('/tasks/' + selection + '/items', undefined, signal), timeline => {
        timelineCache.current.delete(selection);
        timelineCache.current.set(selection, timeline.items);
        // Bound the in-memory history cache while retaining quick back-and-forth navigation.
        if (timelineCache.current.size > 8) timelineCache.current.delete(timelineCache.current.keys().next().value!);
        if (selectedRef.current === selection) { setTimeline({ taskId: selection, items: timeline.items }); setTimelineError({ taskId: selection, message: '' }); }
      });
    } catch (e) { if (selectedRef.current === selection) setTimelineError({ taskId: selection, message: e instanceof Error ? e.message : String(e) }); }
    finally { if (selectedRef.current === selection) setItemsLoading(false); }
  }, [timelineRequest]);
  const refresh = useCallback(async (fresh = false) => {
    try {
      if (fresh) snapshotRequest.cancel();
      await snapshotRequest.run('state', signal => api('/state', undefined, signal), next => {
        const selection = selectedRef.current;
        const removed = snapshotRef.current?.tasks.find(t => t.id === selection && !next.tasks.some(nextTask => nextTask.id === selection));
        if (removed) setProjectId(removed.projectId);
        token = next.csrf; snapshotRef.current = next; setState(next); setOnline(true); setConnectionError('');
        for (const id of composers.current.keys()) if (!next.tasks.some(t => t.id === id)) { composers.current.delete(id); timelineCache.current.delete(id); browserStorage.removeItem('papilot:draft:' + id); }
        setDeleteTarget(current => current && !next.tasks.some(t => t.id === current.id) ? null : current);
        for (const id of answerDrafts.current.keys()) if (!next.requests.some(r => r.id === id)) answerDrafts.current.delete(id);
        if (selection && !next.tasks.some(t => t.id === selection)) setSelected('');
        if (!loaded.current) { loaded.current = true; if (!selection && next.tasks.length) setSelected(next.tasks[next.tasks.length - 1].id); }
      });
      const selection = selectedRef.current;
      if (!document.hidden && selection && snapshotRef.current?.tasks.some(t => t.id === selection)) await refreshTimeline(selection);
    } catch (e) { setOnline(false); setConnectionError(e instanceof Error ? e.message : String(e)); }
  }, [snapshotRequest, refreshTimeline]);
  useEffect(() => {
    let generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
    let events: EventSource | undefined;
    const protocol = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.nextHopProtocol || '';
    function start() {
      const cycle = ++generation;
      clearTimeout(timer); events?.close(); events = undefined;
      if (document.hidden || !navigator.onLine) { snapshotRequest.cancel(); timelineRequest.cancel(); if (!navigator.onLine) { setOnline(false); setConnectionError('You are offline. Your draft is kept in this browser.'); } return; }
      if (canStreamUpdates(protocol)) {
        events = new EventSource('/api/events');
        events.addEventListener('change', () => { if (cycle === generation) void refresh(); });
      }
      async function poll() {
        await refresh();
        if (cycle !== generation) return;
        const busy = snapshotRef.current?.tasks.some(t => ['running', 'waiting_input', 'queued', 'building'].includes(t.status));
        timer = setTimeout(() => void poll(), events?.readyState === EventSource.OPEN ? 10000 : busy ? 1000 : 2500);
      }
      void poll();
    }
    start();
    document.addEventListener('visibilitychange', start);
    window.addEventListener('online', start);
    window.addEventListener('offline', start);
    return () => { generation++; clearTimeout(timer); events?.close(); snapshotRequest.cancel(); timelineRequest.cancel(); document.removeEventListener('visibilitychange', start); window.removeEventListener('online', start); window.removeEventListener('offline', start); };
  }, [refresh, snapshotRequest, timelineRequest]);
  useEffect(() => {
    browserStorage.setItem('papilot:task', selected);
    setTimeline({ taskId: selected, items: timelineCache.current.get(selected) || [] });
    setItemsLoading(Boolean(selected && !timelineCache.current.has(selected)));
    if (selected && snapshotRef.current?.tasks.some(t => t.id === selected)) void refreshTimeline(selected);
    return () => timelineRequest.cancel();
  }, [selected, refreshTimeline, timelineRequest]);
  useEffect(() => { if (!projectId && state?.projects.length) setProjectId(state.projects[0].id); }, [state, projectId]);
  const task = state?.tasks.find(t => t.id === selected);
  if (task && !composers.current.has(task.id)) composers.current.set(task.id, new ComposerDraft('papilot:draft:' + task.id, browserStorage, uuid));
  const fullPdfUrl = task?.status !== 'deleting' && task?.review?.round ? `/api/tasks/${task.id}/pdf?round=${task.review.round}` : '';
  const project = state?.projects.find(p => p.id === (task?.projectId || projectId)) || state?.projects[0];
  const tasks = state?.tasks.filter(t => !project || t.projectId === project.id) || [];
  const running = state?.tasks.filter(t => ['running', 'waiting_input', 'building'].includes(t.status)).length || 0;
  function openProject() { modalOpener.current = document.activeElement as HTMLElement | null; setError(''); setForm({ path: '', name: '' }); setModal('project'); }
  function newTask() {
    setSelected(''); setPage('home'); setSidebar(false);
    if (!state?.projects.length) openProject();
    else requestAnimationFrame(() => newTaskInput.current?.focus());
  }
  async function saveProject(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const p = await api('/projects', { path: form.path, name: form.name }); setProjectId(p.id); setSelected(''); setModal(null); setSidebar(false); await refresh(true); }
    catch (e) { reportError(e); } finally { setBusy(false); }
  }
  // A remembered choice the host no longer offers falls back to its default;
  // the preference is kept in case another model offers it again.
  const runtimes: Partial<Record<AgentId, RuntimeStatus>> = state?.runtimes || (state ? { codex: state.runtime } : {});
  const unavailable = (id: AgentId) => Boolean(runtimes[id]?.error && !(runtimes[id]?.connected && runtimes[id]?.authenticated));
  const models = runtimes[agentChoice]?.models || [], pref = agentPrefs[agentChoice];
  const chosenModel = models.length && !models.some(m => m.id === pref.model) ? '' : pref.model;
  const modelInfo = models.find(m => m.id === chosenModel) || models.find(m => m.isDefault);
  const agent = { agent: agentChoice, model: chosenModel, effort: modelInfo && !modelInfo.efforts.includes(pref.effort) ? '' : pref.effort };
  const remember = (change: Partial<{ model: string; effort: string }>) => {
    setAgentPrefs(current => ({ ...current, [agentChoice]: { ...current[agentChoice], ...change } }));
    for (const [key, value] of Object.entries(change)) browserStorage.setItem(`papilot:${key}:${agentChoice}`, value);
  };
  const agentOptions = (disabled: boolean) => <>
    <ChipSelect label="Agent" disabled={disabled} value={agentChoice} onChange={value => { setAgentChoice(value as AgentId); browserStorage.setItem('papilot:agent', value); }} options={AGENT_IDS.map(id => ({ value: id, label: AGENT_LABELS[id] + (unavailable(id) ? ' · unavailable' : '') }))}/>
    <ChipSelect label="Model" disabled={disabled} value={agent.model} onChange={value => remember({ model: value })} options={[{ value: '', label: 'Default model' }, ...models.map(m => ({ value: m.id, label: m.name }))]}/>
    {modelInfo && <EffortPicker efforts={modelInfo.efforts} value={agent.effort} fallback={modelInfo.defaultEffort} disabled={disabled} onChange={value => remember({ effort: value })}/>}
  </>;
  async function createTask() {
    const text = newDraft.trim(), target = project?.id || projectId;
    if (!text || creating || !target) return;
    setCreating(true); setCreateError('');
    try {
      // The ID is kept until creation succeeds, so a retried request cannot create a second task.
      const t = await api('/tasks', { projectId: target, title: taskTitle(text), instructions: text, agent: agent.agent, model: agent.model, effort: agent.effort, id: formTaskId.current });
      formTaskId.current = uuid(); setNewDraft(''); setSelected(t.id); setMobileTab('conversation'); setLayout('split'); setSidebar(false);
      await refresh(true);
    } catch (e) { setCreateError(e instanceof Error ? e.message : String(e)); } finally { setCreating(false); }
  }
  async function action(route: string) {
    const key = route.startsWith('/tasks/') ? route.split('/').slice(0, 3).join('/') : route;
    if (actionRequests.current.has(key)) return;
    actionRequests.current.add(key); setPendingActions(new Set(actionRequests.current));
    try { await api(route, {}); await refresh(true); } catch (e) { reportError(e); }
    finally { actionRequests.current.delete(key); setPendingActions(new Set(actionRequests.current)); }
  }
  const taskActionBusy = Boolean(task && pendingActions.has('/tasks/' + task.id));
  const sidebarShown = narrow ? sidebar : sidebarVisible;
  function taskDeleted(id: string) {
    const removed = snapshotRef.current?.tasks.find(t => t.id === id); if (removed) setProjectId(removed.projectId);
    browserStorage.removeItem('papilot:draft:' + id); composers.current.delete(id); timelineCache.current.delete(id);
    setDeleteTarget(null);
    if (selectedRef.current === id) setSelected('');
    setState(previous => previous ? { ...previous, tasks: previous.tasks.filter(t => t.id !== id), requests: previous.requests.filter(r => r.taskId !== id) } : previous);
    void refresh(true);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(sidebarShown ? '.sidebar .new-task' : '.topbar .sidebar-toggle')?.focus());
  }
  function hideSidebar() {
    if (narrow) { setSidebar(false); return; }
    setSidebarVisible(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.topbar .sidebar-toggle')?.focus());
  }

  async function rename(target: Task, value: string) {
    const title = value.trim().replace(/\s+/g, ' ').slice(0, 120);
    setRenaming('');
    if (!title || title === target.title) return;
    setState(previous => previous ? { ...previous, tasks: previous.tasks.map(t => t.id === target.id ? { ...t, title } : t) } : previous);
    try { await api('/tasks/' + target.id + '/rename', { title }); } catch (e) { reportError(e); }
    await refresh(true);
  }
  async function renamePaper(target: Project, value: string) {
    const name = value.trim().replace(/\s+/g, ' ').slice(0, 120);
    setRenamingPaper(false);
    if (!name || name === target.name) return;
    setState(previous => previous ? { ...previous, projects: previous.projects.map(p => p.id === target.id ? { ...p, name } : p) } : previous);
    try { await api('/projects/' + target.id + '/rename', { name }); } catch (e) { reportError(e); }
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
  const manuscriptOpen = !task && page === 'manuscript' && Boolean(project);
  const loadManuscript = useCallback(async (projectId: string, rebuild = false) => {
    try {
      const data = await api<Manuscript>(`/projects/${projectId}/manuscript`, rebuild ? {} : undefined);
      building.current = data.build.status === 'building';
      setManuscript({ projectId, data, error: '' }); setGit({ projectId, status: data.git });
    } catch (e) { setManuscript(current => ({ projectId, data: current.projectId === projectId ? current.data : null, error: e instanceof Error ? e.message : String(e) })); }
  }, []);
  // Poll quickly while the preview compiles; otherwise recheck the working tree now and then.
  useEffect(() => {
    if (!manuscriptOpen || !project) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => { await loadManuscript(project.id); if (!stopped) timer = setTimeout(() => void tick(), building.current ? 1500 : 15000); };
    void tick();
    const focus = () => void loadManuscript(project.id);
    window.addEventListener('focus', focus);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener('focus', focus); };
  }, [manuscriptOpen, project?.id, loadManuscript]);
  useEffect(() => {
    if (!project || manuscriptOpen) return;
    const load = () => void api<GitStatus>(`/projects/${project.id}/git`).then(status => setGit({ projectId: project.id, status })).catch(() => undefined);
    load(); const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [project?.id, manuscriptOpen]);
  const projectGit = git.projectId === project?.id ? git.status : null;
  const manuscriptData = manuscript.projectId === project?.id ? manuscript : { data: null, error: '' };
  const notes = manuscriptData.data?.annotations || [];
  const withNotes = (update: (list: Annotation[]) => Annotation[]) => setManuscript(current => current.data ? { ...current, data: { ...current.data, annotations: update(current.data.annotations || []) } } : current);
  const noteActions: NoteActions = {
    async add(page, rect, rects, quote, comment) {
      if (!project || !manuscriptData.data?.build.key) throw new Error('Wait for the PDF to compile.');
      const note = await api<Annotation>(`/projects/${project.id}/annotations`, { key: manuscriptData.data.build.key, page, rect, ...(rects.length ? { rects, quote } : {}), comment });
      withNotes(list => [...list, note]); setActiveNote(note.id); setRegion(false);
      if (!mobile) setManuscriptView('notes');
    },
    remove(note) {
      if (!project) return;
      withNotes(list => list.filter(item => item.id !== note.id));
      void api(`/projects/${project.id}/annotations/${note.id}/delete`, {}).catch(e => { reportError(e); void loadManuscript(project.id); });
    },
    // The task ID is kept until sending succeeds, so a retry cannot create a second task.
    async send() {
      if (!project || sendingNotes) return;
      setSendingNotes(true);
      try {
        const created = await api<Task>(`/projects/${project.id}/annotations/send`, { id: notesTaskId.current, agent: agent.agent, model: agent.model, effort: agent.effort });
        notesTaskId.current = uuid(); withNotes(() => []); setSelected(created.id); setMobileTab('conversation'); setLayout('split');
        await refresh(true);
      } catch (e) { reportError(e); } finally { setSendingNotes(false); }
    },
    sending: sendingNotes, options: agentOptions(sendingNotes),
  };
  const waiting = state?.tasks.filter(t => t.status === 'waiting_input').length || 0;
  // The banner follows the agent in view: the task's, or the one chosen for a new task.
  const bannerAgent: AgentId = task ? task.agent || 'codex' : agentChoice, bannerRuntime = runtimes[bannerAgent];
  useEffect(() => { document.title = (waiting ? `(${waiting}) ` : '') + (task ? `${task.title} · Papilot` : manuscriptOpen && project ? `${project.name} · Papilot` : 'Papilot'); }, [waiting, task?.title, manuscriptOpen, project?.name]);
  const replyNeeded = Boolean(task && state?.requests.some(r => r.taskId === task.id));
  const pending = task?.review?.counts?.pending || 0;
  const active = Boolean(task && ACTIVE.includes(task.status));
  const conversationVisible = mobile ? mobileTab === 'conversation' : layout !== 'review';
  const pause = () => { if (task) void action('/tasks/' + task.id + '/interrupt'); };
  const reviewTools = task && fullPdfUrl ? <>
    <a className="button ghost compact full-pdf-link" href={fullPdfUrl} target="_blank" rel="noreferrer" aria-label="Full PDF" title={`Open the full PDF after round ${task.review?.round}`}><Icon name="paper" size={14}/><span>Full PDF</span></a>
    <button type="button" className="icon-button" aria-label="Build review" title="Build the review again" disabled={['running', 'waiting_input', 'queued', 'building', 'uncertain'].includes(task.status) || taskActionBusy} onClick={() => void action('/tasks/' + task.id + '/publish')}><Icon name="refresh" size={15}/></button>
    <a className="icon-button" href={`/review/${task.projectId}/?task=${task.name}`} target="_blank" rel="noreferrer" aria-label="Open review in new tab" title="Open review in new tab"><Icon name="external" size={15}/></a>
  </> : null;

  // The paper name in the header renames the paper in place, like a task title in the sidebar.
  const paperName = !project ? <span className="project-name">Papilot</span>
    : renamingPaper ? <form className="paper-rename" onSubmit={e => { e.preventDefault(); refocusPaper.current = true; e.currentTarget.querySelector('input')?.blur(); }}>
      <input name="name" aria-label={`Rename ${project.name}`} defaultValue={project.name} maxLength={120} size={Math.min(40, Math.max(12, project.name.length + 2))} autoFocus onFocus={e => e.currentTarget.select()} onBlur={e => void renamePaper(project, e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); refocusPaper.current = true; e.currentTarget.value = project.name; e.currentTarget.blur(); } }}/>
    </form>
    : <button className="project-name" aria-label={`Rename paper: ${project.name}`} title={`${project.name} · Click to rename`} onClick={() => setRenamingPaper(true)}>{project.name}</button>;

  return <div className={'app-shell' + (sidebarVisible ? '' : ' sidebar-collapsed')}>
    <aside ref={sidebarRef} role={narrow && sidebar ? 'dialog' : undefined} aria-modal={narrow && sidebar ? true : undefined} onKeyDown={e => { if (!narrow || !sidebar || modal) return; if (e.key === 'Escape') { e.preventDefault(); setSidebar(false); } else keepDialogFocus(e); }} id="task-sidebar" className={'sidebar ' + (sidebar ? 'is-open' : '')} aria-label="Papers and tasks">
      <div className="sidebar-header"><a href="/" className="brand" onClick={e => { e.preventDefault(); setSelected(''); setPage('home'); setSidebar(false); }}><img className="brand-mark" src={logo} alt=""/><span>Papilot</span></a><button className="icon-button" aria-label="Hide task list" title="Hide task list" onClick={hideSidebar}><Icon name={narrow ? 'close' : 'sidebar'} size={18}/></button></div>
      <div className="sidebar-section"><span>Paper</span></div>
      <div className="sidebar-actions">
        {state?.projects.length && project ? <ActionMenu label={`Paper: ${project.name}`} className="project-switcher" menuClassName="paper-menu" align="start" actions={[
          ...state.projects.map(p => ({ id: p.id, label: p.name, detail: shortPath(p.path), checked: p.id === project.id, select: p.id === project.id ? undefined : () => { setProjectId(p.id); setSelected(''); } })),
          { label: 'Add paper…', icon: 'plus', divider: true, select: () => openProject() },
        ]}><span className="project-switcher-name">{project.name}</span><Icon name="updown" size={14}/></ActionMenu>
          : <button className="add-project" disabled={!state} onClick={() => openProject()}><Icon name="plus" size={16}/>Add paper</button>}
        {project && <button className={'nav-link manuscript-link' + (manuscriptOpen ? ' active' : '')} aria-current={manuscriptOpen ? 'page' : undefined} onClick={() => { setSelected(''); setPage('manuscript'); if (mobile) setManuscriptView('pdf'); setSidebar(false); }}><Icon name="paper" size={16}/><span className="nav-label">PDF</span>{gitSummary(projectGit) && <span className="nav-meta" title="Git status of the manuscript">{gitSummary(projectGit)}</span>}</button>}
        <button className={'nav-link new-task' + (!task && !manuscriptOpen && project ? ' active' : '')} aria-current={!task && !manuscriptOpen && project ? 'page' : undefined} disabled={!state} onClick={() => newTask()}><Icon name="compose" size={16}/><span className="nav-label">New task</span></button>
      </div>
      <div className="sidebar-section"><span>Tasks</span>{tasks.length > 0 && <span className="count">{tasks.length}</span>}</div>
      <nav className="task-list" aria-label="Task list">{tasks.length ? [...tasks].reverse().map(t => <div key={t.id} data-task={t.id} className={'task-row ' + (t.id === selected ? 'active' : '')}>
        {renaming === t.id ? <form className="task-rename" onSubmit={e => { e.preventDefault(); refocus.current = t.id; e.currentTarget.querySelector('input')?.blur(); }}>
          <input name="title" aria-label={`Rename ${t.title}`} defaultValue={t.title} maxLength={120} autoFocus onFocus={e => e.currentTarget.select()} onBlur={e => void rename(t, e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); refocus.current = t.id; e.currentTarget.value = t.title; e.currentTarget.blur(); } }}/>
        </form>
        : <button aria-current={t.id === selected ? 'page' : undefined} className={'task-link ' + (t.id === selected ? 'active' : '')} onClick={() => { setSelected(t.id); setSidebar(false); }} onDoubleClick={() => { if (t.status !== 'deleting') setRenaming(t.id); }}><span className="task-title">{t.title}</span><span className="task-meta"><Status task={t}/><span className="task-time">{ago(t.updatedAt)}</span></span></button>}
        {t.review?.counts?.pending ? <span className="task-badge" title={`${t.review.counts.pending} changes to decide`}>{t.review.counts.pending}</span> : null}
        <ActionMenu label={`Task actions for ${t.title}`} actions={[
          ...(t.status === 'deleting' ? [] : [{ label: 'Rename…', icon: 'pencil', select: () => setRenaming(t.id) }]),
          ...(ACTIVE.includes(t.status) ? [{ label: 'Pause task', icon: 'pause', disabled: pendingActions.has('/tasks/' + t.id), select: () => void action('/tasks/' + t.id + '/interrupt') }] : []),
          ...(t.status === 'uncertain' ? [{ label: 'Check status', icon: 'refresh', disabled: pendingActions.has('/tasks/' + t.id), select: () => void action('/tasks/' + t.id + '/reconcile') }] : []),
          { label: t.status === 'deleting' ? 'Retry deletion…' : 'Delete task…', icon: 'trash', danger: true, select: () => setDeleteTarget(t) },
        ]}/>
      </div>) : <div className="task-list-empty">{state?.projects.length ? 'No tasks yet. Start one with New task.' : 'Add a paper to get started.'}</div>}</nav>
      {/* A healthy, idle host needs no status line; the connection banner also covers a lost host. */}
      {state && (!online || running > 0) && <div className="sidebar-footer"><div className="host-status"><span className={'connection-dot ' + (online ? 'connected' : '')}/><span>Host</span><span className="host-state">{online ? 'Connected' : 'Reconnecting'}</span></div>{running > 0 && <div className="host-caption">{running} {running === 1 ? 'active task' : 'active tasks'}</div>}</div>}
    </aside>
    {sidebar && narrow && <button tabIndex={-1} className="sidebar-scrim" aria-label="Close task list" onClick={() => setSidebar(false)}/>}
    <main className="main" inert={narrow && sidebar}><header className="topbar">
      {(narrow || !sidebarVisible) && <button className="icon-button sidebar-toggle" aria-label="Show task list" title="Show task list" aria-expanded={sidebarShown} aria-controls="task-sidebar" onClick={() => narrow ? setSidebar(true) : setSidebarVisible(true)}><Icon name={narrow ? 'menu' : 'sidebar'} size={20}/></button>}
      <div className="breadcrumb">{!mobile && <>{paperName}{(task || manuscriptOpen) && <span className="slash">/</span>}</>}{task ? <div className="task-identity"><h1 title={task.title}>{task.title}</h1><Status task={task}/></div>
        : manuscriptOpen ? <div className="task-identity"><h1>PDF</h1><span className={'status ' + (manuscriptData.data?.build.status === 'failed' ? 'failed' : manuscriptData.data?.build.status === 'ready' ? 'idle' : 'building')}><i/>{!manuscriptData.data ? 'Loading' : manuscriptData.data.build.status === 'building' ? 'Compiling' : manuscriptData.data.build.status === 'failed' ? 'Build failed' : `Compiled ${ago(manuscriptData.data.build.builtAt || Date.now())} ago`.replace('now ago', 'just now')}</span></div>
        : mobile && paperName}</div>
      {manuscriptOpen && project && <>
        <div className="task-state-actions">
          {mobile ? <ActionMenu label="PDF options" actions={[
            { label: 'Recompile', icon: 'refresh', select: () => void loadManuscript(project.id, true) },
            ...(manuscriptData.data?.build.key ? [{ label: 'Open the PDF file', icon: 'external', href: `/api/projects/${project.id}/manuscript.pdf?key=${manuscriptData.data.build.key}` }] : []),
          ]}/> : <>
            <button className="button ghost compact" title="Compile the PDF again" onClick={() => void loadManuscript(project.id, true)}><Icon name="refresh" size={14}/>Recompile</button>
            {manuscriptData.data?.build.key && <a className="button ghost compact" href={`/api/projects/${project.id}/manuscript.pdf?key=${manuscriptData.data.build.key}`} target="_blank" rel="noreferrer" title="Open the PDF file in a new tab"><Icon name="external" size={14}/>Open PDF</a>}
          </>}
        </div>
        {mobile && <div className="view-selector" role="group" aria-label="PDF view">
          <button aria-label="PDF" aria-pressed={manuscriptView === 'pdf'} onClick={() => setManuscriptView('pdf')}><Icon name="paper" size={16}/><span>PDF</span></button>
          <button aria-label={notes.length ? `Notes, ${notes.length}` : 'Notes'} aria-pressed={manuscriptView === 'notes'} onClick={() => { setManuscriptView('notes'); setRegion(false); }}><Icon name="notes" size={16}/><span>Notes</span>{notes.length ? <b className="view-count" aria-hidden="true">{notes.length}</b> : null}</button>
          <button aria-label={projectGit?.files?.length ? `Git, ${projectGit.files.length} changed` : 'Git'} aria-pressed={manuscriptView === 'git'} onClick={() => { setManuscriptView('git'); setRegion(false); }}><Icon name="diff" size={16}/><span>Git</span>{projectGit?.files?.length ? <b className="view-count" aria-hidden="true">{projectGit.files.length}</b> : null}</button>
        </div>}
      </>}
      {task && <>
        <div className="task-state-actions">
          {task.status === 'deleting' ? <button className="button secondary compact" onClick={() => setDeleteTarget(task)}>Retry deletion</button> : task.status === 'uncertain' ? <button className="button secondary compact" disabled={taskActionBusy} aria-busy={taskActionBusy} onClick={() => void action('/tasks/' + task.id + '/reconcile')}><Icon name="refresh" size={14}/>Check status</button> : active && !conversationVisible ? <button className="button secondary compact" aria-label="Pause task" title={`Pause ${agentName(task)}`} disabled={taskActionBusy} aria-busy={taskActionBusy} onClick={pause}><Icon name="pause" size={14}/><span className="button-label">Pause</span></button> : task.error ? <button className="button secondary compact" onClick={() => { setMobileTab('conversation'); setLayout('conversation'); }}>View details</button> : null}
        </div>
        <div className="view-selector" role="group" aria-label="Workspace view">{mobile ? <>
          <button aria-label={pending ? `Review, ${pending} to decide` : 'Review'} aria-pressed={mobileTab === 'review'} onClick={() => setMobileTab('review')}><Icon name="paper" size={16}/><span>Review</span>{pending > 0 && <b className="view-count" aria-hidden="true">{pending}</b>}</button>
          <button aria-label={replyNeeded ? 'Chat (reply needed)' : 'Chat'} aria-pressed={mobileTab === 'conversation'} onClick={() => setMobileTab('conversation')}><Icon name="chat" size={16}/><span>Chat</span>{replyNeeded && <i className="attention-dot" aria-hidden="true"/>}</button>
        </> : <>
          <button aria-label="Review" title="PDF review only" aria-pressed={layout === 'review'} onClick={() => { setLayout('review'); setMobileTab('review'); }}><Icon name="paper" size={16}/><span>Review</span></button>
          <button aria-label="Split" title="Review and chat side by side" aria-pressed={layout === 'split'} onClick={() => setLayout('split')}><Icon name="split" size={16}/><span>Split</span></button>
          <button aria-label={replyNeeded ? 'Chat (reply needed)' : 'Chat'} title="Chat only" aria-pressed={layout === 'conversation'} onClick={() => { setLayout('conversation'); setMobileTab('conversation'); }}><Icon name="chat" size={16}/><span>Chat</span>{replyNeeded && <i className="attention-dot" aria-hidden="true"/>}</button>
        </>}</div>
      </>}
    </header>
      {state && !online && <div className="connection-banner" role="status"><Icon name="alert" size={15}/><span>Connection lost. Showing the last update; your draft is kept.</span><button onClick={() => void refresh(true)}>Retry connection</button></div>}
      {state && bannerRuntime && (!bannerRuntime.connected || !bannerRuntime.authenticated) && <div className="runtime-banner"><Icon name="alert" size={15}/><span>{bannerRuntime.error || `Connecting to ${AGENT_LABELS[bannerAgent]}…`}</span><button disabled={pendingActions.has('/reconnect')} onClick={() => void action('/reconnect')}>{pendingActions.has('/reconnect') ? 'Connecting…' : 'Reconnect'}</button></div>}
      {task ? <div className={`task-grid layout-${layout} show-${mobileTab}`} style={chatWidth ? { '--chat-width': `${chatWidth}px` } as React.CSSProperties : undefined}>
          {!mobile && layout === 'split' && <div className="panel-resizer" role="separator" aria-orientation="vertical" aria-label="Resize chat panel" aria-valuenow={chatWidth || undefined} aria-valuemin={300} tabIndex={0} title="Drag to resize · Double-click to reset" onPointerDown={resizeChat} onDoubleClick={() => setChatWidth(0)} onKeyDown={nudgeChat}/>}
          <section id="review-panel" className="review-panel" aria-label="PDF review">
          {task.status === 'failed' && task.review?.job?.status === 'failed' && <div className="review-build-error" role="status"><Icon name="alert" size={15}/><span>The latest review build failed.</span><button className="button secondary compact" disabled={taskActionBusy} onClick={() => void action('/tasks/' + task.id + '/publish')}>Retry build</button></div>}
          {task.status === 'deleting' ? <div className="review-placeholder"><div className="placeholder-icon"><Icon name="trash" size={22}/></div><h2>Deletion is in progress</h2><p>This task is reserved until its worktree cleanup is confirmed. Use Retry deletion if the connection was interrupted.</p></div> : task.review?.round ? <ReviewFrame key={task.id} task={task} tools={reviewTools}/> : <div className="review-placeholder"><div className="placeholder-icon">{task.status === 'building' ? <span className="spinner large"/> : <Icon name="paper" size={22}/>}</div><h2>{task.status === 'building' ? 'Building PDF review…' : 'No review yet'}</h2><p>{task.status === 'building' ? 'The review will appear when the build finishes.' : 'PDF changes will appear here after Codex finishes editing.'}</p>{['idle', 'interrupted', 'failed', 'reviewing'].includes(task.status) && <button className="button secondary" disabled={taskActionBusy} onClick={() => void action('/tasks/' + task.id + '/publish')}>Build review</button>}</div>}
          <ReviewFeedback task={task} composer={composers.current.get(task.id)!} refresh={() => void refresh(true)} reportError={reportError} onSent={() => { if (selectedRef.current !== task.id) return; setMobileTab('conversation'); setLayout(current => current === 'review' ? 'split' : current); }}/>
        </section><Activity key={task.id} task={task} models={runtimes[task.agent || 'codex']?.models || []} composer={composers.current.get(task.id)!} answerDrafts={answerDrafts.current} items={timeline.taskId === task.id ? timeline.items : timelineCache.current.get(task.id) || []} loading={timeline.taskId === task.id ? itemsLoading : !timelineCache.current.has(task.id)} loadError={timelineError.taskId === task.id ? timelineError.message : ''} retry={() => void refreshTimeline(task.id)} requests={state?.requests.filter(r => r.taskId === task.id) || []} refresh={() => void refresh(true)} reportError={reportError} pause={pause} pausing={taskActionBusy} openReview={(mobile ? mobileTab === 'conversation' : layout === 'conversation') ? () => { setMobileTab('review'); setLayout(current => current === 'conversation' ? 'split' : current); } : undefined}/></div>
      : manuscriptOpen && project ? <ManuscriptView project={project} data={manuscriptData.data} error={manuscriptData.error} view={manuscriptView} setView={setManuscriptView} region={region} setRegion={setRegion} active={activeNote} setActive={setActiveNote} actions={noteActions} onGit={status => { setGit({ projectId: project.id, status }); setManuscript(current => current.projectId === project.id && current.data ? { ...current, data: { ...current.data, git: status } } : current); }}/>
      : !state ? <div className="home"><div className="home-inner"><div className="home-mark"><span className="spinner"/></div><h1>Opening your workspace</h1><p className="home-copy" role="status">{connectionError || 'Connecting to your papers and tasks…'}</p>{connectionError && <button className="button secondary" onClick={() => void refresh(true)}>Retry connection</button>}</div></div>
      : project ? <div className="home"><div className="home-inner compose">
          <img className="home-logo" src={logo} alt=""/>
          <h1>What are we revising next?</h1>
          <Composer large autoFocus inputRef={newTaskInput} label="Describe the revision" value={newDraft} onChange={setNewDraft} readOnly={creating} onSubmit={() => void createTask()} placeholder="Describe the revision, what to preserve, and how to judge the result…"
            footer={<div className="composer-options">
              {agentOptions(creating)}
            </div>}
            action={<button className="send-button" type="submit" aria-label="Start task" title="Start task (Enter)" disabled={creating || !newDraft.trim()} aria-busy={creating}>{creating ? <span className="spinner light"/> : <Icon name="arrowUp" size={18}/>}</button>}/>
          {createError && <p className="inline-error home-error" role="alert">{createError}</p>}
          {unavailable(agentChoice) && <p className="inline-error home-error" role="status">{AGENT_LABELS[agentChoice]} is unavailable on this host: {runtimes[agentChoice]?.error}</p>}
          {runtimes[agentChoice]?.usage && <UsageSummary agent={AGENT_LABELS[agentChoice]} usage={runtimes[agentChoice]!.usage!}/>}
        </div></div>
      : <div className="home"><div className="home-inner"><img className="home-logo" src={logo} alt=""/><h1>Add your first paper</h1><p className="home-copy">Connect a LaTeX Git repository on this host. An agent edits it in isolated worktrees, and you review every change as a PDF diff.</p><button className="button primary" onClick={() => openProject()}><Icon name="plus" size={16}/>Add paper</button></div></div>}
    </main>
    {error && !modal && <div role="alert" className="toast"><Icon name="alert" size={16}/><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" size={14}/></button></div>}
    {deleteTarget && <DeleteTaskDialog task={state?.tasks.find(t => t.id === deleteTarget.id) || deleteTarget} submit={() => api('/tasks/' + deleteTarget.id + '/delete', { confirm: true })} onClose={() => setDeleteTarget(null)} onDeleted={() => taskDeleted(deleteTarget.id)} refresh={() => void refresh(true)}/>}
    {modal && <dialog ref={modalRef} onKeyDown={keepDialogFocus} className="modal-backdrop" aria-labelledby="modal-title" onCancel={e => { e.preventDefault(); if (!busy) setModal(null); }} onClick={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section className="modal"><button className="modal-close icon-button" aria-label="Close" disabled={busy} onClick={() => setModal(null)}><Icon name="close"/></button><h2 id="modal-title">Add a paper</h2><p className="modal-description">Choose an existing LaTeX Git repository on this host. It needs at least one commit and must compile with latexmk.</p><form onSubmit={e => void saveProject(e)}>
      <label>Repository path<input required maxLength={4000} value={form.path} onChange={e => setForm({ ...form, path: e.target.value })} placeholder="/Users/you/papers/my-paper" autoComplete="off" spellCheck={false}/></label>
      <label>Display name (optional)<input maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="My research paper"/></label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => setModal(null)}>Cancel</button><button disabled={busy} className="button primary" type="submit">{busy ? 'Adding…' : 'Add paper'}</button></div>
    </form></section></dialog>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
