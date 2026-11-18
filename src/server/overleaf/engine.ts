import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { OverleafHttp, SignInError, AccessError, ConnectionError, NotFoundError } from './http.ts';
import { OverleafSocket, type OverleafFolder, type OverleafUser, type ProjectJoin } from './socket.ts';
import { applyHistory, applyText, historyOp, sanitizeHistoryOp, sanitizeTextOp, textOp, trackedText, transformHistoryX, transformTextX, visibleText, type RawEditOperation, type StringFileRaw, type TextOp, type TrackedText } from './ot.ts';
import { blobHash, decode, ignored, lineEnding, linked, localOnly, move, normalize, present, read, remove, scan, stat, unsafeName, write, type LocalFile } from './files.ts';
import { merge3, restore, type Conflict } from './merge.ts';
import { carry, type Span } from './authors.ts';
import type { Base, Link, OverleafStore, StoredAuthors, StoredConflict } from './store.ts';
import type { OverleafComparison, OverleafCursor, OverleafPerson, OverleafSync, OverleafSyncState, SourceAuthor } from '../../shared.ts';

// One paper folder kept in step with one Overleaf project while Papilot runs.
// Text files are edited through Overleaf's real-time service with the same
// operations its editor sends, so coauthors see the author's changes as they
// happen and the author's files receive theirs; other files follow by hash.
// After time apart, both sides are merged from the base they last shared.

type DocType = 'sharejs-text-ot' | 'history-ot';
type Op = TextOp | RawEditOperation[];
interface Update { doc: string; op?: Op; v: number; meta?: { source?: string; user_id?: string; type?: string }; dup?: boolean }
interface Doc {
  id: string; path: string; type: DocType;
  server: string | TrackedText; version: number;
  // The edit sent and not yet acknowledged, when it was sent, and the
  // connections it went out on.
  inflight: Op | null; sentAt: number; retried: boolean; origins: string[];
  // Updates that arrived ahead of their turn, by version.
  queue: Map<number, Update>; gap?: NodeJS.Timeout;
  // The text last read from or written to the file, and the text both sides
  // last held.
  local: string | null; agreed: string;
  // Whether the file holds edits Overleaf has not confirmed yet.
  dirty: boolean;
  // When a coauthor's edit could not be written into the file, the text the
  // file still matched; the next send merges from it instead of undoing it.
  behind: string | null;
  // How many times in a row the file read empty while Overleaf's is not.
  emptied: number;
  eol: '\n' | '\r\n';
  // Who wrote what in the file's text, as of `text`.
  authors: { text: string; spans: Span[] };
}
// Someone with the project open on Overleaf, by connection: their account,
// where their cursor is, and when they were last heard from.
interface Visitor { id: string; name: string; doc?: string; line?: number; column?: number; seen: number }
// A file's hash on Overleaf, and the hash both sides last held.
interface Entity { kind: 'doc' | 'file' | 'folder'; path: string; hash?: string; agreed?: string }
type Choice = 'overleaf' | 'local';

const SCAN_EVERY = 1000, BASE_EVERY = 5000, NOTIFY_EVERY = 400, GAP_PATIENCE = 10_000;
// As the Overleaf editor does: an edit without an acknowledgement is sent
// again after 5 seconds, and after 45 the connection is started over.
const RESEND_AFTER = 5000, GIVE_UP_AFTER = 45_000;
const visible = (doc: { type: DocType }, snapshot: string | TrackedText) => doc.type === 'history-ot' ? visibleText(snapshot as TrackedText) : snapshot as string;
function apply(type: DocType, snapshot: string | TrackedText, op: Op) {
  if (type === 'history-ot') return (op as RawEditOperation[]).reduce((text, item) => applyHistory(text, item), snapshot as TrackedText);
  return applyText(snapshot as string, op as TextOp);
}
// Both sides of a concurrent pair; the first goes first where inserts meet,
// as the server places an incoming edit.
function transformX(type: DocType, client: Op, server: Op): [Op, Op] {
  if (type === 'sharejs-text-ot') return transformTextX(client as TextOp, server as TextOp);
  const left = [...client as RawEditOperation[]], right = [...server as RawEditOperation[]];
  for (let i = 0; i < left.length; i++) for (let j = 0; j < right.length; j++) [left[i], right[j]] = transformHistoryX(left[i], right[j]);
  return [left, right];
}
function editFor(type: DocType, snapshot: string | TrackedText, text: string, tracking?: { userId: string; ts: string }): Op | null {
  if (type === 'history-ot') { const op = historyOp(snapshot as TrackedText, text, tracking); return op ? [op] : null; }
  const op = textOp(snapshot as string, text);
  return op.length ? op : null;
}
const decodeLine = (line: string) => Buffer.from(line, 'latin1').toString('utf8');
const fullName = (user: { first_name?: string; last_name?: string; name?: string; email?: string }) => (user.name || [user.first_name, user.last_name].filter(Boolean).join(' ')).trim() || user.email || '';
// Someone not signed in has no account of their own.
const ANONYMOUS = 'anonymous-user';
// A few requests at a time, in order.
async function limit<T, R>(items: T[], work: (item: T) => Promise<R>, width = 6): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => { while (next < items.length) { const index = next++; results[index] = await work(items[index]); } }));
  return results;
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Two names of one file, as on a disk that ignores case.
const sameFile = (a: string, b: string) => { try { const x = fs.statSync(a), y = fs.statSync(b); return x.ino === y.ino && x.dev === y.dev; } catch { return false; } };

class StoppedError extends Error { constructor() { super('Syncing stopped.'); this.name = 'StoppedError'; } }
/** The paper folder is gone: moved, renamed or on a disk not mounted. */
class FolderError extends Error { constructor(message: string) { super(message); this.name = 'FolderError'; } }
class GitBusyError extends Error { constructor() { super('Wait for the current Git operation before sending more instructions.'); this.name = 'GitBusyError'; } }
// Whether a failure is about the connection or the account, which ends the
// session, rather than one file, which is set aside.
const connectionLevel = (error: unknown) => error instanceof ConnectionError || error instanceof SignInError || error instanceof AccessError || error instanceof StoppedError || error instanceof FolderError || error instanceof GitBusyError || (error instanceof Error && error.name === 'AbortError');
// What the author reads about a failure. Overleaf's answers say what
// happened; anything else is an inconsistency the next connection repairs.
function explain(error: unknown) {
  if (connectionLevel(error) || (error as { statusCode?: number })?.statusCode === 422) return (error as Error).message;
  console.warn('Overleaf sync:', error);
  return undefined;
}

export interface SyncHooks {
  /** Files of the paper changed on disk. */
  changed(): void;
  /** Whether Git is in the middle of a merge or rebase there. */
  busy(): boolean;
  /** Which of these new files Git ignores; they stay on this computer. */
  ignored(files: string[]): Promise<Set<string>>;
  status(): void;
  /** Someone's cursor moved on Overleaf. */
  presence?(): void;
}

export class PaperSync extends EventEmitter {
  private http: OverleafHttp | null = null;
  private socket: OverleafSocket | null = null;
  private abort: AbortController | null = null;
  private docs = new Map<string, Doc>();
  private entities = new Map<string, Entity>();
  private folders = new Map<string, string>();
  private rootFolder = '';
  private seen = new Map<string, LocalFile>();
  private links = new Set<string>();
  private missing = new Map<string, number>();
  private publicIds: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private wake: (() => void) | null = null;
  private timers: NodeJS.Timeout[] = [];
  private notifyTimer: NodeJS.Timeout | undefined;
  private baseDirty = false;
  private users = new Map<string, Visitor>();
  // Names of the project's members and visitors, by account.
  private people = new Map<string, string>();
  private authorsDirty = false;
  private storedAuthors: StoredAuthors | undefined;
  private userId = '';
  state: OverleafSyncState = 'connecting';
  message: string | undefined;
  readOnly = false;
  // Track changes on Overleaf, for everyone or this account: edits go as
  // suggestions, as the Overleaf editor sends them.
  tracking = false;
  private rootDoc: string | undefined;
  private compiler: string | undefined;
  syncedAt: number | null = null;
  skipped = new Set<string>();
  name: string;

