import type { RoundDetail } from '../../engine/src/types.ts';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Annotation, NoteChange, NoteResult, NoteReturnReceipt, NoteReturnState, NoteOption, NoteOptions, Task, TimelineItem } from '../shared.ts';
import { readNotesInstructions } from '../notes.ts';
import { animateSubmittedNotes } from './note-flight.ts';
import { Icon } from './icons.tsx';
import { errorText, t, tn } from './i18n.ts';
import { reviewDraft, useReviewDraft } from './review-draft.ts';
import { browserStorage } from './storage.ts';
import { NotePreviewCache } from './note-preview-cache.ts';

export interface NoteFocus { key: string; change: NoteChange; sequence: number; historical: boolean }
type OptionsRequest = (id: string, key: string, body?: { round: number; option?: string; id?: string; accept?: boolean; reject?: boolean }) => Promise<NoteOptions>;
type Preview = { key: string; round: number; option: string; version?: string; detail?: RoundDetail; busy?: boolean } | null;
type Advance = { key: string; round: number; units: string[] };
type PreviewRequest = (id: string, key: string, round: number, option: string, retry?: boolean, version?: string, background?: boolean) => Promise<RoundDetail>;
export const NOTE_RETURN_HISTORY = "papilot:note-return-history";
type ReturnRequest = (task: string, note: string, undoReturnAt?: number, clicked?: NoteResult) => Promise<NoteReturnState>;
const previewKey = (id: string, key: string, round: number, option: string, version?: string) => JSON.stringify([id, key, round, option, version]);
const comparisonCache = new NotePreviewCache<RoundDetail>();
const optionCache = new Map<string, NoteOptions>();
const optionStateKey = (task: Task | undefined, notes: NoteResult[], note: NoteResult) => JSON.stringify([
  task?.id, note.key, note.round, task?.updatedAt, task?.review?.counts,
  notes.map(note => [note.key, note.round, note.changes.map(change => [change.stop, change.state])]),
]);
function rememberOptions(key: string, options: NoteOptions) {
  optionCache.delete(key); optionCache.set(key, options);
  if (optionCache.size > 24) optionCache.delete(optionCache.keys().next().value!);
}
// A note's options are read once, shared by the page and the drawer: a read
// already in flight is joined, and a cached one answers at once.
const optionReads = new Map<string, ReturnType<OptionsRequest>>();
function readOptions(key: string, load: () => ReturnType<OptionsRequest>, fresh = false) {
  const cached = !fresh && optionCache.get(key);
  if (cached) return Promise.resolve(cached);
  let request = optionReads.get(key);
  if (!request) {
    request = load().then(result => { if ('options' in result) rememberOptions(key, result); return result; })
      .finally(() => { optionReads.delete(key); });
    optionReads.set(key, request);
  }
  return request;
}
function rememberedChoice(key: string, options?: NoteOptions | null) {
  try {
    const saved = JSON.parse(browserStorage.getItem(key) || 'null');
    if (options && !options.locked && saved?.round === options.round && options.options.some(option => option.id === saved.option)) return saved.option as string;
  } catch { /* Ignore a stale local choice. */ }
  return options?.selected || 'current';
}
function optionLockText(reason: string) {
  switch (reason) {
    case 'Options are available on the latest open review.': return t('Options are available on the latest open review.');
    case 'Options are not available for this source range yet.': return t('Options are not available for this source range yet.');
    case 'This note includes a reviewed change. Undo that decision before replacing it.': return t('This note includes a reviewed change. Undo that decision before replacing it.');
    case 'Wait for the current task and review actions to finish.': return t('Wait for the current task and review actions to finish.');
    default: return errorText(reason);
  }
}
// A dropped connection says nothing the author can act on beyond retrying.
const optionError = (message: string) => /fetch failed|failed to fetch|networkerror|load failed/i.test(message)
  ? t('Request failed. Please try again.') : errorText(message);
