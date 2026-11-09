import path from 'node:path';
import { execCommand, findExecutables } from '../../bin/agent-paths.mjs';
import { DATA } from './paths.ts';

// Papilot uses the Codex installed on this computer, like every other agent.
// The desktop installer does not carry Codex: it was the largest part of one,
// and every Codex update meant downloading the whole app again.

// Every codex on PATH, in order (an early one may be a broken installation
// while a later one works), then the copy the npm command installs into the
// data folder (`papilot codex login`).
export function codexCandidates(env: NodeJS.ProcessEnv = process.env, data = DATA) {
  return env.PAPILOT_CODEX_BIN ? [env.PAPILOT_CODEX_BIN] : findExecutables('codex', env, [path.join(data, 'agents', 'node_modules', '.bin')]);
}

/** The first Codex that runs. */
export async function codexBinary(env: NodeJS.ProcessEnv = process.env, data = DATA): Promise<string> {
  // The npm command has already chosen its Codex.
  if (env.PAPILOT_CODEX_BIN) return env.PAPILOT_CODEX_BIN;
  const candidates = codexCandidates(env, data);
  for (const file of candidates) {
    try { await execCommand(file, ['--version'], { env, timeout: 15000 }); return file; } catch { /* a broken installation; try the next */ }
  }
  if (!candidates.length) throw new Error('Codex was not found on this computer. Install Codex, then select Reconnect.');
  console.error(`No installed Codex could be run: ${candidates.join(', ')}.`);
  throw new Error('Codex is installed but could not be run. Reinstall Codex, then select Reconnect.');
}
