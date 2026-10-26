import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PendingRequest, Snapshot, Task, TimelineItem } from '../shared.ts';
import './style.css';

let token = '';
const uuid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(20)), b => b.toString(16).padStart(2, '0')).join('');
async function api<T = any>(route: string, body?: unknown): Promise<T> {
  const response = await fetch('/api' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Papilot-Token': token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || '请求失败'); return value;
}
const statusNames: Record<string, string> = { idle: '就绪', queued: '排队中', running: 'Codex 正在修改', waiting_input: '需要你的回复', building: '生成 PDF 审阅', reviewing: '等待审阅', interrupted: '已暂停', failed: '需要处理' };
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14"/>, send: <><path d="m4 11 16-7-7 16-2-9-7-0Z"/><path d="m11 11 9-7"/></>,
    paper: <><path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v6h5M8 13h8M8 17h5"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
    pause: <><path d="M8 5v14M16 5v14"/></>, external: <><path d="M14 3h7v7m0-7L10 14"/><path d="M10 4H4v16h16v-6"/></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>, check: <path d="m5 12 4 4L19 6"/>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>,
    conversation: <><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-6 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></>,
    sparkle: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.paper}</svg>;
}
function Status({ task }: { task: Task }) { return <span className={`status ${task.status}`}><i/>{task.status === 'reviewing' && task.review?.state === 'done' ? '审阅完成' : statusNames[task.status] || task.status}</span>; }
function time(timestamp: number) { return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }

// The embedded viewer shares our origin. Keep its decision controls, but remove
// navigation and the task title that the workspace already provides.
function compactReviewFrame(event: React.SyntheticEvent<HTMLIFrameElement>, scale: number) {
  const doc = event.currentTarget.contentDocument;
  if (!doc || doc.getElementById('papilot-embed-style')) return;
  doc.documentElement.style.setProperty('--pdf-reading-scale', String(scale));
  const style = doc.createElement('style'); style.id = 'papilot-embed-style';
  style.textContent = `
    .bar{display:flex;min-height:36px;padding:3px 12px;gap:12px;flex-wrap:nowrap}
    .bar .overview-link,.bar .identity h1{display:none}
    .bar .identity{flex:1;flex-direction:row;gap:6px}
    .bar .identity span,.bar .meter,.bar .ghost{font-size:11px}
    .bar .meter{display:flex;order:initial;width:auto}
    .bar .bar-end{margin-left:0;gap:6px}
    .bar .ghost{padding:3px 8px}
    .bar .ghost.round{width:25px;height:25px;padding:0}
    #paper{--paper-top:10px;padding-top:10px}
    .part-title{font-size:16px;margin:5px 0 10px}
    @media(max-width:680px){
      .bar{min-height:44px}.bar .ghost{min-height:36px;font-size:12px}.bar .ghost.round{width:36px;height:36px}
      .bar .identity span,.bar .meter{font-size:12px}
      .change-map{display:none}.review-body>#paper{padding-right:6px;padding-bottom:40px}
      .change-head{padding:8px}.change-head .change-where{min-width:0;overflow-wrap:anywhere}
      .change-head .actions{gap:0;box-shadow:none}.change-head .actions button{min-height:44px;padding:6px;font-size:12px}
      .change-head .actions .nav{min-width:32px;padding:4px}.change-head .position{min-width:26px;font-size:10px}
      .change-head .link{min-height:36px;padding:6px}.change-head .dock{margin:0}
      .side,.context{overflow-x:auto;overscroll-behavior-x:contain}
      .side .pdf-strip,.context .pdf-strip{width:calc(100% * var(--pdf-reading-scale,1));max-width:none}
      .composer{left:8px!important;right:8px!important;width:auto!important;max-width:none;bottom:8px;transform:none;max-height:calc(100% - 16px);overflow:auto}
      .composer textarea{font-size:16px;max-height:min(140px,30vh)}.composer button{min-height:44px}
    }
    @media(max-width:420px){.bar{gap:7px;padding-inline:8px}.bar .meter{font-size:10px}}
  `;
  doc.head.append(style);
}

