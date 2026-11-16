import { Worker, isMainThread } from 'node:worker_threads';
import { Cancelled, ProcessError, runAsync } from './process.ts';

/** Run a bundled script. An embedding host's executable may be an editor,
 * rather than node, so hosts running in a worker use another worker. */
export function runNodeScript(script: string, args: string[], options: Parameters<typeof runAsync>[2] = {}): Promise<Buffer> {
  if (isMainThread) return runAsync(process.execPath, ['--import', 'tsx', script, ...args], options);
  if (options.signal?.aborted) return Promise.reject(new Cancelled());
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./node-script-worker.mjs', import.meta.url), {
      workerData: { script, args }, execArgv: [], stdout: true, stderr: true, env: options.env,
    });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let failure: Error | undefined;
    const stop = (error: Error) => { failure ??= error; void worker.terminate(); };
    const cancel = () => stop(new Cancelled());
    const timer = setTimeout(() => stop(new Error('The script timed out.')), options.timeout ?? 300000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    worker.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk); options.output?.(chunk); });
    worker.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    worker.on('error', error => { failure ??= error; });
    worker.once('exit', code => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
      if (failure) reject(failure);
      else if (code) reject(new ProcessError(Buffer.concat(stderr).toString() || `Script failed (${code}).`, Buffer.concat(stdout), Buffer.concat(stderr), code));
      else resolve(Buffer.concat(stdout));
    });
  });
}
