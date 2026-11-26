import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { AuthStorage } from '@mariozechner/pi-coding-agent';
import Fastify from 'fastify';
import { buildApp, gitQueue } from '../src/server/app.ts';
import { Manuscripts } from '../src/server/manuscript.ts';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';
import { WriterAgent } from '../src/server/writer/agent.ts';

function fixture(t: { after: (callback: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-custom-api-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function createWriter(dir: string) {
  // Pi can detect keys from the runner environment even with in-memory auth.
  const auth = AuthStorage.inMemory();
  const hasAuth = auth.hasAuth.bind(auth);
  auth.hasAuth = provider => provider.startsWith('custom-api-') && hasAuth(provider);
  return new WriterAgent({ dir, auth, env: {}, fetch: async url => { assert.fail(`Unexpected model discovery: ${url}`); } });
}

test('custom API settings enforce access, retain the key only for the same URL and survive a restart', async t => {
  const dir = fixture(t), store = new Store(':memory:'), writer = createWriter(dir);
  const workspace = new Workspace(store, undefined, undefined, { papilot: writer });
  const app = await buildApp({ listener: { kind: 'local', port: 7274, publicOrigin: '', owner: '' }, store, workspace, manuscripts: new Manuscripts(), csrf: 'fixture', serialGit: gitQueue(), dist: null, version: 'test' });
  const headers = { host: '127.0.0.1:7274', origin: 'http://127.0.0.1:7274', 'x-papilot-token': 'fixture' };
  const url = '/api/writer/custom-api', file = path.join(dir, 'custom-api.json');
  const baseUrl = 'https://api.example.test/gateway/v1', key = 'fixture-private-key';
  const put = (payload: object) => app.inject({ method: 'POST', url, headers, payload });
  const status = () => app.inject({ url: '/api/writer/auth', headers });
  const remove = () => app.inject({ method: 'POST', url: '/api/writer/providers/custom-api/remove', headers });
  try {
    const empty = (await status()).json();
    assert.equal(empty.providers.find((provider: any) => provider.kind === 'custom').configured, false);
    const denied = await app.inject({ method: 'POST', url, headers: { ...headers, 'x-papilot-token': 'wrong' }, payload: { baseUrl, key, model: 'test' } });
    assert.equal(denied.statusCode, 403);
    for (const invalid of ['file:///tmp/test', 'http://api.example.test/v1', 'https://user:pass@api.example.test/v1', baseUrl + '?secret=yes', baseUrl + '#', baseUrl + '/' + '论文'.repeat(150)]) {
      const response = await put({ baseUrl: invalid, model: 'test', key });
      assert.equal(response.statusCode, 400, invalid);
      assert.match(response.body, /Enter an HTTPS API base URL/);
    }
    assert.equal((await put({ baseUrl, model: 'with spaces', key })).statusCode, 400);
    assert.equal((await put({ baseUrl, model: 'test', key: 'with spaces' })).statusCode, 400);
    assert.equal((await put({ baseUrl, model: 'test' })).statusCode, 400);
    assert.equal(fs.existsSync(file), false);

    const saved = await put({ baseUrl: baseUrl + '//chat/completions/', model: 'org/paper', key });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().customApi, { baseUrl, model: 'org/paper' });
    assert.doesNotMatch(saved.body + (await status()).body, /fixture-private-key/);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const initial = (await writer.request('model/list')).data[0];
    assert.equal(initial.displayName, 'org/paper');
    assert.equal(initial.source, 'api.example.test');
    assert.equal(initial.isDefault, true);
    assert.match(initial.model, /\/org\/paper$/);

    assert.equal((await put({ baseUrl: baseUrl + '/other', model: 'org/paper', key: '' })).statusCode, 400);
    assert.equal((await put({ baseUrl, model: 'org/edited', key: '' })).statusCode, 200);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).key, key);
    const restarted = createWriter(dir);
    try {
      await restarted.start();
      assert.equal((await restarted.request('model/list')).data[0].displayName, 'org/edited');
      assert.equal(restarted.credentials!.status().customApi?.baseUrl, baseUrl);
    } finally { restarted.close(); }

    const refreshed = once(workspace, 'change');
    const moved = await put({ baseUrl: 'https://new.example.test/v1', model: 'org/paper', key: 'new-key' });
    assert.equal(moved.statusCode, 200, moved.body);
    await refreshed;
    assert.notEqual(workspace.runtimes.papilot.models[0]?.id, initial.model);
    assert.equal(workspace.runtimes.papilot.models[0]?.source, 'new.example.test');
    const prompt = { instructions: 'Check the citation.', prompt: 'Paper excerpt.', what: 'check citations' };
    await assert.rejects(workspace.quickReply({ ...prompt, choice: { agent: 'papilot', model: initial.model } }), /custom API model is unavailable/);
    workspace.setQuickModel({ agent: 'papilot', model: initial.model, effort: null });
    await assert.rejects(workspace.quickReply(prompt), /custom API model is unavailable/);
    await assert.rejects(workspace.diagnoseLatexBuild(dir, 'Compiler output.', { agent: 'papilot', model: initial.model }), /custom API model is unavailable/);
    const removed = await remove();
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(removed.json().providers.find((provider: any) => provider.kind === 'custom').configured, false);
    assert.equal(removed.json().customApi, undefined);
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual((await writer.request('model/list')).data, []);
  } finally { await app.close(); workspace.close(); store.close(); }
});

