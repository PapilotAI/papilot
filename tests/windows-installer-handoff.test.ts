import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const windows = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
test('Windows installer handoff validates ownership, parent exit and artifact before installing', windows, t => {
  const fixture = fileURLToPath(new URL('./fixtures/windows-installer-handoff.ps1', import.meta.url));
  const helper = fileURLToPath(new URL('../desktop/windows-update.ps1', import.meta.url));
  const powershell = path.join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  for (const scenario of ['success', 'digest', 'unconfirmed', 'parent']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-windows-handoff-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture,
      '-Helper', helper, '-FixtureRoot', root, '-Scenario', scenario], {
      encoding: 'utf8', timeout: 30_000, windowsHide: true,
      env: { ...process.env, PSModulePath: path.join(path.dirname(powershell), 'Modules') },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.handoffExists, false);
    assert.equal(report.lockExists, scenario === 'unconfirmed');
    assert.equal(report.artifactExists, scenario === 'unconfirmed');
    assert.equal(report.status.channel, 'stable');
    if (scenario === 'success') {
      assert.equal(report.status.phase, 'updated');
      assert.equal(report.status.currentVersion, '0.14.1');
      assert.deepEqual(report.calls, [
        { kind: 'installer', arguments: '/S /currentuser', wait: true, hidden: true },
        { kind: 'reopen', workingDirectory: path.join(root, 'Registered App') },
      ]);
    } else if (scenario === 'unconfirmed') {
      assert.equal(report.status.phase, 'restarting');
      assert.deepEqual(report.calls, []);
    } else {
      assert.equal(report.status.phase, 'failed');
      assert.equal(report.status.currentVersion, '0.10.4');
      assert.match(report.status.error, scenario === 'digest' ? /SHA-256/ : /did not close/);
      assert.deepEqual(report.calls, scenario === 'digest' ? [{ kind: 'reopen', workingDirectory: path.join(root, 'Registered App') }] : []);
    }
  }
});
