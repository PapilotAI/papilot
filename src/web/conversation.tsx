import { Resource } from './resources.tsx';
import { Suspense, lazy, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import '../../engine/src/web/legacy-storage.ts';
import { aiReviewSummary, isFeedbackPrompt } from '../conversation.ts';
import { noteGroups } from '../note-groups.ts';
import { readNotesInstructions, type NoteSummary } from '../notes.ts';
import type { AgentId, Attachment, Author, FeedbackSummary, PendingRequest, RuntimeStatus, Skill, Task, TimelineItem } from '../shared.ts';
import { agentLabel } from './agent-choice.ts';
import { AttachmentDraft, type UploadAttachment } from './attachment-draft.ts';
import { DraftAttachments, MessageAttachments, useAttachmentDraft } from './attachments.tsx';
import { ComposerDraft, pendingReviewFeedback, sendsMessage } from './composer.ts';
import { ContextMeter } from './context-meter.tsx';
import { ChangeSummary, FileDiffs } from './file-changes.tsx';
import { errorText, locale, t, tn, useLanguage } from './i18n.ts';
import { Icon } from './icons.tsx';
import { Markdown } from './markdown.tsx';
import { SubmittedNoteContent } from './note-content.tsx';
import { GroupCard } from './note-groups.tsx';
import { noteLocation } from './note-location.ts';
import { NoteReturnAction, NoteReturnError, useNoteResults } from './note-results.tsx';
import { readPlace, savePlace } from './places.ts';
import { isPlayground, requestPlaygroundDownload } from './playground-mode.ts';
import { visibleTimeline } from './refresh.ts';
import { ReviewDraftCards } from './review-draft-cards.tsx';
import { reviewDraft, reviewNoteSummary, reviewSubmission, useReviewDraft } from './review-draft.ts';
import { SkillChip, SkillMenu, SkillPicker, matchSkills, skillQuery } from './skills.tsx';
import { browserStorage } from './storage.ts';
import { TaskModelPicker } from './task-model-picker.tsx';
import { TaskPermissionOptions } from './task-permissions.tsx';
import { toolIcon, toolNote, toolSentence, toolSummary } from './tool-calls.ts';
import { type RefreshUsage } from './usage.tsx';
export const agentName = (task: Task) => agentLabel(task.agent || 'codex') || 'Codex';
export const ACTIVE = ['running', 'waiting_input', 'queued'];
export const preparingLabel = (task: Task) => task.mode === 'review' ? t('Preparing the review PDF…') : t('Preparing…');
export const touch = () => window.matchMedia('(pointer: coarse)').matches;
function time(timestamp: number) { return new Date(timestamp).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }); }
const PlaygroundProgress = import.meta.env.MODE === 'playground' ? lazy(() => import('./playground/progress.tsx').then(module => ({ default: module.PlaygroundProgress }))) : null;
export type ConversationApi = <T = any>(route: string, body?: unknown, signal?: AbortSignal) => Promise<T>;

