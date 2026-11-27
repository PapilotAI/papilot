import { expect, it } from "vitest";
import { pairPages, paperPlan, scope, type PlacedChange } from "../../src/web/paper.ts";
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

it("pairs old and new pages around changes, with blank pages for the shorter version", () => {
  // Same length, no changes: page by page.
  expect(pairPages(3, 3, [])).toEqual([[0, 0], [1, 1], [2, 2]]);
  // A page inserted before the change on new page 2: the change's pages
  // share a row, and the old side gets a blank before them.
  expect(pairPages(3, 4, [[1, 2]])).toEqual([[0, 0], [null, 1], [1, 2], [2, 3]]);
  // A page removed: the new side gets the blank.
  expect(pairPages(4, 3, [[2, 1]])).toEqual([[0, 0], [1, null], [2, 1], [3, 2]]);
  // Extra pages at the end of one version.
  expect(pairPages(2, 4, [[0, 0]])).toEqual([[0, 0], [1, 1], [null, 2], [null, 3]]);
  // Several changes on the same pages, and one that would go back.
  expect(pairPages(3, 3, [[1, 1], [1, 1], [2, 2], [0, 0]])).toEqual([[0, 0], [1, 1], [2, 2]]);
  // A change whose old lines are on the page just paired, and new lines on
  // a later page: that new page gets a blank beside it.
  expect(pairPages(2, 3, [[0, 0], [0, 1]])).toEqual([[0, 0], [null, 1], [1, 2]]);
});

it("shades exactly a crop's lines, or the whole crop when it has no words", () => {
  const crop: Strip = { ...strip([0, 100, 600, 160]), text: [
    { text: "ab", chars: [{ text: "a", rect: [72, 10, 80, 20] }, { text: "b", rect: [80, 10, 88, 20] }] },
    { text: "c", chars: [{ text: "c", rect: [72, 30, 300, 42] }] },
  ] };
  expect(scope(crop)).toEqual([69, 8, 303, 44]);
  expect(scope(strip([0, 100, 600, 160]))).toEqual([0, 0, 600, 60]);
});
