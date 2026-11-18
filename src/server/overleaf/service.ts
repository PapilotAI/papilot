import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { OVERLEAF, OverleafHttp, AccessError, SignInError, parseCookies, serverOrigin, type Cookies } from './http.ts';
import { OverleafStore, type Link } from './store.ts';
import { browserCookies, browserSessions, removeCookieCopies, type BrowserOptions } from './browsers.ts';
import { PaperSync } from './engine.ts';
import type { OverleafComparison, OverleafCursor, OverleafProjectSummary, OverleafState, Project, SourceAuthor } from '../../shared.ts';

// Papilot's side of Overleaf: the accounts it signed in with, and one live
// sync for each paper linked to a project.

const PROJECT_ID = /^[a-f0-9]{24}$/i;
export interface ProjectLink { origin: string; overleafId?: string; invite?: string; token?: string; hash?: string }
/** What a pasted Overleaf address points to: a project, an invitation to
 *  one, or an older token link; on Overleaf's own site or a self-hosted one. */
export function projectLink(value: unknown): ProjectLink {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new Error('Paste the link of an Overleaf project.');
  const text = value.trim();
  if (PROJECT_ID.test(text)) return { origin: OVERLEAF, overleafId: text.toLowerCase() };
  let url: URL;
  try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : 'https://' + text); } catch { throw new Error('Paste the link of an Overleaf project.'); }
  const origin = serverOrigin(url.origin), segments = url.pathname.split('/').filter(Boolean);
  if (segments[0]?.toLowerCase() === 'project' && PROJECT_ID.test(segments[1] || '')) {
    const overleafId = segments[1].toLowerCase();
    if (segments[2] === 'share') {
      if (!url.hash.slice(1)) throw new Error('This Overleaf sharing link is incomplete. Copy the full link, including the part after #.');
      return { origin, overleafId, invite: url.hash.slice(1) };
    }
    return { origin, overleafId };
  }
  if (segments[0] === 'read' && /^[a-z]+$/.test(segments[1] || '') && segments.length === 2) return { origin, token: `/read/${segments[1]}`, ...(url.hash ? { hash: url.hash } : {}) };
  if (segments.length === 1 && /^\d+[a-z]+$/.test(segments[0])) return { origin, token: `/${segments[0]}`, ...(url.hash ? { hash: url.hash } : {}) };
  throw new Error('Paste the link of an Overleaf project, such as one from its Share menu or the address bar.');
}

const git = (root: string, args: string[], input?: string) => new Promise<{ code: number; stdout: string }>(resolve => {
  const child = execFile('git', args, { cwd: root, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve({ code: error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0, stdout }));
  // Git may exit before reading every path; that is not a crash.
  child.stdin?.on('error', () => {});
  if (input !== undefined) child.stdin?.end(input);
});
function gitDir(root: string) {
  const dot = path.join(root, '.git');
  try { return fs.statSync(dot).isFile() ? path.resolve(root, fs.readFileSync(dot, 'utf8').replace(/^gitdir:\s*/, '').trim()) : dot; } catch { return null; }
}
/** Whether Git is merging, rebasing or picking commits in the folder. */
export function gitBusy(root: string) {
  const dir = gitDir(root);
  return Boolean(dir && ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].some(name => fs.existsSync(path.join(dir, name))));
}
export async function gitIgnored(root: string, files: string[]) {
  const result = await git(root, ['check-ignore', '--stdin', '-z'], files.join('\0'));
  return new Set(result.stdout.split('\0').filter(Boolean));
}