async function warmComparison(detail: RoundDetail, background = false) {
  const strips = [...detail.sections.flatMap(section => section.blocks), ...detail.loose].flatMap(block => block.kind === 'context' ? [block.image] : block.kind === 'change' ? [...block.before, ...block.after] : []);
  // Decode the first visible strips before swapping, so a ready comparison
  // does not briefly show a blank page while its SVGs arrive.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([...new Set(strips.map(strip => detail.files + (strip.clean || strip.src)))].slice(0, 16).map(src => {
        const image = new Image();
        if (background) image.fetchPriority = 'low';
        image.src = src; return image.decode();
      })),
      new Promise(resolve => { timer = setTimeout(resolve, 500); }),
    ]);
  } finally { clearTimeout(timer); }
  return detail;
}
interface Links {
  task?: Task; optionsRequest?: OptionsRequest; previewRequest?: PreviewRequest; preview: Preview; setPreview: Dispatch<SetStateAction<Preview>>;
  cachedPreview: (id: string, key: string, round: number, option: string, version?: string) => RoundDetail | undefined;
  notes: NoteResult[]; error: boolean; loading: boolean; selected: string; reveal: number;
  focus: NoteFocus | null; reload: () => void;
  clearFocus: () => void; decisionSaved: (decision: Advance) => void;
  focusNote: (key: string) => void;
  returns: Record<string, { pending: boolean; error?: string }>;
  returnNote?: (key: string, source: HTMLElement) => void;
  reviewOperation?: (decision?: string, undone?: string) => void;
  replayReturn?: (direction: 'undo' | 'redo') => boolean;
  confirmReturns: (receipts: NoteReturnReceipt[], source?: HTMLElement | null) => void;
  showChange: (key: string, change: NoteChange) => void; showNote: (key: string) => void;
}
const Context = createContext<Links | null>(null);
export const useNoteResults = () => useContext(Context);

