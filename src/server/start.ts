import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from './store.ts';
import { Workspace } from './workspace.ts';
import { Accounts } from './accounts.ts';
import { ROOT, DATA, PORT, PUBLIC_ORIGIN, OWNER, VERSION, ACCOUNT_ORIGIN, ACCOUNT_PORT } from './paths.ts';
import { accountHsts, accountProblem } from './security.ts';
import { Manuscripts } from './manuscript.ts';
import { Changes } from './changes.ts';
import { buildApp, gitQueue } from './app.ts';
import { Updates } from './updates.ts';
import { readJson } from '../../bin/installation.mjs';

const problem = accountProblem(ACCOUNT_ORIGIN, ACCOUNT_PORT, PORT, PUBLIC_ORIGIN);
if (problem) { console.error(problem); process.exit(1); }
const store = new Store(path.join(DATA, 'papilot.sqlite'));
const workspace = new Workspace(store);
const accounts = new Accounts(store, ACCOUNT_ORIGIN || null);
const manuscripts = new Manuscripts(), changes = new Changes();
const updates = new Updates({ root: ROOT, data: DATA, version: VERSION, port: PORT, busy: () => workspace.busyForUpdate || manuscripts.busyForUpdate || changes.busyForUpdate, shutdown: () => shutdown() });
const activation = readJson(path.join(DATA, 'updates/active.json'));
const updateInstance = typeof activation?.root === 'string' && fs.existsSync(activation.root) && fs.realpathSync(activation.root) === fs.realpathSync(ROOT) ? activation.id : undefined;
const shared = {
  store, workspace, accounts, manuscripts, changes, updates, updateInstance, csrf: randomBytes(32).toString('base64url'), serialGit: gitQueue(),
  dist: fs.existsSync(path.join(ROOT, 'dist/index.html')) ? path.join(ROOT, 'dist') : null, version: VERSION,
};
const apps = [await buildApp({ ...shared, listener: { kind: 'local', port: PORT, publicOrigin: PUBLIC_ORIGIN, owner: OWNER } })];
if (ACCOUNT_ORIGIN) apps.push(await buildApp({ ...shared, listener: { kind: 'account', origin: ACCOUNT_ORIGIN, hsts: accountHsts(ACCOUNT_ORIGIN, PUBLIC_ORIGIN) } }));

await apps[0].listen({ host: '127.0.0.1', port: PORT });
if (apps[1]) await apps[1].listen({ host: '127.0.0.1', port: ACCOUNT_PORT });
store.recover();
console.log(`Papilot is running at http://127.0.0.1:${PORT}${PUBLIC_ORIGIN ? `\nRemote: ${PUBLIC_ORIGIN}` : ''}${ACCOUNT_ORIGIN ? `\nSign-in for invited people: ${ACCOUNT_ORIGIN} (forwarded to 127.0.0.1:${ACCOUNT_PORT})` : ''}`);
if (!process.env.PAPILOT_UPDATE_PROBE) { void workspace.connect(); updates.start(); }
// Recompute cached feedback counts, including decisions from before this restart.
const refreshes: Promise<void>[] = [];
for (const task of store.tasks()) {
  if (task.status === 'building') {
    store.updateTask(task.id, { status: 'interrupted', error: 'The server restarted during the PDF build. Check the review and rebuild it if needed.' });
    refreshes.push(workspace.refresh(task.id));
  } else if (task.review?.round && task.status !== 'deleting') refreshes.push(workspace.refresh(task.id));
}
// Finished tasks are archived as the author leaves them. Once the counts are
// current, archive the ones finished before Papilot did that.
void Promise.all(refreshes).then(() => { if (!shuttingDown) store.migrate('archive-finished-tasks', () => workspace.archiveFinished()); });
// Expired invites and sessions are removed as they lapse.
setInterval(() => accounts.purge(), 3600000).unref();
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return; shuttingDown = true; updates.close(); workspace.close();
  void Promise.all(apps.map(app => app.close())).finally(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 2500).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