  constructor(readonly link: Link, readonly root: string, private store: OverleafStore, private hooks: SyncHooks) {
    super();
    this.name = link.name;
  }

  status(projectId: string): OverleafSync {
    let pending = 0;
    for (const doc of this.docs.values()) if (doc.inflight || doc.dirty) pending++;
    const conflicts = this.conflicts().map(({ id, path: file, kind, at, ours, theirs }) => ({ id, path: file, kind, at, ...(kind === 'text' ? { ours: ours.slice(0, 2000), theirs: theirs.slice(0, 2000) } : {}) }));
    const state = this.state === 'synced' && pending ? 'syncing' : this.state;
    return { projectId, origin: this.link.origin, overleafId: this.link.overleafId, name: this.name, url: `${this.link.origin}/project/${this.link.overleafId}`, state, ...(this.message ? { message: this.message } : {}), readOnly: this.readOnly, tracking: this.tracking, pending, syncedAt: this.syncedAt, collaborators: this.present(), cursors: this.cursors(), conflicts, skipped: [...this.skipped].sort() };
  }

  // ---------------------------------------------------------------- people
  private person(client: string, visitor: Visitor): OverleafPerson {
    const file = visitor.doc ? this.entities.get(visitor.doc)?.path : undefined;
    return { id: visitor.id && visitor.id !== ANONYMOUS ? visitor.id : client, name: visitor.name || this.people.get(visitor.id) || '', ...(visitor.id === this.userId ? { you: true } : {}), ...(file ? { file } : {}) };
  }
  /** Who has the project open, once per account, as Overleaf lists them:
   *  others by name, then this account in a browser. */
  private present(): OverleafPerson[] {
    const accounts = new Map<string, { person: OverleafPerson; seen: number }>();
    for (const [client, visitor] of this.users) {
      const person = this.person(client, visitor), known = accounts.get(person.id);
      if (!known || visitor.seen >= known.seen) accounts.set(person.id, { person, seen: visitor.seen });
    }
    return [...accounts.values()].map(entry => entry.person).sort((a, b) => Number(Boolean(a.you)) - Number(Boolean(b.you)) || a.name.localeCompare(b.name));
  }
  /** Where each connection's cursor is, in files that sync. */
  cursors(): OverleafCursor[] {
    const cursors: OverleafCursor[] = [];
    for (const [client, visitor] of this.users) {
      const person = this.person(client, visitor);
      if (person.file && visitor.line !== undefined) cursors.push({ ...person, file: person.file, client, line: visitor.line, column: visitor.column ?? 0 });
    }
    return cursors;
  }
  /** Someone joined, moved or left; the list changes only when who is
   *  there or which file they are in does. */
  private visit(client: string, visitor: Visitor | null) {
    const before = this.users.get(client), was = before && JSON.stringify(this.person(client, before));
    if (visitor) {
      this.users.set(client, visitor);
      if (visitor.name && visitor.id && visitor.id !== ANONYMOUS && this.people.get(visitor.id) !== visitor.name) { this.people.set(visitor.id, visitor.name); this.authorsDirty = true; }
    } else if (!this.users.delete(client)) return;
    if (was !== (visitor ? JSON.stringify(this.person(client, visitor)) : undefined)) this.hooks.status();
    this.hooks.presence?.();
  }

  // --------------------------------------------------------------- authors
  /** The file's text is now `text`; when the change is a coauthor's edit,
   *  `user` wrote what it inserted. */
  private attribute(doc: Doc, text: string, user?: string) {
    if (doc.authors.text === text) return;
    const spans = carry(doc.authors.text, text, doc.authors.spans, user);
    if (spans.length || doc.authors.spans.length) this.authorsDirty = true;
    doc.authors = { text, spans };
  }
  /** Who wrote what in a file as it reads now. */
  authors(file: string, text: string): SourceAuthor[] {
    const doc = [...this.docs.values()].find(item => item.path === file);
    if (!doc?.authors.spans.length) return [];
    return carry(doc.authors.text, normalize(text), doc.authors.spans).map(span => ({ from: span.from, to: span.to, id: span.user, name: this.people.get(span.user) || '', ...(span.user === this.userId ? { you: true } : {}), at: span.at }));
  }
  private restoreAuthors(doc: Doc) {
    this.storedAuthors ??= this.store.authors(this.link.id) ?? { people: {}, docs: {} };
    for (const [id, name] of Object.entries(this.storedAuthors.people)) if (!this.people.has(id)) this.people.set(id, name);
    const stored = this.storedAuthors.docs[doc.id], text = stored && this.store.baseText(this.link.id, stored.hash);
    if (stored && text !== undefined && Array.isArray(stored.spans)) doc.authors = { text, spans: stored.spans
      .filter(span => Array.isArray(span) && Number.isInteger(span[0]) && Number.isInteger(span[1]) && span[0] < span[1] && span[1] <= text.length && typeof span[2] === 'string')
      .map(([from, to, user, at]) => ({ from, to, user, at: Number(at) || 0 })) };
  }
  private set(state: OverleafSyncState, message?: string) {
    if (this.state === state && this.message === message) return;
    this.state = state; this.message = message; this.hooks.status();
  }
  /** Runs one step at a time; a step queued after stopping does nothing. */
  private work<T>(task: () => Promise<T> | T): Promise<T> {
    const run = this.queue.catch(() => undefined).then(() => { this.check(); return task(); });
    this.queue = run.catch(() => undefined);
    return run;
  }
  private check() {
    if (this.stopped) throw new StoppedError();
    if (!present(this.root)) throw new FolderError('The paper folder is missing. Syncing resumes when it is back.');
    if (this.hooks.busy()) throw new GitBusyError();
  }
  private notify() {
    this.notifyTimer ??= setTimeout(() => { this.notifyTimer = undefined; this.hooks.changed(); }, NOTIFY_EVERY);
  }

