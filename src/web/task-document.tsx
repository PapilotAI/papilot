import { lazy, Suspense, useCallback, useState, type ComponentProps, type ReactNode } from 'react';
import type { Manuscript, Task } from '../shared.ts';
import type { OutlineItem } from './pdf-view.tsx';
import { ReviewFrame } from './review-frame.tsx';
import { pdfAsset } from './playground-mode.ts';
import { t } from './i18n.ts';

const PdfView = lazy(() => import('./pdf-view.tsx').then(module => ({ default: module.PdfView })));
const nothing = () => {};

// Keep a reader mounted behind the comparison. The manuscript is the first
// readable version; a successful task round replaces it only after it loads.
// A new round, a failed compile, or an empty answer must not remove the paper.
export function TaskDocument({ task, projectId, manuscript, placeholder, ...review }: Omit<ComponentProps<typeof ReviewFrame>, 'task'> & {
  task: Task; projectId: string; manuscript: Manuscript | null; placeholder: ReactNode;
}) {
  const [ready, setReady] = useState(false), [lastRound, setLastRound] = useState<number>();
  const [outline, setOutline] = useState<OutlineItem[]>([]), [section, setSection] = useState(-1);
  const hasReview = Boolean(!task.preparation && task.review?.round);
  const failed = task.review?.state === 'build_failed' || task.review?.job?.status === 'failed';
  const completedRound = !failed && task.status !== 'building' && !task.pendingBuild && task.review?.state !== 'building' ? task.review?.round : null;
  const visibleReview = hasReview && ready;
  const onReadyChange = useCallback((value: boolean, round?: number) => {
    setReady(value);
    // A round's source can arrive before its PDF. Wait for both the viewer and
    // the completed publication, and do not replace it with a historical round.
    if (value && round && round === completedRound) setLastRound(round);
  }, [completedRound]);
  const key = manuscript?.build.key;
  const url = lastRound ? pdfAsset(`/api/tasks/${task.id}/pdf?round=${lastRound}`)
    : key ? pdfAsset(`/api/projects/${projectId}/manuscript.pdf?key=${key}`) : '';
  return <>
    {!visibleReview && hasReview && review.completion && <div className="task-document-actions">{review.completion}</div>}
    <div className={'task-document' + (visibleReview ? ' has-review' : '')}>
    <div className="task-document-preview" aria-hidden={visibleReview} inert={visibleReview}>
      {url ? <>
        <Suspense fallback={<div className="review-loading"><p role="status">{t('Opening the PDF…')}</p></div>}>
          <PdfView readOnly suspended={visibleReview} place={'task-pdf:' + task.id} url={url} notes={[]} active="" region={false} setRegion={nothing} onCreate={async () => {}} onSelect={nothing}
            outline={outline} section={section} onOutline={setOutline} onSection={setSection} lead={visibleReview ? undefined : review.lead} tools={visibleReview ? undefined : review.tools}/>
        </Suspense>
        <div className="task-document-status"><span className="task-document-version">{lastRound ? t('Full PDF') : t('Manuscript')}</span>{failed && <p>{t('The latest changes did not compile. This is the last PDF that did.')}</p>}{!hasReview && placeholder}</div>
      </> : !hasReview && <>{(review.lead || review.tools) && <div className="review-placeholder-toolbar">{review.lead}<div className="panel-tools">{review.tools}</div></div>}{placeholder}</>}
    </div>
    {hasReview && <ReviewFrame {...review} lead={visibleReview || !url ? review.lead : undefined} tools={visibleReview || !url ? review.tools : undefined} task={task} keepPdf={Boolean(url)} onReadyChange={onReadyChange}/>}
    </div>
  </>;
}
