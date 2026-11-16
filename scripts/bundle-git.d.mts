export function verifyGitArchive(bytes: Buffer, expected: string): void;
export function bundleGit(root: string, destination: string, platform?: NodeJS.Platform, arch?: string): Promise<void>;