function RequestCard({ request, onDone }: { request: PendingRequest; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const questions = request.method.endsWith('requestUserInput') ? request.params.questions || [] : [];
  async function respond(decision?: string) { setBusy(true); setError(''); try { await api('/requests/' + request.id, { decision, answers }); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <div className="request-card"><h3>{questions.length ? 'Codex 需要补充信息' : '请确认这次操作'}</h3>
    {questions.map((q: any) => <label className="question" key={q.id}><span>{q.question || q.header}</span>{q.options?.length > 0 && <div className="answer-options">{q.options.map((option: any) => <button type="button" className={answers[q.id] === option.label ? 'selected' : ''} key={option.label} onClick={() => setAnswers({ ...answers, [q.id]: option.label })}>{option.label}{option.description && <small>{option.description}</small>}</button>)}</div>}<input aria-label={q.question || q.header} placeholder="也可以直接输入你的回答" value={answers[q.id] || ''} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })}/></label>)}
    {!questions.length && <><p>{request.params.reason || 'Codex 请求执行以下操作。'}</p><pre>{request.params.command || (request.params.permissions ? JSON.stringify(request.params.permissions, null, 2) : request.params.grantRoot || '应用文件修改')}</pre></>}
    {error && <p className="inline-error">{error}</p>}<div className="button-row">{!questions.length && <button disabled={busy} className="button secondary" onClick={() => void respond('decline')}>拒绝</button>}<button disabled={busy} className="button primary" onClick={() => void respond(questions.length ? undefined : 'accept')}>{busy ? '正在提交…' : questions.length ? '回复 Codex' : '允许这次操作'}</button></div>
  </div>;
}

function Activity({ task, items, requests, refresh, reportError, onCollapse }: { task: Task; items: TimelineItem[]; requests: PendingRequest[]; refresh: () => void; reportError: (e: unknown) => void; onCollapse: () => void }) {
  const key = 'papilot:draft:' + task.id;
  const [draft, setDraft] = useState(() => localStorage.getItem(key) || '');
  const [sending, setSending] = useState(false);
  const requestKey = useRef(uuid());
  const scroller = useRef<HTMLDivElement>(null);
  const shouldFollow = useRef(true);
  useEffect(() => { if (shouldFollow.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [items, requests]);
  async function submit(text: string) {
    if (!text.trim() || sending) return; setSending(true);
    try { await api('/tasks/' + task.id + '/messages', { text: text.trim(), requestKey: requestKey.current }); setDraft(''); localStorage.removeItem(key); requestKey.current = uuid(); shouldFollow.current = true; refresh(); }
    catch (e) { reportError(e); } finally { setSending(false); }
  }
  const active = ['running', 'queued', 'waiting_input'].includes(task.status);
  const comments = task.review?.counts?.commented || 0;
  return <section id="conversation-panel" className="activity-panel" aria-label="Codex 对话"><div className="panel-heading"><span className="codex-label">Codex <span className="model-label" title={task.model || '沿用本机 Codex 默认模型'}>{task.model || '默认模型'}</span></span><button className="icon-button collapse-conversation" aria-label="收起对话" title="收起对话" onClick={onCollapse}><Icon name="close" size={15}/></button></div>
    <div className="messages" ref={scroller} onScroll={() => { if (scroller.current) { const el = scroller.current; shouldFollow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; } }}>
      {items.map(item => item.type === 'user' || item.type === 'assistant' ? <article key={item.id} className={'message ' + item.type}><div className="message-meta"><span>{item.type === 'user' ? '你' : 'Codex'}</span><time>{time(item.createdAt)}</time></div><div className="message-body">{item.text}</div></article> : <details key={item.id} className="tool-item"><summary><span className="tool-dot">{item.status === 'completed' ? '✓' : '·'}</span><span>{item.type === 'command' ? item.text || '运行命令' : item.type === 'files' ? '修改文件' : item.text || '执行工具'}</span></summary>{item.type === 'files' ? <pre>{item.text}</pre> : item.detail && <pre>{item.detail}</pre>}</details>)}
      {requests.map(r => <RequestCard key={r.id} request={r} onDone={refresh}/>)}
      {task.status === 'running' && <div className="working"><span/><span/><span/><small>Codex 正在处理任务</small></div>}
      {task.status === 'queued' && <p className="muted">任务已保存，等待可用的 Codex 执行槽位。</p>}
      {task.error && <div className="task-error"><strong>这一步需要处理</strong><p>{task.error}</p></div>}
    </div>
    <div className="composer-wrap">{comments > 0 && <button className="feedback-button" disabled={sending} onClick={() => void submit('请根据本轮审阅中的批注继续修改。保留已经接受的内容，不要重新引入已经拒绝的修改。')}><Icon name="sparkle" size={16}/>{comments} 条批注已保存 · 交给 Codex 修改<Icon name="arrow" size={15}/></button>}
      <form className="composer" onSubmit={e => { e.preventDefault(); void submit(draft); }}><textarea aria-label="给 Codex 的修改意见" placeholder={active ? '补充下一轮要求…' : '提出进一步的修改意见…'} value={draft} onChange={e => { setDraft(e.target.value); localStorage.setItem(key, e.target.value); requestKey.current = uuid(); }} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit(draft); } }}/><div className="composer-footer"><span>{active ? '意见会加入下一轮' : '会同时带上新的审阅反馈'}</span><button aria-label="发送修改意见" disabled={!draft.trim() || sending} className="send-button" type="submit"><Icon name="send" size={18}/></button></div></form>
    </div>
  </section>;
}

