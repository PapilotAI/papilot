import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { Annotation, Manuscript, MarkKind, Task } from '../shared.ts';
import type { NoteGroup } from '../note-groups.ts';
import type { Rect } from './note-geometry.ts';
import type { OutlineItem, PdfComment, PdfHandle, Target } from './pdf-view.tsx';
import { reviewDraft, useReviewDraft } from './review-draft.ts';
import { ReviewFrame } from './review-frame.tsx';
import { isPlayground, pdfAsset } from './playground-mode.ts';
import { useNoteUndo } from './use-note-undo.ts';
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
  useEffect(() => { if (!task.review?.round && task.status !== 'reviewing') setLastRound(undefined); }, [task.review?.round, task.status]);
  const onReadyChange = useCallback((value: boolean, round?: number) => {
    setReady(value);
    // A round's source can arrive before its PDF. Wait for both the viewer and
    // the completed publication, and do not replace it with a historical round.
    if (value && round && round === completedRound) setLastRound(round);
  }, [completedRound]);
  const key = manuscript?.build.key;
  // A comment written beside a passage goes into the chat's unsent message
  // with it, and the passage stays marked on its page until that message is
  // sent or the comment removed.
  const draft = useReviewDraft(task.id), reader = useRef<PdfHandle>(null);
  const comments = useMemo<PdfComment[]>(() => draft.notes.flatMap((note, index) => note.paper && note.strip.startsWith('paper:') ? [{ id: note.id, page: note.paper.page, rects: note.paper.rects, number: index + 1 }] : []), [draft.notes]);
  // Until a task has a review, its PDF takes every marking tool. The marks
  // join the same unsent message as comments: each is drawn on the PDF it was
  // made on (PdfView picks those of the build on screen) and goes to the agent
  // with the next follow-up. A task with a review marks the review instead.
  const markable = Boolean(review.onComment) && !hasReview;
  const busy = draft.busy || task.status === 'deleting';
  const [region, setRegion] = useState(false), [group, setGroup] = useState<NoteGroup | null>(null);
  const marks = useMemo(() => draft.notes.flatMap((note, index) => {
    const paper = note.paper;
    if (!paper || !note.strip.startsWith('paper:') || (lastRound && paper.round !== lastRound)) return [];
    const box: Rect = [Math.min(...paper.rects.map(r => r[0])), Math.min(...paper.rects.map(r => r[1])), Math.max(...paper.rects.map(r => r[2])), Math.max(...paper.rects.map(r => r[3]))];
    const shown: Annotation = { id: note.id, projectId, key: paper.key || '', page: paper.page, rect: box, ...(note.region ? {} : { rects: paper.rects }), comment: note.comment, quote: note.quote, source: null, createdAt: 0,
      ...(note.group ? { group: note.group } : {}), ...(note.kind ? { kind: note.kind } : {}), ...(note.stamp ? { stamp: note.stamp } : {}) };
    return [{ note: shown, number: index + 1 }];
  }), [draft.notes, projectId, lastRound]);
  const mark = useCallback(async (page: number, rect: Rect, rects: Rect[], quote: string, text: string, noteGroup?: NoteGroup, options?: { kind?: MarkKind; stamp?: string; key?: string }) => {
    const marked = rects.length ? rects : [rect];
    const id = reviewDraft(task.id).add({ strip: `paper:${page}`, round: lastRound || task.review?.round || 0, where: `PDF page ${page + 1}`, quote, rects: marked, region: !rects.length && options?.kind !== 'point',
      ...(noteGroup ? { group: noteGroup } : {}), ...(options?.kind ? { kind: options.kind } : {}), ...(options?.stamp ? { stamp: options.stamp } : {}),
      paper: { page, rects: marked, ...(lastRound ? { round: lastRound } : options?.key ? { key: options.key } : {}) } }, false, text);
    // A written note shows the chat with it; a group's marks, deletions and
    // quick notes stay on the page until the message is sent.
    if (id && !noteGroup && !options?.kind && !options?.stamp) review.onComment?.();
  }, [task.id, task.review?.round, lastRound, review.onComment]);
  useNoteUndo(() => markable && !busy && reviewDraft(task.id).undo(), undefined, () => markable && !busy && reviewDraft(task.id).redo());
  const comment = useCallback((target: Target, text: string, pdfKey?: string) => {
    const rects = target.rects.length ? target.rects : [target.rect];
    reviewDraft(task.id).add({ strip: `paper:${target.page}`, round: lastRound || task.review?.round || 0, where: `PDF page ${target.page + 1}`, quote: target.quote, rects, region: false,
      paper: { page: target.page, rects, ...(lastRound ? { round: lastRound } : pdfKey ? { key: pdfKey } : {}) } }, false, text);
    review.onComment?.();
  }, [task.id, task.review?.round, lastRound, review.onComment]);
  useEffect(() => {
    const note = draft.reveal?.note;
    if (!note?.paper || visibleReview) return;
    const [first] = note.paper.rects;
    reader.current?.showPlace(note.paper.page, [Math.min(...note.paper.rects.map(r => r[0])), first[1], Math.max(...note.paper.rects.map(r => r[2])), note.paper.rects.at(-1)![3]], { keep: true });
    reviewDraft(task.id).clearReveal();
  }, [draft.reveal, visibleReview, task.id]);
  const url = lastRound ? pdfAsset(`/api/tasks/${task.id}/pdf?round=${lastRound}&retained=1`)
    : key ? pdfAsset(`/api/projects/${projectId}/manuscript.pdf?key=${key}`) : '';
  return <>
    {!visibleReview && hasReview && review.completion && <div className="task-document-actions">{review.completion}</div>}
    <div className={'task-document' + (visibleReview ? ' has-review' : '')}>
    <div className="task-document-preview" aria-hidden={visibleReview} inert={visibleReview}>
      {url ? <Suspense fallback={<div className="review-loading"><p role="status">{t('Opening the PDF…')}</p></div>}>
        {markable ? <PdfView ref={reader} pdfKey={lastRound ? undefined : key} keyedNotes={!lastRound} place={'task-pdf:' + task.id} url={url} sourceInfo={lastRound && !isPlayground ? `${url}&metadata=1` : undefined} notes={marks} active={draft.editing?.id ?? ''} region={region} setRegion={setRegion}
          group={group} onGroupChange={setGroup} markingDisabled={busy} onCreate={mark} onSelect={note => { reviewDraft(task.id).focus(note.id); review.onComment?.(); }}
          history={{ canUndo: !busy && draft.canUndo, canRedo: !busy && draft.canRedo, undo: () => { reviewDraft(task.id).undo(); }, redo: () => { reviewDraft(task.id).redo(); } }}
          outline={outline} section={section} onOutline={setOutline} onSection={setSection} lead={review.lead} tools={review.tools}/>
        : <PdfView ref={reader} readOnly onComment={review.onComment ? comment : undefined} comments={comments} pdfKey={lastRound ? undefined : key} suspended={visibleReview} place={'task-pdf:' + task.id} url={url} sourceInfo={lastRound && !isPlayground ? `${url}&metadata=1` : undefined} notes={[]} active="" region={false} setRegion={nothing} onCreate={async () => {}} onSelect={nothing}
          outline={outline} section={section} onOutline={setOutline} onSection={setSection} lead={visibleReview ? undefined : review.lead} tools={visibleReview ? undefined : review.tools}/>}
      </Suspense> : !hasReview && <>{(review.lead || review.tools) && <div className="review-placeholder-toolbar">{review.lead}<div className="panel-tools">{review.tools}</div></div>}{placeholder}</>}
    </div>
    {hasReview && <ReviewFrame {...review} lead={visibleReview || !url ? review.lead : undefined} tools={visibleReview || !url ? review.tools : undefined} task={task} keepPdf={Boolean(url)} onReadyChange={onReadyChange}/>}
    </div>
  </>;
}
