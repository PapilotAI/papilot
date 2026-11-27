import path from 'node:path';
import fs from 'node:fs/promises';

export function inside(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
/** Navigation never escapes the repository, including through a symlink. */
export async function sourcePath(root: string, file: string) {
  const resolved = path.resolve(root, file);
  if (!inside(root, resolved) || !inside(await fs.realpath(root), await fs.realpath(resolved))) throw new Error('The source file is outside this repository.');
  return resolved;
}
export function routePath(route: unknown) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || /[\\#\r\n]/.test(route)) throw new Error('Invalid Papilot request.');
  const parsed = new URL(route, 'http://papilot.invalid');
  if (parsed.origin !== 'http://papilot.invalid' || parsed.pathname !== route.split('?')[0] || /%2f|%5c|%2e/i.test(parsed.pathname)) throw new Error('Invalid Papilot request.');
  return parsed.pathname;
}
