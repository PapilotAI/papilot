import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ActionKind,
  ChangeBlock,
  PageState,
  RoundDetail,
  Strip,
  Unit,
  VisualUnit,
} from "../types.ts";
import { PdfStrip } from "./PdfStrip.tsx";
import { ChangeMap } from "./ChangeMap.tsx";
import { STATUS } from "./overview.tsx";
import { t, tn, withLanguage } from "./i18n.ts";
import {
  STATE,
  buildStops,
  copyReference,
  describeLocation,
  nextPending,
  pendingUnits,
  progress,
  resolvedSide,
  stopState,
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
function jobText(job: PageState["job"]) {
  return job?.status === "queued"
    ? job.ahead
      ? tn(
          job.ahead,
          "Queued behind {n} other round…",
          "Queued behind {n} other rounds…",
        )
      : t("Queued…")
    : `${t(PHASE[job?.phase ?? ""] || "Starting")}…`;
}
export function ReviewApp({
  task,
  pinned,
  changes = false,
}: {
  task: string;
  pinned: number | null;
  changes?: boolean;
}) {
  const [state, setState] = useState<PageState | null>(null),
    [detail, setDetail] = useState<RoundDetail | null>(null),
    [current, setCurrent] = useState(-1),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [openSource, setOpenSource] = useState<Set<number>>(new Set()),
    [composer, setComposer] = useState<Composer | null>(null),
    [draft, setDraft] = useState(""),
    [help, setHelp] = useState(false),
    [history, setHistory] = useState(
      Boolean(pinned) || new URLSearchParams(location.search).has("history"),
    );
  const paper = useRef<HTMLElement>(null),
    epoch = useRef(0),
    scrollUntil = useRef(0),
    snapshot = useRef({ state, detail, busy, composer, current });
  snapshot.current = { state, detail, busy, composer, current };
  const units = useMemo(
      () => new Map(detail?.units.map((u) => [u.id, u]) ?? []),
      [detail],
    ),
    stops = useMemo(() => (detail ? buildStops(detail) : []), [detail]),
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
    decisions = state?.decisions ?? {},
    count = progress(decisions),
    undecided = Object.keys(decisions).filter(
      (id) => decisions[id] === "pending",
    ),
    latest = Boolean(
      detail && state && detail.round === state.latest && !state.closed,
    ),
    browsing = history || changes,
    label = (kind: string) => t((changes ? CHANGE_ACTION : ACTION)[kind] ?? kind),
    stateLabel = (value: string) =>
      t((changes ? CHANGE_STATE : STATE)[value] ?? value);
  // What each button acts on: undecided changes, or in changes mode the
  // staged ones for Unstage and every change still on disk for Revert.
  const targets = (units: string[], kind: Kind) =>
    units.filter((id) =>
      kind === "unstage"
        ? decisions[id] === "accepted"
        : changes && kind === "reject"
          ? ["pending", "accepted"].includes(decisions[id])
          : decisions[id] === "pending",
    );
  const kinds = (units: string[]): Kind[] =>
    !changes
      ? ["accept", "reject", "comment"]
      : targets(units, "accept").length
        ? ["accept", "reject"]
        : targets(units, "unstage").length
          ? ["unstage", "reject"]
          : [];
  const navigation = stops
    .map((stop, index) => ({ stop, index }))
    .filter(({ stop }) => browsing || pendingUnits(stop, decisions).length)
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
  }, [decisions, history, composer, detail]);
  useEffect(() => {
    if (changes && current < 0 && stops.length)
      setCurrent(Math.max(nextPending(stops, decisions), 0));
  }, [detail]);
  // Lock reasons come from the host in English; known ones are translated.
  const actionLock = (kind: Kind) => {
    const reason =
      kind === "comment" ? state?.commentLock : state?.decisionLock;
    return reason ? t(reason) : reason;
  };
  function blocked(kind: Kind): boolean {
    const current = snapshot.current.state;
    const reason =
      kind === "comment" ? current?.commentLock : current?.decisionLock;
    if (reason) setToast(t(reason));
    return Boolean(reason);
  }
  async function api<T>(route: string, body?: unknown): Promise<T> {
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
    );
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
    return value as T;
  }
  function select(index: number, scroll = true) {
    if (index < 0 || index >= stops.length) return;
    setCurrent(index);
    store(`latex-review:${task}`, {
      round: detail?.round,
      stop: stops[index].key,
    });
    if (scroll) {
      scrollUntil.current = Date.now() + 800;
      requestAnimationFrame(() => {
        const article = paper.current?.querySelector<HTMLElement>(
          `[data-stop="${index}"]`,
        );
        article?.scrollIntoView({ block: "start", behavior: "smooth" });
        article?.focus({ preventScroll: true });
      });
    }
  }
  useEffect(() => {
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const requestedEpoch = epoch.current;
      try {
        const previous = snapshot.current,
          number = pinned || previous.detail?.round,
          next = await api<PageState>(
            `/state${number ? `?round=${number}` : ""}`,
          );
        if (
          cancelled ||
          epoch.current !== requestedEpoch ||
          snapshot.current.busy
        )
          return;
        setOnline(true);
        setError("");
        const target = pinned || next.latest;
        if (
          target &&
          (target !== previous.detail?.round ||
            (next.revision && next.revision !== previous.detail?.after)) &&
          !snapshot.current.composer
        ) {
          const [loadedState, loaded] = await Promise.all([
            api<PageState>(`/state?round=${target}`),
            api<RoundDetail>(`/rounds/${target}`),
          ]);
          if (
            cancelled ||
            epoch.current !== requestedEpoch ||
            snapshot.current.busy
          )
            return;
          const nextStops = buildStops(loaded),
            saved = readStorage<{ round?: number; stop?: string }>(
              `latex-review:${task}`,
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
          if (index < 0) index = pinned && nextStops.length ? 0 : -1;
          if (
            previous.detail &&
            loaded.round !== previous.detail.round &&
            !pinned
          )
            setHistory(false);
          setState(loadedState);
          setDetail(loaded);
          setCurrent(index);
          setOpenSource(new Set());
          if (previous.detail)
            setToast(t("Round {round} is ready", { round: target }));
        } else setState(next);
      } catch (e) {
        if (!cancelled) {
          setOnline(false);
          setError((e as Error).message);
        }
      } finally {
        if (!cancelled)
          timer = setTimeout(poll, document.hidden ? 10000 : 1500);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [task, pinned]);
  useEffect(() => {
    if (detail && current >= 0)
      requestAnimationFrame(() =>
        paper.current
          ?.querySelector<HTMLElement>(`[data-stop="${current}"]`)
          ?.scrollIntoView({ block: "start" }),
      );
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
  function beginComposer(changes = pendingUnits(stops[current], decisions)) {
    if (
      !latest ||
      !changes.length ||
      busy ||
      state?.closed ||
      blocked("comment")
    )
      return;
    const key = `latex-review:${task}:draft:${detail?.round}:${changes.join(",")}`;
    setDraft(readStorage(key, ""));
    setComposer({ changes, stop: current, key });
  }
  function closeComposer(sent = false) {
    if (composer) store(composer.key, sent ? "" : draft);
    setComposer(null);
  }
  async function decide(
    kind: Kind,
    chosen = targets(stops[current]?.units ?? [], kind),
    body = "",
  ) {
    if (
      !chosen.length ||
      snapshot.current.busy ||
      !latest ||
      !detail ||
      blocked(kind)
    )
      return;
    epoch.current++;
    setBusy(true);
    snapshot.current.busy = true;
    try {
      const next = await api<PageState>("/decide", {
        id: crypto.randomUUID(),
        action: kind,
        round: detail.round,
        changes: chosen,
        body,
      });
      setState(next);
      // The host refreshes what depends on the decision, such as Git status.
      window.dispatchEvent(new CustomEvent("latex-review:decided"));
      if (kind === "comment") closeComposer(true);
      const target = pendingUnits(stops[current], next.decisions).length
        ? current
        : nextPending(stops, next.decisions, current);
      if (target >= 0 && target !== current) select(target);
      if (target < 0) {
        if (!browsing) setCurrent(-1);
        setToast(
          changes
            ? kind === "accept"
              ? t("All changes are staged.")
              : ""
            : t("All changes reviewed. Your decisions are saved."),
        );
      }
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      epoch.current++;
      setBusy(false);
      snapshot.current.busy = false;
    }
  }
  async function undo() {
    if (!state?.undo || !latest || snapshot.current.busy || blocked("accept"))
      return;
    epoch.current++;
    setBusy(true);
    snapshot.current.busy = true;
    try {
      const next = await api<PageState & { restored: string[] }>("/undo", {
        id: state.undo.id,
      });
      setState(next);
      window.dispatchEvent(new CustomEvent("latex-review:decided"));
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
  async function submitComposer() {
    if (!composer || !draft.trim() || busy) return;
    await decide("comment", composer.changes, draft.trim());
  }
  function toggleSource(index: number) {
    setOpenSource((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }
  async function copy(index: number) {
    if (!detail || !state) return;
    const selected = window.getSelection()?.toString().trim() ?? "",
      known = stops[index].units.map((id) => units.get(id)!).filter(Boolean);
    try {
      await navigator.clipboard.writeText(
        copyReference(
          state.title,
          detail.round,
          index + 1,
          describeLocation(known),
          selected,
        ),
      );
      setToast(
        selected
          ? t("Copied selected text with file, lines and PDF page.")
          : t("Copied the change location."),
      );
    } catch (e) {
      setToast(
        t(
          "Clipboard unavailable. Select the PDF text and use your browser’s Copy command.",
        ),
      );
    }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement,
        typing =
          target.matches("input,textarea,select") || target.isContentEditable;
      if (event.key === "Escape") {
        if (help) setHelp(false);
        else if (composer) closeComposer();
        return;
      }
      if (
        composer &&
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter"
      ) {
        event.preventDefault();
        void submitComposer();
        return;
      }
      if (typing || help) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undo();
        return;
      }
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        composer ||
        window.getSelection()?.toString()
      )
        return;
      const key = event.key.toLowerCase();
      if (
        [
          "a",
          "r",
          "c",
          "j",
          "k",
          "arrowright",
          "arrowleft",
          "n",
          "s",
          "u",
          "?",
        ].includes(key)
      )
        event.preventDefault();
      if (key === "a")
        void decide(kinds(stops[current]?.units ?? [])[0] ?? "accept");
      else if (key === "r") void decide("reject");
      else if (key === "c" && !changes) beginComposer();
      else if (key === "j" || key === "arrowright")
        select(adjacent(current, 1));
      else if (key === "k" || key === "arrowleft")
        select(adjacent(current, -1));
      else if (key === "n") select(nextPending(stops, decisions, current));
      else if (key === "s") toggleSource(current);
      else if (key === "u") void undo();
      else if (key === "?") setHelp(true);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [state, detail, current, busy, composer, draft, help, history]);
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
    if (index !== current) select(index, false);
  }
  const actionBar = (index: number) => {
    if (index !== current || !state) return null;
    const units = stops[index].units,
      available = kinds(units),
      remaining = nextPending(stops, decisions);
    return (
      <div className="dock">
        <nav className="actions" aria-label={t("Review the current change")}>
          {navigation.length > 1 && (
            <>
              <button
                className="nav"
                aria-label={t("Previous change")}
                aria-keyshortcuts="k ArrowLeft"
                title={t("Previous change (K or ←)")}
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
          {available.length ? (
            <>
              {available.map((kind) => {
                const key = kind === "unstage" ? "a" : kind[0],
                  count = targets(units, kind).length;
                return (
                  <button
                    className={kind}
                    key={kind}
                    aria-keyshortcuts={key}
                    title={
                      actionLock(kind) ||
                      `${label(kind)} (${key.toUpperCase()})`
                    }
                    aria-describedby={
                      actionLock(kind) ? "review-lock" : undefined
                    }
                    disabled={busy || !latest || Boolean(actionLock(kind))}
                    onClick={() =>
                      kind === "comment" ? beginComposer() : void decide(kind)
                    }
                  >
                    {label(kind)}
                    {count > 1 && kind !== "comment" ? ` (${count})` : ""}
                  </button>
                );
              })}
            </>
          ) : remaining >= 0 ? (
            <button
              className="skip"
              aria-keyshortcuts="n"
              onClick={() => select(nextPending(stops, decisions, current))}
            >
              {changes ? t("Next unstaged") : t("Next undecided")}
            </button>
          ) : (
            <span className="complete">
              {changes
                ? stateLabel(stopState(units, decisions))
                : latest
                  ? t("Review complete")
                  : t("Earlier round")}
            </span>
          )}
          {navigation.length > 1 && (
            <button
              className="nav"
              aria-label={t("Next change")}
              aria-keyshortcuts="j ArrowRight"
              title={t("Next change (J or →)")}
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
  function change(
    block: ChangeBlock,
    index: number,
    inline: boolean,
  ): ReactNode {
    const known = block.units.map((id) => units.get(id)!).filter(Boolean),
      status = stopState(block.units, decisions),
      reviewed = !pendingUnits(stops[index], decisions).length,
      // A reverted change shows the text that is back on disk; staged and
      // unstaged ones keep their before and after.
      resolved = history
        ? undefined
        : changes
          ? status === "rejected"
            ? "before"
            : undefined
          : resolvedSide(block.units, decisions) ||
            (status === "commented" ? "after" : undefined),
      source =
        openSource.has(index) ||
        block.identical ||
        (!block.before.length && !block.after.length),
      remarks = [
        ...new Set(
          block.units.map((id) => state?.comments[id]).filter(Boolean),
        ),
      ],
      location = describeLocation(known, t),
      kindLabel = block.reflow
        ? t("Reflow")
        : [...new Set(known.map((u) => u.visual ?? "unmapped"))]
            .filter((kind) => kind !== "text")
            .map((kind) => t(KIND[kind]))
            .join(", ");
    const images = (items: Strip[], side: "before" | "after") => (
      <div
        className={`side ${side}${block.identical ? " identical" : ""}`}
        aria-label={side === "before" ? t("Before") : t("After")}
      >
        {items.map((image) => (
          <PdfStrip
            key={image.src}
            image={image}
            base={detail!.files}
            label={side === "before" ? t("Before") : t("After")}
            clean={Boolean(resolved)}
          />
        ))}
      </div>
    );
    return (
      <article
        key={index}
        className={`change ${inline ? "inline" : "standalone"}${current === index ? " current" : ""}${reviewed && !browsing ? " reviewed-change" : ""}${reviewed && !browsing && !resolved ? " mixed-reviewed" : ""}`}
        data-stop={index}
        data-state={status}
        data-resolved={resolved}
        tabIndex={-1}
        onClick={() => {
          if (index !== current && !composer && (browsing || !reviewed))
            select(index, false);
        }}
      >
        {reviewed && !browsing && !resolved && (
          <p className="reviewed-placeholder">
            <button
              className="link"
              onClick={() => {
                setHistory(true);
                select(index, false);
              }}
            >
              {t("Reviewed changes · View in History")}
            </button>
          </p>
        )}
        <header className="change-head">
          {/* The English number and location are kept for tools that quote
              them to an agent, whatever the interface language. */}
          <span className="change-number" data-change={index + 1}>
            {t("Change {n}", { n: index + 1 })}
          </span>
          <span
            className="change-where"
            title={location}
            data-location={describeLocation(known)}
          >
            {location}
          </span>
          {actionBar(index)}
          {kindLabel && <span className="change-kind">{kindLabel}</span>}
          {status !== "pending" && (
            <span className="badge">{stateLabel(status)}</span>
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
            className={`link ${source ? "active" : ""}`}
            title={t("Show the LaTeX source (S)")}
            onClick={() => toggleSource(index)}
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
                    {t("Revised after your comment in round {round}: ", {
                      round: h.round,
                    })}
                  </strong>
                  “{h.comment}”
                </p>
              ))}
          </div>
        )}
        {!block.identical &&
          !block.reflow &&
          block.before.length > 0 &&
          images(block.before, "before")}
        {block.after.length > 0 && images(block.after, "after")}
        {block.identical && (
          <p className="caption">
            {t("No visible change in the PDF; see the LaTeX source.")}
          </p>
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
        {source && (
          <div className="source">
            {known.map((unit) => (
              <div
                className="source-unit"
                data-state={decisions[unit.id]}
                key={unit.id}
              >
                <div className="source-title">
                  <span>
                    {unit.file} ·{" "}
                    {t("lines {start}–{end}", {
                      start: unit.new_start,
                      end: unit.new_end,
                    })}
                  </span>
                  {known.length > 1 && (
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
                            title={actionLock(kind) || undefined}
                            aria-describedby={
                              actionLock(kind) ? "review-lock" : undefined
                            }
                            disabled={
                              busy || !latest || Boolean(actionLock(kind))
                            }
                            onClick={() =>
                              kind === "comment"
                                ? beginComposer([unit.id])
                                : void decide(kind, [unit.id])
                            }
                          >
                            {label(kind)}
                          </button>
                        ))}
                    </span>
                  )}
                </div>
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
              </div>
            ))}
          </div>
        )}
      </article>
    );
  }
  let index = 0;
  return (
    <>
      <header className="bar">
        <a className="ghost overview-link" href={withLanguage("/")}>
          ← {t("All reviews")}
        </a>
        <div className="identity">
          <h1>{state?.title ?? "LaTeX Review"}</h1>
          <span className="muted">
            {changes
              ? t("Since the last commit")
              : detail
                ? t("Round {round}", { round: detail.round }) +
                  (detail.round !== state?.latest ? t(" (earlier round)") : "")
                : ""}
          </span>
        </div>
        {count.total > 0 && (
          <div className="meter">
            <span>
              {changes
                ? t("{staged} of {total} staged", {
                    staged: count.accepted,
                    total: count.accepted + count.pending,
                  })
                : t("{decided} of {total} decided", {
                    decided: count.decided,
                    total: count.total,
                  })}
            </span>
          </div>
        )}
        <div className="bar-end">
          {/* Batch decisions cover only undecided changes; accepted,
              rejected and commented changes keep their state. A single
              undecided change is decided from its own bar. */}
          {count.pending > 1 && (
            <button
              className="ghost accept accept-all"
              disabled={
                busy ||
                !latest ||
                Boolean(composer) ||
                Boolean(state?.decisionLock)
              }
              title={
                state?.decisionLock ||
                (changes
                  ? tn(
                      count.pending,
                      "Stage the {n} unstaged change.",
                      "Stage the {n} unstaged changes.",
                    )
                  : tn(
                      count.pending,
                      "Accept the {n} undecided change in this round. Decided and commented changes stay as they are. Undo reverses the whole batch.",
                      "Accept the {n} undecided changes in this round. Decided and commented changes stay as they are. Undo reverses the whole batch.",
                    ))
              }
              aria-label={
                changes
                  ? t("Stage all ({n})", { n: count.pending })
                  : t("Accept all ({n})", { n: count.pending })
              }
              aria-describedby={state?.decisionLock ? "review-lock" : undefined}
              onClick={() => void decide("accept", undecided)}
            >
              <span className="batch-label">
                {changes ? t("Stage all") : t("Accept all")}
              </span>
              <span className="batch-count">{count.pending}</span>
            </button>
          )}
          {count.pending > 1 && !changes && (
            <button
              className="ghost reject reject-all"
              disabled={
                busy ||
                !latest ||
                Boolean(composer) ||
                Boolean(state?.decisionLock)
              }
              title={
                state?.decisionLock ||
                tn(
                  count.pending,
                  "Reject the {n} undecided change in this round. Decided and commented changes stay as they are. Undo reverses the whole batch.",
                  "Reject the {n} undecided changes in this round. Decided and commented changes stay as they are. Undo reverses the whole batch.",
                )
              }
              aria-label={t("Reject all ({n})", { n: count.pending })}
              aria-describedby={state?.decisionLock ? "review-lock" : undefined}
              onClick={() => void decide("reject", undecided)}
            >
              <span className="batch-label">{t("Reject all")}</span>
              <span className="batch-count">{count.pending}</span>
            </button>
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
              className="ghost undo"
              disabled={!latest || busy || Boolean(state.decisionLock)}
              title={state.decisionLock || t("Put back what the last revert removed (U)")}
              onClick={() => void undo()}
            >
              {t("Undo revert")}
            </button>
          )}
          {/* History is a toolbar action; its own row appears only while
              browsing earlier decisions. */}
          {detail && !history && !changes && (
            <button
              className="ghost history"
              title={t("Earlier decisions and rounds")}
              onClick={() => {
                setHistory(true);
                if (current < 0 && stops.length) setCurrent(0);
              }}
            >
              {t("History")}
            </button>
          )}
          <button
            className="ghost round"
            aria-label={t("Keyboard shortcuts")}
            onClick={() => setHelp(true)}
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
              aria-label={t("Review round")}
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
                    {t("Round {round}", { round })}
                    {round === state?.latest ? t(" (latest)") : ""}
                  </option>
                ))}
            </select>
          </label>
          {state?.undo && (
            <button
              className="ghost undo"
              disabled={!latest || busy || Boolean(state.decisionLock)}
              title={
                state.decisionLock ||
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
                setCurrent(nextPending(stops, decisions));
              }
            }}
          >
            {t("Back to review")}
          </button>
        </nav>
      )}
      <div className="review-body">
        <main id="paper" ref={paper} tabIndex={-1} onScroll={onScroll}>
          {(state?.commentLock || state?.decisionLock) && (
            <div className="banner" id="review-lock" role="status">
              {t((state.commentLock || state.decisionLock)!)}
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
                    "The agent is publishing a new round. You can keep reviewing; the new round will include your decisions.",
                  )}
            </div>
          )}
          {!changes && detail && state?.latest && detail.round !== state.latest && (
            <div className="banner">
              {t("You are viewing round {round}.", { round: detail.round })}{" "}
              <a href={withLanguage(`?task=${encodeURIComponent(task)}`)}>
                {t("Go to round {round} →", { round: state.latest })}
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
          {changes && detail && !count.pending && (count.accepted > 0 || !stops.length) && (
            <div className="review-complete" role="status">
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
            <div className="review-complete" role="status">
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
                          : "All changes reviewed",
                )}
              </strong>
              <span>
                {t(
                  state?.workspace?.status === "waiting_input"
                    ? "Open Chat to answer the agent's question."
                    : ["running", "queued", "building"].includes(
                          state?.workspace?.status || "",
                        ) || state?.state === "building"
                      ? "New changes will appear here when ready."
                      : state?.workspace?.comments
                        ? "Your comments are saved. Send feedback so the agent can revise."
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
              <div className="review-complete-actions" />
            </div>
          )}
          <div className="document">
            {detail ? (
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
                    <h2 className="part-title">
                      {detail.sections.length
                        ? t("Other changes")
                        : t("Changes")}
                    </h2>
                    {detail.loose.map((block) => change(block, index++, false))}
                  </section>
                )}
                {!stops.length && !changes && (
                  <p className="empty">{t("This round has no changes.")}</p>
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
          <label htmlFor="composer-text">
            {t("Comment on change {n}", { n: composer.stop + 1 })}
          </label>
          <textarea
            id="composer-text"
            autoFocus
            rows={4}
            maxLength={20000}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              store(composer.key, e.target.value);
            }}
            placeholder={t("What should the agent change here?")}
          />
          <div className="composer-row">
            <span className="muted">{t("⌘↵ send · Esc cancel")}</span>
            <button type="button" onClick={() => closeComposer()}>
              {t("Cancel")}
            </button>
            <button
              type="submit"
              title={state?.commentLock ? t(state.commentLock) : undefined}
              aria-describedby={state?.commentLock ? "review-lock" : undefined}
              disabled={busy || !draft.trim() || Boolean(state?.commentLock)}
            >
              {t("Send")}
            </button>
          </div>
        </form>
      )}
      {toast && (
        <div className="toast" role="alert">
          {toast}
        </div>
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
                    ["A", "Stage or unstage"],
                    ["R", "Revert"],
                    ["J / K or → / ←", "Next / previous change"],
                    ["N", "Next unstaged"],
                    ["S", "Show LaTeX source"],
                    ["⌘Z / U", "Undo revert"],
                    ["⌘C / Ctrl+C", "Copy selected PDF text"],
                  ]
                : [
                    ["A", "Accept"],
                    ["R", "Reject"],
                    ["C", "Comment"],
                    ["J / K or → / ←", "Next / previous change"],
                    ["N", "Next undecided"],
                    ["S", "Show LaTeX source"],
                    ["⌘Z / U", "Undo"],
                    ["⌘C / Ctrl+C", "Copy selected PDF text"],
                  ]
              ).map(([key, label]) => (
                <Fragment key={key}>
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