export class OverleafService extends EventEmitter {
  readonly store: OverleafStore;
  private syncs = new Map<string, PaperSync>();
  private reservations = new Set<string>();
  private finishing = new Map<string, Promise<Project>>();
  // Syncs being stopped, so a new one for the same paper waits for them.
  private stopping = new Map<string, Promise<void>>();
  private changeTimer: NodeJS.Timeout | undefined;
  /** Where browsers keep their cookies; tests point it at a fixture home. */
  browserOptions: BrowserOptions = {};
  constructor(directory: string, private papers: { project(id: string): Project; projects(): Project[] }, private touched: (projectId: string) => void) {
    super();
    this.setMaxListeners(0);
    this.store = new OverleafStore(directory);
  }
  /** Starts every linked paper's sync, and forgets links whose paper or
   *  import is gone. */
  start(pendingImports: (linkId: string) => boolean = () => false) {
    void removeCookieCopies();
    const projects = new Set(this.papers.projects().map(project => project.id));
    for (const link of this.store.links()) {
      if (link.projectId && projects.has(link.projectId)) this.run(link);
      else if (!link.projectId && pendingImports(link.id)) continue;
      else this.store.removeLink(link.id);
    }
  }
  private changed() { this.changeTimer ??= setTimeout(() => { this.changeTimer = undefined; this.emit('change'); }, 200); }
  private run(link: Link) {
    const project = this.papers.project(link.projectId!), previous = this.syncs.get(project.id);
    const sync = new PaperSync(link, project.path, this.store, {
      changed: () => this.touched(project.id),
      busy: () => gitBusy(project.path),
      ignored: files => gitIgnored(project.path, files),
      status: () => this.changed(),
      presence: () => this.emit('presence'),
    });
    this.syncs.set(project.id, sync);
    // Two syncs never work on one folder: the previous one stops first.
    void (previous ? previous.stop() : this.stopping.get(project.id) ?? Promise.resolve()).then(() => { if (this.syncs.get(project.id) === sync) sync.start(); });
    this.changed();
    return sync;
  }
  /** Where coauthors' cursors are on Overleaf, by paper. */
  cursors(): Record<string, OverleafCursor[]> {
    return Object.fromEntries([...this.syncs].map(([projectId, sync]) => [projectId, sync.cursors()]).filter(([, cursors]) => cursors.length));
  }
  /** Who wrote what on Overleaf in a synced paper's file, as it reads now. */
  authors(projectId: string, file: string, text: string): SourceAuthor[] { return this.syncs.get(projectId)?.authors(file, text) ?? []; }
  state(): OverleafState {
    return {
      accounts: Object.values(this.store.accounts()).map(({ origin, email }) => ({ origin, email })),
      syncs: [...this.syncs].map(([projectId, sync]) => sync.status(projectId)),
    };
  }
  async stop() { await Promise.all([...this.syncs.values()].map(sync => sync.stop())); this.syncs.clear(); }

