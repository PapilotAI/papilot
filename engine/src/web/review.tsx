import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ActionKind,
  ChangeBlock,
  Decision,
  PageState,
  PlaceView,
  RoundDetail,
  Strip,
  Unit,
  VisualUnit,
} from "../types.ts";
import { PdfStrip } from "./PdfStrip.tsx";
import { SourceEditor } from "./SourceEditor.tsx";
import { ChangeMap } from "./ChangeMap.tsx";
import { CompilationErrors } from "./CompilationErrors.tsx";
import { sourceActionLabel, unavailableComparisonMessage, type UnavailableComparisonReason } from "./comparison-notice.ts";
import { placeable, type PlacedChange } from "./paper.ts";
// pdf.js loads only when the full paper is shown.
const FullPaper = lazy(() => import("./FullPaper.tsx").then((module) => ({ default: module.FullPaper })));
// A hidden tab or a locked phone still polls; the server then knows nobody reads it.
const stateRoute = (round?: number | null) => {
  const query = new URLSearchParams();
  if (round) query.set("round", String(round));
  if (typeof document !== "undefined" && document.hidden) query.set("hidden", "1");
  const text = query.toString();
  return `/state${text ? `?${text}` : ""}`;
};
import { EFFECTS_EVENT, EFFECTS_STORAGE, readExpandedEffects } from "./effect-preferences.ts";
import { language, locale, t, tn, withLanguage } from "./i18n.ts";
import {
  ConfirmReferences,
  ReferenceBanner,
  ReferenceEntries,
  risks,
  useReferenceChecks,
} from "./references.tsx";
import { bindingLabel, readShortcuts, resolveShortcuts, shortcutAction, SHORTCUT_EVENT, SHORTCUT_STORAGE } from "./shortcuts.ts";
import { sendsMessage } from "./send-key.ts";
import { CURRENT_CHANGE_EVENT, DECIDE_EVENT, OPEN_SOURCE_EVENT, RETRY_COMPARISON_EVENT, REVIEW_CHANGES_EVENT, SELECT_SOURCE_EVENT, SOURCE_SAVED_EVENT, UNDO_EVENT, type CurrentChange, type DecideChange, type OpenSource, type ReviewChanges, type SelectSource, type SourceSaved } from "./review-events.ts";
import { DecisionQueue, Unreachable, withQueued, type QueuedDecision } from "./decision-queue.ts";
import {
  STATE,
  buildStops,
  copyReference,
  changeKinds,
  describeLocation,
  shortLocation,
  nextPending,
  commentScope,
  pendingUnits,
  progress,
  mixedKey,
  resolvedSide,
  stopState,
  STATUS,
  visibleStop,
  wordDiff,
} from "./model.ts";
const KIND = {
  text: "Text",
  layout: "Layout",
  position: "Moved",
  identical: "No visible change",
  unmapped: "Source only",
};
const ACTION: Record<string, string> = {
  accept: "Accept",
  reject: "Reject",
  comment: "Comment",
};
// A host can show a repository's uncommitted changes instead of a task's
// round (Papilot does, with ?changes). Accepting stages a change in the Git
// index, rejecting reverts it on disk, and a staged change can be unstaged.
// Every change stays in view: staged ones remain uncommitted.
const CHANGE_ACTION: Record<string, string> = {
  accept: "Stage",
  reject: "Revert",
  unstage: "Unstage",
};
const CHANGE_STATE: Record<string, string> = {
  pending: "Unstaged",
  accepted: "Staged",
  rejected: "Reverted",
  commented: "Edited",
  mixed: "Partly staged",
};
type Kind = ActionKind | "unstage";
const PHASE: Record<string, string> = {
  snapshot: "Taking a snapshot",
  build: "Compiling LaTeX",
  render: "Rendering the diff",
};
type Composer = {
  changes: string[];
  stop: number;
  key: string;
};
// A decision shown at once and confirmed later: the change it was made on,
// the toast for the review it completed, and a comment's stored draft.
type Queued = QueuedDecision & { kind: Kind; stop: number; done: string; noteKey?: string; draft?: string };
const actionId = () =>
  crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(20)), byte => byte.toString(16).padStart(2, '0')).join('');
function readStorage<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage is optional. */
  }
}
// The comment box grows with its text up to the height its style allows.
function fitComposer(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "0";
  element.style.height = `${element.scrollHeight}px`;
}
function jobText(job: PageState["job"]) {
  return job?.status === "queued"
    ? job.ahead
      ? tn(
          job.ahead,
          "Queued behind {n} update…",
          "Queued behind {n} updates…",
        )
      : t("Queued…")
    : `${t(PHASE[job?.phase ?? ""] || "Starting")}…`;
}

function unitSnippet(unit: Unit | undefined) {
  if (!unit) return "";
  const clean = (text: string) => text.replace(/\s+/g, " ").trim();
  const clip = (text: string, max = 28) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
  const oldText = clean(unit.old_text),
    newText = clean(unit.new_text);
  if (oldText && newText) return `${clip(oldText)} → ${clip(newText)}`;
  if (newText) return `+ ${clip(newText, 40)}`;
  if (oldText) return `− ${clip(oldText, 40)}`;
  return "";
}

