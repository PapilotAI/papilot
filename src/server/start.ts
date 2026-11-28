import { createRuntime, ensureSinglePaper, resumeTasks, RUNTIME_SHUTDOWN_TIMEOUT_MS } from './runtime.ts';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT, DATA, PORT, PUBLIC_ORIGIN, OWNER, VERSION } from './paths.ts';
import { buildApp, gitQueue } from './app.ts';
import { readHostChromeConfig } from './host-chrome.ts';
import { Updates } from './updates.ts';
import { readJson } from '../../bin/installation.mjs';
import { desktopDemo } from './desktop-demo.ts';

// One TeX pool for this installation: the review engines this server starts
// inherit the folder, so their builds and the manuscript's share two slots.
process.env.PAPILOT_TEX_POOL ||= path.join(DATA, 'tex-pool');
const { store, workspace, manuscripts, changes } = await createRuntime(DATA);
const singlePaperPath = process.env.PAPILOT_SINGLE_PAPER?.trim();
if (singlePaperPath) await ensureSinglePaper(workspace, singlePaperPath, process.env.PAPILOT_SINGLE_PAPER_NAME);
const hostChrome = readHostChromeConfig(process.env);
const desktop = process.env.PAPILOT_DESKTOP === '1';
const prepareDemo = desktop && !singlePaperPath ? await desktopDemo(ROOT, DATA, store, workspace, manuscripts).catch(error => console.error('Could not prepare the demo paper:', error)) : undefined;
// A packaged desktop app downloads only Papilot's own code built for its
// installer (see desktop/runtime.ts) and asks the app to switch to it. npm
// updates belong to the web server.
const bundleRoot = desktop && process.send ? process.env.PAPILOT_DESKTOP_BUNDLE : undefined, fingerprint = process.env.PAPILOT_DESKTOP_FINGERPRINT || '';
const bundle = bundleRoot && fingerprint ? { root: bundleRoot, version: readJson(path.join(bundleRoot, 'package.json'))?.version || '', fingerprint } : undefined;
const updates = new Updates({ root: ROOT, data: DATA, version: VERSION, port: PORT, desktop, bundle,
  ...(bundle ? { restart: async (root: string, version: string) => { process.send!({ type: 'papilot:activate', root, version }); } } : {}),
  busy: () => workspace.busyForUpdate || manuscripts.busyForUpdate || changes.busyForUpdate, shutdown: () => shutdown() });
const activation = desktop ? null : readJson(path.join(DATA, 'updates/active.json'));
const updateInstance = typeof activation?.root === 'string' && fs.existsSync(activation.root) && fs.realpathSync(activation.root) === fs.realpathSync(ROOT) ? activation.id : undefined;
const shared = {
  prepareDemo: prepareDemo || undefined,
  desktopInstance: desktop ? process.env.PAPILOT_DESKTOP_INSTANCE : undefined,
  singlePaper: Boolean(singlePaperPath),
  hostChrome,
  store, workspace, manuscripts, changes, updates, updateInstance, csrf: randomBytes(32).toString('base64url'), serialGit: gitQueue(),
  dist: fs.existsSync(path.join(ROOT, 'dist/index.html')) ? path.join(ROOT, 'dist') : null, version: VERSION,
};
const localListener = { kind: 'local' as const, port: PORT, publicOrigin: PUBLIC_ORIGIN, owner: OWNER };
const app = await buildApp({ ...shared, listener: localListener });

// Agent SDKs and the PDF engine load before the first request, not in the
// middle of one. Managed web hosts and single-paper sessions bind immediately
// and warm in the background so cold container startup stays fast.
const fastStart = Boolean(hostChrome || singlePaperPath || process.env.PAPILOT_FAST_START === '1');
if (!process.env.PAPILOT_UPDATE_PROBE && !fastStart) await Promise.race([Promise.all([workspace.preload(), manuscripts.warm()]), new Promise(resolve => setTimeout(resolve, 5000).unref())]);
const localUrl = await app.listen({ host: '127.0.0.1', port: PORT }).catch(error => {
  if (!desktop || error.code !== 'EADDRINUSE') throw error;
  return app.listen({ host: '127.0.0.1', port: 0 });
});
// Desktop requests an OS-assigned port. Keep Host/Origin checks exact after bind.
localListener.port = Number(new URL(localUrl).port);

store.recover();
console.log(`Papilot is running at ${localUrl}${PUBLIC_ORIGIN ? `\nRemote: ${PUBLIC_ORIGIN}` : ''}`);
if (!process.env.PAPILOT_UPDATE_PROBE) {
  if (fastStart) void manuscripts.warm().catch(() => undefined);
  void workspace.connect();
  updates.start();
}
resumeTasks(store, workspace);
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return; shuttingDown = true; updates.close();
  const agentsClosed = workspace.close();
  void manuscripts.stop().catch(() => undefined);
  void Promise.allSettled([agentsClosed, app.close()]).then(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), RUNTIME_SHUTDOWN_TIMEOUT_MS).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
if (process.platform !== 'win32') process.on('SIGHUP', shutdown);
if (desktop && process.send) {
  process.on('disconnect', shutdown);
  process.on('message', message => {
    const value = message as { type?: string; id?: string } | null;
    if (value?.type === 'papilot:shutdown') shutdown();
    if (value?.type === 'papilot:can-switch' && typeof value.id === 'string') process.send?.({ type: value.type, id: value.id,
      busy: workspace.busyForUpdate || manuscripts.busyForUpdate || changes.busyForUpdate || ['installing', 'waiting', 'restarting'].includes(updates.snapshot().phase) });
  });
  process.send({ type: 'papilot:ready', url: localUrl });
}
