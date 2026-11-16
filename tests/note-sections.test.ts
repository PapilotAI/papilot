import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { groupSectionNotes, type SectionHeading } from '../src/server/note-sections.ts';
import { PdfReader } from '../src/server/pdf-reader.ts';
import { notesInstructions, readNotesInstructions, summarizeNotes } from '../src/notes.ts';
import type { Annotation } from '../src/shared.ts';

const note = (id: string, extra: Partial<Annotation> = {}): Annotation => ({ id, projectId: 'paper', key: 'pdf', page: 0, rect: [0.1, 0.5, 0.3, 0.52], comment: 'Clarify this.', quote: 'the result', source: null, createdAt: 1, ...extra });
const source = (line: number, file = 'main.tex'): Annotation['source'] => ({ file, lines: [line, line] });

test('section scopes include descendant notes across pages, files and color groups', () => {
  const headings: SectionHeading[] = [
    { id: 'intro', title: '1 Introduction', level: 1, ranges: { 'main.tex': [[1, 9]] } },
    { id: 'methods', title: '2 Methods', level: 1, ranges: { 'main.tex': [[10, 39]], 'parts/proof.tex': [[1, 8]] } },
    { id: 'first', title: '2.1 First', level: 2, ranges: { 'main.tex': [[14, 24]], 'parts/proof.tex': [[1, 8]] } },
    { id: 'proof', title: '2.1.1 Proof', level: 3, ranges: { 'parts/proof.tex': [[1, 8]] } },
    { id: 'second', title: '2.2 Second', level: 2, ranges: { 'main.tex': [[25, 39]] } },
    { id: 'end', title: '3 Conclusion', level: 1, ranges: { 'main.tex': [[40, 49]] } },
  ];
  const notes = [note('outside', { source: source(4) }), note('section', { source: source(11) }), note('subsection', { source: source(15), group: 'yellow' }),
    note('nested', { page: 2, source: source(3, 'parts/proof.tex'), group: 'purple' }), note('sibling', { source: source(26) }), note('after', { source: source(41) }),
    note('stale', { key: 'old', source: source(15) }), note('crossing', { source: { file: 'main.tex', lines: [22, 28] } })];
  const result = groupSectionNotes(notes, 'pdf', headings);
  assert.deepEqual(result.sections.find(section => section.id === 'methods')?.notes, ['section', 'subsection', 'nested', 'sibling', 'crossing']);
  assert.deepEqual(result.sections.find(section => section.id === 'first')?.notes, ['subsection', 'nested']);
  assert.deepEqual(result.contexts.nested, ['Section: 2 Methods > 2.1 First > 2.1.1 Proof']);
  assert.deepEqual(result.contexts.crossing, ['Section: 2 Methods']);
  assert.equal(result.unplaced, 1);
});

test('source ranges disambiguate same-page columns; bookmarks split source-less notes at exact headings', () => {
  const headings: SectionHeading[] = [
    { id: 'first', title: '1 First', level: 1, ranges: { 'main.tex': [[1, 19]] }, position: { page: 0, top: 0.2 } },
    { id: 'second', title: '2 Second', level: 1, ranges: { 'main.tex': [[20, 39]] }, position: { page: 0, top: 0.6 } },
    { id: 'child', title: '2.1 Child', level: 2, position: { page: 1, top: 0.25 } },
    { id: 'third', title: '3 Third', level: 1, position: { page: 2, top: 0.2 } },
  ];
  const notes = [note('column', { source: source(22), rect: [0.55, 0.3, 0.8, 0.32] }), note('before'), note('after', { rect: [0.1, 0.7, 0.2, 0.72] }),
    note('next-page', { page: 1, rect: [0.1, 0.15, 0.2, 0.18] }), note('nested', { page: 1 }), note('outside', { page: 2 })];
  const result = groupSectionNotes(notes, 'pdf', headings);
  assert.deepEqual(result.sections[0].notes, ['before']);
  assert.deepEqual(result.sections[1].notes, ['column', 'after', 'next-page', 'nested']);
  assert.deepEqual(result.sections[2].notes, ['nested']);
  assert.deepEqual(result.sections[3].notes, ['outside']);
});

