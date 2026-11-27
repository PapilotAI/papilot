import path from 'node:path';
import fs from 'node:fs/promises';

export function inside(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
// A dirty buffer can outlive its file. Resolve its existing parents so a
// deleted file opened through a workspace alias still belongs to that root.
async function canonical(file: string, seen = new Set<string>()): Promise<string> {
  if (seen.has(file)) throw new Error('Circular symbolic link: ' + file);
  seen.add(file);
  try { return await fs.realpath(file); }
  catch (error) {
    const parent = path.dirname(file);
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === file) throw error;
    // realpath also fails for a dangling link; its unsaved editor buffer still
    // belongs to the deleted target, not to the alias's directory.
    let link: string;
    try { link = await fs.readlink(file); }
    catch (error) {
      if (!['ENOENT', 'EINVAL'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      return path.join(await canonical(parent, seen), path.basename(file));
    }
    return canonical(path.resolve(parent, link), seen);
  }
}
export async function insideReal(root: string, file: string) {
  const [directory, target] = await Promise.all([canonical(root), canonical(file)]);
  return inside(directory, target);
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
