import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from './store.ts';
import { Workspace } from './workspace.ts';
import { Accounts } from './accounts.ts';
import { ROOT, DATA, PORT, PUBLIC_ORIGIN, OWNER, VERSION, ACCOUNT_ORIGIN, ACCOUNT_PORT } from './paths.ts';
import { accountHsts, accountProblem } from './security.ts';
import { Manuscripts } from './manuscript.ts';
import { buildApp, gitQueue } from './app.ts';

const problem = accountProblem(ACCOUNT_ORIGIN, ACCOUNT_PORT, PORT, PUBLIC_ORIGIN);
if (problem) { console.error(problem); process.exit(1); }
const store = new Store(path.join(DATA, 'papilot.sqlite'));
const workspace = new Workspace(store);
const accounts = new Accounts(store, ACCOUNT_ORIGIN || null);
const shared = {
  store, workspace, accounts, manuscripts: new Manuscripts(), csrf: randomBytes(32).toString('base64url'), serialGit: gitQueue(),
  dist: fs.existsSync(path.join(ROOT, 'dist/index.html')) ? path.join(ROOT, 'dist') : null, version: VERSION,
};
const apps = [await buildApp({ ...shared, listener: { kind: 'local', port: PORT, publicOrigin: PUBLIC_ORIGIN, owner: OWNER } })];
if (ACCOUNT_ORIGIN) apps.push(await buildApp({ ...shared, listener: { kind: 'account', origin: ACCOUNT_ORIGIN, hsts: accountHsts(ACCOUNT_ORIGIN, PUBLIC_ORIGIN) } }));

await apps[0].listen({ host: '127.0.0.1', port: PORT });
if (apps[1]) await apps[1].listen({ host: '127.0.0.1', port: ACCOUNT_PORT });
store.recover();
console.log(`Papilot is running at http://127.0.0.1:${PORT}${PUBLIC_ORIGIN ? `\nRemote: ${PUBLIC_ORIGIN}` : ''}${ACCOUNT_ORIGIN ? `\nSign-in for invited people: ${ACCOUNT_ORIGIN} (forwarded to 127.0.0.1:${ACCOUNT_PORT})` : ''}`);
void workspace.connect();
// Recompute cached feedback counts, including decisions from before this restart.
for (const task of store.tasks()) {
  if (task.status === 'building') {
    store.updateTask(task.id, { status: 'interrupted', error: 'The server restarted during the PDF build. Check the review and rebuild it if needed.' });
    void workspace.refresh(task.id);
  } else if (task.review?.round && task.status !== 'deleting') void workspace.refresh(task.id);
}
// Expired invites and sessions are removed as they lapse.
setInterval(() => accounts.purge(), 3600000).unref();
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (shuttingDown) return; shuttingDown = true; workspace.close();
  void Promise.all(apps.map(app => app.close())).finally(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 2500).unref();
});
