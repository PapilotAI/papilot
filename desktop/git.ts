import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { findCommand } from './platform.mjs';

type Probe = (file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<boolean>;
const probeGit: Probe = (file, args, env) => new Promise(resolve => {
  const child = execFile(file, args, { env, cwd: os.homedir(), windowsHide: true, timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024 },
    (error, stdout) => resolve(!error && (args[0] !== '--version' || /^git version /m.test(stdout))));
  child.stdin?.end();
});

// All Git callers (including review servers and agents) inherit this environment.
// Keep the complete distribution together: Git's helpers are not relocatable by
// PATH alone. These paths follow desktop/dugite's git-environment.ts.
export function bundledGitEnvironment(env: NodeJS.ProcessEnv, directory: string, platform = process.platform, arch = process.arch): NodeJS.ProcessEnv {
  const windows = platform === 'win32', prefix = windows ? path.join(directory, arch === 'arm64' ? 'clangarm64' : 'ucrt64') : directory;
  const binaries = windows ? [path.join(directory, 'cmd'), path.join(prefix, 'bin'), path.join(directory, 'usr/bin')] : [path.join(directory, 'bin')];
  const result = { ...env };
  const paths = Object.keys(env).filter(key => key.toLowerCase() === 'path');
  if (windows) for (const key of paths) delete result[key];
  result.PATH = [...binaries, ...(windows ? paths.map(key => env[key]) : [env.PATH])].filter(Boolean).join(windows ? ';' : ':');
  result.GIT_EXEC_PATH = path.join(prefix, 'libexec/git-core');
  if (!windows) {
    result.GIT_TEMPLATE_DIR ||= path.join(directory, 'share/git-core/templates');
    result.GIT_CONFIG_SYSTEM ||= path.join(directory, 'etc/gitconfig');
  }
  if (platform === 'linux') {
    result.PREFIX = directory;
    result.GIT_SSL_CAINFO ||= path.join(directory, 'ssl/cacert.pem');
  }
  return result;
}

export async function withBundledGit(env: NodeJS.ProcessEnv, directory: string, platform = process.platform, arch = process.arch, probe = probeGit) {
  const bundled = path.join(directory, platform === 'win32' ? 'cmd/git.exe' : 'bin/git');
  // Source/Nix/WSL installs have their own tools; only installers carry this directory.
  if (!fs.existsSync(bundled)) return env;
  const system = findCommand('git', env, platform);
  if (system) {
    // Apple's placeholder opens an installer instead of running Git on a clean Mac.
    const stub = platform === 'darwin' && system === '/usr/bin/git' && !await probe('/usr/bin/xcode-select', ['-p'], env);
    if (!stub && await probe(system, ['--version'], env)) return env;
  }
  return bundledGitEnvironment(env, directory, platform, arch);
}
