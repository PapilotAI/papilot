import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { stableVersion } from '../../bin/installation.mjs';
import { releaseAsset } from './update-install.ts';

const repository = 'PapilotAI/papilot';
const installerName = (version: string) => `Papilot-${version}-win-x64.exe`;
const installerUrl = (version: string) => `https://github.com/${repository}/releases/download/v${version}/${installerName(version)}`;
const validSize = (size: number) => Number.isSafeInteger(size) && size > 0 && size <= 1024 ** 3;
const failed = 'The Windows installer could not be verified. Retry the update or download it from GitHub Releases.';
export interface WindowsInstaller { version: string; size: number; sha256: string }

// The stable desktop manifest is published last. Look up the installer for
// that exact release, even if GitHub's latest release changes in the meantime.
export async function findWindowsInstaller(version: string, fetcher = fetch): Promise<WindowsInstaller | null> {
  if (!stableVersion(version)) return null;
  try {
    const response = await fetcher(`https://api.github.com/repos/${repository}/releases/tags/v${version}`, {
      signal: AbortSignal.timeout(10000), redirect: 'error', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Papilot' },
    });
    if (!response.ok) { await response.body?.cancel(); return null; }
    const release = await response.json();
    if (release?.tag_name !== `v${version}` || release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)) return null;
    const assets = release.assets.filter((asset: any) => asset?.name === installerName(version));
    const asset = assets[0], digest = /^sha256:([a-f0-9]{64})$/.exec(asset?.digest)?.[1];
    if (assets.length !== 1 || asset.browser_download_url !== installerUrl(version) || !validSize(asset.size) || !digest) return null;
    return { version, size: asset.size, sha256: digest };
  } catch { return null; }
}

export async function stageWindowsInstaller(data: string, target: WindowsInstaller, fetcher = fetch) {
  const { version, size, sha256 } = target;
  if (!stableVersion(version) || !validSize(size) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error(failed);
  const folder = path.join(data, 'updates/desktop/installer'), filename = path.join(folder, installerName(version));
  const temporary = path.join(folder, `${randomUUID()}.part`);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  // Executables always come from the official release, including when a
  // smoke test overrides the download source for code layers.
  try {
    const response = await releaseAsset(installerUrl(version), fetcher, size, false, false);
    if (!response?.body) throw new Error(failed);
    const hash = createHash('sha256');
    let bytes = 0;
    const verify = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > size) { callback(new Error(failed)); return; }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as ReadableStream), verify, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    if (bytes !== size || hash.digest('hex') !== sha256) throw new Error(failed);
    fs.renameSync(temporary, filename);
  } catch { throw new Error(failed); }
  finally { fs.rmSync(temporary, { force: true }); }
}
