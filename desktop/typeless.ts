import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const bundleId = 'now.typeless.desktop';

type ShortcutDetection =
  | { status: 'detected'; bindings: string[]; source: 'featureShortcutBindings' | 'keyboardShortcut' }
  | { status: 'unavailable'; reason: 'unreadable' | 'invalid' | 'missing' };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Read configured bindings, never Typeless's presumed defaults. Its newer
 * bindings take precedence even when explicitly empty or no longer understood. */
export function typelessShortcuts(settings: unknown): ShortcutDetection {
  if (!object(settings)) return { status: 'unavailable', reason: 'invalid' };
  if ('featureShortcutBindings' in settings) {
    const features = settings.featureShortcutBindings;
    if (!object(features) || !('dictationMode' in features)) return { status: 'unavailable', reason: 'invalid' };
    const bindings = features.dictationMode;
    if (!Array.isArray(bindings) || !bindings.every(value => typeof value === 'string' && value.trim())) return { status: 'unavailable', reason: 'invalid' };
    return { status: 'detected', bindings: [...new Set(bindings)], source: 'featureShortcutBindings' };
  }
  if (!('keyboardShortcut' in settings)) return { status: 'unavailable', reason: 'missing' };
  const legacy = settings.keyboardShortcut;
  if (!object(legacy) || typeof legacy.pushToTalk !== 'string' || !legacy.pushToTalk.trim()) return { status: 'unavailable', reason: 'invalid' };
  return { status: 'detected', bindings: [legacy.pushToTalk], source: 'keyboardShortcut' };
}

type Bundle = { id: string; version: string };
async function readBundle(directory: string): Promise<Bundle> {
  const plist = path.join(directory, 'Contents', 'Info.plist');
  const read = async (key: string) => (await exec('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).stdout.trim();
  const [id, version] = await Promise.all([read('CFBundleIdentifier'), read('CFBundleShortVersionString')]);
  return { id, version };
}

/** A local, read-only feasibility probe. Detection alone does not establish
 * control: it neither launches Typeless nor reads dictation history or audio. */
export async function inspectTypeless({ platform = process.platform, home = homedir(), applications = ['/Applications', path.join(home, 'Applications')], bundle = readBundle }: {
  platform?: string; home?: string; applications?: string[]; bundle?: (directory: string) => Promise<Bundle>;
} = {}) {
  const control = { status: 'unverified' as const, recording: 'unknown' as const };
  if (platform !== 'darwin') return { platform, installation: { status: 'unsupported-platform' as const }, shortcuts: { status: 'unavailable' as const, reason: 'unsupported-platform' }, control };
  let installation: { status: 'detected'; path: string; version: string } | { status: 'not-detected' } = { status: 'not-detected' };
  for (const directory of applications) {
    const application = path.join(directory, 'Typeless.app');
    try {
      const info = await bundle(application);
      if (info.id !== bundleId || !info.version) continue;
      installation = { status: 'detected', path: application, version: info.version };
      break;
    } catch { /* Not installed here, or its metadata cannot be read. */ }
  }
  if (installation.status !== 'detected') return { platform, installation, shortcuts: { status: 'unavailable' as const, reason: 'not-detected' }, control };
  let shortcuts: ShortcutDetection;
  try {
    const settings: unknown = JSON.parse(await readFile(path.join(home, 'Library', 'Application Support', 'Typeless', 'app-settings.json'), 'utf8'));
    shortcuts = typelessShortcuts(settings);
  } catch (error) {
    shortcuts = { status: 'unavailable', reason: error instanceof SyntaxError ? 'invalid' : 'unreadable' };
  }
  return { platform, installation, shortcuts, control };
}
