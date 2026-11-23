import fs from 'node:fs';
import dns from 'node:dns';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { arxivOf, bibAuthors, compact, doiOf, plain, titleScore, type CheckInput } from '../../engine/src/core/verify.ts';
import type { ReviewSnapshot } from './ai-review.ts';
import { findZotero, readZotero, type RemoteFile, type ZoteroItem } from './zotero.ts';
import { AccountStore, API, API_HOST, checkKey, syncAccount, webCounts, webItems, type Account, type Get, type SyncProblem, type WebCache } from './zotero-web.ts';
import type { LibraryEntry, LibraryPdf, LibrarySource, ReferenceCheck, ZoteroStatus } from '../shared.ts';

// The author's literature library: a PDF for each work the paper cites, kept
// once for every paper. A work is known by its DOI, its arXiv identifier or
// its title and year, so a PDF found for one paper serves every paper citing
// the same work. PDFs come from the author's Zotero library (read where
// Zotero keeps them, or downloaded from the author's Zotero account), from
// arXiv and open-access copies OpenAlex knows of, from the author, or from
// an agent that found an open copy elsewhere. Each PDF's text is read once, line by line, for agents to
// search.

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
/** The addresses a host name resolves to. */
export type Lookup = (host: string) => Promise<{ address: string }[]>;
export interface Snapshots { run(pdf: string, key?: string): Promise<ReviewSnapshot> }
/** A bibliography entry with what an online check found of it. */
export interface LibraryInput extends CheckInput { key: string; check?: ReferenceCheck }
/** Zotero's files on this computer are read where Zotero keeps them; the
 * library's own live in its files folder under their hash. One downloaded
 * from the Zotero account notes its web API address. */
interface Stored { file?: string; remote?: string; md5?: string; source: LibrarySource; url?: string; pages: number | null; text: LibraryPdf['text']; added: number }
/** A look that found no PDF: none is open, or a source could not be reached. */
interface Miss { at: number; landing: string | null; failed?: boolean; removed?: boolean }
interface Candidate { url: string; source: LibrarySource; trusted: boolean; page?: boolean }
interface Location { pdf_url?: string | null; landing_page_url?: string | null; source?: { type?: string } | null }
interface Work { title?: string | null; publication_year?: number | null; doi?: string | null; open_access?: { is_oa?: boolean; oa_url?: string | null } | null; best_oa_location?: Location | null; locations?: Location[] }
/** What a request gave: a value, nothing (an answer that this address has
 * none), or 'unavailable' when the source could not be reached. */
type Outcome<T> = T | null | 'unavailable';
type Known = ReturnType<typeof identify>;

const AGENT = 'Papilot (https://papilot.ai)';
// Milliseconds between two requests to a host; arXiv asks for one request
// every three seconds.
const PACE: Record<string, number> = { 'export.arxiv.org': 3000, 'api.openalex.org': 200, [API_HOST]: 200 };
// A request that receives nothing for this long has stalled.
const STALL = 30000;
// A work with no open copy is looked for again after a week; one whose
// sources could not be reached, as the review engine's checks are, after two
// minutes, on the next fresh look rather than while the panel keeps polling,
// so that a long list of failures cannot keep it polling forever.
const RETRY = 7 * 24 * 3600 * 1000, RETRY_FAILED = 120000;
// Fetch's own limit on redirects, kept when following them one by one.
const REDIRECTS = 20;
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})/i;
const DOI_TEXT = /\b(10\.\d{4,9}\/[^\s"<>]+[^\s"<>.,;)\]])/gi;
const ARXIV_TEXT = /arXiv:\s*(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})/gi;

const yearOf = (value: string | number | null | undefined) => Number(/\b(\d{4})\b/.exec(String(value ?? ''))?.[1]) || null;
/** A title as an identity. Long titles name one work, given its year; a
 * short one, such as "Deep Sets", also needs its first author or year. */
const titleId = (title: string, year: number | null, family: string | null) =>
  title.length >= 12 ? `title:${title}|${year ?? ''}` : title && (family || year) ? `title:${title}|${year ?? ''}|${family ?? ''}` : null;

/** What says which work an entry is: its own DOI and arXiv identifier, or a
 * verified record's, and its title with its year. */
export function identify(input: LibraryInput) {
  const record = input.check?.status === 'verified' ? input.check.record : undefined;
  const doi = (doiOf(input.fields) ?? record?.doi ?? null)?.toLowerCase() ?? null;
  const arxiv = (arxivOf(input.fields) ?? ARXIV_URL.exec(record?.url ?? '')?.[1] ?? null)?.toLowerCase() ?? null;
  const title = compact(input.fields.title ?? ''), year = yearOf(input.fields.year ?? input.fields.date);
  const family = bibAuthors(input.fields.author ?? input.fields.editor ?? '').families[0] || null;
  const ids = [doi && `doi:${doi}`, arxiv && `arxiv:${arxiv}`, titleId(title, year, family)].filter(Boolean) as string[];
  return { ids, doi, arxiv, title, year };
}

/** Whether the first pages of a PDF are those of this work: they show its
 * DOI, or its whole title. */
export function looksLike(snapshot: ReviewSnapshot, title: string, doi: string | null) {
  const text = snapshot.lines.filter(line => line.page < 3).map(line => line.text).join(' ');
  if (doi && text.toLowerCase().includes(doi)) return true;
  const wanted = compact(title);
  return wanted.length >= 6 && compact(text).includes(wanted);
}

/** The entry a PDF is of, judged from its first pages: a DOI or arXiv
 * identifier printed on them, or else a single entry whose title they show. */
export function matchPdf(snapshot: ReviewSnapshot, inputs: LibraryInput[]) {
  const text = snapshot.lines.filter(line => line.page < 2).map(line => line.text).join(' ');
  const known = inputs.map(input => ({ input, ...identify(input) }));
  for (const [, doi] of text.matchAll(DOI_TEXT)) {
    const found = known.find(item => item.doi === doi.toLowerCase());
    if (found) return found.input;
  }
  for (const [, id] of text.matchAll(ARXIV_TEXT)) {
    const found = known.find(item => item.arxiv === id.toLowerCase());
    if (found) return found.input;
  }
  const titled = known.filter(item => looksLike({ ...snapshot, lines: snapshot.lines.filter(line => line.page < 2) }, item.input.fields.title ?? '', null));
  return titled.length === 1 ? titled[0].input : null;
}