  // ---------------------------------------------------------------- accounts
  /** Signs in with the cookies of an Overleaf session: those the desktop
   *  app's sign-in window captured in a `fresh` session of its own, or a
   *  Cookie header the author pasted from a browser, which stays theirs. */
  async signIn(origin: unknown, cookies: unknown, fresh?: unknown) {
    const server = serverOrigin(origin);
    const jar: Cookies = typeof cookies === 'string' ? parseCookies(cookies.includes('=') ? cookies : `${server === OVERLEAF ? 'overleaf_session2' : 'overleaf.sid'}=${cookies}`) : {};
    return this.accept(server, jar, fresh !== true);
  }
  /** Browsers on this computer already signed in to an Overleaf server. */
  browsers(origin: unknown) { return browserSessions(serverOrigin(origin), this.browserOptions); }
  /** Signs in with the session of a browser on this computer. */
  async signInWithBrowser(origin: unknown, browser: unknown, signal?: AbortSignal) {
    const server = serverOrigin(origin);
    if (typeof browser !== 'string') throw new Error('Choose a browser.');
    return this.accept(server, await browserCookies(server, browser, { ...this.browserOptions, signal }), true);
  }
  private async accept(server: string, jar: Cookies, shared: boolean) {
    if (!Object.keys(jar).length) throw new Error('Sign in to Overleaf first.');
    const http = new OverleafHttp(server, jar);
    let account: { userId: string; email: string };
    try { account = await http.account(); } catch (error) { throw error instanceof SignInError || error instanceof AccessError ? new Error('Overleaf did not accept this sign-in. Sign in again.') : error; }
    this.store.saveAccount({ origin: server, cookies: jar, ...account, savedAt: Date.now(), ...(shared ? { shared } : {}) });
    // Existing connections hold the old session and its permissions. Stop
    // them before reconnecting with the account the author just chose.
    for (const sync of [...this.syncs.values()]) if (sync.link.origin === server) this.run(sync.link);
    this.changed();
    return { origin: server, email: account.email };
  }
  async signOut(origin: unknown) {
    const server = serverOrigin(origin), account = this.store.account(server);
    this.store.removeAccount(server);
    for (const sync of [...this.syncs.values()]) if (sync.link.origin === server) this.run(sync.link);
    // End the session Papilot signed in with, unless a browser here shares it.
    if (account && !account.shared) await new OverleafHttp(server, account.cookies).json('/logout', { method: 'POST' }).catch(() => undefined);
    this.changed();
    return this.state();
  }
  private http(origin: string) {
    const account = this.store.account(origin);
    if (!account) throw Object.assign(new SignInError('Sign in to this Overleaf server first.'), { statusCode: 401, signIn: origin });
    return new OverleafHttp(origin, account.cookies, () => this.store.updateCookies(account));
  }
  /** The account's projects, most recently changed first. */
  async projects(origin: unknown): Promise<OverleafProjectSummary[]> {
    const http = this.http(serverOrigin(origin));
    try {
      const list = await http.json<{ projects: { id: string; name: string; lastUpdated?: string; accessLevel?: string; archived?: boolean; trashed?: boolean; owner?: { firstName?: string; lastName?: string; email?: string } }[] }>('/api/project', { method: 'POST', body: { json: { filters: {}, page: { size: 1000 }, sort: { by: 'lastUpdated', order: 'desc' } } } });
      return list.projects.filter(item => !item.archived && !item.trashed).map(item => ({ id: item.id, name: item.name, updatedAt: item.lastUpdated ? Date.parse(item.lastUpdated) : null, owner: [item.owner?.firstName, item.owner?.lastName].filter(Boolean).join(' ') || item.owner?.email || '', access: item.accessLevel || '' }));
    } catch (error) {
      if (error instanceof SignInError) throw Object.assign(error, { statusCode: 401, signIn: http.origin });
      // Older servers list projects only here.
      const list = await http.json<{ projects: { _id: string; name: string; accessLevel?: string }[] }>('/user/projects');
      return list.projects.map(item => ({ id: item._id, name: item.name, updatedAt: null, owner: '', access: item.accessLevel || '' }));
    }
  }
  /** The project a link points to, joining it first for an invitation. */
  async resolve(value: unknown): Promise<{ origin: string; overleafId: string }> {
    const link = projectLink(value), http = this.http(link.origin);
    try {
      if (link.invite) {
        const result = await http.json<{ valid?: boolean; redirect?: unknown }>(`/project/${link.overleafId}/share/validate`, { method: 'POST', body: { json: { token: link.invite } } });
        if (!result.valid) throw new Error('This Overleaf sharing link no longer works. Ask for a new one.');
        if (result.redirect !== true) await http.json(`/project/${link.overleafId}/share`, { method: 'POST', body: { json: { token: link.invite } } });
        return { origin: link.origin, overleafId: link.overleafId! };
      }
      if (link.token) {
        const result = await http.json<{ redirect?: string; requireAccept?: unknown }>(`${link.token}/grant`, { method: 'POST', body: { json: { confirmedByUser: true, ...(link.hash ? { tokenHashPrefix: link.hash } : {}) } } });
        const id = typeof result.redirect === 'string' ? /^\/project\/([a-f0-9]{24})$/i.exec(result.redirect)?.[1] : undefined;
        if (!id) throw new Error('Overleaf did not open this link. Check that link sharing is on.');
        return { origin: link.origin, overleafId: id.toLowerCase() };
      }
      return { origin: link.origin, overleafId: link.overleafId! };
    } catch (error) {
      if (error instanceof SignInError) throw Object.assign(error, { statusCode: 401, signIn: link.origin });
      if (error instanceof AccessError) throw new Error('This Overleaf account cannot open the project. Use its sharing link, or sign in with another account.');
      throw error;
    }
  }
  private temporary(origin: string, overleafId: string, root: string) {
    const link: Link = { id: '00000000-0000-0000-0000-000000000000', projectId: null, origin, overleafId, name: '', createdAt: Date.now() };
    return new PaperSync(link, root, this.store, { changed: () => {}, busy: () => false, ignored: files => gitIgnored(root, files), status: () => {} });
  }

