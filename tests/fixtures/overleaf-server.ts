import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { applyHistory, applyText, trackedText, transformHistoryX, transformTextX, visibleText, type RawEditOperation, type TextOp, type TrackedText } from '../../src/server/overleaf/ot.ts';
import { blobHash } from '../../src/server/overleaf/files.ts';

// A small Overleaf for tests: the pages, endpoints and socket.io 0.9 events
// Papilot uses, with the document updater's transforms, and a coauthor who
// edits through the same path an Overleaf editor would.

type Type = 'sharejs-text-ot' | 'history-ot';
interface Doc { kind: 'doc'; id: string; name: string; type: Type; text: string | TrackedText; version: number; ops: { op: unknown[]; v: number; source: string }[] }
interface File { kind: 'file'; id: string; name: string; data: Buffer; hash: string }
interface Folder { kind: 'folder'; id: string; name: string; children: (Doc | File | Folder)[] }
interface Client { socket: WebSocket; publicId: string }

const objectId = () => randomBytes(12).toString('hex');
const encodeLine = (line: string) => Buffer.from(line, 'utf8').toString('latin1');

export class FakeOverleaf {
  // A request Papilot aborts, as it does when its connection closes, just ends.
  server = http.createServer((request, response) => void this.handle(request, response).catch(() => response.destroy()));
  sockets = new WebSocketServer({ noServer: true });
  origin = '';
  projectId = objectId();
  root: Folder = { kind: 'folder', id: objectId(), name: 'rootFolder', children: [] };
  clients = new Set<Client>();
  session = 'session-' + objectId();
  csrf = 'csrf-' + objectId();
  userId = objectId();
  /** A coauthor, a member of the project, whose edits `edit` makes. */
  coauthor = { _id: objectId(), first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' };
  /** Connections other than Papilot's with the project open, and where
   *  their cursors are. */
  visitors = new Map<string, { user: { _id: string; first_name: string; last_name: string; email: string }; doc?: string; row?: number; column?: number }>();
  permissions: 'owner' | 'readOnly' = 'owner';
  /** The token of the project's sharing link, and whether the author joined. */
  invite = 'invite-' + objectId();
  member = true;
  /** Every change Papilot asked for, as method and path. */
  requests: string[] = [];
  /** Track changes for everyone, the project's main document and compiler,
   *  and the track-changes seeds edits arrived with. */
  trackChanges: boolean | Record<string, boolean> = false;
  rootDoc = '';
  compiler = 'pdflatex';
  seeds: (string | undefined)[] = [];
  /** Runs before each HTTP request is answered. */
  before?: (method: string, path: string) => Promise<void> | void;
  /** The next edit is received but lost, or applied only once its resend
   *  arrives (a lagging document updater); uploads of these names fail. */
  dropUpdate = false;
  deferUpdate = false;
  deferred: [Doc, { op: unknown[]; v: number }, string] | null = null;
  failUpload = new Set<string>();
  /** How many WebSocket upgrades to refuse with a 502. */
  failUpgrades = 0;
  /** Hold back acknowledgements to simulate a slow server. */
  hold = false;
  private held: (() => void)[] = [];

  async start() {
    this.server.on('upgrade', (request, socket, head) => {
      // Overleaf's load balancer now and then refuses an upgrade outright.
      if (this.failUpgrades > 0) { this.failUpgrades--; socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return; }
      this.sockets.handleUpgrade(request, socket, head, ws => {
        // Like overleaf.com, an expired session connects and is then rejected.
        if (!this.authorized(request)) { ws.send('1::'); ws.send(`5:::${JSON.stringify({ name: 'connectionRejected', args: [{ message: 'invalid session' }] })}`); ws.send('0::'); ws.close(); return; }
        this.connect(ws);
      });
    });
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    this.origin = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
    return this;
  }
  async stop() {
    for (const client of this.clients) client.socket.terminate();
    this.sockets.close();
    await new Promise(resolve => this.server.close(resolve));
  }
  disconnectAll() { for (const client of this.clients) client.socket.terminate(); }
  /** Overleaf keeps recent updates only for a while. */
  forgetUpdates() { const walk = (folder: Folder) => { for (const entity of folder.children) { if (entity.kind === 'doc') entity.ops = []; if (entity.kind === 'folder') walk(entity); } }; walk(this.root); }
  release() { this.hold = false; for (const send of this.held.splice(0)) send(); }

  // ------------------------------------------------------------ the project
  private find(predicate: (entity: Doc | File | Folder, path: string) => boolean, folder = this.root, prefix = ''): { entity: Doc | File | Folder; parent: Folder; path: string } | null {
    for (const entity of folder.children) {
      const path = prefix ? `${prefix}/${entity.name}` : entity.name;
      if (predicate(entity, path)) return { entity, parent: folder, path };
      if (entity.kind === 'folder') { const found = this.find(predicate, entity, path); if (found) return found; }
    }
    return null;
  }
  byId(id: string) { return id === this.root.id ? { entity: this.root, parent: this.root, path: '' } : this.find(entity => entity.id === id); }
  byPath(path: string) { return this.find((_, value) => value === path); }
  private folder(path: string, emit = true): Folder {
    if (!path || path === '.') return this.root;
    const found = this.byPath(path);
    if (found?.entity.kind === 'folder') return found.entity;
    const parent = this.folder(path.split('/').slice(0, -1).join('/'), emit);
    const created: Folder = { kind: 'folder', id: objectId(), name: path.split('/').pop()!, children: [] };
    parent.children.push(created);
    if (emit) this.broadcast('reciveNewFolder', [parent.id, { _id: created.id, name: created.name, docs: [], fileRefs: [], folders: [] }]);
    return created;
  }
  text(path: string) {
    const found = this.byPath(path);
    if (!found) return undefined;
    if (found.entity.kind === 'file') return found.entity.data.toString('utf8');
    if (found.entity.kind !== 'doc') return undefined;
    return found.entity.type === 'history-ot' ? visibleText(found.entity.text as TrackedText) : found.entity.text as string;
  }
  paths(): string[] {
    const out: string[] = [];
    const walk = (folder: Folder, prefix: string) => { for (const entity of folder.children) { const path = prefix ? `${prefix}/${entity.name}` : entity.name; if (entity.kind === 'folder') walk(entity, path); else out.push(path); } };
    walk(this.root, '');
    return out.sort();
  }
  addDoc(path: string, text: string, type: Type = 'sharejs-text-ot', trackedDeletes: { pos: number; length: number }[] = []) {
    const parent = this.folder(path.split('/').slice(0, -1).join('/'));
    const doc: Doc = { kind: 'doc', id: objectId(), name: path.split('/').pop()!, type, version: 1, ops: [], text: type === 'history-ot' ? trackedText({ content: text, trackedChanges: trackedDeletes.map(range => ({ range, tracking: { type: 'delete' as const } })) }) : text };
    parent.children.push(doc);
    this.broadcast('reciveNewDoc', [parent.id, { _id: doc.id, name: doc.name }, 'editor', this.userId]);
    return doc;
  }
  addFile(path: string, data: Buffer) {
    const existing = this.byPath(path);
    if (existing) { existing.parent.children.splice(existing.parent.children.indexOf(existing.entity), 1); this.broadcast('removeEntity', [existing.entity.id, 'replace']); }
    const parent = this.folder(path.split('/').slice(0, -1).join('/'));
    const file: File = { kind: 'file', id: objectId(), name: path.split('/').pop()!, data, hash: blobHash(data) };
    parent.children.push(file);
    this.broadcast('reciveNewFile', [parent.id, { _id: file.id, name: file.name, hash: file.hash }, 'upload', null, this.userId]);
    return file;
  }
  rename(path: string, name: string) { const found = this.byPath(path)!; found.entity.name = name; this.broadcast('reciveEntityRename', [found.entity.id, name]); }
  move(path: string, folder: string) {
    const found = this.byPath(path)!, target = this.folder(folder);
    found.parent.children.splice(found.parent.children.indexOf(found.entity), 1); target.children.push(found.entity);
    this.broadcast('reciveEntityMove', [found.entity.id, target.id]);
  }
  remove(path: string) { const found = this.byPath(path)!; found.parent.children.splice(found.parent.children.indexOf(found.entity), 1); this.broadcast('removeEntity', [found.entity.id, 'editor']); }
  /** A coauthor's edit, made against the document's current version. */
  edit(path: string, before: (text: string) => unknown[], user = this.coauthor._id) {
    const doc = this.byPath(path)!.entity as Doc;
    const op = before(doc.type === 'history-ot' ? visibleText(doc.text as TrackedText) : doc.text as string);
    this.apply(doc, { op, v: doc.version }, 'P.coauthor', user);
  }
  /** Someone opens the project, or moves their cursor to a line of a file. */
  visit(client: string, path?: string, row?: number, column?: number, user = this.coauthor) {
    const doc = path ? (this.byPath(path)?.entity as Doc).id : undefined;
    this.visitors.set(client, { user, doc, row, column });
    this.broadcast('clientTracking.clientUpdated', [{ id: client, user_id: user._id, name: `${user.first_name} ${user.last_name}`.trim(), email: user.email, ...(doc ? { doc_id: doc, row, column } : {}) }]);
  }
  leave(client: string) { this.visitors.delete(client); this.broadcast('clientTracking.clientDisconnected', [client]); }
  private apply(doc: Doc, update: { op: unknown[]; v: number; dupIfSource?: string[] }, source: string, user = this.userId) {
    let op = update.op;
    for (const past of doc.ops.filter(item => item.v >= update.v)) {
      if (update.dupIfSource?.includes(past.source)) return { dup: true, v: past.v };
      op = doc.type === 'history-ot'
        ? (() => { const left = [...op] as RawEditOperation[], right = [...past.op] as RawEditOperation[]; for (let i = 0; i < left.length; i++) for (let j = 0; j < right.length; j++) [left[i], right[j]] = transformHistoryX(left[i], right[j]); return left; })()
        : transformTextX(op as TextOp, past.op as TextOp)[0];
    }
    if (doc.type === 'history-ot') doc.text = (op as RawEditOperation[]).reduce((text, item) => applyHistory(text, item), doc.text as TrackedText);
    else doc.text = applyText(doc.text as string, op = (op as TextOp).map(c => 'i' in c ? { ...c, i: c.i.replace(/[\uD800-\uDFFF]/g, '\uFFFD') } : c));
    const v = doc.version++;
    doc.ops.push({ op, v, source });
    for (const client of this.clients) {
      if (client.publicId === source) this.send(client, 'otUpdateApplied', [{ v, doc: doc.id }]);
      else this.send(client, 'otUpdateApplied', [{ doc: doc.id, op, v, meta: { source, user_id: user, ts: Date.now() } }]);
    }
    return { dup: false, v };
  }
  private tree(folder: Folder): unknown {
    return { _id: folder.id, name: folder.name, folders: folder.children.filter(e => e.kind === 'folder').map(e => this.tree(e as Folder)),
      docs: folder.children.filter(e => e.kind === 'doc').map(e => ({ _id: e.id, name: e.name })),
      fileRefs: folder.children.filter(e => e.kind === 'file').map(e => ({ _id: e.id, name: e.name, hash: (e as File).hash })) };
  }

  // ------------------------------------------------------------- real time
  private send(client: Client, name: string, args: unknown[]) {
    const deliver = () => { if (client.socket.readyState === 1) client.socket.send(`5:::${JSON.stringify({ name, args })}`); };
    if (this.hold && name === 'otUpdateApplied') this.held.push(deliver); else deliver();
  }
  broadcast(name: string, args: unknown[]) { for (const client of this.clients) this.send(client, name, args); }
  private connect(socket: WebSocket) {
    const client: Client = { socket, publicId: 'P.' + objectId() };
    this.clients.add(client);
    socket.on('close', () => this.clients.delete(client));
    socket.send('1::');
    this.send(client, 'joinProjectResponse', [{ publicId: client.publicId, project: { _id: this.projectId, name: 'Fake paper', rootFolder: [this.tree(this.root)], compiler: this.compiler, trackChangesState: this.trackChanges, owner: { _id: this.userId, first_name: 'Author', last_name: '', email: 'author@example.com' }, members: [this.coauthor], ...(this.rootDoc ? { rootDoc_id: (this.byPath(this.rootDoc)?.entity as Doc).id } : {}) }, permissionsLevel: this.permissions, protocolVersion: 2 }]);
    socket.on('message', raw => {
      const frame = /^(\d):(\d*)(\+?):([^:]*):?([\s\S]*)$/.exec(raw.toString());
      if (!frame || frame[1] !== '5') return;
      const ackId = frame[2], { name, args } = JSON.parse(frame[5]) as { name: string; args: unknown[] };
      const ack = (...values: unknown[]) => { if (ackId) socket.send(`6:::${ackId}+${JSON.stringify(values)}`); };
      if (name === 'joinDoc') {
        const [id, fromVersion] = args as [string, number];
        const doc = this.byId(id)?.entity as Doc | undefined;
        if (!doc || doc.kind !== 'doc') { ack({ message: 'not found' }); return; }
        const updates = fromVersion >= 0 ? doc.ops.filter(item => item.v >= fromVersion).map(item => ({ doc: doc.id, op: item.op, v: item.v, meta: { source: item.source } })) : [];
        if (fromVersion >= 0 && fromVersion < doc.version && !doc.ops.some(item => item.v === fromVersion)) { ack({ message: 'doc updater could not load requested ops' }); return; }
        const lines = doc.type === 'history-ot'
          ? { content: (doc.text as TrackedText).content, trackedChanges: this.ranges(doc.text as TrackedText) }
          : (doc.text as string).split('\n').map(encodeLine);
        ack(null, lines, doc.version, updates, {}, doc.type, { canSkipLeaveDoc: true });
      } else if (name === 'applyOtUpdate') {
        if (this.permissions === 'readOnly') { ack({ message: 'not authorized' }); return; }
        const [id, update] = args as [string, { op: unknown[]; v: number; dupIfSource?: string[]; meta?: { tc?: string } }];
        this.seeds.push(update.meta?.tc);
        const doc = this.byId(id)?.entity as Doc;
        ack(null);
        if (this.dropUpdate) { this.dropUpdate = false; return; }
        if (this.deferUpdate) { this.deferUpdate = false; this.deferred = [doc, update, client.publicId]; return; }
        if (this.deferred && update.dupIfSource) { const [late, edit, source] = this.deferred; this.deferred = null; this.apply(late, edit, source); }
        const result = this.apply(doc, update, client.publicId);
        if (result.dup) this.send(client, 'otUpdateApplied', [{ v: result.v, doc: doc.id }]);
      } else if (name === 'clientTracking.getConnectedUsers') {
        ack(null, [
          ...[...this.clients].filter(other => other !== client).map(other => ({ client_id: other.publicId, user_id: this.userId, first_name: 'Author', last_name: '', email: 'author@example.com' })),
          ...[...this.visitors].map(([id, visitor]) => ({ client_id: id, user_id: visitor.user._id, first_name: visitor.user.first_name, last_name: visitor.user.last_name, email: visitor.user.email, ...(visitor.doc ? { cursorData: { doc_id: visitor.doc, row: visitor.row, column: visitor.column } } : {}) })),
        ]);
      } else ack(null);
    });
  }
  private ranges(text: TrackedText) {
    const out: { range: { pos: number; length: number }; tracking: { type: 'delete'; userId: string; ts: string } }[] = [];
    let start = -1;
    for (let i = 0; i <= text.content.length; i++) {
      const hidden = i < text.content.length && text.deleted[i];
      if (hidden && start < 0) start = i;
      else if (!hidden && start >= 0) { out.push({ range: { pos: start, length: i - start }, tracking: { type: 'delete', userId: this.userId, ts: new Date().toISOString() } }); start = -1; }
    }
    return out;
  }

  // ----------------------------------------------------------------- HTTP
  private authorized(request: http.IncomingMessage) { return (request.headers.cookie || '').includes(`overleaf_session2=${this.session}`); }
  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const url = new URL(request.url!, this.origin), method = request.method!;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    await this.before?.(method, url.pathname);
    const send = (status: number, value: unknown, type = 'application/json') => { response.writeHead(status, { 'Content-Type': type }); response.end(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
    if (method === 'GET' && url.pathname === '/socket.io/1/') { response.writeHead(200, { 'Set-Cookie': 'GCLB=affinity; Path=/' }); response.end(`sid${objectId()}:60:60:websocket,xhr-polling`); return; }
    if (!this.authorized(request)) { response.writeHead(302, { Location: '/login' }); response.end(); return; }
    const page = (metas: Record<string, string>) => send(200, `<!doctype html><html><head>${Object.entries(metas).map(([name, content]) => `<meta name="ol-${name}" content="${content}">`).join('')}</head></html>`, 'text/html');
    if (method === 'GET' && url.pathname === '/project') return page({ csrfToken: this.csrf, user_id: this.userId, usersEmail: 'author@example.com' });
    if (method === 'GET' && url.pathname === `/project/${this.projectId}`) return this.member ? page({ csrfToken: this.csrf, project_id: this.projectId, user_id: this.userId }) : (response.writeHead(302, { Location: '/restricted' }), response.end());
    const file = new RegExp(`^/project/${this.projectId}/file/([a-f0-9]{24})$`, 'i').exec(url.pathname);
    if (method === 'GET' && file) { const found = this.byId(file[1]); return found?.entity.kind === 'file' ? send(200, found.entity.data, 'application/octet-stream') : send(404, 'Not found', 'text/plain'); }
    if (method === 'POST' && url.pathname === '/api/project') return send(200, { totalSize: 1, projects: [{ id: this.projectId, name: 'Fake paper', lastUpdated: new Date().toISOString(), accessLevel: 'owner', archived: false, trashed: false, owner: { firstName: 'Author', lastName: '' } }] });
    if (method !== 'GET' && request.headers['x-csrf-token'] !== this.csrf) return send(403, 'Invalid CSRF token', 'text/plain');
    this.requests.push(`${method} ${url.pathname.replace(this.projectId, ':project')}`);
    const json = () => JSON.parse(body.toString('utf8') || '{}');
    if (method === 'POST' && url.pathname === `/project/${this.projectId}/share/validate`) return send(200, json().token !== this.invite ? { valid: false } : this.member ? { valid: true, redirect: true } : { valid: true, projectName: 'Fake paper' });
    if (method === 'POST' && url.pathname === `/project/${this.projectId}/share`) { if (json().token !== this.invite) return send(404, 'Not found', 'text/plain'); this.member = true; response.writeHead(204); response.end(); return; }
    if (method === 'POST' && url.pathname === '/logout') { this.session = 'session-' + objectId(); response.writeHead(302, { Location: '/login' }); response.end(); return; }
    if (method === 'POST' && url.pathname.toLowerCase() === `/project/${this.projectId}/upload`) {
      const parts = this.multipart(request.headers['content-type']!, body), name = parts.get('name')!.toString('utf8'), data = parts.get('qqfile')!;
      if (this.failUpload.has(name)) return send(500, 'Internal error', 'text/plain');
      const folder = this.byId(url.searchParams.get('folder_id') || this.root.id)!.entity as Folder;
      const existing = folder.children.find(entity => entity.name === name);
      const textual = /\.(?:tex|bib|cls|sty|bst|txt|md)$/i.test(name) && !existing?.kind.startsWith('file');
      if (existing && existing.kind === 'doc' && textual) { existing.text = data.toString('utf8').replace(/\r/g, ''); return send(200, { success: true, entity_id: existing.id, entity_type: 'doc' }); }
      if (existing) { folder.children.splice(folder.children.indexOf(existing), 1); this.broadcast('removeEntity', [existing.id, 'replace']); }
      if (textual) {
        const doc: Doc = { kind: 'doc', id: objectId(), name, type: 'sharejs-text-ot', text: data.toString('utf8').replace(/\r/g, ''), version: 1, ops: [] };
        folder.children.push(doc); this.broadcast('reciveNewDoc', [folder.id, { _id: doc.id, name }, 'upload', this.userId]);
        return send(200, { success: true, entity_id: doc.id, entity_type: 'doc' });
      }
      const created: File = { kind: 'file', id: objectId(), name, data, hash: blobHash(data) };
      folder.children.push(created); this.broadcast('reciveNewFile', [folder.id, { _id: created.id, name, hash: created.hash }, 'upload', null, this.userId]);
      return send(200, { success: true, entity_id: created.id, entity_type: 'file', hash: created.hash });
    }
    if (method === 'POST' && url.pathname === `/project/${this.projectId}/folder`) {
      const { name, parent_folder_id: parentId } = json(), parent = this.byId(parentId)!.entity as Folder;
      const created: Folder = { kind: 'folder', id: objectId(), name, children: [] };
      parent.children.push(created); this.broadcast('reciveNewFolder', [parent.id, { _id: created.id, name, docs: [], fileRefs: [], folders: [] }]);
      return send(200, { _id: created.id, name, docs: [], fileRefs: [], folders: [] });
    }
    const entity = new RegExp(`^/project/${this.projectId}/(doc|file|folder)/([a-f0-9]{24})(?:/(rename|move))?$`).exec(url.pathname);
    if (entity) {
      const found = this.byId(entity[2]);
      if (!found) return send(404, 'Not found', 'text/plain');
      if (method === 'DELETE') { found.parent.children.splice(found.parent.children.indexOf(found.entity), 1); this.broadcast('removeEntity', [found.entity.id, 'editor']); response.writeHead(204); response.end(); return; }
      if (entity[3] === 'rename') { found.entity.name = json().name; this.broadcast('reciveEntityRename', [found.entity.id, found.entity.name]); response.writeHead(204); response.end(); return; }
      if (entity[3] === 'move') { const target = this.byId(json().folder_id)!.entity as Folder; found.parent.children.splice(found.parent.children.indexOf(found.entity), 1); target.children.push(found.entity); this.broadcast('reciveEntityMove', [found.entity.id, target.id]); response.writeHead(204); response.end(); return; }
    }
    send(404, 'Not found', 'text/plain');
  }
  private multipart(type: string, body: Buffer) {
    const boundary = '--' + /boundary=(.+)$/.exec(type)![1], parts = new Map<string, Buffer>();
    let at = body.indexOf(boundary);
    while (at >= 0) {
      const next = body.indexOf(boundary, at + boundary.length);
      if (next < 0) break;
      const part = body.subarray(at + boundary.length + 2, next - 2), split = part.indexOf('\r\n\r\n');
      const name = /name="([^"]+)"/.exec(part.subarray(0, split).toString('utf8'))?.[1];
      if (name) parts.set(name, part.subarray(split + 4));
      at = next;
    }
    return parts;
  }
}
