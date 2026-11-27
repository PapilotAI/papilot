import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// crypto.randomUUID is unavailable when Papilot is opened over plain LAN HTTP.
export const browserUuid = () => crypto.randomUUID?.() || bytesToHex(crypto.getRandomValues(new Uint8Array(16))).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

// Persist only a digest: duplicating a long draft here can exhaust browser
// storage and lose the retry ID on reload. JS hashing also works over LAN HTTP.
export function requestId(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, content: string, newId: () => string): string {
  const signature = 'sha256:' + bytesToHex(sha256(utf8ToBytes(content)));
  let previous: { signature?: unknown; id?: unknown } | null = null;
  try { previous = JSON.parse(storage.getItem(key) || 'null'); } catch { /* Invalid saved request. */ }
  // Migrate older records without changing the ID of a pending submission.
  const matches = previous?.signature === signature || previous?.signature === content;
  const id = matches && typeof previous?.id === 'string' && previous.id ? previous.id : newId();
  storage.setItem(key, JSON.stringify({ signature, id }));
  return id;
}
