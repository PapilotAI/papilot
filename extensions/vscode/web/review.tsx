import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import { ReviewApp } from '../../../engine/src/web/review.tsx';
import { t } from '../../../src/web/i18n.ts';
import { OPEN_SOURCE_EVENT, RETRY_COMPARISON_EVENT, type OpenSource } from '../../../engine/src/web/review-events.ts';
import { call, ready, useHost } from './bridge.ts';
import '../../../engine/src/web/style.css';
import '../../../src/web/theme.css';
import './style.css';
const resource = (route: string) => call<string>('resource', { route });
function Review() {
  const data = useHost<{ view: { project: { id: string }; task?: { id: string; name: string } }; error?: string }>();
  const [error, setError] = useState('');
  const [round, setRound] = useState<number | null>(null);
  const project = data?.view.project.id, task = data?.view.task;
  const transport = useMemo(() => <T,>(route: string, body?: unknown) => call<T>('api', { route: `/review/${project}/api/${task ? `tasks/${encodeURIComponent(task.name)}` : 'changes'}${route}`, body }), [project, task?.name]);
  useEffect(() => {
    document.documentElement.dataset.papilotRetry = '1';
    const retry = (event: Event) => { event.preventDefault(); document.documentElement.dataset.papilotRetry = 'busy'; void call('publish').catch(error => setError(String(error))).finally(() => { document.documentElement.dataset.papilotRetry = '1'; }); };
    window.addEventListener(RETRY_COMPARISON_EVENT, retry);
    const source = (event: Event) => { event.preventDefault(); const detail = (event as CustomEvent<OpenSource>).detail; void call('source', detail as unknown as Record<string, unknown>).catch(error => setError(String(error))); };
    window.addEventListener(OPEN_SOURCE_EVENT, source);
    return () => { window.removeEventListener(OPEN_SOURCE_EVENT, source); window.removeEventListener(RETRY_COMPARISON_EVENT, retry); };
  }, []);
  if (!data) return <p className="empty">{t('Loading PDF review…')}</p>;
  if (data.error) return <p className="host-error" role="alert">{data.error}</p>;
  return <>{error && <p className="host-error" role="alert">{error}</p>}<ReviewApp key={round ?? 'current'} task={task?.name || ''} pinned={round} onNavigate={setRound} changes={!task} transport={transport} resource={resource} live/></>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
void ready();