/** Whether an IP address is on the public internet: not this computer, its
 * local network or a reserved range. */
export function publicAddress(address: string) {
  const host = address.toLowerCase();
  if (net.isIPv4(host)) {
    const [a, b] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  }
  // IPv6 loopback, local and site addresses, and IPv4 inside IPv6 (::a.b.c.d, ::ffff:, NAT64).
  if (net.isIPv6(host)) return !(host.startsWith('::') || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('64:ff9b:'));
  return false;
}

/** Whether an address may be fetched: http(s) on a public host, never this
 * computer or its local network, whatever a landing page or redirect names.
 * A host name is also checked against what it resolves to when fetched. */
export function publicUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  if (net.isIP(host)) return publicAddress(host);
  return host.includes('.') && !/\.(?:localhost|local|internal|home|lan)$/.test(host);
}
const resolve: Lookup = host => dns.promises.lookup(host, { all: true, verbatim: true });

const isPdf = (head: Uint8Array) => Buffer.from(head.subarray(0, 5)).toString('latin1') === '%PDF-';
const sha256 = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type ZoteroIndex = { stamp: string; byKey: Map<string, ZoteroItem>; byDoi: Map<string, ZoteroItem>; byArxiv: Map<string, ZoteroItem>; byTitle: Map<string, ZoteroItem[]> };
type LocalZotero = { stamp: string; dataDir: string; items: ZoteroItem[]; counts: { items: number; withPdf: number; citationKeys: number } };
type Job = { id: string; run: () => Promise<void>; fail: () => void };
type Lane = 'local' | 'online' | 'account';

export class Library {
  private db: DatabaseSync;
  // Work on this computer, such as reading Zotero's files, does not wait
  // behind downloads, nor the Zotero account behind lookups elsewhere.
  private lanes: Record<Lane, { queue: Job[]; active: string | null }> = { local: { queue: [], active: null }, online: { queue: [], active: null }, account: { queue: [], active: null } };
  private queued = new Set<string>();
  private last = new Map<string, number>();
  private zotero?: ZoteroIndex;
  private local?: LocalZotero;
  private texts = new Map<string, Promise<ReviewSnapshot | null>>();
  // Zotero files not to link to a work until the time given: never again,
  // after the author took them away or they could not be read, or a while
  // after Zotero's storage could not be reached.
  private declined = new Map<string, number>();
  private accounts: AccountStore;
  private accountValue?: Account | null;
  private cacheValue?: WebCache | null;
  private webValue?: { stamp: string; items: ZoteroItem[]; md5s: Set<string> };
  private syncProblem: SyncProblem | null = null;
  // Each connection syncs on its own; a sync for an earlier one keeps nothing.
  private generation = 0;
  // Hosts that asked Papilot to back off, until when.
  private backoff = new Map<string, number>();
  private stopped = false;

