import { createHash } from 'node:crypto';

export interface ReleaseAsset {
  name: string;
  state: string;
  size: number;
  digest: string;
}

export interface ReleaseMetadata {
  tagName: string;
  isDraft: boolean;
  isPrerelease: boolean;
  publishedAt: string | null;
  assets: ReleaseAsset[];
}

export function compareSemver(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function verifyStableRelease(tag: string, release: ReleaseMetadata, manifest: string | Buffer) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Use an exact stable release tag.');
  }
  const version = tag.slice(1);
  if (release.tagName !== tag || release.isDraft !== false || release.isPrerelease !== false || !release.publishedAt) {
    throw new Error('The stable GitHub release has not been published.');
  }
  const assetDigest = (name: string) => {
    const value = release.assets?.find((candidate) => candidate.name === name && candidate.state === 'uploaded');
    if (!value || value.size <= 0 || !/^sha256:[a-f0-9]{64}$/.test(value.digest)) {
      throw new Error(`Missing or incomplete release asset ${name}.`);
    }
    return value.digest.slice('sha256:'.length);
  };
  const manifestDigest = assetDigest('desktop.json');
  if (
    createHash('sha256').update(manifest).digest('hex') !== manifestDigest ||
    JSON.parse(manifest.toString()).version !== version
  ) {
    throw new Error('The desktop manifest does not match the release.');
  }
  return { version, assetDigest };
}