  /** Keeps the folder in sync until stopped, reconnecting after failures. */
  start() { void this.run(); return this; }
  /** Wakes a sync waiting for a sign-in or a retry. */
  retry() { this.wake?.(); }
  async stop() {
    this.stopped = true;
    this.wake?.();
    this.socket?.close();
    this.abort?.abort();
    clearTimeout(this.notifyTimer);
    for (const doc of this.docs.values()) clearTimeout(doc.gap);
    // Whatever was running finishes or fails first; then the base is saved.
    await this.queue.catch(() => undefined);
    try { this.saveBase(true); } catch { /* The next sync merges from the older base. */ }
  }
  private sleep(ms: number) {
    return new Promise<void>(resolve => { const timer = setTimeout(done, ms); function done() { clearTimeout(timer); resolve(); } this.wake = () => { this.wake = null; done(); }; });
  }
  private async run() {
    let delay = 1000;
    while (!this.stopped) {
      try {
        if (!present(this.root)) throw new FolderError('The paper folder is missing. Syncing resumes when it is back.');
        if (this.hooks.busy()) { this.set('paused'); await this.sleep(2000); continue; }
        const started = Date.now();
        await this.connect();
        const closed = await this.socket!.done;
        if (this.stopped) break;
        if (closed instanceof GitBusyError) { this.set('paused'); await this.sleep(2000); continue; }
        if (closed instanceof FolderError) { this.set('paused', closed.message); await this.sleep(5000); continue; }
        if (this.state !== 'paused') this.set('offline', explain(closed) ?? this.message);
        // A connection that drops at once again waits longer each time.
        if (Date.now() - started < 30_000) { await this.sleep(delay); delay = Math.min(delay * 2, 60_000); } else delay = 1000;
      } catch (error) {
        this.socket?.close();
        if (this.stopped || error instanceof StoppedError) break;
        if (error instanceof GitBusyError) { this.set('paused'); await this.sleep(2000); continue; }
        if (error instanceof SignInError) { this.set('signed-out', error.message); await this.sleep(10 * 60_000); continue; }
        if (error instanceof AccessError) { this.set('no-access', error.message); await this.sleep(5 * 60_000); continue; }
        if (error instanceof FolderError) { this.set('paused', error.message); await this.sleep(5000); continue; }
        this.set('offline', explain(error));
        await this.sleep(delay);
        delay = Math.min(delay * 2, 60_000);
      } finally {
        this.abort?.abort();
        for (const timer of this.timers) clearInterval(timer);
        this.timers = [];
        if (this.users.size) { this.users.clear(); this.hooks.status(); this.hooks.presence?.(); }
      }
    }
  }
  private session() {
    const account = this.store.account(this.link.origin);
    if (!account) throw new SignInError('Sign in to Overleaf to keep this paper in sync.');
    this.userId = account.userId;
    this.abort = new AbortController();
    return new OverleafHttp(this.link.origin, account.cookies, () => this.store.updateCookies(account), this.abort.signal);
  }
  private async open(): Promise<ProjectJoin> {
    this.check();
    this.set('connecting');
    this.http = this.session();
    const meta = await this.http.page(`/project/${this.link.overleafId}`);
    this.check();
    const socket = this.socket = new OverleafSocket(this.http, this.link.overleafId, typeof meta.wsUrl === 'string' && meta.wsUrl ? meta.wsUrl : '/socket.io');
    // Requests of a closed connection end with it.
    const abort = this.abort!;
    void socket.done.then(() => abort.abort());
    socket.on('event', (name: string, args: unknown[]) => { void this.work(() => this.event(name, args)).catch(error => this.fail(error)); });
    const join = await socket.connect();
    this.check();
    return join;
  }
  private async connect() {
    const join = await this.open();
    await this.work(() => this.reconcile(join, this.link.choice));
    if (this.link.choice) { delete this.link.choice; this.store.saveLink(this.link); }
    let ticking = false;
    this.timers.push(setInterval(() => {
      if (ticking) return;
      ticking = true;
      void this.work(() => this.tick()).catch(error => this.fail(error)).finally(() => { ticking = false; });
    }, SCAN_EVERY));
    this.timers.push(setInterval(() => { void this.work(() => this.saveBase()).catch(error => this.fail(error)); }, BASE_EVERY));
    void this.socket!.call('clientTracking.getConnectedUsers').then(([users]) => {
      type Connected = OverleafUser & { client_id: string; user_id: string; cursorData?: { doc_id?: string; row?: number; column?: number } };
      for (const user of (users as Connected[]) || []) if (user?.client_id && user.client_id !== this.socket?.publicId)
        this.visit(user.client_id, { id: user.user_id, name: fullName(user), doc: user.cursorData?.doc_id, line: user.cursorData?.row, column: user.cursorData?.column, seen: Date.now() });
    }).catch(() => undefined);
  }
  /** A failure in the middle of syncing starts over from a fresh connection. */
  private fail(error: unknown) {
    if (this.stopped || error instanceof StoppedError) return;
    this.message = explain(error);
    this.socket?.close(error instanceof Error ? error : undefined);
  }
  /** Downloads the project into an empty folder once, for an import, with
   *  the main document and compiler set on Overleaf. */
  async fetchAll() {
    const join = await this.open();
    try { await this.work(() => this.reconcile(join, 'overleaf')); await this.work(() => this.saveBase(true)); }
    finally { this.socket?.close(); }
    return { main: this.rootDoc, compiler: this.compiler };
  }
  /** What linking would change, without changing anything. */
  async compare(): Promise<OverleafComparison> {
    const join = await this.open();
    try {
      const tree = this.flatten(join.project.rootFolder[0]), local = scan(this.root), result: OverleafComparison = { name: join.project.name, same: 0, overleaf: [], local: [], different: [] };
      for (const [file, entry] of tree.entries) {
        if (linked(local.links, file)) continue;
        const data = local.has(file) ? read(this.root, file) : null;
        if (!data) { result.overleaf.push(file); continue; }
        let same: boolean;
        if (entry.kind === 'doc') { const doc = await this.joinDoc(entry.id, file); const text = decode(data); same = text !== null && normalize(text) === visible(doc, doc.server); }
        else same = blobHash(data) === entry.hash;
        if (same) result.same++; else result.different.push(file);
      }
      for (const file of local.keys()) if (!tree.entries.has(file) && !localOnly(file, sibling => local.has(sibling))) result.local.push(file);
      return result;
    } finally { this.socket?.close(); }
  }

  private flatten(root: OverleafFolder) {
    const entries = new Map<string, { kind: 'doc' | 'file'; id: string; hash?: string }>(), folders = new Map<string, string>(), byLower = new Set<string>();
    const walk = (folder: OverleafFolder, prefix: string) => {
      folders.set(folder._id, prefix);
      const add = (name: string, value: { kind: 'doc' | 'file'; id: string; hash?: string }) => {
        const file = prefix ? `${prefix}/${name}` : name;
        // A name this computer cannot hold, or one that differs from another
        // only in case on a folder that ignores case, stays on Overleaf.
        if (unsafeName(file) || ignored(file) || byLower.has(file.toLowerCase())) { this.skipped.add(file); return; }
        byLower.add(file.toLowerCase());
        entries.set(file, value);
      };
      for (const doc of folder.docs) add(doc.name, { kind: 'doc', id: doc._id });
      for (const file of folder.fileRefs) add(file.name, { kind: 'file', id: file._id, hash: file.hash });
      for (const child of folder.folders) { const name = prefix ? `${prefix}/${child.name}` : child.name; if (!unsafeName(name) && !ignored(name)) walk(child, name); else this.skipped.add(name); }
    };
    walk(root, '');
    return { entries, folders };
  }

