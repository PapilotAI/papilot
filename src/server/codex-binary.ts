import { codexInstallations, firstRunnable } from '../../bin/codex-lookup.mjs';
import { DATA, ROOT } from './paths.ts';

// Papilot uses the Codex installed on this computer, like every other agent.
// The desktop installer does not carry Codex: it was the largest part of one,
// and every Codex update meant downloading the whole app again.

export async function resolveCodex(candidates: Iterable<string> | AsyncIterable<string>, env: NodeJS.ProcessEnv = process.env, signal?: AbortSignal): Promise<string> {
  const installed: string[] = [];
  async function* remember() { for await (const file of candidates) { installed.push(file); yield file; } }
  const file = await firstRunnable(remember(), env, { signal });
  if (signal?.aborted) throw new Error('Codex is not connected.');
  if (file) return file;
  if (!installed.length) throw new Error('Codex was not found on this computer. Install Codex, then select Reconnect.');
  console.error(`No installed Codex could be run: ${installed.join(', ')}.`);
  throw new Error('Codex is installed but could not be run. Reinstall Codex, then select Reconnect.');
}

/** The first Codex that runs. */
export async function codexBinary(env: NodeJS.ProcessEnv = process.env, data = DATA, signal?: AbortSignal): Promise<string> {
  // The npm command has already chosen its Codex.
  if (env.PAPILOT_CODEX_BIN) return env.PAPILOT_CODEX_BIN;
  return resolveCodex(codexInstallations(env, data, ROOT, signal), env, signal);
}
