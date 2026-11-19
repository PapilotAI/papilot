import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectTypeless } from './typeless.js';

export type TypelessStatus = { status: 'ready' | 'sent' | 'not-detected' | 'shortcut-unavailable' | 'permission' | 'not-running' | 'unfocused' | 'keys-held' | 'busy' | 'unavailable'; shortcut?: string };
type Key = { code: number; flags: number };
const modifiers: Record<string, Key> = {
  Fn: { code: 63, flags: 1 << 23 },
  LeftCtrl: { code: 59, flags: 1 << 18 }, RightCtrl: { code: 62, flags: 1 << 18 },
  LeftShift: { code: 56, flags: 1 << 17 }, RightShift: { code: 60, flags: 1 << 17 },
  LeftAlt: { code: 58, flags: 1 << 19 }, RightAlt: { code: 61, flags: 1 << 19 },
  LeftCmd: { code: 55, flags: 1 << 20 }, RightCmd: { code: 54, flags: 1 << 20 },
};
// Typeless stores physical key names. Unknown tokens fail closed, rather than
// sending a different shortcut. The virtual codes follow macOS Events.h.
const keys: Record<string, number> = {
  A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9, B: 11,
  Q: 12, W: 13, E: 14, R: 15, Y: 16, T: 17, '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23,
  Equal: 24, '9': 25, '7': 26, Minus: 27, '8': 28, '0': 29, RightBracket: 30, O: 31, U: 32, LeftBracket: 33,
  I: 34, P: 35, Return: 36, L: 37, J: 38, Quote: 39, K: 40, Semicolon: 41, Backslash: 42, Comma: 43,
  Slash: 44, N: 45, M: 46, Period: 47, Tab: 48, Space: 49, Backquote: 50, Backspace: 51, Escape: 53,
  F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100, F9: 101, F10: 109,
  F11: 103, F12: 111, F13: 105, F14: 107, F15: 113, F16: 106, F17: 64, F18: 79, F19: 80, F20: 90,
  Home: 115, End: 119, PageUp: 116, PageDown: 121, Delete: 117, Left: 123, Right: 124, Down: 125, Up: 126,
};
export function typelessChord(binding: string): Key[] | null {
  const tokens = binding.split('+');
  if (!tokens.length || new Set(tokens).size !== tokens.length) return null;
  const chord: Key[] = [];
  for (const token of tokens) {
    if (Object.hasOwn(modifiers, token)) chord.push(modifiers[token]);
    else if (Object.hasOwn(keys, token)) chord.push({ code: keys[token], flags: 0 });
    else return null;
  }
  // A chord has at most one ordinary key, after its modifiers. Reject pairs
  // of left/right modifiers with the same flag to avoid premature releases.
  const flags = chord.filter(key => key.flags).map(key => key.flags);
  if (new Set(flags).size !== flags.length || chord.filter(key => !key.flags).length > 1) return null;
  return chord.sort((a, b) => Number(!a.flags) - Number(!b.flags));
}

const helper = fileURLToPath(new URL('./typeless-keyboard', import.meta.url)).replace('/app.asar/', '/app.asar.unpacked/');
export async function runTypelessHelper(args: string[], focused?: () => Promise<boolean>, { executable = helper, timeout = 5000 } = {}): Promise<TypelessStatus['status']> {
  return new Promise(resolve => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '', checked = false, cancelled = false;
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdin.on('error', () => { /* The helper may exit before authorization. */ });
    child.stdout.on('data', data => {
      output += String(data);
      if (!checked && output.startsWith('prepared\n')) {
        checked = true;
        void Promise.resolve().then(() => focused?.() ?? false).catch(() => false).then(allowed => {
          cancelled = !allowed;
          if (!child.killed) child.stdin.end(allowed ? 'y' : 'n');
        });
      }
    });
    child.on('error', () => { clearTimeout(timer); resolve('unavailable'); });
    child.on('close', code => {
      clearTimeout(timer);
      const status = output.trim().split('\n').at(-1)!;
      resolve(cancelled ? 'unfocused' : code === 0 && ['ready', 'sent', 'permission', 'not-running', 'unfocused', 'keys-held'].includes(status) ? status as TypelessStatus['status'] : 'unavailable');
    });
  });
}

export function typelessControl({ inspect = inspectTypeless, run = runTypelessHelper }: {
  inspect?: typeof inspectTypeless; run?: (args: string[], focused?: () => Promise<boolean>) => Promise<TypelessStatus['status']>;
} = {}) {
  let sending = false;
  const configured = async () => {
    const info = await inspect();
    if (info.installation.status !== 'detected') return { status: 'not-detected' as const };
    const shortcut = info.shortcuts.status === 'detected' ? info.shortcuts.bindings.find(binding => typelessChord(binding)) : undefined;
    return shortcut ? { status: 'ready' as const, shortcut } : { status: 'shortcut-unavailable' as const };
  };
  return {
    async status(): Promise<TypelessStatus> {
      try { const info = await configured(); return info.shortcut ? { ...info, status: await run(['--check']) } : info; }
      catch { return { status: 'unavailable' }; }
    },
    async send(focused: () => Promise<boolean>): Promise<TypelessStatus> {
      if (sending) return { status: 'busy' };
      sending = true;
      try {
        const info = await configured();
        if (!info.shortcut) return info;
        if (!await focused()) return { ...info, status: 'unfocused' };
        return { ...info, status: await run([String(process.pid), ...typelessChord(info.shortcut)!.map(key => `${key.code}:${key.flags}`)], focused) };
      } catch { return { status: 'unavailable' }; }
      finally { sending = false; }
    },
  };
}
