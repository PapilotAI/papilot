import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tarCommand } from '../bin/agent-paths.mjs';

export function verifyGitArchive(bytes, expected) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Bundled Git archive checksum mismatch.');
}

// Downloads happen while building an installer, never on a user's first launch.
export async function bundleGit(root, destination, platform = process.platform, arch = process.arch) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'desktop/git-distribution.json'), 'utf8'));
  const asset = manifest.assets[`${platform}-${arch}`];
  if (!asset) throw new Error(`No bundled Git for ${platform}-${arch}.`);
  const cache = path.join(root, '.desktop/downloads'), archive = path.join(cache, asset.name);
  fs.mkdirSync(cache, { recursive: true });
  let bytes;
  if (fs.existsSync(archive)) bytes = fs.readFileSync(archive);
  else {
    const url = `https://github.com/${manifest.repository}/releases/download/${manifest.version}/${asset.name}`;
    console.log(`Downloading Git ${manifest.version} for ${platform}-${arch}.`);
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Git download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  verifyGitArchive(bytes, asset.sha256);
  fs.writeFileSync(archive, bytes);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  const result = spawnSync(tarCommand(), ['-xzf', archive, '-C', destination], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Could not extract bundled Git.');
  // System defaults are below the author's global and repository settings.
  // Put them before upstream includes so existing system identities also win.
  const config = path.join(destination, 'etc/gitconfig');
  fs.writeFileSync(config, fs.readFileSync(path.join(root, 'desktop/git-defaults.config'), 'utf8') + '\n' + fs.readFileSync(config, 'utf8'));
  fs.cpSync(path.join(root, 'desktop/git-licenses'), path.join(destination, 'licenses'), { recursive: true });
}
