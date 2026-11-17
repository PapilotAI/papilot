import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isRootDocument } from './imports.ts';

export interface DiscoveredPaper { root: string; main: string; file: string }
export interface PaperSearchFolder { path: string; files: string[] }
const execute = promisify(execFile);
const git = async (root: string, ...args: string[]) => (await execute('git', ['-C', root, ...args], { timeout: 30000, maxBuffer: 64 * 1024 * 1024 })).stdout;

/** Inspect host-supplied file lists without registering papers or changing Git.
 * Hosts choose the search scope; paper detection stays shared with imports. */
export async function discoverPapers(folders: PaperSearchFolder[]): Promise<DiscoveredPaper[]> {
  const papers = new Map<string, DiscoveredPaper>();
  const repositories = new Map<string, string | null>(), visible = new Map<string, Set<string>>();
  for (const folder of folders) {
    const base = await fs.promises.realpath(folder.path);
    for (const relative of folder.files) {
      // Also rejects escapes, symlinks, deleted files and included chapters.
      try { if (!isRootDocument(base, relative)) continue; }
      catch (error) {
        if (['ENOENT', 'EACCES', 'EPERM', 'EISDIR'].includes((error as NodeJS.ErrnoException).code || '')) continue;
        throw error;
      }
      const file = path.join(base, relative), directory = path.dirname(file);
      if (!repositories.has(directory)) {
        try { repositories.set(directory, (await git(directory, 'rev-parse', '--show-toplevel')).trim()); }
        catch (error) {
          if ((error as { code?: number }).code !== 128) throw error;
          repositories.set(directory, null);
        }
      }
      const repository = repositories.get(directory), root = repository || base;
      const main = path.relative(root, file).split(path.sep).join('/');
      if (repository) {
        if (!visible.has(root)) visible.set(root, new Set((await git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')).split('\0')));
        if (!visible.get(root)!.has(main)) continue;
      }
      papers.set(file, { root, main, file });
    }
  }
  return [...papers.values()].sort((a, b) => a.file.localeCompare(b.file));
}
