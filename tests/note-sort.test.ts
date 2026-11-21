import assert from 'node:assert/strict';
import test from 'node:test';
import { anchorRect, groupNoteEntries, isNoteSortMode, sortNoteEntries, type NoteEntry } from '../src/note-sort.ts';
import type { Annotation, PageReadingLayout } from '../src/shared.ts';

function note(id: string, extra: Partial<Annotation> = {}): Annotation {
  return {
    id,
    projectId: 'paper',
    key: 'pdf',
    page: 0,
    rect: [0.1, 0.2, 0.3, 0.22],
    comment: `Note ${id}`,
    quote: `Quote ${id}`,
    source: null,
    createdAt: 100,
    ...extra,
  };
}

function entries(list: Annotation[]): NoteEntry<Annotation>[] {
  return list.map((item, index) => ({ note: item, index }));
}

test('isNoteSortMode accepts only valid sort modes', () => {
  assert.equal(isNoteSortMode('original'), true);
  assert.equal(isNoteSortMode('position'), true);
  assert.equal(isNoteSortMode('newest'), true);
  assert.equal(isNoteSortMode('oldest'), false);
  assert.equal(isNoteSortMode(''), false);
  assert.equal(isNoteSortMode(null), false);
  assert.equal(isNoteSortMode(undefined), false);
});

test('original order preserves canonical annotation order and indices', () => {
  const list = entries([
    note('a', { page: 2, createdAt: 300 }),
    note('b', { page: 0, createdAt: 100 }),
    note('c', { page: 1, createdAt: 200 }),
  ]);
  // Even if passed shuffled, original order restores canonical index order.
  const sorted = sortNoteEntries([list[2], list[0], list[1]], 'original', 'pdf');
  assert.deepEqual(sorted.map(item => [item.note.id, item.index]), [['a', 0], ['b', 1], ['c', 2]]);
});

test('PDF position sorts by page, then reading order within a page, keeping unconfirmed notes at the end', () => {
  const list = entries([
    note('page2-top', { page: 1, rect: [0.12, 0.10, 0.40, 0.12], createdAt: 1 }),
    note('unconfirmed-first', { key: 'old', page: 0, rect: [0.05, 0.05, 0.20, 0.07], createdAt: 2 }),
    note('page1-bottom', { page: 0, rect: [0.12, 0.65, 0.40, 0.67], createdAt: 3 }),
    note('page1-line-right', { page: 0, rect: [0.58, 0.200, 0.78, 0.216], createdAt: 4 }),
    note('page1-line-left', { page: 0, rect: [0.14, 0.202, 0.34, 0.215], createdAt: 5 }),
    note('unconfirmed-second', { key: 'older', page: 0, rect: [0.01, 0.01, 0.10, 0.02], createdAt: 6 }),
    note('page2-mid', { page: 1, rect: [0.12, 0.40, 0.40, 0.42], createdAt: 7 }),
  ]);

  const sorted = sortNoteEntries(list, 'position', 'pdf');
  assert.deepEqual(sorted.map(item => item.note.id), [
    'page1-line-left',
    'page1-line-right',
    'page1-bottom',
    'page2-top',
    'page2-mid',
    'unconfirmed-first',
    'unconfirmed-second',
  ]);
  // Canonical indices (for PDF marker numbers) stay unchanged.
  assert.deepEqual(sorted.map(item => item.index), [4, 3, 2, 0, 6, 1, 5]);
});

test('PDF position uses the first line rect for multi-line highlights and rect for regions/points', () => {
  const multiLine = note('multi', {
    rect: [0.10, 0.20, 0.88, 0.24],
    rects: [[0.55, 0.20, 0.88, 0.218], [0.10, 0.222, 0.40, 0.24]],
  });
  const earlierSameLine = note('earlier', {
    rect: [0.15, 0.201, 0.45, 0.217],
    rects: [[0.15, 0.201, 0.45, 0.217]],
  });
  const region = note('region', {
    rect: [0.10, 0.08, 0.80, 0.18],
    rects: [],
  });
  assert.deepEqual(anchorRect(multiLine), [0.55, 0.20, 0.88, 0.218]);
  assert.deepEqual(anchorRect(region), [0.10, 0.08, 0.80, 0.18]);

  const sorted = sortNoteEntries(entries([multiLine, earlierSameLine, region]), 'position', 'pdf');
  assert.deepEqual(sorted.map(item => item.note.id), ['region', 'earlier', 'multi']);
});

