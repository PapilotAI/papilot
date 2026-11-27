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
export function kwinLayout(config: string): WindowButtons | null {
  let section = '';
  const values: Record<string, string> = { ButtonsOnLeft: 'MS', ButtonsOnRight: 'HIAX' };
  for (const line of config.split(/\r?\n/)) {
    const header = /^\s*\[(.*)\]\s*$/.exec(line);
    if (header) { section = header[1]; continue; }
    const entry = /^\s*(ButtonsOnLeft|ButtonsOnRight)\s*=\s*(.*?)\s*$/.exec(line);
    if (entry && section === 'org.kde.kdecoration2') values[entry[1]] = entry[2];
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
      // important first); later lines win in kwinLayout.
      const directories = [...(env.XDG_CONFIG_DIRS || '/etc/xdg').split(':').filter(Boolean).reverse(), env.XDG_CONFIG_HOME || path.posix.join(os.homedir(), '.config')];
      const files = await Promise.all(directories.map(directory => read(path.posix.join(directory, 'kwinrc')).catch(() => '')));
      return kwinLayout(files.join('\n'));
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
