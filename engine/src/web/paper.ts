import type { ChangeBlock, Rect, Strip } from "../types.ts";
import { partition } from "../core/rectangles.ts";

// A change block in the numbering of the changes view, for the full paper.
export interface PlacedChange {
  block: ChangeBlock;
  index: number;
}

// The full paper can show the changes when at least one strip knows where
// it starts on its page; a change whose strips do not follows the change
// before it.
export const placeable = (changes: PlacedChange[]) =>
  changes.some((c) => c.block.after.some((s) => s.top !== undefined));

export interface Cut {
  top: number;
  bottom: number;
  // Changes shown at this cut: the one whose new lines start here, and
  // changes without new lines of their own that follow it.
  shown: PlacedChange[];
  context: Rect[];
}
// The page of this PDF that shows a strip of the round's PDF. A round may
// compile only the changed chapters, so pages are matched by their labels,
// moving forward through the paper.
export function locator(count: number, labels: string[] | null) {
  let cursor = 0;
  return (strip: Strip) => {
    if (!labels) return strip.page - 1 < count ? strip.page - 1 : -1;
    for (const from of [cursor, 0]) {
      const found = labels.indexOf(strip.label, from);
      if (found >= 0) return (cursor = found);
    }
    return -1;
  };
}

export function paperPlan({
  count,
  labels,
  changes,
  width,
  height,
}: {
  count: number;
  labels: string[] | null;
  changes: PlacedChange[];
  width: number;
  height: number;
}) {
  type Footprint = Omit<Cut, "context"> & { regions: Rect[] };
  const pages: Footprint[][] = Array.from({ length: count }, () => []),
    before: PlacedChange[] = [],
    find = locator(count, labels);
  let last: Footprint | null = null;
  for (const change of changes) {
    const spots = change.block.after.map((strip) => ({
      strip,
      page: strip.top === undefined ? -1 : find(strip),
    }));
    if (!spots.length || spots.some((s) => s.page < 0)) {
      // No new lines here (a deletion), or none this PDF has: after the
      // previous change, or before the paper when it is the first.
      if (last) last.shown.push(change);
      else before.push(change);
      continue;
    }
    for (const [k, { strip, page }] of spots.entries()) {
      const top = Math.max(0, strip.top!),
        bottom = Math.min(height, strip.top! + strip.height),
        left = strip.left ?? 0;
      const cut: Footprint = {
        top,
        bottom,
        shown: k ? [] : [change],
        regions: [[left, top, left + strip.width, bottom]],
      };
      pages[page].push(cut);
      if (!k) last = cut;
    }
  }
  return {
    before,
    pages: pages.map((cuts, page): Cut[] => {
      const merged: Footprint[] = [];
      for (const cut of cuts.sort((a, b) => a.top - b.top)) {
        const previous = merged.at(-1);
        if (previous && cut.top <= previous.bottom) {
          previous.bottom = Math.max(previous.bottom, cut.bottom);
          previous.shown.push(...cut.shown);
          previous.regions.push(...cut.regions);
        } else
          merged.push({
            ...cut,
            shown: [...cut.shown],
            regions: [...cut.regions],
          });
      }
      const result: Cut[] = [];
      const band = (
        top: number,
        bottom: number,
        shown: PlacedChange[] = [],
        regions: Rect[] = [],
      ) => {
        if (bottom <= top && !shown.length) return;
        result.push({
          top,
          bottom,
          shown: shown.sort((a, b) => a.index - b.index),
          // A change removes its actual rectangle from the PDF, not the
          // entire row. The same complement preserves columns and holes.
          context: partition(
            [
              { page, rect: [0, top, width, bottom] as Rect, value: false },
              ...regions.map((rect) => ({ page, rect, value: true })),
            ],
            (values) => (values.includes(true) ? undefined : false),
          ).map((tile) => tile.rect),
        });
      };
      let cursor = 0;
      for (const cut of merged) {
        band(cursor, cut.top);
        band(cut.top, cut.bottom, cut.shown, cut.regions);
        cursor = cut.bottom;
      }
      band(cursor, height);
      return result;
    }),
  };
}

