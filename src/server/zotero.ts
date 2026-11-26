import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// The author's Zotero library, read and never written: each item's citation
// keys, DOI, arXiv identifier, title and year, and the PDFs attached to it.
// Zotero keeps its database open while it runs, so it is opened immutable,
// which reads the file without taking a lock. Better BibTeX keeps its keys in
// a database of its own; Zotero 7 also has a citation key field, and older
// libraries pin keys in Extra.

export interface ZoteroItem {
  key: string;
  citationKeys: string[];
  doi: string | null;
  arxiv: string | null;
  title: string;
  year: number | null;
  /** Absolute paths of the attached PDFs that exist on disk. */
  pdfs: string[];
  /** PDFs in Zotero's online storage, for an item synced from the account. */
  remote?: RemoteFile[];
}
/** A PDF Zotero stores online: its web API address, its file name and the
 * MD5 of its content, which changes when the file is replaced. */
export interface RemoteFile { url: string; name: string; md5: string }

/** Values of a Firefox-style prefs.js, the file Zotero keeps its settings in. */
export function readPrefs(text: string) {
  const prefs: Record<string, string | boolean> = {};
  for (const match of text.matchAll(/user_pref\("([^"]+)",\s*("(?:[^"\\]|\\.)*"|true|false)\);/g)) {
    prefs[match[1]] = match[2] === 'true' ? true : match[2] === 'false' ? false : JSON.parse(match[2]);
  }
  return prefs;
}

function profileDirs(home: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv) {
  const roots = platform === 'darwin' ? [path.join(home, 'Library', 'Application Support', 'Zotero', 'Profiles')]
    : platform === 'win32' ? [path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Zotero', 'Zotero', 'Profiles')]
      : [path.join(home, '.zotero', 'zotero')];
  return roots.flatMap(root => {
    try { return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(root, entry.name)); }
    catch { return []; }
  });
}

/** Where Zotero keeps its database and files, and the folder linked files
 * are relative to, or null when there is no Zotero library here. */
export function findZotero(home = os.homedir(), platform = process.platform, env = process.env) {
  let dataDir = path.join(home, 'Zotero'), base: string | null = null;
  for (const dir of profileDirs(home, platform, env)) {
    let prefs: Record<string, string | boolean>;
    try { prefs = readPrefs(fs.readFileSync(path.join(dir, 'prefs.js'), 'utf8')); } catch { continue; }
    if (prefs['extensions.zotero.useDataDir'] === true && typeof prefs['extensions.zotero.dataDir'] === 'string') dataDir = prefs['extensions.zotero.dataDir'];
    if (typeof prefs['extensions.zotero.baseAttachmentPath'] === 'string') base = prefs['extensions.zotero.baseAttachmentPath'];
    break;
  }
  return fs.existsSync(path.join(dataDir, 'zotero.sqlite')) ? { dataDir, base } : null;
}

const open = (file: string) => new DatabaseSync(new URL(pathToFileURL(file).href + '?immutable=1'), { readOnly: true });

export const cleanDoi = (value: string) => value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;
const ARXIV = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*|10\.48550\/arxiv\.)(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})/i;
/** The arXiv identifier in any of an item's fields, without its version. */
export const arxivIn = (...values: (string | undefined | null)[]) => {
  for (const value of values) { const match = ARXIV.exec(value || ''); if (match) return match[1].toLowerCase(); }
  return null;
};

/** An item's title, year, DOI, arXiv identifier and citation keys, from
 * its fields as Zotero names them, in the database or the web API. */
export function itemFacts(fields: Partial<Record<'title' | 'DOI' | 'date' | 'url' | 'extra' | 'citationKey' | 'archiveID' | 'number', string>>) {
  const { title = '', DOI: doi, date, url, extra = '', citationKey, archiveID, number } = fields;
  const doiValue = doi || /^DOI:\s*(\S+)/im.exec(extra)?.[1];
  const cleaned = doiValue && DOI.test(doiValue) ? cleanDoi(DOI.exec(doiValue)![1]) : null;
  const pinned = /^Citation Key:\s*(\S+)/im.exec(extra)?.[1];
  return {
    title, year: Number(/\b(\d{4})\b/.exec(date || '')?.[1]) || null, doi: cleaned,
    arxiv: arxivIn(archiveID, url, extra, cleaned, number && /arxiv/i.test(archiveID || '') ? `arXiv:${number}` : null),
    citationKeys: [citationKey, pinned].filter((key): key is string => Boolean(key)),
  };
}

