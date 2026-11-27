import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The frameless window draws its own minimize, maximize and close buttons.
// Linux desktops let people choose which buttons appear and on which side, so
// the app reads that choice instead of offering a setting of its own.
export type WindowButton = 'minimize' | 'maximize' | 'close';
export type WindowButtons = { side: 'left' | 'right'; buttons: WindowButton[] };
export const WINDOW_BUTTONS_ARGUMENT = '--papilot-window-buttons=';

function layout(left: WindowButton[], right: WindowButton[]): WindowButtons | null {
  const buttons = [...new Set([...left, ...right])];
  if (!buttons.length) return null;
  // The controls stay together on the side that holds close, as most layouts
  // split only an app menu or title from them.
  const side = left.includes('close') ? 'left' : right.includes('close') ? 'right' : left.length >= right.length ? 'left' : 'right';
  return { side, buttons };
}
const named = (part: string) => part.split(',').map(name => name.trim()).filter((name): name is WindowButton => name === 'minimize' || name === 'maximize' || name === 'close');
const lettered = (part: string, letters: Record<string, WindowButton>) => [...part].map(letter => letters[letter]).filter(Boolean);

// GNOME, Cinnamon and MATE: "appmenu:minimize,maximize,close", as gsettings
// prints it in quotes. Names before the colon sit on the left.
export function gtkLayout(value: string): WindowButtons | null {
  const [left, right = ''] = value.trim().replace(/^'(.*)'$/, '$1').split(':');
  return layout(named(left), named(right));
}
// KDE Plasma's kwinrc: ButtonsOnLeft=MS, ButtonsOnRight=HIAX by default.
// Files come least important first (system, then the user's), each read on
// its own. As in KConfig, a group or key marked [$i] in one file is locked:
// later files cannot change it.
export function kwinLayout(files: string | string[]): WindowButtons | null {
  const values: Record<string, string> = { ButtonsOnLeft: 'MS', ButtonsOnRight: 'HIAX' };
  const locked = new Set<string>();
  for (const file of typeof files === 'string' ? [files] : files) {
    let group = '';
    const fileLocked = locked.has('*'), lockAfter: string[] = [];
    for (const line of file.split(/\r?\n/)) {
      const header = /^\s*\[([^\]]*)\]((?:\[[^\]]*\])*)\s*$/.exec(line);
      if (header) {
        // A lone [$i] before any group locks the whole file.
        if (header[1] === '$i' && !group) { locked.add('*'); continue; }
        group = header[1];
        // A locked group holds its keys even where this file leaves them out.
        if (header[2].includes('[$i]') && group === 'org.kde.kdecoration2') lockAfter.push('ButtonsOnLeft', 'ButtonsOnRight');
        continue;
      }
      const entry = /^\s*(ButtonsOnLeft|ButtonsOnRight)((?:\[[^\]]*\])*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!entry || group !== 'org.kde.kdecoration2' || fileLocked || locked.has(entry[1])) continue;
      values[entry[1]] = entry[3];
      if (entry[2].includes('[$i]')) lockAfter.push(entry[1]);
    }
    for (const key of lockAfter) locked.add(key);
  }
  const letters = { I: 'minimize', A: 'maximize', X: 'close' } as const;
  return layout(lettered(values.ButtonsOnLeft, letters), lettered(values.ButtonsOnRight, letters));
}
// Xfce's xfwm4 button_layout: "O|HMC", where | is the title.
export function xfwmLayout(value: string): WindowButtons | null {
  const [left, right = ''] = value.trim().split('|');
  const letters = { H: 'minimize', M: 'maximize', C: 'close' } as const;
  return layout(lettered(left, letters), lettered(right, letters));
}

type Run = (command: string, args: string[]) => Promise<string>;
const run: Run = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, { timeout: 2000, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout));
});

// GNOME's schema is installed on many desktops that never set it, so it is
// read only on desktops that use it; elsewhere the layout is unknown.
const gnomeDesktops = ['GNOME', 'UNITY', 'BUDGIE', 'PANTHEON'];
// Resolves to null when the desktop's layout is unknown; the page then keeps
// its own default.
export async function detectWindowButtons({ env = process.env, exec = run, read = (file: string) => readFile(file, 'utf8') }: { env?: NodeJS.ProcessEnv; exec?: Run; read?: (file: string) => Promise<string> } = {}): Promise<WindowButtons | null> {
  const desktops = (env.XDG_CURRENT_DESKTOP || '').toUpperCase().split(':');
  const gsettings = (schema: string) => exec('gsettings', ['get', schema, 'button-layout']).then(gtkLayout);
  try {
    if (desktops.includes('KDE')) {
      // KDE layers the user's kwinrc over system ones (XDG_CONFIG_DIRS, most
      // important first).
      const directories = [...(env.XDG_CONFIG_DIRS || '/etc/xdg').split(':').filter(Boolean).reverse(), env.XDG_CONFIG_HOME || path.posix.join(os.homedir(), '.config')];
      const files = await Promise.all(directories.map(directory => read(path.posix.join(directory, 'kwinrc')).catch(() => '')));
      return kwinLayout(files);
    }
    if (desktops.includes('XFCE')) return xfwmLayout(await exec('xfconf-query', ['-c', 'xfwm4', '-p', '/general/button_layout']).catch(() => 'O|HMC'));
    if (desktops.includes('X-CINNAMON')) return await gsettings('org.cinnamon.desktop.wm.preferences');
    if (desktops.includes('MATE')) return await gsettings('org.mate.Marco.general');
    if (desktops.some(desktop => gnomeDesktops.includes(desktop))) return await gsettings('org.gnome.desktop.wm.preferences');
    return null;
  } catch { return null; }
}
// The sandboxed preload cannot import this module; it reads the layout back
// from this argument as JSON.
export const windowButtonsArgument = (layout: WindowButtons) => WINDOW_BUTTONS_ARGUMENT + JSON.stringify(layout);
