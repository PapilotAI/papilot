export const ZCODE_MIN_VERSION: string;
export function zcodeLaunch(env?: NodeJS.ProcessEnv): { file: string; command: string; args: string[]; env: NodeJS.ProcessEnv } | null;
export function zcodeVersion(stdout: string): string | null;
