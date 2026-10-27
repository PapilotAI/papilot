import { StrictMode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { PendingRequest, Snapshot, Task, TimelineItem } from '../shared.ts';
import { ComposerDraft } from './composer.ts';
import { ReadRequest, canStreamUpdates } from './refresh.ts';
import { browserStorage } from './storage.ts';
import { ReviewFrame } from './review-frame.tsx';
import { keepDialogFocus } from './focus.ts';
import { DeleteTaskDialog } from './task-dialog.tsx';
import { ActionMenu } from './action-menu.tsx';
import './style.css';

let token = '';
const uuid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(20)), b => b.toString(16).padStart(2, '0')).join('');
async function api<T = any>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(body === undefined ? 15000 : 30000);
  try { const response = await fetch('/api' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Papilot-Token': token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Request failed. Please try again.'); return value;
  }
  catch (error) {
    if (timeout.aborted) throw new Error(body === undefined ? 'The connection is taking too long. Check your network and try again.' : 'The request timed out and may still be processing. Check the task status before retrying.');
    throw error;
  }
}
const statusNames: Record<string, string> = { idle: 'Ready', queued: 'Queued', running: 'Codex is editing', waiting_input: 'Needs your reply', building: 'Building PDF review', reviewing: 'Ready for review', interrupted: 'Paused', failed: 'Needs attention', uncertain: 'Check task status', deleting: 'Deleting task' };
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14"/>, send: <><path d="m4 11 16-7-7 16-2-9-7-0Z"/><path d="m11 11 9-7"/></>,
    paper: <><path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v6h5M8 13h8M8 17h5"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
    pause: <><path d="M8 5v14M16 5v14"/></>, external: <><path d="M14 3h7v7m0-7L10 14"/><path d="M10 4H4v16h16v-6"/></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>, check: <path d="m5 12 4 4L19 6"/>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>,
    conversation: <><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-6 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></>,
    sparkle: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.paper}</svg>;
}
function Status({ task }: { task: Task }) { return <span className={`status ${task.status}`}><i/>{task.status === 'reviewing' && task.review?.state === 'done' ? 'Review complete' : statusNames[task.status] || task.status}</span>; }
function time(timestamp: number) { return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }



function RequestCard({ request, answerDrafts, onDone }: { request: PendingRequest; answerDrafts: Map<string, Record<string, string>>; onDone: () => void }) {
  const [answers, updateAnswers] = useState<Record<string, string>>(() => answerDrafts.get(request.id) || {});
  function setAnswers(next: Record<string, string>) { answerDrafts.set(request.id, next); updateAnswers(next); }
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const questions = request.method.endsWith('requestUserInput') ? request.params.questions || [] : [];
  async function respond(decision?: string) { setBusy(true); setError(''); try { await api('/requests/' + request.id, { decision, answers }); answerDrafts.delete(request.id); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <div className="request-card"><h3>{questions.length ? 'Codex needs your input' : 'Approve this action'}</h3>
    {questions.map((q: any) => <fieldset className="question" key={q.id}><legend>{q.question || q.header}</legend>{q.options?.length > 0 && <div className="answer-options">{q.options.map((option: any) => <button type="button" disabled={busy} aria-pressed={answers[q.id] === option.label} className={answers[q.id] === option.label ? 'selected' : ''} key={option.label} onClick={() => setAnswers({ ...answers, [q.id]: option.label })}>{option.label}{option.description && <small>{option.description}</small>}</button>)}</div>}<input disabled={busy} aria-label={q.question || q.header} placeholder="Or type your own answer" value={answers[q.id] || ''} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })}/></fieldset>)}
    {!questions.length && <><p>{request.params.reason || 'Codex is requesting permission for this action.'}</p><pre>{request.params.command || (request.params.permissions ? JSON.stringify(request.params.permissions, null, 2) : request.params.grantRoot || 'Apply file changes')}</pre></>}
    {error && <p className="inline-error" role="alert">{error}</p>}<div className="button-row">{!questions.length && <button disabled={busy} className="button secondary" onClick={() => void respond('decline')}>Decline</button>}<button disabled={busy || questions.some((q: any) => !answers[q.id]?.trim())} className="button primary" onClick={() => void respond(questions.length ? undefined : 'accept')}>{busy ? 'Submitting…' : questions.length ? 'Reply to Codex' : 'Allow this action'}</button></div>
  </div>;
}

