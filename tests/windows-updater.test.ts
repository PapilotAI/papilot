import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const windows = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
const fixture = fileURLToPath(new URL('./fixtures/windows-updater.ps1', import.meta.url));
const updater = fileURLToPath(new URL('../scripts/update-windows.ps1', import.meta.url));
const release = { kind: 'release' as const, uri: 'https://api.github.com/repos/PapilotAI/papilot/releases/latest' };
const download = {
  kind: 'download' as const,
  uri: 'https://github.com/PapilotAI/papilot/releases/download/v0.14.1/Papilot-0.14.1-win-x64.exe',
  basicParsing: true,
};

type Install = {
  kind: 'install';
  path: string;
  arguments: string[];
  downloaded: boolean;
  passThru: boolean;
  wait: boolean;
  windowStyle: string;
};

type Report = {
  error: string | null;
  output: string[];
  events: (typeof release | typeof download | Install)[];
  processChecks: number;
  installedVersion: string;
  registeredDirectory: string;
  downloadRemains: boolean;
};

function runUpdater(t: TestContext, options: object = {}): Report & { installDirectory: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-windows-updater-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installDirectory = path.join(root, 'Papilot with spaces');
  fs.mkdirSync(installDirectory);
  fs.writeFileSync(path.join(installDirectory, 'Papilot.exe'), 'installed executable fixture');
  const powershell = path.join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture,
    '-Updater', updater, '-FixtureRoot', root], {
    encoding: 'utf8', timeout: 30_000, windowsHide: true, env: {
      ...process.env, TEMP: root, TMP: root, PSModulePath: path.join(path.dirname(powershell), 'Modules'),
      PAPILOT_UPDATER_FIXTURE: JSON.stringify({ installedVersion: '0.9.9.0', ...options }),
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report: Report = JSON.parse(result.stdout);
  return { ...report, installDirectory };
}

test('Windows updater reports a newer stable version without installing it in check-only mode', windows, t => {
  const report = runUpdater(t, { checkOnly: true });
  assert.equal(report.error, null);
  assert.match(report.output.join('\n'), /0\.9\.9.*0\.14\.1.*update available/i);
  assert.deepEqual(report.events, [release]);
  assert.equal(report.installedVersion, '0.9.9.0');
});

test('Windows updater leaves current and newer installations alone', windows, t => {
  for (const installedVersion of ['0.14.1.0', '0.14.10.0']) {
    const report = runUpdater(t, { installedVersion, running: true });
    assert.equal(report.error, null);
    assert.match(report.output.join('\n'), /up to date/i);
    assert.deepEqual(report.events, [release]);
    assert.equal(report.installedVersion, installedVersion);
  }
});

test('Windows updater rechecks the installed version before downloading', windows, t => {
  const report = runUpdater(t, { updateDuringRelease: true });
  assert.equal(report.error, null);
  assert.match(report.output.join('\n'), /0\.14\.2.*up to date/i);
  assert.deepEqual(report.events, [release]);
  assert.equal(report.installedVersion, '0.14.2.0');
});

test('Windows updater installs the verified NSIS asset in the registered directory', windows, t => {
  const report = runUpdater(t);
  assert.equal(report.error, null);
  assert.deepEqual(report.events.slice(0, 2), [release, download]);
  const installer = report.events[2];
  assert.ok(installer?.kind === 'install');
  assert.deepEqual(installer.arguments, ['/S /currentuser']);
  assert.equal(installer.downloaded, true);
  assert.equal(installer.wait, true);
  assert.equal(installer.passThru, true);
  assert.equal(installer.windowStyle, 'Hidden');
  assert.equal(report.processChecks, 2);
  assert.equal(report.installedVersion, '0.14.1.0');
  assert.equal(report.registeredDirectory, report.installDirectory);
  assert.equal(report.downloadRemains, false);
  assert.ok(report.output.join('\n').includes(`in ${report.installDirectory}`));
  assert.match(report.output.join('\n'), /Updated Papilot from 0\.9\.9.* to 0\.14\.1/i);
});

test('Windows updater skips installation if a newer version was installed during download', windows, t => {
  const report = runUpdater(t, { updateDuringDownload: true });
  assert.equal(report.error, null);
  assert.match(report.output.join('\n'), /0\.14\.2.*up to date/i);
  assert.deepEqual(report.events, [release, download]);
  assert.equal(report.installedVersion, '0.14.2.0');
  assert.equal(report.downloadRemains, false);
});

test('Windows updater aborts if the registered installation folder moves during download', windows, t => {
  const report = runUpdater(t, { moveDuringDownload: true });
  assert.match(report.error ?? '', /installation folder changed during download/i);
  assert.deepEqual(report.events, [release, download]);
  assert.equal(report.registeredDirectory, path.join(path.dirname(report.installDirectory), 'Moved Papilot'));
  assert.equal(report.installedVersion, '0.9.9.0');
  assert.equal(report.downloadRemains, false);
});

test('Windows updater rejects a download with the wrong SHA-256 before launching it', windows, t => {
  const report = runUpdater(t, { invalidDigest: true });
  assert.match(report.error ?? '', /SHA-256 does not match/i);
  assert.deepEqual(report.events, [release, download]);
  assert.equal(report.installedVersion, '0.9.9.0');
  assert.equal(report.downloadRemains, false);
});

test('Windows updater reports installer and post-install verification failures', windows, t => {
  for (const [options, error] of [
    [{ installerExitCode: 23 }, /23/],
    [{ leaveInstalledVersion: true }, /0\.14\.1/],
  ] as const) {
    const report = runUpdater(t, options);
    assert.match(report.error ?? '', error);
    assert.deepEqual(report.events.map(event => event.kind), ['release', 'download', 'install']);
    assert.equal(report.installedVersion, '0.9.9.0');
    assert.equal(report.downloadRemains, false);
  }
});

test('Windows updater does not install while Papilot is running', windows, t => {
  for (const [options, events] of [
    [{ running: true }, [release]],
    [{ startDuringDownload: true }, [release, download]],
  ] as const) {
    const report = runUpdater(t, options);
    assert.match(report.error ?? '', /close.*Papilot|Papilot.*running/i);
    assert.deepEqual(report.events, events);
    assert.equal(report.downloadRemains, false);
  }
});
