import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from './store.ts';
import { Workspace } from './workspace.ts';
import { ROOT, DATA, PORT, PUBLIC_ORIGIN, OWNER, VERSION } from './paths.ts';
import { Manuscripts } from './manuscript.ts';
import { Changes } from './changes.ts';
import { buildApp, gitQueue, type AppOptions } from './app.ts';
import { Updates } from './updates.ts';
import { readJson } from '../../bin/installation.mjs';
import { desktopDemo } from './desktop-demo.ts';
import { moveLegacyStates } from './state.ts';

export interface RuntimeOptions extends Pick<AppOptions, 'connectReview' | 'frontend' | 'frameAncestors' | 'diagnostics'> {
  port?: number;
  fallbackPort?: boolean;
  connectAgents?: boolean;
  updates?: boolean;
  shutdown?: () => void;
  configureApp?: (app: Awaited<ReturnType<typeof buildApp>>) => void | Promise<void>;
}

/** Shared services; process signals, IPC and process exit belong to the host. */
export async function createRuntime(options: RuntimeOptions = {}) {
  // One TeX pool for this installation: the review engines this server starts
  // inherit the folder, so their builds and the manuscript's share two slots.
  process.env.PAPILOT_TEX_POOL ||= path.join(DATA, 'tex-pool');
  const store = new Store(path.join(DATA, 'papilot.sqlite'));
  await moveLegacyStates(store.projects().map(project => project.path));
  const workspace = new Workspace(store, undefined, options.connectReview);
  const manuscripts = new Manuscripts(), changes = new Changes();
  const desktop = process.env.PAPILOT_DESKTOP === '1';
  const prepareDemo = desktop ? await desktopDemo(ROOT, DATA, store, workspace, manuscripts).catch(error => console.error('Could not prepare the demo paper:', error)) : undefined;
  // A packaged desktop app downloads only Papilot's own code built for its
  // installer (see desktop/runtime.ts) and asks the app to switch to it. npm
  // updates belong to the web server.
  const bundleRoot = desktop && process.send ? process.env.PAPILOT_DESKTOP_BUNDLE : undefined, fingerprint = process.env.PAPILOT_DESKTOP_FINGERPRINT || '';
  const bundle = bundleRoot && fingerprint ? { root: bundleRoot, version: readJson(path.join(bundleRoot, 'package.json'))?.version || '', fingerprint } : undefined;
  const updates = new Updates({ root: ROOT, data: DATA, version: VERSION, port: options.port ?? PORT, desktop, bundle,
    ...(options.updates === false ? { supported: false } : {}),
    ...(bundle ? { restart: async (root: string, version: string) => { process.send!({ type: 'papilot:activate', root, version }); } } : {}),
    busy: () => workspace.busyForUpdate || manuscripts.busyForUpdate || changes.busyForUpdate, shutdown: () => options.shutdown ? options.shutdown() : void close() });
  const activation = desktop ? null : readJson(path.join(DATA, 'updates/active.json'));
  const updateInstance = typeof activation?.root === 'string' && fs.existsSync(activation.root) && fs.realpathSync(activation.root) === fs.realpathSync(ROOT) ? activation.id : undefined;
  const shared = {
    ...options,
    prepareDemo: prepareDemo || undefined,
    desktopInstance: desktop ? process.env.PAPILOT_DESKTOP_INSTANCE : undefined,
    store, workspace, manuscripts, changes, updates, updateInstance, csrf: randomBytes(32).toString('base64url'), serialGit: gitQueue(),
    dist: fs.existsSync(path.join(ROOT, 'dist/index.html')) ? path.join(ROOT, 'dist') : null, version: VERSION,
  };
  const listener = { kind: 'local' as const, port: options.port ?? PORT, publicOrigin: PUBLIC_ORIGIN, owner: OWNER, trustedOrigins: [] as string[] };
  const app = await buildApp({ ...shared, listener });

  let closing: Promise<void> | undefined;
  function close(forceConnections = false) {
    if (forceConnections) app.server.closeAllConnections();
    return closing ??= (async () => {
      updates.close(); workspace.close();
      const closed = app.close();
      await Promise.all([closed, manuscripts.stop()]);
      store.close();
    })();
  }
  try {
    // Agent SDKs and the PDF engine load before the first request, not in the
    // middle of one.
    if (!process.env.PAPILOT_UPDATE_PROBE && options.connectAgents !== false) await Promise.race([Promise.all([workspace.preload(), manuscripts.warm()]), new Promise(resolve => setTimeout(resolve, 5000).unref())]);
    await options.configureApp?.(app);
    const url = await app.listen({ host: '127.0.0.1', port: listener.port }).catch(error => {
      if (!(options.fallbackPort ?? desktop) || error.code !== 'EADDRINUSE') throw error;
      return app.listen({ host: '127.0.0.1', port: 0 });
    });
    // Desktop requests an OS-assigned port. Keep Host/Origin checks exact after bind.
    listener.port = Number(new URL(url).port);
    store.recover();
    if (!process.env.PAPILOT_UPDATE_PROBE) { if (options.connectAgents !== false) void workspace.connect(); if (options.updates !== false) updates.start(); }
    // Recompute cached feedback counts, including decisions from before this restart.
    for (const task of store.tasks()) {
      // A task saved but not yet prepared continues; a failure shows on the task.
      if (task.status === 'preparing') void workspace.prepareTask(task.id);
      else if (task.pendingBuild || (task.review?.job?.id && (task.status === 'building' || (task.status === 'failed' && task.error === 'fetch failed')))) {
        void workspace.resumeBuild(task.id);
      } else if (task.status === 'building') {
        store.updateTask(task.id, { status: 'interrupted', error: 'The server restarted during the PDF build. Check the review and rebuild it if needed.' });
        void workspace.refresh(task.id);
      } else if (task.review?.round && task.status !== 'deleting') void workspace.refresh(task.id);
    }
    return { app, store, workspace, manuscripts, changes, updates, listener, url, close };
  } catch (error) { await close(); throw error; }
}
export type PapilotRuntime = Awaited<ReturnType<typeof createRuntime>>;