export function NoteResultsProvider({ task, items, read, optionsRequest, previewRequest, returnRequest, replayReturn, reviewOperation, onDecisionReturns, openReview, openChat, children }: {
  task?: Task; items: TimelineItem[]; read: (id: string) => Promise<{ notes: NoteResult[] }>;
  optionsRequest?: OptionsRequest; previewRequest?: PreviewRequest; returnRequest?: ReturnRequest; replayReturn?: Links['replayReturn']; reviewOperation?: Links['reviewOperation']; onDecisionReturns?: (receipts: NoteReturnReceipt[]) => Set<string>; openReview: () => void; openChat: () => void; children: ReactNode;
}) {
  const [notes, setNotes] = useState<NoteResult[]>([]), [error, setError] = useState(false), [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(''), [focus, setFocus] = useState<NoteFocus | null>(null);
  const [reveal, setReveal] = useState(0);
  const [preview, setPreview] = useState<Preview>(null);
  // The decision just saved, to move on from once confirmed.
  const [advance, setAdvance] = useState<Advance | null>(null);
  const sequence = useRef(0), actions = useRef({ read, openReview, openChat }); actions.current = { read, openReview, openChat };
  const signature = items.filter(item => item.type === 'user' && (item.meta?.notes?.length || readNotesInstructions(item.text))).map(item => item.id).join(',');
  const id = task?.id;
  const activeTask = useRef(id); activeTask.current = id;
  const runningReturns = useRef(new Set<string>());
  const [returns, setReturns] = useState<Links['returns']>({});
  const reload = useCallback(() => {
    if (!id || !signature) return;
    const request = ++sequence.current; setLoading(true); setError(false);
    void actions.current.read(id).then(result => { if (!Array.isArray(result.notes)) throw new Error('Invalid note results'); if (sequence.current === request) setNotes(result.notes); }).catch(() => { if (sequence.current === request) setError(true); }).finally(() => { if (sequence.current === request) setLoading(false); });
  }, [id, signature]);
  const decisions = JSON.stringify(task?.review?.counts);
  useEffect(() => { reload(); return () => { ++sequence.current; }; }, [reload, task?.review?.round, task?.status, task?.updatedAt, decisions]);
  useEffect(() => { setNotes([]); setPreview(null); setFocus(null); setSelected(''); setError(false); setAdvance(null); }, [id]);
  const showNote = (key: string) => {
    setSelected(key); setReveal(value => value + 1); actions.current.openChat();
    requestAnimationFrame(() => {
      const element = [...document.querySelectorAll<HTMLElement>('[data-note-result]')].find(element => element.dataset.noteResult === key);
      element?.scrollIntoView({ block: 'center' }); element?.focus({ preventScroll: true });
    });
  };
  const showChange = (key: string, change: NoteChange) => {
    if (id) reviewDraft(id).clearReveal();
    setPreview(previous => previous?.key === key && previous.round === change.round ? previous : null); setSelected(key); setFocus(previous => ({ key, change, sequence: (previous?.sequence || 0) + 1, historical: change.round !== task?.review?.round })); actions.current.openReview();
  };
  const focusNote = (key: string) => {
    const note = notes.find(note => note.key === key);
    if (note?.changes[0]) showChange(key, note.changes[0]);
    else if (note) { setSelected(key); setFocus(null); actions.current.openReview(); }
  };
  useEffect(() => {
    if (!focus) return;
    const note = notes.find(note => note.key === focus.key);
    if (note?.changes[0] && note.changes[0].round !== focus.change.round) setFocus({ ...focus, change: note.changes[0], sequence: focus.sequence + 1, historical: note.changes[0].round !== task?.review?.round });
  }, [notes]);
  useEffect(() => {
    if (!advance) return;
    // Moving to another note, a failure or a new agent turn ends the wait.
    if (focus?.key !== advance.key || ['failed', 'uncertain', 'interrupted', 'queued', 'running', 'waiting_input'].includes(task?.status || '')) { setAdvance(null); return; }
    if (task?.status !== 'reviewing' || task.pendingReview) return;
    const current = notes.find(note => note.key === advance.key);
    if (!current) return;
    // Wait for the reloaded notes to confirm the decision: its changes, or
    // those of the round an accepted alternative built, are decided.
    const covered = current.changes.filter(change => change.round !== advance.round || change.units.some(unit => advance.units.includes(unit)));
    if (!covered.length || covered.some(change => change.state === 'pending')) return;
    setAdvance(null);
    // The note still has a change of its own to decide: stay on it.
    if (current.changes.some(change => change.state === 'pending')) return;
    // Several notes can share one edit: skip those together, and keep the
    // last note open when none is left, so it can be inspected or undone.
    const siblings = notes.filter(note => note.itemId === current.itemId), index = siblings.indexOf(current);
    const next = [...siblings.slice(index + 1), ...siblings.slice(0, index)].find(note => note.round === task.review?.round
      && note.changes.length && note.changes.every(change => change.state === 'pending'));
    if (next) showChange(next.key, next.changes[0]);
  }, [advance, notes, focus?.key, task?.status, task?.pendingReview, task?.review?.round]);
  const requests = useRef({ optionsRequest }); requests.current = { optionsRequest };
  const here = useRef(''); here.current = focus?.key || selected;
  const noteSignature = JSON.stringify(notes.map(note => [note.key, note.round, note.changes.map(change => change.state)]));
  useEffect(() => {
    if (!id || task?.status !== 'reviewing') return;
    const { optionsRequest } = requests.current;
    if (!optionsRequest) return;
    let cancelled = false;
    // Warm every current note's small manifest so inline option tabs open without delay.
    const eligible = notes.filter(note => note.round === task.review?.round && note.changes.length);
    const start = Math.max(0, eligible.findIndex(note => note.key === here.current));
    void (async () => {
      for (const note of [...eligible.slice(start), ...eligible.slice(0, start)]) {
        if (cancelled) return;
        try {
          await readOptions(optionStateKey(task, notes, note), () => optionsRequest(id, note.key));
        } catch { /* Opening the note reports errors and offers Retry. */ }
      }
    })();
    return () => { cancelled = true; };
  }, [id, task?.status, task?.review?.round, task?.updatedAt, decisions, noteSignature]);
  function confirmReturns(receipts: NoteReturnReceipt[], source?: HTMLElement | null) {
    const fresh = onDecisionReturns?.(receipts);
    if (activeTask.current !== id) return;
    const updates = new Map<string, NoteReturnReceipt>();
    const flights: Parameters<typeof animateSubmittedNotes>[0] = [];
    for (const receipt of receipts) {
      const note = notes.find(item => item.key === receipt.key);
      // An undo or a newer return may already have reached this browser.
      const copy = receipt.annotation || receipt.removed;
      if (!note?.note.id || (copy && fresh && !fresh.has(copy.id))) continue;
      updates.set(note.note.id, receipt);
      const origin = source;
      if ((receipt.moved || receipt.returned !== note.returned) && origin?.isConnected &&
          (origin instanceof HTMLIFrameElement || (origin.dataset.noteResult ?? origin.dataset.noteKey) === note.key)) {
        flights.push({ note, source: origin, returned: receipt.returned });
      }
    }
    if (flights.length) animateSubmittedNotes(flights);
    if (updates.size) setNotes(current => current.map(note => {
      const update = note.note.id && updates.get(note.note.id);
      return update ? { ...note, returned: update.returned, undoReturnAt: update.undoReturnAt } : note;
    }));
    reload();
  }
  useEffect(() => {
    const replayed = (event: Event) => {
      const { taskId, receipt } = (event as CustomEvent<{ taskId: string; receipt: NoteReturnReceipt }>).detail;
      if (taskId !== id) return;
      setReturns(current => {
        if (!current[receipt.key]?.error) return current;
        const next = { ...current }; delete next[receipt.key]; return next;
      });
      const key = CSS.escape(receipt.key);
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('.review-frame')].find(frame => frame.getBoundingClientRect().height);
      const row = document.querySelector<HTMLElement>(`[data-note-result="${key}"]`);
      confirmReturns([receipt], frame || row);
    };
    window.addEventListener(NOTE_RETURN_HISTORY, replayed);
    return () => window.removeEventListener(NOTE_RETURN_HISTORY, replayed);
  });
  function returnNote(key: string, source: HTMLElement) {
    const note = notes.find(note => note.key === key);
    if (!returnRequest || !id || !note?.note.id || note.returned === undefined || (note.returned && note.undoReturnAt === undefined) || runningReturns.current.has(key)) return;
    runningReturns.current.add(key);
    setReturns(current => ({ ...current, [key]: { pending: true } }));
    void returnRequest(id, note.note.id, note.returned ? note.undoReturnAt : undefined, note).then(result => {
      setReturns(current => { const next = { ...current }; delete next[key]; return next; });
      confirmReturns([{ ...result, key }], source);
    }, error => {
      setReturns(current => ({ ...current, [key]: { pending: false, error: optionError(error instanceof Error ? error.message : String(error)) } }));
    }).finally(() => runningReturns.current.delete(key));
  }
  const value: Links = { task, optionsRequest, previewRequest: previewRequest && ((id, key, round, option, retry, version, background = false) => comparisonCache.read(previewKey(id, key, round, option, version),
    background => previewRequest(id, key, round, option, retry, version, background).then(detail => warmComparison(detail, background)),
    // A second lightweight request promotes the engine's existing work. Keep
    // one decoded result and one promise for everyone waiting in this page.
    background ? () => { void previewRequest(id, key, round, option, retry, version, false).catch(() => {}); } : undefined)), cachedPreview: (id, key, round, option, version) => comparisonCache.peek(previewKey(id, key, round, option, version)), preview: preview?.round === task?.review?.round ? preview : null, setPreview, notes, loading, error, selected, reveal, focus, reload, showNote, focusNote,
    clearFocus: () => { setPreview(null); setFocus(null); setSelected(''); setAdvance(null); },
    decisionSaved: decision => { setAdvance(decision); reload(); }, showChange, returns, confirmReturns, replayReturn, reviewOperation, returnNote: returnRequest && returnNote };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function NoteReturnAction({ noteKey }: { noteKey: string }) {
  const links = useNoteResults();
  const note = links?.notes.find(note => note.key === noteKey);
  if (!links?.returnNote || note?.returned === undefined || (note.returned && note.undoReturnAt === undefined)) return null;
  const pending = links.returns[noteKey]?.pending;
  const label = note.returned ? t('Undo return to manuscript') : t('Return to manuscript');
  return <span className="note-disposition">
    <span className="sr-only" role="status">{pending && !note.returned ? t('Returning…') : note.returned ? t('Returned to manuscript') : ''}</span>
    <button type="button" className="icon-button note-return-toggle" data-returned={note.returned || undefined} aria-disabled={pending || undefined} aria-busy={pending || undefined} aria-label={`${t('Note {n}', { n: note.index + 1 })} · ${label}`} title={label}
      onClick={event => {
        event.stopPropagation();
        const found = event.currentTarget.closest<HTMLElement>('[data-note-result], .papilot-inline-note');
        const source = found && found.ownerDocument !== window.document
          ? [...window.document.querySelectorAll<HTMLIFrameElement>('.review-frame')].find(frame => frame.getBoundingClientRect().height) || null
          : found;
        if (source && !pending) links.returnNote!(noteKey, source);
      }}><Icon name={note.returned ? 'manuscriptNote' : 'checkedManuscriptNote'}/></button>
  </span>;
}

export function NoteReturnError({ noteKey }: { noteKey: string }) {
  const error = useNoteResults()?.returns[noteKey]?.error;
  return error ? <span className="inline-error note-return-error" role="alert">{error}</span> : null;
}

/** Compact non-blocking retry button shown only if the initial note-linking lookup fails. */
export function NoteLinkError() {
  const links = useNoteResults();
  if (!links?.error || links.notes.length) return null;
  return <div className="note-link-error" role="alert">
    <button type="button" className="note-result-retry" onClick={links.reload}><Icon name="refresh" size={12}/>{t('Retry linking changes')}</button>
  </div>;
}

/** Inline annotation bar rendered directly inside a change card's header area,
 *  showing the note text, return-to-manuscript control, and (when prepared)
 *  inline alternative-option tabs that preview live on the card's own PDF strip. */
export function InlineNoteBar({ note }: { note: NoteResult }) {
  const links = useNoteResults()!, request = links.optionsRequest, task = links.task;
  const tabsId = useId(), container = useRef<HTMLDivElement>(null);
  const storageKey = `papilot:note-choice:${task?.id}:${note.key}`;
  const optionsKey = optionStateKey(task, links.notes, note);
  const remembered = optionCache.get(optionsKey);
  const draft = reviewDraft(task?.id || ''), feedback = useReviewDraft(task?.id || '');
  const [editor, setEditor] = useState<string | null>(null), commentInput = useRef<HTMLTextAreaElement>(null);
  const [data, setData] = useState<NoteOptions | null>(remembered || null), [selected, setSelected] = useState(() => rememberedChoice(storageKey, remembered));
  const [busy, setBusy] = useState(false), [applying, setApplying] = useState(false), [error, setError] = useState('');
  const [retry, setRetry] = useState(0), [previewBusy, setPreviewBusy] = useState(false);
  const previewSequence = useRef(0), requestId = useRef<{ option: string; action: 'accept' | 'reject'; id: string } | null>(null);
  const saved = data?.selected || 'current';
  const multiple = (data?.options.length || 0) > 1;
  const previewingAlt = Boolean(multiple && selected !== saved);

  useEffect(() => {
    if (applying && task && ['failed', 'uncertain', 'interrupted'].includes(task.status)) {
      setApplying(false); setError(task.error || t('The choice could not be saved.'));
    }
  }, [applying, task?.status, task?.error]);

  useEffect(() => {
    if (!request || !task || !note.changes.length) return;
    let cancelled = false; setBusy(true); setError('');
    void readOptions(optionsKey, () => request(task.id, note.key), retry > 0).then(result => {
      if (cancelled || !('options' in result)) return;
      setData(result); setSelected(rememberedChoice(storageKey, result)); setApplying(false);
    }).catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; ++previewSequence.current; };
  }, [optionsKey, retry]);

  // Clear this note's live PDF preview when unmounting or switching notes.
  useEffect(() => () => {
    links.setPreview(previous => previous?.key === note.key ? null : previous);
  }, [note.key, links.setPreview]);

  useEffect(() => { if (editor) commentInput.current?.focus(); }, [editor]);

  useEffect(() => {
    const sequence = ++previewSequence.current;
    setPreviewBusy(false);
    if (!task || !data || !links.previewRequest || selected === saved || data.locked) {
      links.setPreview(previous => previous?.key === note.key ? null : previous);
      return;
    }
    const identity = { key: note.key, round: data.round, option: selected, version: data.comparisonKey, busy: applying || task.status === 'building' };
    const cached = links.cachedPreview(task.id, note.key, data.round, selected, data.comparisonKey);
    if (cached) { links.setPreview({ ...identity, detail: cached }); return; }
    links.setPreview(identity); setPreviewBusy(true);
    void links.previewRequest(task.id, note.key, data.round, selected, retry > 0, data.comparisonKey).then(detail => {
      if (previewSequence.current !== sequence) return;
      links.setPreview({ ...identity, detail });
    }).catch(err => { if (previewSequence.current === sequence) setError(err.message); })
      .finally(() => { if (previewSequence.current === sequence) setPreviewBusy(false); });
    return () => { ++previewSequence.current; };
  }, [optionsKey, task?.id, task?.status, applying, note.key, data?.round, data?.comparisonKey, data?.locked, selected, saved, retry]);

  // Warm alternative option PDFs in the background when multiple options exist.
  const optionIds = data?.options.map(option => option.id).join(',');
  useEffect(() => {
    if (!task || !data || data.locked || !multiple || !links.previewRequest) return;
    const others = data.options.filter(option => option.id !== selected && !option.previewError);
    for (const option of others) void links.previewRequest(task.id, note.key, data.round, option.id, false, data.comparisonKey, true).catch(() => {});
  }, [task?.id, note.key, data?.round, data?.comparisonKey, data?.locked, multiple, optionIds]);

  const locked = data?.locked || (note.changes.some(change => change.state !== 'pending') ? 'This note includes a reviewed change. Undo that decision before replacing it.' : task && (task.status !== 'reviewing' || task.pendingReview) ? 'Wait for the current task and review actions to finish.' : '');
  const choose = (option: string) => {
    if (!data || applying) return;
    setSelected(option); setEditor(null); requestId.current = null; setError('');
    browserStorage.setItem(storageKey, JSON.stringify({ round: data.round, option }));
  };
  const decide = async (option: NoteOption, action: 'accept' | 'reject') => {
    if (!request || !task || !data || applying || locked) return;
    if (selected !== option.id) choose(option.id);
    setApplying(true); setError('');
    try {
      if (requestId.current?.option !== option.id || requestId.current.action !== action)
        requestId.current = { option: option.id, action, id: crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(20)), byte => byte.toString(16).padStart(2, '0')).join('') };
      const actionId = requestId.current.id;
      const result = await request(task.id, note.key, { round: data.round, option: option.id, id: actionId, ...(action === 'accept' ? { accept: true } : { reject: true }) });
      requestId.current = null;
      const rejected = optionFeedback(option.id, 'reject'); if (rejected) draft.remove(rejected.id);
      browserStorage.removeItem(storageKey);
      if ('options' in result) { links.reviewOperation?.(actionId); setData(result); setSelected(result.selected || 'current'); setApplying(false); }
      if ('noteReturn' in result && result.noteReturn) {
        const frame = [...window.document.querySelectorAll<HTMLIFrameElement>('.review-frame')].find(f => f.getBoundingClientRect().height) || null;
        links.confirmReturns([{ ...result.noteReturn, key: note.key }], frame);
      } else if (action === 'reject') links.reload();
      else links.decisionSaved({ key: note.key, round: data.round, units: option.edits.map(edit => edit.unit) });
    } catch (err) { setError((err as Error).message); setApplying(false); }
  };
  const saving = applying || task?.status === 'building';
  const label = (id: string, text: string) => id === 'latest' ? t('Current proposal')
    : id === 'current' && (text === 'Current proposal' || text === 'Initial proposal') ? t('Initial proposal') : text;
  const optionFeedback = (id: string, kind: 'comment' | 'reject') => feedback.notes.find(item => item.round === data?.round && item.option?.note === note.key && item.option.id === id && item.option.kind === kind);
  const addFeedback = (option: NoteOption) => draft.add({
    round: data!.round, strip: '', rects: [], region: false,
    where: `Round ${data!.round} · ${note.note.where} · Note ${note.index + 1} · Option: ${label(option.id, option.label)}`,
    quote: option.edits.map(edit => edit.text).join('\n'),
    option: { note: note.key, id: option.id, label: label(option.id, option.label), kind: 'comment' },
  }, false);
  const comment = (option: NoteOption) => {
    if (!locked) choose(option.id);
    setEditor(optionFeedback(option.id, 'comment')?.id || addFeedback(option) || null);
  };
  const editing = feedback.notes.find(item => item.id === editor);
  const active = data?.options.find(option => option.id === selected);
  // Route the card header's single ✓ / ✕ / 💬 buttons directly to the active
  // alternative option so there is never a duplicate row of decision buttons.
  const actionHandlers = useRef({ decide, comment, active });
  actionHandlers.current = { decide, comment, active };
  useEffect(() => {
    const view = container.current?.ownerDocument?.defaultView;
    if (!view || !previewingAlt) return;
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; action?: 'accept' | 'reject' | 'comment' }>).detail;
      const option = actionHandlers.current.active;
      if (!detail || detail.key !== note.key || !option) return;
      if (detail.action === 'accept' || detail.action === 'reject') void actionHandlers.current.decide(option, detail.action);
      else if (detail.action === 'comment') actionHandlers.current.comment(option);
    };
    view.addEventListener('papilot:option-action', onAction);
    return () => view.removeEventListener('papilot:option-action', onAction);
  }, [note.key, previewingAlt]);
  const hasRigorCaution = Boolean(active?.meta?.rigor === 'warn' || active?.meta?.rigor === 'fail');
  const showDetailRow = Boolean(multiple && (active?.reason || hasRigorCaution || editing || (locked && previewingAlt)));
  const panelId = `${tabsId}-panel`;

  return <div ref={container} className="papilot-inline-note note-options" data-note-key={note.key} aria-busy={applying} onClick={event => event.stopPropagation()}>
    <div className="papilot-inline-note-main">
      <span className="papilot-unit-note-num" title={note.note.where}>#{note.index + 1}</span>
      <span className="papilot-unit-note-text" title={note.note.comment}>{note.note.comment}</span>
      <NoteReturnAction noteKey={note.key}/>
    </div>
    {data && multiple && <div className="papilot-inline-options">
      <div className="papilot-inline-tabs note-option-tabs" role="tablist" aria-label={t('Options for this note')} aria-busy={saving || previewBusy}>
        {data.options.map((option, index) => {
          const tabName = label(option.id, option.label);
          const sep = tabName.indexOf(' · ');
          const tabModel = sep > 0 ? tabName.slice(0, sep) : tabName;
          const tabTag = sep > 0 ? tabName.slice(sep + 3) : '';
          const meta = option.meta;
          const lineTag = meta?.lineDelta ? `${meta.lineDelta > 0 ? '+' : '−'}${Math.abs(meta.lineDelta)}L` : '';
          const lineDeltaKind = meta?.lineDelta ? (meta.lineDelta < 0 ? 'shorter' : 'longer') : undefined;
          const lineSpoken = meta?.lineDelta
            ? (meta.lineDelta > 0 ? tn(meta.lineDelta, '+{n} line', '+{n} lines') : tn(Math.abs(meta.lineDelta), '−{n} line', '−{n} lines'))
            : '';
          const accessibleLabel = [
            tabName,
            meta?.recommended ? t('Recommended') : '',
            meta?.rigor === 'warn' || meta?.rigor === 'fail' ? t('Rigor caution') : '',
            lineSpoken,
          ].filter(Boolean).join(' · ');
          const isSelected = selected === option.id;
          return <button type="button" className="papilot-inline-tab note-option-tab" role="tab" key={option.id} id={`${tabsId}-${option.id}`} data-option={option.id} data-rigor={meta?.rigor || undefined} data-recommended={meta?.recommended ? 'true' : undefined} aria-selected={isSelected} aria-controls={isSelected && showDetailRow ? panelId : undefined} tabIndex={isSelected ? 0 : -1} disabled={saving || Boolean(locked) || busy} aria-label={accessibleLabel} onClick={event => {
            choose(option.id);
            event.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' });
          }} onKeyDown={event => {
            const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            if (!offset && event.key !== 'Home' && event.key !== 'End') return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? data.options.length - 1 : (index + offset + data.options.length) % data.options.length;
            choose(data.options[next].id);
            const target = event.currentTarget.parentElement!.children[next] as HTMLButtonElement;
            target.focus();
            target.scrollIntoView({ inline: 'nearest', block: 'nearest' });
          }}><span className="note-option-label">
            {meta?.recommended && <span className="papilot-opt-star" aria-hidden="true">★</span>}
            <span className="papilot-opt-model">{tabModel}</span>
            {tabTag && <><span className="papilot-opt-sep" aria-hidden="true">·</span><span className="papilot-opt-tag">{tabTag}</span></>}
            {(meta?.rigor === 'warn' || meta?.rigor === 'fail') && <span className="papilot-opt-warn" aria-hidden="true" title={t('Rigor caution')}>!</span>}
            {lineTag && <span className="papilot-opt-delta" data-delta={lineDeltaKind} aria-hidden="true">{lineTag}</span>}
            {isSelected && previewBusy && <span className="papilot-inline-spinner" aria-hidden="true"/>}
          </span></button>;
        })}
      </div>
      {(saving || previewBusy) && <span className="sr-only" role="status">{saving ? t('Saving choice…') : t('Preparing this option’s PDF diff…')}</span>}
      {showDetailRow && <div id={panelId} role="tabpanel" aria-labelledby={`${tabsId}-${selected}`} className="papilot-inline-note-detail" data-recommended={active?.meta?.recommended ? 'true' : undefined} data-caution={hasRigorCaution ? 'true' : undefined}>
        {hasRigorCaution && <span className="papilot-inline-caution">{t('Rigor caution')}</span>}
        {active?.reason && <span className="papilot-inline-reason">{active.reason}</span>}
        {editing && <div className="papilot-inline-comment">
          <textarea ref={commentInput} rows={2} aria-label={t('Comment on {label}', { label: editing.option!.label })} placeholder={t('What should change here?')} value={editing.comment} readOnly={feedback.busy} onChange={event => draft.edit(editing.id, event.target.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') setEditor(null); }}/>
          <button type="button" className="papilot-inline-close" aria-label={t('Close comment')} title={t('Close comment')} onClick={() => setEditor(null)}><Icon name="close" size={14}/></button>
        </div>}
        {locked && !saving && previewingAlt && <span className="papilot-inline-hint">{optionLockText(locked)}</span>}
      </div>}
    </div>}
    {error && <span role="alert" className="papilot-inline-error">{optionError(error)} <button type="button" onClick={() => setRetry(value => value + 1)}>{t('Retry')}</button></span>}
    <NoteReturnError noteKey={note.key}/>
  </div>;
}
