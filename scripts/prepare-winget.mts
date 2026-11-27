import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyStableRelease, type ReleaseMetadata } from './stable-release.mts';

export const WINGET_PACKAGE_ID = 'PapilotAI.Papilot';
export const WINGET_MANIFEST_VERSION = '1.10.0';

export function renderWingetManifests(version: string, sha256: string) {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid version: ${version}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error(`Invalid SHA-256 digest: ${sha256}`);
  }
  const upperSha = sha256.toUpperCase();
  const installerUrl = `https://github.com/PapilotAI/papilot/releases/download/v${version}/Papilot-${version}-win-x64.exe`;
  const releaseNotesUrl = `https://github.com/PapilotAI/papilot/releases/tag/v${version}`;

  const versionYaml = [
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.${WINGET_MANIFEST_VERSION}.schema.json`,
    `PackageIdentifier: ${WINGET_PACKAGE_ID}`,
    `PackageVersion: ${version}`,
    'DefaultLocale: en-US',
    'ManifestType: version',
    `ManifestVersion: ${WINGET_MANIFEST_VERSION}`,
    '',
  ].join('\n');

  const installerYaml = [
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.${WINGET_MANIFEST_VERSION}.schema.json`,
    `PackageIdentifier: ${WINGET_PACKAGE_ID}`,
    `PackageVersion: ${version}`,
    'InstallerLocale: en-US',
    'InstallerType: nullsoft',
    'Scope: user',
    'InstallModes:',
    '  - interactive',
    '  - silent',
    'UpgradeBehavior: install',
    'Protocols:',
    '  - papilot',
    'Installers:',
    '  - Architecture: x64',
    `    InstallerUrl: ${installerUrl}`,
    `    InstallerSha256: ${upperSha}`,
    'ManifestType: installer',
    `ManifestVersion: ${WINGET_MANIFEST_VERSION}`,
    '',
  ].join('\n');

  const localeYaml = [
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.${WINGET_MANIFEST_VERSION}.schema.json`,
    `PackageIdentifier: ${WINGET_PACKAGE_ID}`,
    `PackageVersion: ${version}`,
    'PackageLocale: en-US',
    'Publisher: PapilotAI',
    'PublisherUrl: https://papilot.ai',
    'PublisherSupportUrl: https://github.com/PapilotAI/papilot/issues',
    'Author: Cui Chen',
    'PackageName: Papilot',
    'PackageUrl: https://papilot.ai',
    'License: MIT',
    'LicenseUrl: https://github.com/PapilotAI/papilot/blob/main/LICENSE',
    'Copyright: Copyright (c) 2026 Cui Chen',
    'ShortDescription: AI LaTeX editor for annotating PDFs and reviewing typeset diffs',
    'Description: Papilot is an AI workspace for academic papers. Annotate PDFs directly, review typeset before-and-after diffs, sync live with Overleaf, and work with Claude Code, Codex, Cursor, Copilot, and more.',
    'Moniker: papilot',
    'Tags:',
    '  - academic',
    '  - ai',
    '  - editor',
    '  - latex',
    '  - overleaf',
    '  - pdf',
    '  - research',
    '  - writing',
    `ReleaseNotesUrl: ${releaseNotesUrl}`,
    'Documentations:',
    '  - DocumentLabel: User Guide',
    '    DocumentUrl: https://github.com/PapilotAI/papilot/blob/main/docs/guide.md',
    'ManifestType: defaultLocale',
    `ManifestVersion: ${WINGET_MANIFEST_VERSION}`,
    '',
  ].join('\n');

  return {
    [`${WINGET_PACKAGE_ID}.yaml`]: versionYaml,
    [`${WINGET_PACKAGE_ID}.installer.yaml`]: installerYaml,
    [`${WINGET_PACKAGE_ID}.locale.en-US.yaml`]: localeYaml,
  };
}

export function stableWindowsInstaller(tag: string, release: ReleaseMetadata, manifest: string | Buffer) {
  const { version, assetDigest } = verifyStableRelease(tag, release, manifest);
  return { version, sha256: assetDigest(`Papilot-${version}-win-x64.exe`) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tag, metadataFile, manifestFile, outputDir] = process.argv.slice(2);
  if (!outputDir) {
    throw new Error('Provide a tag, release JSON, desktop manifest, and output directory.');
  }
  const { version, sha256 } = stableWindowsInstaller(
    tag,
    JSON.parse(fs.readFileSync(metadataFile, 'utf8')),
    fs.readFileSync(manifestFile),
  );
  const files = renderWingetManifests(version, sha256);
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(outputDir, name), content);
  }
  console.log(`Generated WinGet manifests for ${WINGET_PACKAGE_ID} ${version} in ${outputDir}`);
}
