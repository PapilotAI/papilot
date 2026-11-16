import { Worker } from 'node:worker_threads';
import { Client, connect } from './client.ts';

/** Review engines owned by an embedding host. Each thread runs the same
 * server as the CLI, including its repository lock and recovery. */
export class OwnedEngines {
  private workers = new Map<Worker, Promise<void>>();
  private closing = false;
  connect = (root: string, reuse = false): Promise<Client> => {
    if (this.closing) return Promise.reject(new Error('Papilot is stopping.'));
    return (async () => (reuse && await connect(root, false)) || connect(root, true, { launch: this.launch }))();
  };
  private launch = (root: string, port: number): Promise<Client> => new Promise((resolve, reject) => {
    if (this.closing) { reject(new Error('Papilot is stopping.')); return; }
    const worker = new Worker(new URL('./owned-engine-worker.mjs', import.meta.url), { workerData: { root, port }, execArgv: [] });
    const exited = new Promise<void>(done => worker.once('exit', () => { this.workers.delete(worker); done(); }));
    this.workers.set(worker, exited);
    let ready = false;
    worker.once('message', (value: { url: string; token: string }) => { ready = true; resolve(new Client(value.url, value.token)); });
    worker.on('error', reject);
    worker.once('exit', code => { if (!ready) reject(new Error(`The review engine stopped before starting (${code}).`)); });
  });
  async close() {
    this.closing = true;
    const workers = [...this.workers];
    for (const [worker] of workers) worker.postMessage('stop');
    await Promise.all(workers.map(([, exited]) => exited));
  }
}