test('PDF position orders two-column pages with full-width spanning bands in reading order', () => {
  const layouts = new Map<number, PageReadingLayout>([
    [0, { gutter: 0.5, spanning: [[0.06, 0.16], [0.44, 0.50]] }],
  ]);
  const list = entries([
    note('lower-right', { rect: [0.54, 0.58, 0.90, 0.60] }),
    note('upper-right', { rect: [0.54, 0.22, 0.90, 0.24] }),
    note('title', { rect: [0.20, 0.09, 0.80, 0.12] }),
    note('lower-left', { rect: [0.08, 0.72, 0.46, 0.74] }),
    note('mid-figure', { rect: [0.10, 0.45, 0.90, 0.49] }),
    note('upper-left-bottom', { rect: [0.08, 0.36, 0.46, 0.38] }),
    note('upper-left-top', { rect: [0.08, 0.26, 0.46, 0.28] }),
  ]);

  const sorted = sortNoteEntries(list, 'position', 'pdf', layouts);
  assert.deepEqual(sorted.map(item => item.note.id), [
    'title',
    'upper-left-top',
    'upper-left-bottom',
    'upper-right',
    'mid-figure',
    'lower-left',
    'lower-right',
  ]);
});

test('PDF position breaks exact geometry ties deterministically and falls back to original order without currentKey', () => {
  const list = entries([
    note('first', { page: 0, rect: [0.2, 0.3, 0.4, 0.32], createdAt: 50 }),
    note('second', { page: 0, rect: [0.2, 0.3, 0.4, 0.32], createdAt: 10 }),
  ]);
  assert.deepEqual(sortNoteEntries(list, 'position', 'pdf').map(item => item.note.id), ['first', 'second']);
  assert.deepEqual(sortNoteEntries([list[1], list[0]], 'position', 'pdf').map(item => item.note.id), ['first', 'second']);

  // Without a current PDF key, all positions need confirmation and stay in original order.
  const noBuild = entries([
    note('late', { page: 3, rect: [0.1, 0.8, 0.3, 0.82] }),
    note('early', { page: 0, rect: [0.1, 0.1, 0.3, 0.12] }),
  ]);
  assert.deepEqual(sortNoteEntries(noBuild, 'position', undefined).map(item => item.note.id), ['late', 'early']);
});

test('newest first sorts by createdAt descending with reverse canonical index tie-breaking', () => {
  const list = entries([
    note('oldest', { createdAt: 100 }),
    note('tie-first', { createdAt: 300 }),
    note('tie-second', { createdAt: 300 }),
    note('middle', { createdAt: 200 }),
    note('unconfirmed-newest', { key: 'old', createdAt: 400 }),
  ]);
  const sorted = sortNoteEntries(list, 'newest', 'pdf');
  assert.deepEqual(sorted.map(item => [item.note.id, item.index]), [
    ['unconfirmed-newest', 4],
    ['tie-second', 2],
    ['tie-first', 1],
    ['middle', 3],
    ['oldest', 0],
  ]);
});

