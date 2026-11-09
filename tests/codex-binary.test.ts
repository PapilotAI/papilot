import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { killTree } from '../bin/agent-paths.mjs';
import { codexBinary, codexCandidates, firstRunnable, resolveCodex } from '../src/server/codex-binary.ts';
import { Codex } from '../src/server/codex.ts';

const POSIX = process.platform !== 'win32';
// A stand-in Codex that reports a version, or fails like a broken installation.
function fakeCodex(dir: string, version: string | null, delay = 0) {
  fs.mkdirSync(dir, { recursive: true });
  if (!POSIX) { fs.writeFileSync(path.join(dir, 'codex.cmd'), version ? `@echo codex-cli ${version}\r\n` : '@exit /b 1\r\n'); return path.join(dir, 'codex.cmd'); }
  fs.writeFileSync(path.join(dir, 'codex'), `#!/bin/sh\n${delay ? `/bin/sleep ${delay}\n` : ''}${version ? `echo "codex-cli ${version}"` : 'exit 1'}\n`, { mode: 0o755 });
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
    assert.equal(await firstRunnable([path.join(root, 'absent'), recent], plain), recent, 'a spawn error is skipped');
    assert.equal(await resolveCodex([broken, old, recent], plain), old);
    await assert.rejects(resolveCodex([], plain), /not found on this computer/);
    await assert.rejects(resolveCodex([broken], plain), /could not be run/);
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
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stopping Codex while it looks for an installation starts no app-server', { skip: !POSIX && 'uses a POSIX sleep' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codex-'));
  try {
    const slow = fakeCodex(path.join(root, 'slow'), '0.170.0', 1);
    const codex = new Codex(undefined, undefined, env(root, path.dirname(slow)));
    const starting = codex.start();
    codex.close();
    await assert.rejects(starting, { message: 'Codex is not connected.' });
    assert.equal(codex.child, null);
    assert.equal(codex.ready, false);
    await assert.rejects(codex.request('account/read', {}), /not connected/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check() && Date.now() < deadline) await delay(10);
  assert.ok(check(), 'the child process reached the expected state');
}

test('a Codex wrapper with a waiting child times out and the next installation is tried', { skip: !POSIX && 'uses a POSIX process group', timeout: 12000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codex-'));
  const pids = path.join(root, 'pids'), wrapper = path.join(root, 'codex');
  try {
    fs.writeFileSync(wrapper, `#!/bin/sh\n/bin/sleep 30 &\necho "$$ $!" > "$PROBE_PIDS"\nwait\n`, { mode: 0o755 });
    const working = fakeCodex(path.join(root, 'working'), '0.1.0');
    const started = Date.now();
    assert.equal(await firstRunnable([wrapper, working], { ...env(root), PROBE_PIDS: pids }, 2500), working);
    assert.ok(Date.now() - started < 8000, 'the wrapper cannot hold the lookup open');
    const children = fs.readFileSync(pids, 'utf8').trim().split(' ').map(Number);
    assert.equal(children.length, 2);
    await waitFor(() => children.every(pid => { try { process.kill(pid, 0); return false; } catch { return true; } }));
  } finally {
    if (fs.existsSync(pids)) killTree(Number(fs.readFileSync(pids, 'utf8').split(' ')[0]), 'SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('starting Codex again during a stopped lookup launches afresh and retains the new promise', { skip: !POSIX && 'uses a POSIX executable', timeout: 10000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codex-'));
  const probes = path.join(root, 'probes'), launches = path.join(root, 'launches');
  const codex = new Codex(undefined, undefined, env(root, root));
  let first: Promise<void> | undefined, second: Promise<void> | undefined;
  const pids = () => fs.existsSync(probes) ? fs.readFileSync(probes, 'utf8').trim().split('\n') : [];
  try {
    fs.writeFileSync(path.join(root, 'codex'), `#!${process.execPath}
      const fs = require('node:fs'), readline = require('node:readline');
      if (process.argv.includes('--version')) {
        fs.appendFileSync(${JSON.stringify(probes)}, process.pid + '\\n');
        const timer = setInterval(() => {
          if (fs.existsSync(${JSON.stringify(root)} + '/' + process.pid)) { clearInterval(timer); process.exit(0); }
        }, 10);
      } else {
        fs.appendFileSync(${JSON.stringify(launches)}, 'launch\\n');
        readline.createInterface({ input: process.stdin }).on('line', line => {
          const message = JSON.parse(line);
          if (message.id !== undefined) console.log(JSON.stringify({ id: message.id, result: {} }));
        });
      }
    `, { mode: 0o755 });
    first = codex.start();
    const stopped = assert.rejects(first, { message: 'Codex is not connected.' });
    await waitFor(() => pids().length === 1);
    codex.close();
    second = codex.start();
    assert.notEqual(first, second);
    await waitFor(() => pids().length === 2);
    fs.writeFileSync(path.join(root, pids()[0]), '');
    await stopped;
    assert.equal(codex.child, null, 'the stale lookup starts no app-server');
    assert.equal(codex.start(), second, 'a stale finally must not clear the new launch');
    fs.writeFileSync(path.join(root, pids()[1]), '');
    await second;
    assert.equal(codex.ready, true);
    assert.equal(fs.readFileSync(launches, 'utf8'), 'launch\n');
  } finally {
    codex.close();
    for (const pid of pids()) fs.writeFileSync(path.join(root, pid), '');
    await Promise.allSettled([first, second]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
