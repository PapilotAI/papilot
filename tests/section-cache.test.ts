import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { PdfReader } from '../src/server/pdf-reader.ts';
import { groupSectionNotes, type SectionHeading } from '../src/server/note-sections.ts';
import type { Annotation } from '../src/shared.ts';

const compiled = { pdf: '/snapshot/paper.pdf', root: '/snapshot', sourceDir: '' };
const headings: SectionHeading[] = [
  { id: 'first', title: 'First', level: 1, position: { page: 0, top: 0 } },
  { id: 'second', title: 'Second', level: 1, position: { page: 1, top: 0 } },
];
const note = (id: string, extra: Partial<Annotation> = {}): Annotation => ({ id, projectId: 'paper', key: 'pdf', page: 0, rect: [0.1, 0.5, 0.3, 0.52], comment: 'Clarify.', quote: 'Passage', source: null, createdAt: 1, ...extra });

test('adding, editing, deleting and selecting notes only classifies new or moved marks', async t => {
  const reader = new PdfReader(), read: string[][] = [];
  let outlines = 0;
  t.mock.method(reader as any, 'call', async (op: string, args: any) => {
    if (op === 'sectionHeadings') { outlines++; return headings; }
    assert.equal(op, 'sectionNotes'); read.push(args.notes.map((note: Annotation) => note.id));
    return groupSectionNotes(args.notes, args.key, args.headings);
  });
  try {
    const a = note('a'), b = note('b', { page: 1 });
    await reader.sections(compiled, 'pdf', [a]);
    const changed: Annotation = { ...a, comment: 'Edited', quote: 'Updated quote', group: 'purple', source: { file: 'main.tex', lines: [99, 100] } };
    const added = await reader.sections(compiled, 'pdf', [changed, b]);
    assert.deepEqual(added.sections.map(section => section.notes), [['a'], ['b']]);
    assert.deepEqual((await reader.sections(compiled, 'pdf', [b])).sections.map(section => section.notes), [[], ['b']]);
    await reader.sections(compiled, 'pdf', [changed, b]);
    assert.deepEqual(read, [['a'], ['b']], 'content edits and subsets reuse the compiled marks');
    assert.equal(outlines, 1);
    const moved = await reader.sections(compiled, 'pdf', [{ ...a, page: 1 }, b]);
    assert.deepEqual(moved.sections.map(section => section.notes), [[], ['a', 'b']]);
    await reader.sections(compiled, 'pdf', [{ ...a, page: 1, rects: [[0.1, 0.6, 0.3, 0.62]] }]);
    assert.deepEqual(read, [['a'], ['b'], ['a'], ['a']]);
    assert.equal((await reader.sections(compiled, 'pdf', [note('old', { key: 'old' })])).unplaced, 1);
    await reader.sections(compiled, 'new', [{ ...a, key: 'new' }]);
    await reader.sections({ ...compiled, root: '/another-project' }, 'pdf', [a]);
    assert.equal(outlines, 3, 'PDF versions and source roots cannot share assignments');
  } finally { await reader.stop(); }
  await assert.rejects(reader.sections(compiled, 'pdf', []), /shutting down/);
});

test('concurrent polls share pending marks and preserve each requested geometry', async t => {
  const reader = new PdfReader(), calls: { notes: Annotation[]; finish: () => void }[] = [];
  t.mock.method(reader as any, 'call', async (op: string, args: any) => {
    if (op === 'sectionHeadings') return headings;
    await new Promise<void>(resolve => calls.push({ notes: args.notes, finish: resolve }));
    return groupSectionNotes(args.notes, args.key, args.headings);
  });
  try {
    const first = reader.sections(compiled, 'pdf', [note('a')]);
    const repeated = reader.sections(compiled, 'pdf', [note('a')]);
    const moved = reader.sections(compiled, 'pdf', [note('a', { page: 1 })]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.map(call => call.notes.map(note => note.page)), [[0], [1]]);
    calls[1].finish(); calls[0].finish();
    assert.deepEqual((await first).sections.map(section => section.notes), [['a'], []]);
    assert.deepEqual(await first, await repeated);
    assert.deepEqual((await moved).sections.map(section => section.notes), [[], ['a']]);
    assert.deepEqual(await reader.sections(compiled, 'pdf', [note('a', { page: 1 })]), await moved);
    assert.equal(calls.length, 2);
  } finally { calls.forEach(call => call.finish()); await reader.stop(); }
});

test('failed outline and assignment reads can retry', async t => {
  const reader = new PdfReader();
  let outlines = 0, marks = 0;
  t.mock.method(reader as any, 'call', async (op: string, args: any) => {
    if (op === 'sectionHeadings') {
      if (++outlines === 1) throw Error('Outline unavailable');
      return headings;
    }
    if (++marks === 1) throw Error('Worker interrupted');
    return groupSectionNotes(args.notes, args.key, args.headings);
  });
  try {
    await assert.rejects(reader.sections(compiled, 'pdf', [note('a')]), /Outline unavailable/);
    await assert.rejects(reader.sections(compiled, 'pdf', [note('a')]), /Worker interrupted/);
    assert.deepEqual((await reader.sections(compiled, 'pdf', [note('a')])).sections[0].notes, ['a']);
    assert.equal(outlines, 2); assert.equal(marks, 2);
  } finally { await reader.stop(); }
});