  private async joinDoc(id: string, file: string, fromVersion = -1) {
    const [lines, version, updates, , type] = await this.socket!.call('joinDoc', id, fromVersion, { encodeRanges: true, supportsHistoryOT: true }) as [string[] | StringFileRaw, number, Update[], unknown, DocType | undefined];
    const kind: DocType = type === 'history-ot' ? 'history-ot' : 'sharejs-text-ot';
    const server = kind === 'history-ot' ? trackedText(lines as StringFileRaw) : (lines as string[]).map(decodeLine).join('\n');
    return { id, path: file, type: kind, server, version, updates: updates || [] };
  }
  private newDoc(joined: Awaited<ReturnType<PaperSync['joinDoc']>>): Doc {
    const text = visible(joined, joined.server);
    return { id: joined.id, path: joined.path, type: joined.type, server: joined.server, version: joined.version, inflight: null, sentAt: 0, retried: false, origins: [], queue: new Map(), local: null, agreed: text, dirty: false, behind: null, emptied: 0, eol: '\n', authors: { text, spans: [] } };
  }
  private drop(id: string) {
    const doc = this.docs.get(id);
    if (doc) clearTimeout(doc.gap);
    this.docs.delete(id);
  }
  /** A file's text once it holds still: an editor that empties a file and
   *  then writes it must not be read halfway. */
  private async readStable(file: string) {
    for (let attempt = 0; ; attempt++) {
      this.check();
      const before = stat(this.root, file), data = read(this.root, file), after = stat(this.root, file);
      if (!data || !before || !after) return null;
      // A file as Papilot last wrote or read it needs no wait.
      const known = this.seen.get(file), steady = before.size === after.size && before.mtimeMs === after.mtimeMs && before.size === data.length;
      const settled = steady && ((known?.size === after.size && known.mtimeMs === after.mtimeMs) || Date.now() - after.mtimeMs > 150);
      if (settled || attempt >= 20) {
        const text = decode(data);
        return text === null ? null : { text, eol: lineEnding(text) as '\n' | '\r\n', stat: after };
      }
      await pause(100);
    }
  }
  private writeLocal(doc: Doc, text: string) {
    this.check();
    write(this.root, doc.path, doc.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text);
    doc.local = text;
    this.attribute(doc, text);
    const value = stat(this.root, doc.path);
    if (value) this.seen.set(doc.path, value);
    this.notify();
  }
  private writeFile(file: string, data: Buffer) {
    this.check();
    write(this.root, file, data);
    const value = stat(this.root, file);
    if (value) this.seen.set(file, value);
    this.notify();
  }
  private saved: StoredConflict[] | undefined;
  private conflicts() { return this.saved ??= this.store.conflicts(this.link.id); }
  private saveConflicts(conflicts: StoredConflict[]) { this.saved = conflicts; this.store.saveConflicts(this.link.id, conflicts); this.hooks.status(); }
  private conflict(file: string, kind: 'text' | 'file', value: Conflict | { backup: string }) {
    this.saveConflicts([...this.conflicts(), { id: randomUUID(), path: file, kind, at: Date.now(), ours: '', theirs: '', before: '', after: '', ...value } as StoredConflict]);
  }
  /** Runs one file's step; a failure about that file sets it aside instead
   *  of holding up the rest of the paper. */
  private async attempt(file: string, step: () => Promise<void>, id?: string) {
    try { await step(); }
    catch (error) {
      if (connectionLevel(error)) throw error;
      // A file set aside stops syncing for this connection, so a half-done
      // merge is never sent; one gone from Overleaf is simply gone.
      if (id) { this.entities.delete(id); this.drop(id); }
      if (error instanceof NotFoundError && id) return;
      console.warn('Overleaf sync:', file, error);
      this.skipped.add(file);
      this.hooks.status();
    }
  }

  // ---------------------------------------------------------------- reconcile
  /** Brings both sides together after connecting: catches up on what
   *  happened while apart and merges from the shared base. */
  private async reconcile(join: ProjectJoin, choice?: Choice) {
    if (!present(this.root)) throw new FolderError('The paper folder is missing. Syncing resumes when it is back.');
    this.publicIds = [...this.publicIds, join.publicId].slice(-20);
    this.readOnly = join.permissionsLevel === 'readOnly' || join.permissionsLevel === 'review';
    this.track(join.project.trackChangesState ?? false);
    this.compiler = join.project.compiler;
    this.name = join.project.name;
    for (const user of [join.project.owner, ...(join.project.members || [])]) {
      const name = user?._id ? fullName(user) : '';
      if (name && this.people.get(user!._id) !== name) { this.people.set(user!._id, name); this.authorsDirty = true; }
    }
    if (this.link.name !== this.name) { this.link.name = this.name; this.store.saveLink(this.link); }
    this.skipped.clear();
    const root = join.project.rootFolder[0];
    this.rootFolder = root._id;
    const tree = this.flatten(root), base = this.store.base(this.link.id);
    let local = scan(this.root);
    // Renames and moves on Overleaf keep the entity, so the file moves here
    // too, and keeps its base.
    for (const [file, entry] of tree.entries) {
      const known = this.entities.get(entry.id);
      if (!known || known.path === file) continue;
      if (local.has(known.path) && !local.has(file)) this.relocate(known.path, file);
      if (base[known.path] && !base[file]) { base[file] = base[known.path]; delete base[known.path]; }
    }
    local = scan(this.root);
    this.links = local.links;
    // Files changed while reconciling are found by the next look at the folder.
    this.seen = new Map(local);
    this.entities.clear(); this.folders = tree.folders;
    for (const [id, folder] of tree.folders) this.entities.set(id, { kind: 'folder', path: folder });
    for (const [file, entry] of tree.entries) {
      if (linked(local.links, file)) { this.skipped.add(file); continue; }
      this.entities.set(entry.id, { kind: entry.kind, path: file, hash: entry.hash });
    }
    this.rootDoc = join.project.rootDoc_id ? this.entities.get(join.project.rootDoc_id)?.path : undefined;
    // Files moved or renamed here while apart keep their Overleaf entity: a
    // new file with the content of a synced one that is gone is that file.
    const byPath = new Map([...this.entities].filter(([, entity]) => entity.kind !== 'folder').map(([id, entity]) => [entity.path, id]));
    const gone = Object.keys(base).filter(file => byPath.has(file) && !local.has(file) && !linked(local.links, file));
    const unknown = [...local.keys()].filter(file => !tree.entries.has(file) && !base[file]);
    if (!this.readOnly) for (const file of gone) {
      const hash = base[file].hash, kind = base[file].kind;
      const target = unknown.find(candidate => { const data = read(this.root, candidate), text = data && kind === 'doc' ? decode(data) : null; return data && (kind === 'doc' ? text !== null && blobHash(normalize(text)) === hash : blobHash(data) === hash); });
      if (!target) continue;
      await this.attempt(target, () => this.moveRemote(byPath.get(file)!, file, target));
      if (this.entities.get(byPath.get(file)!)?.path !== target) continue;
      unknown.splice(unknown.indexOf(target), 1);
      base[target] = base[file]; delete base[file];
      const entry = tree.entries.get(file)!; tree.entries.delete(file); tree.entries.set(target, entry);
    }
    // None of the synced files here means a folder replaced or emptied, not
    // every file deleted.
    const synced = Object.keys(base).filter(file => tree.entries.has(file));
    if (synced.length && synced.every(file => !local.has(file) && !linked(local.links, file))) throw new FolderError('None of the synced files are in the paper folder. Syncing resumes when they are back.');
    const baseText = (file: string) => base[file]?.kind === 'doc' ? this.store.baseText(this.link.id, base[file].hash) : undefined;
    const known = new Map(this.docs);
    for (const doc of known.values()) clearTimeout(doc.gap);
    this.docs.clear();
    // Known files catch up on the updates they missed; others are joined
    // afresh and merged from the base.
    const docs = [...tree.entries].filter(([file, entry]) => entry.kind === 'doc' && this.entities.has(entry.id) && !linked(local.links, file));
    const fresh = await limit(docs, async ([file, entry]) => {
      const previous = known.get(entry.id);
      if (previous && await this.catchUp(previous, file)) return null;
      return { joined: await this.joinDoc(entry.id, file), base: previous ? previous.agreed : baseText(file), authors: previous?.authors };
    });
    this.check();
    for (const item of fresh) {
      if (!item) continue;
      const doc = this.newDoc(item.joined);
      if (item.authors) doc.authors = item.authors; else this.restoreAuthors(doc);
      this.docs.set(doc.id, doc);
      await this.attempt(doc.path, () => this.resolveText(doc, item.base, local.has(doc.path), choice), doc.id);
    }
    for (const [file, entry] of tree.entries) if (entry.kind === 'file' && this.entities.has(entry.id)) await this.attempt(file, () => this.resolveFile(file, entry.id, entry.hash, base[file]?.hash, local.has(file), choice), entry.id);
    // Files only here: new ones go to Overleaf; ones Overleaf deleted go
    // unless they were edited here since.
    const skipped = new Set([...this.skipped].map(file => file.toLowerCase()));
    const added = [...local.keys()].filter(file => !tree.entries.has(file) && !base[file]);
    const ignoredByGit = added.length ? await this.hooks.ignored(added) : new Set<string>();
    for (const file of local.keys()) {
      this.check();
      if (tree.entries.has(file) || skipped.has(file.toLowerCase())) continue;
      const entry = base[file];
      if (!entry) { if (!ignoredByGit.has(file) && !localOnly(file, sibling => local.has(sibling) || tree.entries.has(sibling))) await this.attempt(file, () => this.create(file)); continue; }
      const data = read(this.root, file);
      if (!data) continue;
      const text = entry.kind === 'doc' ? decode(data) : null;
      const unchanged = entry.kind === 'doc' ? text !== null && blobHash(normalize(text)) === entry.hash : blobHash(data) === entry.hash;
      if (unchanged) { remove(this.root, file); this.seen.delete(file); }
      else if (!this.readOnly) await this.attempt(file, () => this.create(file, data));
    }
    this.missing.clear();
    this.baseDirty = true;
    this.saveBase();
    for (const doc of this.docs.values()) await this.flush(doc);
    this.syncedAt = Date.now();
    this.set('synced');
    this.notify();
  }
  /** Replays what a known file missed since its version; false when Overleaf
   *  no longer has those updates, and the file is joined afresh. */
  private async catchUp(doc: Doc, file: string) {
    try {
      const joined = await this.joinDoc(doc.id, file, doc.version);
      if (joined.type !== doc.type) return false;
      doc.path = file; doc.queue.clear(); clearTimeout(doc.gap); doc.gap = undefined;
      this.docs.set(doc.id, doc);
      for (const update of joined.updates.sort((a, b) => a.v - b.v)) if (update.v === doc.version) await this.received(doc, update, true);
      if (doc.version !== joined.version || visible(doc, doc.server) !== visible(joined, joined.server)) { this.drop(doc.id); return false; }
      if (doc.inflight) this.send(doc, true);
      return true;
    } catch (error) {
      if (connectionLevel(error)) throw error;
      this.drop(doc.id);
      return false;
    }
  }
  private async resolveText(doc: Doc, base: string | undefined, present: boolean, choice?: Choice) {
    const remote = visible(doc, doc.server), local = present ? await this.readStable(doc.path) : null;
    // Bytes here that are not text stay as they are.
    if (present && !local && fs.existsSync(path.join(this.root, doc.path))) { this.skipped.add(doc.path); return; }
    if (!local) {
      if (base !== undefined && base === remote && !this.readOnly) { await this.removeRemote(doc.id); return; }
      this.writeLocal(doc, remote); doc.agreed = remote; return;
    }
    doc.eol = local.eol; doc.local = normalize(local.text);
    this.attribute(doc, doc.local);
    const mine = doc.local;
    if (mine === remote) { doc.agreed = remote; if (local.text !== remote && doc.eol === '\n') this.writeLocal(doc, remote); return; }
    if (base === undefined) {
      if (choice === 'local' && !this.readOnly) return; // The flush after reconciling sends it.
      // Both sides have their own version and no shared past: Overleaf's
      // stays, and the author's is kept to put back.
      this.conflict(doc.path, 'file', { backup: this.store.backup(this.link.id, read(this.root, doc.path)!) });
      this.writeLocal(doc, remote); doc.agreed = remote; return;
    }
    const merged = merge3(normalize(base), mine, remote);
    for (const conflict of merged.conflicts) this.conflict(doc.path, 'text', conflict);
    if (merged.text !== doc.local) this.writeLocal(doc, merged.text);
    if (merged.text === remote) doc.agreed = remote;
    this.settle(doc);
  }
  private async resolveFile(file: string, id: string, remote: string | undefined, base: string | undefined, present: boolean, choice?: Choice) {
    const data = present ? read(this.root, file) : null, mine = data ? blobHash(data) : null;
    if (!data) {
      if (base && base === remote && !this.readOnly) await this.removeRemote(id);
      else await this.download(file, id);
      return;
    }
    // Without a hash from Overleaf, its bytes decide.
    if (!remote) { const theirs = await this.http!.download(`/project/${this.link.overleafId}/file/${id}`); remote = blobHash(theirs); this.entities.get(id)!.hash = remote; }
    if (mine === remote) { this.entities.get(id)!.agreed = remote; return; }
    if (this.readOnly && base === remote) { this.entities.get(id)!.agreed = base; return; }
    if (base === undefined ? choice === 'local' : base === remote) { if (!this.readOnly) await this.upload(file, data); return; }
    if (base !== mine) this.conflict(file, 'file', { backup: this.store.backup(this.link.id, data) });
    await this.download(file, id);
  }

