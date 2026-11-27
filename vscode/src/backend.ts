import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Response { status: number; headers: Record<string, string>; body: string }
/** The extension owns the worker; it has no listening application server. */
export class Backend {
  private child?: ChildProcess;
  private ready?: Promise<void>;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: Response) => void; reject: (error: Error) => void }>();
  constructor(private extension: string, private data: string, private git: string, private log: (line: string) => void) {}
  start() {
    return this.ready ??= new Promise<void>((resolve, reject) => {
      const packaged = path.join(this.extension, 'runtime');
      const source = path.resolve(this.extension, '..');
      const root = fs.existsSync(path.join(source, 'src/server/runtime.ts')) ? source : packaged;
      const worker = path.join(root, 'vscode/src/worker.ts');
      const bundled = root === packaged;
      const node = bundled ? path.join(root, 'bin', process.platform === 'win32' ? 'node.exe' : 'node') : process.execPath;
      const env: NodeJS.ProcessEnv = {
        ...process.env, PAPILOT_DATA: this.data, PAPILOT_PORT: '0', PAPILOT_PUBLIC_ORIGIN: '', PAPILOT_DESKTOP: '',
        PATH: [path.dirname(this.git), ...(bundled ? [path.dirname(node)] : []), process.env.PATH || ''].join(path.delimiter),
      };
      if (bundled) delete env.ELECTRON_RUN_AS_NODE;
      else env.ELECTRON_RUN_AS_NODE = '1';
      fs.mkdirSync(this.data, { recursive: true });
      const child = this.child = fork(worker, [], {
        execPath: node,
        execArgv: ['--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href],
        env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      child.stdout?.on('data', chunk => this.log(String(chunk)));
      child.stderr?.on('data', chunk => this.log(String(chunk)));
      child.on('message', (message: any) => {
        if (message?.type === 'ready') resolve();
        if (message?.type !== 'response') return;
        const request = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) request?.reject(new Error(message.error)); else request?.resolve(message);
      });
      const fail = (error: Error) => { reject(error); for (const request of this.pending.values()) request.reject(error); this.pending.clear(); };
      child.on('error', fail);
      child.on('exit', (code, signal) => fail(new Error(`Papilot stopped (${signal || code}). Reload the window to restart it.`)));
    });
  }
  async request(route: string, body?: unknown, file?: { name: string; data: string }): Promise<Response> {
    await this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.send({ type: 'request', id, route, method: body === undefined && !file ? 'GET' : 'POST',
        headers: { 'content-type': file ? 'application/octet-stream' : 'application/json', ...(file ? { 'x-papilot-filename': encodeURIComponent(file.name) } : {}) },
        body: file?.data ?? (body === undefined ? undefined : Buffer.from(JSON.stringify(body)).toString('base64')) }, error => {
        if (error) { this.pending.delete(id); reject(error); }
      });
    });
  }
  async api<T = any>(route: string, body?: unknown): Promise<T> {
    const response = await this.request(route, body), value = JSON.parse(Buffer.from(response.body, 'base64').toString());
    if (response.status >= 400) throw new Error(value.error || `Papilot request failed (${response.status}).`);
    return value;
  }
  dispose() { if (this.child?.connected) this.child.disconnect(); }
}