/** Every regular item with its keys, identifiers and existing PDFs. */
export function readZotero(location: { dataDir: string; base: string | null }): ZoteroItem[] {
  const db = open(path.join(location.dataDir, 'zotero.sqlite'));
  try {
    const items = new Map<number, ZoteroItem & { libraryID: number; fields: Record<string, string> }>();
    const regular = db.prepare(`SELECT i.itemID AS id, i.key AS key, i.libraryID AS libraryID FROM items i
      JOIN itemTypes t ON t.itemTypeID = i.itemTypeID
      WHERE t.typeName NOT IN ('attachment', 'note', 'annotation') AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`).all() as { id: number; key: string; libraryID: number }[];
    for (const row of regular) items.set(row.id, { key: row.key, libraryID: row.libraryID, citationKeys: [], doi: null, arxiv: null, title: '', year: null, pdfs: [], fields: {} });
    // A type's own name for a field, such as a case's name, counts as its title.
    const fields = db.prepare(`SELECT d.itemID AS id, COALESCE(b.fieldName, f.fieldName) AS name, v.value AS value FROM itemData d
      JOIN fields f ON f.fieldID = d.fieldID
      JOIN itemDataValues v ON v.valueID = d.valueID
      JOIN items i ON i.itemID = d.itemID
      LEFT JOIN baseFieldMappings m ON m.fieldID = d.fieldID AND m.itemTypeID = i.itemTypeID
      LEFT JOIN fields b ON b.fieldID = m.baseFieldID
      WHERE COALESCE(b.fieldName, f.fieldName) IN ('title', 'DOI', 'date', 'url', 'extra', 'citationKey', 'archiveID', 'number')`).all() as { id: number; name: string; value: string }[];
    for (const row of fields) { const item = items.get(row.id); if (item) item.fields[row.name] = String(row.value); }
    for (const item of items.values()) Object.assign(item, itemFacts(item.fields));
    const attachments = db.prepare(`SELECT a.parentItemID AS parent, a.linkMode AS mode, a.path AS file, i.key AS key FROM itemAttachments a
      JOIN items i ON i.itemID = a.itemID
      WHERE a.contentType = 'application/pdf' AND a.parentItemID IS NOT NULL AND a.path IS NOT NULL
        AND a.itemID NOT IN (SELECT itemID FROM deletedItems)`).all() as { parent: number; mode: number; file: string; key: string }[];
    for (const row of attachments) {
      const item = items.get(row.parent);
      if (!item) continue;
      // Imported files live in storage/<attachment key>/; linked files are
      // absolute, or relative to the base folder set in Zotero.
      const file = row.mode === 0 || row.mode === 1 ? path.join(location.dataDir, 'storage', row.key, row.file.replace(/^storage:/, ''))
        : row.mode === 2 ? (row.file.startsWith('attachments:') ? (location.base ? path.join(location.base, row.file.slice('attachments:'.length)) : '') : row.file) : '';
      if (file && fs.existsSync(file)) item.pdfs.push(file);
    }
    const betterBibtex = path.join(location.dataDir, 'better-bibtex.sqlite');
    if (fs.existsSync(betterBibtex)) {
      const keys = new Map([...items.values()].map(item => [`${item.libraryID}/${item.key}`, item]));
      let bbt: DatabaseSync | undefined;
      try {
        bbt = open(betterBibtex);
        for (const row of bbt.prepare('SELECT libraryID, itemKey, citationKey FROM citationkey').all() as { libraryID: number; itemKey: string; citationKey: string }[]) {
          keys.get(`${row.libraryID}/${row.itemKey}`)?.citationKeys.push(row.citationKey);
        }
      } catch { /* Better BibTeX versions before 6 kept keys elsewhere. */ }
      finally { bbt?.close(); }
    }
    return [...items.values()].map(({ libraryID: _library, fields: _fields, ...item }) => ({ ...item, citationKeys: [...new Set(item.citationKeys)] }));
  } finally { db.close(); }
}
