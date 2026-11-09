import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexBinary, codexCandidates } from '../src/server/codex-binary.ts';
import { Codex } from '../src/server/codex.ts';

// A stand-in Codex that only reports its version.
function fakeCodex(dir: string, version: string) {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') { fs.writeFileSync(path.join(dir, 'codex.cmd'), `@echo codex-cli ${version}\r\n`); return path.join(dir, 'codex.cmd'); }
  fs.writeFileSync(path.join(dir, 'codex'), `#!/bin/sh\necho "codex-cli ${version}"\n`, { mode: 0o755 });
  return path.join(dir, 'codex');
}

test('Papilot uses the first Codex on this computer that runs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codex-')), data = path.join(root, 'data');
  // Only the given folder: the host's own Codex must not answer for the test.
  const env = (dir: string): NodeJS.ProcessEnv => ({ PATH: dir, Path: dir, HOME: root, USERPROFILE: root, SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT });
  try {
    const none = path.join(root, 'empty'); fs.mkdirSync(none);
    // Standard install folders are searched too; a host with Codex there skips this part.
    if (!codexCandidates(env(none), data).length) {
      assert.equal(new Codex(undefined, undefined, env(none)).detect(), false, 'a missing Codex is not offered');
      await assert.rejects(codexBinary(env(none), data), /not found/);
    }
    assert.equal(await codexBinary({ ...env(none), PAPILOT_CODEX_BIN: '/configured/codex' }, data), '/configured/codex');

    const recent = fakeCodex(path.join(root, 'recent'), '0.170.0');
    assert.equal(await codexBinary(env(path.dirname(recent)), data), recent);

    const old = fakeCodex(path.join(root, 'old'), '0.1.0');
    assert.equal(await codexBinary(env(path.dirname(old)), data), old, 'any version that runs is used');
    const broken = path.join(root, 'broken'); fs.mkdirSync(broken);
    if (process.platform === 'win32') fs.writeFileSync(path.join(broken, 'codex.cmd'), '@exit /b 1\r\n');
    else fs.writeFileSync(path.join(broken, 'codex'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    assert.equal(new Codex(undefined, undefined, env(broken)).detect(), true, 'a broken Codex is offered, to say why it cannot be used');
    await assert.rejects(codexBinary(env(broken), path.join(root, 'none')), /could not be run\. Reinstall Codex/);
    const both = [broken, path.dirname(recent)].join(path.delimiter);
    assert.equal(await codexBinary(env(both), data), recent, 'a working Codex later on PATH is used');
    const own = fakeCodex(path.join(data, 'agents/node_modules/.bin'), '0.164.0');
    assert.equal(await codexBinary(env(broken), data), own, 'the copy papilot codex login installed still counts');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
