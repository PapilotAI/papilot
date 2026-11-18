import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { cookieHeader, sameSite, SignInError, AccessError, ConnectionError, type OverleafHttp } from './http.ts';

// Overleaf's real-time service speaks socket.io 0.9: a handshake over HTTP
// names a session, and a WebSocket then carries frames of the form
// type:id:endpoint:data. Events are type 5, their acknowledgements type 6,
// and heartbeats (type 2) are echoed back.

export interface ProjectJoin { publicId: string; project: OverleafProject; permissionsLevel: 'owner' | 'readAndWrite' | 'review' | 'readOnly'; protocolVersion?: number }
export interface OverleafFolder { _id: string; name: string; folders: OverleafFolder[]; docs: { _id: string; name: string }[]; fileRefs: { _id: string; name: string; hash?: string; linkedFileData?: unknown }[] }
export interface OverleafUser { _id: string; first_name?: string; last_name?: string; email?: string }
export interface OverleafProject { _id: string; name: string; rootDoc_id?: string; compiler?: string; rootFolder: OverleafFolder[]; owner?: OverleafUser; members?: OverleafUser[]; trackChangesState?: boolean | Record<string, boolean> }

export class OverleafSocket extends EventEmitter {
  private socket: WebSocket | null = null;
  private acks = new Map<number, { resolve: (args: unknown[]) => void; reject: (error: Error) => void }>();
  private nextAck = 1;
  private quiet: NodeJS.Timeout | undefined;
  private ended = false;
  publicId = '';
  /** Settles once the connection is closed, however that happened. */
  readonly done: Promise<Error>;
  private finished!: (error: Error) => void;
  constructor(private http: OverleafHttp, private projectId: string, private wsUrl = '/socket.io') {
    super();
    this.done = new Promise(resolve => { this.finished = resolve; });
  }
  get closed() { return this.ended; }

