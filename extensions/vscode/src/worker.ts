import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRuntime, resumeTasks, RUNTIME_SHUTDOWN_TIMEOUT_MS } from '../../../src/server/runtime.ts';
import { buildApp, gitQueue } from '../../../src/server/app.ts';
import { DATA, VERSION } from '../../../src/server/paths.ts';
import { reviewClient } from '../../../src/server/review.ts';

process.env.PAPILOT_TEX_POOL ||= path.join(DATA, 'tex-pool');
const connectReview = (root: string, reuse = false) => reviewClient(root, reuse, { owned: true });
const { store, workspace, manuscripts, changes } = await createRuntime(DATA, connectReview);
const csrf = randomBytes(32).toString('base64url');
const app = await buildApp({ store, workspace, manuscripts, changes, connectReview, csrf, serialGit: gitQueue(),
  listener: { kind: 'local', port: 0, publicOrigin: '', owner: '' }, dist: null, version: VERSION });
await app.ready();
for (const task of store.tasks()) if (task.document) manuscripts.session(task.projectId, task.document);
store.recover();
resumeTasks(store, workspace);
void workspace.connect();

function send(message: object) {
  // A request may finish after the editor disconnects. A failed reply must
  // not interrupt shutdown, even if the channel closes during the send.
  if (process.connected) process.send?.(message, error => {
    if (error && process.connected) console.error(error);
  });
}

process.on('message', async (message: any) => {
  if (message?.type !== 'request' || typeof message.id !== 'number') return;
  try {
    const projectId = /^\/review\/([^/]+)\//.exec(message.route)?.[1];
    const reviewToken = projectId && message.method === 'POST'
      ? message.route.startsWith(`/review/${projectId}/api/changes/`) ? csrf : (await connectReview(store.project(projectId).path)).token
      : '';
    const response = await app.inject({ method: message.method, url: message.route, remoteAddress: '127.0.0.1',
      headers: { host: 'localhost:0', ...message.headers, 'x-papilot-token': csrf, 'x-review-token': reviewToken },
      ...(message.body === undefined ? {} : { payload: Buffer.from(message.body, 'base64') }) });
    send({ type: 'response', id: message.id, status: response.statusCode, headers: response.headers, body: response.rawPayload.toString('base64') });
  } catch (error) { send({ type: 'response', id: message.id, error: String(error) }); }
});
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  void Promise.allSettled([workspace.close(), manuscripts.stop(), app.close()]).then(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), RUNTIME_SHUTDOWN_TIMEOUT_MS).unref();
}
process.on('disconnect', close);
process.on('SIGTERM', close);
process.on('SIGINT', close);
send({ type: 'ready' });