test('cold section reads use a separate worker lane from source locations', async t => {
  const reader = new PdfReader();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const sections = t.mock.method((reader as any).sectionReader, 'call', async () => { await waiting; return headings; });
  const locations = t.mock.method((reader as any).reader, 'call', async () => ({ quote: 'Passage', source: { file: 'main.tex', lines: [1, 2] } }));
  try {
    const pending = reader.sections(compiled, 'pdf', []);
    assert.equal(sections.mock.callCount(), 1);
    const located = await reader.locate({ pdf: compiled.pdf, page: 0, rect: [0, 0, 1, 1], rects: [], selected: '' });
    assert.deepEqual(located?.source?.lines, [1, 2]);
    assert.equal(locations.mock.callCount(), 1, 'source location is dispatched while outline work is blocked');
    release(); await pending;
  } finally { release(); await reader.stop(); }
});

test('section assignments survive the real PDF worker going idle', async t => {
  const reader = new PdfReader(10);
  const dispatch = t.mock.method(reader as any, 'call');
  const build = { pdf: path.resolve('tests/fixtures/outline.pdf'), root: path.resolve('tests/fixtures'), sourceDir: '' };
  try {
    const first = await reader.sections(build, 'pdf', [note('a')]);
    await new Promise(resolve => setTimeout(resolve, 100));
    const cached = await reader.sections(build, 'pdf', [note('a', { source: { file: 'main.tex', lines: [90, 91] } })]);
    assert.deepEqual(cached, first);
    assert.equal(dispatch.mock.callCount(), 2, 'neither the outline nor the old mark restarts PDF work');
    const next = await reader.sections(build, 'pdf', [note('a'), note('b', { page: 1 })]);
    assert.deepEqual(next.sections.map(section => section.notes), [['a'], ['b'], ['b']]);
    assert.equal(dispatch.mock.callCount(), 3, 'only the new mark is read after idle');
  } finally { await reader.stop(); }
});

test('pageLayouts are populated, cached, and retried for two-column PDFs both with and without headings', async t => {
  const twoColLayout = { gutter: 0.5, spanning: [[0.06, 0.14]] as [number, number][] };

  // 1. Without headings/bookmarks: probes one representative note per uncached page and caches layouts.
  {
    const reader = new PdfReader();
    const calls: string[][] = [];
    let failOnce = true;
    t.mock.method(reader as any, 'call', async (op: string, args: any) => {
      if (op === 'sectionHeadings') return [];
      assert.equal(op, 'sectionNotes');
      calls.push(args.notes.map((item: Annotation) => item.id));
      if (failOnce) { failOnce = false; throw Error('Temporary layout read failure'); }
      const pageLayouts = Object.fromEntries(
        [...new Set<number>(args.notes.map((item: Annotation) => item.page))]
          .filter(page => page === 0)
          .map(page => [page, twoColLayout]),
      );
      return { ...groupSectionNotes(args.notes, args.key, args.headings), ...(Object.keys(pageLayouts).length ? { pageLayouts } : {}) };
    });
    try {
      const p0a = note('p0a', { page: 0 }), p0b = note('p0b', { page: 0 }), p1 = note('p1', { page: 1 }), stale = note('stale', { key: 'old', page: 2 });
      await assert.rejects(reader.sections(compiled, 'pdf', [p0a, p0b]), /Temporary layout read failure/);
      const first = await reader.sections(compiled, 'pdf', [p0a, p0b, p1, stale]);
      assert.deepEqual(first.sections, []);
      assert.equal(first.unplaced, 4);
      assert.deepEqual(first.pageLayouts, { 0: twoColLayout });
      // Second call with another note on page 0 and page 1 must reuse cached page layouts with zero worker calls.
      const second = await reader.sections(compiled, 'pdf', [p0a, p0b, note('p0c', { page: 0 }), p1]);
      assert.deepEqual(second.pageLayouts, { 0: twoColLayout });
      assert.deepEqual(calls, [['p0a'], ['p0a', 'p1']], 'only one representative note per uncached page is inspected, and failed reads retry');
    } finally { await reader.stop(); }
  }

  // 2. With headings: returns cached pageLayouts alongside section assignments without re-reading inspected pages.
  {
    const reader = new PdfReader();
    const calls: string[][] = [];
    t.mock.method(reader as any, 'call', async (op: string, args: any) => {
      if (op === 'sectionHeadings') return headings;
      calls.push(args.notes.map((item: Annotation) => item.id));
      const pageLayouts = Object.fromEntries(
        [...new Set<number>(args.notes.map((item: Annotation) => item.page))].map(page => [page, twoColLayout]),
      );
      return { ...groupSectionNotes(args.notes, args.key, args.headings), pageLayouts };
    });
    try {
      const a = note('a', { page: 0 });
      const first = await reader.sections(compiled, 'pdf', [a]);
      assert.deepEqual(first.pageLayouts, { 0: twoColLayout });
      const cached = await reader.sections(compiled, 'pdf', [{ ...a, comment: 'Edited' }]);
      assert.deepEqual(cached.pageLayouts, { 0: twoColLayout });
      assert.deepEqual(calls, [['a']], 'cached hits retain pageLayouts without re-reading the PDF');
    } finally { await reader.stop(); }
  }
});
