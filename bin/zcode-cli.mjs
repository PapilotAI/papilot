import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentPath, findExecutable } from './agent-paths.mjs';

export const ZCODE_MIN_VERSION = '0.18.0';

export function zcodeLaunch(env = process.env) {
  const configured = env.PAPILOT_ZCODE_BIN;
  const executable = findExecutable(configured || 'zcode', env);
  const bundle = configured?.endsWith('.cjs') ? [path.resolve(configured)]
    : !configured && !executable && process.platform === 'darwin'
      ? ['/Applications', path.join(os.homedir(), 'Applications')].map(dir => path.join(dir, 'ZCode.app/Contents/Resources/glm/zcode.cjs')) : [];
  const script = bundle.find(file => {
    try { return fs.statSync(file).isFile(); } catch { return false; }
  });
  const launchEnv = { ...env, PATH: agentPath(env) };
  if (script) {
    // The macOS desktop bundle stores its built-in provider catalog beside glm/.
    const catalog = path.resolve(path.dirname(script), '../config/provider/zcode-builtin.json');
    if (!launchEnv.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE && fs.existsSync(catalog)) launchEnv.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = catalog;
    return { file: script, command: process.execPath, args: [script], env: launchEnv };
  }
  return executable && !bundle.length ? { file: executable, command: executable, args: [], env: launchEnv } : null;
}

export function zcodeVersion(stdout) {
  try {
    const { cli } = JSON.parse(stdout);
    if (cli?.name !== 'zcode' || !/^\d+\.\d+\.\d+$/.test(cli.version)) return null;
    const [major, minor, patch] = cli.version.split('.').map(Number);
    const [minMajor, minMinor, minPatch] = ZCODE_MIN_VERSION.split('.').map(Number);
    return (major - minMajor || minor - minMinor || patch - minPatch) >= 0 ? cli.version : null;
  } catch { return null; }
}
