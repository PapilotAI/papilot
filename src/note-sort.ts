import { canonicalGroup, NOTE_GROUPS, type NoteGroup } from './note-groups.ts';
import type { Annotation, PageReadingLayout } from './shared.ts';

export const NOTE_SORT_MODES = ['original', 'position', 'newest'] as const;
export type NoteSortMode = typeof NOTE_SORT_MODES[number];
export const isNoteSortMode = (value: unknown): value is NoteSortMode =>
  typeof value === 'string' && NOTE_SORT_MODES.includes(value as NoteSortMode);

export interface NoteEntry<T> { note: T; index: number }
export type SortableAnnotation = Pick<Annotation, 'id' | 'key' | 'page' | 'rect' | 'rects' | 'createdAt'>;
export type PageReadingLayouts = ReadonlyMap<number, PageReadingLayout> | Readonly<Record<number, PageReadingLayout>>;

// Small vertical jitter tolerance for marks on the same printed line (~3pt on a
// letter/A4 page, well below line spacing).
const SAME_LINE_TOP_TOLERANCE = 0.004;
const SAME_LINE_OVERLAP_TOP_TOLERANCE = 0.008;
const MAX_SINGLE_LINE_HEIGHT = 0.04;
const SPAN_TOLERANCE = 0.002;

const compareId = (a: { note: { id: string } }, b: { note: { id: string } }) =>
  a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0;

