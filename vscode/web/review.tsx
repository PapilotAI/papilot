import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import { ReviewApp } from '../../engine/src/web/review.tsx';
import { reviewResponseError } from '../../engine/src/web/decision-queue.ts';
import { t } from '../../engine/src/web/i18n.ts';
import { RETRY_COMPARISON_EVENT, type OpenSource } from '../../engine/src/web/review-events.ts';
import { call, HostResponseError, ready, useHost } from './bridge.ts';
import '../../engine/src/web/style.css';
import '../../src/web/theme.css';
import './style.css';
const resource = (route: string) => call<string>('resource', { route });
function Review() {
  const data = useHost<{ view: { project: { id: string }; task?: { id: string; name: string } }; error?: string }>();
  const [error, setError] = useState('');
  const [round, setRound] = useState<number | null>(null);
  const project = data?.view.project.id, task = data?.view.task;
  const transport = useMemo(() => async <T,>(route: string, body?: unknown) => {
    try { return await call<T>('api', { route: `/review/${project}/api/${task ? `tasks/${encodeURIComponent(task.name)}` : 'changes'}${route}`, body }); }
    catch (error) {
      if (error instanceof HostResponseError) throw reviewResponseError(error.status, error.message);
      throw error;
    }
  }, [project, task?.name]);
  useEffect(() => {
    document.documentElement.dataset.papilotRetry = '1';
    const retry = (event: Event) => { event.preventDefault(); document.documentElement.dataset.papilotRetry = 'busy'; void call('publish').catch(error => setError(String(error))).finally(() => { document.documentElement.dataset.papilotRetry = '1'; }); };
    window.addEventListener(RETRY_COMPARISON_EVENT, retry);
    return () => window.removeEventListener(RETRY_COMPARISON_EVENT, retry);
  }, []);
  const openSource = (source: OpenSource) => { void call('source', { ...source }).catch(error => setError(String(error))); };
  if (!data) return <p className="empty">{t('Loading…')}</p>;
  if (data.error) return <p className="host-error" role="alert">{data.error}</p>;
  return <>{error && <p className="host-error" role="alert">{error}</p>}<ReviewApp key={round ?? 'current'} task={task?.name || ''} pinned={round} onNavigate={setRound} onOpenSource={openSource} changes={!task} transport={transport} resource={resource} live/></>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
void ready();
