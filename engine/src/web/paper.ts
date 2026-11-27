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

// Old and new pages, paired in order as Draftable's comparison does: a
// change printed on old page b and new page a puts those two in one row, the
// pages before it pair up to it, and a blank page (null) fills in for the
// version with fewer of them. Pages after the last change pair from the
// start. A change that would go back to earlier pages is not an anchor.
export type PagePair = [number | null, number | null];
export function pairPages(before: number, after: number, anchors: [number, number][]): PagePair[] {
  const rows: PagePair[] = [];
  let b = 0, a = 0;
  // Pages up to old page toB and new page toA, paired from the start.
  const run = (toB: number, toA: number) => {
    for (let i = 0; i < Math.max(toB - b, toA - a); i++) rows.push([b + i < toB ? b + i : null, a + i < toA ? a + i : null]);
    b = Math.max(b, toB); a = Math.max(a, toA);
  };
  for (const [ob, na] of anchors) {
    if (ob < b - 1 || na < a - 1 || (ob < b && na < a)) continue;
    run(Math.max(b, ob), Math.max(a, na));
    // A side already paired with the previous change gets a blank here.
    rows.push([ob >= b ? ob : null, na >= a ? na : null]);
    b = Math.max(b, ob + 1); a = Math.max(a, na + 1);
  }
  run(before, after);
  return rows;
}
