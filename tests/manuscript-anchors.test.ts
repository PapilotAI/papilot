import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { opcodes } from '../engine/src/core/diff.ts';
import { PdfDocument } from '../engine/src/render/pdf.ts';
import { Manuscripts } from '../src/server/manuscript.ts';
import { Store } from '../src/server/store.ts';
import { captureAnchor, resolveAnchors, followAnchor, isSourceAnchor } from '../src/server/manuscript-anchors.ts';

test('source anchors follow insertions, local edits and moved passages, and refuse deletion or uncertain replacements', () => {
  const before = ['heading', '', 'A unique paragraph.', 'Its second line.', '', 'end'];
  const follow = (after: string[]) => followAnchor(before, after, [3, 4], opcodes(before, after));
  assert.deepEqual(follow(['new', ...before]), [4, 5]);
  assert.deepEqual(follow([...before.slice(0, 2), 'A changed paragraph.', ...before.slice(3)]), [3, 4]);
  assert.deepEqual(follow(['heading', '', '', 'end', '', ...before.slice(2, 4)]), [6, 7]);
  assert.equal(follow(['heading', '', '', 'end']), null);
  assert.equal(follow(['replacement of heading and passage', 'end']), null);
  assert.equal(followAnchor(before, before, [3, 4], null), null, 'a timed-out diff never falls back to old lines');
  const repeated = ['start', 'same', '', 'middle', 'same', '', 'end'];
  assert.deepEqual(followAnchor(repeated, ['insert', ...repeated], [5, 5], opcodes(repeated, ['insert', ...repeated])), [6, 6], 'diff context disambiguates repeated text');
  const duplicate = ['start', 'same', 'middle', 'same', 'end'];
  const removed = ['start', 'middle', 'same', 'end'], changed = ['start', 'changed', 'middle', 'same', 'end'];
  assert.equal(followAnchor(duplicate, removed, [2, 2], opcodes(duplicate, removed)), null, 'a deleted occurrence must not attach to its surviving duplicate');
  assert.deepEqual(followAnchor(duplicate, changed, [2, 2], opcodes(duplicate, changed)), [2, 2], 'an edited occurrence must not attach to its unchanged duplicate');
  const adjacent = ['start', 'same', 'same', 'end'], survivor = ['start', 'same', 'end'];
  assert.equal(followAnchor(adjacent, survivor, [2, 2], opcodes(adjacent, survivor)), null, 'which identical adjacent line survived is ambiguous');
  assert.equal(followAnchor(survivor, adjacent, [2, 2], opcodes(survivor, adjacent)), null, 'which identical adjacent line was inserted is ambiguous');
  assert.equal(isSourceAnchor({ file: 'main.tex', revision: 'a'.repeat(64), lines: [1, 2] }), true);
  assert.equal(isSourceAnchor({ file: 'main.tex', revision: 'a'.repeat(64), lines: [0, 2] }), false);
});

let latex = false;
try { execFileSync('which', ['latexmk'], { stdio: 'ignore' }); latex = true; } catch { /* Native compilation is optional outside the TeX CI job. */ }

