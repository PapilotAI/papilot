import { Worker } from 'node:worker_threads';

export class RuntimeClient {
  readonly ready: Promise<string>;
  private worker: Worker;
  private next = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private closing?: Promise<void>;
  private exited = false;
  constructor(script: string, root: string, data: string, bridge: string, log: (text: string) => void, connectAgents = true) {
    this.worker = new Worker(script, { workerData: { root, bridge, connectAgents }, execArgv: [], stdout: true, stderr: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PAPILOT_DATA: data, PAPILOT_REVIEW_ENGINE: `${root}/engine`, PAPILOT_DESKTOP: '0', PAPILOT_PUBLIC_ORIGIN: '', PAPILOT_TAILSCALE_LOGIN: '', PAPILOT_TEX_POOL: `${data}/tex-pool` } });
    this.worker.stdout.on('data', chunk => log(String(chunk)));
    this.worker.stderr.on('data', chunk => log(String(chunk)));
    this.ready = new Promise((resolve, reject) => {
      const failed = (error: Error) => { reject(error); for (const request of this.pending.values()) request.reject(error); this.pending.clear(); };
      this.worker.on('message', message => {
        if (message.type === 'ready') resolve(message.url);
        else if (message.type === 'failed') failed(new Error(message.error));
        else {
          const request = this.pending.get(message.id);
          if (!request) return;
          this.pending.delete(message.id);
          if (message.error) request.reject(new Error(message.error)); else request.resolve(message.value);
        }
      });
      this.worker.on('error', failed);
      this.worker.once('exit', code => { this.exited = true; failed(new Error(`Papilot stopped (${code}).`)); });
    });
  }
  async call<T>(message: Record<string, unknown>): Promise<T> {
    await this.ready;
    if (this.exited) throw new Error('Papilot has stopped. Reload the window to restart it.');
    if (this.closing) throw new Error('Papilot is stopping.');
    const id = ++this.next;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ ...message, id }); });
  }
  request<T>(route: string, body?: unknown) { return this.call<T>({ type: 'request', route: '/api' + route, body }); }
  close() {
    if (this.exited) return Promise.resolve();
    return this.closing ??= new Promise<void>(resolve => {
      this.worker.once('exit', () => { clearTimeout(timer); resolve(); });
      const timer = setTimeout(() => void this.worker.terminate(), 10000);
      this.worker.postMessage({ type: 'stop' });
    });
  }
}
