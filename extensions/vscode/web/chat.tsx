import { ResourceProvider } from '../../../src/web/resources.tsx';
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createConversation } from '../../../src/web/conversation.tsx';
import { ComposerDraft } from '../../../src/web/composer.ts';
import { browserStorage } from '../../../src/web/storage.ts';
import { mergeTimeline } from '../../../src/web/refresh.ts';
import { t } from '../../../src/web/i18n.ts';
import type { Snapshot, Task, TimelineItem, Skill } from '../../../src/shared.ts';
import { api, command, ready, resource, useHost } from './bridge.ts';
import '../../../src/web/style.css';
import '../../../src/web/note-controls.css';
import './style.css';
const { Activity } = createConversation(api);
function Chat() {
  const data = useHost<{ snapshot: Snapshot; task?: Task; skills: Skill[]; error?: string }>();
  const [items, setItems] = useState<TimelineItem[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [pausing, setPausing] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const task = data?.task, id = task?.id;
  const answers = useRef(new Map<string, Record<string, string>>());
  const composer = useMemo(() => new ComposerDraft('papilot:vscode:task:' + id, browserStorage, () => crypto.randomUUID()), [id]);
  const report = (error: unknown) => setError(error instanceof Error ? error.message : String(error));
  useEffect(() => {
    setItems([]); setError(''); setLoading(Boolean(id));
    if (!id) return;
    let alive = true, running = false;
    const refresh = async () => {
      if (running) return; running = true;
      try { const result = await api<{ items: TimelineItem[] }>(`/tasks/${id}/items`); if (alive) { setItems(previous => mergeTimeline(previous, result.items)); setError(''); } }
      catch (error) { if (alive) report(error); }
      finally { running = false; if (alive) setLoading(false); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [id]);
  if (!task || !data) return <main className="empty"><p>{t('Select a task in Papers, or start a new conversation.')}</p><button onClick={() => void command('papilot.newTask').catch(report)}>{t('New task')}</button>{(error || data?.error) && <p role="alert">{error || data?.error}</p>}</main>;
  const refresh = () => void ready().catch(report);
  const recover = (action: 'prepare' | 'reconcile') => { setRecovering(true); void api(`/tasks/${task.id}/${action}`, {}).then(refresh).catch(report).finally(() => setRecovering(false)); };
  return <div className="chat-host"><header className="host-toolbar"><strong>{task.title}</strong><button onClick={() => void command('papilot.review').catch(report)}>{t('Review')}</button><button onClick={() => void command('papilot.apply').catch(report)}>{t('Apply')}</button></header>
    <Activity key={task.id} task={task} runtimes={data.snapshot.runtimes || { codex: data.snapshot.runtime }} runtime={data.snapshot.runtimes?.[task.agent || 'codex'] || data.snapshot.runtime}
      relatedTasks={[]} onOpenTask={() => undefined} onRevealQuote={() => void command('papilot.review').catch(report)} reconnecting={false}
      onReconnect={() => void api('/reconnect', {}).then(refresh).catch(report)} skills={data.skills} composer={composer} answerDrafts={answers.current}
      items={items} loading={loading} loadError={error} retry={refresh} requests={data.snapshot.requests.filter(request => request.taskId === task.id)} refresh={refresh}
      errorActions={task.status === 'uncertain' ? <button disabled={recovering} onClick={() => recover('reconcile')}>{t('Check status')}</button> : task.status === 'failed' && task.preparation ? <button disabled={recovering} onClick={() => recover('prepare')}>{t('Retry')}</button> : undefined}
      onTaskSaved={refresh} reportError={report} pause={() => { setPausing(true); void api(`/tasks/${task.id}/interrupt`, {}).then(refresh).catch(report).finally(() => setPausing(false)); }} pausing={pausing} openReview={() => void command('papilot.review').catch(report)}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<ResourceProvider value={resource}><Chat/></ResourceProvider>);
void ready();