  constructor(readonly dir: string, private options: { snapshots: Snapshots; fetch?: Fetch; lookup?: Lookup; findZotero?: typeof findZotero; now?: () => number; sleep?: (ms: number) => Promise<unknown> }) {
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'text'), { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'library.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS pdfs(hash TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS links(identity TEXT PRIMARY KEY, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rejected(identity TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(identity, hash));
      CREATE TABLE IF NOT EXISTS misses(identity TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime REAL NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(name TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.accounts = new AccountStore(dir);
  }
  private get now() { return (this.options.now ?? Date.now)(); }

  // --- Records -------------------------------------------------------------

  private stored(hash: string): Stored | null {
    const row = this.db.prepare('SELECT data FROM pdfs WHERE hash = ?').get(hash) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }
  private save(hash: string, value: Stored) { this.db.prepare('INSERT OR REPLACE INTO pdfs(hash, data) VALUES (?, ?)').run(hash, JSON.stringify(value)); }
  private own(hash: string) { return path.join(this.dir, 'files', hash + '.pdf'); }
  private fileOf(hash: string, pdf: Stored) { return pdf.file ?? this.own(hash); }
  private rejected(ids: string[], hash: string) {
    return ids.some(id => this.db.prepare('SELECT 1 FROM rejected WHERE identity = ? AND hash = ?').get(id, hash));
  }
  private link(ids: string[], hash: string, replace: boolean) {
    for (const id of ids) {
      this.db.prepare(`INSERT INTO links(identity, hash) VALUES (?, ?) ON CONFLICT(identity) DO ${replace ? 'UPDATE SET hash = excluded.hash' : 'NOTHING'}`).run(id, hash);
      this.db.prepare('DELETE FROM misses WHERE identity = ?').run(id);
    }
  }
  private linkedHashes(ids: string[]) {
    return ids.map(id => (this.db.prepare('SELECT hash FROM links WHERE identity = ?').get(id) as { hash: string } | undefined)?.hash).filter(Boolean) as string[];
  }
  /** The PDF linked to this work whose file still exists. A title does not
   * decide for a PDF already known under another DOI or arXiv identifier,
   * since different works can share a title. A PDF whose file is gone, such
   * as one deleted in Zotero or deleted or replaced in the Zotero account,
   * is forgotten. */
  private linked(known: Pick<Known, 'ids'>) {
    const exact = known.ids.filter(id => !id.startsWith('title:'));
    for (const id of known.ids) {
      const row = this.db.prepare('SELECT hash FROM links WHERE identity = ?').get(id) as { hash: string } | undefined;
      if (!row) continue;
      if (id.startsWith('title:') && exact.length) {
        const others = (this.db.prepare("SELECT identity FROM links WHERE hash = ? AND identity NOT LIKE 'title:%'").all(row.hash) as { identity: string }[]).map(item => item.identity);
        if (others.length && !others.some(other => exact.includes(other))) continue;
      }
      const pdf = this.stored(row.hash);
      if (pdf && fs.existsSync(this.fileOf(row.hash, pdf)) && this.inAccount(pdf)) return { hash: row.hash, pdf, file: this.fileOf(row.hash, pdf) };
      this.forget(row.hash);
    }
    return null;
  }
  private forget(hash: string) {
    const pdf = this.stored(hash);
    this.db.prepare('DELETE FROM links WHERE hash = ?').run(hash);
    this.db.prepare('DELETE FROM pdfs WHERE hash = ?').run(hash);
    if (!pdf?.file) fs.rmSync(this.own(hash), { force: true });
    fs.rmSync(this.textFile(hash), { force: true });
    this.texts.delete(hash);
  }
  /** Remove a PDF no work links to any more, unless Zotero keeps it on this
   * computer. Asked at the moment of removal, so that a link made meanwhile
   * keeps it. */
  private dropIfUnlinked(hash: string) {
    const pdf = this.stored(hash);
    if (pdf?.file || this.db.prepare('SELECT 1 FROM links WHERE hash = ?').get(hash)) return;
    this.forget(hash);
  }
  private miss(ids: string[]) {
    for (const id of ids) {
      const row = this.db.prepare('SELECT data FROM misses WHERE identity = ?').get(id) as { data: string } | undefined;
      if (row) return JSON.parse(row.data) as Miss;
    }
    return null;
  }
  private missed(ids: string[], miss: Miss) {
    for (const id of ids) this.db.prepare('INSERT OR REPLACE INTO misses(identity, data) VALUES (?, ?)').run(id, JSON.stringify(miss));
  }
  private textFile(hash: string) { return path.join(this.dir, 'text', hash + '.json'); }

  /** The file of a PDF in the library. */
  file(hash: string) {
    const pdf = /^[a-f0-9]{64}$/.test(hash) ? this.stored(hash) : null;
    return pdf && fs.existsSync(this.fileOf(hash, pdf)) ? this.fileOf(hash, pdf) : null;
  }

  // --- Work in the background ----------------------------------------------

  /** Queue a job once. One that fails records why, so that the next look
   * does not start it again. */
  private enqueue(lane: Lane, id: string, run: () => Promise<void>, fail: () => void) {
    if (this.stopped || this.queued.has(id)) return;
    this.queued.add(id);
    this.lanes[lane].queue.push({ id, run, fail });
    if (!this.lanes[lane].active) void this.pump(lane);
  }
  private async pump(lane: Lane) {
    const { queue } = this.lanes[lane];
    while (!this.stopped && queue.length) {
      const job = queue.shift()!;
      this.lanes[lane].active = job.id;
      try { await job.run(); } catch { if (!this.stopped) job.fail(); }
      finally { this.queued.delete(job.id); this.lanes[lane].active = null; }
    }
  }
  /** Settle once every queued job has run, for tests and shutdown. */
  async idle() { while (Object.values(this.lanes).some(lane => lane.active || lane.queue.length)) await delay(10); }
  stop() { this.stopped = true; for (const lane of Object.values(this.lanes)) lane.queue = []; this.db.close(); }

  /** Whether the host of an address asked Papilot to back off, for now. */
  private backingOff(url: string) {
    try { return (this.backoff.get(new URL(url).hostname) ?? 0) > this.now; } catch { return false; }
  }
  private async pace(host: string) {
    const wait = (this.last.get(host) ?? 0) + (PACE[host] ?? 1000) - this.now;
    if (wait > 0) await (this.options.sleep ?? delay)(wait);
    this.last.set(host, this.now);
  }

  /** Fetch a public address, following redirects only to public addresses,
   * and read its body with read. A Zotero API key goes to Zotero's web API
   * only, over https, never to where it redirects. Names are checked
   * against what they resolve to; a name resolved again between that check
   * and the connection is not. A request that stalls,
   * or a source that is down or busy, is 'unavailable'; so is one to a host
   * that asked Papilot to back off, until the time it gave. */
  private async request<T>(address: string, accept: string, read: (chunks: AsyncIterable<Uint8Array>, response: Response, url: string) => Promise<T | null>, zoteroKey?: string): Promise<Outcome<T>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, url = address;
    const watch = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), STALL); };
    try {
      for (let hop = 0; hop <= REDIRECTS; hop++) {
        if (!publicUrl(url)) return null;
        const { hostname: host, origin } = new URL(url);
        if (this.backingOff(url)) return 'unavailable';
        // A name that resolves to this computer or its network, such as
        // localtest.me, is no public address either.
        if (!net.isIP(host.replace(/^\[|\]$/g, ''))) {
          let addresses: { address: string }[];
          try { addresses = await (this.options.lookup ?? resolve)(host); } catch { return 'unavailable'; }
          if (!addresses.length || !addresses.every(item => publicAddress(item.address))) return null;
        }
        await this.pace(host);
        watch();
        const headers: Record<string, string> = { 'User-Agent': AGENT, Accept: accept, ...(zoteroKey && origin === API ? { 'Zotero-API-Key': zoteroKey, 'Zotero-API-Version': '3' } : {}) };
        let response: Response;
        try { response = await (this.options.fetch ?? fetch)(url, { headers, redirect: 'manual', signal: controller.signal }); }
        catch { return 'unavailable'; }
        const backoff = Number(response.headers.get('backoff') ?? response.headers.get('retry-after'));
        if (backoff > 0) this.backoff.set(host, this.now + backoff * 1000);
        const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
        if (location) { await response.body?.cancel().catch(() => {}); url = new URL(location, url).href; continue; }
        if (response.status === 429 || response.status >= 500) return 'unavailable';
        if (!response.ok || !response.body) return null;
        const body = response.body as unknown as AsyncIterable<Uint8Array>;
        const chunks = async function* () { for await (const chunk of body) { watch(); yield chunk; } };
        try { return await read(chunks(), response, url); } catch { return 'unavailable'; }
      }
      return null;
    } finally {
      clearTimeout(timer);
      // A body left unread, such as a page past its head, is cancelled.
      controller.abort();
    }
  }

  /** A PDF downloaded into the library, or null when the address does not
   * give one, such as a publisher asking a browser to prove it is human. */
  private async download(url: string, zoteroKey?: string): Promise<Outcome<{ hash: string; url: string }>> {
    const temporary = path.join(this.dir, 'files', `.${randomUUID()}.tmp`);
    try {
      return await this.request(url, 'application/pdf', async (chunks, _response, final) => {
        const hash = createHash('sha256');
        let head = Buffer.alloc(0), pdf: boolean | null = null;
        await pipeline(Readable.from((async function* () {
          for await (const chunk of chunks) {
            if (pdf === null) {
              head = Buffer.concat([head, chunk]);
              if (head.length < 5) continue;
              if (!(pdf = isPdf(head))) return;
              hash.update(head);
              yield head;
              continue;
            }
            hash.update(chunk);
            yield chunk;
          }
        })()), fs.createWriteStream(temporary));
        if (!pdf) return null;
        const digest = hash.digest('hex');
        await fs.promises.rename(temporary, this.own(digest));
        return { hash: digest, url: final };
      }, zoteroKey);
    } finally { await fs.promises.rm(temporary, { force: true }); }
  }

  /** The PDF's lines, read once and kept beside it; null when it has no
   * selectable text. */
  text(hash: string): Promise<ReviewSnapshot | null> {
    let pending = this.texts.get(hash);
    if (pending) return pending;
    const pages = (snapshot: ReviewSnapshot) => snapshot.lines.reduce((most, line) => Math.max(most, line.page + 1), 0);
    pending = (async () => {
      let snapshot: ReviewSnapshot | null = null;
      try { snapshot = JSON.parse(await fs.promises.readFile(this.textFile(hash), 'utf8')) as ReviewSnapshot; } catch { /* Not read yet. */ }
      const pdf = this.stored(hash);
      if (snapshot) {
        if (pdf?.text === 'pending') this.save(hash, { ...pdf, text: 'ready', pages: pages(snapshot) });
        return snapshot;
      }
      if (!pdf || pdf.text === 'none') return null;
      try { snapshot = await this.options.snapshots.run(this.fileOf(hash, pdf), hash); } catch { /* A scanned PDF has no text. */ }
      const latest = this.stored(hash);
      if (latest) this.save(hash, { ...latest, text: snapshot ? 'ready' : 'none', pages: snapshot ? pages(snapshot) : latest.pages });
      if (snapshot) {
        const temporary = this.textFile(hash) + `.${randomUUID()}.tmp`;
        await fs.promises.writeFile(temporary, JSON.stringify(snapshot));
        await fs.promises.rename(temporary, this.textFile(hash));
      }
      return snapshot;
    })();
    this.texts.set(hash, pending);
    pending.catch(() => this.texts.delete(hash));
    // Keep only a few papers' lines in memory.
    for (const key of [...this.texts.keys()].slice(0, -8)) this.texts.delete(key);
    return pending;
  }

  // --- Zotero --------------------------------------------------------------

  /** The items with a PDF in the Zotero library on this computer, read
   * again when its databases change; while one cannot be read, the last
   * read stands. */
  private localZotero(location = this.zoteroLocation()) {
    if (!location) return null;
    const stamp = ['zotero.sqlite', 'better-bibtex.sqlite'].map(name => { try { return fs.statSync(path.join(location.dataDir, name)).mtimeMs; } catch { return 0; } }).join(':') + location.dataDir;
    if (this.local?.stamp === stamp) return this.local;
    let all: ZoteroItem[];
    try { all = readZotero(location); }
    catch { return this.local ?? null; }
    const items = all.filter(item => item.pdfs.length);
    return this.local = { stamp, dataDir: location.dataDir, items, counts: { items: all.length, withPdf: items.length, citationKeys: all.filter(item => item.citationKeys.length).length } };
  }
  /** The account's synced items with a PDF in Zotero's storage. */
  private webZotero() {
    const cache = this.account() ? this.cache() : null;
    if (!cache) return null;
    const stamp = `${cache.userID}:${cache.synced}`;
    if (this.webValue?.stamp !== stamp) {
      const items = webItems(cache);
      this.webValue = { stamp, items, md5s: new Set(items.flatMap(item => item.remote?.map(file => file.md5) ?? [])) };
    }
    return this.webValue;
  }
  /** Whether a PDF downloaded from the account is still a file Zotero
   * stores: one deleted or replaced in Zotero is not. */
  private inAccount(pdf: Stored) {
    if (!pdf.remote) return true;
    const web = this.webZotero();
    return !web || web.md5s.has(pdf.md5 ?? '');
  }
  /** Zotero's items by citation key, identifier and title. An item on this
   * computer comes before the account's copy of it, whose PDF would have to
   * be downloaded. */
  private zoteroIndex() {
    const local = this.localZotero(), web = this.webZotero();
    if (!local && !web) return null;
    const stamp = `${local?.stamp ?? ''}|${web?.stamp ?? ''}`;
    if (this.zotero?.stamp === stamp) return this.zotero;
    const index: ZoteroIndex = { stamp, byKey: new Map(), byDoi: new Map(), byArxiv: new Map(), byTitle: new Map() };
    const add = <K>(map: Map<K, ZoteroItem>, key: K, item: ZoteroItem) => { if (!map.has(key)) map.set(key, item); };
    for (const item of [...local?.items ?? [], ...web?.items ?? []]) {
      for (const key of item.citationKeys) add(index.byKey, key, item);
      if (item.doi) add(index.byDoi, item.doi, item);
      if (item.arxiv) add(index.byArxiv, item.arxiv, item);
      const title = compact(item.title);
      if (title.length >= 12) index.byTitle.set(title, [...index.byTitle.get(title) ?? [], item]);
    }
    return this.zotero = index;
  }
  private isDeclined(file: string, id: string) { return (this.declined.get(`${file}|${id}`) ?? 0) > this.now; }
  /** The Zotero item that is this entry's work, and the PDF of it to use:
   * one not declined, a main text before a supplement. */
  private zoteroItem(index: ZoteroIndex, input: LibraryInput, known: Known) {
    // Two libraries can give unrelated works the same key, such as
    // smith2020, and two works the same title; identifiers that differ say
    // they are different works.
    const agrees = (item: ZoteroItem) => (!known.doi || !item.doi || item.doi === known.doi) && (!known.arxiv || !item.arxiv || item.arxiv === known.arxiv);
    const keyed = index.byKey.get(input.key);
    const item = (keyed && agrees(keyed) && titleScore(keyed.title, input.fields.title ?? '') >= 0.8 ? keyed : undefined)
      ?? (known.doi && index.byDoi.get(known.doi)) ?? (known.arxiv && index.byArxiv.get(known.arxiv))
      ?? (index.byTitle.get(known.title) ?? []).find(candidate => agrees(candidate) && (!known.year || !candidate.year || candidate.year === known.year));
    if (!item) return null;
    const main = <T>(list: T[], name: (value: T) => string) => list.find(value => !/supp|appendix|slides|poster/i.test(name(value))) ?? list[0];
    const files = item.pdfs.filter(file => !this.isDeclined(file, known.ids[0]));
    if (files.length) return { item, file: main(files, file => path.basename(file)) };
    const remote = (item.remote ?? []).filter(file => !this.isDeclined(file.url, known.ids[0]));
    return remote.length ? { item, remote: main(remote, file => file.name) } : null;
  }
  /** Zotero's own identifiers for a work, which serve other papers too. */
  private zoteroIds(item: ZoteroItem) {
    return [item.doi && `doi:${item.doi}`, item.arxiv && `arxiv:${item.arxiv}`, titleId(compact(item.title), item.year, null)].filter(Boolean) as string[];
  }
  /** Download a PDF from the account's Zotero storage for a work. One Zotero
   * does not have, as with files synced elsewhere than Zotero's storage, is
   * not asked for again; one that could not be reached, a while later. */
  private async fromAccount(remote: RemoteFile, item: ZoteroItem, known: Known) {
    const account = this.account(), generation = this.generation;
    // Zotero turned off or disconnected meanwhile gives nothing.
    if (!account || !this.useZotero()) return;
    const decline = (until: number) => { this.declined.set(`${remote.url}|${known.ids[0]}`, until); };
    const got = await this.download(remote.url, account.key);
    if (got === 'unavailable') return decline(this.now + RETRY_FAILED);
    if (got && (this.generation !== generation || !this.useZotero())) return this.dropIfUnlinked(got.hash);
    if (!got) return decline(Infinity);
    const { hash } = got;
    if (this.rejected(known.ids, hash)) { this.dropIfUnlinked(hash); return decline(Infinity); }
    if (!this.stored(hash)) this.save(hash, { source: 'zotero', remote: remote.url, md5: remote.md5, pages: null, text: 'pending', added: this.now });
    this.link(this.zoteroIds(item), hash, false);
    if (!this.claim(known, hash)) return;
    await this.text(hash);
  }
  /** Register a file Zotero keeps, hashing it only when it changed. */
  private async fromZotero(file: string) {
    const stat = await fs.promises.stat(file);
    const row = this.db.prepare('SELECT size, mtime, hash FROM files WHERE path = ?').get(file) as { size: number; mtime: number; hash: string } | undefined;
    const hash = row && row.size === stat.size && row.mtime === stat.mtimeMs ? row.hash : await sha256(file);
    this.db.prepare('INSERT OR REPLACE INTO files(path, size, mtime, hash) VALUES (?, ?, ?, ?)').run(file, stat.size, stat.mtimeMs, hash);
    const stored = this.stored(hash);
    if (!stored || (stored.source === 'zotero' && stored.file !== file)) this.save(hash, { file, source: 'zotero', pages: stored?.pages ?? null, text: stored?.text ?? 'pending', added: stored?.added ?? this.now });
    return hash;
  }

  // --- Finding PDFs --------------------------------------------------------

  private openalex<T>(route: string) {
    return this.request<T>(`https://api.openalex.org/${route}`, 'application/json', async chunks => {
      const parts: Buffer[] = [];
      for await (const chunk of chunks) parts.push(Buffer.from(chunk));
      return JSON.parse(Buffer.concat(parts).toString('utf8')) as T;
    });
  }
  /** The work as OpenAlex knows it: by DOI, or else by a title that is
   * the same work's, published within a year of the entry's. */
  private async work(input: LibraryInput, known: Known): Promise<Outcome<Work>> {
    const fields = 'select=title,publication_year,doi,open_access,best_oa_location,locations';
    if (known.doi) return known.doi.startsWith('10.48550/') ? null : this.openalex<Work>(`works/doi:${encodeURIComponent(known.doi)}?${fields}`);
    if (known.arxiv || !known.title) return null;
    const found = await this.openalex<{ results?: Work[] }>(`works?search=${encodeURIComponent(plain(input.fields.title ?? ''))}&per_page=5&${fields}`);
    if (!found || found === 'unavailable') return found;
    return found.results?.find(work => titleScore(work.title ?? '', input.fields.title ?? '') >= 0.9 && (!known.year || !work.publication_year || Math.abs(work.publication_year - known.year) <= 1)) ?? null;
  }
  private async candidates(input: LibraryInput, known: Known) {
    const found: Candidate[] = [];
    if (known.arxiv) found.push({ url: `https://export.arxiv.org/pdf/${known.arxiv}`, source: 'arxiv', trusted: true });
    const looked = await this.work(input, known), work = looked === 'unavailable' ? null : looked;
    if (work) {
      // Repositories such as arXiv hand PDFs to programs; publishers often
      // ask for a browser instead.
      const locations = [work.best_oa_location, ...work.locations ?? []].filter((item): item is Location => Boolean(item))
        .sort((a, b) => Number(b.source?.type === 'repository') - Number(a.source?.type === 'repository'));
      for (const location of locations.filter(item => item.pdf_url)) {
        const url = location.pdf_url!, id = ARXIV_URL.exec(url)?.[1];
        if (id) { if (!found.some(item => item.source === 'arxiv')) found.push({ url: `https://export.arxiv.org/pdf/${id}`, source: 'arxiv', trusted: false }); }
        else if (!found.some(item => item.url === url)) found.push({ url, source: 'open-access', trusted: false });
      }
      // An open work's landing page often names its PDF for citation
      // managers, as Springer's and many repositories' do.
      if (work.open_access?.is_oa) {
        for (const url of [...locations.map(item => item.landing_page_url), work.open_access.oa_url]) {
          if (url && !found.some(item => item.url === url)) found.push({ url, source: 'open-access', trusted: false, page: true });
        }
      }
    }
    const doi = known.doi ?? work?.doi?.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() ?? null;
    return { found, unavailable: looked === 'unavailable', landing: doi ? `https://doi.org/${doi}` : known.arxiv ? `https://arxiv.org/abs/${known.arxiv}` : null };
  }
  /** The PDF a landing page names in its citation_pdf_url tag, read from
   * the page's head. */
  private pdfOnPage(url: string) {
    return this.request<string>(url, 'text/html', async (chunks, response, final) => {
      if (!(response.headers.get('content-type') ?? '').includes('html')) return null;
      const decoder = new TextDecoder();
      let html = '';
      for await (const chunk of chunks) {
        html += decoder.decode(chunk, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
        if (!/name=["']citation_pdf_url["']/i.test(tag)) continue;
        const content = /content=["']([^"']+)["']/i.exec(tag)?.[1];
        try { if (content) return new URL(content.replace(/&amp;/g, '&'), final).href; } catch { return null; }
      }
      return null;
    });
  }
  /** Keep a downloaded PDF when accepts takes its text: a new one under
   * this source, and the same bytes as a Zotero file as the library's own
   * copy, so that they stay when Zotero is turned off. One refused leaves no
   * file behind and every other record as it was. */
  private async adopt(hash: string, source: LibrarySource, url: string, accepts: (snapshot: ReviewSnapshot | null) => boolean) {
    const stored = this.stored(hash);
    if (!stored) this.save(hash, { source, url, pages: null, text: 'pending', added: this.now });
    const snapshot = await this.text(hash);
    if (!accepts(snapshot)) {
      if (stored?.file) fs.rmSync(this.own(hash), { force: true }); else this.dropIfUnlinked(hash);
      return { snapshot, kept: false };
    }
    const latest = this.stored(hash);
    if (latest?.source === 'zotero') this.save(hash, { source, url, pages: latest.pages, text: latest.text, added: latest.added });
    return { snapshot, kept: true };
  }
  /** Link a PDF to a work unless another one was linked meanwhile, which
   * stays; the PDF is then dropped unless another work has it. */
  private claim(known: Known, hash: string) {
    this.link(known.ids, hash, false);
    if (this.linked(known)?.hash === hash) return true;
    this.dropIfUnlinked(hash);
    return false;
  }

  private async find(input: LibraryInput, known: Known) {
    const { found, landing, unavailable } = await this.candidates(input, known);
    let failed = unavailable;
    for (const candidate of found) {
      if (this.stopped) return;
      // Publishers often turn programs away with errors that never end;
      // only arXiv being unreachable, or a host asking Papilot to come back
      // later, leaves the question open.
      const url = candidate.page ? await this.pdfOnPage(candidate.url) : candidate.url;
      if (url === 'unavailable') { if (this.backingOff(candidate.url)) failed = true; continue; }
      const got = url && await this.download(url);
      if (got === 'unavailable') { if (candidate.source === 'arxiv' || (url && this.backingOff(url))) failed = true; continue; }
      if (!got) continue;
      const { hash } = got;
      if (this.rejected(known.ids, hash)) { this.dropIfUnlinked(hash); continue; }
      // A copy found by DOI or title is kept only when it is visibly this work.
      const { kept } = await this.adopt(hash, candidate.source, got.url, snapshot => candidate.trusted || Boolean(snapshot && looksLike(snapshot, input.fields.title ?? '', known.doi)));
      if (!kept || !this.file(hash)) continue;
      this.claim(known, hash);
      return;
    }
    this.missed(known.ids, { at: this.now, landing, ...(failed ? { failed: true } : {}) });
  }

  /** Each entry's PDF, or why it has none, starting the work that finds
   * the missing ones: matching Zotero items, then looking online. With
   * Zotero turned off, its files are no longer linked to any work. */
  status(inputs: LibraryInput[], options: { online: boolean; zotero: boolean; retry?: boolean; poll?: boolean }) {
    const entries: Record<string, LibraryEntry> = {};
    // A fresh look syncs the Zotero account; until its first sync, works
    // Zotero may have wait for it rather than being looked for elsewhere.
    if (options.zotero && !options.poll) this.syncZotero();
    const index = options.zotero ? this.zoteroIndex() : null;
    const firstSync = options.zotero && this.queued.has(this.syncId()) && !this.cache();
    let pending = 0;
    for (const input of inputs) {
      const known = identify(input), queue = `find:${known.ids[0] ?? input.id}`;
      if (!options.zotero) {
        for (const hash of this.linkedHashes(known.ids)) {
          const pdf = this.stored(hash);
          if (pdf?.source !== 'zotero') continue;
          this.db.prepare('DELETE FROM links WHERE hash = ?').run(hash);
          // A copy downloaded from the account goes too.
          if (!pdf.file) this.forget(hash);
        }
      }
      const found = this.linked(known);
      if (found) {
        const { pdf } = found;
        if (pdf.text === 'pending') {
          pending++;
          // A PDF that cannot be read counts as one without text.
          this.enqueue('local', `text:${found.hash}`, async () => { await this.text(found.hash); }, () => { const latest = this.stored(found.hash); if (latest) this.save(found.hash, { ...latest, text: 'none' }); });
        }
        entries[input.id] = { pdf: { hash: found.hash, source: pdf.source, pages: pdf.pages, text: pdf.text, ...(pdf.url ? { url: pdf.url } : {}) }, find: null, landing: null };
        continue;
      }
      const match = index && known.ids.length ? this.zoteroItem(index, input, known) : null;
      if (match) {
        const { item, file, remote } = match;
        pending++;
        entries[input.id] = { pdf: null, find: 'waiting', landing: null };
        if (remote) {
          this.enqueue('account', `zotero:${known.ids[0]}`, () => this.fromAccount(remote, item, known), () => { this.declined.set(`${remote.url}|${known.ids[0]}`, this.now + RETRY_FAILED); });
          continue;
        }
        const decline = () => { this.declined.set(`${file}|${known.ids[0]}`, Infinity); };
        this.enqueue('local', `zotero:${known.ids[0]}`, async () => {
          if (!this.useZotero()) return;
          const hash = await this.fromZotero(file!);
          if (this.rejected(known.ids, hash)) { decline(); return; }
          this.link([...new Set([...known.ids, ...this.zoteroIds(item)])], hash, false);
          await this.text(hash);
        }, decline);
        continue;
      }
      if (firstSync && known.ids.length) { pending++; entries[input.id] = { pdf: null, find: 'waiting', landing: null }; continue; }
      const landing = known.doi ? `https://doi.org/${known.doi}` : known.arxiv ? `https://arxiv.org/abs/${known.arxiv}` : null;
      if (!options.online) { entries[input.id] = { pdf: null, find: 'off', landing }; continue; }
      // Without an identifier of its own, an entry waits for the online
      // check that may find its record, then is looked for by title.
      if (!known.doi && !known.arxiv && !input.check) { pending++; entries[input.id] = { pdf: null, find: 'waiting', landing: null }; continue; }
      if (!known.ids.length) { entries[input.id] = { pdf: null, find: 'unidentified', landing: null }; continue; }
      const missed = options.retry ? null : this.miss(known.ids);
      if (missed && (missed.failed ? options.poll || this.now - missed.at < RETRY_FAILED : this.now - missed.at < RETRY)) {
        entries[input.id] = { pdf: null, find: missed.failed ? 'unreachable' : missed.removed ? 'removed' : known.doi || known.arxiv || missed.landing ? 'paywalled' : 'unidentified', landing: missed.landing };
        continue;
      }
      pending++;
      this.enqueue('online', queue, () => this.find(input, known), () => this.missed(known.ids, { at: this.now, landing, failed: true }));
      entries[input.id] = { pdf: null, find: this.lanes.online.active === queue ? 'searching' : 'waiting', landing };
    }
    return { entries, pending };
  }

  // --- The author's own PDFs -----------------------------------------------

  /** Keep the author's bytes as a library file, writing them again if a
   * concurrent removal took the file away. Synchronous, so nothing runs
   * between it and the link that follows. */
  private keep(hash: string, bytes: Uint8Array) {
    const file = this.own(hash);
    if (!fs.existsSync(file)) {
      const temporary = path.join(this.dir, 'files', `.${randomUUID()}.tmp`);
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, file);
    }
    const stored = this.stored(hash);
    if (!stored || stored.source === 'zotero') this.save(hash, { source: 'author', pages: stored?.pages ?? null, text: stored?.text ?? 'pending', added: this.now });
  }

  /** Add a PDF the author gives. Given an entry, the PDF becomes that
   * entry's, replacing any other; otherwise it goes to the entry its first
   * pages name, unless the author took this file away from it, and is
   * dropped when none does. */
  async add(bytes: Uint8Array, inputs: LibraryInput[], target?: string) {
    if (!isPdf(bytes)) throw Object.assign(new Error('This file is not a PDF.'), { statusCode: 400 });
    const hash = createHash('sha256').update(bytes).digest('hex');
    let input = target ? inputs.find(item => item.id === target) : undefined;
    if (target && !input) throw Object.assign(new Error('This entry is no longer in the bibliography. Refresh the library.'), { statusCode: 404 });
    if (input && !identify(input).ids.length) throw Object.assign(new Error('Add a DOI, arXiv identifier, author or year to this entry to keep a PDF for it.'), { statusCode: 400 });
    this.keep(hash, bytes);
    if (!input) {
      const snapshot = await this.text(hash);
      input = (snapshot && matchPdf(snapshot, inputs.filter(item => !this.rejected(identify(item).ids, hash)))) || undefined;
      if (!input) { this.dropIfUnlinked(hash); return { entry: null }; }
      this.keep(hash, bytes);
    }
    const known = identify(input), replaced = this.linkedHashes(known.ids).filter(other => other !== hash);
    for (const id of known.ids) this.db.prepare('DELETE FROM rejected WHERE identity = ? AND hash = ?').run(id, hash);
    this.link(known.ids, hash, true);
    for (const other of new Set(replaced)) this.dropIfUnlinked(other);
    this.enqueue('local', `text:${hash}`, async () => { await this.text(hash); }, () => {});
    return { entry: input.id, hash };
  }

  /** Add a PDF an agent found at a public address for an entry without one.
   * The library downloads it itself and keeps it only when its first page
   * shows the work's DOI or full title, so that a later paper citing the
   * work, as one by the same authors may, is not taken for it; a refusal
   * says why, for the agent to look further. */
  async addFrom(url: string, input: LibraryInput) {
    const known = identify(input), refuse = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
    if (!known.ids.length) throw refuse('This entry has no DOI, arXiv identifier, author or year to keep a PDF for. Tell the author.');
    if (this.linked(known)) throw refuse(`${input.key} already has a PDF in the library.`);
    const got = await this.download(url);
    if (got === 'unavailable') throw refuse('Could not reach that address. Try again later or find another copy.');
    if (!got) throw refuse('That address gave no PDF: it may need a browser or a sign-in, or not be a public web address. Find a direct link to an openly available PDF.');
    const { hash } = got;
    if (this.rejected(known.ids, hash)) { this.dropIfUnlinked(hash); throw refuse('The author took this PDF away from this work as not being it.'); }
    const { snapshot, kept } = await this.adopt(hash, 'agent', got.url, snapshot => Boolean(snapshot && looksLike({ ...snapshot, lines: snapshot.lines.filter(line => line.page === 0) }, input.fields.title ?? '', known.doi)));
    if (!kept) throw refuse(snapshot ? 'The first page of this PDF shows neither the work\'s full title nor its DOI, so it was not kept. Find a copy of this work itself.' : 'This PDF has no selectable text, so Papilot cannot check that it is the work. Tell the author, who can add it in Library.');
    // Another PDF linked meanwhile stays the entry's.
    if (!this.claim(known, hash)) throw refuse(`${input.key} already has a PDF in the library.`);
    return { hash, pages: this.stored(hash)?.pages ?? null };
  }

  /** Take an entry's PDF away, for one that is not of this work. Papilot
   * will not link the same file to it again by itself. */
  remove(input: LibraryInput) {
    const known = identify(input), found = this.linked(known);
    if (!found) return;
    if (found.pdf.source === 'zotero') this.declined.set(`${found.pdf.file ?? found.pdf.remote}|${known.ids[0]}`, Infinity);
    for (const id of known.ids) {
      this.db.prepare('INSERT OR IGNORE INTO rejected(identity, hash) VALUES (?, ?)').run(id, found.hash);
      this.db.prepare('DELETE FROM links WHERE identity = ? AND hash = ?').run(id, found.hash);
    }
    this.missed(known.ids, { at: this.now, landing: known.doi ? `https://doi.org/${known.doi}` : known.arxiv ? `https://arxiv.org/abs/${known.arxiv}` : null, removed: true });
    this.dropIfUnlinked(found.hash);
  }

  // --- The Zotero account --------------------------------------------------

  private account() { return this.accountValue === undefined ? (this.accountValue = this.accounts.account()) : this.accountValue; }
  private cache() { return this.cacheValue === undefined ? (this.cacheValue = this.accounts.cache()) : this.cacheValue; }
  private readonly zoteroGet: Get = (url, key) => this.request(url, 'application/json', async (chunks, response) => {
    const parts: Buffer[] = [];
    for await (const chunk of chunks) parts.push(Buffer.from(chunk));
    return { body: JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown, headers: response.headers };
  }, key);

  private syncId() { return `zotero-sync:${this.generation}`; }
  /** Sync the account's libraries, one sync at a time. */
  syncZotero() {
    const account = this.account(), generation = this.generation;
    if (!account) return;
    this.enqueue('account', this.syncId(), async () => {
      const { cache, problem } = await syncAccount(account, this.cache(), this.zoteroGet, this.now);
      // An account disconnected or replaced meanwhile keeps nothing.
      if (this.generation !== generation) return;
      this.syncProblem = problem;
      if (cache) { this.accounts.saveCache(cache); this.cacheValue = cache; }
    }, () => { this.syncProblem = 'unreachable'; });
  }
  /** Connect the account an API key belongs to, in place of any other. */
  async connectZotero(key: string) {
    const trimmed = key.trim();
    if (!/^[A-Za-z0-9]+$/.test(trimmed)) throw Object.assign(new Error('Zotero does not accept this key. Check it and try again.'), { statusCode: 400 });
    const account = await checkKey(trimmed, this.zoteroGet);
    this.disconnectZotero();
    this.accounts.save(account);
    this.accountValue = account;
    this.syncZotero();
  }
  /** Forget the account: its key, its items and the PDFs downloaded from it. */
  disconnectZotero() {
    this.generation++;
    this.accounts.remove();
    this.accountValue = null;
    this.cacheValue = null;
    this.syncProblem = null;
    for (const { hash, data } of this.db.prepare('SELECT hash, data FROM pdfs').all() as { hash: string; data: string }[]) {
      const pdf = JSON.parse(data) as Stored;
      if (pdf.source === 'zotero' && !pdf.file) this.forget(hash);
    }
    for (const key of this.declined.keys()) if (key.startsWith(API)) this.declined.delete(key);
  }

  /** The Zotero libraries PDFs are taken from: the one on this computer,
   * with how many of its items have a PDF and a citation key to match by,
   * and the account's, syncing it first when asked. */
  zoteroStatus(sync = false): ZoteroStatus {
    if (sync) this.syncZotero();
    const location = this.zoteroLocation(), local = location && this.localZotero(location), chosen = this.zoteroDir();
    const account = this.account(), cache = this.cache();
    return {
      local: { chosen, ...(!location ? { state: 'missing' } : local?.dataDir === location.dataDir ? { state: 'ready', dataDir: local.dataDir, ...local.counts } : { state: 'unreadable', dataDir: location.dataDir }) },
      account: account ? { username: account.username, libraries: webCounts(cache), syncing: this.queued.has(this.syncId()), synced: cache?.synced ?? null, problem: this.syncProblem } : null,
      use: this.useZotero(),
    };
  }

  /** The data directory the author chose for Zotero on this computer, if any. */
  private zoteroDir() { return (this.db.prepare("SELECT value FROM settings WHERE name = 'zoteroDir'").get() as { value: string } | undefined)?.value ?? null; }
  /** Where Zotero keeps its database and files: the folder the author chose,
   * or else the one Zotero's settings name. Linked files stay relative to
   * the folder Zotero's settings give for them. */
  private zoteroLocation() {
    const found = (this.options.findZotero ?? findZotero)(), chosen = this.zoteroDir();
    if (!chosen) return found;
    return fs.existsSync(path.join(chosen, 'zotero.sqlite')) ? { dataDir: chosen, base: found?.base ?? null } : null;
  }
  /** Choose Zotero's data directory, the folder with zotero.sqlite, or go
   * back to the one Zotero's settings name. */
  setZoteroDir(dir: string | null) {
    if (dir === null) { this.db.prepare("DELETE FROM settings WHERE name = 'zoteroDir'").run(); return; }
    const folder = path.resolve(dir.trim().replace(/^~(?=$|[\\/])/, os.homedir()));
    if (!fs.existsSync(path.join(folder, 'zotero.sqlite'))) throw Object.assign(new Error('This folder has no zotero.sqlite. Choose Zotero\'s data directory, the folder with zotero.sqlite and storage.'), { statusCode: 400 });
    this.db.prepare("INSERT OR REPLACE INTO settings(name, value) VALUES ('zoteroDir', ?)").run(folder);
  }
  /** Whether works take PDFs from Zotero, for every paper and browser. */
  useZotero() { return (this.db.prepare("SELECT value FROM settings WHERE name = 'zotero'").get() as { value: string } | undefined)?.value !== 'off'; }
  /** Turned off, every work loses its Zotero PDF at once, for agents too,
   * and copies downloaded from the account go; turned on, works are matched
   * with Zotero again as their papers are looked at. */
  setUseZotero(use: boolean) {
    this.db.prepare("INSERT OR REPLACE INTO settings(name, value) VALUES ('zotero', ?)").run(use ? 'on' : 'off');
    if (use) return;
    for (const { hash, data } of this.db.prepare('SELECT hash, data FROM pdfs').all() as { hash: string; data: string }[]) {
      const pdf = JSON.parse(data) as Stored;
      if (pdf.source !== 'zotero') continue;
      this.db.prepare('DELETE FROM links WHERE hash = ?').run(hash);
      if (!pdf.file) this.forget(hash);
    }
  }

  /** The PDF linked to an entry, for agents to read. */
  pdfOf(input: LibraryInput) { return this.linked(identify(input)); }
}
