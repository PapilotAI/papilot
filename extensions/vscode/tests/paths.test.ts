import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inside, routePath, sourcePath } from '../src/paths.ts';
test('bridge paths cannot become arbitrary URLs or traversal requests', () => {
  assert.equal(routePath('/api/projects/p/manuscript?document=slides%2Fmain.tex'), '/api/projects/p/manuscript');
  for (const value of ['https://example.com', '//example.com', '/api/../secrets', '/api/%2e%2e/secrets', '/api/x\\secret', '/api/x#fragment']) assert.throws(() => routePath(value));
  assert.equal(inside('/tmp/paper', '/tmp/paper/../paper-other/file'), false);
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