test('no outline and stale locations stay unassigned rather than selecting a whole page', () => {
  assert.deepEqual(groupSectionNotes([note('n')], 'pdf', []), { sections: [], contexts: {}, unplaced: 1 });
  const result = groupSectionNotes([note('n')], 'pdf', [{ id: 'one', title: 'One', level: 1, position: { page: 0, top: 0.1 } }, { id: 'unknown', title: 'Unknown', level: 1 }]);
  assert.equal(result.unplaced, 1);
});

test('the PDF worker reads real bookmark hierarchy and same-page subsection boundaries', async () => {
  const reader = new PdfReader();
  try {
    const result = await reader.sections({ pdf: path.resolve('tests/fixtures/outline.pdf'), root: path.resolve('tests/fixtures'), sourceDir: '' }, 'pdf',
      [note('intro'), note('results', { page: 1 }), note('old', { page: 1, key: 'old' })]);
    assert.deepEqual(result.sections.map(section => section.title), ['Introduction', 'Method', 'Results']);
    assert.deepEqual(result.sections.map(section => section.notes), [['intro'], ['results'], ['results']]);
    assert.deepEqual(result.contexts.results, ['Section: Method > Results']);
    assert.equal(result.unplaced, 1);
  } finally { await reader.stop(); }
});

test('each note sends its section ancestry alongside its source and PDF page, and keeps it in chat summaries', () => {
  const notes = [note('n', { page: 2, source: { file: 'proof.tex', lines: [30, 32], excerpt: 'A proof.' }, context: ['Section: 2 Methods > 2.1 Proof'] })];
  const prompt = notesInstructions(notes, 'Improve clarity.');
  assert.match(prompt, /Page 3 · proof.tex lines 30–32/);
  assert.match(prompt, /Section: 2 Methods > 2\.1 Proof/);
  assert.match(prompt, /A proof\./);
  assert.deepEqual(readNotesInstructions(prompt)?.[0].context, notes[0].context);
  assert.deepEqual(summarizeNotes(notes)[0].context, notes[0].context);
  assert.deepEqual(summarizeNotes(notes)[0].anchor?.sources, [{ file: 'proof.tex', lines: [30, 32] }]);
});

