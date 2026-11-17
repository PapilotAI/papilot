import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FolderListing } from '../shared.ts';

const isFolder = (target: string) => fs.promises.stat(target).then(stat => stat.isDirectory(), () => false);

const absolute = 'Enter an absolute folder path on the computer running Papilot.';
// A partly typed, moved or file path resolves to its nearest existing folder;
// an empty, relative or ~ path starts in the home folder.
export async function nearestFolder(value: unknown) {
  if (value !== undefined && (typeof value !== 'string' || value.length > 4000 || value.includes('\0'))) throw new Error('Invalid file path.');
  const typed = (value as string | undefined)?.trim() || '~';
  const requested = typed === '~' || /^~[\\/]/.test(typed) ? path.join(os.homedir(), typed.slice(1)) : typed;
  let current = path.isAbsolute(requested) ? path.resolve(requested) : os.homedir();
  while (!await isFolder(current) && path.dirname(current) !== current) current = path.dirname(current);
  return current;
}

// Lists folders on the computer running Papilot for a browser on another device,
// where the system folder picker would appear on an unattended screen.
export async function listFolders(input: { path?: unknown }): Promise<FolderListing> {
  const current = await nearestFolder(input.path);
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(current, { withFileTypes: true }); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') throw new Error('Papilot cannot read this folder.');
    // Only a missing root, such as an unmounted drive, remains here.
    if (code === 'ENOENT') throw new Error(absolute);
    throw error;
  }
  const folders: FolderListing['folders'] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const target = path.join(current, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink() && await isFolder(target)) folders.push({ name: entry.name, path: target });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const parent = path.dirname(current);
  return { path: current, parent: parent === current ? null : parent, folders };
}
