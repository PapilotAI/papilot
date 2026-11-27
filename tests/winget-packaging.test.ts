import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderWingetManifests, stableWindowsInstaller, WINGET_PACKAGE_ID } from '../scripts/prepare-winget.mts';

test('WinGet packaging validates the stable Windows installer and renders 1.10.0 manifests', () => {
  const tag = 'v0.14.1';
  const manifest = JSON.stringify({ version: '0.14.1' });
  const digest = 'e'.repeat(64);
  const release = {
    tagName: tag,
    isDraft: false,
    isPrerelease: false,
    publishedAt: '2026-11-23T15:59:04Z',
    assets: [
      {
        name: 'desktop.json',
        state: 'uploaded',
        size: 284,
        digest: 'sha256:' + createHash('sha256').update(manifest).digest('hex'),
      },
      {
        name: 'Papilot-0.14.1-win-x64.exe',
        state: 'uploaded',
        size: 220_346_650,
        digest: 'sha256:' + digest,
      },
    ],
  };

  const asset = stableWindowsInstaller(tag, release, manifest);
  assert.deepEqual(asset, { version: '0.14.1', sha256: digest });
  assert.throws(() => stableWindowsInstaller('v0.14.1-dev', release, manifest), /stable release tag/);
  assert.throws(() => stableWindowsInstaller(tag, { ...release, assets: release.assets.slice(0, 1) }, manifest), /win-x64.exe/);

  const files = renderWingetManifests(asset.version, asset.sha256);
  assert.deepEqual(Object.keys(files).sort(), [
    `${WINGET_PACKAGE_ID}.installer.yaml`,
    `${WINGET_PACKAGE_ID}.locale.en-US.yaml`,
    `${WINGET_PACKAGE_ID}.yaml`,
  ]);
  assert.match(files[`${WINGET_PACKAGE_ID}.yaml`], /^PackageVersion: 0\.14\.1$/m);
  assert.match(files[`${WINGET_PACKAGE_ID}.installer.yaml`], /^InstallerType: nullsoft$/m);
  assert.match(files[`${WINGET_PACKAGE_ID}.installer.yaml`], /^Scope: user$/m);
  assert.match(files[`${WINGET_PACKAGE_ID}.installer.yaml`], new RegExp(`InstallerSha256: ${'E'.repeat(64)}`));
  assert.match(
    files[`${WINGET_PACKAGE_ID}.installer.yaml`],
    /InstallerUrl: https:\/\/github\.com\/PapilotAI\/papilot\/releases\/download\/v0\.14\.1\/Papilot-0\.14\.1-win-x64\.exe/,
  );
  assert.match(files[`${WINGET_PACKAGE_ID}.locale.en-US.yaml`], /^License: MIT$/m);
});