test('groupNoteEntries applies sort mode within color groups while preserving canonical PDF numbers', () => {
  const list = entries([
    note('y-page2', { group: 'yellow', page: 1, rect: [0.1, 0.1, 0.3, 0.12], createdAt: 10 }),
    note('indiv-1', { page: 1, rect: [0.1, 0.3, 0.3, 0.32], createdAt: 20 }),
    note('y-stale', { group: 'blue', key: 'old', page: 0, rect: [0.1, 0.05, 0.3, 0.07], createdAt: 50 }),
    note('p-bottom', { group: 'purple', page: 0, rect: [0.1, 0.7, 0.3, 0.72], createdAt: 30 }),
    note('y-page1', { group: 'yellow', page: 0, rect: [0.1, 0.2, 0.3, 0.22], createdAt: 40 }),
    note('p-top', { group: 'purple', page: 0, rect: [0.1, 0.15, 0.3, 0.17], createdAt: 60 }),
  ]);

  const byPosition = groupNoteEntries(list, 'position', 'pdf');
  assert.deepEqual(byPosition.map(group => group.group), ['yellow', 'purple']);
  assert.deepEqual(byPosition[0].entries.map(item => [item.note.id, item.index + 1]), [
    ['y-page1', 5],
    ['y-page2', 1],
    ['y-stale', 3],
  ]);
  assert.deepEqual(byPosition[1].entries.map(item => [item.note.id, item.index + 1]), [
    ['p-top', 6],
    ['p-bottom', 4],
  ]);

  const byNewest = groupNoteEntries(list, 'newest', 'pdf');
  assert.deepEqual(byNewest[0].entries.map(item => [item.note.id, item.index + 1]), [
    ['y-stale', 3],
    ['y-page1', 5],
    ['y-page2', 1],
  ]);
  assert.deepEqual(byNewest[1].entries.map(item => [item.note.id, item.index + 1]), [
    ['p-top', 6],
    ['p-bottom', 4],
  ]);
});

test('PDF position keeps a tall formula and normal word on the same line even when a small superscript sits between their tops', () => {
  const formula = note('formula', { rect: [0.50, 0.200, 0.65, 0.224] }); // mid 0.212, height 0.024
  const superscript = note('sup', { rect: [0.70, 0.2045, 0.74, 0.2105] }); // mid 0.2075, height 0.006 (topDiff 0.0045 > 0.004, midDiff 0.0045 > 0.0027)
  const word = note('word', { rect: [0.10, 0.206, 0.30, 0.218] }); // mid 0.212, height 0.012 (matches formula's line!)

  const sorted = sortNoteEntries(entries([formula, superscript, word]), 'position', 'pdf');
  assert.deepEqual(sorted.map(item => item.note.id), ['word', 'formula', 'sup']);
});

test('PDF position normalizes reversed rectangle coordinates and spanning bands', () => {
  const reversedLeft = note('left', { rect: [0.42, 0.62, 0.12, 0.60] });
  const reversedRight = note('right', { rects: [[0.88, 0.22, 0.56, 0.20]], rect: [0.88, 0.22, 0.56, 0.20] });
  const reversedTitle = note('title', { rect: [0.80, 0.12, 0.20, 0.09] });
  assert.deepEqual(anchorRect(reversedLeft), [0.12, 0.60, 0.42, 0.62]);
  assert.deepEqual(anchorRect(reversedRight), [0.56, 0.20, 0.88, 0.22]);

  const layouts = new Map<number, PageReadingLayout>([
    [0, { gutter: 0.5, spanning: [[0.15, 0.07]] }],
  ]);
  const sorted = sortNoteEntries(entries([reversedRight, reversedLeft, reversedTitle]), 'position', 'pdf', layouts);
  assert.deepEqual(sorted.map(item => item.note.id), ['title', 'left', 'right']);
});

test('newest first handles missing or non-finite createdAt deterministically', () => {
  const list = entries([
    note('missing-a', { createdAt: Number.NaN }),
    note('known-old', { createdAt: 100 }),
    note('missing-b', { createdAt: undefined as unknown as number }),
    note('known-new', { createdAt: 500 }),
  ]);
  const sorted = sortNoteEntries(list, 'newest', 'pdf');
  assert.deepEqual(sorted.map(item => [item.note.id, item.index]), [
    ['known-new', 3],
    ['known-old', 1],
    ['missing-b', 2],
    ['missing-a', 0],
  ]);
});