test('compiled trace scopes stay with the marked PDF after working source edits, without PDF bookmarks', { timeout: 120000 }, async t => {
  const { execFileSync } = await import('node:child_process');
  try { execFileSync('latexmk', ['-v'], { stdio: 'ignore' }); } catch { t.skip('latexmk is unavailable'); return; }
  const fs = await import('node:fs'), os = await import('node:os');
  const { OUTLINE_TRACE } = await import('../engine/src/core/build.ts');
  const { PdfDocument } = await import('../engine/src/render/pdf.ts');
  const { readTrace } = await import('../src/server/writer/build-map.ts');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-note-sections-'));
  const snapshot = path.join(folder, 'snapshot'), working = path.join(folder, 'working'), reader = new PdfReader();
  fs.mkdirSync(snapshot); fs.mkdirSync(working);
  const text = String.raw`\documentclass{article}
\begin{document}
\section{First}
A distinctive passage in the first section.
\subsection{Nested}
Another passage in the nested section.
\section{Second}
An independent passage in the final section.
\end{document}
`;
  fs.writeFileSync(path.join(snapshot, 'main.tex'), text);
  fs.writeFileSync(path.join(working, 'main.tex'), text.replace('\\section{First}', '\n'.repeat(30) + '\\section{First}'));
  fs.writeFileSync(path.join(folder, 'trace.tex'), OUTLINE_TRACE);
  try {
    execFileSync('latexmk', ['-norc', '-pdf', '-outdir=build', '-jobname=main', '-synctex=1', '-interaction=nonstopmode', '-usepretex=\\input{../trace.tex}', 'main.tex'], { cwd: snapshot, stdio: 'ignore', timeout: 120000 });
    const compiled = { pdf: path.join(snapshot, 'build/main.pdf'), root: snapshot, sourceDir: '' };
    assert.ok(readTrace(compiled, working)!.headings[0].line > readTrace(compiled, null)!.headings[0].line, 'fixture moves working source coordinates');
    const document = new PdfDocument(compiled.pdf);
    let marked: Annotation;
    try {
      assert.deepEqual(document.outline, [], 'this paper has no PDF bookmarks');
      const page = document.page(0), line = page.lines.find(line => line.text.includes('distinctive'))!;
      const rect = [(line.rect[0] - page.bounds[0]) / page.width, (line.rect[1] - page.bounds[1]) / page.height, (line.rect[2] - page.bounds[0]) / page.width, (line.rect[3] - page.bounds[1]) / page.height] as Annotation['rect'];
      marked = note('first', { rect, rects: [rect], quote: line.text, source: source(34) });
    } finally { document.close(); }
    const result = await reader.sections(compiled, 'pdf', [marked]);
    assert.deepEqual(result.sections.map(section => section.title), ['1 First', '1.1 Nested', '2 Second']);
    assert.deepEqual(result.sections.map(section => section.notes), [['first'], [], []]);
    assert.deepEqual(result.contexts.first, ['Section: 1 First']);
  } finally { await reader.stop(); fs.rmSync(folder, { recursive: true, force: true }); }
});


test('bookmark fallback reads columns before y and gives cross-subsection marks their common parent', () => {
  const headings: SectionHeading[] = [
    { id: 'parent', title: '1 Parent', level: 1, position: { page: 0, top: 0.1, left: 0.1 } },
    { id: 'left', title: '1.1 Left', level: 2, position: { page: 0, top: 0.25, left: 0.1 } },
    { id: 'right', title: '1.2 Right', level: 2, position: { page: 0, top: 0.25, left: 0.55 } },
  ];
  const result = groupSectionNotes([
    note('left'), note('right', { rect: [0.55, 0.5, 0.8, 0.52] }),
    note('continuation', { rect: [0.55, 0.15, 0.8, 0.17] }),
    note('crossing', { rects: [[0.1, 0.7, 0.3, 0.72], [0.55, 0.3, 0.8, 0.32]] }),
    note('unlocated-wide-region', { rect: [0.1, 0.6, 0.8, 0.62] }),
  ], 'pdf', headings, new Map([[0, { gutter: 0.5, spanning: [] }]]));
  assert.deepEqual(result.sections.map(section => section.notes), [['left', 'right', 'continuation', 'crossing'], ['left', 'continuation'], ['right']]);
  assert.deepEqual(result.contexts.crossing, ['Section: 1 Parent']);
  assert.equal(result.unplaced, 1, 'An arbitrary region spanning a gutter has no verifiable reading position');
});

test('full-width bands separate the reading order of two-column blocks', () => {
  const headings: SectionHeading[] = [
    { id: 'first', title: 'First', level: 1, position: { page: 0, top: 0.1, left: 0.1 } },
    { id: 'wide', title: 'Wide heading', level: 1, position: { page: 0, top: 0.45, left: 0.1 } },
    { id: 'next', title: 'Next', level: 1, position: { page: 0, top: 0.55, left: 0.55 } },
  ];
  const result = groupSectionNotes([
    note('above', { rect: [0.55, 0.3, 0.8, 0.32] }),
    note('below-left', { rect: [0.1, 0.7, 0.3, 0.72] }),
    note('below-right', { rect: [0.55, 0.7, 0.8, 0.72] }),
  ], 'pdf', headings, new Map([[0, { gutter: 0.5, spanning: [[0.44, 0.48]] }]]));
  assert.deepEqual(result.sections.map(section => section.notes), [['above'], ['below-left'], ['below-right']]);
});