  // -------------------------------------------------------------- live edits
  private async received(doc: Doc, update: Update, replay = false) {
    if (update.v < doc.version) return;
    if (update.v > doc.version) {
      doc.queue.set(update.v, update);
      // A missing update that never arrives means the copy cannot be trusted.
      doc.gap ??= setTimeout(() => { doc.gap = undefined; if (this.docs.get(doc.id) === doc) this.fail(new ConnectionError('Overleaf updates arrived out of order.')); }, GAP_PATIENCE);
      return;
    }
    const source = update.meta?.source, ours = Boolean(source && this.publicIds.includes(source));
    if (!update.op || (ours && doc.inflight && doc.origins.includes(source!))) {
      // Our own edit, acknowledged: live, or as an earlier connection's edit
      // that Overleaf applied late.
      if (!doc.inflight) return;
      doc.server = apply(doc.type, doc.server, doc.inflight);
      doc.inflight = null; doc.origins = [];
      doc.version++;
    } else if (update.dup) {
      return;
    } else if (ours) {
      // An earlier connection's edit that is already in the file.
      if (doc.inflight) [doc.inflight] = transformX(doc.type, doc.inflight, update.op);
      doc.server = apply(doc.type, doc.server, update.op);
      doc.version++;
    } else await this.remote(doc, update.op, update.meta?.user_id);
    for (let next = doc.queue.get(doc.version); next; next = doc.queue.get(doc.version)) { doc.queue.delete(doc.version); await this.received(doc, next, replay); }
    if (!doc.queue.size) { clearTimeout(doc.gap); doc.gap = undefined; }
    this.settle(doc);
    if (!replay) await this.flush(doc);
  }
  /** A coauthor's edit: applied to Overleaf's copy, and to the file around
   *  whatever the author changed there that Overleaf has not seen yet. */
  private async remote(doc: Doc, op: Op, user?: string) {
    const predicted = doc.inflight ? apply(doc.type, doc.server, doc.inflight) : doc.server;
    let incoming = op;
    if (doc.inflight) [doc.inflight, incoming] = transformX(doc.type, doc.inflight, op);
    doc.server = apply(doc.type, doc.server, op);
    doc.version++;
    if (doc.behind !== null) return; // The next send merges everything.
    // Reading may wait for an editor, during which Git can start or the
    // folder can disappear. Keep the pre-update base until writing succeeds.
    doc.behind = visible(doc, predicted);
    // The file is merged as it is now; when it changes in the moment
    // between reading and writing, it is merged again.
    for (let attempt = 0; attempt < 5; attempt++) {
      const file = await this.readStable(doc.path);
      if (!file) break;
      doc.eol = file.eol;
      const before = normalize(file.text), pending = editFor(doc.type, predicted, before);
      let local = incoming;
      if (pending) [, local] = transformX(doc.type, pending, incoming);
      const snapshot = pending ? apply(doc.type, predicted, pending) : predicted;
      const after = visible(doc, apply(doc.type, snapshot, local));
      this.attribute(doc, before);
      if (after === before) { doc.local = after; doc.behind = null; return; }
      const now = stat(this.root, doc.path);
      if (now && now.size === file.stat.size && now.mtimeMs === file.stat.mtimeMs) { this.attribute(doc, after, user); this.writeLocal(doc, after); doc.behind = null; return; }
    }
    // A moving or briefly missing file keeps its base for the next send.
  }
  private settle(doc: Doc) {
    const remote = visible(doc, doc.server), dirty = doc.local !== null && doc.local !== remote;
    if (!doc.inflight && !dirty && doc.agreed !== remote) { doc.agreed = remote; this.baseDirty = true; }
    if (dirty !== doc.dirty) { doc.dirty = dirty; this.hooks.status(); }
  }
  /** Sends what the author changed in a file, one edit in flight at a time. */
  private async flush(doc: Doc) {
    if (doc.inflight || this.readOnly || !this.socket || doc.queue.size) return;
    const file = await this.readStable(doc.path);
    if (!file || doc.inflight || this.docs.get(doc.id) !== doc) return;
    doc.eol = file.eol; doc.local = normalize(file.text);
    this.attribute(doc, doc.local);
    const server = visible(doc, doc.server);
    if (doc.behind !== null) {
      const merged = merge3(doc.behind, doc.local, server);
      for (const conflict of merged.conflicts) this.conflict(doc.path, 'text', conflict);
      if (merged.text !== doc.local) this.writeLocal(doc, merged.text);
      doc.behind = null;
    }
    // A file that suddenly reads empty is more likely being rewritten than
    // cleared; it is sent empty only once it stays so.
    if (!doc.local && server && ++doc.emptied < 2) return;
    doc.emptied = 0;
    const tracking = this.tracking && doc.type === 'history-ot' ? { userId: this.userId, ts: new Date().toISOString() } : undefined;
    let op = editFor(doc.type, doc.server, doc.local, tracking);
    if (!op) { this.settle(doc); return; }
    // Overleaf cannot store characters outside the Basic Multilingual Plane
    // that an edit inserts; the file takes the text Overleaf will have.
    op = doc.type === 'history-ot' ? (op as RawEditOperation[]).map(sanitizeHistoryOp) : sanitizeTextOp(op as TextOp);
    const after = visible(doc, apply(doc.type, doc.server, op));
    if (after !== doc.local) this.writeLocal(doc, after);
    if (after === server) { this.settle(doc); return; }
    doc.inflight = op;
    this.send(doc);
    this.hooks.status();
  }
  private send(doc: Doc, again = false) {
    this.check();
    doc.sentAt = Date.now(); doc.retried = again;
    if (this.socket && !doc.origins.includes(this.socket.publicId)) doc.origins.push(this.socket.publicId);
    // Overleaf tracks changes in ShareJS files from a seed for their ids.
    const meta = this.tracking && doc.type === 'sharejs-text-ot' ? { meta: { tc: randomBytes(9).toString('hex') } } : {};
    const update = { doc: doc.id, op: doc.inflight, v: doc.version, ...meta, ...(again ? { dupIfSource: this.publicIds } : {}) };
    this.socket!.call('applyOtUpdate', doc.id, update).catch(error => {
      // A refused edit means the copies differ: start over and merge.
      if ((error as { remote?: boolean }).remote) this.drop(doc.id);
      this.fail(error);
    });
  }