  /** Connects and resolves with the project once the server has joined it. */
  async connect(): Promise<ProjectJoin> {
    const base = new URL(this.wsUrl, this.http.origin);
    if (!sameSite(this.http.origin, base.href)) throw new Error('Overleaf named a real-time server outside its site.');
    // Overleaf's load balancer now and then answers a WebSocket upgrade with
    // a 502 at once; a fresh handshake then gets through.
    for (let attempt = 1; ; attempt++) {
      const opened = await this.open(base).catch((error: Error & { upgrade?: number }) => {
        if (error.upgrade && error.upgrade >= 500 && attempt < 4) return null;
        throw error;
      });
      if (opened) return this.attach(opened.socket, opened.timeout, opened.early);
    }
  }
  private async open(base: URL) {
    const path = base.pathname.replace(/\/$/, ''), query = new URLSearchParams({ projectId: this.projectId });
    // The handshake also sets the load balancer's cookie that keeps the
    // WebSocket on the server holding this session.
    const handshake = await this.http.request(new URL(`${path}/1/?${query}&t=${Date.now()}`, base.origin).href, { accept: '*/*' });
    if (handshake.status === 401 || handshake.status === 403) throw new SignInError('Sign in to Overleaf again.');
    if (handshake.status !== 200) throw new ConnectionError('Could not reach Overleaf. Papilot keeps trying.');
    const [sid, heartbeat, , transports] = handshake.data.toString('utf8').split(':');
    if (!sid || !transports?.split(',').includes('websocket')) throw new ConnectionError('Overleaf did not offer a real-time connection.');
    const target = new URL(`${path}/1/websocket/${sid}?${query}`, base.origin.replace(/^http/, 'ws'));
    const timeout = Math.max(Number(heartbeat) || 60, 10) * 1000;
    // socket.io 0.9 predates compressed frames, and Overleaf's front end
    // drops connections that offer them.
    const socket = new WebSocket(target, { headers: { Cookie: cookieHeader(this.http.cookies), Origin: this.http.origin, 'User-Agent': 'Papilot' }, agent: this.http.agent(target), perMessageDeflate: false });
    return new Promise<{ socket: WebSocket; timeout: number; early: string[] }>((resolve, reject) => {
      socket.once('upgrade', response => this.http.absorb(response.headers['set-cookie']));
      // Like Overleaf's own client, give the server 30 seconds to say it is
      // connected (frame 1::); a silent socket is replaced.
      let quiet: NodeJS.Timeout | undefined;
      socket.once('open', () => { quiet = setTimeout(() => { socket.terminate(); reject(Object.assign(new ConnectionError('Could not reach Overleaf. Papilot keeps trying.'), { upgrade: 504 })); }, 30_000); });
      // Frames after the first wait for attach(), which replays them.
      const early: string[] = [];
      socket.on('message', raw => {
        if (early.length || quiet === undefined) { early.push(raw.toString()); return; }
        clearTimeout(quiet); quiet = undefined;
        if (!raw.toString().startsWith('1:')) { socket.terminate(); reject(new ConnectionError('Overleaf refused the connection. Papilot tries again shortly.')); return; }
        early.push('');
        for (const event of ['error', 'close', 'unexpected-response']) socket.removeAllListeners(event);
        resolve({ socket, timeout, early });
      });
      socket.once('unexpected-response', (_request, response) => {
        socket.terminate();
        reject(response.statusCode === 401 || response.statusCode === 403 ? new SignInError('Sign in to Overleaf again.') : Object.assign(new ConnectionError('Could not reach Overleaf. Papilot keeps trying.'), { upgrade: response.statusCode ?? 0 }));
      });
      socket.on('error', () => { clearTimeout(quiet); reject(new ConnectionError('Could not reach Overleaf. Papilot keeps trying.')); });
      socket.once('close', () => { clearTimeout(quiet); reject(Object.assign(new ConnectionError('Could not reach Overleaf. Papilot keeps trying.'), { upgrade: 502 })); });
    });
  }
  private attach(socket: WebSocket, timeout: number, early: string[]): Promise<ProjectJoin> {
    if (this.ended) { socket.terminate(); return Promise.reject(new ConnectionError('The connection to Overleaf closed.')); }
    this.socket = socket;
    return new Promise<ProjectJoin>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => { if (!settled) { settled = true; reject(error); } this.close(error); };
      // No frame at all for a heartbeat timeout means the connection is gone.
      const alive = () => { clearTimeout(this.quiet); this.quiet = setTimeout(() => fail(new ConnectionError('The connection to Overleaf stopped responding.')), timeout); };
      alive();
      socket.on('error', () => fail(new ConnectionError('Could not reach Overleaf. Papilot keeps trying.')));
      socket.on('close', () => fail(new ConnectionError('The connection to Overleaf closed.')));
      const receive = (raw: string) => {
        alive();
        const frame = /^(\d):(\d*)(\+?):([^:]*):?([\s\S]*)$/.exec(raw);
        if (!frame) return;
        const [, type, , , , data] = frame;
        if (type === '2') socket.send('2::');
        else if (type === '0') fail(new ConnectionError('Overleaf closed the connection.'));
        else if (type === '7') fail(new ConnectionError('Overleaf refused the connection.'));
        else if (type === '6') {
          const ack = /^(\d+)\+?([\s\S]*)$/.exec(data);
          const pending = ack && this.acks.get(Number(ack[1]));
          if (ack && pending) { this.acks.delete(Number(ack[1])); let args: unknown[] = []; try { args = ack[2] ? JSON.parse(ack[2]) : []; } catch { /* Empty. */ } pending.resolve(args); }
        } else if (type === '5') {
          let event: { name: string; args?: unknown[] };
          try { event = JSON.parse(data); } catch { return; }
          const args = event.args || [];
          if (event.name === 'joinProjectResponse' && !settled) {
            const join = args[0] as ProjectJoin;
            this.publicId = join.publicId; settled = true; resolve(join);
          } else if (event.name === 'connectionRejected') {
            const message = (args[0] as { message?: string } | undefined)?.message || '';
            fail(/not authorized|invalid session|restricted/i.test(message) ? (/session/i.test(message) ? new SignInError('Sign in to Overleaf again.') : new AccessError('This Overleaf account cannot open the project.')) : new ConnectionError(message === 'retry' ? 'Could not reach Overleaf. Papilot keeps trying.' : 'Overleaf refused the connection. Papilot tries again shortly.'));
          } else if (event.name === 'forceDisconnect' || event.name === 'reconnectGracefully') fail(new ConnectionError('Overleaf asked Papilot to reconnect.'));
          else if (event.name === 'serverPing') this.send('clientPong', [...args.slice(0, 4), 'websocket', '']);
          else this.emit('event', event.name, args);
        }
      };
      socket.removeAllListeners('message');
      socket.on('message', raw => receive(raw.toString()));
      for (const raw of early.splice(0)) if (raw) receive(raw);
    });
  }
  private send(name: string, args: unknown[], ack?: number) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new ConnectionError('The connection to Overleaf closed.');
    this.socket.send(`5:${ack ?? ''}${ack ? '+' : ''}::${JSON.stringify({ name, args })}`);
  }
  /** Sends an event and resolves with the arguments of its acknowledgement;
   *  an error the server reports there rejects. */
  call(name: string, ...args: unknown[]): Promise<unknown[]> {
    if (this.ended) return Promise.reject(new ConnectionError('The connection to Overleaf closed.'));
    const id = this.nextAck++;
    return new Promise<unknown[]>((resolve, reject) => {
      this.acks.set(id, { resolve: values => { const error = values[0] as { message?: string } | null; if (error) reject(Object.assign(new Error(error.message || 'Overleaf refused the change.'), { remote: true })); else resolve(values.slice(1)); }, reject });
      try { this.send(name, args, id); } catch (error) { this.acks.delete(id); reject(error); }
    });
  }
  close(error: Error = new ConnectionError('The connection to Overleaf closed.')) {
    if (this.ended) return;
    this.ended = true;
    this.finished(error);
    clearTimeout(this.quiet);
    for (const pending of this.acks.values()) pending.reject(error);
    this.acks.clear();
    try { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send('0::'); } catch { /* Closing anyway. */ }
    this.socket?.terminate();
    this.emit('close', error);
  }
}