test('saved TeX anchors survive re-pagination, source edits, reopening and deletion without relying on the original build', { skip: !latex && 'needs latexmk and synctex', timeout: 180000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-source-anchors-')), root = path.join(temp, 'paper');
  fs.mkdirSync(path.join(root, 'sections'), { recursive: true });
  const sourceFile = path.join(root, 'sections/intro.tex'), main = path.join(root, 'main.tex');
  const original = '\\section{Introduction}\nOpening words.\n\nA unique paragraph about pelicans.\n\n\\begin{equation}\nE = mc^2\n\\end{equation}\n\nClosing words.\n';
  fs.writeFileSync(main, '\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n\\end{document}\n');
  fs.writeFileSync(sourceFile, original);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'Paper');
  const manuscripts = new Manuscripts(), file = path.join(temp, 'state.sqlite3');
  let store = new Store(file);
  store.saveProject({ id: 'paper', path: root, name: 'Paper', createdAt: 0 });
  const settle = async () => {
    for (let i = 0; i < 1200; i++) {
      const { build } = await manuscripts.state('paper', root);
      if (build.status !== 'building') { assert.equal(build.status, 'ready', build.error); return build.key!; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Compilation did not finish');
  };
  const search = (key: string, needle: string) => {
    const pdf = new PdfDocument(manuscripts.pdf('paper', key));
    try {
      for (let number = 0; number < pdf.length; number++) {
        const page = pdf.page(number), match = page.search(needle)[0];
        if (match) return { page: number, rect: [match[0] / page.width, match[1] / page.height, match[2] / page.width, match[3] / page.height] as [number, number, number, number] };
      }
      throw new Error('Text not found: ' + needle);
    } finally { pdf.close(); }
  };
  try {
    const first = await settle(), pelicans = search(first, 'pelicans'), equation = search(first, 'mc');
    const generated = { locate: async () => ({ compiled: { file: 'build/main.toc', input: path.join(temp, 'build/main.toc'), lines: [1, 1] } }) } as unknown as Manuscripts;
    assert.equal((await captureAnchor(generated, store, 'paper', first, pelicans.page, pelicans.rect, [], '')).source, null, 'generated auxiliary files are not a source binding in the editable paper');
    const source = (await captureAnchor(manuscripts, store, 'paper', first, pelicans.page, pelicans.rect, [pelicans.rect], 'pelicans')).source!;
    const formula = (await captureAnchor(manuscripts, store, 'paper', first, equation.page, equation.rect, [equation.rect], 'mc')).source!;
    assert.equal(source.file, 'sections/intro.tex'); assert.ok(formula);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM anchor_sources').get()!.n, 1, 'anchors share a durable source snapshot');
    store.db.close(); store = new Store(file);
    const anchors = [{ id: 'paragraph', source, near: 0 }, { id: 'formula', source: formula, near: 0 }];
    // An edit in a different TeX file changes pagination without changing the anchored file.
    fs.writeFileSync(main, fs.readFileSync(main, 'utf8').replace('\\input', 'Inserted page.\\newpage\n\\input'));
    fs.writeFileSync(sourceFile, '% inserted source lines\n\n' + original);
    await manuscripts.written('paper', root);
    const second = await settle();
    const positions = await resolveAnchors(manuscripts, store, 'paper', second, anchors);
    assert.deepEqual(positions.map(item => item.place?.page), [1, 1]);
    const newText = search(second, 'pelicans');
    assert.ok(positions[0].place!.rect[1] <= newText.rect[1] + .02 && positions[0].place!.rect[3] >= newText.rect[3] - .02);
    // Reading anchors needs only the current build and the durable snapshot.
    const currentOnly = { compiled: (project: string, key: string) => { assert.equal(key, second); return manuscripts.compiled(project, key); }, locate: manuscripts.locate.bind(manuscripts) } as Manuscripts;
    assert.equal((await resolveAnchors(currentOnly, store, 'paper', second, anchors))[0].place?.page, 1);
    assert.equal(store.anchorSource('another-project', source.revision), undefined, 'snapshots belong to their project');
    fs.writeFileSync(sourceFile, fs.readFileSync(sourceFile, 'utf8').replace('A unique paragraph about pelicans.', 'A revised paragraph about herons.'));
    await manuscripts.written('paper', root);
    const third = await settle();
    assert.equal((await resolveAnchors(manuscripts, store, 'paper', third, anchors))[0].place?.page, 1, 'an edit to the anchored source line stays attached');
    fs.writeFileSync(sourceFile, fs.readFileSync(sourceFile, 'utf8').replace('A revised paragraph about herons.', '% A revised paragraph about herons.'));
    await manuscripts.written('paper', root);
    const commented = await settle();
    assert.equal((await resolveAnchors(manuscripts, store, 'paper', commented, anchors))[0].place, null, 'commented-out source cannot jump to the nearest printed line');
    fs.writeFileSync(sourceFile, fs.readFileSync(sourceFile, 'utf8').replace('A revised paragraph about herons.\n', ''));
    await manuscripts.written('paper', root);
    const fourth = await settle();
    const deleted = await resolveAnchors(manuscripts, store, 'paper', fourth, anchors);
    assert.equal(deleted[0].place, null, 'deleted content cannot jump to an unrelated line');
    assert.equal(deleted[1].place?.page, 1, 'other anchors still resolve');
    const long = Array.from({ length: 160 }, (_, index) => `${index === 120 ? 'TargetSentinel' : 'Sentence'} ${index} describes how birds glide across the water and return to the distant shore.`).join(' ') + '\n';
    fs.writeFileSync(sourceFile, long); await manuscripts.written('paper', root);
    const longKey = await settle(), target = search(longKey, 'TargetSentinel');
    assert.ok(target.page > 1, 'the same TeX line spans multiple pages');
    const longAnchor = (await captureAnchor(manuscripts, store, 'paper', longKey, target.page, target.rect, [target.rect], 'TargetSentinel')).source!;
    fs.writeFileSync(main, fs.readFileSync(main, 'utf8').replace('\\input', 'Another inserted page.\\newpage\n\\input'));
    await manuscripts.written('paper', root); const paginated = await settle();
    const longPlace = (await resolveAnchors(manuscripts, store, 'paper', paginated, [{ id: 'long', source: longAnchor, near: target.page }]))[0].place;
    assert.equal(longPlace?.page, target.page + 1, 'a quote distinguishes the passage inside a source line that spans pages');
    store.removeProject('paper');
    assert.equal(store.anchorSource('paper', source.revision), undefined);
  } finally { store.db.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});
