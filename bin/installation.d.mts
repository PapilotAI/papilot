export function stableVersion(value: unknown): value is string;
export function devRevision(value: unknown): string | null;
export function releaseVersion(value: unknown): value is string;
export function newerVersion(next: string, current: string): boolean;
export function readJson(file: string): any;
export function writeJson(file: string, value: unknown): void;
export function activeInstallation(root: string, data: string): string;
export function waitForActivation(data: string): Promise<void>;
