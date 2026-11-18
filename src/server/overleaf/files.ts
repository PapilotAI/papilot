import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Which files of a paper folder belong to its Overleaf project, and how they
// are read and written. Hidden files, editor and system leftovers, secrets
// and LaTeX build output stay on this computer; Overleaf has no use for them
// and coauthors should not receive them.

const BUILD_OUTPUT = /\.(?:aux|log|out|toc|lof|lot|loa|lol|fls|fdb_latexmk|synctex|synctex\.gz|synctex\(busy\)|blg|bcf|run\.xml|nav|snm|vrb|xdv|dvi|ilg|ind|idx|glg|glo|gls|acn|acr|alg|ist|thm|brf|nlo|nls|xwm|maf|mtc\d*|ptc|upa|upb|bak)$/i;
const SYSTEM = new Set(['__macosx', 'thumbs.db', 'desktop.ini', 'node_modules', 'icon\r']);
const SECRET = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?!.*\.pub$).*|.*\.(?:pem|p12|pfx|key))$/i;

/** Whether a path is never synchronized, in either direction. */
export function ignored(file: string) {
  return file.split('/').some(part => part.startsWith('.') || SYSTEM.has(part.toLowerCase()) || part.endsWith('~') || /^#.*#$/.test(part) || /\.(?:swp|swo|tmp)$/i.test(part) || /^_minted/i.test(part));
}
/** Whether a local file stays local unless Overleaf already has it: build
 *  output, a PDF or bibliography made from a TeX file beside it, and secrets. */
export function localOnly(file: string, exists: (sibling: string) => boolean) {
  const name = path.posix.basename(file);
  if (BUILD_OUTPUT.test(name) || SECRET.test(name)) return true;
  const output = /^(.*)\.(?:pdf|bbl)$/i.exec(file);
  return Boolean(output && exists(output[1] + '.tex'));
}
/** A name Overleaf may hold but this computer cannot. */
export function unsafeName(file: string, windows = process.platform === 'win32') {
  return file.split('/').some(part => !part || part === '.' || part === '..' || /[\\\0]/.test(part)
    || (windows && (/[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part))));
}

/** Git's blob hash, which Overleaf also uses for its files. */
export const blobHash = (data: Buffer | string) => {
  const bytes = typeof data === 'string' ? Buffer.from(data) : data;
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};

export interface LocalFile { size: number; mtimeMs: number }
/** Whether the paper folder is there to sync: a moved folder or an
 *  unmounted disk must not read as every file deleted. */
export function present(root: string) {
  try { return fs.lstatSync(root).isDirectory(); } catch { return false; }
}
/** Every synchronizable file of the folder, with what shows it changed, and
 *  the symbolic links in it, which stay as they are. */
export function scan(root: string) {
  const files = new Map<string, LocalFile>(), links = new Set<string>(), folders = [''];
  while (folders.length) {
    const folder = folders.pop()!;
    // An unreadable folder is not an empty one: abort the scan before its
    // missing entries can be mistaken for deletions on Overleaf.
    const directory = folder ? inside(root, folder) : root;
    if (!fs.lstatSync(directory).isDirectory()) throw new Error('Invalid file path.');
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const file = folder ? `${folder}/${entry.name}` : entry.name;
      if (ignored(file)) continue;
      if (entry.isSymbolicLink()) links.add(file);
      else if (entry.isDirectory()) folders.push(file);
      else if (entry.isFile()) {
        const value = stat(root, file);
        if (value) files.set(file, value);
      }
    }
  }
  return Object.assign(files, { links });
}
/** Whether a path is, or lies under, one of the folder's symbolic links. */
export const linked = (links: Set<string>, file: string) => file.split('/').some((_, index, parts) => links.has(parts.slice(0, index + 1).join('/')));
// A path inside the folder that goes through no symbolic link: names from
// Overleaf must never reach files elsewhere.
function inside(root: string, file: string) {
  const target = path.resolve(root, file);
  if (unsafeName(file) || !target.startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid file path.');
  if (!fs.lstatSync(root).isDirectory()) throw new Error('Invalid file path.');
  for (let at = path.dirname(target); at.length > path.resolve(root).length; at = path.dirname(at)) {
    try { if (fs.lstatSync(at).isSymbolicLink()) throw new Error('Invalid file path.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return target;
}
export function stat(root: string, file: string): LocalFile | null {
  try {
    const value = fs.lstatSync(inside(root, file));
    if (value.isSymbolicLink()) throw new Error('Invalid file path.');
    return value.isFile() ? { size: value.size, mtimeMs: value.mtimeMs } : null;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export function read(root: string, file: string) {
  try {
    const target = inside(root, file);
    if (!fs.lstatSync(target).isFile()) throw new Error('Invalid file path.');
    return fs.readFileSync(target);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
/** UTF-8 text, or null for bytes that are not. */
export function decode(data: Buffer) {
  const text = data.toString('utf8');
  return text.includes('\uFFFD') && !Buffer.from(text).equals(data) ? null : text.replace(/^\uFEFF/, '');
}
/** Writes a file whole: readers such as TeX never see half of it. */
export function write(root: string, file: string, data: Buffer | string) {
  const target = inside(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let mode: number | undefined;
  try {
    const existing = fs.lstatSync(target);
    if (!existing.isFile()) throw new Error('Invalid file path.');
    mode = existing.mode & 0o777;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID().slice(0, 8)}.papilot`);
  try {
    fs.writeFileSync(temporary, data, { mode: mode ?? 0o644 });
    fs.renameSync(temporary, target);
  } finally { fs.rmSync(temporary, { force: true }); }
}
export function remove(root: string, file: string) {
  const target = inside(root, file);
  try { if (!fs.lstatSync(target).isFile()) return; } catch { return; }
  fs.rmSync(target, { force: true });
  // Leave no empty folders behind, as Overleaf does not keep them either.
  for (let folder = path.posix.dirname(file); folder !== '.'; folder = path.posix.dirname(folder)) {
    try { fs.rmdirSync(path.join(root, folder)); } catch { break; }
  }
}
export function move(root: string, from: string, to: string) {
  const source = inside(root, from), target = inside(root, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // A change of case only goes through another name on a disk that ignores case.
  if (from.toLowerCase() === to.toLowerCase()) { const step = `${source}.${randomUUID().slice(0, 8)}.papilot`; fs.renameSync(source, step); fs.renameSync(step, target); }
  else fs.renameSync(source, target);
  for (let folder = path.posix.dirname(from); folder !== '.'; folder = path.posix.dirname(folder)) {
    try { fs.rmdirSync(path.join(root, folder)); } catch { break; }
  }
}
/** The line ending most of a text file uses, kept when Overleaf's edits are written. */
export const lineEnding = (text: string) => { const crlf = text.match(/\r\n/g)?.length || 0; return crlf && crlf * 2 >= (text.match(/\n/g)?.length || 0) ? '\r\n' : '\n'; };
/** Line endings as Overleaf stores them. */
export const normalize = (text: string) => text.replace(/\r\n?/g, '\n');
