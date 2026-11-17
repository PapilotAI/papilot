import './core/worker-loader.mjs';
import { parentPort, workerData } from 'node:worker_threads';
const { serve } = await import('./server.ts');
const owner = { left: false, stop() {} };
const stop = () => { owner.left = true; owner.stop(); };
parentPort.on('message', value => { if (value === 'stop') stop(); });
parentPort.once('close', stop);
try {
  await serve(workerData.root, workerData.port, 12 * 3600, { owner, ready: value => parentPort.postMessage(value) });
} finally {
  parentPort.close();
}
