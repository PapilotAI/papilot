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
      // [group][subgroup][$i]: the name is every segment but $ flags.
      const header = /^\s*((?:\[[^\]]*\])+)\s*$/.exec(line);
      if (header) {
        const segments = header[1].slice(1, -1).split('][');
        const flags = segments.filter(segment => segment.startsWith('$')).join('');
        const name = segments.filter(segment => !segment.startsWith('$')).join('/');
        // A lone [$i] at the top locks the whole file; elsewhere a header
        // without a name is not a group.
        if (!name) { if (!group && flags.includes('i')) locked.add('*'); continue; }
        group = name;
        // A locked group holds its keys even where this file leaves them out.
        if (flags.includes('i') && group === 'org.kde.kdecoration2') lockAfter.push('ButtonsOnLeft', 'ButtonsOnRight');
        continue;
      }
      // Key[$i]=value; a localized Key[de]=value is a different entry.
      const entry = /^\s*(ButtonsOnLeft|ButtonsOnRight)((?:\[\$[^\]]*\])*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!entry || group !== 'org.kde.kdecoration2' || fileLocked || locked.has(entry[1])) continue;
      values[entry[1]] = entry[3];
      if (/\[\$[^\]]*i/.test(entry[2])) lockAfter.push(entry[1]);
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
type Options = { env?: NodeJS.ProcessEnv; exec?: Run; read?: (file: string) => Promise<string>; timeout?: number };
const desktopsOf = (env: NodeJS.ProcessEnv) => (env.XDG_CURRENT_DESKTOP || '').toUpperCase().split(':');
// The first window waits for this, so a stalled command or file read (a
// hung network home folder) gives up after two seconds. KDE and Xfce then
// keep their own default layouts; other desktops the page's.
export function detectWindowButtons(options: Options = {}): Promise<WindowButtons | null> {
  const desktops = desktopsOf(options.env ?? process.env);
  const fallback = desktops.includes('KDE') ? kwinLayout('') : desktops.includes('XFCE') ? xfwmLayout('O|HMC') : null;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), options.timeout ?? 2000); });
  return Promise.race([readWindowButtons(options).catch(() => null), timeout])
    .then(layout => layout ?? fallback).finally(() => clearTimeout(timer));
}
// XDG directories must be absolute; others are ignored.
const absolute = (directories: (string | undefined)[]) => directories.filter((directory): directory is string => Boolean(directory && path.posix.isAbsolute(directory)));
async function readWindowButtons({ env = process.env, exec = run, read = (file: string) => readFile(file, 'utf8') }: Options): Promise<WindowButtons | null> {
  const desktops = desktopsOf(env);
  const gsettings = (schema: string) => exec('gsettings', ['get', schema, 'button-layout']).then(gtkLayout);
  if (desktops.includes('KDE')) {
    // KDE layers the user's kwinrc over system ones (XDG_CONFIG_DIRS, most
    // important first).
    const system = absolute((env.XDG_CONFIG_DIRS || '').split(':'));
    const directories = [...(system.length ? system : ['/etc/xdg']).reverse(), absolute([env.XDG_CONFIG_HOME])[0] ?? path.posix.join(os.homedir(), '.config')];
    return kwinLayout(await Promise.all(directories.map(directory => read(path.posix.join(directory, 'kwinrc')).catch(() => ''))));
  }
  if (desktops.includes('XFCE')) return xfwmLayout(await exec('xfconf-query', ['-c', 'xfwm4', '-p', '/general/button_layout']));
  if (desktops.includes('X-CINNAMON')) return gsettings('org.cinnamon.desktop.wm.preferences');
  if (desktops.includes('MATE')) return gsettings('org.mate.Marco.general');
  if (desktops.some(desktop => gnomeDesktops.includes(desktop))) return gsettings('org.gnome.desktop.wm.preferences');
  return null;
}
// The sandboxed preload cannot import this module; it reads the layout back
// from this argument as JSON.
export const windowButtonsArgument = (layout: WindowButtons) => WINDOW_BUTTONS_ARGUMENT + JSON.stringify(layout);
