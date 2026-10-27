import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anchor, annotationTask, gitStatus, parseStatus, parseSynctex, settleLines, sourceExcerpt, workingTree } from '../src/server/manuscript.ts';
import type { Annotation } from '../src/shared.ts';

test('Git status parsing keeps branch counts, renames, untracked files and line counts', () => {
  const output = ['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1', '1 .M N... 100644 100644 100644 a b chapters/intro file.tex', '2 R. N... 100644 100644 100644 a b R100 new.tex', 'old.tex', '? notes.md', ''].join('\0');
  const numstat = ['3\t1\tchapters/intro file.tex', '0\t0\t', 'old.tex', 'new.tex', ''].join('\0');
  assert.deepEqual(parseStatus(output, numstat), {
    branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1,
    files: [
      { path: 'chapters/intro file.tex', status: 'M', staged: false, lines: [3, 1] },
      { path: 'new.tex', status: 'R', staged: true, lines: [0, 0] },
      { path: 'notes.md', status: '?', staged: false },
    ],
  });
});

test('the working tree snapshot includes uncommitted edits without touching the index', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-manuscript-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root }).toString().trim();
  try {
    git('init', '-q');
    fs.writeFileSync(path.join(root, 'main.tex'), 'Original.\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'build/\n');
    git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'Initial');
    const committed = git('rev-parse', 'HEAD^{tree}');
    return Promise.resolve().then(async () => {
      assert.equal(await workingTree(root), committed);
      fs.writeFileSync(path.join(root, 'main.tex'), 'Accepted change.\n');
      fs.writeFileSync(path.join(root, 'notes.tex'), 'New file.\n');
      fs.mkdirSync(path.join(root, 'build')); fs.writeFileSync(path.join(root, 'build/main.pdf'), 'ignored');
      const tree = await workingTree(root);
      assert.notEqual(tree, committed);
      assert.equal(git('show', `${tree}:main.tex`), 'Accepted change.');
      assert.equal(git('show', `${tree}:notes.tex`), 'New file.');
      assert.throws(() => git('show', `${tree}:build/main.pdf`));
      assert.equal(git('diff', '--cached', '--name-only'), '', 'The real index stays untouched');
      assert.match(git('status', '--porcelain'), /\?\? notes\.tex/);
      const status = await gitStatus(root);
      assert.deepEqual(status.files.map(file => [file.path, file.status]), [['main.tex', 'M'], ['notes.tex', '?']]);
      assert.equal(status.head?.subject, 'Initial');
    }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
  } catch (error) { fs.rmSync(root, { recursive: true, force: true }); throw error; }
});

test('SyncTeX output resolves to a normalized source path and line', () => {
  const output = 'SyncTeX result begin\nOutput:/b/src/build/main.pdf\nInput:/b/src/./chapters/intro.tex\nLine:21\nColumn:-1\nSyncTeX result end\n';
  assert.deepEqual(parseSynctex(output), { input: '/b/src/chapters/intro.tex', line: 21 });
  assert.equal(parseSynctex('SyncTeX result begin\nSyncTeX result end\n'), null);
});

test('PDF notes become one task that quotes each marked region and its source', () => {
  const note = (comment: string, extra: Partial<Annotation> = {}): Annotation => ({ id: comment, projectId: 'p', key: 'k', page: 1, rect: [0, 0, 1, 1], comment, quote: 'The operator applies a compatible revision.', source: { file: 'main.tex', lines: [31, 33] }, createdAt: 1, ...extra });
  const single = annotationTask([note('Define "compatible" here.')]);
  assert.equal(single.title, 'Define "compatible" here.');
  assert.match(single.instructions, /1\. Page 2 · main\.tex lines 31–33\n   PDF text: "The operator applies a compatible revision\."\n   Note: Define "compatible" here\./);
  const withSource = annotationTask([note('Explain the operator.', { source: { file: 'main.tex', lines: [30, 32], excerpt: '\\begin{equation}\n  D_{t+1} = D_t \\oplus \\Delta_t\n\\end{equation}' } })]);
  assert.match(withSource.instructions, /main\.tex lines 30–32\n   LaTeX source of the marked region:\n   ```latex\n   \\begin\{equation\}\n     D_\{t\+1\} = D_t \\oplus \\Delta_t\n   \\end\{equation\}\n   ```\n   PDF text:/);
  const many = annotationTask([note('Shorten.'), note('Redraw this figure.', { quote: '', source: { file: 'figures.tex', lines: [5, 5] }, page: 3 })]);
  assert.equal(many.title, 'Address 2 PDF notes');
  assert.match(many.instructions, /2\. Page 4 · figures\.tex line 5\n   Marked region: a figure, equation or other non-text area\n   Note: Redraw this figure\./);
});

test('source excerpts keep the marked lines and shorten long ranges', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-excerpt-')), 'main.tex');
  try {
    fs.writeFileSync(file, Array.from({ length: 40 }, (_, i) => `line ${i + 1}   `).join('\n'));
    assert.equal(sourceExcerpt(file, [3, 5]), 'line 3\nline 4\nline 5');
    assert.equal(sourceExcerpt(file, [1, 30], 2), 'line 1\nline 2\n…');
    assert.equal(sourceExcerpt(file + '.missing', [1, 2]), undefined);
  } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
});

test('notes settle on the source line that holds the marked words, not the one SyncTeX credits for the space before them', () => {
  const source = ['\\begin{equation}', ' D_{t+1}=D_t\\oplus\\Delta_t', '\\end{equation}', 'The operator $\\oplus$ applies a compatible revision. If two changes conflict,', 'the author requests a new proposal instead of silently replacing accepted text.', 'Compilation is a useful check, but it does not establish that the mathematical', 'meaning of a revised passage is correct. % not printed', '\\section{Discussion}'];
  const chars = (text: string) => [...text].map(c => ({ text: c }));
  const printed = chars('proposal instead of silently replacing accepted text. Compilation is a useful check, but it does not');
  const word = printed.findIndex((_, index) => printed.slice(index).map(c => c.text).join('').startsWith('Compilation'));
  // SyncTeX says line 5 for "Compilation", which starts line 6 of the source.
  assert.deepEqual(settleLines(source, [5, 5], anchor(printed, word, false), anchor(printed, word + 10, true)), [6, 6]);
  // A selection from "accepted" to "Compilation" spans both lines.
  const accepted = printed.findIndex((_, index) => printed.slice(index).map(c => c.text).join('').startsWith('accepted'));
  assert.deepEqual(settleLines(source, [5, 5], anchor(printed, accepted, false), anchor(printed, word + 10, true)), [5, 6]);
  // Subscripts and macros reduce to the same letters as the printed line.
  const equation = chars('The operator ⊕ applies a compatible revision. If two changes conflict, the author');
  assert.deepEqual(settleLines(source, [4, 5], anchor(equation, 4, false), anchor(equation, 11, true)), [4, 4]);
  // Text that is not in the source, like a typeset formula, keeps SyncTeX's lines.
  const formula = chars('Dt+1 = Dt ⊕ Δt');
  assert.deepEqual(settleLines(source, [2, 2], anchor(formula, 0, false), anchor(formula, 13, true)), [2, 2]);
  assert.deepEqual(settleLines([], [3, 4], null, null), [3, 4]);
});
