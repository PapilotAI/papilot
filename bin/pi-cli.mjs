import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExecutable, findExecutables } from './agent-paths.mjs';

// 1.5.1 waits for in-flight OAuth refreshes during RPC shutdown.
export const PI_MIN_VERSION = '1.5.1';
export function supportedPi(version) {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const numbers = match.slice(1).map(Number), minimum = PI_MIN_VERSION.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (numbers[i] !== minimum[i]) return numbers[i] > minimum[i];
  return true;
}
export function piExecutable(env = process.env) {
  if (env.PAPILOT_PI_BIN) return findExecutable(env.PAPILOT_PI_BIN, env);
  // npm start puts Papilot's bundled Writer dependency on PATH. It is not
  // the author's Pi installation, and must not make a Pi card appear ready.
  let ownBin = fileURLToPath(new URL('../node_modules/.bin/', import.meta.url));
  let bundled = fileURLToPath(new URL('../node_modules/@mariozechner/pi-coding-agent/', import.meta.url));
  try { ownBin = fs.realpathSync(ownBin); } catch { /* No bundled launchers in this layout. */ }
  try { bundled = fs.realpathSync(bundled); } catch { /* No bundled SDK in this layout. */ }
  return findExecutables('pi', env).find(file => {
    // Windows .cmd wrappers resolve to .bin, rather than the SDK entry point.
    try {
      if (fs.realpathSync(path.dirname(file)) === ownBin) return false;
      return !fs.realpathSync(file).startsWith(bundled + (bundled.endsWith(path.sep) ? '' : path.sep));
    }
    catch { return false; }
  }) || null;
}
