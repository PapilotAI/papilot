import { opcodes } from "../core/diff.ts";
import { JOIN_GAP, snap, type Strips } from "./inline.ts";
import { entryFor, position, textBounds, type Build } from "./locate.ts";
import { containsCenter, union } from "./pdf.ts";
import { extract, mergeRects, tokens, type Glyph } from "./pdfdiff.ts";
import type {
  Card,
  Effect,
  Mark,
  Pair,
  Place,
  PlaceView,
  Position,
  Rect,
  Strip,
} from "../types.ts";
// An edit can change the PDF away from its own lines: a redefined macro
// changes every use, a new equation renumbers the later ones and their
// references, a new citation adds a bibliography entry. The documents are
// therefore compared whole, word by word. Which edits cause each change is
// found by compiling (publish.ts), and every edit lists the places it changes
// away from its own crops under its own card.

// Removed words that come back elsewhere are moved, not changed, when the run
// is long enough to tell: git's rule for moved blocks, at least 20
// alphanumeric characters.
const MOVED = 20;
export interface Words {
  glyphs: Glyph[];
  tokens: ReturnType<typeof tokens>;
}
const read = new WeakMap<Build, Words>();
// Every word of the page bodies in reading order, without running heads and
// page numbers, which change whenever text moves to another page.
export function words(build: Build): Words {
  const known = read.get(build);
  if (known) return known;
  const document = build.document,
    bodies = Array.from({ length: document.length }, (_, number) => {
      const page = document.page(number),
        [top, bottom] = build.margins.body(page);
      return {
        page: number,
        clip: [0, top, page.width, bottom] as Rect,
        label: page.label,
      };
    }),
    [glyphs] = extract(document, bodies),
    result = { glyphs, tokens: tokens(glyphs) };
  read.set(build, result);
  return result;
}
export function differences(a: Words, b: Words): Effect[] {
  const text = (w: Words, i: number, j: number) =>
      w.tokens
        .slice(i, j)
        .map((t) => t.text)
        .join(" "),
    long = (text: string) =>
      text.replace(/[^\p{L}\p{N}]/gu, "").length >= MOVED,
    ops = opcodes(
      a.tokens.map((t) => t.text),
      b.tokens.map((t) => t.text),
    ).filter((op) => op[0] !== "equal"),
    removed = new Map<string, number>(),
    added = new Map<string, number>(),
    count = (counts: Map<string, number>, key: string) =>
      counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const [tag, i, j, x, y] of ops) {
    if (tag === "delete" && long(text(a, i, j))) count(removed, text(a, i, j));
    if (tag === "insert" && long(text(b, x, y))) count(added, text(b, x, y));
  }
  const moved = (
    counts: Map<string, number>,
    other: Map<string, number>,
    key: string,
  ) => {
    if (!other.get(key)) return false;
    other.set(key, other.get(key)! - 1);
    counts.set(key, counts.get(key)! - 1);
    return true;
  };
  return ops
    .filter(([tag, i, j, x, y]) =>
      tag === "delete" && removed.get(text(a, i, j))
        ? !moved(removed, added, text(a, i, j))
        : tag === "insert" && added.get(text(b, x, y))
          ? !moved(added, removed, text(b, x, y))
          : true,
    )
    .map(([, i, j, x, y]) => ({ old: [i, j], new: [x, y] }));
}
const glyphsOf = (w: Words, [i, j]: [number, number]) =>
  w.tokens.slice(i, j).flatMap((t) => w.glyphs.slice(t.start, t.end));
// Every change between two builds, with the cards whose crops show it.
export function changesOf(old: Build, next: Build, cards: Card[]) {
  const a = words(old),
    b = words(next),
    shows = (card: Card, glyphs: Glyph[], side: "old" | "new") =>
      glyphs.some((glyph) =>
        card.pairs.some((pair) => {
          const p = pair[side];
          return (
            p !== null &&
            p.page === glyph.page &&
            containsCenter(p.clip, glyph.rect)
          );
        }),
      );
  return differences(a, b).map((effect) => ({
    effect,
    within: cards
      .filter(
        (card) =>
          shows(card, glyphsOf(a, effect.old), "old") ||
          shows(card, glyphsOf(b, effect.new), "new"),
      )
      .map((card) => card.id),
  }));
}
// Two changes are at the same place when they touch the same words of the
// old document.
const meets = ([i, j]: [number, number], [a, b]: [number, number]) =>
  i < j && a < b ? a < j && b > i : a <= j && b >= i;