  private async event(name: string, args: unknown[]) {
    if (name === 'otUpdateApplied') {
      const update = args[0] as Update, doc = update && this.docs.get(update.doc);
      if (doc) await this.received(doc, update);
    } else if (name === 'otUpdateError') {
      const doc = this.docs.get((args[1] as { doc_id?: string } | undefined)?.doc_id || '');
      if (doc) this.drop(doc.id);
      this.fail(new ConnectionError('Overleaf could not apply an edit. Papilot merges the file again.'));
    } else if (name === 'reciveNewDoc' || name === 'reciveNewFile') {
      const [folder, entity] = args as [string, { _id: string; name: string; hash?: string }];
      if (this.entities.has(entity._id)) return;
      const parent = this.folders.get(folder);
      if (parent === undefined) return;
      const file = parent ? `${parent}/${entity.name}` : entity.name;
      if (unsafeName(file) || ignored(file) || linked(this.links, file)) { this.skipped.add(file); return; }
      // The same path under another id was replaced.
      for (const [id, known] of this.entities) if (known.path === file) { this.entities.delete(id); this.drop(id); }
      this.entities.set(entity._id, { kind: name === 'reciveNewDoc' ? 'doc' : 'file', path: file, hash: entity.hash });
      await this.attempt(file, async () => {
        if (name === 'reciveNewDoc') {
          const doc = this.newDoc(await this.joinDoc(entity._id, file));
          this.docs.set(doc.id, doc);
          await this.resolveText(doc, undefined, fs.existsSync(path.join(this.root, file)));
        } else {
          const data = read(this.root, file);
          if (!data || blobHash(data) !== entity.hash) {
            if (data) this.conflict(file, 'file', { backup: this.store.backup(this.link.id, data) });
            await this.download(file, entity._id);
          }
        }
      }, entity._id);
      this.baseDirty = true;
    } else if (name === 'reciveNewFolder') {
      const [folder, entity] = args as [string, { _id: string; name: string }];
      const parent = this.folders.get(folder);
      if (parent === undefined || this.folders.has(entity._id)) return;
      const value = parent ? `${parent}/${entity.name}` : entity.name;
      this.folders.set(entity._id, value); this.entities.set(entity._id, { kind: 'folder', path: value });
    } else if (name === 'reciveEntityRename' || name === 'reciveEntityMove') {
      const [id, value] = args as [string, string];
      const entity = this.entities.get(id);
      if (!entity) return;
      const target = name === 'reciveEntityRename' ? (path.posix.dirname(entity.path) === '.' ? value : `${path.posix.dirname(entity.path)}/${value}`) : (() => { const parent = this.folders.get(value); return parent === undefined ? null : parent ? `${parent}/${path.posix.basename(entity.path)}` : path.posix.basename(entity.path); })();
      if (target === null || target === entity.path) return;
      if (unsafeName(target) || ignored(target) || linked(this.links, target)) this.leave(id, target);
      else this.relocate(entity.path, target);
      this.baseDirty = true;
    } else if (name === 'removeEntity') {
      const id = args[0] as string, entity = this.entities.get(id);
      if (!entity) return;
      const gone = entity.kind === 'folder' ? [...this.entities].filter(([, item]) => item.kind !== 'folder' && item.path.startsWith(entity.path + '/')).map(([key]) => key) : [id];
      for (const key of gone) {
        const item = this.entities.get(key)!, doc = this.docs.get(key), data = read(this.root, item.path);
        // Edits Overleaf has not received yet are kept to put back.
        const edited = data && (doc ? normalize(decode(data) ?? '') !== visible(doc, doc.server) : item.kind === 'file' && blobHash(data) !== item.hash);
        if (edited) this.conflict(item.path, 'file', { backup: this.store.backup(this.link.id, data) });
        this.entities.delete(key); this.drop(key);
        remove(this.root, item.path); this.seen.delete(item.path);
      }
      if (entity.kind === 'folder') { for (const [key, item] of this.entities) if (item.kind === 'folder' && (item.path === entity.path || item.path.startsWith(entity.path + '/'))) { this.entities.delete(key); this.folders.delete(key); } }
      else this.entities.delete(id);
      this.notify();
      this.baseDirty = true;
    } else if (name === 'clientTracking.clientUpdated') {
      const user = args[0] as { id: string; user_id?: string; name?: string; email?: string; doc_id?: string; row?: number; column?: number };
      if (user?.id && user.id !== this.socket?.publicId) this.visit(user.id, { id: user.user_id || ANONYMOUS, name: fullName(user), doc: user.doc_id, line: user.row, column: user.column, seen: Date.now() });
    } else if (name === 'clientTracking.clientDisconnected') {
      this.visit(args[0] as string, null);
    } else if (name === 'toggle-track-changes') {
      this.track(args[0] as boolean | Record<string, boolean>);
    } else if (name === 'projectNameUpdated') {
      this.name = String(args[0] || this.name); this.link.name = this.name; this.store.saveLink(this.link); this.hooks.status();
    } else if (name === 'project:access:revoked') {
      this.fail(new AccessError('This Overleaf account cannot open the project.'));
    }
  }
  /** A coauthor moved something to a name this folder does not sync: it
   *  stops syncing, and the files here are kept to put back. */
  private leave(id: string, target: string) {
    const entity = this.entities.get(id)!, prefix = entity.path;
    const items = entity.kind === 'folder' ? [...this.entities].filter(([, item]) => item.path === prefix || item.path.startsWith(prefix + '/')) : [[id, entity] as const];
    for (const [key, item] of items) {
      const data = item.kind === 'folder' ? null : read(this.root, item.path);
      if (data) { this.conflict(item.path, 'file', { backup: this.store.backup(this.link.id, data) }); remove(this.root, item.path); this.seen.delete(item.path); }
      this.entities.delete(key); this.drop(key); this.folders.delete(key);
    }
    this.skipped.add(target);
    this.notify();
  }
  /** Moves a file or folder here, with everything Papilot knows about it. */
  private relocate(from: string, to: string) {
    this.check();
    const source = path.join(this.root, from), target = path.join(this.root, to);
    if (fs.existsSync(source) && fs.existsSync(target) && !sameFile(source, target)) {
      // Overleaf's names win: a file here that only had the name is kept to
      // put back, never uploaded in the moved file's place.
      if (fs.lstatSync(target).isFile()) { this.conflict(to, 'file', { backup: this.store.backup(this.link.id, read(this.root, to)!) }); remove(this.root, to); }
      else { for (const entity of [...this.entities.values()].filter(item => item.kind !== 'folder' && item.path.startsWith(from + '/'))) this.relocate(entity.path, to + entity.path.slice(from.length)); }
    }
    if (fs.existsSync(source) && (!fs.existsSync(target) || sameFile(source, target))) move(this.root, from, to);
    const rename = (file: string) => file === from ? to : file.startsWith(from + '/') ? to + file.slice(from.length) : file;
    for (const entity of this.entities.values()) entity.path = rename(entity.path);
    for (const [id, folder] of this.folders) this.folders.set(id, rename(folder));
    for (const doc of this.docs.values()) doc.path = rename(doc.path);
    this.seen = new Map([...this.seen].map(([file, value]) => [rename(file), value]));
    this.notify();
  }