function Activity({ task, composer, answerDrafts, items, loading, loadError, retry, requests, refresh, reportError }: { task: Task; composer: ComposerDraft; answerDrafts: Map<string, Record<string, string>>; items: TimelineItem[]; loading: boolean; loadError: string; retry: () => void; requests: PendingRequest[]; refresh: () => void; reportError: (e: unknown) => void }) {
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
  const active = ['running', 'queued', 'waiting_input'].includes(task.status);
  return <section id="conversation-panel" className="activity-panel" aria-label="Codex conversation"><div className="panel-heading"><span className="codex-label">Codex <span className="model-label" title={task.model || 'Use the default Codex model on this host'}>{task.model || 'Default model'}</span></span></div>
    <div className="conversation-history"><div className="messages" ref={scroller} onScroll={() => { if (scroller.current) { const el = scroller.current; shouldFollow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; setFollowing(shouldFollow.current); } }}>
      {loading && <p className="muted" role="status">Loading conversation…</p>}
      {loadError && <div className="conversation-error" role="alert"><p>{loadError}</p><button className="button secondary" onClick={retry}>Retry conversation</button></div>}
      {items.map(item => item.type === 'user' || item.type === 'assistant' ? <article key={item.id} className={'message ' + item.type}><div className="message-meta"><span>{item.type === 'user' ? 'You' : 'Codex'}</span><time>{time(item.createdAt)}</time></div><div className="message-body">{item.text}</div></article> : <details key={item.id} className="tool-item"><summary><span className="tool-dot">{item.status === 'completed' ? '✓' : '·'}</span><span>{item.type === 'command' ? item.text || 'Run command' : item.type === 'files' ? 'File changes' : item.text || 'Run tool'}</span></summary>{item.type === 'files' ? <pre>{item.text}</pre> : item.detail && <pre>{item.detail}</pre>}</details>)}
      {requests.map(r => <RequestCard key={r.id} request={r} answerDrafts={answerDrafts} onDone={refresh}/>)}
      {task.status === 'running' && <div className="working"><span/><span/><span/><small>Codex is working on this task</small></div>}
      {task.status === 'queued' && <p className="muted">Task saved. Waiting for an available Codex session.</p>}
      {task.error && <div className="task-error"><strong>This step needs attention</strong><p>{task.error}</p></div>}
    </div>{!following && <button className="jump-latest" onClick={latest}>Latest messages ↓</button>}</div>
    <div className="composer-wrap">
      <form className="composer" onSubmit={e => { e.preventDefault(); void submit('draft'); }}><textarea aria-label="Instructions for Codex" maxLength={20000} placeholder={active ? 'Add instructions for the next turn…' : 'Describe the next revision…'} value={draft} onChange={e => composer.edit(e.target.value)} onKeyDown={e => { if (!e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit('draft'); } }}/><div className="composer-footer"><span>{task.status === 'deleting' ? 'This task is being deleted' : task.status === 'uncertain' ? 'Check task status before sending' : sendingSource === 'feedback' ? 'Sending feedback…' : sending ? 'Sending…' : active ? 'Queued for the next turn' : 'Includes new review feedback'}</span><button aria-label="Send instructions" title="Send instructions (⌘/Ctrl+Enter)" disabled={!draft.trim() || sending || ['uncertain', 'deleting'].includes(task.status)} className="send-button" type="submit"><Icon name="send" size={18}/></button></div></form>
    </div>
  </section>;
}

