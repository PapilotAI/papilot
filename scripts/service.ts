import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ROOT, DATA } from '../src/server/paths.ts';

if (process.platform !== 'darwin') throw new Error('This service installer is for macOS. On other systems run npm start with your process manager.');
const label = 'local.papilot';
const domain = `gui/${process.getuid!()}`;
const file = path.join(os.homedir(), 'Library/LaunchAgents', label + '.plist');
if (process.argv[2] === 'stop') {
  execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'inherit' });
} else if (process.argv[2] === 'install') {
  const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const env: Record<string, string> = { PATH: [path.join(ROOT, 'node_modules/.bin'), '/Library/TeX/texbin', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'), HOME: os.homedir(), NODE_ENV: 'production' };
  for (const [key, value] of Object.entries(process.env)) if (key.startsWith('PAPILOT_') && value) env[key] = value;
  const args = ['/usr/bin/caffeinate', '-i', process.execPath, '--import', 'tsx', path.join(ROOT, 'src/server/main.ts')];
  const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(ROOT)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${xml(k)}</key><string>${xml(v)}</string>`).join('')}</dict>
<key>StandardOutPath</key><string>${xml(path.join(DATA, 'service.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(DATA, 'service.error.log'))}</string>
<key>ThrottleInterval</key><integer>10</integer></dict></plist>`;
  fs.writeFileSync(file, plist, { mode: 0o600 });
  try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }); } catch { /* first install */ }
  for (let attempt = 0; attempt < 40; attempt++) {
    try { execFileSync('launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' }); }
    catch { break; }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  execFileSync('launchctl', ['bootstrap', domain, file], { stdio: 'inherit' });
  console.log(`Installed ${label}. Starts after login and restarts if it exits. Logs: ${DATA}`);
} else throw new Error('Use install or stop');
