import test from 'node:test';
import assert from 'node:assert/strict';
import { commitMessageFrom, ignorePattern } from '../src/commit.ts';

test('build output, minted caches and macOS folder files map to one pattern per kind', () => {
  const cases: [string, string | null][] = [
    ['main.aux', '*.aux'], ['build/main.log', '*.log'], ['main.synctex.gz', '*.synctex.gz'], ['main.fdb_latexmk', '*.fdb_latexmk'], ['paper.run.xml', '*.run.xml'],
    ['_minted-main/default.pygstyle', '_minted*/'], ['figures/.DS_Store', '.DS_Store'],
    ['main.tex', null], ['figures/plot.pdf', null], ['refs.bib', null], ['notes/log.md', null], ['main.aux.tex', null],
  ];
  for (const [file, pattern] of cases) assert.equal(ignorePattern(file), pattern, file);
});

test('a reply becomes a commit message without its fence, label, quotes or final period', () => {
  assert.equal(commitMessageFrom('Tighten the abstract.'), 'Tighten the abstract');
  assert.equal(commitMessageFrom('```\nTighten the abstract\n```'), 'Tighten the abstract');
  assert.equal(commitMessageFrom('**Commit message:** "Tighten the abstract"'), 'Tighten the abstract');
  assert.equal(commitMessageFrom('`Fix a typo in Lemma 2`'), 'Fix a typo in Lemma 2');
  assert.equal(commitMessageFrom('\n# Rework the method section\n\nThe proof of Theorem 1 now comes before its use.\nThe notation follows Section 2.\n'), 'Rework the method section\n\nThe proof of Theorem 1 now comes before its use.\nThe notation follows Section 2.');
  assert.equal(commitMessageFrom('  \n '), '');
});