  // ------------------------------------------------------------ local edits
  /** Looks at the folder: edited files are sent, new ones uploaded, and
   *  deleted or renamed ones deleted or renamed on Overleaf. */
  private async tick() {
    if (!this.socket || this.socket.closed) return;
    if (this.hooks.busy()) { this.set('paused'); this.socket.close(); return; }
    if (!present(this.root)) { this.fail(new FolderError('The paper folder is missing. Syncing resumes when it is back.')); return; }
    for (const doc of this.docs.values()) {
      if (!doc.inflight) continue;
      if (Date.now() - doc.sentAt > GIVE_UP_AFTER) { this.fail(new ConnectionError('Overleaf did not confirm an edit. Papilot reconnects.')); return; }
      if (!doc.retried && Date.now() - doc.sentAt > RESEND_AFTER) this.send(doc, true);
    }
    const files = scan(this.root), byPath = new Map<string, string>();
    this.links = files.links;
    for (const [id, entity] of this.entities) if (entity.kind !== 'folder') byPath.set(entity.path, id);
    const missing: string[] = [];
    for (const file of byPath.keys()) {
      if (files.has(file) || linked(files.links, file)) continue;
      this.missing.set(file, (this.missing.get(file) || 0) + 1);
      missing.push(file);
    }
    const added: string[] = [];
    for (const [file, value] of files) {
      const before = this.seen.get(file);
      if (before && before.size === value.size && before.mtimeMs === value.mtimeMs) continue;
      this.seen.set(file, value);
      this.missing.delete(file);
      const id = byPath.get(file);
      if (!id) { added.push(file); continue; }
      if (this.readOnly) continue;
      const entity = this.entities.get(id)!;
      if (entity.kind === 'doc') { const doc = this.docs.get(id); if (doc) await this.flush(doc); }
      else { const data = read(this.root, file); if (data && blobHash(data) !== entity.hash) await this.attempt(file, () => this.upload(file, data), id); }
    }
    for (const file of [...this.seen.keys()]) if (!files.has(file) && !byPath.has(file)) this.seen.delete(file);
    // A doc whose edit was held back, such as one read empty, is tried again.
    for (const doc of this.docs.values()) if (doc.emptied) await this.flush(doc);
    if (this.readOnly) return;
    const ignoredByGit = added.length ? await this.hooks.ignored(added) : new Set<string>();
    // A new file with the content of one just deleted is that file moved.
    const moves: [string, string][] = [], creations: [string, Buffer][] = [];
    for (const file of added) {
      if (localOnly(file, sibling => files.has(sibling)) || ignoredByGit.has(file) || this.skipped.has(file)) continue;
      const data = read(this.root, file);
      if (!data) continue;
      const hash = blobHash(data), text = decode(data), moved = missing.find(old => {
        const id = byPath.get(old)!, entity = this.entities.get(id)!, doc = this.docs.get(id);
        return entity.kind === 'doc' ? doc && text !== null && normalize(text) === visible(doc, doc.server) : entity.hash === hash;
      });
      if (moved) { missing.splice(missing.indexOf(moved), 1); moves.push([moved, file]); }
      else creations.push([file, data]);
    }
    // Every synced file gone at once, and none moved, is a folder emptied or
    // replaced, not files to delete or to add.
    if (missing.length && missing.length === byPath.size) { this.fail(new FolderError('None of the synced files are in the paper folder. Syncing resumes when they are back.')); return; }
    for (const [from, to] of moves) { this.missing.delete(from); await this.attempt(to, () => this.moveRemote(byPath.get(from)!, from, to)); }
    for (const [file, data] of creations) await this.attempt(file, () => this.create(file, data));
    // A file is deleted only once it stays gone, not while an editor or Git
    // replaces it.
    for (const file of missing) if (this.missing.get(file)! >= 2) { this.missing.delete(file); await this.attempt(file, () => this.removeRemote(byPath.get(file)!)); }
  }

