export type ImportFile = { file: File; path: string };
export const ignoredImportPath = (name: string) => name.split('/').some(part => ['.git', '__macosx', '.ds_store', 'node_modules', '.papilot'].includes(part.toLowerCase()) || part.startsWith('._'));
// Folder drops in the copy section preserve relative paths and upload copies.
export async function droppedFolder(entry: FileSystemDirectoryEntry): Promise<ImportFile[]> {
  const files: ImportFile[] = [], pending: FileSystemEntry[] = [entry];
  while (pending.length) {
    const item = pending.pop()!, name = item.fullPath.replace(/^\//, '');
    if (ignoredImportPath(name)) continue;
    if (item.isDirectory) {
      const reader = (item as FileSystemDirectoryEntry).createReader();
      // Chromium returns directory entries in batches, not all at once.
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) pending.push(child);
      }
    } else if (item.isFile) {
      const file = await new Promise<File>((resolve, reject) => (item as FileSystemFileEntry).file(resolve, reject));
      files.push({ file, path: name });
    }
  }
  return files;
}
