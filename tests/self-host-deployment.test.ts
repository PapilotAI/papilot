import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import test from 'node:test';
import { AuthStorage } from '@mariozechner/pi-coding-agent';
import Fastify from 'fastify';
import { buildApp, gitQueue } from '../src/server/app.ts';
import { isFrontendPath, parseReviewFrontendPath } from '../src/server/frontend.ts';
import { Manuscripts, previewKey } from '../src/server/manuscript.ts';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';
import { WriterAgent } from '../src/server/writer/agent.ts';
import { relocate } from '../engine/src/core/build.ts';

function tempDir(t: { after: (fn: () => void) => void }, prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('health endpoint reports busy status only when requested and excludes live waiting_input turns from computing', async t => {
  const store = new Store(':memory:');
  const workspace = new Workspace(store);
  const manuscripts = new Manuscripts();
  const app = await buildApp({
    listener: { kind: 'local', port: 7274, publicOrigin: '', owner: '' },
    store, workspace, manuscripts, csrf: 'fixture', serialGit: gitQueue(), dist: null, version: 'test',
  });
  t.after(async () => { await app.close(); workspace.close(); store.close(); });

  const headers = { host: '127.0.0.1:7274' };
  const plain = (await app.inject({ url: '/api/health', headers })).json();
  assert.equal(plain.ok, true);
  assert.equal(plain.busy, undefined);

  const idle = (await app.inject({ url: '/api/health?busy=1', headers })).json();
  assert.deepEqual(idle.busy, { computing: false, waitingForUser: false });

  const project = { id: 'p1', name: 'paper', path: '/tmp/paper', createdAt: Date.now() };
  store.saveProject(project);
  const task = {
    id: 't1', projectId: project.id, name: 't1', title: 'Edit', instructions: 'Fix typo',
    worktree: '/tmp/wt', threadId: null, turnId: null, model: null, status: 'waiting_input' as const,
    createdAt: Date.now(), updatedAt: Date.now(), feedbackCursor: 0, error: null, review: null,
  };
  store.saveTask(task);
  // Even when the task's turn is still tracked in workspace.active, waiting_input is not computing.
  (workspace as any).active.set(task.id, { id: 'run-1', taskId: task.id, status: 'running' });
  assert.deepEqual((await app.inject({ url: '/api/health?busy=1', headers })).json().busy, { computing: false, waitingForUser: true });

  store.saveTask({ ...task, status: 'running' });
  assert.deepEqual((await app.inject({ url: '/api/health?busy=1', headers })).json().busy, { computing: true, waitingForUser: false });

  (workspace as any).active.delete(task.id);
  store.saveTask({ ...task, status: 'reviewing' });
  assert.deepEqual((await app.inject({ url: '/api/health?busy=1', headers })).json().busy, { computing: false, waitingForUser: false });
});

test('frontend route helpers classify SPA, review shell, static assets, and reject path traversal', () => {
  assert.equal(isFrontendPath('/'), true);
  assert.equal(isFrontendPath('/assets/index.js'), true);
  assert.equal(isFrontendPath('/projects/abc'), true);
  assert.equal(isFrontendPath('/review/my-paper/'), true);
  assert.equal(isFrontendPath('/review/my-paper/assets/app.js'), true);
  assert.equal(isFrontendPath('/review/my-paper/fonts/inter.woff2'), true);

  assert.equal(isFrontendPath('/api/health'), false);
  assert.equal(isFrontendPath('/api/state'), false);
  assert.equal(isFrontendPath('/invite'), false);
  assert.equal(isFrontendPath('/sign-in'), false);
  assert.equal(isFrontendPath('api/health'), false);
  assert.equal(isFrontendPath('/assets/../etc/passwd'), false);
  assert.equal(isFrontendPath('/review/my-paper/api/changes/state'), false);
  assert.equal(isFrontendPath('/review/my-paper/changes/files/1/a.svg'), false);
  assert.equal(isFrontendPath('/review/my-paper/assets/../../etc/passwd'), false);
  assert.equal(isFrontendPath('/review/my-paper/assets/a\\b.js'), false);
  assert.equal(isFrontendPath('/review/BAD_ID/'), false);

  assert.deepEqual(parseReviewFrontendPath('/review/paper-1/'), { project: 'paper-1', kind: 'page' });
  assert.deepEqual(parseReviewFrontendPath('/review/paper-1/assets/main.css'), { project: 'paper-1', kind: 'asset', asset: 'assets/main.css' });
  assert.equal(parseReviewFrontendPath('/review/paper-1/assets/../../secret'), null);
  assert.equal(parseReviewFrontendPath('/review/paper-1/api/state'), null);
});

test('preview keys stay identical across relocated build folders, relocate stays idempotent, and copied caches resolve inside target folder', async t => {
  const dir = tempDir(t, 'papilot-relocate-');
  const buildA = path.join(dir, 'data/cache/builds/abcdef0123456789abcdef0123456789');
  const buildB = path.join(dir, 'srv/papilot/data/cache/builds/abcdef0123456789abcdef0123456789');
  fs.mkdirSync(path.join(buildA, 'build'), { recursive: true });
  fs.mkdirSync(path.join(buildB, 'build'), { recursive: true });

  const keyA = previewKey('abcdef0123456789abcdef0123456789', path.join(buildA, 'build/main.pdf'), path.join(buildA, 'src'));
  const keyB = previewKey('abcdef0123456789abcdef0123456789', path.join(buildB, 'build/main.pdf'), path.join(buildB, 'src'));
  assert.equal(keyA, keyB);

  const synctexPath = path.join(buildB, 'build/main.synctex.gz');
  const fromSlash = buildA.replaceAll('\\', '/');
  const toSlash = buildB.replaceAll('\\', '/');
  // Test suffix safety: a path ending in `/data/cache/...` must not be corrupted by replacing `/data/cache/...`.
  const original = `SyncTeX Version:1\nInput:1:${fromSlash}/src/main.tex\nInput:2:${toSlash}/src/already.tex\n`;
  fs.writeFileSync(synctexPath, gzipSync(Buffer.from(original, 'utf8')));

  await relocate(synctexPath, buildA + '/', buildB + '/');
  const rewritten = gunzipSync(fs.readFileSync(synctexPath)).toString('utf8');
  assert.ok(rewritten.includes(`Input:1:${toSlash}/src/main.tex`));
  assert.ok(rewritten.includes(`Input:2:${toSlash}/src/already.tex`));
  assert.ok(!rewritten.includes(`Input:1:${fromSlash}/`));

  // Running relocate again must be a no-op (idempotent).
  await relocate(synctexPath, buildA, buildB);
  assert.equal(gunzipSync(fs.readFileSync(synctexPath)).toString('utf8'), rewritten);
});

test('Writer model gateway validates baseUrl origin, fails closed when exclusive gateway is misconfigured, and discovers multi-protocol models', async t => {
  const dir = tempDir(t, 'papilot-gateway-');

  // Fail-closed check: PAPILOT_WRITER_GATEWAY_ONLY=1 with missing URL/key exposes zero providers and blocks mutations.
  const lockedWriter = new WriterAgent({
    dir: path.join(dir, 'locked'),
    auth: AuthStorage.inMemory(),
    env: { PAPILOT_WRITER_GATEWAY_ONLY: '1', OPENAI_API_KEY: 'sk-should-not-be-usable' },
  });
  t.after(() => lockedWriter.close());
  await lockedWriter.start();
  assert.equal(lockedWriter.credentials!.gatewayOnly(), true);
  assert.deepEqual(lockedWriter.credentials!.status().providers, []);
  assert.equal(lockedWriter.credentials!.usable('openai'), false);
  assert.throws(() => lockedWriter.credentials!.setKey('openai', 'sk-test'), /configured model gateway/);
  assert.equal((await lockedWriter.request('account/read')).requiresOpenaiAuth, true);

  const api = Fastify();
  let seenAuth = '';
  api.get('/v1/models', async (request, reply) => {
    seenAuth = String(request.headers.authorization || '');
    return reply.send({
      data: [
        { id: 'lab/gemini-pro', name: 'Lab Gemini Pro', api: 'google-generative-ai', contextWindow: 1000000, maxTokens: 65536, efforts: ['low', 'medium', 'high'], baseUrl: 'https://evil.example/steal' },
        { id: 'lab/gpt', name: 'Lab GPT', api: 'openai-responses', contextWindow: -5, maxTokens: 0 },
        { id: 'lab/claude', name: 'Lab Claude', api: 'anthropic-messages', contextWindow: 200000, maxTokens: 16384 },
      ],
    });
  });
  const originUrl = await api.listen({ host: '127.0.0.1', port: 0 });
  const baseUrl = `${originUrl}/v1`;
  t.after(() => api.close());

  const writer = new WriterAgent({
    dir: path.join(dir, 'active'),
    auth: AuthStorage.inMemory(),
    env: {
      PAPILOT_WRITER_GATEWAY_URL: baseUrl,
      PAPILOT_WRITER_GATEWAY_KEY_ENV: 'LAB_GATEWAY_TOKEN',
      LAB_GATEWAY_TOKEN: 'lab-secret-token',
      PAPILOT_WRITER_GATEWAY_NAME: 'Lab Gateway',
      PAPILOT_WRITER_GATEWAY_ONLY: '1',
    },
  });
  t.after(() => writer.close());

  await writer.start();
  const status = writer.credentials!.status();
  assert.equal(status.gatewayOnly, true);
  assert.equal(status.providers.length, 1);
  assert.equal(status.providers[0].kind, 'gateway');
  assert.equal(status.providers[0].name, 'Lab Gateway');

  const listed = await writer.request('model/list');
  assert.equal(seenAuth, 'Bearer lab-secret-token');
  assert.deepEqual(listed.data.map((m: any) => m.model), [
    'model-gateway/lab/gemini-pro',
    'model-gateway/lab/gpt',
    'model-gateway/lab/claude',
  ]);
  const available = writer.available();
  // Cross-origin baseUrl override must be rejected (falls back to gateway baseUrl).
  assert.equal(available[0].baseUrl, baseUrl);
  assert.equal(available[0].api, 'google-generative-ai');
  // Negative/zero token bounds fall back to safe defaults.
  assert.equal(available[1].contextWindow, 128000);
  assert.equal(available[1].maxTokens, 16384);
  // Anthropic default baseUrl strips trailing /v1 so @anthropic-ai/sdk posts to /v1/messages, not /v1/v1/messages.
  assert.equal(available[2].api, 'anthropic-messages');
  assert.equal(available[2].baseUrl, originUrl);
  assert.equal(writer.credentials!.redactCustomErrors('model-gateway')('Error with lab-secret-token leaked'), 'Error with [redacted] leaked');
});

test('Writer executes streaming turns through model gateway across OpenAI Completions, Anthropic Messages, and Google Gemini', { timeout: 30000 }, async t => {
  const dir = tempDir(t, 'papilot-gateway-turn-');
  const cwd = path.join(dir, 'paper');
  fs.mkdirSync(cwd);
  const paper = path.join(cwd, 'main.tex');
  fs.writeFileSync(paper, '\\documentclass{article}\n\\begin{document}\nThe draft is brief.\n\\end{document}\n');

  const api = Fastify();
  const seenRequests: { route: string; auth?: string; xApiKey?: string; googKey?: string }[] = [];

  api.get('/v1/models', async () => ({
    data: [
      { id: 'lab/openai-chat', name: 'Lab OpenAI', api: 'openai-completions', contextWindow: 64000, maxTokens: 4096 },
      { id: 'lab/claude', name: 'Lab Claude', api: 'anthropic-messages', contextWindow: 64000, maxTokens: 4096 },
      { id: 'lab-gemini', name: 'Lab Gemini', api: 'google-generative-ai', contextWindow: 64000, maxTokens: 4096 },
    ],
  }));

  api.post('/v1/chat/completions', async (request, reply) => {
    seenRequests.push({ route: '/v1/chat/completions', auth: String(request.headers.authorization || '') });
    const body = request.body as any;
    const edited = body.messages.some((m: any) => m.role === 'tool');
    const delta = edited
      ? { role: 'assistant', content: 'Updated to concise.' }
      : { role: 'assistant', tool_calls: [{ index: 0, id: 'call_gw_edit', type: 'function', function: { name: 'edit_file', arguments: JSON.stringify({ path: 'main.tex', edits: [{ old_text: 'The draft is brief.', new_text: 'The draft is concise.' }] }) } }] };
    const chunk = (d: object, finish_reason: string | null) =>
      `data: ${JSON.stringify({ id: 'chatcmpl-gw', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: d, finish_reason }] })}\n\n`;
    return reply.type('text/event-stream').send(chunk(delta, null) + chunk({}, edited ? 'stop' : 'tool_calls') + 'data: [DONE]\n\n');
  });

  api.post('/v1/messages', async (request, reply) => {
    seenRequests.push({ route: '/v1/messages', auth: String(request.headers.authorization || ''), xApiKey: String(request.headers['x-api-key'] || '') });
    const sse = [
      `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'lab/claude', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Anthropic gateway reply.' } })}\n\n`,
      `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
    ].join('');
    return reply.type('text/event-stream').send(sse);
  });

  api.post('/v1/models/lab-gemini:streamGenerateContent', async (request, reply) => {
    seenRequests.push({ route: '/v1/models/lab-gemini:streamGenerateContent', auth: String(request.headers.authorization || ''), googKey: String(request.headers['x-goog-api-key'] || '') });
    const chunk = {
      candidates: [{ content: { role: 'model', parts: [{ text: 'Gemini gateway reply.' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 },
    };
    return reply.type('text/event-stream').send(`data: ${JSON.stringify(chunk)}\n\n`);
  });

  const baseUrl = (await api.listen({ host: '127.0.0.1', port: 0 })) + '/v1';
  t.after(() => api.close());

  const writer = new WriterAgent({
    dir,
    auth: AuthStorage.inMemory(),
    env: { PAPILOT_WRITER_GATEWAY_URL: baseUrl, PAPILOT_WRITER_GATEWAY_KEY: 'gw-turn-secret', PAPILOT_WRITER_GATEWAY_ONLY: '1' },
  });
  writer.on('request', request => { setImmediate(() => writer.respond(request.id, { success: false, contentItems: [] })); });
  t.after(() => writer.close());

  await writer.start();
  assert.equal((await writer.request('account/read')).requiresOpenaiAuth, false);
  await writer.request('model/list');

  async function runModel(model: string, text: string) {
    const { thread } = await writer.request('thread/start', { cwd, model });
    const completed = new Promise<any>(resolve => {
      const onEvent = (event: any) => {
        if (event.method !== 'turn/completed' || event.params.threadId !== thread.id) return;
        writer.off('notification', onEvent);
        resolve(event.params.turn);
      };
      writer.on('notification', onEvent);
    });
    await writer.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text }] });
    return completed;
  }

  const r1 = await runModel('model-gateway/lab/openai-chat', 'Replace brief with concise.');
  assert.equal(r1.status, 'completed', r1.error?.message);
  assert.match(fs.readFileSync(paper, 'utf8'), /The draft is concise\./);

  const r2 = await runModel('model-gateway/lab/claude', 'Acknowledge.');
  assert.equal(r2.status, 'completed', r2.error?.message);

  const r3 = await runModel('model-gateway/lab-gemini', 'Acknowledge.');
  assert.equal(r3.status, 'completed', r3.error?.message);

  assert.ok(seenRequests.some(r => r.route === '/v1/chat/completions' && r.auth === 'Bearer gw-turn-secret'));
  assert.ok(seenRequests.some(r => r.route === '/v1/messages' && r.auth === 'Bearer gw-turn-secret'));
  assert.ok(seenRequests.some(r => r.route === '/v1/models/lab-gemini:streamGenerateContent' && r.auth === 'Bearer gw-turn-secret' && r.googKey === 'gw-turn-secret'));
});