// Which changes a variant build also makes to the old build.
export function shownBy(old: Build, variant: Build, effects: Effect[]) {
  const changes = differences(words(old), words(variant));
  return effects.map((effect) =>
    changes.some((change) => meets(effect.old, change.old)),
  );
}
// The lines a run of words occupies, one position per page. A side with no
// words shows the line where they would be.
function positions(build: Build, w: Words, [i, j]: [number, number]) {
  let glyphs = glyphsOf(w, [i, j]);
  if (!glyphs.length) {
    const near = w.tokens[i - 1] ?? w.tokens[i];
    glyphs = near ? w.glyphs.slice(near.start, near.end) : [];
  }
  const pages = new Map<number, Rect>();
  for (const glyph of glyphs)
    pages.set(
      glyph.page,
      pages.has(glyph.page)
        ? union(pages.get(glyph.page)!, glyph.rect)
        : glyph.rect,
    );
  return [...pages].map(([number, rect]): Position => {
    const page = build.document.page(number),
      [left, right] = textBounds(page),
      [columnLeft, columnRight] = page.columnBounds(page.column(rect)),
      x0 = Math.max(left, columnLeft),
      x1 = Math.min(right, columnRight);
    // Take in every printed line the crop cuts through, so a tall brace or
    // a stacked display is never cut in half.
    let [top, bottom] = [rect[1], rect[3]],
      grown = true;
    while (grown) {
      grown = false;
      for (const line of page.lines) {
        const [a, y0, b, y1] = line.rect;
        if (
          a < x1 &&
          b > x0 &&
          y0 < bottom - 1 &&
          y1 > top + 1 &&
          (y0 < top || y1 > bottom)
        ) {
          [top, bottom] = [Math.min(top, y0), Math.max(bottom, y1)];
          grown = true;
        }
      }
    }
    return {
      page: number,
      clip: [x0, Math.max(0, top - 2), x1, Math.min(page.height, bottom + 2)],
      label: page.label,
    };
  });
}
// The section a place in the PDF belongs to: the last heading before it.
function sectionAt(build: Build, at: Position) {
  const toc = build.document.outline;
  let found: [string, number, number] | null = null;
  for (const node of build.outline) {
    let page: number, top: number;
    try {
      [page, top] = position(build.document, toc[entryFor(node, toc)]);
    } catch {
      continue;
    }
    const before = page < at.page || (page === at.page && top <= at.clip[3]);
    if (
      before &&
      (!found || page > found[1] || (page === found[1] && top >= found[2]))
    )
      found = [`${node.number} ${node.title}`.trim(), page, top];
  }
  return found?.[0] ?? null;
}
const near = (a: Position[], b: Position[]) =>
  a.length === b.length &&
  a.every(
    (p, i) =>
      p.page === b[i].page &&
      p.clip[1] <= b[i].clip[3] + JOIN_GAP &&
      b[i].clip[1] <= p.clip[3] + JOIN_GAP,
  );
const merge = (a: Position[], b: Position[]) =>
  a.map((p, i) => ({ ...p, clip: union(p.clip, b[i].clip) }));
// The places each edit changes outside its own crops, in reading order.
// Nearby changes with the same causes share a place.
export function placesOf(
  old: Build,
  next: Build,
  effects: Effect[],
  causes: string[][],
  within: string[][],
) {
  const a = words(old),
    b = words(next),
    drafts = new Map<
      string,
      {
        with: string[];
        left: Position[];
        right: Position[];
        removed: Glyph[];
        added: Glyph[];
      }[]
    >();
  effects.forEach((effect, index) => {
    const left = positions(old, a, effect.old),
      right = positions(next, b, effect.new),
      removed = glyphsOf(a, effect.old),
      added = glyphsOf(b, effect.new);
    for (const id of causes[index]) {
      if (within[index].includes(id)) continue;
      const others = causes[index].filter((other) => other !== id),
        list = drafts.get(id) ?? [],
        last = list.at(-1);
      if (
        last &&
        last.with.join() === others.join() &&
        near(last.left, left) &&
        near(last.right, right)
      ) {
        last.left = merge(last.left, left);
        last.right = merge(last.right, right);
        last.removed.push(...removed);
        last.added.push(...added);
      } else
        list.push({
          with: others,
          left,
          right,
          removed: [...removed],
          added: [...added],
        });
      drafts.set(id, list);
    }
  });
  // The marks are the words the whole comparison found; comparing the crops
  // alone could split a word that is hyphenated differently.
  const marks = (
    glyphs: Glyph[],
    at: Position | undefined,
    kind: Mark["kind"],
  ): Mark[] =>
    at
      ? mergeRects(
          glyphs
            .filter(
              (g) => g.page === at.page && containsCenter(at.clip, g.rect),
            )
            .map((g) => g.rect),
        ).map((rect) => ({ kind, rect }))
      : [];
  const result: Record<string, Place[]> = {};
  for (const [id, list] of drafts)
    result[id] = list.map((draft): Place => {
      const pairs: Pair[] = Array.from(
          { length: Math.max(draft.left.length, draft.right.length) },
          (_, i) => ({
            old: draft.left[i] ?? null,
            new: draft.right[i] ?? null,
            before_marks: marks(draft.removed, draft.left[i], "removed"),
            after_marks: marks(draft.added, draft.right[i], "added"),
          }),
        ),
        at = draft.right[0] ?? draft.left[0];
      return {
        page: at?.label ?? "",
        section: at ? sectionAt(draft.right[0] ? next : old, at) : null,
        pairs,
        ...(draft.with.length ? { with: draft.with } : {}),
      };
    });
  return result;
}
export function renderPlace(
  place: Place,
  strips: Strips,
  old: Build,
  next: Build,
): PlaceView {
  const before: Strip[] = [],
    after: Strip[] = [];
  for (const pair of place.pairs)
    for (const [side, build, images, marks] of [
      ["old", old, before, pair.before_marks],
      ["new", next, after, pair.after_marks],
    ] as const) {
      const at = pair[side];
      if (!at) continue;
      const image = strips.write(
        build.document,
        at.page,
        ...snap(build.document, at.page, at.clip[1], at.clip[3]),
        marks,
        side,
      );
      if (image) images.push(image);
    }
  return {
    page: place.page,
    section: place.section,
    before,
    after,
    ...(place.with ? { with: place.with } : {}),
  };
}
