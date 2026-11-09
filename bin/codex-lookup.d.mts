export function codexCandidates(env: NodeJS.ProcessEnv, data: string, root: string): string[];
export function firstRunnable(candidates: string[], env?: NodeJS.ProcessEnv, options?: { timeout?: number; signal?: AbortSignal }): Promise<string | null>;