test('real two-column PDFs without source maps keep left comments and right continuations in their sections', { timeout: 120000 }, async t => {
  const { execFileSync } = await import('node:child_process');
  try { execFileSync('latexmk', ['-v'], { stdio: 'ignore' }); } catch { t.skip('latexmk is unavailable'); return; }
  const fs = await import('node:fs'), os = await import('node:os');
  const { PdfDocument } = await import('../engine/src/render/pdf.ts');
  const { OUTLINE_TRACE } = await import('../engine/src/core/build.ts');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-note-columns-')), reader = new PdfReader();
  const mark = (document: InstanceType<typeof PdfDocument>, id: string, text: string) => {
    const page = document.page(0), line = page.lines.find(line => line.text.includes(text));
    assert.ok(line, 'Fixture contains ' + text);
    const rect = [(line.rect[0] - page.bounds[0]) / page.width, (line.rect[1] - page.bounds[1]) / page.height, (line.rect[2] - page.bounds[0]) / page.width, (line.rect[3] - page.bounds[1]) / page.height] as Annotation['rect'];
    return note(id, { rect, rects: [rect], quote: line.text });
  };
  try {
    for (const variant of ['same-height', 'continuation', 'duplicate-title'] as const) {
      const root = path.join(folder, variant); fs.mkdirSync(root);
      const first = variant === 'duplicate-title' ? 'Summary' : 'First', second = variant === 'duplicate-title' ? 'Summary' : 'Second';
      const middle = variant === 'continuation' ? String.raw`\subsection{Nested}
The nested passage belongs to the left subsection.
\newpage
A continuation belongs to the same nested subsection.
\vspace*{1in}

` : '\\newpage\n';
      fs.writeFileSync(path.join(root, 'main.tex'), String.raw`\documentclass[twocolumn]{article}
\usepackage{hyperref}
\begin{document}
\section{${first}}
This text belongs in the first section.
\vspace*{2in}

A distinctive lower passage still in the first section.
${middle}\section{${second}}
A separate right passage belongs to the second section.
\end{document}
`);
      fs.writeFileSync(path.join(root, 'trace.tex'), OUTLINE_TRACE);
      execFileSync('latexmk', ['-norc', '-pdf', '-outdir=build', '-jobname=main', '-synctex=0', '-interaction=nonstopmode', ...(variant === 'duplicate-title' ? ['-usepretex=\\input{trace.tex}'] : []), 'main.tex'], { cwd: root, stdio: 'ignore', timeout: 120000 });
      const compiled = { pdf: path.join(root, 'build/main.pdf'), root, sourceDir: '' };
      assert.equal(fs.existsSync(path.join(root, 'build/main.synctex.gz')), false, 'No source map can hide a bookmark fallback bug');
      const document = new PdfDocument(compiled.pdf);
      try {
        assert.equal(document.length, 1, 'The fixture puts both columns on the same page');
        const notes = [mark(document, 'left', 'distinctive'), mark(document, 'right', 'separate right')];
        if (variant === 'continuation') notes.push(mark(document, 'nested', 'nested passage'), mark(document, 'continued', 'continuation'));
        const result = await reader.sections(compiled, 'pdf', notes);
        assert.deepEqual(result.sections.map(section => section.notes), variant === 'continuation' ? [['left', 'nested', 'continued'], ['nested', 'continued'], ['right']] : [['left'], ['right']], variant);
        assert.equal(result.unplaced, 0, variant + ' retains every verifiable comment');
        if (variant === 'duplicate-title') assert.deepEqual(result.sections.map(section => section.title), ['1 Summary', '2 Summary'], 'Unique anchors take priority over duplicated title text');
      } finally { document.close(); }
    }
  } finally { await reader.stop(); fs.rmSync(folder, { recursive: true, force: true }); }
});