test('Writer uses an OpenAI-compatible stream for edits, reports authentication errors and retries with a changed key', { timeout: 20000 }, async t => {
  const dir = fixture(t), cwd = path.join(dir, 'paper'), writer = createWriter(dir);
  fs.mkdirSync(cwd);
  const paper = path.join(cwd, 'main.tex');
  fs.writeFileSync(paper, '\\documentclass{article}\n\\begin{document}\nThe result is small.\n\\end{document}\n');
  const api = Fastify();
  const requests: { key?: string; body: any }[] = [];
  api.post('/gateway/v1/chat/completions', async (request, reply) => {
    const body = request.body as any, key = request.headers.authorization;
    requests.push({ key, body });
    if (key !== 'Bearer !fixture-key') return reply.code(401).send({ error: { message: `Invalid fixture credential: ${key}` } });
    const edited = body.messages.some((message: any) => message.role === 'tool');
    const delta = edited ? { role: 'assistant', content: 'The result is now modest.' } : { role: 'assistant', tool_calls: [{
      index: 0, id: 'call_edit', type: 'function', function: { name: 'edit_file', arguments: JSON.stringify({ path: 'main.tex', edits: [{ old_text: 'The result is small.', new_text: 'The result is modest.' }] }) },
    }] };
    const event = (delta: object, finish_reason: string | null) => `data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    return reply.type('text/event-stream').send(event(delta, null) + event({}, edited ? 'stop' : 'tool_calls') + 'data: [DONE]\n\n');
  });
  const baseUrl = (await api.listen({ host: '127.0.0.1', port: 0 })) + '/gateway/v1';
  const events: any[] = [];
  writer.on('notification', event => events.push(event));
  writer.on('request', request => { setImmediate(() => writer.respond(request.id, { success: false, contentItems: [] })); });
  try {
    await writer.start();
    writer.credentials!.setCustomApi({ baseUrl, model: 'org/writer', key: 'wrong-key' });
    assert.equal((await writer.request('account/read')).requiresOpenaiAuth, false);
    const { data: [{ model }] } = await writer.request('model/list');
    const { thread } = await writer.request('thread/start', { cwd, model });
    async function run(text: string) {
      const completed = new Promise<any>(resolve => {
        const onEvent = (event: any) => {
          if (event.method !== 'turn/completed') return;
          writer.off('notification', onEvent);
          resolve(event.params.turn);
        };
        writer.on('notification', onEvent);
      });
      await writer.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text }] });
      return completed;
    }
    const failed = await run('Use a more precise word than small.');
    assert.equal(failed.status, 'failed');
    assert.match(failed.error.message, /Invalid fixture credential/);
    assert.doesNotMatch(JSON.stringify(events), /wrong-key/);
    writer.credentials!.setCustomApi({ baseUrl, model: 'org/writer', key: '!fixture-key' });
    const succeeded = await run('Use a more precise word than small.');
    assert.equal(succeeded.status, 'completed', succeeded.error?.message);
    assert.match(fs.readFileSync(paper, 'utf8'), /The result is modest\./);
    assert.deepEqual(requests.map(request => request.key), ['Bearer wrong-key', 'Bearer !fixture-key', 'Bearer !fixture-key']);
    assert.ok(requests.every(({ body }) => body.model === 'org/writer' && body.stream === true));
    assert.equal(requests[1].body.stream_options.include_usage, true);
    assert.equal(typeof requests[1].body.max_completion_tokens, 'number');
    assert.ok(requests[1].body.tools.some((tool: any) => tool.function.name === 'edit_file'));
    assert.ok(events.some(event => event.method === 'item/agentMessage/delta' && event.params.delta.includes('now modest')));
    writer.credentials!.remove('custom-api');
    assert.match((await run('Continue editing.')).error.message, /custom API model is unavailable/);
    assert.equal(requests.length, 3);
  } finally { writer.close(); await api.close(); }
});
