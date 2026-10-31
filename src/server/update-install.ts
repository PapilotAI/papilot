import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readJson, stableVersion } from '../../bin/installation.mjs';

export function npmCli(env = process.env, executable = process.execPath) {
  const candidates = [env.npm_execpath, path.join(path.dirname(executable), '../lib/node_modules/npm/bin/npm-cli.js'), path.join(path.dirname(executable), 'node_modules/npm/bin/npm-cli.js'),
    ...(env.PATH || '').split(path.delimiter).map(dir => path.join(dir, 'npm'))];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { const real = fs.realpathSync(candidate); if (real.endsWith('npm-cli.js')) return real; } catch { /* next installation */ }
  }
  throw new Error('npm is unavailable to Papilot.');
}
export const loaderFor = (root: string) => createRequire(path.join(root, 'package.json')).resolve('tsx/esm');
export function runInstall(args: string[], cwd: string, log: number, timeout = 600000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli(), ...args], { cwd, env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || '') }, stdio: ['ignore', log, log] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('The update download timed out.')); }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('The new version could not be installed. Check the connection and available disk space, then retry.')); });
  });
}
export async function health(port: number, version: string, instance?: string) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    const value = await response.json();
    return response.ok && value.name === 'Papilot' && value.version === version && (!instance || value.updateInstance === instance);
  } catch { return false; }
}
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function probeInstallation(root: string, version: string, stage: string, log: number) {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', loaderFor(root), path.join(root, 'src/server/main.ts')], {
    cwd: root, env: { ...process.env, PAPILOT_DATA: path.join(stage, 'probe'), PAPILOT_PORT: String(port), PAPILOT_PUBLIC_ORIGIN: '', PAPILOT_ACCOUNT_ORIGIN: '', PAPILOT_UPDATE_PROBE: '1' }, stdio: ['ignore', log, log],
  });
  let ended = false, error: Error | undefined;
  child.once('error', e => { error = e; ended = true; }); child.once('exit', () => { ended = true; });
  try {
    for (let i = 0; i < 40 && !ended; i++) { if (await health(port, version)) return; await sleep(250); }
    throw error || new Error('The new version did not pass its startup check. Your current version is still running.');
  } finally {
    if (!ended) {
      child.kill('SIGTERM');
      for (let i = 0; i < 30 && !ended; i++) await sleep(100);
      if (!ended) child.kill('SIGKILL');
    }
  }
}
export async function installRelease(data: string, version: string) {
  if (!stableVersion(version)) throw new Error('Invalid release version.');
  const releases = path.join(data, 'updates/releases'); fs.mkdirSync(releases, { recursive: true, mode: 0o700 });
  const stage = fs.mkdtempSync(path.join(releases, version + '-')), root = path.join(stage, 'node_modules/papilot');
  const log = fs.openSync(path.join(data, 'updates/install.log'), 'a', 0o600);
  try {
    const flags = ['--registry=https://registry.npmjs.org', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--engine-strict'];
    await runInstall(['install', '--prefix', stage, '--save-exact', ...flags, `papilot@${version}`], stage, log);
    const pkg = readJson(path.join(root, 'package.json'));
    if (pkg?.name !== 'papilot' || pkg.version !== version) throw new Error('The downloaded package does not match the requested release.');
    for (const file of ['dist/index.html', 'src/server/start.ts', 'src/server/main.ts', 'bin/papilot.mjs', 'vendor/latex-review/package-lock.json']) {
      if (!fs.existsSync(path.join(root, file))) throw new Error('The downloaded release is incomplete.');
    }
    await runInstall(['ci', '--prefix', path.join(root, 'vendor/latex-review'), ...flags], stage, log);
    await probeInstallation(root, version, stage, log);
    return root;
  } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error; }
  finally { fs.closeSync(log); }
}
