import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexBinary, codexCandidates, firstRunnable } from '../src/server/codex-binary.ts';
import { Codex } from '../src/server/codex.ts';

const POSIX = process.platform !== 'win32';
// A stand-in Codex that reports a version, or fails like a broken installation.
function fakeCodex(dir: string, version: string | null, delay = 0) {
  fs.mkdirSync(dir, { recursive: true });
  if (!POSIX) { fs.writeFileSync(path.join(dir, 'codex.cmd'), version ? `@echo codex-cli ${version}\r\n` : '@exit /b 1\r\n'); return path.join(dir, 'codex.cmd'); }
  fs.writeFileSync(path.join(dir, 'codex'), `#!/bin/sh\n${delay ? `sleep ${delay}\n` : ''}${version ? `echo "codex-cli ${version}"` : 'exit 1'}\n`, { mode: 0o755 });
  return path.join(dir, 'codex');
}
// Only the given folders: the host's own Codex must not answer for the test.
const env = (root: string, ...dirs: string[]): NodeJS.ProcessEnv => ({ PATH: dirs.join(path.delimiter), Path: dirs.join(path.delimiter), HOME: root, USERPROFILE: root,
  SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT });

test('the first Codex that runs is used, whatever its version', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codex-'));
  try {
    const broken = fakeCodex(path.join(root, 'broken'), null), old = fakeCodex(path.join(root, 'old'), '0.1.0'), recent = fakeCodex(path.join(root, 'recent'), '0.170.0');
    const plain = env(root);
    assert.equal(await firstRunnable([broken, old, recent], plain), old, 'a broken installation is skipped; no version is required');
    assert.equal(await firstRunnable([broken], plain), null);
    assert.equal(await codexBinary({ ...plain, PAPILOT_CODEX_BIN: '/configured/codex' }), '/configured/codex', 'the npm command chose already');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Codex is looked for on PATH first, then in the checkout and the data folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codex-')), data = path.join(root, 'data'), checkout = path.join(root, 'checkout');
  try {
    const first = fakeCodex(path.join(root, 'a'), null), second = fakeCodex(path.join(root, 'b'), '0.170.0');
    const dev = fakeCodex(path.join(checkout, 'node_modules/.bin'), '0.164.0'), own = fakeCodex(path.join(data, 'agents/node_modules/.bin'), '0.164.0');
    const found = codexCandidates(env(root, path.dirname(first), path.dirname(second)), data, checkout);
    // Standard install folders (Homebrew, /usr/local/bin) sit between PATH and the copies.
    assert.deepEqual(found.slice(0, 2), [first, second]);
    assert.ok(found.indexOf(dev) > 1 && found.indexOf(own) > found.indexOf(dev));
    const none = path.join(root, 'empty'); fs.mkdirSync(none);
    if (!codexCandidates(env(root, none), path.join(root, 'nothing'), path.join(root, 'nothing')).length) {
      assert.equal(new Codex(undefined, undefined, env(root, none)).detect(), false, 'a missing Codex is not offered');
      await assert.rejects(codexBinary(env(root, none), path.join(root, 'nothing')), /not found on this computer/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stopping Codex while it looks for an installation starts no app-server', { skip: !POSIX && 'uses a POSIX sleep' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codex-'));
  try {
    const slow = fakeCodex(path.join(root, 'slow'), '0.170.0', 1);
    const codex = new Codex(undefined, undefined, env(root, path.dirname(slow)));
    const starting = codex.start();
    codex.close();
    await starting;
    assert.equal(codex.child, null);
    assert.equal(codex.ready, false);
    await assert.rejects(codex.request('account/read', {}), /not connected/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