function normalizeRect([x0, y0, x1, y1]: [number, number, number, number]): [number, number, number, number] {
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

/** The starting box of an annotation on its page: first line for text marks,
 *  or the outer box for regions and points. Coordinates are normalized so
 *  left <= right and top <= bottom. */
export function anchorRect(note: Pick<Annotation, 'rect' | 'rects'>): [number, number, number, number] {
  return normalizeRect(note.rects && note.rects.length > 0 ? note.rects[0] : note.rect);
}

function pageLayout(layouts: PageReadingLayouts | undefined, page: number): PageReadingLayout | undefined {
  if (!layouts) return undefined;
  return layouts instanceof Map ? layouts.get(page) : (layouts as Readonly<Record<number, PageReadingLayout>>)[page];
}

// Match src/server/note-sections.ts: read full-width spanning bands top to
// bottom, and between spanning bands finish the left column before the right.
function readingSlot(rect: [number, number, number, number], layout?: PageReadingLayout): [number, number] {
  if (!layout) return [0, 0];
  const [left, top] = rect;
  let band = 0;
  for (const [a, b] of layout.spanning) {
    const start = Math.min(a, b), end = Math.max(a, b);
    if (top < start - SPAN_TOLERANCE) break;
    if (top <= end + SPAN_TOLERANCE) return [band + 1, 0];
    band += 2;
  }
  return [band, left >= layout.gutter ? 1 : 0];
}

interface PositionedEntry<T extends SortableAnnotation> {
  entry: NoteEntry<T>;
  page: number;
  band: number;
  column: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function sameVisualLine<T extends SortableAnnotation>(anchor: PositionedEntry<T>, item: PositionedEntry<T>) {
  const topDiff = item.top - anchor.top;
  if (topDiff <= SAME_LINE_TOP_TOLERANCE) return true;
  if (topDiff > SAME_LINE_OVERLAP_TOP_TOLERANCE) return false;
  const anchorHeight = anchor.bottom - anchor.top;
  const itemHeight = item.bottom - item.top;
  if (anchorHeight <= 0 || itemHeight <= 0 || anchorHeight > MAX_SINGLE_LINE_HEIGHT || itemHeight > MAX_SINGLE_LINE_HEIGHT) return false;
  const anchorMid = (anchor.top + anchor.bottom) / 2;
  const itemMid = (item.top + item.bottom) / 2;
  return Math.abs(itemMid - anchorMid) <= Math.min(anchorHeight, itemHeight) * 0.45;
}

function sortBucket<T extends SortableAnnotation>(items: PositionedEntry<T>[]): NoteEntry<T>[] {
  const byTop = [...items].sort((a, b) =>
    a.top - b.top
    || a.left - b.left
    || a.bottom - b.bottom
    || a.right - b.right
    || a.entry.index - b.entry.index
    || compareId(a.entry, b.entry));
  const used = new Array<boolean>(byTop.length).fill(false);
  const result: NoteEntry<T>[] = [];
  for (let i = 0; i < byTop.length; i++) {
    if (used[i]) continue;
    const anchor = byTop[i];
    used[i] = true;
    const row: PositionedEntry<T>[] = [anchor];
    for (let j = i + 1; j < byTop.length && byTop[j].top - anchor.top <= SAME_LINE_OVERLAP_TOP_TOLERANCE; j++) {
      if (used[j] || !sameVisualLine(anchor, byTop[j])) continue;
      used[j] = true;
      row.push(byTop[j]);
    }
    row.sort((a, b) =>
      a.left - b.left
      || a.top - b.top
      || a.bottom - b.bottom
      || a.right - b.right
      || a.entry.index - b.entry.index
      || compareId(a.entry, b.entry));
    for (const item of row) result.push(item.entry);
  }
  return result;
}

/** Sort canonical annotation entries without altering each entry's canonical
 *  index (so PDF marker numbers stay consistent across sort modes). */
export function sortNoteEntries<T extends SortableAnnotation>(
  entries: readonly NoteEntry<T>[],
  mode: NoteSortMode,
  currentKey?: string,
  layouts?: PageReadingLayouts,
): NoteEntry<T>[] {
  if (mode === 'original') {
    return [...entries].sort((a, b) => a.index - b.index || compareId(a, b));
  }
  if (mode === 'newest') {
    return [...entries].sort((a, b) => {
      const aTime = Number.isFinite(a.note.createdAt) ? a.note.createdAt : -Infinity;
      const bTime = Number.isFinite(b.note.createdAt) ? b.note.createdAt : -Infinity;
      return (aTime !== bTime ? (bTime > aTime ? 1 : -1) : 0) || (b.index - a.index) || compareId(a, b);
    });
  }
  const confirmed: PositionedEntry<T>[] = [];
  const unconfirmed: NoteEntry<T>[] = [];
  for (const entry of entries) {
    if (currentKey === undefined || entry.note.key !== currentKey) {
      unconfirmed.push(entry);
      continue;
    }
    const rect = anchorRect(entry.note);
    const [band, column] = readingSlot(rect, pageLayout(layouts, entry.note.page));
    confirmed.push({ entry, page: entry.note.page, band, column, left: rect[0], top: rect[1], right: rect[2], bottom: rect[3] });
  }
  const buckets = new Map<string, PositionedEntry<T>[]>();
  const bucketKeys: { key: string; page: number; band: number; column: number }[] = [];
  for (const item of confirmed) {
    const key = `${item.page}:${item.band}:${item.column}`;
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
      bucketKeys.push({ key, page: item.page, band: item.band, column: item.column });
    }
    list.push(item);
  }
  bucketKeys.sort((a, b) => a.page - b.page || a.band - b.band || a.column - b.column);
  const ordered: NoteEntry<T>[] = [];
  for (const { key } of bucketKeys) ordered.push(...sortBucket(buckets.get(key)!));
  unconfirmed.sort((a, b) => a.index - b.index || compareId(a, b));
  ordered.push(...unconfirmed);
  return ordered;
}

/** Group canonical annotation entries by color group and sort each group's
 *  members in place while preserving each note's canonical index. */
export function groupNoteEntries<T extends SortableAnnotation & { group?: NoteGroup }>(
  entries: readonly NoteEntry<T>[],
  mode: NoteSortMode,
  currentKey?: string,
  layouts?: PageReadingLayouts,
) {
  return NOTE_GROUPS.flatMap(group => {
    const members = entries.filter(({ note }) => note.group && canonicalGroup(note.group) === group);
    return members.length ? [{ group, entries: sortNoteEntries(members, mode, currentKey, layouts) }] : [];
  });
}
