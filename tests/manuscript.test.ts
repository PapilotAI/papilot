import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { annotationTask, gitStatus, parseStatus, parseSynctex, workingTree } from '../src/server/manuscript.ts';
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
  assert.match(single.instructions, /1\. Page 2 · main\.tex lines 31–33\n   Marked text: "The operator applies a compatible revision\."\n   Note: Define "compatible" here\./);
  const many = annotationTask([note('Shorten.'), note('Redraw this figure.', { quote: '', source: { file: 'figures.tex', lines: [5, 5] }, page: 3 })]);
  assert.equal(many.title, 'Address 2 PDF notes');
  assert.match(many.instructions, /2\. Page 4 · figures\.tex line 5\n   Marked region: a figure, equation or other non-text area\n   Note: Redraw this figure\./);
});