function ReviewFeedback({ task, composer, refresh, reportError, onSent }: { task: Task; composer: ComposerDraft; refresh: () => void; reportError: (error: unknown) => void; onSent: () => void }) {
  const { sending, sendingSource } = useSyncExternalStore(composer.subscribe, composer.getSnapshot);
  const count = task.review?.counts?.commented || 0;
  if (!count || task.status === 'deleting') return null;
  async function send() {
    if (task.status === 'uncertain') return;
    try { if (await composer.submit('feedback', message => api('/tasks/' + task.id + '/messages', message))) { refresh(); onSent(); } }
    catch (error) { reportError(error); }
  }
  return <div className="review-feedback"><span>{count} saved {count === 1 ? 'comment' : 'comments'}</span><button className="button primary compact" disabled={sending || task.status === 'uncertain'} onClick={() => void send()}>{sendingSource === 'feedback' ? 'Sending feedback…' : 'Send feedback'}<Icon name="arrow" size={14}/></button></div>;
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
  const [modal, setModal] = useState<'project' | 'task' | null>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const modalOpener = useRef<HTMLElement | null>(null);
  const formTaskId = useRef(uuid());
  const [busy, setBusy] = useState(false), [sidebar, setSidebar] = useState(false);
  const actionRequests = useRef(new Set<string>());
  const [pendingActions, setPendingActions] = useState(new Set<string>());
  const [sidebarVisible, setSidebarVisible] = useState(() => browserStorage.getItem('papilot:sidebar') !== 'hidden');
  const [layout, setLayout] = useState<'split' | 'review' | 'conversation'>(() => {
    const saved = browserStorage.getItem('papilot:layout');
    return saved === 'review' || saved === 'conversation' ? saved : 'split';
  });
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [mobileTab, setMobileTab] = useState('review');
  const [pdfScale, setPdfScale] = useState(1);
  const [form, setForm] = useState({ title: '', instructions: '', path: '', name: '', model: '' });
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
  useEffect(() => { browserStorage.setItem('papilot:sidebar', sidebarVisible ? 'visible' : 'hidden'); }, [sidebarVisible]);
  useEffect(() => { browserStorage.setItem('papilot:layout', layout); }, [layout]);
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
    const media = window.matchMedia('(max-width: 900px)');
    const change = () => { setNarrow(media.matches); setSidebar(false); };
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
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
  const project = state?.projects.find(p => p.id === (task?.projectId || projectId));
  const tasks = state?.tasks.filter(t => !project || t.projectId === project.id) || [];
  const running = state?.tasks.filter(t => ['running', 'waiting_input', 'building'].includes(t.status)).length || 0;
  function openForm(kind: 'project' | 'task') { modalOpener.current = document.activeElement as HTMLElement | null; formTaskId.current = uuid(); setError(''); setForm({ title: '', instructions: '', path: '', name: '', model: '' }); setModal(kind); }
  function newTask() { openForm(state?.projects.length ? 'task' : 'project'); }
  async function saveForm(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (modal === 'project') { const p = await api('/projects', { path: form.path, name: form.name }); setProjectId(p.id); setSelected(''); }
      else { const t = await api('/tasks', { projectId: project?.id || projectId, title: form.title, instructions: form.instructions, model: form.model, id: formTaskId.current }); setSelected(t.id); setMobileTab('conversation'); setLayout('split'); }
      setModal(null); setSidebar(false); await refresh(true);
    } catch (e) { reportError(e); } finally { setBusy(false); }
  }
  async function action(route: string) {
    const key = route.startsWith('/tasks/') ? route.split('/').slice(0, 3).join('/') : route;
    if (actionRequests.current.has(key)) return;
    actionRequests.current.add(key); setPendingActions(new Set(actionRequests.current));
    try { await api(route, {}); await refresh(true); } catch (e) { reportError(e); }
    finally { actionRequests.current.delete(key); setPendingActions(new Set(actionRequests.current)); }
  }
  const taskActionBusy = Boolean(task && pendingActions.has('/tasks/' + task.id));
  function taskDeleted(id: string) {
    const removed = snapshotRef.current?.tasks.find(t => t.id === id); if (removed) setProjectId(removed.projectId);
    browserStorage.removeItem('papilot:draft:' + id); composers.current.delete(id); timelineCache.current.delete(id);
    setDeleteTarget(null);
    if (selectedRef.current === id) setSelected('');
    setState(previous => previous ? { ...previous, tasks: previous.tasks.filter(t => t.id !== id), requests: previous.requests.filter(r => r.taskId !== id) } : previous);
    void refresh(true);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(narrow && sidebar ? '.sidebar .new-task' : '.sidebar-toggle')?.focus());
  }

  const sidebarExpanded = narrow ? sidebar : sidebarVisible;
  return <div className={'app-shell' + (sidebarVisible ? '' : ' sidebar-collapsed')}>
    <aside ref={sidebarRef} role={narrow && sidebar ? 'dialog' : undefined} aria-modal={narrow && sidebar ? true : undefined} onKeyDown={e => { if (!narrow || !sidebar || modal) return; if (e.key === 'Escape') { e.preventDefault(); setSidebar(false); } else keepDialogFocus(e); }} id="task-sidebar" className={'sidebar ' + (sidebar ? 'is-open' : '')} aria-label="Papers and tasks"><div className="sidebar-brand"><a href="/" className="brand" onClick={e => { e.preventDefault(); setSelected(''); setSidebar(false); }}><span>Papilot</span></a><button className="icon-button" aria-label="Hide task list" title="Hide task list" onClick={() => narrow ? setSidebar(false) : setSidebarVisible(false)}><Icon name="sidebar" size={17}/></button></div>
      <div className="sidebar-section"><span>Paper</span><button className="icon-button" aria-label="Add paper" title="Add paper" disabled={!state} onClick={() => openForm('project')}><Icon name="plus" size={16}/></button></div>
      {state?.projects.length ? <select aria-label="Paper project" className="project-select" value={project?.id || projectId} onChange={e => { setProjectId(e.target.value); setSelected(''); }}>{state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : <button className="add-project" disabled={!state} onClick={() => openForm('project')}><Icon name="paper"/>Add paper</button>}
      <button className="button new-task" disabled={!state} onClick={() => newTask()}><Icon name="plus" size={16}/>New task</button>
      <div className="sidebar-section task-label"><span>Tasks</span><span className="count">{tasks.length}</span></div>
      <nav className="task-list" aria-label="Task list">{tasks.length ? [...tasks].reverse().map(t => <div key={t.id} className={'task-row ' + (t.id === selected ? 'active' : '')}>
        <button aria-current={t.id === selected ? 'page' : undefined} className={'task-link ' + (t.id === selected ? 'active' : '')} onClick={() => { setSelected(t.id); setSidebar(false); }}><div className="task-link-top"><span>{t.title}</span>{t.review?.counts?.pending ? <b>{t.review.counts.pending}</b> : null}</div><Status task={t}/></button>
        <ActionMenu label={`Task actions for ${t.title}`} actions={[
          ...(['running', 'waiting_input', 'queued'].includes(t.status) ? [{ label: 'Pause task', disabled: pendingActions.has('/tasks/' + t.id), select: () => void action('/tasks/' + t.id + '/interrupt') }] : []),
          ...(t.status === 'uncertain' ? [{ label: 'Check status', disabled: pendingActions.has('/tasks/' + t.id), select: () => void action('/tasks/' + t.id + '/reconcile') }] : []),
          { label: t.status === 'deleting' ? 'Retry deletion…' : 'Delete task…', danger: true, select: () => setDeleteTarget(t) },
        ]}/>
      </div>) : <div className="task-list-empty">No tasks yet</div>}</nav>
      <div className="sidebar-bottom"><div className="host-status"><span className={'connection-dot ' + (online ? 'connected' : '')}/><span>Host</span><span className="host-state">{!state ? 'Connecting…' : online ? 'Connected' : 'Reconnecting'}</span></div>{running > 0 && <div className="host-caption">{running} {running === 1 ? 'active task' : 'active tasks'}</div>}</div>
    </aside>
    {sidebar && narrow && <button tabIndex={-1} className="sidebar-scrim" aria-label="Close task list" onClick={() => setSidebar(false)}/>}
    <main className="main" inert={narrow && sidebar}><header className="topbar">
      <button className="icon-button sidebar-toggle" aria-label={sidebarExpanded ? 'Hide task list' : 'Show task list'} title={sidebarExpanded ? 'Hide task list' : 'Show task list'} aria-expanded={sidebarExpanded} aria-controls="task-sidebar" onClick={() => narrow ? setSidebar(v => !v) : setSidebarVisible(v => !v)}><Icon name="sidebar"/></button>
      <div className="breadcrumb"><span className="project-name" title={project?.name}>{project?.name || 'Papilot'}</span>{task && <><span className="slash">/</span><div className="task-identity"><h1 title={task.title}>{task.title}</h1><Status task={task}/></div></>}</div>
      {task && <>
        <div className="task-state-actions">
          {task.status === 'deleting' ? <button className="button secondary compact" onClick={() => setDeleteTarget(task)}>Retry deletion</button> : task.status === 'uncertain' ? <button className="button secondary compact" disabled={taskActionBusy} aria-busy={taskActionBusy} onClick={() => void action('/tasks/' + task.id + '/reconcile')}>Check status</button> : ['running', 'waiting_input', 'queued'].includes(task.status) ? <button className="button secondary compact" aria-label="Pause task" disabled={taskActionBusy} aria-busy={taskActionBusy} onClick={() => void action('/tasks/' + task.id + '/interrupt')}>Pause</button> : task.error ? <button className="button secondary compact" onClick={() => { setMobileTab('conversation'); setLayout('conversation'); }}>View details</button> : null}
        </div>
        <div className="view-selector" role="group" aria-label="Workspace view">
          <button aria-pressed={layout === 'review'} onClick={() => { setLayout('review'); setMobileTab('review'); }}>Review</button>
          <button aria-pressed={layout === 'split'} onClick={() => setLayout('split')}>Split</button>
          <button aria-pressed={layout === 'conversation'} onClick={() => { setLayout('conversation'); setMobileTab('conversation'); }}>Conversation{state?.requests.some(r => r.taskId === task.id) && <i className="attention-dot" aria-label="Reply needed"/>}</button>
        </div>
      </>}
    </header>
      {state && !online && <div className="connection-banner" role="status"><span>Connection lost. Showing the last update; your draft is kept.</span><button onClick={() => void refresh(true)}>Retry connection</button></div>}
      {error && <div role="alert" className="error-banner"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" size={16}/></button></div>}
      {state && (!state.runtime.connected || !state.runtime.authenticated) && <div className="runtime-banner"><span>{state.runtime.error || 'Connecting to Codex…'}</span><button disabled={pendingActions.has('/reconnect')} onClick={() => void action('/reconnect')}>{pendingActions.has('/reconnect') ? 'Connecting…' : 'Reconnect'}</button></div>}
      {task ? <div className="task-workspace">
        <div className="mobile-tabs" role="group" aria-label="Workspace view"><button aria-pressed={mobileTab === 'review'} className={mobileTab === 'review' ? 'active' : ''} onClick={() => setMobileTab('review')}>Review {task.review?.counts?.pending ? `· ${task.review.counts.pending}` : ''}</button><button aria-label={state?.requests.some(r => r.taskId === task.id) ? 'Conversation (reply needed)' : 'Conversation'} aria-pressed={mobileTab === 'conversation'} className={mobileTab === 'conversation' ? 'active' : ''} onClick={() => setMobileTab('conversation')}>Conversation{state?.requests.some(r => r.taskId === task.id) && <i className="attention-dot" aria-hidden="true"/>}</button></div>
        <div className={`task-grid layout-${layout} show-${mobileTab}`}><section id="review-panel" className="review-panel" aria-label="PDF review">
          <div className="review-toolbar"><span className="review-heading">PDF review</span><div className="review-tools">
            {fullPdfUrl && <><select className="reading-scale" aria-label="PDF reading zoom" value={pdfScale} onChange={e => setPdfScale(Number(e.target.value))}><option value={1}>Fit</option><option value={1.5}>150%</option><option value={2}>200%</option><option value={3}>300%</option></select><a className="button secondary compact full-pdf-link" href={fullPdfUrl} target="_blank" rel="noreferrer" title={`Open the full PDF after round ${task.review?.round}`}>Full PDF</a></>}
            {task.status !== 'deleting' && <ActionMenu label="Review options" actions={[
              { label: 'Build review', disabled: ['running', 'waiting_input', 'queued', 'building', 'uncertain'].includes(task.status) || taskActionBusy, select: () => void action('/tasks/' + task.id + '/publish') },
              ...(fullPdfUrl ? [{ label: 'Open review in new tab', href: `/review/${task.projectId}/?task=${task.name}` }] : []),
            ]}/>}
          </div></div>
          {task.status === 'failed' && task.review?.job?.status === 'failed' && <div className="review-build-error" role="status"><span>The latest review build failed.</span><button className="button secondary compact" disabled={taskActionBusy} onClick={() => void action('/tasks/' + task.id + '/publish')}>Retry build</button></div>}
          {task.status === 'deleting' ? <div className="review-placeholder"><h2>Deletion is in progress</h2><p>This task is reserved until its worktree cleanup is confirmed. Use Retry deletion if the connection was interrupted.</p></div> : task.review?.round ? <ReviewFrame key={task.id} task={task} scale={pdfScale}/> : <div className="review-placeholder"><Icon name="paper" size={28}/><h2>{task.status === 'building' ? 'Building PDF review…' : 'No review yet'}</h2><p>{task.status === 'building' ? 'The review will appear when the build finishes.' : 'PDF changes will appear here after Codex finishes editing.'}</p>{['idle', 'interrupted', 'failed', 'reviewing'].includes(task.status) && <button className="button secondary" disabled={taskActionBusy} onClick={() => void action('/tasks/' + task.id + '/publish')}>Build review</button>}</div>}
          <ReviewFeedback task={task} composer={composers.current.get(task.id)!} refresh={() => void refresh(true)} reportError={reportError} onSent={() => { if (selectedRef.current !== task.id) return; setMobileTab('conversation'); setLayout(current => current === 'review' ? 'split' : current); }}/>
        </section><Activity key={task.id} task={task} composer={composers.current.get(task.id)!} answerDrafts={answerDrafts.current} items={timeline.taskId === task.id ? timeline.items : timelineCache.current.get(task.id) || []} loading={timeline.taskId === task.id ? itemsLoading : !timelineCache.current.has(task.id)} loadError={timelineError.taskId === task.id ? timelineError.message : ''} retry={() => void refreshTimeline(task.id)} requests={state?.requests.filter(r => r.taskId === task.id) || []} refresh={() => void refresh(true)} reportError={reportError}/></div>
      </div> : !state ? <div className="welcome"><h1>Opening your workspace</h1><p className="welcome-copy" role="status">{connectionError || 'Connecting to your papers and tasks…'}</p>{connectionError && <button className="button secondary" onClick={() => void refresh(true)}>Retry connection</button>}</div> : <div className="welcome"><h1>{project?.name || 'Your paper workspace'}</h1><p className="welcome-copy">{project ? 'Select a task or create a new editing task for Codex.' : 'Add a LaTeX repository from this host, then create an editing task.'}</p><button className="button primary" onClick={() => newTask()}><Icon name="plus"/>{project ? 'New task' : 'Add paper'}</button></div>}
    </main>
    {deleteTarget && <DeleteTaskDialog task={state?.tasks.find(t => t.id === deleteTarget.id) || deleteTarget} submit={() => api('/tasks/' + deleteTarget.id + '/delete', { confirm: true })} onClose={() => setDeleteTarget(null)} onDeleted={() => taskDeleted(deleteTarget.id)} refresh={() => void refresh(true)}/>}
    {modal && <dialog ref={modalRef} onKeyDown={keepDialogFocus} className="modal-backdrop" aria-labelledby="modal-title" onCancel={e => { e.preventDefault(); if (!busy) setModal(null); }} onClick={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section className="modal"><button className="modal-close icon-button" aria-label="Close" disabled={busy} onClick={() => setModal(null)}><Icon name="close"/></button><h2 id="modal-title">{modal === 'task' ? 'New Codex task' : 'Add a paper project'}</h2>{modal === 'project' && <p className="modal-description">Choose an existing LaTeX Git repository on this host.</p>}<form onSubmit={e => void saveForm(e)}>{modal === 'project' ? <><label>Paper name (optional)<input autoFocus maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. My research paper"/></label><label>Repository path on this host<input required maxLength={4000} value={form.path} onChange={e => setForm({ ...form, path: e.target.value })} placeholder="/Users/you/papers/my-paper"/></label><p className="field-hint">The repository needs at least one Git commit and must compile with latexmk.</p></> : <><label>Task title<input autoFocus required maxLength={120} placeholder="e.g. Shorten the introduction" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/></label><label>What should Codex do?<textarea required maxLength={20000} rows={5} placeholder="Describe the scope, what to preserve, and how to judge the result…" value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })}/></label><label>Codex model<select value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}><option value="">Use the default Codex configuration on this host</option>{state?.runtime.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><p className="field-hint">Paper: {project?.name} · Changes go through review before entering the manuscript.</p></>}{error && <p className="inline-error" role="alert">{error}</p>}<button disabled={busy} className="button primary modal-submit" type="submit">{busy ? 'Preparing…' : modal === 'task' ? 'Create and start Codex' : 'Add paper'}<Icon name="arrow" size={17}/></button></form></section></dialog>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