  // ---------------------------------------------------------- Overleaf calls
  private async folderFor(folder: string): Promise<string> {
    if (folder === '' || folder === '.') return this.rootFolder;
    for (const [id, value] of this.folders) if (value === folder) return id;
    const parent = await this.folderFor(path.posix.dirname(folder));
    this.check();
    const created = await this.http!.json<{ _id: string }>(`/project/${this.link.overleafId}/folder`, { method: 'POST', entity: true, body: { json: { name: path.posix.basename(folder), parent_folder_id: parent } } });
    this.folders.set(created._id, folder); this.entities.set(created._id, { kind: 'folder', path: folder });
    return created._id;
  }
  private async upload(file: string, data: Buffer) {
    if (data.length > 50 * 1024 * 1024) { this.skipped.add(file); return; }
    const folder = await this.folderFor(path.posix.dirname(file));
    this.check();
    const result = await this.http!.json<{ success: boolean; entity_id?: string; entity_type?: 'doc' | 'file'; hash?: string }>(`/Project/${this.link.overleafId}/upload?folder_id=${folder}`, { method: 'POST', entity: true, body: { form: { name: path.posix.basename(file) }, file: { field: 'qqfile', name: path.posix.basename(file), data } }, limit: 1024 * 1024 });
    if (!result.success || !result.entity_id) throw new Error('Overleaf refused the change.');
    for (const [id, entity] of this.entities) if (entity.path === file && id !== result.entity_id) { this.entities.delete(id); this.drop(id); }
    const hash = result.hash ?? blobHash(data);
    this.entities.set(result.entity_id, { kind: result.entity_type === 'doc' ? 'doc' : 'file', path: file, hash, agreed: hash });
    if (result.entity_type === 'doc') {
      const doc = this.newDoc(await this.joinDoc(result.entity_id, file));
      this.docs.set(doc.id, doc);
      await this.flush(doc);
    }
    this.baseDirty = true;
  }
  private async create(file: string, data: Buffer | null = read(this.root, file)) {
    if (!data || this.readOnly) return;
    try { await this.upload(file, data); }
    catch (error) { if ((error as { statusCode?: number }).statusCode === 422) this.skipped.add(file); else throw error; }
  }
  private async download(file: string, id: string) {
    const before = read(this.root, file);
    const data = await this.http!.download(`/project/${this.link.overleafId}/file/${id}`);
    this.check();
    const current = read(this.root, file);
    // The author may have saved another version while the download ran.
    if (current && !current.equals(data) && (!before || !current.equals(before))) this.conflict(file, 'file', { backup: this.store.backup(this.link.id, current) });
    this.writeFile(file, data);
    const entity = this.entities.get(id);
    if (entity) entity.hash = entity.agreed = blobHash(data);
    this.baseDirty = true;
  }
  private async removeRemote(id: string) {
    this.check();
    const entity = this.entities.get(id);
    if (!entity) return;
    try { await this.http!.json(`/project/${this.link.overleafId}/${entity.kind}/${id}`, { method: 'DELETE', entity: true }); }
    catch (error) { if (!(error instanceof NotFoundError)) throw error; }
    this.entities.delete(id); this.drop(id);
    // Folders left empty go too, as nothing here keeps them.
    for (let folder = path.posix.dirname(entity.path); folder !== '.'; folder = path.posix.dirname(folder)) {
      const folderId = [...this.folders].find(([, value]) => value === folder)?.[0];
      if (!folderId || [...this.entities.values()].some(item => item.kind !== 'folder' && item.path.startsWith(folder + '/')) || fs.existsSync(path.join(this.root, folder))) break;
      this.check();
      try { await this.http!.json(`/project/${this.link.overleafId}/folder/${folderId}`, { method: 'DELETE', entity: true }); } catch (error) { if (connectionLevel(error)) throw error; break; }
      this.folders.delete(folderId); this.entities.delete(folderId);
    }
    this.baseDirty = true;
  }
  private async moveRemote(id: string, from: string, to: string) {
    this.check();
    const entity = this.entities.get(id)!;
    if (path.posix.dirname(from) !== path.posix.dirname(to)) {
      const folder = await this.folderFor(path.posix.dirname(to));
      this.check();
      await this.http!.json(`/project/${this.link.overleafId}/${entity.kind}/${id}/move`, { method: 'POST', entity: true, body: { json: { folder_id: folder } } });
    }
    this.check();
    if (path.posix.basename(from) !== path.posix.basename(to)) await this.http!.json(`/project/${this.link.overleafId}/${entity.kind}/${id}/rename`, { method: 'POST', entity: true, body: { json: { name: path.posix.basename(to) } } });
    entity.path = to;
    const doc = this.docs.get(id);
    if (doc) doc.path = to;
    this.baseDirty = true;
  }
  private track(state: boolean | Record<string, boolean>) {
    const tracking = state === true || (typeof state === 'object' && state !== null && state[this.userId] === true);
    if (tracking !== this.tracking) { this.tracking = tracking; this.hooks.status(); }
  }

  // --------------------------------------------------------------- the base
  private saveBase(force = false) {
    if (!this.baseDirty && !this.authorsDirty && !force) return;
    if (!this.entities.size) return;
    const base: Base = {}, texts = new Map<string, string>();
    // Files set aside keep the base they had, for the next merge.
    if (this.skipped.size) { const old = this.store.base(this.link.id); for (const file of this.skipped) if (old[file]) { base[file] = old[file]; const text = old[file].kind === 'doc' ? this.store.baseText(this.link.id, old[file].hash) : undefined; if (text !== undefined) texts.set(file, text); } }
    for (const doc of this.docs.values()) { const hash = blobHash(doc.agreed); base[doc.path] = { kind: 'doc', hash }; texts.set(doc.path, doc.agreed); }
    for (const entity of this.entities.values()) if (entity.kind === 'file' && entity.agreed) base[entity.path] = { kind: 'file', hash: entity.agreed };
    // Who wrote what is kept with the text it is about; a file not open
    // this time keeps what it had.
    const authors: StoredAuthors = { people: Object.fromEntries(this.people), docs: {} }, authorTexts = new Map<string, string>();
    for (const [id, entity] of this.entities) {
      const doc = this.docs.get(id), kept = this.storedAuthors?.docs[id];
      if (doc?.authors.spans.length) {
        const hash = blobHash(doc.authors.text);
        authors.docs[id] = { hash, spans: doc.authors.spans.map(span => [span.from, span.to, span.user, span.at]) };
        authorTexts.set(hash, doc.authors.text);
      } else if (!doc && entity.kind === 'doc' && kept) {
        const text = this.store.baseText(this.link.id, kept.hash);
        if (text !== undefined) { authors.docs[id] = kept; authorTexts.set(kept.hash, text); }
      }
    }
    this.store.saveBase(this.link.id, base, texts, { value: authors, texts: authorTexts });
    this.storedAuthors = authors;
    this.baseDirty = false; this.authorsDirty = false;
  }

  // -------------------------------------------------------------- conflicts
  /** Puts the author's version back, which then syncs like any edit. */
  async useMine(conflictId: string) {
    return this.work(() => {
      const conflicts = this.conflicts(), conflict = conflicts.find(item => item.id === conflictId);
      if (!conflict) throw new Error('This conflict was already resolved.');
      if (conflict.kind === 'file') {
        const data = conflict.backup && this.store.readBackup(this.link.id, conflict.backup);
        if (!data) throw new Error('The saved version is no longer available.');
        write(this.root, conflict.path, data);
      } else {
        const data = read(this.root, conflict.path), current = data && decode(data);
        const text = current !== null ? restore(normalize(current), conflict) : null;
        if (text === null) throw new Error('This passage has changed since. Edit it in the file instead.');
        write(this.root, conflict.path, lineEnding(current!) === '\r\n' ? text.replace(/\n/g, '\r\n') : text);
      }
      this.notify();
      this.dismiss(conflictId, conflicts);
    });
  }
  dismiss(conflictId: string, conflicts = this.conflicts()) {
    const conflict = conflicts.find(item => item.id === conflictId);
    if (conflict?.backup) this.store.removeBackup(this.link.id, conflict.backup);
    this.saveConflicts(conflicts.filter(item => item.id !== conflictId));
  }
}
