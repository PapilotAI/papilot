import path from 'node:path';
import { agentPath, findExecutables, killTree, spawnCommand, WINDOWS } from '../../bin/agent-paths.mjs';
import { DATA, ROOT } from './paths.ts';

// Papilot uses the Codex installed on this computer, like every other agent.
// The desktop installer does not carry Codex: it was the largest part of one,
// and every Codex update meant downloading the whole app again.

// Every codex on PATH, in order (an early one may be a broken installation
// while a later one works), then a source checkout's own development copy and
// the copy the npm command installs into the data folder (`papilot codex login`).
export function codexCandidates(env: NodeJS.ProcessEnv = process.env, data = DATA, root = ROOT) {
  return env.PAPILOT_CODEX_BIN ? [env.PAPILOT_CODEX_BIN] : findExecutables('codex', env, [path.join(root, 'node_modules', '.bin'), path.join(data, 'agents', 'node_modules', '.bin')]);
}

/** The first candidate that runs, tried with the PATH Codex is started with. */
export async function firstRunnable(candidates: string[], env: NodeJS.ProcessEnv = process.env, timeout = 15000) {
  const probe = { ...env, PATH: agentPath(env) };
  for (const file of candidates) {
    try {
      const runs = await new Promise<boolean>(resolve => {
        const child = spawnCommand(file, ['--version'], { env: probe, stdio: 'ignore', detached: !WINDOWS });
        const finish = (runs: boolean) => { clearTimeout(timer); resolve(runs); };
        // A wrapper's children must neither hold pipes open nor outlive the probe.
        const timer = setTimeout(() => {
          try { if (child.pid) killTree(child.pid, 'SIGKILL'); }
          catch { try { child.kill('SIGKILL'); } catch { /* already stopped */ } }
          finally { finish(false); }
        }, timeout);
        child.once('exit', code => finish(code === 0));
        child.once('error', () => finish(false));
      });
      if (runs) return file;
    } catch { /* a broken installation; try the next */ }
  }
  return null;
}

export async function resolveCodex(candidates: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const file = await firstRunnable(candidates, env);
  if (file) return file;
  if (!candidates.length) throw new Error('Codex was not found on this computer. Install Codex, then select Reconnect.');
  console.error(`No installed Codex could be run: ${candidates.join(', ')}.`);
  throw new Error('Codex is installed but could not be run. Reinstall Codex, then select Reconnect.');
}

/** The first Codex that runs. */
export async function codexBinary(env: NodeJS.ProcessEnv = process.env, data = DATA): Promise<string> {
  // The npm command has already chosen its Codex.
  if (env.PAPILOT_CODEX_BIN) return env.PAPILOT_CODEX_BIN;
  return resolveCodex(codexCandidates(env, data), env);
}