// Both versions side by side (ComparePages).

// The lines a crop shows, within it: its words' box, a little wider, or the
// whole crop when it has no words, such as a figure.
export function scope(strip: Strip): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const line of strip.text ?? []) for (const { rect } of line.chars) {
    x0 = Math.min(x0, rect[0]); y0 = Math.min(y0, rect[1]); x1 = Math.max(x1, rect[2]); y1 = Math.max(y1, rect[3]);
  }
  if (!(x1 > x0 && y1 > y0)) return [0, 0, strip.width, strip.height];
  return [Math.max(0, x0 - 3), Math.max(0, y0 - 2), Math.min(strip.width, x1 + 3), Math.min(strip.height, y1 + 2)];
}

// Old and new pages, paired by what they say, as Draftable's comparison
// export does. Each page is its words; two pages score the share of words
// they have in common, and a global alignment (Needleman–Wunsch) pairs them
// in order, so that text that only moved down a little keeps its pages
// paired, and a page one version alone has (null on the other side) is left
// beside a blank page, where the versions part.
export type PagePair = [number | null, number | null];
const GAP = 0.4;
function bag(words: string[]) {
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return { counts, size: words.length };
}
export function alignPages(before: string[][], after: string[][]): PagePair[] {
  const old = before.map(bag), next = after.map(bag), n = old.length, m = next.length;
  // Pages a long way off the diagonal never pair: the search keeps to a band
  // around it, wide enough for the difference in length and a margin, so a
  // long thesis aligns in time linear in its length.
  const band = Math.abs(n - m) + 24, near = (i: number, j: number) => Math.abs(i * Math.max(1, m) - j * Math.max(1, n)) <= band * Math.max(n, m, 1);
  const likes = new Map<number, number>();
  const like = (i: number, j: number) => {
    const key = i * (m + 1) + j, known = likes.get(key);
    if (known !== undefined) return known;
    const a = old[i], b = next[j];
    let shared = 0;
    if (a.size && b.size) for (const [word, count] of a.counts) shared += Math.min(count, b.counts.get(word) ?? 0);
    const value = !a.size && !b.size ? 1 : (2 * shared) / (a.size + b.size);
    likes.set(key, value);
    return value;
  };
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(-Infinity));
  score[0][0] = 0;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      if (!i && !j) continue;
      if (!near(i, j) && i && j) continue;
      score[i][j] = Math.max(
        i && j ? score[i - 1][j - 1] + like(i - 1, j - 1) : -Infinity,
        i ? score[i - 1][j] - GAP : -Infinity,
        j ? score[i][j - 1] - GAP : -Infinity,
      );
    }
  const rows: PagePair[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && score[i][j] === score[i - 1][j - 1] + like(i - 1, j - 1)) rows.push([--i, --j]);
    else if (i > 0 && (j === 0 || score[i][j] === score[i - 1][j] - GAP)) rows.push([--i, null]);
    else rows.push([null, --j]);
  }
  return rows.reverse();
}

// The nearest place on a page, as shares of its height, for a short bar that
// keeps clear of the other bars and of their numbers above them: below
// `from` while the page has room, otherwise above it.
export const BAR_HEIGHT = 0.02, BAR_SPACING = 0.025;
export function freeSlot(lines: Map<number, { page: number; top: number; bottom: number }>, page: number, from: number) {
  const taken = [...lines.values()].filter((extent) => extent.page === page);
  const fits = (top: number) => taken.every((extent) => top + BAR_HEIGHT + BAR_SPACING <= extent.top || top >= extent.bottom + BAR_SPACING);
  for (let top = Math.max(BAR_SPACING, from); top + BAR_HEIGHT <= 1; top += 0.005) if (fits(top)) return top;
  for (let top = Math.min(from, 1 - BAR_HEIGHT); top >= BAR_SPACING; top -= 0.005) if (fits(top)) return top;
  return Math.min(Math.max(from, BAR_SPACING), 1 - BAR_HEIGHT);
}
