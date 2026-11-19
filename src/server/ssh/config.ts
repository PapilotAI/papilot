import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Enumerate literal aliases for the picker. OpenSSH itself resolves every
// connection option, including Host patterns, Match, identities and jumps.
export const hostName = /^(?:[a-zA-Z0-9_][a-zA-Z0-9._-]*|[a-fA-F0-9:]+(?:%[a-zA-Z0-9_.-]+)?)$/;

function words(line: string) {
  return (line.match(/(?:[^\s"'#\\]|\\.|"[^"]*"|'[^']*')+|#.*/g) || [])
    .filter(word => !word.startsWith('#')).map(word => word.replace(/"([^"]*)"|'([^']*)'|\\(.)/g, (_, a, b, c) => a ?? b ?? c));
}

export async function sshAliases(home = os.homedir()) {
  const directory = path.join(home, '.ssh'), visited = new Set<string>(), aliases = new Set<string>();
  async function scan(file: string, depth: number) {
    if (depth > 16 || visited.has(file)) return;
    visited.add(file);
    let source: string;
    try { source = await fs.readFile(file, 'utf8'); } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes((error as NodeJS.ErrnoException).code || '')) return;
      throw error;
    }
    for (const line of source.split(/\r?\n/)) {
      const match = /^\s*(Host|Include)(?:\s*=\s*|\s+)(.*)$/i.exec(line);
      if (!match) continue;
      for (const word of words(match[2])) {
        if (match[1].toLowerCase() === 'host') {
          if (hostName.test(word)) aliases.add(word);
        } else {
          const pattern = path.resolve(directory, word.startsWith('~/') ? path.join(home, word.slice(2)) : word);
          for await (const included of fs.glob(pattern)) await scan(included, depth + 1);
        }
      }
    }
  }
  await scan(path.join(directory, 'config'), 0);
  return [...aliases].sort((a, b) => a.localeCompare(b));
}
