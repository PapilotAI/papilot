import { expect, it } from "vitest";
import { alignPages, BAR_HEIGHT, BAR_SPACING, freeSlot, paperPlan, scope, type PlacedChange } from "../../src/web/paper.ts";
import type { Rect, Strip } from "../../src/types.ts";

const strip = ([left, top, right, bottom]: Rect, page = 1): Strip => ({
  left,
  top,
  width: right - left,
  height: bottom - top,
  page,
  label: String(page),
  src: "crop.svg",
  clean: "crop.svg",
});
const change = (index: number, after: Strip[]): PlacedChange => ({
  index,
  block: {
    kind: "change",
    units: [String(index)],
    before: [],
    after,
    identical: false,
  },
});
const plan = (
  changes: PlacedChange[],
  count = 1,
  labels: string[] | null = null,
) => paperPlan({ count, labels, changes, width: 600, height: 800 });

it("keeps the adjacent column when a change occupies only one column", () => {
  const result = plan([change(0, [strip([30, 100, 280, 140])])]);
  const context = result.pages[0].flatMap((p) => p.context ?? []);
  const covers = (x: number, y: number) =>
    context.filter((r) => r[0] < x && r[2] > x && r[1] < y && r[3] > y).length;
  expect(covers(400, 120)).toBe(1);
  expect(covers(100, 120)).toBe(0);
  expect(covers(100, 50)).toBe(1);
  expect(covers(100, 200)).toBe(1);
});

it("covers every point once with context or changes when vertical ranges overlap", () => {
  const rects: Rect[] = [
    [0, 100, 300, 200],
    [300, 150, 600, 250],
  ];
  const result = plan(rects.map((r, i) => change(i, [strip(r)])));
  const context = result.pages[0].flatMap((p) => p.context ?? []);
  for (let y = 5; y < 800; y += 10)
    for (let x = 5; x < 600; x += 10)
      expect(
        [...rects, ...context].filter(
          (r) => r[0] <= x && r[2] > x && r[1] <= y && r[3] > y,
        ),
      ).toHaveLength(1);
  expect(result.pages[0].flatMap((p) => p.shown.map((c) => c.index))).toEqual([
    0, 1,
  ]);
});

it("shows a multi-page change once and preserves source-only change placement", () => {
  const first = change(0, []),
    across = change(1, [
      strip([0, 100, 600, 140]),
      strip([0, 200, 300, 240], 2),
    ]),
    last = change(2, []);
  const result = plan([first, across, last], 2, ["1", "2"]);
  expect(result.before.map((c) => c.index)).toEqual([0]);
  expect(
    result.pages.flatMap((p) => p.flatMap((c) => c.shown.map((s) => s.index))),
  ).toEqual([1, 2]);
  expect(
    result.pages[1]
      .flatMap((p) => p.context ?? [])
      .some((r) => r[0] <= 400 && r[2] >= 400 && r[1] <= 220 && r[3] >= 220),
  ).toBe(true);
});

it("pairs old and new pages by what they say, with blank pages where one version has more", () => {
  const page = (...words: string[]) => words.flatMap((word) => Array(10).fill(word));
  const [a, b, c, d, x] = [page("alpha"), page("beta"), page("gamma"), page("delta"), page("inserted")];
  // The same pages pair one to one.
  expect(alignPages([a, b, c], [a, b, c])).toEqual([[0, 0], [1, 1], [2, 2]]);
  // A page only the new version has sits beside a blank page, where it is.
  expect(alignPages([a, b, c], [a, x, b, c])).toEqual([[0, 0], [null, 1], [1, 2], [2, 3]]);
  // A page only the old version had.
  expect(alignPages([a, b, x, c], [a, b, c])).toEqual([[0, 0], [1, 1], [2, null], [3, 2]]);
  // Text pushed down by part of a page keeps the pages paired one to one,
  // with no blank pages, as long as both have as many pages.
  const shifted = [page("alpha", "beta"), page("beta", "gamma"), page("gamma", "delta")];
  expect(alignPages([a.concat(b), b.concat(c), c.concat(d)], [page("alpha", "alpha", "beta"), ...shifted.slice(1)])).toEqual([[0, 0], [1, 1], [2, 2]]);
  // One more page at the end.
  expect(alignPages([a, b], [a, b, c])).toEqual([[0, 0], [1, 1], [null, 2]]);
  // A long thesis with a page inserted in its middle: the search keeps near
  // the diagonal and still finds it.
  const long = Array.from({ length: 240 }, (_, i) => page(`p${i}`, `q${i}`)), inserted = page("appendix");
  const rows = alignPages(long, [...long.slice(0, 120), inserted, ...long.slice(120)]);
  expect(rows).toHaveLength(241);
  expect(rows[120]).toEqual([null, 120]);
  expect(rows.every(([b, a], i) => b === null || a === (i < 120 ? b : b + 1))).toBe(true);
});

it("shades exactly a crop's lines, or the whole crop when it has no words", () => {
  const crop: Strip = { ...strip([0, 100, 600, 160]), text: [
    { text: "ab", chars: [{ text: "a", rect: [72, 10, 80, 20] }, { text: "b", rect: [80, 10, 88, 20] }] },
    { text: "c", chars: [{ text: "c", rect: [72, 30, 300, 42] }] },
  ] };
  expect(scope(crop)).toEqual([69, 8, 303, 44]);
  expect(scope(strip([0, 100, 600, 160]))).toEqual([0, 0, 600, 60]);
});

it("puts the bars of changes with nothing to mark in free places, never on another bar", () => {
  // A change near the page's foot, then two with nothing to mark after it.
  // The row also holds a bar beside the other version's page.
  const bars = [{ top: 0.9, bottom: 0.98 }, { top: 0.8, bottom: 0.83 }];
  for (let i = 0; i < 2; i++) {
    const top = freeSlot(bars, 0.98 + BAR_SPACING);
    bars.push({ top, bottom: top + BAR_HEIGHT });
  }
  bars.sort((a, b) => a.top - b.top);
  for (let i = 1; i < bars.length; i++) expect(bars[i].top).toBeGreaterThanOrEqual(bars[i - 1].bottom + BAR_SPACING - 1e-9);
  for (const bar of bars) expect(bar.bottom).toBeLessThanOrEqual(1);
  // On an empty page, the first goes where it was asked.
  expect(freeSlot([], 0.03)).toBeCloseTo(BAR_SPACING);
  expect(freeSlot([], 0.5)).toBeCloseTo(0.5);
});
