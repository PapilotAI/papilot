import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ENGINE } from './paths.ts';
import { existingTex, isRootDocument } from './imports.ts';
import type { RepositoryFile } from '../shared.ts';

// The paper's file browser: every file of its repository, of which the TeX
// files that are root documents can be compiled instead of the current one.

const execute = promisify(execFile);
// Whether each TeX file is a root document, by file and version: the browser
// reads the list each time it opens, and a thesis has many TeX files.
const roots = new Map<string, { stamp: string; root: boolean }>();
/** Whether `file` is a root document as it is on disk now. */
export function rootDocument(root: string, file: string, stat = fs.statSync(path.join(root, file), { throwIfNoEntry: false })) {
  if (!stat?.isFile()) return false;
  const key = path.join(root, file), stamp = `${stat.mtimeMs}:${stat.size}`, known = roots.get(key);
  if (known?.stamp === stamp) return known.root;
  const value = isRootDocument(root, file);
  roots.set(key, { stamp, root: value });
  if (roots.size > 5000) roots.delete(roots.keys().next().value!);
  return value;
}
const config = () => import(pathToFileURL(path.join(ENGINE, 'src/core/config.ts')).href) as Promise<typeof import('../../engine/src/core/config.ts')>;
// The documents the paper compiled before, which can always compile again.
export async function compiledBefore(root: string) {
  const { documentsFile } = await config();
  try { return new Set(Object.keys(JSON.parse(fs.readFileSync(documentsFile(root), 'utf8')))); } catch { return new Set<string>(); }
}

/** The files Git sees in the repository: tracked ones still on disk and
 *  untracked ones it does not ignore. The root documents are those that
 *  begin a document, the current one and those the paper compiled before. */
export async function repositoryFiles(root: string, current?: string): Promise<RepositoryFile[]> {
  let stdout: string;
  try { ({ stdout } = await execute('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { timeout: 30000, maxBuffer: 64 * 1024 * 1024 })); }
  catch { throw new Error('Could not list the files of this repository.'); }
  const listed = [...new Set(stdout.split('\0').filter(Boolean))].sort(), stats: (fs.Stats | undefined)[] = [];
  // Off the event loop, in batches: a thesis can have thousands of figures and data files.
  for (let start = 0; start < listed.length; start += 64)
    stats.push(...await Promise.all(listed.slice(start, start + 64).map(file => fs.promises.stat(path.join(root, file)).catch(() => undefined))));
  const files: RepositoryFile[] = [], before = await compiledBefore(root);
  for (const [index, file] of listed.entries()) {
    const stat = stats[index];
    // A tracked file deleted since is gone; a submodule is listed as one entry, a folder.
    if (!stat?.isFile()) continue;
    const isRoot = /\.tex$/i.test(file) && (file === current || before.has(file) || rootDocument(root, file, stat));
    files.push(isRoot ? { path: file, root: true } : { path: file });
  }
  return files;
}

/** Checks that `main` can be the root document the paper compiles. */
export async function checkDocument(root: string, main: unknown): Promise<string> {
  if (!existingTex(root, main) || !(isRootDocument(root, main) || (await compiledBefore(root)).has(main)))
    throw new Error('Choose a TeX file with \\documentclass and \\begin{document}.');
  (await config()).loadProject(root, undefined, main);
  return main;
}
/** Makes `main` the root document the paper compiles; false when it already is. */
export async function chooseDocument(root: string, main: string) {
  return (await config()).chooseDocument(root, main);
}
