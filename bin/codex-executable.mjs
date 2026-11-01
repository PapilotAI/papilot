import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Resolve npm's Windows shim to a native executable: spawn cannot run the
// extensionless shell script or .cmd wrapper without a shell.
export function codexExecutable(command = 'codex', env = process.env, platform = process.platform, arch = process.arch) {
  const explicit = command.includes('/') || command.includes('\\');
  const candidates = explicit ? [path.resolve(command)] : (env.PATH || '').split(path.delimiter).map(dir => path.resolve(dir || '.', command));
  for (const candidate of candidates) {
    if (platform !== 'win32') { if (existsSync(candidate)) return candidate; continue; }
    const exe = candidate.endsWith('.exe') ? candidate : `${candidate}.exe`;
    if (existsSync(exe)) return exe;
    const dir = path.dirname(candidate);
    const modules = path.basename(dir) === '.bin' ? path.dirname(dir) : path.join(dir, 'node_modules');
    const root = path.join(modules, '@openai/codex');
    const target = { x64: 'x86_64', arm64: 'aarch64' }[arch];
    if (!target) continue;
    let vendor = path.join(root, 'vendor');
    try {
      const require = createRequire(path.join(root, 'package.json'));
      vendor = path.join(path.dirname(require.resolve(`@openai/codex-win32-${arch}/package.json`)), 'vendor');
    } catch { /* Older Codex packages bundle vendor directly. */ }
    const native = path.join(vendor, `${target}-pc-windows-msvc`, 'bin/codex.exe');
    if (existsSync(native)) return native;
  }
}
