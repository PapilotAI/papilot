import { opcodes } from "../core/diff.ts";
import type { Decision, RoundDetail, Unit, Visual, VisualUnit } from "../types.ts";
export interface Stop {
  key: string;
  units: string[];
  section: number | null;
  /** Its PDF comparison is still rendering: it cannot be decided yet. */
  waiting?: boolean;
}
export function buildStops(
  detail: Pick<RoundDetail, "sections" | "loose">,
): Stop[] {
  return [
    ...detail.sections.flatMap((section, s) =>
      section.blocks.flatMap((b, i) =>
        b.kind === "change"
          ? [{ key: `s${s}b${i}`, units: b.units, section: s, ...(b.waiting ? { waiting: true } : {}) }]
          : [],
      ),
    ),
    ...detail.loose.map((b, l) => ({
      key: `l${l}`,
      units: b.units,
      section: null,
      ...(b.waiting ? { waiting: true } : {}),
    })),
  ];
}
export const pendingUnits = (
  stop: Stop | undefined,
  decisions: Record<string, Decision>,
) => (stop?.units ?? []).filter((id) => decisions[id] === "pending");
// The next undecided change after `current`, preferring one whose PDF
// comparison is ready over one still rendering.
export function nextPending(
  stops: Stop[],
  decisions: Record<string, Decision>,
  current = -1,
  focused?: readonly string[],
) {
  let waiting = -1;
  for (let step = 1; step <= stops.length; step++) {
    const index = ((current < 0 ? -1 : current) + step) % stops.length;
    if (pendingUnits(stops[index], decisions).some(id => !focused || focused.includes(id))) {
      if (!stops[index].waiting) return index;
      if (waiting < 0) waiting = index;
    }
  }
  return waiting;
}
// The host drafts comments from these exact units, not the merged PDF block.
export function commentScope(units: (Unit & Partial<VisualUnit>)[]) {
  const before = units.every(unit => !unit.new_text);
  return {
    where: `${before ? "Before" : "After"} · ${describeLocation(before ? units.map(unit => ({ ...unit, new_start: unit.old_start, new_end: unit.old_end })) : units)}`,
    quote: units.map(unit => unit.new_text || unit.old_text).filter(Boolean).join("\n"),
  };
}
// Names for a task's review state; the viewer translates them where it shows them.
export const STATUS: Record<string, string> = {
  editing: "Editing",
  reviewing: "In review",
  revise: "Awaiting revision",
  done: "All decided",
  build_failed: "Publish failed",
  building: "Publishing",
};
// Names for a change's state; the viewer translates them where it shows them.
export const STATE: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  commented: "Commented",
  mixed: "Mixed",
};
export function stopState(
  units: string[],
  decisions: Record<string, Decision>,
) {
  const values = new Set(units.map((id) => decisions[id] || "pending"));
  return values.size === 1
    ? [...values][0]
    : values.has("pending")
      ? "pending"
      : "mixed";
}
/** The build that shows a block decided with some edits accepted and others
 *  rejected, or null. An edit accepted in a note option's wording builds
 *  with that wording, so choosing another option asks for another build. */
