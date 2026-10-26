import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { registerFrontend } from '../src/server/frontend.ts';

test('frontend rebuilds serve new assets without a restart and missing assets never return HTML', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-frontend-'));
  const app = Fastify();
  try {
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'index.html'), '<html>old build</html>');
    fs.writeFileSync(path.join(root, 'assets/old.js'), 'export const version = 1;');
    app.get('/api/health', () => ({ ok: true }));
    await registerFrontend(app, root);
    await app.ready();
    fs.writeFileSync(path.join(root, 'index.html'), '<html>new build</html>');
    fs.writeFileSync(path.join(root, 'assets/new.js'), 'export const version = 2;');
    fs.unlinkSync(path.join(root, 'assets/old.js'));
    const asset = await app.inject('/assets/new.js');
    assert.equal(asset.statusCode, 200);
    assert.match(asset.headers['content-type']!, /javascript/);
    assert.match(asset.body, /version = 2/);
    for (const url of ['/assets/old.js', '/assets/missing.js?v=2', '/api/missing', '/review/missing']) {
      const missing = await app.inject(url);
      assert.equal(missing.statusCode, 404, url);
      assert.match(missing.headers['content-type']!, /json/);
    }
    assert.equal((await app.inject('/')).body, '<html>new build</html>');
    assert.equal((await app.inject('/workspace')).body, '<html>new build</html>');
    assert.deepEqual((await app.inject('/api/health')).json(), { ok: true });
  } finally { await app.close(); fs.rmSync(root, { recursive: true }); }
});
