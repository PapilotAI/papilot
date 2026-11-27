import { compareSemver } from './stable-release.mts';

export interface AptPackageEntry {
  version: string;
  filename: string;
  size: number;
  md5: string;
  sha1: string;
  sha256: string;
  sha512: string;
  control: string;
}

export function aptPublication(entries: AptPackageEntry[], version: string, sha256: string) {
  const existing = entries.find((entry) => entry.version === version);
  if (existing) {
    if (existing.sha256 !== sha256) {
      throw new Error('This APT version already exists with a different checksum.');
    }
    return { state: 'current' as const };
  }
  if (entries.some((entry) => compareSemver(entry.version, version) > 0)) {
    return { state: 'older' as const };
  }
  return { state: 'publish' as const };
}
