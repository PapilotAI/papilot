import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inside, insideReal, routePath, sourcePath } from '../src/paths.ts';
test('bridge paths cannot become arbitrary URLs or traversal requests', () => {
  assert.equal(routePath('/api/projects/p/manuscript?document=slides%2Fmain.tex'), '/api/projects/p/manuscript');
  for (const value of ['https://example.com', '//example.com', '/api/../secrets', '/api/%2e%2e/secrets', '/api/x\\secret', '/api/x#fragment']) assert.throws(() => routePath(value));
  assert.equal(inside('/tmp/paper', '/tmp/paper/../paper-other/file'), false);
});
test('canonical containment recognizes directory and file aliases, including deleted buffers', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'papilot-aliases-'));
  try {
    const root = path.join(base, 'paper'), alias = path.join(base, 'alias');
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'main.tex'), 'paper');
    await fs.symlink(root, alias, 'dir');
    await fs.symlink(path.join(root, 'main.tex'), path.join(base, 'alias.tex'));
    await fs.writeFile(path.join(base, 'outside.tex'), 'outside');
    await fs.symlink(path.join(base, 'outside.tex'), path.join(root, 'outside.tex'));
    assert.equal(await insideReal(root, path.join(alias, 'main.tex')), true);
    assert.equal(await insideReal(alias, path.join(root, 'main.tex')), true);
    assert.equal(await insideReal(root, path.join(base, 'alias.tex')), true);
    await fs.unlink(path.join(root, 'main.tex'));
    assert.equal(await insideReal(root, path.join(base, 'alias.tex')), true, 'a dirty file alias retains its target after deletion');
    assert.equal(await insideReal(root, path.join(alias, 'deleted', 'chapter.tex')), true);
    assert.equal(await insideReal(root, path.join(base, 'paper-other', 'main.tex')), false);
    assert.equal(await insideReal(root, path.join(root, 'outside.tex')), false);
    await fs.symlink('loop.tex', path.join(root, 'loop.tex'));
    await assert.rejects(insideReal(root, path.join(root, 'loop.tex')), { code: 'ELOOP' });
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});
test('native source navigation refuses symlinks outside the repository', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'papilot-navigation-'));
  try {
    const root = path.join(base, 'paper'); await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'main.tex'), 'paper'); await fs.writeFile(path.join(base, 'secret'), 'outside');
    await fs.symlink(path.join(base, 'secret'), path.join(root, 'escape.tex'));
    assert.equal(await sourcePath(root, 'main.tex'), path.join(root, 'main.tex'));
    await assert.rejects(sourcePath(root, '../secret'), /outside/);
    await assert.rejects(sourcePath(root, 'escape.tex'), /outside/);
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});