function ReviewProgress({ value, total, label }: { value: number; total: number; label: string }) {
  if (total === 0) return null;
  return (
    <div
      className="meter review-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      title={label}
    >
      <span aria-hidden="true"><span className="review-progress-value">{value}</span> / {total}</span>
    </div>
  );
}
export function ReviewApp({
  task,
  pinned,
  changes = false,
  transport,
}: {
  task: string;
  pinned: number | null;
  changes?: boolean;
  /** A host can provide local review data without running the HTTP server. */
  transport?: <T>(route: string, body?: unknown) => Promise<T>;
}) {
  const [state, setState] = useState<PageState | null>(null),
    [publishedDetail, setDetail] = useState<RoundDetail | null>(null),
    [optionPreview, setOptionPreview] = useState<{ key?: string; round: number; units?: string[]; detail?: RoundDetail; busy?: boolean } | null>(null),
    [current, setCurrent] = useState(-1),
    [busy, setBusy] = useState(false),
    // Decisions not confirmed yet, and whether the state shown predates them.
    [queued, setQueued] = useState<readonly Queued[]>([]),
    [settling, setSettling] = useState(false),
    [online, setOnline] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [noteFocus, setNoteFocus] = useState<{ key?: string; round: number; units: string[] | null } | null>(null),
    [noteGroups, setNoteGroups] = useState<{ round: number; groups: { key: string; units: string[] }[] } | null>(null),
    [openSource, setOpenSource] = useState<Set<number>>(new Set()),
    [retryingComparison, setRetryingComparison] = useState(false),
    [hostRetry, setHostRetry] = useState<string>(
      () => (typeof document !== "undefined" ? document.documentElement.dataset.papilotRetry ?? "" : ""),
    ),
    // Places past the first few of each edit, keyed by round and edit.
    [more, setMore] = useState<
      Record<string, PlaceView[] | "loading" | { error: string }>
    >({}),
    [composer, setComposer] = useState<Composer | null>(null),
    // Accepting bibliography entries that are not verified waits for this.
    [confirm, setConfirm] = useState<{
      kind: Kind;
      chosen: string[];
      body: string;
      items: { label: string; reasons: string[] }[];
    } | null>(null),
    [draft, setDraft] = useState(""),
    [help, setHelp] = useState(false),
    [hoveredUnit, setHoveredUnit] = useState<{ stop: number; unit: string } | null>(null),
    [selectedUnit, setSelectedUnit] = useState<{
      stop: number;
      unit: string;
      side?: "before" | "after";
    } | null>(null),
    [mixedPreviews, setMixedPreviews] = useState<
      Record<string, { status: "loading" | "ready" | "error"; files?: string; strips?: Strip[] }>
    >({}),
    // Comparisons of blocks with an edit accepted in a note option's wording,
    // by that wording.
    [optionBlocks, setOptionBlocks] = useState<Record<string, RoundDetail>>({}),
    // A note can reveal a decided change without opening the history controls.
    [linkedChange] = useState(() => {
      const value = Number(new URLSearchParams(location.search).get("change") ?? -1);
      return Number.isSafeInteger(value) && value >= 0 ? value : -1;
    }),
    [history, setHistory] = useState(
      (Boolean(pinned) && linkedChange < 0) || new URLSearchParams(location.search).has("history"),
    );
  const previewing = Boolean(optionPreview && optionPreview.round === publishedDetail?.round);
  const detail = publishedDetail;
  const previewNow = useRef(previewing); previewNow.current = previewing;
  const paper = useRef<HTMLElement>(null),
    editedPlace = useRef<{ file: string; line: number; offset: number; paper: boolean; inline: boolean } | null>(null),
    epoch = useRef(0),
    scrollUntil = useRef(0),
    // How far into the current change the author had read, restored once
    // when the review reopens on it in the same view.
    returning = useRef<{ index: number; offset: number; paper: boolean } | null>(null),
    // How the current change was reached, for the workspace: picked by the
    // author, followed while scrolling, or asked for from the source editor.
    reached = useRef<CurrentChange["from"]>("scroll"),
    snapshot = useRef({ state, detail: publishedDetail, busy, composer, current, open: openSource }),
    // Polls again at once, after the last queued decision is confirmed.
    pollNow = useRef(() => {}),
    failures = useRef(0),
    settle = useRef<{
      send: (entry: Queued) => Promise<PageState>;
      confirmed: (entry: Queued, next: PageState, remaining: readonly Queued[]) => void;
      failed: (entry: Queued, error: Error, dropped: Queued[]) => void;
    } | null>(null),
    queue = useRef<DecisionQueue<Queued, PageState> | null>(null);
  // Decisions go out one at a time, in order; the review moves on at once.
  // Uncommitted changes have no action journal to make a retry safe.
  // Unconfirmed decisions are kept in the browser, so that a reload, a closed
  // tab or a locked phone sends them later rather than losing them.
  const queueKey = changes ? null : `papilot:review:queue:${location.pathname}:${task}`;
  queue.current ??= new DecisionQueue<Queued, PageState>({
    send: entry => settle.current!.send(entry),
    confirmed: (entry, next, remaining) => settle.current!.confirmed(entry, next, remaining),
    failed: (entry, error, dropped) => settle.current!.failed(entry, error, dropped),
    retries: changes ? 0 : 4,
    ...(queueKey ? { storage: { key: queueKey } } : {}),
  });
  // What an earlier page decided and never had confirmed goes out once this
  // page has its state: the server takes decisions only with the token in it.
  const restored = useRef(false);
  useEffect(() => {
    if (!queueKey || transport || restored.current || !state?.csrf) return;
    restored.current = true;
    const saved = DecisionQueue.saved<Queued>(queueKey).filter((entry) => !queue.current!.pending.some((queued) => queued.id === entry.id));
    for (const entry of saved) queue.current!.push(entry);
    if (saved.length) { setQueued(queue.current!.pending); setSettling(true); }
  }, [Boolean(state?.csrf)]);
  useEffect(() => {
    if (!queueKey || transport) return;
    // A page that goes away sends what is left at once; the browser finishes
    // those requests even after the page is gone.
    const listener = (event: Event) => {
      if (document.visibilityState !== "hidden" && event.type !== "pagehide") return;
      const csrf = snapshot.current.state?.csrf ?? "";
      queue.current!.flush((entry) => {
        void fetch(`/api/tasks/${encodeURIComponent(task)}/decide`, {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json", "X-Review-Token": csrf },
          body: JSON.stringify({ id: entry.id, action: entry.kind, round: entry.round, changes: entry.changes, body: entry.body, noteKey: entry.noteKey }),
        }).catch(() => undefined);
      });
    };
    document.addEventListener("visibilitychange", listener);
    window.addEventListener("pagehide", listener);
    return () => { document.removeEventListener("visibilitychange", listener); window.removeEventListener("pagehide", listener); };
  }, []);
  // Where each review was left; a host's uncommitted changes are kept per paper.
  const placeKey = `papilot:review:${location.pathname}:${changes ? 'changes' : task}`;
  const [shortcuts, setShortcuts] = useState(readShortcuts);
  const [phoneDock, setPhoneDock] = useState(
    () => typeof document !== "undefined" && document.documentElement.hasAttribute("data-papilot-phone"),
  );
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setPhoneDock(root.hasAttribute("data-papilot-phone"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-papilot-phone"] });
    return () => observer.disconnect();
  }, []);
  // Changes are shown in place on the full PDF whenever it is available;
  // fall back to the changed sections only when the full PDF cannot be loaded.
  const [paperUnavailable, setPaperUnavailable] = useState(false);
  useEffect(() => { setPaperUnavailable(false); }, [detail?.round, detail?.pdf, detail?.renderJob]);
  const [expandedEffects, setExpandedEffects] = useState(readExpandedEffects);
  // Per-edit disclosure is temporary and scoped to its round. Changing the
  // global preference resets those overrides without reloading the review.
  const [effectOverrides, setEffectOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const changed = (event: Event) => setExpandedEffects((event as CustomEvent).detail === true);
    const stored = (event: StorageEvent) => { if (event.key === EFFECTS_STORAGE || event.key === null) setExpandedEffects(readExpandedEffects()); };
    window.addEventListener(EFFECTS_EVENT, changed);
    window.addEventListener('storage', stored);
    return () => { window.removeEventListener(EFFECTS_EVENT, changed); window.removeEventListener('storage', stored); };
  }, []);
  useEffect(() => { setEffectOverrides({}); }, [expandedEffects]);
  useEffect(() => {
    const changed = (event: Event) => setShortcuts(resolveShortcuts((event as CustomEvent).detail));
    const stored = (event: StorageEvent) => { if (event.key === SHORTCUT_STORAGE || event.key === null) setShortcuts(readShortcuts()); };
    window.addEventListener(SHORTCUT_EVENT, changed);
    window.addEventListener('storage', stored);
    return () => { window.removeEventListener(SHORTCUT_EVENT, changed); window.removeEventListener('storage', stored); };
  }, []);
  const selectUnitHandler = useRef<(stop: number, unit?: string) => void>(() => {});
  useEffect(() => {
    const changed = (event: Event) => setNoteFocus((event as CustomEvent).detail || null);
    const groupsChanged = (event: Event) => {
      const value = (event as CustomEvent<{ round: number; groups: { key: string; units: string[] }[] } | null>).detail;
      setNoteGroups(value && Array.isArray(value.groups) ? value : null);
    };
    const preview = (event: Event) => {
      const value = (event as CustomEvent).detail || null;
      const transition = Boolean(value) !== previewNow.current;
      previewNow.current = Boolean(value);
      setOptionPreview(value);
      // Re-sending the current scope (including null) must not discard a
      // source editor or dialog the author just opened outside the drawer.
      if (transition) { setComposer(null); setConfirm(null); setOpenSource(new Set()); }
    };
    const pickUnit = (event: Event) => {
      const detail = (event as CustomEvent<{ stop: number; unit?: string }>).detail;
      if (detail && Number.isInteger(detail.stop)) selectUnitHandler.current(detail.stop, detail.unit);
    };
    window.addEventListener("papilot:option-preview", preview);
    window.addEventListener("papilot:note-focus", changed);
    window.addEventListener("papilot:note-groups", groupsChanged);
    window.addEventListener("papilot:select-unit", pickUnit);
    window.dispatchEvent(new Event("papilot:note-focus-ready"));
    return () => {
      window.removeEventListener("papilot:note-focus", changed);
      window.removeEventListener("papilot:note-groups", groupsChanged);
      window.removeEventListener("papilot:option-preview", preview);
      window.removeEventListener("papilot:select-unit", pickUnit);
    };
  }, []);
  const focused = noteFocus?.round === detail?.round ? noteFocus?.units ?? undefined : undefined;
  const inFocus = (id: string) => !focused || focused.includes(id);
  function showHelp() {
    if (window.dispatchEvent(new Event('papilot:review:help', { cancelable: true }))) setHelp(true);
  }
  snapshot.current = { state, detail: publishedDetail, busy, composer, current, open: openSource };
  // Changes accepted in a note option's wording, on the open latest round
  // where that wording's comparison can be shown with it.
  const variants = detail && state && detail.round === state.latest && !state.closed && !changes ? state.variants : undefined;
  const units = useMemo(
      // A change accepted in a note option's wording reads as that wording.
      () => new Map(detail?.units.map((u) => [u.id, variants && Object.hasOwn(variants, u.id) ? { ...u, new_text: variants[u.id] } : u]) ?? []),
      [detail, variants],
    ),
    // Changes whose PDF comparison has not arrived: the author decides with
    // the comparison, so these cannot be accepted or rejected yet.
    waiting = useMemo(
      () => new Set(detail?.units.filter((u) => u.waiting).map((u) => u.id) ?? []),
      [detail],
    ),
    // Decided changes whose comparison changed after the decision.
    again = new Set(state?.round === detail?.round ? state?.reviewAgain ?? [] : []),
    stops = useMemo(() => (detail ? buildStops(detail) : []), [detail]),
    // The change blocks in the order and numbering of the changes view.
    placed = useMemo(() => {
      const list: PlacedChange[] = [];
      if (!detail) return list;
      for (const section of detail.sections)
        for (const block of section.blocks)
          if (block.kind === "change") list.push({ block, index: list.length });
      for (const block of detail.loose) list.push({ block, index: list.length });
      return list;
    }, [detail]),
    // An edit's places show under the first change that includes it.
    firstStop = useMemo(() => {
      const found = new Map<string, number>();
      stops.forEach((stop, i) =>
        stop.units.forEach((id) => found.has(id) || found.set(id, i)),
      );
      return found;
    }, [stops]),
    locations = useMemo(
      () =>
        stops.map((stop) =>
          describeLocation(
            stop.units.map((id) => units.get(id)!).filter(Boolean),
            t,
          ),
        ),
      [stops, units],
    ),
    // Queued decisions show as made until the server confirms or refuses them.
    decisions = useMemo(() => withQueued(state?.decisions ?? {}, queued), [state?.decisions, queued]),
    count = progress(decisions),
    undecided = Object.keys(decisions).filter(
      (id) => decisions[id] === "pending" && inFocus(id) && !waiting.has(id),
    ),
    references = useReferenceChecks(detail, api),
    hazards = useMemo(
      () => risks(detail?.references, references.checks, references.pending, references.confirmed),
      [detail, references.checks, references.pending, references.confirmed],
    ),
    // Batch acceptance leaves the changes whose entries need a look.
    batch = undecided.filter((id) => !hazards.has(id)),
    latest = Boolean(
      detail && state && detail.round === state.latest && !state.closed && !previewing,
    ),
    browsing = history || changes,
    label = (kind: string) => t((changes ? CHANGE_ACTION : ACTION)[kind] ?? kind),
    stateLabel = (value: string) =>
      t((changes ? CHANGE_STATE : STATE)[value] ?? value);
  // Keyboard handlers read the newest checks, not those of their render.
  const hazardsNow = useRef(hazards);
  hazardsNow.current = hazards;
  // What each button acts on: undecided changes, or in changes mode the
  // staged ones for Unstage and every change still on disk for Revert.
  const targets = (units: string[], kind: Kind) =>
    units.filter(inFocus).filter((id) => (kind === "comment" || !waiting.has(id)) && (
      kind === "unstage"
        ? decisions[id] === "accepted"
        : changes && kind === "reject"
          ? ["pending", "accepted"].includes(decisions[id])
          : decisions[id] === "pending"),
    );
  // Only undecided changes can be decided: a decided one is changed back
  // with Undo while that is possible. One still waiting for its comparison
  // can only be commented on.
  const kinds = (units: string[]): Kind[] =>
    !changes
      ? targets(units, "accept").length ? ["accept", "reject", "comment"] : targets(units, "comment").length ? ["comment"] : []
      : targets(units, "accept").length
        ? ["accept", "reject"]
        : targets(units, "unstage").length
          ? ["unstage", "reject"]
          : [];
  const navigation = stops
    .map((stop, index) => ({ stop, index }))
    .filter(({ stop, index }) => stop.units.some(inFocus) && (browsing || index === linkedChange || pendingUnits(stop, decisions).some(inFocus) || stop.units.some((id) => again.has(id))))
    .map(({ index }) => index);
  const adjacent = (index: number, direction: number) =>
    navigation[navigation.indexOf(index) + direction] ?? -1;
  const undoChanges = state?.undo
    ? stops.flatMap((stop, index) =>
        stop.units.some((id) => state.undo!.changes.includes(id))
          ? [index + 1]
          : [],
      )
    : [];
  useEffect(() => {
    if (browsing || composer) return;
    if (!navigation.includes(current)) setCurrent(navigation[0] ?? -1);
  }, [decisions, history, composer, detail, noteFocus]);
  useEffect(() => {
    if (changes && current < 0 && stops.length)
      setCurrent(Math.max(nextPending(stops, decisions), 0));
  }, [detail]);
  // What a change without its comparison shows instead of Accept and Reject.
  const waitingLabel = () =>
    detail?.rendering === "failed"
      ? t("PDF comparison failed")
      : detail && detail.round === state?.latest
        ? t("PDF comparison in progress")
        : t("No PDF comparison");
  // Lock reasons come from the host in English; known ones are translated.
  // Rejecting and editing source write the task's files, which a host can
  // lock on their own while its agent edits them; undoing a rejection too.
  const lockOf = (value: PageState | null | undefined, kind: Kind | "source") =>
    kind === "comment"
      ? value?.commentLock
      : value?.decisionLock || ((kind === "reject" && !value?.queueRejects) || kind === "source" ? value?.rejectLock : null);
  const actionLock = (kind: Kind | "source") => {
    if (previewing) return t("Confirm this option before reviewing its changes.");
    const reason = lockOf(state, kind);
    return reason ? t(reason) : reason;
  };
  // Undoing an accept of an earlier round publishes the task's files as a
  // new round, so like a rejection it waits while the agent edits them.
  // Undoing an applied rejection writes the task's files, like a source
  // edit, and so does undoing a note option's wording; a reject still
  // waiting for the agent's turn to end touched none.
  const undoKind = (value: PageState | null | undefined): Kind | "source" => (value?.undo?.kind === "reject" && !value.undo.queued) || value?.undo?.republish || value?.undo?.worktree ? "source" : "accept";
  function blocked(kind: Kind | "source"): boolean {
    if (previewNow.current) { setToast(t("Confirm this option before reviewing its changes.")); return true; }
    const reason = lockOf(snapshot.current.state, kind);
    if (reason) setToast(t(reason));
    return Boolean(reason);
  }
  async function api<T>(route: string, body?: unknown): Promise<T> {
    if (body !== undefined && previewNow.current) throw new Error(t("Confirm this option before reviewing its changes."));
    if (transport) return transport<T>(route, body);
    const response = await fetch(
      `${changes ? "/api/changes" : `/api/tasks/${encodeURIComponent(task)}`}${route}`,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Review-Token": snapshot.current.state?.csrf ?? "",
            },
            body: JSON.stringify(body),
          },
    ).catch((error: Error) => {
      // The request may or may not have arrived.
      throw new Unreachable(error.message);
    });
    const value = await response.json().catch((error) => {
      if (response.ok) throw error;
      return {};
    });
    if (!response.ok) {
      const message = value.error || `HTTP ${response.status}`;
      // A gateway or a restarting host did not answer for the server. The
      // same decision sent again by a page that came back, while the server
      // still applies the first send, is refused for now: it is sent again
      // too, and then confirmed as applied.
      throw [502, 503, 504].includes(response.status) || (response.status === 400 && /review action is already in progress/i.test(message)) ? new Unreachable(message) : new Error(message);
    }
    return value as T;
  }
  function select(index: number, scroll = true) {
    if (index < 0 || index >= stops.length) return;
    if (scroll && reached.current !== "source") reached.current = "pick";
    if (scroll) returning.current = null;
    setCurrent(index);
    store(placeKey, {
      round: detail?.round,
      stop: stops[index].key,
    });
    if (scroll) {
      scrollUntil.current = Date.now() + 800;
      requestAnimationFrame(() => {
        const article = paper.current?.querySelector<HTMLElement>(
          `[data-stop="${index}"]`,
        );
        if (article) reveal(article, "smooth");
        article?.focus({ preventScroll: true });
      });
    }
  }
  // How far the paper is scrolled past the top of a change; 0 when revealed.
  function past(article: HTMLElement) {
    const root = paper.current!;
    // scrollIntoView also scrolls ancestors across the embedding iframe.
    // Navigation belongs to the paper, independently of the host's Chat.
    const padding = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
    const margin = parseFloat(getComputedStyle(article).scrollMarginTop) || 0;
    return root.getBoundingClientRect().top + padding + margin - article.getBoundingClientRect().top;
  }
  function reveal(article: HTMLElement, behavior: ScrollBehavior = "instant") {
    const root = paper.current;
    if (!root) return;
    const index = Number(article.dataset.stop), back = returning.current;
    let offset = 0;
    if (back && back.index === index && back.paper === paperView) { offset = back.offset; returning.current = null; }
    root.scrollTo({ top: root.scrollTop - past(article) + offset, behavior });
  }
  // The place within the current change is kept as the author reads on.
  function remember(index: number) {
    const article = paper.current?.querySelector<HTMLElement>(`[data-stop="${index}"]`);
    if (!article || !stops[index]) return;
    store(placeKey, { round: detail?.round, stop: stops[index].key, offset: Math.round(past(article)), paper: paperView });
  }
  // Reading into the next change makes it current, which resizes its header;
  // measure the place again once it has, unless a reveal is on its way.
  useEffect(() => {
    if (current >= 0 && !returning.current && Date.now() >= scrollUntil.current && paper.current?.scrollTop) remember(current);
  }, [current]);
  // The workspace's source editor follows the current change, and asks for
  // the change at a line of a file.
  const unitLines = (unit: Unit): [number, number][] => unit.whole_file
    ? [[Math.max(0, unit.new_start - 1), unit.new_end]]
    : unit.ops.filter((op) => op[0] !== "equal").map((op) => [op[3], op[4]]);
  const lastAnnounced = useRef("");
  function announce(index: number, preferredUnit?: string | null) {
    const from = reached.current;
    reached.current = "scroll";
    if (!stops[index]) return;
    const stopUnits = stops[index].units;
    const orderedIds = preferredUnit && stopUnits.includes(preferredUnit)
      ? [preferredUnit, ...stopUnits.filter((id) => id !== preferredUnit)]
      : stopUnits;
    const key = `${detail?.round ?? 0}:${index}:${from}:${orderedIds[0] ?? ""}`;
    if (from === "scroll" && lastAnnounced.current === key) return;
    lastAnnounced.current = key;
    const detailEvent: CurrentChange = {
      stop: index, from,
      units: orderedIds.map((id) => units.get(id)).filter((unit): unit is NonNullable<typeof unit> => Boolean(unit && unit.kind === "text" && unit.status !== "deleted"))
        .map((unit) => ({ id: unit.id, file: unit.file, lines: unitLines(unit) })),
    };
    window.dispatchEvent(new CustomEvent(CURRENT_CHANGE_EVENT, { detail: detailEvent }));
  }
  // The workspace's editor shows the changes in their files, with Accept and
  // Reject, which decide them here as the buttons on the page do.
  function announceChanges() {
    if (!detail) return;
    const changes: ReviewChanges["changes"] = detail.units.filter((unit) => unit.kind === "text" && unit.status !== "deleted" && unit.text_ops?.length)
      .map((unit) => ({ id: unit.id, file: unit.file, ops: unit.text_ops!, decision: decisions[unit.id] ?? "pending", confirmed: state?.decisions?.[unit.id] ?? "pending" }));
    const cards: ReviewChanges["stops"] = stops.map((stop, index) => ({ title: t("Change {n}", { n: index + 1 }), units: stop.units,
      actions: kinds(stop.units).map((kind) => ({ kind, label: label(kind), lock: actionLock(kind) ?? null })) }));
    window.dispatchEvent(new CustomEvent<ReviewChanges>(REVIEW_CHANGES_EVENT, { detail: { round: detail.round, changes, stops: cards, labels: { before: t("Before"), after: t("After") } } }));
  }
  useEffect(announceChanges, [detail, decisions, state]);
  useEffect(() => {
    const chosen = (event: Event) => {
      const request = (event as CustomEvent<DecideChange & { again?: boolean }>).detail, { round, changes: ids, action } = request;
      if (detail?.round !== round || !["accept", "reject", "comment"].includes(action)) return;
      const kind = action as Kind;
      if (kind !== "comment") { void decide(kind, targets(ids, kind)); return; }
      // A comment belongs to its card, which becomes current first.
      const index = stops.findIndex((stop) => stop.units.some((id) => ids.includes(id)));
      if (index >= 0 && index !== current && !request.again) {
        select(index);
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(DECIDE_EVENT, { detail: { ...request, again: true } })));
        return;
      }
      beginComposer(targets(ids, "comment"));
    };
    window.addEventListener(DECIDE_EVENT, chosen);
    return () => window.removeEventListener(DECIDE_EVENT, chosen);
  });
  // A change's source, offered to the workspace's editor: true when it opened there.
  function offerSource(chosen: Unit[]) {
    // The editor shows the task's files as they are now, with the latest
    // round's changes. An earlier round, a closed task or a previewed option
    // keeps the inline LaTeX, and so do changes without character-level
    // operations, such as a new file or a bibliography entry, which have no
    // card in the editor.
    if (!latest || !detail) return false;
    const shown = chosen.filter((item) => item.kind === "text" && item.status !== "deleted");
    if (!shown.length || shown.some((item) => !item.text_ops?.length)) return false;
    // Nor can the editor place cards in a file with CRLF line endings, whose
    // offsets count the carriage returns; its context shows them.
    if (shown.some((item) => /\r/.test(item.old_text + item.new_text + (item.old_context?.text ?? "")))) return false;
    const unit = shown[0];
    const marks = chosen.filter((item) => item.file === unit.file && item.kind === "text").flatMap(unitLines);
    if (!marks.length) return false;
    const request: OpenSource = { round: detail.round, change: unit.id, file: unit.file, marks,
      lines: [Math.min(...marks.map((range) => range[0])), Math.max(...marks.map((range) => Math.max(range[1], range[0] + 1)))] };
    // The editor shows the changes of the round it opens in.
    announceChanges();
    return !window.dispatchEvent(new CustomEvent(OPEN_SOURCE_EVENT, { detail: request, cancelable: true }));
  }
  useEffect(() => {
    const choose = (event: Event) => {
      const { file, line } = (event as CustomEvent<SelectSource>).detail;
      let best = -1, distance = Infinity;
      stops.forEach((stop, index) => stop.units.forEach((id) => {
        const unit = units.get(id);
        if (!unit || unit.file !== file) return;
        for (const [from, to] of unitLines(unit)) {
          const away = line < from ? from - line : line >= Math.max(to, from + 1) ? line - Math.max(to, from + 1) + 1 : 0;
          if (away < distance) { distance = away; best = index; }
        }
      }));
      // Only a line in or right beside a change has one.
      if (best < 0 || distance > 1 || best === current) return;
      reached.current = "source";
      select(best);
    };
    window.addEventListener(SELECT_SOURCE_EVENT, choose);
    return () => window.removeEventListener(SELECT_SOURCE_EVENT, choose);
  });
  // A file saved in the workspace's editor shows as an edit made here: the
  // review continues from the new state, at the edited place.
  useEffect(() => {
    const saved = (event: Event) => {
      const { state: next, file, line } = (event as CustomEvent<SourceSaved>).detail;
      const article = paper.current?.querySelector<HTMLElement>(`[data-stop="${current}"]`);
      editedPlace.current = { file, line: line + 1, offset: article ? past(article) : 0, paper: paperView, inline: false };
      epoch.current++; setState(next);
    };
    window.addEventListener(SOURCE_SAVED_EVENT, saved);
    return () => window.removeEventListener(SOURCE_SAVED_EVENT, saved);
  });
  const hostRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setHostRetry(root.dataset.papilotRetry ?? "");
    sync();
    const watcher = new MutationObserver(sync);
    watcher.observe(root, { attributes: true, attributeFilter: ["data-papilot-retry"] });
    return () => {
      watcher.disconnect();
      if (hostRetryTimer.current) clearTimeout(hostRetryTimer.current);
    };
  }, []);
  useEffect(() => {
    let cancelled = false,
      polling = false,
      again = false,
      timer: ReturnType<typeof setTimeout>;
    // While decisions wait for confirmation, a poll could show them undone.
    const waiting = () => snapshot.current.busy || queue.current!.pending.length > 0;
    async function poll() {
      if (polling) { again = true; return; }
      polling = true;
      clearTimeout(timer);
      const requestedEpoch = epoch.current;
      try {
        const previous = snapshot.current,
          number = pinned || previous.detail?.round,
          next = await api<PageState>(
            stateRoute(number),
          );
        if (
          cancelled ||
          epoch.current !== requestedEpoch ||
          waiting()
        )
          return;
        setOnline(true);
        setError("");
        setSettling(false);
        const unavailable = (value: PageState) => value.state === "building" || value.state === "build_failed" || Boolean(value.rendering);
        // A new source round can precede its PDF, or retain a failed build.
        // Clear only the previous build's success message, not action feedback.
        if (unavailable(next)) setToast(message => message === t("Changes are ready") ? "" : message);
        const target = pinned || next.latest;
        const changed = Boolean(
          target &&
          (target !== previous.detail?.round ||
            (next.revision && next.revision !== previous.detail?.after) ||
            (next.round === previous.detail?.round && next.renderJob !== previous.detail?.renderJob) ||
            // The round's own comparison arrived, or failed.
            (next.round === previous.detail?.round && (next.rendering ?? null) !== (previous.detail?.rendering ?? null))));
        if (changed && !snapshot.current.composer && !paper.current?.querySelector('.source-editor[data-dirty="true"]')) {
          const [loadedState, loaded] = await Promise.all([
            api<PageState>(stateRoute(target)),
            api<RoundDetail>(`/rounds/${target}`),
          ]);
          if (
            cancelled ||
            epoch.current !== requestedEpoch ||
            waiting()
          )
            return;
          const nextStops = buildStops(loaded),
            saved = readStorage<{ round?: number; stop?: string; offset?: number; paper?: boolean }>(
              placeKey,
              {},
            );
          let index =
            saved.round === target
              ? nextStops.findIndex((s) => s.key === saved.stop)
              : -1;
          if (
            index < 0 ||
            !pendingUnits(nextStops[index], loadedState.decisions).length
          )
            index = nextPending(nextStops, loadedState.decisions, index);
          if (linkedChange >= 0 && nextStops[linkedChange]) index = linkedChange;
          // The same round with its comparisons in place keeps the change the
          // author is on, and the changes whose source is open.
          const same = previous.detail?.round === loaded.round,
            oldStops = same ? buildStops(previous.detail!) : [],
            moved = (old: number) => {
              const ids = oldStops[old]?.units ?? [];
              return nextStops.findIndex((stop) => stop.units.some((id) => ids.includes(id)));
            },
            article = same ? paper.current?.querySelector<HTMLElement>(`[data-stop="${previous.current}"]`) : null;
          if (same && moved(previous.current) >= 0) index = moved(previous.current);
          if (index < 0) index = pinned && nextStops.length ? 0 : -1;
          const edited = editedPlace.current;
          if (edited) {
            const candidates = nextStops.flatMap((stop, i) => loaded.units.filter(unit => unit.file === edited.file && stop.units.includes(unit.id)).map(unit => ({ index: i, distance: Math.abs(unit.new_start - edited.line) })));
            candidates.sort((a, b) => a.distance - b.distance);
            if (candidates.length) index = candidates[0].index;
          }
          returning.current =
            edited && index >= 0 ? { index, offset: edited.offset, paper: edited.paper } : article && index >= 0 ? { index, offset: past(article), paper: Boolean(saved.paper) } : !previous.detail && index >= 0 && saved.round === target && nextStops[index].key === saved.stop && saved.offset
              ? { index, offset: saved.offset, paper: Boolean(saved.paper) }
              : null;
          if (
            previous.detail &&
            loaded.round !== previous.detail.round &&
            !pinned
          )
            setHistory(false);
          setState(loadedState);
          setDetail(loaded);
          setCurrent(index);
          setOpenSource(new Set(same ? [...previous.open].map(moved).filter((i) => i >= 0) : edited?.inline && index >= 0 ? [index] : []));
          editedPlace.current = null;
          if (same && index >= 0)
            requestAnimationFrame(() => {
              const shown = paper.current?.querySelector<HTMLElement>(`[data-stop="${index}"]`);
              if (shown) reveal(shown);
            });
          if (previous.detail && !loaded.rendering && !unavailable(loadedState) && (!same || previous.detail.rendering))
            setToast(t("Changes are ready"));
        } else {
          setState(next);
          // The PDF and job status are read separately. If the PDF arrived
          // first, announce it when the publication's status catches up. A
          // newer version held back by an open composer or unsaved source is
          // not shown yet, so it is not ready.
          if (!changed && previous.detail && !previous.detail.rendering && !unavailable(next) &&
              (previous.state?.state === "building" || previous.state?.state === "build_failed"))
            setToast(t("Changes are ready"));
        }
      } catch (e) {
        if (!cancelled) {
          setOnline(false);
          setError((e as Error).message);
        }
      } finally {
        polling = false;
        if (cancelled) { /* Stopped. */ }
        else if (again) { again = false; void poll(); }
        else timer = setTimeout(poll, document.hidden ? 10000 : 1500);
      }
    }
    pollNow.current = () => void poll();
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      pollNow.current = () => {};
    };
  }, [task, pinned, transport]);
  useEffect(() => {
    if (paperView) return;
    if (detail && current >= 0)
      requestAnimationFrame(() => {
        const article = paper.current?.querySelector<HTMLElement>(`[data-stop="${current}"]`);
        if (article) reveal(article);
      });
  }, [detail?.round]);
  useEffect(() => {
    if (state) document.title = `${t(state.title)} · LaTeX Review`;
  }, [state?.title]);
  // Host styles can tell the two modes apart.
  useEffect(() => {
    if (changes) document.documentElement.dataset.mode = "changes";
  }, [changes]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  function beginComposer(changes = targets(stops[current]?.units ?? [], "comment")) {
    if (
      !latest ||
      !changes.length ||
      busy ||
      state?.closed ||
      blocked("comment")
    )
      return;
    const scoped = focused !== undefined || changes.length !== stops[current]?.units.length;
    const event = new CustomEvent('papilot:review:comment', { cancelable: true, detail: {
      round: detail?.round, stop: current, changes,
      ...(scoped ? { scope: commentScope(changes.map(id => units.get(id)!).filter(Boolean)) } : {}),
    } });
    if (!window.dispatchEvent(event)) return;
    const key = `papilot:review:${task}:draft:${detail?.round}:${changes.join(",")}`;
    setDraft(readStorage(key, ""));
    setComposer({ changes, stop: current, key });
  }
  function closeComposer(sent = false) {
    if (composer) store(composer.key, sent ? "" : draft);
    setComposer(null);
  }
  // Keep per-unit PDF selection scoped to the active change, detail, and focus.
  useEffect(() => {
    if (selectedUnit && selectedUnit.stop !== current) setSelectedUnit(null);
  }, [current, selectedUnit?.stop]);
  useEffect(() => {
    setSelectedUnit(null);
    setHoveredUnit(null);
  }, [detail, history, noteFocus]);
  const substantiveUnits = (blockUnits: string[]) => {
    const visible = blockUnits.filter((id) => inFocus(id) && !units.get(id)?.formattingFor);
    return visible.length ? visible : blockUnits.filter(inFocus);
  };
  const blockUnitStatic = useMemo(() => {
    const map = new Map<
      number,
      {
        subUnits: string[];
        selectableSet: ReadonlySet<string>;
        groupMembers: ReadonlyMap<string, string[]>;
        unitToGroup: ReadonlyMap<string, string>;
      }
    >();
    const activeNotes =
      noteGroups && detail && noteGroups.round === detail.round ? noteGroups.groups : [];
    if (!activeNotes.length) return map;
    const unitNotes = new Map<string, string[]>();
    for (const note of activeNotes) {
      for (const id of note.units) {
        const list = unitNotes.get(id);
        if (list) {
          if (!list.includes(note.key)) list.push(note.key);
        } else {
          unitNotes.set(id, [note.key]);
        }
      }
    }
    const signatureOf = (id: string) => {
      const keys = unitNotes.get(id);
      return keys?.length ? [...keys].sort().join("\0") : "";
    };
    placed.forEach(({ block, index }) => {
      const markedIds = new Set(
        [...block.before, ...block.after].flatMap((strip) => (strip.marks ?? []).map((mark) => mark.unit)),
      );
      const visibleSub = substantiveUnits(block.units);
      const markedSub = visibleSub.filter((id) => markedIds.has(id));
      if (markedSub.length <= 1) return;
      // Sub-unit chips exist only when annotations split a single PDF change
      // block into >= 2 distinct groups (multiple annotations sharing the block,
      // or an annotation covering part of the block alongside unannotated edits).
      const bySignature = new Map<string, string[]>();
      for (const id of markedSub) {
        const sig = signatureOf(id);
        const list = bySignature.get(sig);
        if (list) list.push(id);
        else bySignature.set(sig, [id]);
      }
      if (bySignature.size <= 1) return;
      const fallbackSig = bySignature.has("") ? "" : bySignature.keys().next().value!;
      for (const id of visibleSub) {
        if (markedIds.has(id)) continue;
        const sig = signatureOf(id);
        const bucket = bySignature.get(sig) ?? bySignature.get(fallbackSig)!;
        bucket.push(id);
      }
      const subUnits: string[] = [];
      const groupMembers = new Map<string, string[]>();
      const unitToGroup = new Map<string, string>();
      for (const core of bySignature.values()) {
        const rep = core[0];
        const members = [...core];
        for (const id of core) {
          for (const extra of block.units) {
            if (units.get(extra)?.formattingFor === id && inFocus(extra) && !members.includes(extra)) {
              members.push(extra);
            }
          }
        }
        subUnits.push(rep);
        groupMembers.set(rep, members);
        for (const m of members) unitToGroup.set(m, rep);
      }
      const firstRep = subUnits[0];
      for (const id of block.units) {
        if (!inFocus(id) || unitToGroup.has(id)) continue;
        groupMembers.get(firstRep)!.push(id);
        unitToGroup.set(id, firstRep);
      }
      map.set(index, {
        subUnits,
        selectableSet: new Set(subUnits),
        groupMembers,
        unitToGroup,
      });
    });
    return map;
  }, [placed, units, focused, noteGroups, detail?.round]);
  const unitGroup = (stopIndex: number, unitId: string) => {
    const grouped = blockUnitStatic.get(stopIndex)?.groupMembers.get(unitId);
    if (grouped) return grouped;
    const blockUnits = stops[stopIndex]?.units ?? [];
    return [
      unitId,
      ...blockUnits.filter((id) => units.get(id)?.formattingFor === unitId && inFocus(id)),
    ];
  };
  // Preserve per-block unitStates object identity across polls and unrelated
  // decisions so React.memo(PdfStrip) does not re-render unaffected strips.
  const blockUnitStatesCache = useRef(new Map<number, Record<string, Decision>>());
  const blockUnitStates = useMemo(() => {
    const next = new Map<number, Record<string, Decision>>();
    const prev = blockUnitStatesCache.current;
    placed.forEach(({ index }) => {
      const meta = blockUnitStatic.get(index);
      if (!meta) return;
      const entries: [string, Decision][] = meta.subUnits.map((rep) => {
        const members = meta.groupMembers.get(rep) ?? [rep];
        const s = stopState(members, decisions);
        return [rep, s === "mixed" ? (decisions[rep] ?? "pending") : s];
      });
      const existing = prev.get(index);
      if (
        existing &&
        Object.keys(existing).length === entries.length &&
        entries.every(([id, state]) => existing[id] === state)
      ) {
        next.set(index, existing);
      } else {
        next.set(index, Object.fromEntries(entries));
      }
    });
    blockUnitStatesCache.current = next;
    return next;
  }, [placed, blockUnitStatic, decisions]);
  // Recompile a block's mixed PDF once after all edits in that block have
  // finished deciding (exclusively accepted/rejected, with some of each).
  const mixedRequested = useRef(new Set<string>());
  const mixedGen = useRef(0);
  useEffect(() => {
    mixedGen.current++;
    mixedRequested.current.clear();
    setMixedPreviews({});
    return () => {
      mixedGen.current++;
    };
  }, [detail?.round, detail?.before, detail?.after]);
  useEffect(() => {
    if (!detail || changes || history || transport || previewing || detail.sourceOnly || detail.rendering) return;
    const gen = mixedGen.current;
    for (const { block, index } of placed) {
      if (pendingUnits(stops[index], decisions).length) continue;
      const key = mixedKey(detail.round, index, block.units, decisions, variants);
      if (!key) continue;
      const accepted = block.units.filter((id) => decisions[id] === "accepted").sort();
      if (mixedRequested.current.has(key)) continue;
      mixedRequested.current.add(key);
      setMixedPreviews((prev) => ({ ...prev, [key]: { status: "loading" } }));
      void api<{ files: string; strips: Strip[]; unavailable?: boolean }>(
        `/rounds/${detail.round}/mixed`,
        { units: block.units, accepted },
      )
        .then((res) => {
          if (mixedGen.current !== gen) return;
          if (res?.strips?.length && res.files && !res.unavailable) {
            setMixedPreviews((prev) => ({
              ...prev,
              [key]: { status: "ready", files: res.files, strips: res.strips },
            }));
          } else {
            setMixedPreviews((prev) => ({ ...prev, [key]: { status: "error" } }));
          }
        })
        .catch(() => {
          if (mixedGen.current !== gen) return;
          setMixedPreviews((prev) => ({ ...prev, [key]: { status: "error" } }));
        });
    }
  }, [detail, placed, stops, decisions, variants, changes, history, transport, previewing]);
  // A block with an edit accepted in a note option's wording shows the
  // option's own comparison, the one its preview showed, until the block is
  // decided with rejections too. The engine compiles each wording once.
  const optionKey = (units: string[]) => {
    const spans = state?.variantSpans;
    const edits = (detail?.units ?? []).filter((unit) => units.includes(unit.id) && variants && Object.hasOwn(variants, unit.id))
      .map((unit) => {
        const span = spans?.[unit.id];
        return { unit: unit.id, text: variants![unit.id], ...(span?.[0] ? { before: span[0] } : {}), ...(span?.[1] ? { after: span[1] } : {}) };
      });
    return edits.length ? JSON.stringify([detail!.round, edits]) : null;
  };
  const optionRequested = useRef(new Set<string>());
  // The engine prepares an option's comparison while no build runs; one asked
  // for is not asked again on this page, failed or not.
  const building = state?.job?.status === "queued" || state?.job?.status === "running";
  useEffect(() => {
    if (!detail || changes || transport || previewing || detail.sourceOnly || building) return;
    for (const { block } of placed) {
      const key = optionKey(block.units);
      if (!key || optionRequested.current.has(key)) continue;
      optionRequested.current.add(key);
      const [round, edits] = JSON.parse(key) as [number, { unit: string; text: string }[]];
      void api<RoundDetail>(`/source/options/preview`, { id: "accepted", round, edits, background: true })
        .then((value) => setOptionBlocks((prev) => ({ ...prev, [key]: value })), () => {});
    }
  }, [detail, placed, variants, changes, transport, previewing, building]);
  // Clear stale selectedUnit if its unit disappeared or its block resolved.
  const multiUnitAt = (index: number) => {
    const meta = blockUnitStatic.get(index),
      block = placed[index]?.block,
      stop = stops[index];
    if (!meta || !block || !stop || block.waiting || focused) return null;
    const status = stopState(block.units, decisions),
      reviewed = !pendingUnits(stop, decisions).length,
      expanded = browsing || index === linkedChange || block.units.some((id) => again.has(id)),
      key = detail && !changes && !history && reviewed ? mixedKey(detail.round, index, block.units, decisions, variants) : null,
      mixedReady = Boolean(key && mixedPreviews[key]?.status === "ready" && mixedPreviews[key]?.strips?.length),
      resolved = history || index === linkedChange
        ? undefined
        : changes
          ? (status === "rejected" ? "before" : undefined)
          : mixedReady ? "mixed" : resolvedSide(block.units, decisions) || (status === "commented" ? "after" : undefined);
    if (resolved || (reviewed && !expanded)) return null;
    return meta;
  };
  const defaultUnitAt = (index: number): string | null => {
    const meta = multiUnitAt(index);
    if (!meta) return null;
    if (selectedUnit?.stop === index && meta.subUnits.includes(selectedUnit.unit)) {
      return selectedUnit.unit;
    }
    return (
      meta.subUnits.find((id) => stopState(meta.groupMembers.get(id) ?? [id], decisions) === "pending") ??
      meta.subUnits[0] ??
      null
    );
  };
  const focusedUnitAt = (index: number): string | null =>
    index === current ? defaultUnitAt(index) : null;
  const activeFocusedUnit = current >= 0 ? focusedUnitAt(current) : null;
  useEffect(() => {
    if (current < 0) return;
    announce(current, activeFocusedUnit);
  }, [current, detail, activeFocusedUnit]);
  useEffect(() => {
    if (!selectedUnit) return;
    const meta = multiUnitAt(selectedUnit.stop);
    if (!meta || !meta.subUnits.includes(selectedUnit.unit)) {
      setSelectedUnit(null);
    }
  }, [selectedUnit, blockUnitStatic, stops, decisions, changes, history, linkedChange, mixedPreviews]);
  const unitActionRefs = useRef({ current, composer, select });
  unitActionRefs.current = { current, composer, select };
  selectUnitHandler.current = (stop, unit) => {
    if (stop < 0 || stop >= stops.length) return;
    reached.current = "pick";
    select(stop, true);
    const meta = blockUnitStatic.get(stop);
    const resolved = unit ? (meta?.unitToGroup.get(unit) ?? unit) : undefined;
    if (resolved && meta?.subUnits.includes(resolved)) {
      setSelectedUnit({ stop, unit: resolved });
    }
  };
  const handleHoverUnit = useMemo(
    () => (stop: number, unit: string | null) =>
      setHoveredUnit((prev) =>
        unit
          ? prev?.stop === stop && prev.unit === unit
            ? prev
            : { stop, unit }
          : prev?.stop === stop
            ? null
            : prev,
      ),
    [],
  );
  const handleSelectUnit = useMemo(
    () => (stop: number, unit: string | null, side?: "before" | "after") => {
      const live = unitActionRefs.current;
      if (live.composer) return;
      if (!unit) {
        setSelectedUnit((prev) => (prev?.stop === stop ? null : prev));
        return;
      }
      if (stop !== live.current) {
        reached.current = "pick";
        live.select(stop, false);
      }
      setSelectedUnit({ stop, unit, side });
    },
    [],
  );
  async function decideUnit(kind: Kind, stopIndex: number, unitId: string, _subUnits: string[]) {
    const group = unitGroup(stopIndex, unitId);
    const chosen = targets(group, kind);
    if (!chosen.length) return;
    await decide(kind, chosen);
  }
  async function decide(
    kind: Kind,
    chosen = targets(stops[current]?.units ?? [], kind),
    body = "",
    confirmed = false,
  ): Promise<boolean> {
    // A comment written while a newer round arrived goes out on the round it
    // was written on: the server carries it to the same change there.
    const sendable = latest || (kind === "comment" && Boolean(detail && state && !state.closed && !previewing));
    if (
      !chosen.length ||
      snapshot.current.busy ||
      !sendable ||
      !detail ||
      blocked(kind)
    )
      return false;
    if (kind === "accept" && !confirmed) {
      const items = chosen.flatMap((id) => hazardsNow.current.get(id) ?? []);
      if (items.length) {
        setConfirm({ kind, chosen, body, items });
        return false;
      }
    }
    // The review moves on at once; the server confirms decisions in order.
    const entry: Queued = { id: actionId(), kind, round: detail.round, changes: chosen, body, stop: current, done: "", ...(kind === "reject" && focused && noteFocus?.key ? { noteKey: noteFocus.key } : {}) };
    // A comment's draft stays stored until the server has the comment.
    if (kind === "comment" && composer) {
      entry.draft = composer.key;
      closeComposer();
    }
    const after = withQueued(snapshot.current.state?.decisions ?? {}, [...queue.current!.pending, entry]);
    const target = pendingUnits(stops[current], after).some(inFocus) ? current : nextPending(stops, after, current, focused);
    if (target < 0)
      entry.done = changes
        ? (kind === "accept" ? t("All changes are staged.") : "")
        : focused ? t("Review complete") : t("All changes reviewed. Your decisions are saved.");
    epoch.current++;
    queue.current!.push(entry);
    setQueued(queue.current!.pending);
    setSettling(true);
    const activeUnit = focusedUnitAt(current);
    const currentMeta = blockUnitStatic.get(current);
    const activeMembers = activeUnit ? (currentMeta?.groupMembers.get(activeUnit) ?? [activeUnit]) : [];
    if (
      !changes &&
      activeUnit &&
      currentMeta &&
      activeMembers.some((id) => chosen.includes(id)) &&
      stopState(activeMembers, after) !== "pending"
    ) {
      const sub = currentMeta.subUnits;
      const pos = sub.indexOf(activeUnit);
      const nextUnit = [
        ...sub.slice(pos + 1),
        ...sub.slice(0, Math.max(0, pos)),
      ].find((id) => id !== activeUnit && stopState(currentMeta.groupMembers.get(id) ?? [id], after) === "pending");
      setSelectedUnit(nextUnit ? { stop: current, unit: nextUnit } : null);
    }
    if (target >= 0 && target !== current) select(target);
    if (target < 0 && !browsing) setCurrent(-1);
    return true;
  }
  settle.current = {
    send: (entry) =>
      api<PageState>("/decide", {
        id: entry.id,
        action: entry.kind,
        round: entry.round,
        changes: entry.changes,
        body: entry.body, noteKey: entry.noteKey,
      }),
    confirmed(entry, next, remaining) {
      epoch.current++;
      // Undo, waiting for the queue, reads the newest confirmed state.
      snapshot.current.state = next;
      setState(next);
      setQueued(remaining);
      // The host refreshes what depends on the decision, such as Git status.
      window.dispatchEvent(new CustomEvent("papilot:review:decided", { detail: { decision: entry.id, noteReturns: (next as PageState & { noteReturns?: unknown }).noteReturns } }));
      if (entry.draft) store(entry.draft, "");
      if (!remaining.length) {
        if (entry.done) setToast(entry.done);
        pollNow.current();
      }
    },
    failed(entry, error, dropped) {
      epoch.current++;
      failures.current++;
      setQueued([]);
      const message = dropped.length
        ? `${error.message} ${tn(dropped.length, "{n} later decision was not sent.", "{n} later decisions were not sent.")}`
        : error.message;
      setToast(message);
      // Back to the change whose decision failed, still undecided.
      if (entry.round === snapshot.current.detail?.round && stops[entry.stop]) select(entry.stop);
      if (entry.kind === "comment" && entry.draft && !snapshot.current.composer) { setDraft(entry.body); setComposer({ changes: entry.changes, stop: entry.stop, key: entry.draft }); }
      pollNow.current();
    },
  };
  async function undo(refreshBefore = false) {
    // The snapshot has the decision confirmed a moment ago, before this
    // render's state does: Undo pressed right after a decision takes it back.
    if ((!refreshBefore && !snapshot.current.state?.undo && !queue.current!.pending.length) || !latest || snapshot.current.busy)
      return;
    // The latest decision has not been sent yet: it is simply dropped, and
    // nothing reaches the server or compiles.
    const withdrawn = queue.current!.withdraw();
    if (withdrawn) {
      epoch.current++;
      setQueued(queue.current!.pending);
      if (withdrawn.draft) store(withdrawn.draft, withdrawn.body);
      setHistory(false);
      if (withdrawn.round === detail?.round && stops[withdrawn.stop]) select(withdrawn.stop);
      setToast(changes ? t("Revert undone. The changes are back in your files.") : t("Last decision undone. The restored changes need review again."));
      return;
    }
    epoch.current++;
    setBusy(true);
    snapshot.current.busy = true;
    try {
      // Undo takes back the last decision, so the queued ones go first. If
      // one fails, the decision Undo was meant for was never made.
      const failed = failures.current;
      await queue.current!.drained();
      if (refreshBefore) {
        const current = await api<PageState>(stateRoute());
        if (current.latest !== snapshot.current.detail?.round) { pollNow.current(); return; }
        snapshot.current.state = current;
        setState(current);
      }
      const last = snapshot.current.state?.undo;
      if (failures.current !== failed || !last || blocked(undoKind(snapshot.current.state))) return;
      const next = await api<PageState & { restored: string[]; noteReturns?: unknown }>("/undo", {
        id: last.id,
      });
      setState(next);
      window.dispatchEvent(new CustomEvent("papilot:review:decided", { detail: { undone: last.id, noteReturns: next.noteReturns } }));
      // An undo of an earlier round's accept inserted the next round.
      if (next.latest !== snapshot.current.detail?.round) pollNow.current();
      const target = stops.findIndex((s) =>
        s.units.some((id) => next.restored.includes(id)),
      );
      setHistory(false);
      if (target >= 0) select(target);
      setToast(
        changes
          ? t("Revert undone. The changes are back in your files.")
          : t("Last decision undone. The restored changes need review again."),
      );
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      epoch.current++;
      setBusy(false);
      snapshot.current.busy = false;
    }
  }
  useEffect(() => {
    const undoFromWorkspace = () => void undo(true);
    window.addEventListener(UNDO_EVENT, undoFromWorkspace);
    return () => window.removeEventListener(UNDO_EVENT, undoFromWorkspace);
  });
  async function submitComposer() {
    if (!composer || !draft.trim() || busy) return;
    await decide("comment", composer.changes, draft.trim());
  }
  const standaloneRetry = !transport && !location.pathname.startsWith("/review/");
  const hostRetryAvailable = hostRetry === "1" || hostRetry === "busy";
  const hostRetryBusy = hostRetry === "busy";
  const canRetryComparison = Boolean(
    latest &&
    !changes &&
    !previewing &&
    !state?.closed &&
    !state?.decisionLock &&
    !state?.rejectLock &&
    state?.state !== "building" &&
    (hostRetryAvailable || standaloneRetry),
  );
  const retryDisabled = retryingComparison || hostRetryBusy;
  async function retryComparison() {
    if (!canRetryComparison || retryDisabled) return;
    if (!window.dispatchEvent(new Event(RETRY_COMPARISON_EVENT, { cancelable: true }))) {
      setRetryingComparison(true);
      pollNow.current();
      if (hostRetryTimer.current) clearTimeout(hostRetryTimer.current);
      hostRetryTimer.current = setTimeout(() => {
        hostRetryTimer.current = null;
        setRetryingComparison(false);
      }, 1500);
      return;
    }
    if (!standaloneRetry) return;
    setRetryingComparison(true);
    try {
      await api("/publish", {});
      pollNow.current();
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setRetryingComparison(false);
    }
  }
  useEffect(() => {
    if (current < 0 || !paper.current || !activeFocusedUnit) return;
    const list = paper.current.querySelector<HTMLElement>(`[data-stop="${current}"] .unit-chips`);
    const chip = list?.querySelector<HTMLElement>(`.unit-chip[data-unit="${CSS.escape(activeFocusedUnit)}"]`);
    if (!list || !chip) return;
    const pad = 20;
    const listRect = list.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    if (chipRect.left < listRect.left + pad) {
      list.scrollLeft -= listRect.left + pad - chipRect.left;
    } else if (chipRect.right > listRect.right - pad) {
      list.scrollLeft += chipRect.right - (listRect.right - pad);
    }
  }, [current, activeFocusedUnit, detail]);
  function toggleSource(index: number) {
    if (index !== current) {
      reached.current = "source";
      select(index, false);
    }
    // A workspace with its own editor shows the source there, not on the page.
    const focusedId = defaultUnitAt(index);
    const sourceIds = focusedId ? unitGroup(index, focusedId) : (stops[index]?.units ?? []);
    if (!openSource.has(index) && offerSource(sourceIds.map((id) => units.get(id)!).filter(Boolean))) return;
    if (openSource.has(index)) editedPlace.current = null;
    setOpenSource((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }
  async function copy(index: number) {
    if (!detail || !state) return;
    // Only text selected in this change describes it.
    const selection = window.getSelection(),
      change = document.querySelector(`.change[data-stop="${index}"]`),
      selected = selection && change?.contains(selection.anchorNode) && change.contains(selection.focusNode) ? selection.toString().trim() : "",
      known = stops[index].units.map((id) => units.get(id)!).filter(Boolean);
    const reference = copyReference(
      state.title,
      detail.round,
      index + 1,
      describeLocation(known),
      selected,
    );
    // Plain-http addresses, such as a phone over Tailscale, have no async
    // clipboard; the document's copy command still works there.
    let copied = false;
    try {
      await navigator.clipboard.writeText(reference);
      copied = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = reference;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      try {
        copied = document.execCommand("copy");
      } finally {
        area.remove();
      }
    }
    setToast(
      !copied
        ? t(
            "Clipboard unavailable. Select the PDF text and use your browser’s Copy command.",
          )
        : selected
          ? t("Copied selected text with file, lines and PDF page.")
          : t("Copied the change location."),
    );
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target as HTMLElement,
        typing =
          target.matches("input,textarea,select") || target.isContentEditable;
      if (event.key === "Escape") {
        if (confirm) setConfirm(null);
        else if (help) setHelp(false);
        else if (composer) closeComposer();
        return;
      }
      if (typing || help || confirm || window.getSelection()?.toString()) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undo();
        return;
      }
      if (composer) return;
      const currentMeta = multiUnitAt(current);
      const focusedUnit = focusedUnitAt(current);
      if (
        focusedUnit &&
        currentMeta &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        const pos = currentMeta.subUnits.indexOf(focusedUnit);
        if (pos >= 0 && currentMeta.subUnits.length > 1) {
          const nextPos = pos + (event.key === "ArrowRight" ? 1 : -1);
          if (nextPos >= 0 && nextPos < currentMeta.subUnits.length) {
            event.preventDefault();
            setSelectedUnit({ stop: current, unit: currentMeta.subUnits[nextPos] });
            return;
          }
        }
      }
      const action = shortcutAction(event, shortcuts);
      if (!action || (changes && action === 'comment')) return;
      event.preventDefault();
      const activeUnitGroup = focusedUnit
        ? unitGroup(current, focusedUnit)
        : null;
      const optionActive = Boolean(
        previewing &&
          optionPreview?.key &&
          (activeUnitGroup ?? stops[current]?.units ?? []).some((id) =>
            !optionPreview.units?.length || optionPreview.units.includes(id),
          ),
      );
      if (optionActive && (action === "accept" || action === "reject" || action === "comment")) {
        const reason = lockOf(snapshot.current.state, action);
        if (reason) { setToast(t(reason)); return; }
        // Accepting an option does not wait for its PDF; the change shows it once ready.
        if (optionPreview?.busy) return;
        window.dispatchEvent(new CustomEvent("papilot:option-action", { detail: { key: optionPreview!.key, action } }));
        return;
      }
      const waits = !changes && (activeUnitGroup ?? stops[current]?.units ?? []).some((id) => waiting.has(id) && decisions[id] === "pending");
      if ((action === 'accept' || action === 'reject') && waits && !targets(activeUnitGroup ?? stops[current]?.units ?? [], "accept").length)
        setToast(waitingLabel());
      else if (action === 'accept') {
        if (activeUnitGroup && focusedUnit && currentMeta) {
          const kind = kinds(activeUnitGroup)[0] ?? "accept";
          void decideUnit(kind, current, focusedUnit, currentMeta.subUnits);
        } else void decide(kinds(stops[current]?.units ?? [])[0] ?? "accept");
      } else if (action === 'reject') {
        if (activeUnitGroup && focusedUnit && currentMeta)
          void decideUnit("reject", current, focusedUnit, currentMeta.subUnits);
        else void decide("reject");
      } else if (action === 'comment') beginComposer(activeUnitGroup ? targets(activeUnitGroup, "comment") : undefined);
      else if (action === 'next')
        select(adjacent(current, 1));
      else if (action === 'previous')
        select(adjacent(current, -1));
      else if (action === 'pending') select(nextPending(stops, decisions, current, focused));
      else if (action === 'source') toggleSource(current);
      else if (action === 'undo') void undo();
      else if (action === 'help') showHelp();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [state, queued, detail, current, busy, composer, draft, help, confirm, history, shortcuts, noteFocus, noteGroups, selectedUnit, optionPreview]);
  function onScroll() {
    if (
      !paper.current ||
      composer ||
      Date.now() < scrollUntil.current ||
      window.getSelection()?.toString()
    )
      return;
    const box = paper.current.getBoundingClientRect(),
      regions = [...paper.current.querySelectorAll<HTMLElement>("[data-stop]")]
        .filter((article) => navigation.includes(Number(article.dataset.stop)))
        .map((article) => {
          const b = article.getBoundingClientRect();
          return {
            index: Number(article.dataset.stop),
            top: b.top,
            bottom: b.bottom,
          };
        });
    const index = visibleStop(regions, current, box.top + 60, box.bottom - 100);
    if (index !== current) { reached.current = "scroll"; select(index, false); }
    if (index >= 0) remember(index);
  }
  const actionBar = (index: number) => {
    if (index !== current || !state) return null;
    const meta = multiUnitAt(index),
      focusedUnit = focusedUnitAt(index),
      unitPos = meta && focusedUnit ? meta.subUnits.indexOf(focusedUnit) : -1,
      blockUnits = stops[index].units.filter(inFocus),
      units = focusedUnit
        ? unitGroup(index, focusedUnit)
        : blockUnits,
      available = kinds(units),
      remaining = nextPending(stops, decisions, current, focused),
      waits = !changes && units.some((id) => waiting.has(id) && decisions[id] === "pending"),
      unitStatus = focusedUnit ? stopState(units, decisions) : "pending",
      optionActive = Boolean(
        previewing &&
          optionPreview?.key &&
          units.some((id) => !optionPreview.units?.length || optionPreview.units.includes(id)),
      );
    const renderDecisionButtons = (list: Kind[]) =>
      list.map((kind) => {
        const keys = shortcuts[kind === "unstage" ? "accept" : kind],
          count = targets(units, kind).length,
          rawHostLock = lockOf(state, kind),
          lock = optionActive ? (rawHostLock ? t(rawHostLock) : null) : actionLock(kind),
          optionDisabled = optionActive
            ? Boolean(
                optionPreview?.busy ||
                  Boolean(lock),
              )
            : busy || !latest || Boolean(lock);
        return (
          <button
            className={kind}
            key={kind}
            aria-keyshortcuts={keys.join(" ")}
            title={
              lock ||
              [
                label(kind) + (!focusedUnit && count > 1 && kind !== "comment" ? ` (${count})` : ""),
                keys.map(bindingLabel).join(" / "),
              ]
                .filter(Boolean)
                .join(" · ")
            }
            aria-describedby={lock ? "review-lock" : undefined}
            disabled={optionDisabled}
            // The next change's bar takes this one's place at once;
            // a double click decides only the change it began on.
            onClick={(event) => {
              event.stopPropagation();
              if (optionActive && (kind === "accept" || kind === "reject" || kind === "comment")) {
                if (event.detail < 2) {
                  window.dispatchEvent(new CustomEvent("papilot:option-action", { detail: { key: optionPreview!.key, action: kind } }));
                }
                return;
              }
              if (focusedUnit && meta) {
                if (kind === "comment") beginComposer(targets(units, "comment"));
                else if (event.detail < 2) void decideUnit(kind, index, focusedUnit, meta.subUnits);
              } else if (kind === "comment") beginComposer();
              else if (event.detail < 2) void decide(kind);
            }}
          >
            {label(kind)}
            {!focusedUnit && count > 1 && kind !== "comment" ? ` (${count})` : ""}
          </button>
        );
      });
    return (
      <div className="dock">
        <nav className="actions" aria-label={t("Review the current change")}>
          {phoneDock && navigation.length > 1 && (
            <>
              <button
                type="button"
                className="nav"
                aria-label={t("Previous change")}
                aria-keyshortcuts={shortcuts.previous.join(' ')}
                title={[t('Previous change'), shortcuts.previous.map(bindingLabel).join(' / ')].filter(Boolean).join(' · ')}
                disabled={adjacent(index, -1) < 0}
                onClick={() => select(adjacent(index, -1))}
              >
                ‹
              </button>
              <span className="position">
                {navigation.indexOf(index) + 1} / {navigation.length}
              </span>
            </>
          )}
          {meta && focusedUnit && unitPos >= 0 ? (
            <>
              <div
                className="unit-focus-group"
                role="group"
                aria-label={t("Review the current change")}
                onClick={(event) => event.stopPropagation()}
              >
                <span className="unit-focus-sep" aria-hidden="true" />
                {unitStatus !== "pending" && (
                  <span className="unit-focus-state" data-state={unitStatus}>
                    {stateLabel(unitStatus)}
                  </span>
                )}
                {renderDecisionButtons(available)}
              </div>
              {waits && (
                <span className="comparison-pending" data-state={detail?.rendering ?? "pending"} role="status">
                  {waitingLabel()}
                </span>
              )}
            </>
          ) : available.length ? (
            <>
              {renderDecisionButtons(available)}
              {waits && (
                <span className="comparison-pending" data-state={detail?.rendering ?? "pending"} role="status">
                  {waitingLabel()}
                </span>
              )}
            </>
          ) : remaining >= 0 ? (
            <button
              className="skip"
              aria-keyshortcuts={shortcuts.pending.join(' ')}
              title={[changes ? t("Next unstaged") : t("Next undecided"), shortcuts.pending.map(bindingLabel).join(' / ')].filter(Boolean).join(' · ')}
              onClick={() => select(remaining)}
            >
              {changes ? t("Next unstaged") : t("Next undecided")}
            </button>
          ) : (
            <span className="complete">
              {changes
                ? stateLabel(stopState(units, decisions))
                : latest
                  ? t("Review complete")
                  : t("Earlier changes")}
            </span>
          )}
          {phoneDock && navigation.length > 1 && (
            <button
              type="button"
              className="nav"
              aria-label={t("Next change")}
              aria-keyshortcuts={shortcuts.next.join(' ')}
              title={[t('Next change'), shortcuts.next.map(bindingLabel).join(' / ')].filter(Boolean).join(' · ')}
              disabled={adjacent(index, 1) < 0}
              onClick={() => select(adjacent(index, 1))}
            >
              ›
            </button>
          )}
        </nav>
      </div>
    );
  };
  async function loadPlaces(id: string) {
    const round = detail!.round,
      key = `${round}:${id}`;
    setMore((m) => ({ ...m, [key]: "loading" }));
    try {
      const { places } = await api<{ places: PlaceView[] }>(
        `/rounds/${round}/effects/${encodeURIComponent(id)}`,
      );
      setMore((m) => ({ ...m, [key]: places }));
    } catch (error) {
      setMore((m) => ({ ...m, [key]: { error: (error as Error).message } }));
    }
  }
  // Places produced by a verified combination containing this edit. These
  // previews do not change which source edit an accept/reject action applies.
  function effects(
    unit: Unit & Partial<VisualUnit>,
    clean: boolean,
  ): ReactNode {
    const { total, shown } = unit.effects!,
      key = `${detail!.round}:${unit.id}`,
      open = effectOverrides[key] ?? (expandedEffects || unit.visual === "unmapped" || unit.visual === "identical"),
      bodyId = `effects-${detail!.round}-${unit.id}`,
      loaded = more[key],
      places = [...shown, ...(Array.isArray(loaded) ? loaded : [])],
      strips = (items: Strip[], side: "before" | "after") =>
        items.length > 0 && (
          <div
            className={`side ${side}`}
            aria-label={side === "before" ? t("Before") : t("After")}
          >
            {items.map((image) => (
              <PdfStrip
                key={image.src}
                image={image}
                base={detail!.files}
                label={side === "before" ? t("Before") : t("After")}
                clean={clean}
              />
            ))}
          </div>
        );
    return (
      <section className="effects" key={unit.id}>
        <p className="effects-head">
          <button className="link effects-toggle" aria-expanded={open} aria-controls={bodyId}
            onClick={() => setEffectOverrides((values) => ({ ...values, [key]: !open }))}>
            <span aria-hidden="true">{open ? "▾" : "▸"}</span>{" "}
            {tn(total, "{n} related PDF change", "{n} related PDF changes")}
          </button>
        </p>
        <div id={bodyId} hidden={!open}>
          {open && (
            <>
              {unit.effects!.verified && (
                <p className="caption">
                  {t("These previews show one verified combination of edits. Other or smaller combinations may produce the same result. Accepting or rejecting applies only to the selected edit.")}
                </p>
              )}
              {places.map((place, i) => (
                <div className="place" key={i}>
                  <p className="place-where">
                    {t("p. {pages}", { pages: place.page })}
                    {place.section ? ` · ${place.section}` : ""}
                    {place.with
                      ? ` · ${t("with {changes}", {
                          changes: place.with
                            .map((id) =>
                              firstStop.has(id)
                                ? t("Change {n}", { n: firstStop.get(id)! + 1 })
                                : (units.get(id)?.file ?? id),
                            )
                            .join(", "),
                        })}`
                      : ""}
                  </p>
                  {strips(place.before, "before")}
                  {strips(place.after, "after")}
                </div>
              ))}
              {total > places.length && (
                <button
                  className="link more-places"
                  disabled={loaded === "loading"}
                  onClick={() => void loadPlaces(unit.id)}
                >
                  {loaded === "loading"
                    ? t("Loading…")
                    : tn(
                        total - places.length,
                        "Show {n} more",
                        "Show {n} more",
                      )}
                </button>
              )}
              {loaded && typeof loaded === "object" && "error" in loaded && (
                <p className="caption">{loaded.error}</p>
              )}
            </>
          )}
        </div>
      </section>
    );
  }
  function change(
    block: ChangeBlock,
    index: number,
    inline: boolean,
  ): ReactNode {
    const accepted = optionKey(block.units),
      blockOptionPreview =
      previewing &&
      optionPreview?.detail &&
      (!optionPreview.units?.length || block.units.some((id) => optionPreview.units!.includes(id)))
        ? optionPreview.detail
        : (accepted && optionBlocks[accepted]) || null;
    const previewBlock = blockOptionPreview
      ? ([
          ...blockOptionPreview.sections.flatMap((s) =>
            s.blocks.filter((b): b is ChangeBlock => b.kind === "change"),
          ),
          ...blockOptionPreview.loose,
        ].find((b) => b.units.some((id) => block.units.includes(id))) ?? null)
      : null;
    // An accepted option that restores the original wording leaves nothing to
    // compare in its PDF: the passage reads as before.
    const restored = Boolean(!previewBlock && blockOptionPreview && !previewing &&
        block.units.every((id) => variants && Object.hasOwn(variants, id) && variants[id] === units.get(id)?.old_text)),
      displayBefore = previewBlock ? previewBlock.before : block.before,
      displayAfter = previewBlock ? previewBlock.after : restored ? block.before : block.after,
      stripBase = previewBlock && blockOptionPreview ? blockOptionPreview.files : detail!.files;
    const known = (blockOptionPreview
      ? block.units.map((id) => blockOptionPreview.units.find((u) => u.id === id) ?? units.get(id)!)
      : block.units.map((id) => units.get(id)!)
    ).filter(Boolean),
      // A .bib edit is shown entry by entry, every field, rather than as
      // the bibliography's typeset lines alone.
      bib = detail!.references?.entries.filter((e) => (e.units ?? [e.unit]).some((id) => block.units.includes(id))) ?? [],
      uncited = detail!.references?.missing.filter((m) => m.unit && block.units.includes(m.unit)) ?? [],
      status = stopState(block.units, decisions),
      reviewed = !pendingUnits(stops[index], decisions).length,
      // Focusing a note may reveal its own decided group. It must not expand
      // unrelated accepted/rejected groups or turn the review into history.
      focusedBlock = Boolean(focused?.some(id => block.units.includes(id))),
      // A decision made with an earlier comparison is shown again when this
      // change's own comparison looks different.
      reviewAgain = block.units.some((id) => again.has(id)),
      expanded = focusedBlock || browsing || index === linkedChange || reviewAgain,
      // A reverted change shows the text that is back on disk; staged and
      // unstaged ones keep their before and after.
      key = !changes && !history && reviewed ? mixedKey(detail!.round, index, block.units, decisions, variants) : null,
      mixedPreview = key ? mixedPreviews[key] : undefined,
      resolved = focusedBlock || history || index === linkedChange
        ? undefined
        : changes
          ? status === "rejected"
            ? "before"
            : undefined
          : mixedPreview?.status === "ready" && mixedPreview.strips?.length
            ? "mixed"
            : resolvedSide(block.units, decisions) || (status === "commented" ? "after" : undefined),
      source = openSource.has(index),
      hasStrips = block.before.length > 0 || block.after.length > 0,
      blockEffects = known.filter((u) => u.effects && firstStop.get(u.id) === index),
      hasEffects = blockEffects.length > 0,
      binaryOnly = known.length > 0 && known.every((u) => u.kind === "binary"),
      hasSourceText = known.some((u) => u.kind !== "binary"),
      unavailableReason: UnavailableComparisonReason | null =
        !block.waiting && !bib.length
          ? block.identical && !hasEffects
            ? "identical"
            : !hasStrips && detail?.sourceOnly
              ? "baseline-failed"
              : !hasStrips && !hasEffects
                ? (binaryOnly ? "binary" : "unmapped")
                : null
          : null,
      unavailableNotice = unavailableReason
        ? {
            reason: unavailableReason,
            message: unavailableComparisonMessage(unavailableReason),
            sourceAction: hasSourceText,
          }
        : null,
      remarks = [
        ...new Set(
          block.units.map((id) => state?.comments[id]).filter(Boolean),
        ),
      ],
      location = describeLocation(known, t),
      kindLabel = bib.length
        ? t("Bibliography")
        : block.reflow
        ? t("Reflow")
        : changeKinds(known)
            .map((kind) => t(KIND[kind]))
            .join(", ");
    const meta = blockUnitStatic.get(index),
      subUnits = meta?.subUnits ?? [],
      multiUnit = Boolean(meta && !block.waiting && !focused && !resolved && (!reviewed || expanded)),
      selectableSet = multiUnit ? meta!.selectableSet : undefined,
      activeUnit = multiUnit ? focusedUnitAt(index) : null,
      blockHoveredUnit = multiUnit && hoveredUnit?.stop === index ? hoveredUnit.unit : null,
      blockUnitStatesMap = multiUnit ? blockUnitStates.get(index) : undefined;
    const images = (items: Strip[], side: "before" | "after") => (
      <div
        className={`side ${side}${block.identical ? " identical" : ""}`}
        aria-label={side === "before" ? t("Before") : t("After")}
      >
        {items.map((image) => (
          <PdfStrip
            key={`${stripBase}${image.src}`}
            image={image}
            base={stripBase}
            label={side === "before" ? t("Before") : t("After")}
            clean={Boolean(resolved)}
            focus={focused}
            stopIndex={multiUnit ? index : undefined}
            side={side}
            unitStates={blockUnitStatesMap}
            activeUnit={activeUnit}
            hoveredUnit={blockHoveredUnit}
            selectableUnits={selectableSet}
            unitGroupOf={multiUnit ? meta!.unitToGroup : undefined}
            onHoverUnit={multiUnit ? handleHoverUnit : undefined}
            onSelectUnit={multiUnit ? handleSelectUnit : undefined}
          />
        ))}
      </div>
    );
    return (
      <article
        key={index}
        className={`change ${inline ? "inline" : "standalone"}${current === index ? " current" : ""}${reviewed && !expanded ? " reviewed-change" : ""}${reviewed && !expanded && !resolved ? " mixed-reviewed" : ""}`}
        data-note-focus={focused ? "true" : undefined}
        data-stop={index}
        data-units={block.units.join(" ")}
        data-active-unit={activeUnit || undefined}
        data-option-preview={previewing ? "true" : undefined}
        data-state={status}
        data-resolved={resolved}
        tabIndex={-1}
        onClick={() => {
          if (!block.units.some(inFocus) || composer || (!expanded && reviewed)) return;
          reached.current = "pick";
          if (index !== current) select(index, false);
          else announce(index, defaultUnitAt(index));
        }}
      >
        {reviewed && !expanded && !resolved && (
          <p className="reviewed-placeholder">
            {mixedPreview?.status === "loading" ? (
              <span className="mixed-compiling" role="status">{t("Updating changes…")}</span>
            ) : (
              <button
                className="link"
                onClick={() => {
                  setHistory(true);
                  select(index, false);
                }}
              >
                {t("Reviewed changes · View in History")}
              </button>
            )}
          </p>
        )}
        <header className="change-head">
          {/* The English number and location are kept for tools that quote
              them to an agent, whatever the interface language. */}
          <span className="change-number" data-change={index + 1} title={t("Change {n}", { n: index + 1 })}>
            <span className="change-number-full">{t("Change {n}", { n: index + 1 })}</span>
            <span className="change-number-short" aria-hidden="true">#{index + 1}</span>
          </span>
          <span
            className="change-where"
            title={location}
            data-location={describeLocation(known)}
          >
            {shortLocation(known, t)}
          </span>
          {multiUnit && (
            <div className="unit-chips-wrap" onClick={(event) => event.stopPropagation()}>
              <div
                className="unit-chips"
                role="group"
                aria-label={t("{n} edits", { n: subUnits.length })}
              >
                {subUnits.map((id, pos) => {
                  const members = meta!.groupMembers.get(id) ?? [id],
                    uState = stopState(members, decisions),
                    isActive = current === index && id === activeUnit,
                    snippet = unitSnippet(units.get(id)),
                    tip = [snippet, stateLabel(uState)].filter(Boolean).join(" · ");
                  return (
                    <button
                      key={id}
                      type="button"
                      className="unit-chip"
                      data-unit={id}
                      data-units={members.join(" ")}
                      data-state={uState}
                      data-active={isActive ? "true" : undefined}
                      aria-pressed={isActive}
                      title={tip}
                      onPointerEnter={() => handleHoverUnit(index, id)}
                      onPointerLeave={() => handleHoverUnit(index, null)}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (index !== current) {
                          reached.current = "scroll";
                          select(index, false);
                        }
                        setSelectedUnit({ stop: index, unit: id });
                      }}
                    >
                      <span className="unit-chip-label">{pos + 1}</span>
                    </button>
                  );
                })}
              </div>
              {subUnits.length > 8 && (
                <span className="unit-chips-count" aria-hidden="true">
                  {current === index && activeUnit
                    ? `${Math.max(0, subUnits.indexOf(activeUnit)) + 1}/${subUnits.length}`
                    : `${subUnits.length}`}
                </span>
              )}
            </div>
          )}
          {actionBar(index)}
          {kindLabel && !block.waiting && <span className="change-kind" title={kindLabel}>{kindLabel}</span>}
          {(() => {
            // One edit that still sits in several changes says where else and why.
            const linked = (block.linked ?? []).flatMap((link) =>
              stops.flatMap((other, at) => (at !== index && other.units.includes(link.unit) ? [{ at, reason: link.reason }] : [])));
            if (!linked.length) return null;
            const others = [...new Set(linked.map((link) => link.at))];
            return (
              <button
                type="button"
                className="change-kind change-linked"
                title={t(linked.some((link) => link.reason === "moved")
                  ? "The same edit now prints elsewhere, on another page or in a float."
                  : "The same edit prints in several places in the PDF.")}
                onClick={(event) => { event.stopPropagation(); select(others[0]); }}
              >
                {t("Same edit as change {list}", { list: others.map((at) => at + 1).join(", ") })}
              </button>
            );
          })()}
          {block.carried !== undefined && (() => {
            // Rounds are named by when they were published, as in History.
            const published = state?.history?.find((entry) => entry.number === block.carried)?.created,
              time = published ? new Intl.DateTimeFormat(locale(), { timeStyle: "short" }).format(new Date(published * 1000)) : "";
            return (
              <span className="change-carried" title={t("This change's own PDF comparison is still rendering. This comparison was rendered for the same change in the changes published at {time}.", { time })}>
                {time ? t("PDF from {time}", { time }) : t("Earlier PDF")}
              </span>
            );
          })()}
          {reviewAgain && (
            <span className="change-again" title={t("The PDF comparison changed after your decision.")}>
              {t("Review again")}
            </span>
          )}
          {status !== "pending" && (
            block.units.some((id) => state?.queued?.includes(id)) && status === "rejected"
              ? <span className="badge" title={t("Rejected; reverted when the agent stops")}>{t("Rejected · reverted when the agent stops")}</span>
              : <span className="badge" title={stateLabel(status)}>{stateLabel(status)}</span>
          )}
          <button
            className="link copy-reference"
            title={t(
              "Copy selected text with this change’s file, line numbers and PDF page",
            )}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => void copy(index)}
          >
            {t("Copy reference")}
          </button>
          <button
            className={`link source-toggle ${source ? "active" : ""}`}
            title={[t('Show LaTeX source'), shortcuts.source.map(bindingLabel).join(' / ')].filter(Boolean).join(' · ')}
            aria-keyshortcuts={shortcuts.source.join(' ')}
            aria-expanded={source}
            onClick={(event) => { event.stopPropagation(); toggleSource(index); }}
          >
            {block.units.length > 1
              ? t("{n} edits · LaTeX", { n: block.units.length })
              : "LaTeX"}
          </button>
        </header>
        {known.some((u) => u.history?.length) && (
          <div className="histories">
            {known
              .flatMap((u) => u.history ?? [])
              .map((h, i) => (
                <p key={i}>
                  <strong>
                    {t("Revised after your comment: ")}
                  </strong>
                  “{h.comment}”
                </p>
              ))}
          </div>
        )}
        {block.waiting && (
          <div
            className="comparison-waiting"
            data-state={
              detail?.rendering === "failed"
                ? "failed"
                : detail?.round !== state?.latest
                  ? "unavailable"
                  : detail?.rendering ?? "pending"
            }
          >
            <span className="comparison-waiting-message">
              {detail?.rendering !== "failed" && detail?.round === state?.latest && <span className="pulse" aria-hidden="true" />}
              {waitingLabel()}
            </span>
            {(detail?.rendering === "failed" || detail?.round !== state?.latest) && (
              <span className="comparison-notice-actions">
                {detail?.rendering === "failed" && canRetryComparison && (
                  <button
                    type="button"
                    className="comparison-action"
                    disabled={retryDisabled}
                    aria-busy={retryDisabled || undefined}
                    onClick={(event) => { event.stopPropagation(); void retryComparison(); }}
                  >
                    {t("Retry comparison")}
                  </button>
                )}
                {hasSourceText && (
                  <button
                    type="button"
                    className="comparison-action"
                    onClick={(event) => { event.stopPropagation(); toggleSource(index); }}
                  >
                    {sourceActionLabel(source)}
                  </button>
                )}
              </span>
            )}
          </div>
        )}
        {!block.identical &&
          !block.reflow &&
          displayBefore.length > 0 &&
          images(displayBefore, "before")}
        {displayAfter.length > 0 && images(displayAfter, "after")}
        {resolved === "mixed" && mixedPreview?.strips?.length && mixedPreview.files && (
          <div className="side after mixed-resolved" aria-label={t("After")}>
            {mixedPreview.strips.map((image) => (
              <PdfStrip
                key={image.src}
                image={image}
                base={mixedPreview.files!}
                label={t("After")}
                clean
              />
            ))}
          </div>
        )}
        {unavailableNotice && (
          <div className="comparison-notice" data-reason={unavailableNotice.reason}>
            <p className="comparison-notice-text">{unavailableNotice.message}</p>
            {unavailableNotice.sourceAction && (
              <span className="comparison-notice-actions">
                <button
                  type="button"
                  className="comparison-action"
                  onClick={(event) => { event.stopPropagation(); toggleSource(index); }}
                >
                  {sourceActionLabel(source)}
                </button>
              </span>
            )}
          </div>
        )}
        {block.reflow && (
          <p className="caption">
            {t("Continued: only line breaks moved here.")}
          </p>
        )}
        {remarks.length > 0 && (
          <div className="remark">
            {remarks.map((r, i) => (
              <p key={i}>
                <strong>{t("Your comment: ")}</strong>
                {r}
              </p>
            ))}
          </div>
        )}
        {uncited.length > 0 && (
          <p className="reference-problem reference-uncited">
            {uncited
              .map((m) => t("Cites {key}, which no bibliography entry defines.", { key: m.key }))
              .join(language().startsWith("zh") ? "" : " ")}
          </p>
        )}
        {bib.length > 0 && (
          <ReferenceEntries
            entries={bib}
            checks={references.checks}
            pending={references.pending > 0}
            onRetry={references.retry}
            confirmed={references.confirmed}
            onConfirm={(id, on) =>
              void references.confirm(id, on).catch((e) => setToast((e as Error).message))
            }
          />
        )}
        {source && (
          <div className="source">
            {known.map((unit) => (
              <div
                className="source-unit"
                data-state={decisions[unit.id]}
                key={unit.id}
              >
                <SourceEditor key={`${detail!.round}:${unit.id}`} task={task} round={detail!.round} change={unit.id} api={api}
                  editable={Boolean(!previewing && state?.sourceEditing && !changes && !pinned && unit.kind !== "binary")}
                  building={Boolean(state?.job && ["queued", "running"].includes(state.job.status))}
                  locked={!latest ? t("A newer round is available. Reload the page.") : decisions[unit.id] === "rejected" ? t("This change was rejected. Undo that decision before editing it.") : actionLock("source") || (waiting.has(unit.id) && detail!.rendering !== "failed" ? t("PDF comparison in progress") : null)}
                  onSaving={saving => { snapshot.current.busy = saving; setBusy(saving); }}
                  onOpen={() => offerSource([unit])}
                  onSaved={next => {
                    const article = paper.current?.querySelector<HTMLElement>(`[data-stop="${index}"]`);
                    editedPlace.current = { file: unit.file, line: unit.new_start, offset: article ? past(article) : 0, paper: paperView, inline: true };
                    epoch.current++; setState(next);
                  }}
                  title={<span className="source-location" title={unit.file}>
                    {unit.file.slice(unit.file.lastIndexOf("/") + 1)} ·{" "}
                    {t("lines {start}–{end}", {
                      start: unit.new_start,
                      end: unit.new_end,
                    })}
                  </span>}
                  actions={known.length > 1 && (
                    <span className="unit-actions">
                      <span className="unit-state">
                        {decisions[unit.id] !== "pending"
                          ? stateLabel(decisions[unit.id]).toLowerCase()
                          : ""}
                      </span>
                      {(changes || decisions[unit.id] === "pending") &&
                        kinds([unit.id]).map((kind) => (
                          <button
                            className={kind}
                            key={kind}
                            title={actionLock(kind) || label(kind)}
                            aria-describedby={
                              actionLock(kind) ? "review-lock" : undefined
                            }
                            disabled={
                              busy || !latest || Boolean(actionLock(kind))
                            }
                            onClick={(event) =>
                              kind === "comment"
                                ? beginComposer([unit.id])
                                : event.detail < 2 && void decide(kind, [unit.id])
                            }
                          >
                            {label(kind)}
                          </button>
                        ))}
                    </span>
                  )}>
                {unit.kind === "binary" ? (
                  <p>{t("Binary file changed.")}</p>
                ) : (
                  <pre className="source-code">
                    {wordDiff(unit.old_text, unit.new_text).map((part, i) =>
                      part.type === "del" ? (
                        <del key={i}>{part.text}</del>
                      ) : part.type === "ins" ? (
                        <ins key={i}>{part.text}</ins>
                      ) : (
                        <Fragment key={i}>{part.text}</Fragment>
                      ),
                    )}
                  </pre>
                )}
                {unit.truncated && (
                  <p className="muted">
                    {t("Long change: the source is shortened.")}
                  </p>
                )}
                </SourceEditor>
              </div>
            ))}
          </div>
        )}
        {blockEffects.map((u) => effects(u, Boolean(resolved)))}
      </article>
    );
  }
  const fullPaper = Boolean(detail?.pdf) && !detail?.sourceOnly && !detail?.rendering && placeable(placed),
    paperView = fullPaper && !paperUnavailable;
  // The comparisons of the next few undecided changes are fetched and decoded
  // ahead, so the next one is on screen the moment a decision moves on. A
  // small window keeps a phone's memory free.
  const preloaded = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    if (!detail || paperView) return;
    const decided = withQueued(state?.decisions ?? {}, queued), wanted: string[] = [];
    for (let step = 0, seen = 0; step < stops.length && seen < 4; step++) {
      const index = ((current < 0 ? 0 : current) + step) % stops.length, block = placed[index]?.block;
      if (!block || stops[index].waiting || !pendingUnits(stops[index], decided).length) continue;
      seen++;
      for (const image of [...(block.before ?? []), ...(block.after ?? [])]) wanted.push(detail.files + (focused ? image.clean : image.src));
      // The strips on the page load now too, rather than when the scroll
      // to them nears: the next change is complete the moment it is current.
      paper.current?.querySelectorAll<HTMLImageElement>(`[data-stop="${index}"] .pdf-strip img`).forEach((img) => { img.loading = "eager"; });
    }
    const keep = new Set(wanted);
    for (const url of [...preloaded.current.keys()]) if (!keep.has(url)) preloaded.current.delete(url);
    for (const url of wanted) {
      if (preloaded.current.has(url)) continue;
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      void image.decode().catch(() => undefined);
      preloaded.current.set(url, image);
    }
  }, [detail, stops, placed, current, queued, state?.decisions, focused, paperView]);
  // What the author reads now compiles first: the page says which view it
  // shows while it is on screen.
  useEffect(() => {
    if (changes || transport || !task) return;
    const mode = paperView ? "pdf" : "changes";
    // Only with the page's token, which the first state brings.
    const look = () => { if (!document.hidden && snapshot.current.state?.csrf) void api("/look", { mode }).catch(() => undefined); };
    look();
    const timer = setInterval(look, 5000);
    document.addEventListener("visibilitychange", look);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", look); };
  }, [task, paperView, changes, Boolean(state?.csrf)]);
  // A host shows its PDF navigation controls while the whole paper is shown,
  // and keeps their place while the round's comparison renders again.
  const paperPending = !paperView && !paperUnavailable && !detail?.sourceOnly
    && (detail?.rendering === "pending" || Boolean(state?.job && ["queued", "running"].includes(state.job.status)));
  useEffect(() => {
    const root = document.documentElement;
    if (paperView) root.dataset.fullPaper = "available";
    else if (paperPending) root.dataset.fullPaper = "pending";
    else delete root.dataset.fullPaper;
  }, [paperView, paperPending]);
  useEffect(() => {
    const root = document.documentElement;
    if (detail?.round) {
      root.dataset.papilotRound = String(detail.round);
      window.dispatchEvent(new Event("papilot:round"));
    } else delete root.dataset.papilotRound;
  }, [detail?.round]);
  // Keep the selected change in view when falling back from the full paper.
  const shownView = useRef(paperView);
  useEffect(() => {
    if (shownView.current === paperView) return;
    shownView.current = paperView;
    // FullPaper restores its own reading position after its pages are sized.
    if (paperView) return;
    requestAnimationFrame(() => {
      const article = paper.current?.querySelector<HTMLElement>(`[data-stop="${snapshot.current.current}"]`);
      if (article) reveal(article);
    });
  }, [paperView]);
  const navIndex = navigation.indexOf(current),
    activeStop = navIndex >= 0 ? current : (navigation[0] ?? -1),
    navPos = navIndex >= 0 ? navIndex + 1 : 1,
    prevStop = navIndex >= 0 ? adjacent(current, -1) : -1,
    nextStop = navIndex >= 0 ? adjacent(current, 1) : (navigation[1] ?? -1);
  let index = 0;
  return (
    <>
      <header className="bar">
        <div className="identity">
          <h1>{state?.title ?? "LaTeX Review"}</h1>
          <span className="muted">
            {changes
              ? t("Since the last commit")
              : detail
                ? (detail.round === state?.latest ? t("Current changes") : t("Earlier changes"))
                : ""}
          </span>
        </div>
        {!phoneDock && navigation.length > 0 && (
          <div className="change-nav" role="group" aria-label={t("Change map")}>
            <button
              type="button"
              className="ghost nav change-nav-prev"
              aria-label={t("Previous change")}
              aria-keyshortcuts={shortcuts.previous.join(' ')}
              title={[t('Previous change'), shortcuts.previous.map(bindingLabel).join(' / ')].filter(Boolean).join(' · ')}
              disabled={prevStop < 0}
              onClick={() => select(prevStop)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              className="ghost change-nav-position"
              title={t("Change {n}", { n: activeStop + 1 })}
              onClick={() => select(activeStop)}
            >
              <span>
                <span className="change-nav-full">{t("Change {n}", { n: navPos })}</span>
                <span className="change-nav-short" aria-hidden="true">{navPos}</span>
                <span className="change-nav-total"> / {navigation.length}</span>
              </span>
            </button>
            <button
              type="button"
              className="ghost nav change-nav-next"
              aria-label={t("Next change")}
              aria-keyshortcuts={shortcuts.next.join(' ')}
              title={[t('Next change'), shortcuts.next.map(bindingLabel).join(' / ')].filter(Boolean).join(' · ')}
              disabled={nextStop < 0}
              onClick={() => select(nextStop)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        )}
        <div className="bar-end">
          <ReviewProgress
            value={changes ? count.accepted : count.decided}
            total={changes ? count.accepted + count.pending : count.total}
            label={changes
              ? t("{staged} of {total} staged", {
                  staged: count.accepted,
                  total: count.accepted + count.pending,
                })
              : t("{decided} of {total} decided", {
                  decided: count.decided,
                  total: count.total,
                })}
          />
          {/* Batch decisions cover only undecided changes; accepted,
              rejected and commented changes keep their state. A single
              undecided change is decided from its own bar. */}
          {undecided.length > 1 && (batch.length > 0 || !changes) && (
            <div className="batch-decisions">
              {batch.length > 0 && (
                <button
                  type="button"
                  className="ghost accept accept-all"
                  disabled={
                    busy ||
                    !latest ||
                    Boolean(composer) ||
                    Boolean(state?.decisionLock)
                  }
                  title={
                    state?.decisionLock ||
                    [
                      changes
                        ? tn(
                            batch.length,
                            "Stage the {n} unstaged change.",
                            "Stage the {n} unstaged changes.",
                          )
                        : tn(
                            batch.length,
                            "Accept {n} undecided change",
                            "Accept {n} undecided changes",
                          ),
                      undecided.length > batch.length
                        ? tn(
                            undecided.length - batch.length,
                            "Leaves {n} change with bibliography entries to check.",
                            "Leaves {n} changes with bibliography entries to check.",
                          )
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")
                  }
                  aria-label={
                    changes
                      ? t("Stage all ({n})", { n: batch.length })
                      : t("Accept all ({n})", { n: batch.length })
                  }
                  aria-describedby={state?.decisionLock ? "review-lock" : undefined}
                  onClick={() => void decide("accept", batch)}
                >
                  <span className="batch-label">
                    {changes ? t("Stage all") : t("Accept all")}
                  </span>
                  <span className="batch-count">{batch.length}</span>
                </button>
              )}
              {!changes && (
                <button
                  type="button"
                  className="ghost reject reject-all"
                  disabled={
                    busy ||
                    !latest ||
                    Boolean(composer) ||
                    Boolean(lockOf(state, "reject"))
                  }
                  title={
                    actionLock("reject") ||
                    tn(
                      undecided.length,
                      "Reject {n} undecided change",
                      "Reject {n} undecided changes",
                    )
                  }
                  aria-label={t("Reject all ({n})", { n: undecided.length })}
                  aria-describedby={lockOf(state, "reject") ? "review-lock" : undefined}
                  onClick={() => void decide("reject", undecided)}
                >
                  <span className="batch-label">{t("Reject all")}</span>
                  <span className="batch-count">{undecided.length}</span>
                </button>
              )}
            </div>
          )}
          {/* "All decided" would repeat the meter's "N of N decided". */}
          {(!online ||
            state?.closed ||
            !["reviewing", "done"].includes(state?.state ?? "")) && (
            <span
              className="status"
              role="status"
              data-state={!online ? "offline" : state?.state}
            >
              {!online
                ? t("Reconnecting…")
                : state?.closed
                  ? t("Finished")
                  : state?.state === "building"
                    ? jobText(state.job)
                    : changes && state?.state === "build_failed"
                      ? t("Comparison failed")
                      : t(STATUS[state?.state ?? ""] ?? "")}
            </span>
          )}
          {/* Changes keep no history; the last revert can be undone. */}
          {changes && state?.undo && (
            <button
              type="button"
              className="ghost undo"
              disabled={!latest || busy || Boolean(lockOf(state, undoKind(state)))}
              title={actionLock(undoKind(state)) || [t('Undo revert'), shortcuts.undo.map(bindingLabel).join(' / ')].filter(Boolean).join(' · ')}
              aria-keyshortcuts={shortcuts.undo.join(' ')}
              onClick={() => void undo()}
            >
              {t("Undo revert")}
            </button>
          )}
          <button
            type="button"
            className="ghost round"
            aria-label={t("Keyboard shortcuts")}
            onClick={showHelp}
          >
            ?
          </button>
        </div>
      </header>
      {detail && history && (
        <nav className="review-mode" aria-label={t("Review view")}>
          <label>
            {t("History")}{" "}
            <select
              aria-label={t("Review history")}
              value={detail.round}
              onChange={(e) => {
                location.href = withLanguage(
                  `?task=${encodeURIComponent(task)}&round=${e.target.value}&history=1`,
                );
              }}
            >
              {Array.from(
                { length: state?.latest || detail.round },
                (_, i) => i + 1,
              )
                .reverse()
                .map((round) => (
                  <option key={round} value={round}>
                    {round === state?.latest ? t("Current changes") : (() => {
                      const published = state?.history?.find(entry => entry.number === round)?.created;
                      return published ? new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "medium" }).format(new Date(published * 1000)) : t("Earlier changes");
                    })()}
                  </option>
                ))}
            </select>
          </label>
          {state?.undo && (
            <button
              className="ghost undo"
              disabled={!latest || busy || Boolean(lockOf(state, undoKind(state)))}
              title={
                actionLock(undoKind(state)) ||
                t("Undo {action} · {changes}", {
                  action: t(
                    ACTION[state.undo.kind] ?? state.undo.kind,
                  ).toLowerCase(),
                  changes: tn(
                    undoChanges.length,
                    "Change {list}",
                    "Changes {list}",
                    { list: undoChanges.join(", ") },
                  ),
                })
              }
              onClick={() => void undo()}
            >
              {t("Undo last decision")}
            </button>
          )}
          <button
            className="ghost"
            onClick={() => {
              if (pinned)
                location.href = withLanguage(
                  `?task=${encodeURIComponent(task)}`,
                );
              else {
                setHistory(false);
                setCurrent(nextPending(stops, decisions, -1, focused));
              }
            }}
          >
            {t("Back to review")}
          </button>
        </nav>
      )}
      <div className="review-body">
        <main id="paper" ref={paper} tabIndex={-1} onScroll={onScroll}>
          {changes && detail && !count.pending && (count.accepted > 0 || !stops.length) && (
            <div className="review-complete" role="status" tabIndex={-1}>
              <strong>
                {count.accepted
                  ? t("All changes are staged")
                  : t("No uncommitted changes")}
              </strong>
              <span>
                {count.accepted
                  ? t("Commit them when you are ready.")
                  : t("The PDF matches the last commit.")}
              </span>
              <div className="review-complete-actions" />
            </div>
          )}
          {!changes && detail && !history && !count.pending && (
            <div className="review-complete" role="status" tabIndex={-1}>
              <strong>
                {t(
                  state?.workspace?.status === "waiting_input"
                    ? "Agent needs your input"
                    : state?.workspace?.status === "queued"
                      ? "Feedback queued"
                      : state?.workspace?.status === "running"
                        ? "Feedback sent · Agent is working"
                        : state?.workspace?.status === "building" ||
                            state?.state === "building"
                          ? "Preparing the next review…"
                          : state?.workspace?.merging ? "Merge review" : "All changes reviewed",
                )}
              </strong>
              {/* What the decisions leave to do is known once the host has
                  them all; until then the line stays empty, never stale. */}
              <span>
                {!settling && t(
                  state?.workspace?.status === "waiting_input"
                    ? "Open Chat to answer the agent's question."
                    : ["running", "queued", "building"].includes(
                          state?.workspace?.status || "",
                        ) || state?.state === "building"
                      ? "New changes will appear here when ready."
                      : state?.workspace?.merging
                        ? "Your manuscript is unchanged until you save the merged result."
                        : state?.workspace?.comments
                        ? "Your comments are saved. Continue in Chat to request a revision."
                        : state?.workspace?.deferred
                          ? state.workspace.accepted
                            ? "Choose how to save the accepted changes to your manuscript."
                            : state.workspace.destination === "branch"
                              ? "Choose how to save the accepted changes to your manuscript."
                              : (state.workspace.destination === "workspace" || state.workspace.destination === "commit")
                                ? "Accepted changes are in your manuscript."
                                : "There are no accepted changes to save."
                        : state?.workspace?.accepted
                          ? "Accepted changes are in your manuscript."
                          : state?.workspace?.unsent && !count.accepted
                            ? "Your decisions are saved. Send them to the agent to continue."
                            : count.commented && !state?.workspace
                              ? "Your comments are saved for the agent."
                              : "There are no new changes to review. Previous decisions are available in History.",
                )}
              </span>
              {/* A host such as Papilot puts its next step here, for example a commit. */}
              <button
                type="button"
                className="ghost history"
                title={t("Review history")}
                onClick={() => {
                  setHistory(true);
                  if (current < 0 && stops.length) setCurrent(0);
                }}
              >
                {t("History")}
              </button>
              <div className="review-complete-actions" />
            </div>
          )}
          {(state?.commentLock || state?.decisionLock || state?.rejectLock) && (
            <div className="banner" id="review-lock" role="status">
              {t((state.commentLock || state.decisionLock || state.rejectLock)!)}
            </div>
          )}
          {state?.closed && !state.commentLock && (
            <div className="banner">
              {t(
                "This review is finished. Accepted changes are in your manuscript.",
              )}
            </div>
          )}
          {state?.state === "build_failed" && (
            <div className="banner">
              <strong>
                {changes
                  ? t("The comparison could not be built: ")
                  : t("The latest publish failed: ")}
              </strong>
              {state.job?.error}
              {state.job?.details && (
                <pre className="details">{state.job.details.join("\n")}</pre>
              )}
            </div>
          )}
          {state?.state === "building" && detail && !state.decisionLock && (
            <div className="banner">
              {changes
                ? t(
                    "Updating the comparison with your latest edits. You can keep staging and reverting meanwhile.",
                  )
                : t(
                    "Updating changes…",
                  )}
            </div>
          )}
          {!changes && detail && state?.latest && detail.round !== state.latest && (
            <div className="banner">
              {t("Viewing earlier changes.")}{" "}
              <a href={withLanguage(`?task=${encodeURIComponent(task)}`)}>
                {t("Back to current changes →")}
              </a>
            </div>
          )}
          {detail?.warnings.length ? (
            <div className="banner">
              <details>
                <summary>
                  {tn(
                    detail.warnings.length,
                    "{n} new LaTeX warning",
                    "{n} new LaTeX warnings",
                  )}
                </summary>
                <pre className="details">{detail.warnings.join("\n")}</pre>
              </details>
            </div>
          ) : null}
          {detail?.revisedErrors?.length && !paperView ? (
            <CompilationErrors title={t("The revised text has compilation errors.")} errors={detail.revisedErrors} />
          ) : null}
          {detail?.baselineErrors?.length ? (
            <CompilationErrors
              title={detail.sourceOnly ? t("No PDF comparison: the text before these changes could not be compiled.") : t("The text before these changes has compilation errors. Its pages show what LaTeX typeset after skipping them.")}
              errors={detail.baselineErrors}
              action={detail.sourceOnly && canRetryComparison ? (
                <button
                  type="button"
                  className="comparison-action"
                  disabled={retryDisabled}
                  aria-busy={retryDisabled || undefined}
                  onClick={() => void retryComparison()}
                >
                  {t("Retry comparison")}
                </button>
              ) : undefined}
            />
          ) : null}
          {detail?.references &&
            (detail.references.entries.length > 0 ||
              detail.references.missing.length > 0) && (
              <ReferenceBanner
                references={detail.references}
                checks={references.checks}
                pending={references.pending}
                confirmed={references.confirmed}
                changeOf={(unit) => (unit ? (firstStop.get(unit) ?? -1) : -1)}
                onSelect={(index) => select(index)}
                onRetry={references.retry}
              />
            )}
          <div className="document">
            {detail && paperView ? (
              <>
                <Suspense fallback={<div className="paper-status" role="status"><div className="pulse" /></div>}>
                <FullPaper
                  key={`${placeKey}:pdf:${detail.round}:${detail.pdf}`}
                  url={detail.pdf!}
                  passes={detail.passes}
                  errors={detail.revisedErrors}
                  changes={placed}
                  render={(block, at) => change(block, at, true)}
                  scrollRoot={paper}
                  place={`${placeKey}:pdf:${detail.round}`}
                  restorePlace={linkedChange < 0}
                  onReady={restored => {
                    if (restored) return;
                    const article = paper.current?.querySelector<HTMLElement>(
                      `[data-stop="${snapshot.current.current}"]`,
                    );
                    if (article) reveal(article);
                  }}
                  onUnavailable={() => setPaperUnavailable(true)}
                />
                </Suspense>
                {!stops.length && !changes && (
                  <p className="empty">{t("No changes to review.")}</p>
                )}
              </>
            ) : detail ? (
              <>
                {detail.sections.map((section) => (
                  <section className="part" key={section.node}>
                    <h2 className="part-title">
                      <span className="number">{section.number}</span>
                      {section.title}
                    </h2>
                    <div className="sheet">
                      {section.blocks.map((block, b) =>
                        block.kind === "context" ? (
                          <div className="context" key={`context-${b}`}>
                            <PdfStrip
                              image={block.image}
                              base={detail.files}
                              label={t("Unchanged text")}
                            />
                          </div>
                        ) : block.kind === "gap" ? (
                          <div
                            className="fold"
                            key={`gap-${b}`}
                            title={t("Unchanged text is folded")}
                          >
                            ⋯
                          </div>
                        ) : (
                          change(block, index++, true)
                        ),
                      )}
                    </div>
                  </section>
                ))}
                {detail.loose.length > 0 && (
                  <section className="part">
                    {detail.sections.length > 0 && (
                      <h2 className="part-title">{t("Other changes")}</h2>
                    )}
                    {detail.loose.map((block) => change(block, index++, false))}
                  </section>
                )}
                {!stops.length && !changes && (
                  <p className="empty">{t("No changes to review.")}</p>
                )}
              </>
            ) : error ? (
              <p className="empty" role="alert">
                {error}
              </p>
            ) : (
              <div className="waiting">
                <div className="pulse" />
                <p>
                  {state?.state === "building"
                    ? jobText(state.job)
                    : changes
                      ? t("Comparing with the last commit…")
                      : t("Waiting for the agent to publish its changes.")}
                </p>
                <p className="muted">{t("This page updates by itself.")}</p>
              </div>
            )}
          </div>
        </main>
        <ChangeMap
          scrollRoot={paper}
          stops={stops}
          showReviewed={browsing}
          locations={locations}
          decisions={decisions}
          current={current}
          disabled={Boolean(composer)}
          onSelect={select}
        />
      </div>
      {composer && (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submitComposer();
          }}
        >
          <div className="composer-head">
            <label htmlFor="composer-text">
              {t("Comment on change {n}", { n: composer.stop + 1 })}
            </label>
            <button
              type="button"
              className="composer-close"
              aria-label={t("Cancel")}
              title={t("Cancel")}
              onClick={() => closeComposer()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <textarea
            id="composer-text"
            ref={fitComposer}
            autoFocus
            rows={3}
            value={draft}
            onKeyDown={(event) => {
              if (sendsMessage(event.nativeEvent, window.matchMedia('(pointer: coarse)').matches)) {
                event.preventDefault();
                void submitComposer();
              }
            }}
            onChange={(e) => {
              setDraft(e.target.value);
              store(composer.key, e.target.value);
              fitComposer(e.target);
            }}
            placeholder={t("What should the agent change here?")}
          />
          <div className="composer-row">
            <span className="muted">{t("↵ send · Esc cancel")}</span>
            <button
              type="submit"
              className="composer-send"
              aria-label={t("Send")}
              title={state?.commentLock ? t(state.commentLock) : t("Send")}
              aria-describedby={state?.commentLock ? "review-lock" : undefined}
              disabled={busy || !draft.trim() || Boolean(state?.commentLock)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5m-7 7 7-7 7 7" />
              </svg>
            </button>
          </div>
        </form>
      )}
      {toast && (
        <div className="toast" role="alert">
          {toast}
        </div>
      )}
      {confirm && (
        <ConfirmReferences
          items={confirm.items}
          staging={changes}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const chosen = confirm;
            setConfirm(null);
            void decide(chosen.kind, chosen.chosen, chosen.body, true);
          }}
        />
      )}
      {help && (
        <div className="help-backdrop" onClick={() => setHelp(false)}>
          <dialog
            open
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="help-title">{t("Keyboard shortcuts")}</h2>
            <dl>
              {(changes
                ? [
                    [shortcuts.accept.map(bindingLabel).join(' / '), "Stage or unstage"],
                    [shortcuts.reject.map(bindingLabel).join(' / '), "Revert"],
                    [shortcuts.next.map(bindingLabel).join(' / '), "Next change"],
                    [shortcuts.previous.map(bindingLabel).join(' / '), "Previous change"],
                    [shortcuts.pending.map(bindingLabel).join(' / '), "Next unstaged"],
                    [shortcuts.source.map(bindingLabel).join(' / '), "Show LaTeX source"],
                    [["⌘Z / Ctrl+Z", ...shortcuts.undo.map(bindingLabel)].join(' / '), "Undo revert"],
                    ["⌘C / Ctrl+C", "Copy selected PDF text"],
                  ]
                : [
                    [shortcuts.accept.map(bindingLabel).join(' / '), "Accept"],
                    [shortcuts.reject.map(bindingLabel).join(' / '), "Reject"],
                    [shortcuts.comment.map(bindingLabel).join(' / '), "Comment"],
                    [shortcuts.next.map(bindingLabel).join(' / '), "Next change"],
                    [shortcuts.previous.map(bindingLabel).join(' / '), "Previous change"],
                    [shortcuts.pending.map(bindingLabel).join(' / '), "Next undecided"],
                    [shortcuts.source.map(bindingLabel).join(' / '), "Show LaTeX source"],
                    [["⌘Z / Ctrl+Z", ...shortcuts.undo.map(bindingLabel)].join(' / '), "Undo"],
                    ["⌘C / Ctrl+C", "Copy selected PDF text"],
                  ]
              ).map(([key, label]) => (
                <Fragment key={label}>
                  <dt>
                    <kbd>{t(key)}</kbd>
                  </dt>
                  <dd>{t(label)}</dd>
                </Fragment>
              ))}
            </dl>
            <p className="muted">
              {t(
                "Select text directly in the PDF preview. Copy reference includes the selection and its file, line numbers and page. Review shortcuts pause while text is selected.",
              )}
            </p>
            <button onClick={() => setHelp(false)}>{t("Close")}</button>
          </dialog>
        </div>
      )}
    </>
  );
}
