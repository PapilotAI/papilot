import './worker-loader.mjs';
import { workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
process.argv = [process.execPath, workerData.script, ...workerData.args];
await import(pathToFileURL(workerData.script).href);
