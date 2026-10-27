import Fastify from 'fastify';
import { registerFrontend } from './frontend.ts';
import compress from '@fastify/compress';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Store } from './store.ts';
import { Workspace } from './workspace.ts';
import { ROOT, DATA, PORT, PUBLIC_ORIGIN, OWNER } from './paths.ts';
import { reviewClient, allowedReviewRoute, rewriteReviewHtml, rewriteReviewJson, confirmedReviewResponse, annotateReviewState } from './review.ts';
import { authorize } from './security.ts';
import { fullPaperPdf } from './pdf.ts';
import { Manuscripts, annotationTask, gitStatus } from './manuscript.ts';

const store = new Store(path.join(DATA, 'papilot.sqlite'));
const workspace = new Workspace(store);
const manuscripts = new Manuscripts();
const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
const csrf = randomBytes(32).toString('base64url');
const equals = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
await app.register(compress);
app.addHook('onRequest', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'same-origin').header('X-Frame-Options', 'SAMEORIGIN').header('Cache-Control', 'no-store');
  const denied = authorize(request.headers, request.raw.socket.remoteAddress, PORT, PUBLIC_ORIGIN, OWNER);
  if (denied) return reply.code(403).send({ error: denied });
  if (request.method === 'POST' && !request.url.startsWith('/review/') && !equals(String(request.headers['x-papilot-token'] || ''), csrf)) return reply.code(403).send({ error: 'This page has expired. Refresh it and try again.' });
});
app.setErrorHandler((error, _request, reply) => { reply.code((error as any).statusCode || 400).send({ error: (error as Error).message }); });
app.get('/api/health', () => ({ ok: true, name: 'Papilot', version: '0.1.0' }));
app.get('/api/state', () => ({ ...workspace.snapshot(), csrf }));
app.get('/api/events', (request, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  reply.raw.write('event: change\ndata: {}\n\n');
  let timer: NodeJS.Timeout | undefined;
  const change = () => { timer ??= setTimeout(() => { timer = undefined; reply.raw.write('event: change\ndata: {}\n\n'); }, 400); };
  workspace.on('change', change);
  const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15000);
  reply.raw.on('close', () => { clearInterval(heartbeat); if (timer) clearTimeout(timer); workspace.off('change', change); });
});
app.post('/api/reconnect', async () => { await workspace.connect(); return workspace.runtime; });
const string = (value: unknown, name: string, max = 20000) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} is required and must be no longer than ${max} characters.`); return value.trim(); };
app.post('/api/projects', async request => { const b = request.body as any; return workspace.addProject(string(b.path, 'Repository path', 4000), b.name ? string(b.name, 'Paper name', 120) : undefined); });
app.post('/api/tasks', async request => {
  const b = request.body as any;
  return workspace.createTask({ id: string(b.id, 'Task ID', 64), projectId: string(b.projectId, 'Paper ID', 64), title: string(b.title, 'Task title', 120), instructions: string(b.instructions, 'Instructions'), model: typeof b.model === 'string' ? b.model : undefined });
});
app.get<{ Params: { id: string } }>('/api/tasks/:id/items', request => { store.task(request.params.id); return { items: store.items(request.params.id) }; });
app.get<{ Params: { id: string }; Querystring: { round?: string; version?: string; download?: string } }>('/api/tasks/:id/pdf', async (request, reply) => {
  const task = store.task(request.params.id), project = store.project(task.projectId);
  const round = request.query.round === undefined ? task.review?.round : Number(request.query.round);
  const side = request.query.version || 'after';
  if (!round || !Number.isSafeInteger(round) || round < 1 || (side !== 'before' && side !== 'after')) return reply.code(400).send({ error: 'Select an existing review round and either the before or after PDF.' });
  const pdf = await fullPaperPdf(project.path, task.name, round, side);
  const filename = `papilot-${task.name}-r${round}-${side}.pdf`;
  return reply.type('application/pdf').header('Content-Disposition', `${request.query.download === '1' ? 'attachment' : 'inline'}; filename="${filename}"`).sendFile(path.basename(pdf), path.dirname(pdf), { cacheControl: false });
});
app.post<{ Params: { id: string } }>('/api/tasks/:id/messages', async request => {
  const b = request.body as any;
  return workspace.enqueue(request.params.id, string(b.text, 'Revision instructions'), string(b.requestKey, 'Request ID', 100), true);
});
app.post<{ Params: { id: string } }>('/api/tasks/:id/rename', request => workspace.renameTask(request.params.id, string((request.body as any).title, 'Task title', 120)));
app.post<{ Params: { id: string } }>('/api/tasks/:id/interrupt', request => workspace.interrupt(request.params.id).then(() => ({ ok: true })));
app.post<{ Params: { id: string } }>('/api/tasks/:id/delete', request => {
  if ((request.body as any)?.confirm !== true) throw new Error('Confirm permanent task deletion before continuing.');
  return workspace.deleteTask(request.params.id);
});
app.post<{ Params: { id: string } }>('/api/tasks/:id/reconcile', request => workspace.reconcile(request.params.id));
app.post<{ Params: { id: string } }>('/api/tasks/:id/publish', request => {
  const task = store.task(request.params.id); if (['running', 'waiting_input', 'building'].includes(task.status)) throw new Error('This task is busy. Wait for it to finish or pause it first.');
  void workspace.publish(task.id); return { ok: true };
});
// The manuscript preview compiles each paper's working tree and reports its Git status.
app.get<{ Params: { id: string } }>('/api/projects/:id/manuscript', async request => ({ ...(await manuscripts.state(request.params.id, store.project(request.params.id).path)), annotations: store.annotations(request.params.id).filter(note => !note.taskId) }));
app.get<{ Params: { id: string } }>('/api/projects/:id/git', request => gitStatus(store.project(request.params.id).path));
app.post<{ Params: { id: string } }>('/api/projects/:id/manuscript', async request => ({ ...(await manuscripts.state(request.params.id, store.project(request.params.id).path, true)), annotations: store.annotations(request.params.id).filter(note => !note.taskId) }));
// Notes marked on the manuscript PDF become one agent task when sent.
app.post<{ Params: { id: string } }>('/api/projects/:id/annotations', async request => {
  const project = store.project(request.params.id), b = request.body as any;
  const isRect = (value: unknown): value is [number, number, number, number] => Array.isArray(value) && value.length === 4 && value.every(v => typeof v === 'number' && v >= 0 && v <= 1) && value[2] > value[0] && value[3] > value[1];
  if (!isRect(b.rect)) throw new Error('Select text or mark a region on the page first.');
  const rects = Array.isArray(b.rects) ? b.rects.slice(0, 80).filter(isRect) : [];
  const comment = string(b.comment, 'Note', 4000), key = string(b.key, 'Preview key', 64), page = Number(b.page);
  const selected = typeof b.quote === 'string' ? b.quote.slice(0, 2000) : '';
  const { quote, source } = await manuscripts.locate(project.id, key, page, b.rect, rects, selected);
  return store.saveAnnotation({ id: randomUUID(), projectId: project.id, key, page, rect: b.rect, ...(rects.length ? { rects } : {}), comment, quote, source, createdAt: Date.now() });
});
app.post<{ Params: { id: string; note: string } }>('/api/projects/:id/annotations/:note/delete', request => { store.deleteAnnotation(store.project(request.params.id).id, request.params.note); return { ok: true }; });
app.post<{ Params: { id: string } }>('/api/projects/:id/annotations/send', async request => {
  const project = store.project(request.params.id), b = request.body as any, id = string(b.id, 'Task ID', 64);
  const existing = store.tasks().find(task => task.id === id);
  if (existing) return existing;
  const notes = store.annotations(project.id).filter(note => !note.taskId);
  if (!notes.length) throw new Error('Mark a region on the PDF and add a note first.');
  const { title, instructions } = annotationTask(notes);
  const task = await workspace.createTask({ id, projectId: project.id, title, instructions, model: typeof b.model === 'string' ? b.model : undefined });
  for (const note of notes) store.saveAnnotation({ ...note, taskId: task.id });
  return task;
});
app.get<{ Params: { id: string }; Querystring: { key?: string; download?: string } }>('/api/projects/:id/manuscript.pdf', (request, reply) => {
  const project = store.project(request.params.id), pdf = manuscripts.pdf(project.id, String(request.query.key || ''));
  const name = (project.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'manuscript') + '.pdf';
  // Each key names one immutable build, so the viewer can cache and range-read it.
  return reply.type('application/pdf').header('Content-Disposition', `${request.query.download === '1' ? 'attachment' : 'inline'}; filename="${name}"`).header('Cache-Control', 'private, max-age=31536000, immutable').sendFile(path.basename(pdf), path.dirname(pdf), { cacheControl: false });
});
app.post<{ Params: { id: string } }>('/api/requests/:id', request => { workspace.answer(request.params.id, request.body as any); return { ok: true }; });

app.route<{ Params: { projectId: string; '*': string } }>({
  method: ['GET', 'POST'], url: '/review/:projectId/*', handler: async (request, reply) => {
    const project = store.project(request.params.projectId);
    const route = '/' + request.params['*'];
    if (route.includes('..') || !allowedReviewRoute(route, request.method)) return reply.code(404).send({ error: 'Review resource not found.' });
    const client = await reviewClient(project.path);
    if (request.method === 'POST') {
      if (!equals(String(request.headers['x-review-token'] || ''), client.token)) return reply.code(403).send({ error: 'This review page has expired. Refresh it and try again.' });
    }
    const reviewTask = request.method === 'POST' ? store.tasks().find(t => t.projectId === project.id && t.name === route.split('/')[3]) : undefined;
    const writesFiles = route.endsWith('/undo') || (route.endsWith('/decide') && (request.body as any)?.action !== 'comment');
    if (request.method === 'POST' && writesFiles) string((request.body as any)?.id, 'Review action ID', 80);
    const forward = async () => {
      const search = new URL(request.url, 'http://localhost').search;
      const response = await fetch(client.url + route + search, {
        method: request.method, headers: { 'Content-Type': 'application/json', 'X-Review-Token': client.token },
        ...(request.method === 'POST' ? { body: JSON.stringify(request.body) } : {}),
        signal: AbortSignal.timeout(120000), redirect: 'error',
      });
      reply.code(response.status);
      const type = response.headers.get('content-type') || 'application/octet-stream';
      const prefix = `/review/${project.id}`;
      if (type.includes('application/json')) {
        const value = await response.json();
        if (reviewTask && writesFiles && !confirmedReviewResponse(response.status, value, reviewTask.name)) throw new Error('The review engine could not confirm this action. Select Check status before continuing.');
        if (!response.ok && request.method === 'POST' && (value as any).error) {
          const task = store.tasks().find(t => t.projectId === project.id && t.name === route.split('/')[3]);
          if (task) store.updateTask(task.id, { error: 'Review action failed: ' + (value as any).error });
        }
        if (response.ok && request.method === 'POST') {
          const task = store.tasks().find(t => t.projectId === project.id && t.name === route.split('/')[3]);
          if (task) {
            store.updateTask(task.id, { error: null });
            await workspace.refresh(task.id);
          }
        }
        return rewriteReviewJson(value, prefix);
      }
      if (reviewTask && writesFiles) throw new Error('The review engine returned an unexpected response. Select Check status before continuing.');
      reply.type(type);
      if (type.includes('text/html')) return rewriteReviewHtml(await response.text(), prefix);
      const cache = response.headers.get('cache-control'); if (cache && route.startsWith('/files/')) reply.header('Cache-Control', cache);
      if (route.startsWith('/assets/')) reply.header('Cache-Control', 'private, max-age=31536000, immutable');
      return Buffer.from(await response.arrayBuffer());
    };
    if (request.method === 'POST' && !reviewTask) throw new Error('This review task does not belong to this workspace.');
    const result = await (reviewTask ? workspace.reviewWrite(reviewTask.id, writesFiles, forward, writesFiles ? { route, body: request.body as Record<string, unknown> } : undefined) : forward());
    return annotateReviewState(result, store.tasks().filter(task => task.projectId === project.id));
  },
});

if (fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
  await registerFrontend(app, path.join(ROOT, 'dist'));
} else app.get('/', (_request, reply) => reply.type('text/plain').send('Papilot: run npm run build, then restart the server.'));

await app.listen({ host: '127.0.0.1', port: PORT });
store.recover();
console.log(`Papilot is running at http://127.0.0.1:${PORT}${PUBLIC_ORIGIN ? `\nRemote: ${PUBLIC_ORIGIN}` : ''}`);
void workspace.connect();
for (const task of store.tasks().filter(t => t.status === 'building')) { store.updateTask(task.id, { status: 'interrupted', error: 'The server restarted during the PDF build. Check the review and rebuild it if needed.' }); void workspace.refresh(task.id); }
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (shuttingDown) return; shuttingDown = true; workspace.close();
  void app.close().finally(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 2500).unref();
});
