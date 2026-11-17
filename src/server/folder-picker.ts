import { spawn } from 'node:child_process';

type Command = { command: string; args: string[]; env?: Record<string, string>; cancelled: (code: number | null, stderr: string) => boolean };
export type FolderChoice = { path: string | null } | { unavailable: true };

// The title and starting folder reach each picker as arguments or environment
// values, never as script text.
export function pickerCommands(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, title: string, start: string): Command[] {
  if (platform === 'darwin') return [{
    command: 'osascript',
    // AppleScript's `choose folder` stays behind the browser when started by a
    // background server; an activated accessory app brings its panel to the front.
    args: ['-l', 'JavaScript', '-e', [
      "ObjC.import('AppKit');",
      'function run(argv) {',
      '  const app = $.NSApplication.sharedApplication;',
      '  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory); app.activateIgnoringOtherApps(true);',
      '  const panel = $.NSOpenPanel.openPanel;',
      '  panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.canCreateDirectories = true; panel.allowsMultipleSelection = false;',
      '  panel.message = argv[0]; panel.directoryURL = $.NSURL.fileURLWithPath(argv[1]);',
      "  return panel.runModal == $.NSModalResponseOK ? panel.URL.path.js : '';",
      '}',
    ].join('\n'), title, start],
    cancelled: () => false,
  }];
  if (platform === 'win32') return [{
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dialog.Description = $env:PAPILOT_PICKER_TITLE; $dialog.SelectedPath = $env:PAPILOT_PICKER_START; $dialog.ShowNewFolderButton = $true',
      // A topmost owner keeps the dialog above the browser that asked for it.
      '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }',
      // Redirected output otherwise uses the OEM code page, garbling non-ASCII folder names.
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      'if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
    ].join('; ')],
    env: { PAPILOT_PICKER_TITLE: title, PAPILOT_PICKER_START: start },
    cancelled: () => false,
  }];
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return [];
  const withSlash = start.endsWith('/') ? start : start + '/';
  return [
    { command: 'zenity', args: ['--file-selection', '--directory', '--title', title, '--filename', withSlash], cancelled: code => code === 1 },
    { command: 'kdialog', args: ['--getexistingdirectory', start, '--title', title], cancelled: code => code === 1 },
  ];
}

function run(command: Command, signal?: AbortSignal) {
  return new Promise<FolderChoice | 'missing'>((resolve, reject) => {
    const child = spawn(command.command, command.args, { env: { ...process.env, ...command.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, signal });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? resolve('missing') : reject(error));
    child.on('close', code => {
      const path = stdout.replace(/\r?\n$/, '');
      if (code === 0) resolve({ path: path ? path.replace(/([^\\/:])[\\/]$/, '$1') : null });
      else if (command.cancelled(code, stderr)) resolve({ path: null });
      else reject(new Error(stderr.trim() || `${command.command} exited with ${code}.`));
    });
  });
}

let open: { choice: Promise<FolderChoice>; waiting: number; stop: AbortController } | null = null;
// Shows the system folder picker on the computer running Papilot. One picker is
// shown at a time: a repeated request waits for the same choice, and the picker
// closes only when every waiting request has gone.
// Closes an open picker so it does not outlive the server.
export function closeFolderPicker() { open?.stop.abort(); }

export function chooseFolder(title: string, start: string, signal?: AbortSignal, platform = process.platform, env = process.env): Promise<FolderChoice> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (!open) {
    const stop = new AbortController();
    // A picker process is not ended with the server, so close it on any exit.
    process.once('exit', closeFolderPicker);
    const choice = (async () => {
      for (const command of pickerCommands(platform, env, title, start)) {
        let result: FolderChoice | 'missing';
        try { result = await run(command, stop.signal); }
        catch (error) {
          if (stop.signal.aborted) throw error;
          // A server without access to the screen, such as one started over SSH, browses in the page.
          console.warn(`Folder picker failed: ${(error as Error).message}`);
          return { unavailable: true } as const;
        }
        if (result !== 'missing') return result;
      }
      return { unavailable: true } as const;
    })().finally(() => { process.off('exit', closeFolderPicker); if (open?.stop === stop) open = null; });
    open = { choice, waiting: 0, stop };
  }
  const current = open;
  current.waiting++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const leave = () => {
      if (settled) return; settled = true;
      if (--current.waiting === 0) { current.stop.abort(); if (open === current) open = null; }
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', leave, { once: true });
    current.choice.then(value => { if (!settled) { settled = true; current.waiting--; resolve(value); } }, error => { if (!settled) { settled = true; current.waiting--; reject(error); } })
      .finally(() => signal?.removeEventListener('abort', leave));
  });
}