export function mixedKey(
  round: number,
  index: number,
  units: string[],
  decisions: Record<string, Decision>,
  variants: Record<string, string> = {},
) {
  if (!units.every((id) => decisions[id] === "accepted" || decisions[id] === "rejected")) return null;
  const accepted = units.filter((id) => decisions[id] === "accepted").sort(),
    worded = accepted.filter((id) => Object.hasOwn(variants, id));
  if (!accepted.length || accepted.length === units.length) return null;
  return `${round}:${index}:${accepted.join(",")}${worded.length ? ":" + JSON.stringify(worded.map((id) => [id, variants[id]])) : ""}`;
}
export function resolvedSide(
  units: string[],
  decisions: Record<string, Decision>,
) {
  if (units.length && units.every((id) => decisions[id] === "accepted"))
    return "after";
  if (units.length && units.every((id) => decisions[id] === "rejected"))
    return "before";
  return undefined;
}
export function progress(decisions: Record<string, Decision>) {
  const values = Object.values(decisions),
    counts = { accepted: 0, rejected: 0, commented: 0, pending: 0 };
  for (const value of values) counts[value]++;
  return {
    ...counts,
    total: values.length,
    decided: values.length - counts.pending,
  };
}
export function visibleStop(
  regions: { index: number; top: number; bottom: number }[],
  current: number,
  top: number,
  bottom: number,
) {
  const visible = regions.filter((r) => r.bottom > top && r.top < bottom);
  return visible.some((r) => r.index === current)
    ? current
    : (visible[0]?.index ?? current);
}
export function wordDiff(before: string, after: string) {
  const token = /\\[A-Za-z@]+\*?|[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*|\s+|[^\s]/gu,
    a = before.match(token) ?? [],
    b = after.match(token) ?? [],
    meaningful = (tokens: string[], from: number, to: number) => {
      let count = 0;
      for (let k = from; k < to; k++) if (/[\p{L}\p{N}\\{}$]/u.test(tokens[k])) count++;
      return count;
    },
    segments = opcodes(a, b).map(([tag, i, j, x, y]) => ({ equal: tag === "equal", i, j, x, y }));
  for (let changed = true; changed;) {
    changed = false;
    for (let k = 1; k + 1 < segments.length; k++) {
      const eq = segments[k], prev = segments[k - 1], next = segments[k + 1];
      if (!eq.equal || prev.equal || next.equal) continue;
      const text = a.slice(eq.i, eq.j).join(""),
        q = meaningful(a, eq.i, eq.j),
        spanSize = Math.min(
          Math.max(meaningful(a, prev.i, prev.j), meaningful(b, prev.x, prev.y)),
          Math.max(meaningful(a, next.i, next.j), meaningful(b, next.x, next.y)),
        );
      const absorb =
        q === 0
          ? !/\r?\n[ \t]*\r?\n|[%\\{}$]|[.!?]\s*\r?\n/u.test(text) &&
            (!/\n/.test(text) || spanSize >= 2)
          : q <= 2 &&
            !/\r?\n[ \t]*\r?\n|[%\\{}$]|[.!?]\s*\r?\n/u.test(text) &&
            spanSize >= 2 * q;
      if (!absorb) continue;
      prev.j = next.j;
      prev.y = next.y;
      segments.splice(k, 2);
      changed = true;
      k--;
    }
  }
  const parts: { type: "equal" | "del" | "ins"; text: string }[] = [];
  for (const { equal, i, j, x, y } of segments) {
    if (equal)
      parts.push({ type: "equal", text: a.slice(i, j).join("") });
    else {
      if (i < j) parts.push({ type: "del", text: a.slice(i, j).join("") });
      if (x < y) parts.push({ type: "ins", text: b.slice(x, y).join("") });
    }
  }
  for (let i = 1; i < parts.length - 1; i++)
    if (
      parts[i].type === "equal" &&
      /^[ \t]+$/.test(parts[i].text) &&
      parts[i - 1].type !== "equal" &&
      parts[i + 1].type !== "equal"
    ) {
      const text = parts[i].text;
      parts.splice(i, 1, { type: "del", text }, { type: "ins", text });
      i++;
    }
  const result: typeof parts = [];
  for (let i = 0; i < parts.length;) {
    if (parts[i].type === "equal") {
      result.push(parts[i++]);
      continue;
    }
    let removed = "",
      added = "";
    while (i < parts.length && parts[i].type !== "equal") {
      if (parts[i].type === "del") removed += parts[i].text;
      else added += parts[i].text;
      i++;
    }
    if (removed) result.push({ type: "del", text: removed });
    if (added) result.push({ type: "ins", text: added });
  }
  return result;
}
/** The kinds of change a change's label names. Where text moved, its marks
 *  show it, so a label would only puzzle. "No visible change" and "Source
 *  only" describe the whole change: an edit that only swapped a space for a
 *  line break, beside visible ones, does not make the change invisible. */
export function changeKinds(units: Partial<Pick<VisualUnit, "visual" | "effects">>[]): Visual[] {
  const kinds = new Set(
    units
      .filter((u) => !(u.effects && u.visual === "unmapped"))
      .map((u) => u.visual ?? "unmapped"),
  );
  const visible = kinds.has("text") || kinds.has("layout") || kinds.has("position");
  return [...kinds].filter(
    (kind) =>
      kind !== "text" &&
      kind !== "position" &&
      !(visible && (kind === "identical" || kind === "unmapped")),
  );
}
type Say = (text: string, values?: Record<string, string | number>) => string;
const english: Say = (text, values = {}) =>
  text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
// The viewer passes its translator for display; copied references and the
// default stay in English.
export function describeLocation(
  units: (Unit & Partial<VisualUnit>)[],
  say: Say = english,
) {
  const files = new Map<string, string[]>();
  for (const unit of units) {
    const where =
      unit.status === "added"
        ? say("new file")
        : unit.status === "deleted"
          ? say("deleted")
          : unit.new_start === unit.new_end
            ? String(unit.new_start)
            : `${unit.new_start}–${unit.new_end}`;
    files.set(unit.file, [...(files.get(unit.file) ?? []), where]);
  }
  const pages = [...new Set(units.flatMap((u) => u.pages ?? []))];
  return (
    [...files]
      .map(([file, places]) => `${file}:${[...new Set(places)].join(", ")}`)
      .join("; ") +
    (pages.length ? ` · ${say("p. {pages}", { pages: pages.join(", ") })}` : "")
  );
}
/** The location as a change's bar shows it: each file's name, without its
 *  folders, and the span of its edited lines. describeLocation's full paths,
 *  every line and the pages are what hovering shows and tools quote. */
export function shortLocation(
  units: (Unit & Partial<VisualUnit>)[],
  say: Say = english,
) {
  const files = new Map<string, number[] | string>();
  for (const unit of units) {
    const seen = files.get(unit.file);
    if (typeof seen === "string") continue;
    if (unit.status === "added" || unit.status === "deleted")
      files.set(unit.file, say(unit.status === "added" ? "new file" : "deleted"));
    else files.set(unit.file, [...(seen ?? []), unit.new_start, unit.new_end]);
  }
  return [...files]
    .map(([file, lines]) => {
      const name = file.slice(file.lastIndexOf("/") + 1);
      if (typeof lines === "string") return `${name}:${lines}`;
      const from = Math.min(...lines), to = Math.max(...lines);
      return `${name}:${from === to ? from : `${from}–${to}`}`;
    })
    .join("; ");
}
export function copyReference(
  title: string,
  round: number,
  change: number,
  location: string,
  selected: string,
) {
  return `${title} · Round ${round} · Change ${change}\n${location}${selected ? "\n\n" + selected : ""}`;
}