  // ------------------------------------------------------------------ links
  sync(projectId: string) { return this.syncs.get(projectId); }
  private available(origin: string, overleafId: string, ownLink?: string) {
    // Downloads and finalization reserve the project while running. Completed import receipts
    // may be abandoned or resumed; only attaching one claims the live sync.
    if (this.reservations.has(`${origin}/${overleafId}`) || this.store.links().some(link => link.id !== ownLink && link.projectId && link.origin === origin && link.overleafId === overleafId)) throw new Error('Another paper is already synced with this Overleaf project.');
  }
  /** What linking a paper would change, before anything changes. */
  /** Which project a paper may sync with: any other paper's is taken; with
   *  `replace`, a synced paper may move to another project. */
  private async target(projectId: string, value: unknown, replace: boolean) {
    const current = this.syncs.get(projectId);
    if (current && !replace) throw new Error('This paper is already synced with Overleaf.');
    const { origin, overleafId } = await this.resolve(value);
    if (current?.link.origin === origin && current.link.overleafId === overleafId) throw new Error('This paper already syncs with this Overleaf project.');
    this.available(origin, overleafId);
    return { origin, overleafId };
  }
  async compare(projectId: string, value: unknown, replace = false): Promise<OverleafComparison & { origin: string; overleafId: string }> {
    const { origin, overleafId } = await this.target(projectId, value, replace), project = this.papers.project(projectId);
    return { ...await this.temporary(origin, overleafId, project.path).compare(), origin, overleafId };
  }
  /** Links a paper and starts syncing it. Where both sides differ, the
   *  author chose whose version stays; the other is kept to put back. With
   *  `replace`, a synced paper stops syncing with its project first. */
  async link(projectId: string, value: unknown, choice: unknown, replace = false) {
    if (choice !== 'overleaf' && choice !== 'local') throw new Error('Choose whose version to keep.');
    const { origin, overleafId } = await this.target(projectId, value, replace);
    // Another request may have linked this paper or reserved the project
    // while the target was being resolved.
    if (this.syncs.has(projectId) && !replace) throw new Error('This paper is already synced with Overleaf.');
    this.available(origin, overleafId);
    // The new sync starts once the old one has stopped.
    if (this.syncs.has(projectId)) this.unlink(projectId);
    const link = this.store.createLink({ projectId, origin, overleafId, name: '', choice });
    this.run(link);
    return this.state();
  }
  unlink(projectId: string) {
    const sync = this.syncs.get(projectId);
    if (!sync) return this.state();
    this.syncs.delete(projectId);
    const stopped = sync.stop().finally(() => { this.store.removeLink(sync.link.id); if (this.stopping.get(projectId) === stopped) this.stopping.delete(projectId); });
    this.stopping.set(projectId, stopped);
    this.changed();
    return this.state();
  }
  /** A paper moved to another folder syncs from there. */
  moved(projectId: string) { const sync = this.syncs.get(projectId); if (sync) this.run(sync.link); }
  /** A paper removed from Papilot stops syncing; its files stay. */
  removed(projectId: string) { this.unlink(projectId); }
  retry(projectId: string) { this.syncs.get(projectId)?.retry(); return this.state(); }
  async useMine(projectId: string, conflict: string) { await this.need(projectId).useMine(conflict); return this.state(); }
  dismiss(projectId: string, conflict: string) { this.need(projectId).dismiss(conflict); return this.state(); }
  private need(projectId: string) { const sync = this.syncs.get(projectId); if (!sync) throw new Error('This paper is not synced with Overleaf.'); return sync; }

  // ---------------------------------------------------------------- imports
  /** Downloads a project into an import's empty folder and keeps the link
   *  for the paper the import becomes. */
  async download(value: unknown, root: string) {
    const { origin, overleafId } = await this.resolve(value);
    this.available(origin, overleafId);
    const link = this.store.createLink({ projectId: null, origin, overleafId, name: '' });
    const reservation = `${origin}/${overleafId}`;
    this.reservations.add(reservation);
    try {
      const sync = new PaperSync(link, root, this.store, { changed: () => {}, busy: () => false, ignored: async () => new Set(), status: () => {} });
      const settings = await sync.fetchAll();
      return { linkId: link.id, name: sync.name, ...settings };
    } catch (error) { this.store.removeLink(link.id); throw error; }
    finally { this.reservations.delete(reservation); }
  }
  /** Reserves the remote project before registering an imported paper, so
   *  a competing import cannot leave a registered paper without its sync. */
  async finishImport(linkId: string, register: () => Promise<Project>) {
    const pending = this.finishing.get(linkId);
    if (pending) return pending;
    const link = this.store.link(linkId);
    if (!link) return register();
    this.available(link.origin, link.overleafId, link.id);
    const reservation = `${link.origin}/${link.overleafId}`;
    this.reservations.add(reservation);
    const work = (async () => {
      try {
        const project = await register();
        // Releasing our reservation and attaching are synchronous, so no
        // competing request can claim the project in between.
        this.reservations.delete(reservation);
        this.attach(linkId, project.id);
        return project;
      } finally { this.reservations.delete(reservation); }
    })();
    this.finishing.set(linkId, work);
    try { return await work; } finally { this.finishing.delete(linkId); }
  }
  attach(linkId: string, projectId: string) {
    const link = this.store.link(linkId);
    if (!link) return;
    this.available(link.origin, link.overleafId, link.id);
    const current = this.syncs.get(projectId);
    if (current?.link.id === link.id) return;
    if (current || (link.projectId && link.projectId !== projectId)) throw new Error('This paper is already synced with Overleaf.');
    link.projectId = projectId;
    this.store.saveLink(link);
    this.run(link);
  }
  discard(linkId: string) { if (!this.store.link(linkId)?.projectId) this.store.removeLink(linkId); }
}