function App() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState(localStorage.getItem('papilot:task') || '');
  const [projectId, setProjectId] = useState('');
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [online, setOnline] = useState(true), [error, setError] = useState('');
  const [modal, setModal] = useState<'project' | 'task' | null>(null);
  const [busy, setBusy] = useState(false), [sidebar, setSidebar] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(() => localStorage.getItem('papilot:sidebar') !== 'hidden');
  const [layout, setLayout] = useState<'split' | 'review' | 'conversation'>(() => {
    const saved = localStorage.getItem('papilot:layout');
    return saved === 'review' || saved === 'conversation' ? saved : 'split';
  });
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [mobileTab, setMobileTab] = useState('review');
  const [pdfScale, setPdfScale] = useState(1);
  const reviewFrame = useRef<HTMLIFrameElement>(null);
  const [form, setForm] = useState({ title: '', instructions: '', path: '', name: '', model: '' });
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const loaded = useRef(false);
  useEffect(() => { localStorage.setItem('papilot:sidebar', sidebarVisible ? 'visible' : 'hidden'); }, [sidebarVisible]);
  useEffect(() => { localStorage.setItem('papilot:layout', layout); }, [layout]);
  useEffect(() => { reviewFrame.current?.contentDocument?.documentElement.style.setProperty('--pdf-reading-scale', String(pdfScale)); }, [pdfScale, selected]);
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
  const refresh = useCallback(async () => {
    try {
      const next = await api<Snapshot & { csrf: string }>('/state'); token = next.csrf; setState(next); setOnline(true);
      const selection = selectedRef.current;
      if (selection) { const timeline = await api<{ items: TimelineItem[] }>('/tasks/' + selection + '/items'); if (selectedRef.current === selection) setItems(timeline.items); }
      if (!loaded.current) { loaded.current = true; if (!selection && next.tasks.length) setSelected(next.tasks[next.tasks.length - 1].id); }
    } catch (e) { setOnline(false); if (!loaded.current) reportError(e); }
  }, [reportError]);
  useEffect(() => { void refresh(); const events = new EventSource('/api/events'); events.addEventListener('change', () => void refresh()); events.onerror = () => setOnline(false); events.onopen = () => setOnline(true); const timer = setInterval(() => void refresh(), 10000); return () => { events.close(); clearInterval(timer); }; }, [refresh]);
  useEffect(() => { localStorage.setItem('papilot:task', selected); setItems([]); void refresh(); }, [selected, refresh]);
  useEffect(() => { if (!projectId && state?.projects.length) setProjectId(state.projects[0].id); }, [state, projectId]);
  const task = state?.tasks.find(t => t.id === selected);
  const fullPdfUrl = task?.review?.round ? `/api/tasks/${task.id}/pdf?round=${task.review.round}` : '';
  const project = state?.projects.find(p => p.id === (task?.projectId || projectId));
  const tasks = state?.tasks.filter(t => !project || t.projectId === project.id) || [];
  const running = state?.tasks.filter(t => ['running', 'waiting_input', 'building'].includes(t.status)).length || 0;
  function newTask(instructions = '', title = '') { setForm({ title, instructions, path: '', name: '', model: '' }); setModal(state?.projects.length ? 'task' : 'project'); }
  async function saveForm(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (modal === 'project') { const p = await api('/projects', { path: form.path, name: form.name }); setProjectId(p.id); setSelected(''); }
      else { const t = await api('/tasks', { projectId: project?.id || projectId, title: form.title, instructions: form.instructions, model: form.model, id: uuid() }); setSelected(t.id); setMobileTab('conversation'); setLayout('split'); }
      setModal(null); await refresh();
    } catch (e) { reportError(e); } finally { setBusy(false); }
  }
  async function action(route: string) { try { await api(route, {}); await refresh(); } catch (e) { reportError(e); } }
  const sidebarExpanded = narrow ? sidebar : sidebarVisible;
  return <div className={'app-shell' + (sidebarVisible ? '' : ' sidebar-collapsed')}>
    <aside id="task-sidebar" className={'sidebar ' + (sidebar ? 'is-open' : '')} aria-label="论文与任务"><div className="sidebar-brand"><a href="/" className="brand" onClick={e => { e.preventDefault(); setSelected(''); setSidebar(false); }}><span>Papilot</span></a><button className="icon-button" aria-label="收起任务列表" title="收起任务列表" onClick={() => narrow ? setSidebar(false) : setSidebarVisible(false)}><Icon name="sidebar" size={17}/></button></div>
      <div className="sidebar-section"><span>论文</span><button className="icon-button" aria-label="添加论文" title="添加论文" onClick={() => { setForm({ title: '', instructions: '', path: '', name: '', model: '' }); setModal('project'); }}><Icon name="plus" size={16}/></button></div>
      {state?.projects.length ? <select aria-label="论文项目" className="project-select" value={project?.id || projectId} onChange={e => { setProjectId(e.target.value); setSelected(''); }}>{state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : <button className="add-project" onClick={() => setModal('project')}><Icon name="paper"/>添加论文</button>}
      <button className="button new-task" onClick={() => newTask()}><Icon name="plus" size={16}/>新建任务</button>
      <div className="sidebar-section task-label"><span>任务</span><span className="count">{tasks.length}</span></div>
      <nav className="task-list" aria-label="任务列表">{tasks.length ? [...tasks].reverse().map(t => <button key={t.id} className={'task-link ' + (t.id === selected ? 'active' : '')} onClick={() => { setSelected(t.id); setSidebar(false); }}><div className="task-link-top"><span>{t.title}</span>{t.review?.counts?.pending ? <b>{t.review.counts.pending}</b> : null}</div><Status task={t}/></button>) : <div className="task-list-empty">暂无任务</div>}</nav>
      <div className="sidebar-bottom"><div className="host-status"><span className={'connection-dot ' + (online ? 'connected' : '')}/><span>Mac mini</span><span className="host-state">{online ? '已连接' : '重连中'}</span></div>{running > 0 && <div className="host-caption">{running} 个任务进行中</div>}</div>
    </aside>
    {sidebar && narrow && <button className="sidebar-scrim" aria-label="关闭任务列表" onClick={() => setSidebar(false)}/>}
    <main className="main"><header className="topbar">
      <button className="icon-button sidebar-toggle" aria-label={sidebarExpanded ? '收起任务列表' : '展开任务列表'} title={sidebarExpanded ? '收起任务列表' : '展开任务列表'} aria-expanded={sidebarExpanded} aria-controls="task-sidebar" onClick={() => narrow ? setSidebar(v => !v) : setSidebarVisible(v => !v)}><Icon name="sidebar"/></button>
      <div className="breadcrumb"><span className="project-name" title={project?.name}>{project?.name || 'Papilot'}</span>{task && <><span className="slash">/</span><h1 title={task.title}>{task.title}</h1></>}</div>
      {task && <><div className="toolbar-status"><Status task={task}/></div><div className="toolbar-actions">
        {fullPdfUrl && <a className="button secondary compact full-pdf-link" href={fullPdfUrl} target="_blank" rel="noreferrer" title={`打开第 ${task.review?.round} 轮修改后的完整 PDF，可在浏览器中下载`}><Icon name="paper" size={15}/>完整 PDF</a>}
        {['running', 'waiting_input', 'queued'].includes(task.status) ? <button className="button secondary compact task-action" onClick={() => void action('/tasks/' + task.id + '/interrupt')}><Icon name="pause" size={14}/><span>暂停</span></button> : <button className="button secondary compact task-action" title="生成审阅" aria-label="生成审阅" disabled={task.status === 'building'} onClick={() => void action('/tasks/' + task.id + '/publish')}><Icon name="paper" size={14}/><span>生成审阅</span></button>}
        {task.review?.round ? <a className="icon-button external-review" aria-label="在新窗口打开审阅" title="在新窗口打开审阅" href={`/review/${task.projectId}/?task=${task.name}`} target="_blank" rel="noreferrer"><Icon name="external" size={16}/></a> : null}
        <div className="panel-switches" aria-label="面板布局">
          <button className={'panel-toggle ' + (layout !== 'conversation' ? 'active' : '')} aria-label={layout === 'conversation' ? '展开 PDF 审阅' : '收起 PDF 审阅'} title={layout === 'conversation' ? '展开 PDF 审阅' : '收起 PDF 审阅'} aria-expanded={layout !== 'conversation'} aria-controls="review-panel" onClick={() => setLayout(layout === 'conversation' ? 'split' : 'conversation')}><Icon name="paper" size={15}/><span>审阅</span></button>
          <button className={'panel-toggle ' + (layout !== 'review' ? 'active' : '')} aria-label={layout === 'review' ? '展开对话' : '收起对话'} title={layout === 'review' ? '展开对话' : '收起对话'} aria-expanded={layout !== 'review'} aria-controls="conversation-panel" onClick={() => setLayout(layout === 'review' ? 'split' : 'review')}><Icon name="conversation" size={15}/><span>对话</span>{state?.requests.some(r => r.taskId === task.id) && <i className="attention-dot"/>}</button>
        </div>
      </div></>}
    </header>
      {error && <div role="alert" className="error-banner"><span>{error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><Icon name="close" size={16}/></button></div>}
      {state && (!state.runtime.connected || !state.runtime.authenticated) && <div className="runtime-banner"><span>{state.runtime.error || '正在连接 Codex…'}</span><button onClick={() => void action('/reconnect')}>重新连接</button></div>}
      {task ? <div className="task-workspace">
        <div className="mobile-tabs"><button aria-pressed={mobileTab === 'review'} className={mobileTab === 'review' ? 'active' : ''} onClick={() => setMobileTab('review')}>审阅 {task.review?.counts?.pending ? `· ${task.review.counts.pending}` : ''}</button><button aria-pressed={mobileTab === 'conversation'} className={mobileTab === 'conversation' ? 'active' : ''} onClick={() => setMobileTab('conversation')}>对话{state?.requests.some(r => r.taskId === task.id) ? ' · 待回复' : ''}</button><Status task={task}/>{mobileTab === 'review' && <select className="reading-scale" aria-label="PDF 阅读缩放" value={pdfScale} onChange={e => setPdfScale(Number(e.target.value))}><option value={1}>100%</option><option value={1.5}>150%</option><option value={2}>200%</option><option value={3}>300%</option></select>}</div>
        <div className={`task-grid layout-${layout} show-${mobileTab}`}><section id="review-panel" className="review-panel" aria-label="PDF 审阅">
          {task.review?.round ? <iframe ref={reviewFrame} key={task.id} title={`${task.title} PDF 差异审阅`} src={`/review/${task.projectId}/?task=${task.name}`} onLoad={e => compactReviewFrame(e, pdfScale)} className="review-frame"/> : <div className="review-placeholder"><Icon name="paper" size={28}/><h2>{task.status === 'building' ? '正在生成 PDF 审阅…' : '暂无审阅'}</h2><p>{task.status === 'building' ? '编译完成后自动显示。' : 'Codex 完成修改后，这里会显示 PDF 差异。'}</p></div>}
          {task.status === 'building' && task.review?.round ? <div className="build-overlay"><span className="spinner"/>正在生成下一轮审阅</div> : null}
        </section><Activity key={task.id} task={task} items={items} requests={state?.requests.filter(r => r.taskId === task.id) || []} refresh={() => void refresh()} reportError={reportError} onCollapse={() => setLayout('review')}/></div>
      </div> : <div className="welcome"><h1>{project?.name || '论文工作台'}</h1><p className="welcome-copy">{project ? '选择已有任务，或创建一个 Codex 修改任务。' : '添加 Mac mini 上的 LaTeX 仓库，再创建修改任务。'}</p><button className="button primary" onClick={() => newTask()}><Icon name="plus"/>{project ? '新建任务' : '添加论文'}</button></div>}
    </main>
    {modal && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close icon-button" aria-label="关闭" disabled={busy} onClick={() => setModal(null)}><Icon name="close"/></button><h2 id="modal-title">{modal === 'task' ? '新建 Codex 任务' : '添加论文项目'}</h2>{modal === 'project' && <p className="modal-description">选择 Mac mini 上已有的 LaTeX Git 仓库。</p>}<form onSubmit={e => void saveForm(e)}>{modal === 'project' ? <><label>论文名称<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：我的论文"/></label><label>Mac mini 上的仓库路径<input required value={form.path} onChange={e => setForm({ ...form, path: e.target.value })} placeholder="/Users/chen/papers/my-paper"/></label><p className="field-hint">仓库需要已有一次 Git 提交，并能通过 latexmk 编译。</p></> : <><label>任务标题<input autoFocus required maxLength={120} placeholder="例如：精简引言的背景介绍" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/></label><label>希望 Codex 做什么？<textarea required rows={5} placeholder="具体说明修改范围、希望保留的内容，以及完成标准…" value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })}/></label><label>Codex 模型<select value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}><option value="">沿用本机 Codex 默认配置</option>{state?.runtime.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><p className="field-hint">论文：{project?.name} · 修改会先进入审阅，不会自动合入主稿。</p></>}{error && <p className="inline-error">{error}</p>}<button disabled={busy} className="button primary modal-submit" type="submit">{busy ? '正在准备…' : modal === 'task' ? '创建并启动 Codex' : '添加论文'}<Icon name="arrow" size={17}/></button></form></section></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
