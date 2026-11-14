import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';

// Query the current user's registered package, not WindowsApps itself: its
// versioned directories can be inaccessible and old versions can remain there.
const packageQuery = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); $ProgressPreference = 'SilentlyContinue'; @(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -ExpandProperty InstallLocation) | ConvertTo-Json -Compress`;

/** The CLI inside an installed desktop app. Never return the GUI launcher,
 *  change PATH, copy credentials, or use a Windows binary from Linux/WSL. */
export async function desktopCodexCandidates(env = process.env, { platform = process.platform, signal } = {}) {
  if (signal?.aborted || env.PAPILOT_CODEX_BIN) return [];
  let candidates = [];
  if (platform === 'darwin') {
    const home = env.HOME || os.homedir();
    candidates = [path.posix.join(home, 'Applications'), '/Applications'].flatMap(directory =>
      ['Codex.app', 'ChatGPT.app'].flatMap(app => ['codex-cli/bin/codex', 'codex'].map(binary =>
        path.posix.join(directory, app, 'Contents/Resources', binary))));
  } else if (platform === 'win32') {
    const powershell = path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    try {
      const stdout = await new Promise((resolve, reject) => {
        childProcess.execFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', packageQuery],
          { env, encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 65536, signal },
          (error, stdout) => error ? reject(error) : resolve(stdout));
      });
      const locations = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim() || '[]');
      candidates = (Array.isArray(locations) ? locations : [locations])
        .filter(location => typeof location === 'string' && path.win32.isAbsolute(location))
        .map(location => path.win32.join(location, 'app/resources/codex.exe'));
    } catch { /* No package, PowerShell unavailable, timeout, or cancellation. */ }
  }
  if (signal?.aborted) return [];
  return [...new Set(candidates)].filter(file => {
    try {
      if (!fs.statSync(file).isFile()) return false;
      fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      return true;
    } catch { return false; }
  });
}
