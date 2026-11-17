import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const moduleAt = file => import(pathToFileURL(path.join(workerData.root, file)).href);
await moduleAt('engine/src/core/worker-loader.mjs');
const [{ createRuntime }, { OwnedEngines }, { stopAll }] = await Promise.all([
  moduleAt('src/server/runtime.ts'), moduleAt('engine/src/owned-engines.ts'), moduleAt('engine/src/core/process.ts'),
]);
const engines = new OwnedEngines(), frameAncestors = [];
const portFile = path.join(process.env.PAPILOT_DATA, 'editor-port.json');
let port = 0;
try { const saved = JSON.parse(fs.readFileSync(portFile, 'utf8')); if (Number.isInteger(saved) && saved > 0 && saved <= 65535) port = saved; } catch { /* First launch. */ }
let runtime, stopping;
const close = () => stopping ??= (async () => {
  try { await Promise.all([runtime?.close(true), engines.close()]); }
  finally { stopAll(); parentPort.close(); }
})();
try {
  runtime = await createRuntime({ port, fallbackPort: true, updates: false, connectAgents: workerData.connectAgents !== false,
    connectReview: engines.connect, frameAncestors,
    frontend: { transformHtml: html => html.replace('</head>', '<script src="/host.js"></script></head>') },
    configureApp: app => { app.get('/host.js', (_request, reply) => reply.type('application/javascript').send(workerData.bridge)); },
  });
  fs.writeFileSync(portFile, JSON.stringify(runtime.listener.port));
  const headers = { host: new URL(runtime.url).host };
  const snapshot = (await runtime.app.inject({ url: '/api/state', headers })).json();
  headers['x-papilot-token'] = snapshot.csrf;
  parentPort.on('message', async message => {
    if (message.type === 'stop') { await close(); return; }
    try {
      let value;
      if (message.type === 'host') {
        frameAncestors.splice(0, frameAncestors.length, ...message.ancestors);
        runtime.listener.trustedOrigins.splice(0, runtime.listener.trustedOrigins.length, new URL(message.origin).origin);
      } else if (message.type === 'request') {
        if (typeof message.route !== 'string' || !message.route.startsWith('/api/')) throw new Error('Invalid Papilot route.');
        const response = await runtime.app.inject({ url: message.route, method: message.body === undefined ? 'GET' : 'POST', headers,
          ...(message.body === undefined ? {} : { payload: message.body }) });
        value = response.json();
        if (response.statusCode >= 400) throw new Error(value.error || `Papilot returned ${response.statusCode}.`);
      } else throw new Error('Unknown runtime request.');
      parentPort.postMessage({ id: message.id, value });
    } catch (error) { parentPort.postMessage({ id: message.id, error: error.message }); }
  });
  parentPort.once('close', close);
  parentPort.postMessage({ type: 'ready', url: runtime.url });
} catch (error) {
  parentPort.postMessage({ type: 'failed', error: error.message });
  await close();
}
