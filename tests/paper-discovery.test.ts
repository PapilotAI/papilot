import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { discoverPapers } from '../src/server/paper-discovery.ts';

const paper = '\\documentclass{article}\n\\begin{document}\nPaper.\n\\end{document}\n';
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-discovery-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file: string, text = paper) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  const git = (folder: string, ...args: string[]) => execFileSync('git', ['-C', path.join(root, folder), ...args], { encoding: 'utf8', stdio: 'pipe' });
  return { root, write, git };
}
test('discovery finds deep root documents, excludes chapters, comments, ignored files and missing files without changing Git', async t => {
  const { root, write, git } = fixture(t);
  write('papers/thesis/main.tex'); write('slides/talk.TEX'); write('sections/chapter.tex', 'A chapter.');
  write('commented.tex', '% \\documentclass{article}\n% \\begin{document}\n');
  write('ignored.tex'); write('.gitignore', 'ignored.tex\n');
  git('', 'init', '-q');
  const before = git('', 'status', '--porcelain');
  const found = await discoverPapers([{ path: root, files: ['papers/thesis/main.tex', 'slides/talk.TEX', 'sections/chapter.tex', 'commented.tex', 'ignored.tex', 'missing.tex', '../escape.tex'] }]);
  assert.deepEqual(found.map(p => p.main), ['papers/thesis/main.tex', 'slides/talk.TEX']);
  assert.ok(found.every(p => p.root === root));
  assert.equal(git('', 'status', '--porcelain'), before);
  assert.equal(fs.existsSync(path.join(root, '.git/papilot')), false);
});
test('overlapping folders share their repository and nested repositories stay separate', async t => {
  const { root, write, git } = fixture(t);
  write('docs/main.tex'); write('nested/talk.tex');
  git('', 'init', '-q'); git('nested', 'init', '-q');
  const found = await discoverPapers([
    { path: root, files: ['docs/main.tex', 'nested/talk.tex'] },
    { path: path.join(root, 'docs'), files: ['main.tex'] },
  ]);
  assert.deepEqual(found.map(p => [p.root, p.main]), [[root, 'docs/main.tex'], [path.join(root, 'nested'), 'talk.tex']]);
});
test('plain folders remain untouched and symbolic links cannot escape the search scope', async t => {
  const { root, write } = fixture(t);
  write('workspace/main.tex'); write('outside.tex');
  if (process.platform !== 'win32') fs.symlinkSync(path.join(root, 'outside.tex'), path.join(root, 'workspace/link.tex'));
  const folder = path.join(root, 'workspace');
  assert.deepEqual(await discoverPapers([{ path: folder, files: ['main.tex', 'link.tex', '../outside.tex', path.join(root, 'outside.tex')] }]), [
    { root: folder, main: 'main.tex', file: path.join(folder, 'main.tex') },
  ]);
  assert.equal(fs.existsSync(path.join(folder, '.git')), false);
});
test('unreadable sources do not hide the other papers', async t => {
  const { root, write } = fixture(t);
  write('unreadable.tex'); write('main.tex');
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (...args: Parameters<typeof open>) => {
    if (args[0] === path.join(root, 'unreadable.tex')) throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    return open(...args);
  });
  assert.deepEqual((await discoverPapers([{ path: root, files: ['unreadable.tex', 'main.tex'] }])).map(p => p.main), ['main.tex']);
});
