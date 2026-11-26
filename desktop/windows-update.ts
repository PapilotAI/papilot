import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const maxInstallerSize = 1024 ** 3;
const windowsPowerShell = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
function powerShellEnvironment() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toLowerCase() === 'psmodulepath') delete env[name];
  env.PSModulePath = path.join(path.dirname(windowsPowerShell()), 'Modules');
  return env;
}

const registryCommand = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'X64') {
  (Get-ItemProperty -LiteralPath 'HKCU:\Software\033e3166-a620-51ab-9617-2d7fd9838c85' -ErrorAction SilentlyContinue).InstallLocation
}`;
const validVersion = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const parts = (version: string) => version.split('.').map(Number);
const key = (file: string) => path.resolve(file).toLowerCase();
function contains(directory: string, file: string) {
  const relative = path.relative(key(directory), key(file));
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// Electron may ask before the user data directory has been created.
async function realLocation(file: string): Promise<string> {
  try { return await fs.realpath(file); }
  catch (error) {
    const parent = path.dirname(file);
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === file) throw error;
    return path.join(await realLocation(parent), path.basename(file));
  }
}

export async function registeredWindowsInstall(executable: string, data: string): Promise<boolean> {
  if (process.platform !== 'win32' || process.arch !== 'x64' ||
      process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR) return false;
  try {
    const { stdout } = await promisify(execFile)(windowsPowerShell(), [
      '-NoProfile', '-NonInteractive', '-Command', registryCommand,
    ], { windowsHide: true, timeout: 8000, maxBuffer: 65536, env: powerShellEnvironment() });
    const folder = stdout.trim();
    if (!/^[A-Za-z]:\\/.test(folder) || /["\r\n]/.test(folder)) return false;
    const registeredExecutable = path.join(folder, 'Papilot.exe');
    if (key(executable) !== key(registeredExecutable)) return false;
    const [installPath, actualExecutable, dataPath, stagePath] = await Promise.all([
      fs.realpath(folder), fs.realpath(registeredExecutable), realLocation(data),
      realLocation(path.resolve(data, 'updates', 'desktop', 'installer')),
    ]);
    return key(actualExecutable) === key(path.join(installPath, 'Papilot.exe')) &&
      key(stagePath) === key(path.join(dataPath, 'updates', 'desktop', 'installer')) &&
      !contains(installPath, dataPath) && !contains(installPath, stagePath);
  } catch { return false; }
}

export async function prepareWindowsInstaller(data: string, input: unknown, bundledVersion: string): Promise<() => Promise<number>> {
  if (typeof input !== 'object' || !input) throw new Error('Invalid Windows installer update.');
  const { version, size, sha256 } = input as Record<string, unknown>;
  const base = bundledVersion.replace(/-dev\.[a-f0-9]{40}$/, '');
  if (typeof version !== 'string' || !validVersion.test(version) || !validVersion.test(base) ||
    typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > maxInstallerSize ||
    typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid Windows installer update.');
  const previous = parts(base), target = parts(version);
  const difference = target.findIndex((part, index) => part !== previous[index]);
  if (difference < 0 || target[difference] < previous[difference]) throw new Error('The Windows installer is not newer than the installed app.');

  const executable = process.execPath;
  if (!await registeredWindowsInstall(executable, data)) throw new Error('The registered Windows installation could not be verified.');
  const root = await fs.realpath(data);
  const folder = path.join(root, 'updates', 'desktop');
  const stage = path.join(folder, 'installer');
  const artifact = path.join(stage, 'Papilot-' + version + '-win-x64.exe');
  const [file, realArtifact] = await Promise.all([fs.lstat(artifact), fs.realpath(artifact)]);
  if (!file.isFile() || file.size !== size || key(artifact) !== key(realArtifact)) {
    throw new Error('The staged Windows installer could not be verified.');
  }

  const helper = await fs.readFile(new URL('./windows-update.ps1', import.meta.url));
  return async () => {
    const job = await fs.mkdtemp(path.join(folder, 'windows-handoff-'));
    const script = path.join(job, 'windows-update.ps1'), configuration = path.join(job, 'job.json');
    try {
      await fs.writeFile(script, helper, { flag: 'wx' });
      await fs.writeFile(configuration, JSON.stringify({
        parent: process.pid, executable, data: root, version, size, sha256, psModulePath: process.env.PSModulePath ?? null,
      }), { flag: 'wx' });
      return await new Promise<number>((resolve, reject) => {
        const child = spawn(windowsPowerShell(), [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
        ], { cwd: job, detached: true, stdio: 'ignore', windowsHide: true, env: powerShellEnvironment() });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(child.pid!); });
      });
    } catch (error) {
      await Promise.allSettled([fs.unlink(script), fs.unlink(configuration)]);
      await fs.rmdir(job).catch(() => {});
      throw error;
    }
  };
}