/** The standalone workspace and embedded clients share the same conversation. */
export function createConversation(api: ConversationApi) {
  const refreshUsage: RefreshUsage = async agent => import.meta.env.MODE === 'playground' ? null : (await api(`/runtime/${agent}/usage`, {})).usage;
  const uploadAttachment = (projectId: string, file: File, signal: AbortSignal) => api<Attachment>(`/projects/${projectId}/attachments`, file, signal);
  // One composer for new tasks and follow-ups: grows with its text, sends on
  // Enter (see sendsMessage), and keeps its actions inside the same surface.
  // With skills, "/" opens the skill menu; the chosen skill sits above the text
  // as a chip, the text becomes optional, and Backspace in an empty box removes it.
  function Composer({ label, value, placeholder, onChange, onSubmit, readOnly, autoFocus, inputRef, footer, action, large, skills, skill, onSkill, attachments, upload, filesDisabled, imageHint, reviewContent }: { reviewContent?: React.ReactNode; label: string; value: string; placeholder: string; onChange: (value: string) => void; onSubmit: () => void; readOnly?: boolean; autoFocus?: boolean; inputRef?: React.RefObject<HTMLTextAreaElement | null>; footer: React.ReactNode | ((attach: () => void) => React.ReactNode); action: React.ReactNode; attachments?: AttachmentDraft; upload?: UploadAttachment; filesDisabled?: boolean; imageHint?: boolean; large?: boolean; skills?: Skill[]; skill?: Skill | null; onSkill?: (skill: Skill | null) => void }) {
    const fallback = useRef<HTMLTextAreaElement>(null), input = inputRef || fallback;
    const fileInput = useRef<HTMLInputElement>(null), dragDepth = useRef(0);
    const [dragging, setDragging] = useState(false);
    const canAttach = Boolean(attachments && upload && !readOnly && !filesDisabled);
    function addFiles(files: File[]) { if (canAttach && files.length) { void attachments!.add(files, upload!); input.current?.focus(); } }
    const menuId = useId(), [dismissed, setDismissed] = useState<string | null>(null), [active, setActive] = useState(0);
    const query = skills?.length && onSkill && !readOnly ? skillQuery(value) : null;
    const open = query !== null && dismissed !== value, matches = open ? matchSkills(skills!, query) : [];
    useEffect(() => setActive(0), [query]);
    // Escape closes the menu until the text changes.
    useEffect(() => { if (dismissed !== null && value !== dismissed) setDismissed(null); }, [value, dismissed]);
    useLayoutEffect(() => { const element = input.current; if (!element) return; element.style.height = 'auto'; element.style.height = `${element.scrollHeight}px`; }, [input, value]);
    useEffect(() => { if (autoFocus && !touch()) input.current?.focus(); }, [autoFocus, input]);
    function pick(chosen: Skill) { onSkill?.(chosen); onChange(''); input.current?.focus(); }
    function keyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (open && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matches.length) { e.preventDefault(); setActive(index => (index + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length); return; }
        if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && matches.length) { e.preventDefault(); pick(matches[Math.min(active, matches.length - 1)]); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(value); return; }
      }
      if (e.key === 'Backspace' && skill && onSkill && !value && !readOnly) { e.preventDefault(); onSkill(null); return; }
      if (sendsMessage(e.nativeEvent, touch())) { e.preventDefault(); onSubmit(); }
    }
    return <form className={'composer' + (large ? ' large' : '') + (dragging ? ' dragging' : '')}
      onDragEnter={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); if (canAttach && ++dragDepth.current === 1) setDragging(true); }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = canAttach ? 'copy' : 'none'; } }}
      onDragLeave={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
      onDrop={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}
      onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); addFiles(files); const text = event.clipboardData.getData('text/plain'); if (canAttach && text && input.current) { const area = input.current; onChange(value.slice(0, area.selectionStart) + text + value.slice(area.selectionEnd)); } } }}
      onSubmit={e => { e.preventDefault(); onSubmit(); }} onPointerDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); } }}>
      {reviewContent}
      {attachments && upload && <><input ref={fileInput} type="file" multiple hidden aria-label={t('Choose attachments')} disabled={!canAttach} onChange={event => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }}/><DraftAttachments draft={attachments} upload={upload} discard={file => { void api(`/projects/${file.projectId}/attachments/${file.id}/discard`, {}).catch(() => {}); }} disabled={readOnly || filesDisabled}/></>}
      {dragging && <div className="attachment-drop-hint">{t('Drop files to attach')}</div>}
      {imageHint && <p className="attachment-agent-hint">{t('Antigravity opens images through its file tools. For direct image input, choose Codex or Claude.')}</p>}
      {open && <SkillMenu id={menuId} skills={matches} active={active} onActive={setActive} onPick={pick}/>}
      {skill && <div className="composer-skill"><SkillChip skill={skill} onRemove={onSkill && !readOnly ? () => { onSkill(null); input.current?.focus(); } : undefined}/></div>}
      <textarea ref={input} rows={1} aria-label={label} placeholder={skill ? (skill.source !== 'builtin' && skill.hint) || t('Details (optional)') : placeholder} value={value} readOnly={readOnly} onChange={e => onChange(e.target.value)} onKeyDown={keyDown}
        {...(onSkill && skills?.length ? { 'aria-autocomplete': 'list' as const, 'aria-controls': open ? menuId : undefined, 'aria-activedescendant': open && matches.length ? `${menuId}-${Math.min(active, matches.length - 1)}` : undefined } : {})}/>
      <div className="composer-footer">{typeof footer === 'function' ? footer(() => fileInput.current?.click()) : footer}{action}</div>
    </form>;
  }

  function RequestCard({ request, agent, answerDrafts, onDone }: { request: PendingRequest; agent: string; answerDrafts: Map<string, Record<string, string>>; onDone: () => void }) {
    const [answers, updateAnswers] = useState<Record<string, string>>(() => answerDrafts.get(request.id) || {});
    function setAnswers(next: Record<string, string>) { answerDrafts.set(request.id, next); updateAnswers(next); }
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const questions = request.method.endsWith('requestUserInput') ? request.params.questions || [] : [];
    async function respond(decision?: string) { setBusy(true); setError(''); try { await api('/requests/' + request.id, { decision, answers }); answerDrafts.delete(request.id); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
    return <div className="request-card"><h3><Icon name={questions.length ? 'chat' : 'alert'} size={16}/>{questions.length ? t('{agent} needs your input', { agent }) : t('Approve this action')}</h3>
      {questions.map((q: any) => <fieldset className="question" key={q.id}><legend>{q.question || q.header}</legend>{q.options?.length > 0 && <div className="answer-options">{q.options.map((option: any) => <button type="button" disabled={busy} aria-pressed={answers[q.id] === option.label} className={answers[q.id] === option.label ? 'selected' : ''} key={option.label} onClick={() => setAnswers({ ...answers, [q.id]: option.label })}>{option.label}{option.description && <small>{option.description}</small>}</button>)}</div>}{!(q.isOther === false && q.options?.length > 0) && <input disabled={busy} aria-label={q.question || q.header} placeholder={t('Or type your own answer')} value={answers[q.id] || ''} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })}/>}</fieldset>)}
      {!questions.length && <><p>{request.params.reason || t('{agent} is requesting permission for this action.', { agent })}</p><pre>{request.params.command || (request.params.permissions ? JSON.stringify(request.params.permissions, null, 2) : request.params.grantRoot || t('Apply file changes'))}</pre></>}
      {error && <p className="inline-error" role="alert">{error}</p>}<div className="button-row">{!questions.length && <button disabled={busy} className="button secondary" onClick={() => void respond('decline')}>{t('Decline')}</button>}<button disabled={busy || questions.some((q: any) => !answers[q.id]?.trim())} className="button primary" onClick={() => void respond(questions.length ? undefined : 'accept')}>{busy ? t('Submitting…') : questions.length ? t('Reply to {agent}', { agent }) : t('Allow this action')}</button></div>
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
    return <button type="button" className="message-action" aria-label={copied ? t('Copied') : t('Copy message')} onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} size={14}/><span>{copied ? t('Copied') : t('Copy')}</span></button>;
  }

  // Commands arrive wrapped in the login shell that ran them, and files with
  // absolute paths; the chat shows the command itself and paths in the task.
  const shellCommand = (text: string) => text.match(/^\/bin\/(?:ba|z)?sh -lc (['"])([\s\S]*)\1$/)?.[2] ?? text;
  const taskPath = (file: string, root: string) => root && file.startsWith(root + '/') ? file.slice(root.length + 1) : file;
  // Items are named task:turn:item; a user message starts the next turn.
  const turnOf = (item: TimelineItem) => item.type === 'user' ? null : item.id.split(':')[1] || null;
  const editedFiles = (item: TimelineItem, root: string) => item.text.split('\n').filter(Boolean).map(file => taskPath(file, root));
  const toolState = (item: TimelineItem) => item.status === 'inProgress' ? 'running' : item.status === 'interrupted' ? 'stopped' : item.status && item.status !== 'completed' ? 'failed' : '';

  // Preserve names on historical messages from formerly shared workspaces.
  const senderOf = (author: Author | undefined) => ({ mine: !author, name: author?.name || '' });

  const senderLabel = (sender: { mine: boolean; name: string }, at: number) => sender.mine ? t('You, {time}', { time: time(at) }) : t('{name}, {time}', { name: sender.name, time: time(at) });
  const SenderName = ({ sender }: { sender: { mine: boolean; name: string } }) => sender.mine ? null : <div className="message-author">{sender.name}</div>;

  // A first message built from PDF notes shows the notes, not the instructions around them.
  function NotesMessage({ item, notes }: { item: TimelineItem; notes: NoteSummary[] }) {
    const sender = senderOf(item.meta?.author);
    const results = useNoteResults();
    const renderNote = (note: NoteSummary, index: number) => <li key={index} data-note-result={`${item.id}:${index}`} tabIndex={0} data-returned={results?.notes.find(result => result.key === `${item.id}:${index}`)?.returned || undefined}
      onClick={event => { if (!(event.target as Element).closest('button, input, textarea, a, [role="radiogroup"]')) results?.focusNote(`${item.id}:${index}`); }}
      onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); results?.focusNote(`${item.id}:${index}`); } }} className={results?.selected === `${item.id}:${index}` ? 'linked-note-selected' : ''}>
        <SubmittedNoteContent note={note} index={index}><NoteReturnAction noteKey={`${item.id}:${index}`}/></SubmittedNoteContent>
        <NoteReturnError noteKey={`${item.id}:${index}`}/>
      </li>;
    return <article className="message user notes-message" aria-label={senderLabel(sender, item.createdAt)}><SenderName sender={sender}/><div className="message-body" title={time(item.createdAt)}>
      {item.meta?.skill && <SkillChip skill={item.meta.skill}/>}
      {item.meta?.notes && item.text && <p className="notes-request">{item.text}</p>}
      <div className="sent-notes-head"><Icon name="notes" size={14}/>{notes.some(note => note.group) ? t('PDF annotations') : tn(notes.length, 'Note on the PDF', '{n} notes on the PDF')}</div>
      {noteGroups(notes).map(({ group, entries }) => <GroupCard key={group} group={group} count={entries.length} active={entries.some(({ index }) => results?.selected === `${item.id}:${index}`)}>
        {item.meta?.groupInstructions?.[group] && <p className="group-instruction-sent">{item.meta.groupInstructions[group]}</p>}
        <ol className="sent-notes">{entries.map(({ note, index }) => renderNote(note, index))}</ol>
      </GroupCard>)}
      <ol className="sent-notes">{notes.map((note, index) => !note.group && renderNote(note, index))}</ol>
      <MessageAttachments files={item.meta?.attachments}/>
      {item.meta?.feedback && <details className="feedback-attachment"><summary><Icon name="paper" size={13}/>{t('With review feedback')}</summary><FeedbackDetails feedback={item.meta.feedback}/></details>}
    </div></article>;
  }

  // Review feedback as the author gave it: decisions as counts, comments as written.
  function FeedbackDetails({ feedback }: { feedback: FeedbackSummary }) {
    const counts = [feedback.accepted && ['accepted', t('{n} accepted', { n: feedback.accepted })], feedback.rejected && ['rejected', t('{n} rejected', { n: feedback.rejected })], feedback.comments.length && ['commented', tn(feedback.comments.length, '{n} comment', '{n} comments')], feedback.undone && ['undone', t('{n} undone', { n: feedback.undone })], feedback.buildError && ['failed', t('build error')]].filter(Boolean) as string[][];
    return <>
      {counts.length > 0 && <div className="feedback-counts">{counts.map(([kind, text]) => <span key={kind} className={kind}>{text}</span>)}</div>}
      {feedback.comments.length > 0 && <ol className="sent-notes">{feedback.comments.map((comment, index) => <li key={index}><span className="sent-note-where">{noteLocation(comment.where)}</span><p>{comment.text}</p></li>)}</ol>}
    </>;
  }

  function UserMessage({ item, agent }: { item: TimelineItem; agent: string }) {
    const sender = senderOf(item.meta?.author);
    const notes = item.meta?.notes || readNotesInstructions(item.text);
    if (notes) return <NotesMessage item={item} notes={notes}/>;
    const { skill, feedback, sendsFeedback, build } = item.meta || {};
    // Papilot sent the agent a build its own edits broke.
    if (build) return <article className="message user notes-message build-message" aria-label={t('Papilot sent the build error to {agent}, {time}', { agent, time: time(item.createdAt) })}><div className="message-body" title={time(item.createdAt)}>
      <div className="sent-notes-head"><Icon name="alert" size={14}/>{t('Build failed · sent to {agent}', { agent })}</div>
      <p className="build-error">{[build.error, ...build.details].join('\n')}</p>
    </div></article>;
    if (sendsFeedback || isFeedbackPrompt(item.text)) return <article className="message user notes-message" aria-label={sender.mine ? t('You sent review feedback, {time}', { time: time(item.createdAt) }) : t('{name} sent review feedback, {time}', { name: sender.name, time: time(item.createdAt) })}><SenderName sender={sender}/><div className="message-body" title={time(item.createdAt)}>
      <div className="sent-notes-head"><Icon name="paper" size={14}/>{t('Review feedback')}</div>
      {feedback && <FeedbackDetails feedback={feedback}/>}
    </div></article>;
    return <article className="message user" aria-label={senderLabel(sender, item.createdAt)}><SenderName sender={sender}/><div className="message-body" title={time(item.createdAt)}>
      {skill && <SkillChip skill={skill}/>}{skill && item.text ? '\n' : ''}{item.text}
      <MessageAttachments files={item.meta?.attachments}/>
      {feedback && <details className="feedback-attachment"><summary><Icon name="paper" size={13}/>{t('With review feedback')}</summary><FeedbackDetails feedback={feedback}/></details>}
    </div></article>;
  }

  // Memoized: polling and typing re-render the thread, and unchanged items can skip it.
  // The pages an agent looked at, small enough to glance at; each opens full size.
  function PageStrip({ items }: { items: TimelineItem[] }) {
    const pages = items.flatMap(item => (item.pages || []).map(page => ({ ...page, url: `/api/tasks/${encodeURIComponent(item.taskId)}/pages/${encodeURIComponent(page.file)}` })));
    if (!pages.length) return null;
    return <div className="tool-pages">{pages.map(page => {
      const name = page.label ? t('p. {page}', { page: page.label }) : t('PDF page {page}', { page: page.index });
      return <Resource key={page.url} route={page.url}>{url => <a href={url} target="_blank" rel="noopener noreferrer" title={name}><img src={url} alt={name} loading="lazy"/><span>{name}</span></a>}</Resource>;
    })}</div>;
  }

  function toolLabel(item: TimelineItem, root: string) {
    const files = item.type === 'files' ? editedFiles(item, root) : [];
    return item.type === 'command' ? shellCommand(item.text) || t('Run command') : item.type === 'files' ? (files.length === 1 ? t('Edited {file}', { file: files[0] }) : t('Edited {n} files', { n: files.length })) : item.type === 'pdf' ? (item.text ? t('Viewed the PDF: {places}', { places: item.text }) : t('Viewed the PDF')) : toolSentence(item) || item.text || t('Run tool');
  }

  // One worker in Collaboration mode can be stopped; the coordinator does its work instead.
  function StopWorker({ item }: { item: TimelineItem }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    async function stop() { setBusy(true); setError(''); try { await api(`/tasks/${encodeURIComponent(item.taskId)}/workers/stop`, { item: item.id }); } catch (e) { setError((e as Error).message); setBusy(false); } }
    return <div className="worker-stop"><button type="button" className="button secondary compact" disabled={busy} onClick={() => void stop()}>{t('Stop worker')}</button>{error && <p className="inline-error" role="alert">{error}</p>}</div>;
  }

  const TimelineEntry = memo(function TimelineEntry({ item, agent, root, pages = true, steps }: { item: TimelineItem; agent: string; root: string; pages?: boolean; steps?: TimelineItem[] }) {
    // Memoized, so it follows a language change itself rather than through App.
    useLanguage();
    if (PlaygroundProgress && item.type === 'demo-progress') return <Suspense fallback={null}><PlaygroundProgress item={item}/></Suspense>;
    if (item.type === 'user') return <UserMessage item={item} agent={agent}/>;
    if (item.type === 'assistant') return <article className="message assistant" aria-label={`${agent}, ${time(item.createdAt)}`}><div className="message-body markdown"><Markdown text={item.text}/></div><div className="message-actions"><CopyButton text={item.text}/><time dateTime={new Date(item.createdAt).toISOString()}>{time(item.createdAt)}</time></div></article>;
    const files = item.type === 'files' ? editedFiles(item, root) : [];
    const label = toolLabel(item, root);
    const detail = item.type === 'files' ? null : item.detail;
    const state = toolState(item);
    // A running worker's latest step shows on its delegation line, as with a subagent.
    const latest = state === 'running' ? steps?.findLast(step => step.type !== 'assistant') : undefined;
    const note = latest ? toolLabel(latest, root) : toolNote(item);
    const delegation = item.type === 'tool' && item.text.startsWith('workflow_delegate');
    const row = <details className={'tool-item ' + state} data-kind={item.type === 'tool' ? item.tool?.kind || 'tool' : item.type}><summary><Icon name={toolIcon(item)} size={14}/><span className="tool-label">{label}{note && <span className="tool-note">{note}</span>}</span>{state === 'running' ? <span className="spinner" aria-label={t('Running')}/> : state && <span className="tool-status">{item.status === 'declined' ? t('Declined') : state === 'stopped' ? t('Stopped') : t('Failed')}</span>}</summary>
      {item.type === 'files' ? <FileDiffs changes={item.changes} files={files}/> : detail && <pre>{detail}</pre>}
      {steps?.length ? <div className="tool-group-items worker-steps">{steps.map(step => step.type === 'assistant'
        ? <div key={step.id} className="worker-message markdown"><Markdown text={step.text}/></div>
        : <TimelineEntry key={step.id} item={step} agent={agent} root={root} pages={false}/>)}</div> : null}
      {delegation && item.changes?.length ? <FileDiffs changes={item.changes} files={item.changes.map(change => change.path)}/> : null}
      {delegation && state === 'running' && <StopWorker item={item}/>}
    </details>;
    return pages && item.pages?.length ? <>{row}<PageStrip items={[item]}/></> : row;
  });

  // Consecutive commands, edits and tool calls fold into one line that opens to the list.
  function ToolGroup({ items, agent, root, steps }: { items: TimelineItem[]; agent: string; root: string; steps: Map<string, TimelineItem[]> }) {
    // The thread reuses its elements, so the summary follows a language change itself.
    useLanguage();
    const summary = toolSummary(items, item => editedFiles(item, root));
    const running = items.some(item => toolState(item) === 'running'), failed = items.filter(item => toolState(item) === 'failed').length;
    return <><details className="tool-group"><summary><Icon name={summary.icon} size={14}/><span className="tool-group-label">{summary.text}</span>{running ? <span className="spinner" aria-label={t('Running')}/> : failed ? <span className="tool-status">{t('{n} failed', { n: failed })}</span> : null}<Icon name="chevronDown" size={13}/></summary>
      <div className="tool-group-items">{items.map(item => <TimelineEntry key={item.id} item={item} agent={agent} root={root} pages={false} steps={steps.get(item.id)}/>)}</div>
    </details><PageStrip items={items}/></>;
  }

  function timelineEntries(items: TimelineItem[]) {
    const entries: TimelineItem[][] = [];
    const message = (item: TimelineItem) => item.type === 'user' || item.type === 'assistant' || (isPlayground && item.type === 'demo-progress');
    for (const item of items) {
      const last = entries[entries.length - 1];
      if (!message(item) && last && !message(last[0])) last.push(item); else entries.push([item]);
    }
    return entries;
  }

  function Activity({ runtimes, relatedTasks, onOpenTask, source, onRevealQuote, task, runtime, reconnecting, onReconnect, skills, composer, answerDrafts, items, loading, loadError, retry, requests, refresh, onTaskSaved, reportError, pause, pausing, openReview, feedback, connection, tools, lead, errorActions }: { runtimes: Partial<Record<AgentId, RuntimeStatus>>; relatedTasks: Task[]; onOpenTask: (id: string) => void; source?: { tabs: React.ReactNode; panel: React.ReactNode; selected: boolean }; errorActions?: React.ReactNode; tools?: React.ReactNode; lead?: React.ReactNode; onRevealQuote: () => void; task: Task; runtime?: RuntimeStatus; reconnecting: boolean; onReconnect: () => void; skills: Skill[]; composer: ComposerDraft; answerDrafts: Map<string, Record<string, string>>; items: TimelineItem[]; loading: boolean; loadError: string; retry: () => void; requests: PendingRequest[]; refresh: () => void; onTaskSaved: (task: Task) => void; reportError: (e: unknown) => void; pause: () => void; pausing: boolean; openReview?: () => void; feedback?: React.ReactNode; connection?: React.ReactNode }) {
    const input = useRef<HTMLTextAreaElement>(null);
    const reviewNotes = reviewDraft(task.id), notes = useReviewDraft(task.id);
    const [savingModel, setSavingModel] = useState(false);
    const [savingPermissions, setSavingPermissions] = useState(false);
    const { text: draft, sending } = useSyncExternalStore(composer.subscribe, composer.getSnapshot);
    const files = useAttachmentDraft(`papilot:files:task:${task.id}`);
    const [skill, setSkill] = useState<Skill | null>(() => skills.find(item => item.id === browserStorage.getItem('papilot:draft-skill:' + task.id)) || null);
    const restoringSkill = useRef(browserStorage.getItem('papilot:draft-skill:' + task.id));
    useEffect(() => {
      const saved = skills.find(item => item.id === restoringSkill.current);
      if (saved) { restoringSkill.current = null; setSkill(saved); }
    }, [skills]);
    useEffect(() => { if (restoringSkill.current) return; if (skill) browserStorage.setItem('papilot:draft-skill:' + task.id, skill.id); else browserStorage.removeItem('papilot:draft-skill:' + task.id); }, [skill, task.id]);
    useEffect(() => setSkill(current => current ? skills.find(item => item.id === current.id) || null : null), [skills]);
    const scroller = useRef<HTMLDivElement>(null);
    // A chat the author scrolled back through opens at the same place; one that
    // was following the latest messages opens at the end, as before.
    const place = 'chat:' + task.id, back = useRef(readPlace<number>(place));
    const shouldFollow = useRef(back.current === undefined);
    const [following, setFollowing] = useState(back.current === undefined);
    // A hidden chat (the Review tab on a phone) has no size yet; it goes back when shown.
    const settled = useRef(false); settled.current = !loading && items.length > 0;
    function goBack() {
      const box = scroller.current, top = back.current;
      if (!box || top === undefined || !box.clientHeight) return;
      box.scrollTop = top;
      if (Math.abs(box.scrollTop - top) < 2 || settled.current) back.current = undefined;
    }
    useLayoutEffect(goBack, [items, requests, loading]);
    const noteResults = useNoteResults();
    useLayoutEffect(() => { if (noteResults?.selected) { back.current = undefined; shouldFollow.current = false; setFollowing(false); } }, [noteResults?.selected, noteResults?.reveal]);
    function latest() { back.current = undefined; shouldFollow.current = true; setFollowing(true); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }
    useEffect(() => { if (shouldFollow.current && !scroller.current?.querySelector(':popover-open')) latest(); }, [items, requests]);
    useEffect(() => {
      if (!scroller.current) return;
      const observer = new ResizeObserver(() => { if (back.current !== undefined) goBack(); else if (shouldFollow.current) latest(); });
      observer.observe(scroller.current); return () => observer.disconnect();
    }, []);
    const feedbackCount = task.mode === 'review' ? 0 : pendingReviewFeedback(task.review);
    const readyReview = reviewSubmission(notes, draft, skill?.id);
    const emptyNotes = notes.notes.length - readyReview.notes.length;
    const canSend = Boolean(draft.trim() || skill || files.files.length || readyReview.notes.length || readyReview.instructions.trim() || feedbackCount);
    async function submit() {
      if (savingPermissions || savingModel || composer.sending || ['uncertain', 'deleting'].includes(task.status) || task.preparation || files.draft.getSnapshot().blocked) return;
      if (isPlayground && canSend) { requestPlaygroundDownload(); return; }
      const submitted = reviewSubmission(reviewNotes.getSnapshot(), composer.text, skill?.id), attached = files.draft.getSnapshot().files;
      const source = !composer.text.trim() && !skill && !attached.length && !submitted.notes.length && !submitted.instructions.trim() && feedbackCount ? 'feedback' : 'draft';
      reviewNotes.setBusy(true);
      try {
        if (await composer.submit(source, message => api('/tasks/' + task.id + '/messages', message), skill?.id, attached.map(file => file.id), submitted.notes.map(reviewNoteSummary), submitted.instructions)) {
          reviewNotes.clear(submitted); files.draft.clear(attached); shouldFollow.current = true;
          if (skill) setSkill(current => current === skill ? null : current);
          refresh();
        }
      } catch (e) { reportError(e); }
      finally { reviewNotes.setBusy(false); }
    }
    const active = ACTIVE.includes(task.status), blocked = ['uncertain', 'deleting'].includes(task.status);
    // The draft re-renders this panel on every keystroke; the same elements let
    // React skip the conversation until its items change.
    const agent = agentName(task), review = task.mode === 'review', root = task.worktree;
    const thread = useMemo(() => {
      // Collaboration workers' steps belong under their delegation, not in the thread.
      const steps = new Map<string, TimelineItem[]>(), lines = new Set(items.map(item => item.id));
      const nested = (item: TimelineItem) => Boolean(item.parent && lines.has(item.parent));
      for (const item of items) if (nested(item)) { const list = steps.get(item.parent!); if (list) list.push(item); else steps.set(item.parent!, [item]); }
      return timelineEntries(visibleTimeline(items).filter(item => item.type !== 'reviewOutput' && !nested(item)).map(item => review && item.type === 'assistant' ? { ...item, text: aiReviewSummary(item.text) } : item))
      .flatMap((entry, index, all) => {
        const shown = entry.length > 1 ? <ToolGroup key={entry[0].id} items={entry} agent={agent} root={root} steps={steps}/> : <TimelineEntry key={entry[0].id} item={entry[0]} agent={agent} root={root} steps={steps.get(entry[0].id)}/>;
        // A finished turn that changed files ends with where it changed the paper.
        const turn = turnOf(entry[0]), next = all[index + 1];
        if (!turn || (next && (next[0].type !== 'user' && turnOf(next[0]) === turn)) || (!next && active)) return [shown];
        const edits = all.filter(other => turnOf(other[0]) === turn).flat().filter(item => item.type === 'files' && item.changes?.length);
        return edits.length ? [shown, <ChangeSummary key={turn + ':changes'} items={edits}/>] : [shown];
      });
    }, [items, review, agent, root, active]);
    const hint = task.status === 'deleting' ? t('This task is being deleted') : task.status === 'uncertain' ? t('Check task status before sending') : task.preparation ? t('Send more instructions once the task has started.') : sending ? t('Sending…')
      : emptyNotes ? canSend ? tn(emptyNotes, '{n} empty comment will stay in drafts', '{n} empty comments will stay in drafts') : t('Write a comment or message to send.') : active ? t('{agent} is working · new instructions run next', { agent: agentName(task) }) : '';
    // A source tab beside the chat hides the chat while it is selected; both stay as they were.
    return <section id="conversation-panel" className="activity-panel" data-side={source?.selected ? 'source' : undefined} aria-label={t('{agent} conversation', { agent: agentName(task) })}><div className="panel-heading">{lead}{source?.tabs}{tools && <div className="panel-tools">{tools}</div>}</div>
      {source && <div className="side-pane" hidden={!source.selected}>{source.panel}</div>}
      <div className="conversation-history"><div className="messages" ref={scroller} onScroll={() => { if (scroller.current && back.current === undefined) { const el = scroller.current; shouldFollow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; setFollowing(shouldFollow.current); savePlace(place, shouldFollow.current ? undefined : Math.round(el.scrollTop)); } }}><div className="thread">
        {loading && <p className="muted" role="status">{t('Loading conversation…')}</p>}
        {loadError && <div className="conversation-error" role="alert"><p>{loadError}</p><button className="button secondary compact" onClick={retry}>{t('Retry conversation')}</button></div>}
        {relatedTasks.map(related => <p className="restart-link" key={related.id}>{related.id === task.restart?.taskId ? t('Restarted from') : t('Replacement task')}: <button type="button" onClick={() => onOpenTask(related.id)}>{related.title}</button></p>)}
        {thread}
        {requests.map(r => <RequestCard key={r.id} request={r} agent={agentName(task)} answerDrafts={answerDrafts} onDone={refresh}/>)}
        {task.status === 'running' && <div className="working"><span className="working-dots"><i/><i/><i/></span>{t('{agent} is working on this task', { agent: agentName(task) })}</div>}
        {task.status === 'queued' && <p className="muted">{t('Task saved. Waiting for an available {agent} session.', { agent: agentName(task) })}</p>}
        {task.status === 'preparing' && <p className="muted" role="status">{preparingLabel(task)}</p>}
        {openReview && task.status === 'reviewing' && task.review?.counts?.pending ? <div className="review-ready"><Icon name="paper" size={16}/><span>{tn(task.review.counts.pending, '{n} change to review', '{n} changes to review')}</span><button className="button secondary compact" onClick={openReview}>{t('Open review')}</button></div> : null}
        {feedback}
        {task.error && <div className="task-error"><Icon name="alert" size={16}/><div><strong>{t('This step needs attention')}</strong><p>{errorText(task.error)}</p>{errorActions}</div></div>}
      </div></div>{!following && <button className="jump-latest" onClick={latest}><Icon name="arrowDown" size={14}/>{t('Latest messages')}</button>}</div>
      <div className="composer-wrap">
        {connection}
        <Composer reviewContent={<ReviewDraftCards task={task} feedbackCount={feedbackCount} onReveal={onRevealQuote}/>} attachments={task.mode === 'review' ? undefined : files.draft} upload={(file, signal) => uploadAttachment(task.projectId, file, signal)} filesDisabled={sending || blocked || savingModel} imageHint={task.agent === 'antigravity' && files.files.some(file => file.mime.startsWith('image/'))} inputRef={input} label={t('Instructions for {agent}', { agent: agentName(task) })} value={draft} onChange={value => composer.edit(value)} onSubmit={() => void submit()} placeholder={task.mode === 'review' ? t('Ask for another review of this PDF version…') : active ? t('Queue instructions for the next turn…') : notes.notes.length || feedbackCount ? t('Add overall instructions (optional)') : t('Ask a question or request changes…')} skills={task.mode === 'review' ? [] : skills.filter(skill => skill.output !== 'annotations')} skill={skill} onSkill={savingModel ? undefined : setSkill}
          footer={attach => <div className="composer-options">
            {task.mode !== 'review' && <SkillPicker onAttach={attach} skills={skills.filter(skill => skill.output !== 'annotations')} selected={skill} disabled={sending || blocked || savingModel} onPick={value => { setSkill(value); input.current?.focus(); }}/>}
            <TaskModelPicker refreshUsage={refreshUsage} task={task} runtime={runtime} runtimes={runtimes} disabled={sending || blocked || savingPermissions || files.blocked || notes.busy} reconnecting={reconnecting} onReconnect={onReconnect} save={settings => api<Task>(`/tasks/${task.id}/model`, settings)} onSaving={setSavingModel} refresh={refresh} reportError={reportError}
              switchAgent={async settings => {
                if (isPlayground) { requestPlaygroundDownload(); return; }
                onTaskSaved(await api<Task>(`/tasks/${task.id}/agent`, settings));
              }}
              permissions={<TaskPermissionOptions task={task} runtime={runtime} disabled={sending || blocked || savingModel} save={permissions => api<Task>(`/tasks/${task.id}/permissions`, { permissions })} onSaved={onTaskSaved} onSaving={setSavingPermissions} refresh={refresh} reportError={reportError}/>}/>
          </div>}
          action={<div className="composer-actions">
            <ContextMeter usage={task.context}/>
            {active && <button type="button" className="send-button stop" aria-label={t('Pause task')} title={t('Pause {agent}', { agent: agentName(task) })} disabled={pausing} aria-busy={pausing} onClick={pause}><Icon name="stop" size={18}/></button>}
            {(!active || draft.trim() || skill || files.entries.length || notes.notes.length || feedbackCount || sending) && <button aria-label={t('Send instructions')} title={t('Send (Enter) · New line (Shift+Enter)')} disabled={!canSend || files.blocked || sending || savingModel || savingPermissions || blocked || Boolean(task.preparation)} className="send-button" type="submit"><Icon name="arrowUp" size={18}/></button>}
          </div>}/>
        {hint && <p className="composer-hint" role="status">{hint}</p>}
      </div>

    </section>;
  }


  return { Activity, Composer };
}
