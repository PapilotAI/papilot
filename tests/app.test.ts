import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';
import { Accounts } from '../src/server/accounts.ts';
import { Manuscripts } from '../src/server/manuscript.ts';
import { buildApp, gitQueue } from '../src/server/app.ts';
import { accountHsts, accountProblem } from '../src/server/security.ts';
import { Limiter, clientAddress } from '../src/server/access.ts';
import { PassThrough } from 'node:stream';
import type { Codex } from '../src/server/codex.ts';
import type { ReviewClient } from '../src/server/review.ts';
import type { Task } from '../src/shared.ts';

const ORIGIN = 'https://mini.example.ts.net:10000', PUBLIC = 'https://mini.example.ts.net:8443';
const LOCAL = { host: '127.0.0.1:7274' }, REMOTE = { host: 'mini.example.ts.net:10000' };
class FakeAgent extends EventEmitter { ready = false; async request() { return {}; } respond() {} reject() {} close() {} }
const passkeys = {
  generateRegistrationOptions: async () => ({ challenge: 'register' }) as any,
  verifyRegistrationResponse: async ({ response, expectedChallenge }: any) => ({ verified: await expectedChallenge('register'), registrationInfo: { credential: { id: response.id, publicKey: new Uint8Array([1]), counter: 0 } } }) as any,
  generateAuthenticationOptions: async () => ({ challenge: 'sign-in' }) as any,
  verifyAuthenticationResponse: async () => ({ verified: false }) as any,
};
const task = (id: string, projectId: string): Task => ({ id, projectId, name: 'p-' + id, title: id, instructions: 'Edit.', worktree: '/unused', threadId: null, turnId: null, model: null, status: 'reviewing', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null });

async function fixture() {
  const store = new Store(':memory:'), dist = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-app-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>app</html>');
  fs.writeFileSync(path.join(dist, '.env'), 'SECRET=1');
  const review: ReviewClient = { url: 'http://127.0.0.1:9', token: 'review-token', get: async () => ({}) as any, post: async () => ({}) as any };
  const workspace = new Workspace(store, new FakeAgent() as unknown as Codex, 2, async () => review, { claude: new FakeAgent() as unknown as Codex, antigravity: new FakeAgent() as unknown as Codex });
  workspace.runtimes.codex.account = 'owner@example.com';
  const accounts = new Accounts(store, ORIGIN, passkeys);
  store.saveProject({ id: 'thesis', name: 'Thesis', path: '/unused/thesis', createdAt: 1 });
  store.saveProject({ id: 'grant', name: 'Grant', path: '/unused/grant', createdAt: 1 });
  store.saveTask(task('thesis-task', 'thesis'));
  store.saveTask(task('grant-task', 'grant'));
  workspace.requests.set('grant-request', { id: 'grant-request', taskId: 'grant-task', method: 'item/commandExecution/requestApproval', params: { command: 'ls' }, createdAt: 1, rpcId: 1, agent: 'codex' });
  const shared = { store, workspace, accounts, manuscripts: new Manuscripts(), csrf: 'local-csrf', serialGit: gitQueue(), dist, version: '9.9.9', connectReview: async () => review };
  const local = await buildApp({ ...shared, listener: { kind: 'local', port: 7274, publicOrigin: PUBLIC, owner: 'owner@example' } });
  const remote = await buildApp({ ...shared, listener: { kind: 'account', origin: ORIGIN, hsts: true } });
  // Ada is invited to the thesis only and signs in at the public URL.
  const ada = accounts.addPerson('Ada', ['thesis']), token = new URL(ada.link).hash.slice(1);
  await accounts.registrationOptions(token);
  const joined = await remote.inject({ method: 'POST', url: '/api/auth/invite/verify', headers: { ...REMOTE, origin: ORIGIN }, payload: { token, response: { id: 'ada-key' } } });
  const session = String(joined.headers['set-cookie']).split(';')[0];
  const state = (await remote.inject({ url: '/api/state', headers: { ...REMOTE, cookie: session } })).json();
  const as = { ...REMOTE, origin: ORIGIN, cookie: session, 'x-papilot-token': state.csrf };
  return { store, workspace, accounts, local, remote, ada, joined, session, state, as, async close() { await local.close(); await remote.close(); workspace.close(); store.close(); fs.rmSync(dist, { recursive: true }); } };
}

test('an invited person signs in at the public URL and sees only the papers shared with them', async () => {
  const f = await fixture();
  try {
    assert.equal(f.joined.statusCode, 200);
    assert.match(String(f.joined.headers['set-cookie']), /^__Host-papilot-session=[\w-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict/);
    assert.deepEqual(f.state.viewer, { id: f.ada.id, name: 'Ada', role: 'member', listener: 'account', owner: f.accounts.owner().name });
    assert.deepEqual(f.state.projects.map((p: any) => p.id), ['thesis']);
    assert.deepEqual(f.state.tasks.map((t: any) => t.id), ['thesis-task']);
    assert.deepEqual(f.state.requests, []);
    assert.equal(f.state.runtimes.codex.account, 'Signed in', "the owner's agent login stays private");
    // Unsharing takes effect on the next request.
    f.accounts.share(f.ada.id, ['grant']);
    const after = (await f.remote.inject({ url: '/api/state', headers: { ...REMOTE, cookie: f.session } })).json();
    assert.deepEqual([after.projects.map((p: any) => p.id), after.requests.map((r: any) => r.id)], [['grant'], ['grant-request']]);
  } finally { await f.close(); }
});

test('the public URL lets nothing through without a session, whatever the headers claim', async () => {
  const f = await fixture();
  try {
    for (const headers of [REMOTE, { ...REMOTE, 'tailscale-user-login': 'owner@example' }, { ...REMOTE, cookie: '__Host-papilot-session=forged' }]) {
      const response = await f.remote.inject({ url: '/api/state', headers });
      assert.equal(response.statusCode, 401, JSON.stringify(headers));
    }
    // A local Host header does not make a public request local.
    assert.equal((await f.remote.inject({ url: '/api/state', headers: LOCAL })).statusCode, 403);
    // The app itself loads, so the sign-in page can show; dotfiles never do.
    assert.equal((await f.remote.inject({ url: '/', headers: REMOTE })).body, '<html>app</html>');
    assert.equal((await f.remote.inject({ url: '/invite', headers: REMOTE })).body, '<html>app</html>');
    const dotfile = await f.remote.inject({ url: '/.env', headers: REMOTE });
    assert.notEqual(dotfile.body, 'SECRET=1');
    assert.equal((await f.local.inject({ url: '/.env', headers: LOCAL })).body === 'SECRET=1', false);
    assert.deepEqual((await f.remote.inject({ url: '/api/health', headers: REMOTE })).json(), { ok: true });
    assert.equal((await f.remote.inject({ url: '/review/thesis/', headers: REMOTE })).statusCode, 401);
    assert.equal((await f.remote.inject({ url: '/api/projects/thesis/manuscript.pdf', headers: REMOTE })).statusCode, 401);
    assert.match(String((await f.remote.inject({ url: '/', headers: REMOTE })).headers['strict-transport-security']), /max-age/);
  } finally { await f.close(); }
});

test('public requests need the right origin, the session token and no other site', async () => {
  const f = await fixture();
  try {
    const rename = (headers: Record<string, string>) => f.remote.inject({ method: 'POST', url: '/api/tasks/thesis-task/rename', headers, payload: { title: 'Renamed' } });
    const { origin: _, ...noOrigin } = f.as;
    assert.equal((await rename(noOrigin)).statusCode, 403);
    assert.equal((await rename({ ...f.as, origin: 'https://evil.example' })).statusCode, 403);
    assert.equal((await rename({ ...f.as, 'x-papilot-token': 'local-csrf' })).statusCode, 403);
    assert.equal((await rename({ ...f.as, 'sec-fetch-site': 'same-site' })).statusCode, 403);
    assert.equal((await f.remote.inject({ url: '/api/state', headers: { ...REMOTE, cookie: f.session, 'sec-fetch-site': 'same-site' } })).statusCode, 403);
    assert.equal((await rename(f.as)).statusCode, 200);
    assert.equal(f.store.task('thesis-task').title, 'Renamed');
    // A link from another site, such as an invite in a web mail, opens the app; nothing else is served to other sites.
    const navigate = { ...REMOTE, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
    assert.equal((await f.remote.inject({ url: '/invite', headers: navigate })).body, '<html>app</html>');
    assert.equal((await f.remote.inject({ url: '/api/state', headers: { ...navigate, cookie: f.session } })).statusCode, 403);
    assert.equal((await f.remote.inject({ url: '/', headers: { ...navigate, 'sec-fetch-dest': 'iframe' } })).statusCode, 403);
  } finally { await f.close(); }
});

test('an unshared paper answers exactly like one that does not exist', async () => {
  const f = await fixture();
  try {
    const same = async (label: string, unshared: { method?: 'GET' | 'POST'; url: string; payload?: object }, missing: { method?: 'GET' | 'POST'; url: string; payload?: object }) => {
      const a = await f.remote.inject({ ...unshared, headers: f.as }), b = await f.remote.inject({ ...missing, headers: f.as });
      assert.equal(a.statusCode, b.statusCode, label);
      assert.equal(a.body, b.body, label);
      assert.ok(a.statusCode >= 400, label);
    };
    await same('paper', { url: '/api/projects/grant/git' }, { url: '/api/projects/nope/git' });
    await same('paper PDF', { url: '/api/projects/grant/manuscript.pdf?key=x' }, { url: '/api/projects/nope/manuscript.pdf?key=x' });
    await same('notes', { method: 'POST', url: '/api/projects/grant/annotations/send', payload: { id: 'new-task-id-0001' } }, { method: 'POST', url: '/api/projects/nope/annotations/send', payload: { id: 'new-task-id-0001' } });
    await same('review', { url: '/review/grant/api/tasks' }, { url: '/review/nope/api/tasks' });
    await same('task', { url: '/api/tasks/grant-task/items' }, { url: '/api/tasks/nope/items' });
    await same('task write', { method: 'POST', url: '/api/tasks/grant-task/interrupt', payload: {} }, { method: 'POST', url: '/api/tasks/nope/interrupt', payload: {} });
    await same('approval', { method: 'POST', url: '/api/requests/grant-request', payload: { decision: 'accept' } }, { method: 'POST', url: '/api/requests/nope', payload: { decision: 'accept' } });
    await same('new task', { method: 'POST', url: '/api/tasks', payload: { id: 'new-task-id-0002', projectId: 'grant', title: 'T', instructions: 'Edit.' } }, { method: 'POST', url: '/api/tasks', payload: { id: 'new-task-id-0002', projectId: 'nope', title: 'T', instructions: 'Edit.' } });
    assert.equal(f.store.task('grant-task').status, 'reviewing');
    // Deleting a task that is gone succeeds so a lost response can be retried; a hidden one answers the same and stays.
    const deleteHidden = await f.remote.inject({ method: 'POST', url: '/api/tasks/grant-task/delete', headers: f.as, payload: { confirm: true } });
    const deleteMissing = await f.remote.inject({ method: 'POST', url: '/api/tasks/nope/delete', headers: f.as, payload: { confirm: true } });
    assert.deepEqual([deleteHidden.statusCode, deleteHidden.body], [deleteMissing.statusCode, deleteMissing.body]);
    assert.deepEqual(deleteHidden.json(), { ok: true });
    assert.ok(f.store.tasks().some(task => task.id === 'grant-task'), 'a hidden task is not deleted');
    const reconnected = await f.remote.inject({ method: 'POST', url: '/api/reconnect', headers: f.as, payload: {} });
    assert.equal(reconnected.json().account, 'Signed in', "reconnecting does not reveal the owner's agent login");
    // Another paper's task id cannot be claimed through a shared paper.
    const claimed = await f.remote.inject({ method: 'POST', url: '/api/tasks', headers: f.as, payload: { id: 'grant-task', projectId: 'thesis', title: 'T', instructions: 'Edit.' } });
    assert.deepEqual([claimed.statusCode, claimed.json().error], [400, 'Invalid task ID.']);
    const sent = await f.remote.inject({ method: 'POST', url: '/api/projects/thesis/annotations/send', headers: f.as, payload: { id: 'grant-task' } });
    assert.deepEqual([sent.statusCode, sent.json().error], [400, 'Invalid task ID.']);
  } finally { await f.close(); }
});

test('adding papers and managing people stay with the owner', async () => {
  const f = await fixture();
  try {
    for (const [method, url] of [['POST', '/api/projects'], ['GET', '/api/people'], ['POST', '/api/people'], ['POST', `/api/people/${f.ada.id}/share`], ['POST', `/api/people/${f.ada.id}/remove`]] as const) {
      const response = await f.remote.inject({ method, url, headers: f.as, ...(method === 'POST' ? { payload: { path: '/', name: 'x', projects: ['grant'] } } : {}) });
      assert.equal(response.statusCode, 403, url);
    }
    // The owner shares from the host, and a removed person's next request asks them to sign in.
    const people = (await f.local.inject({ url: '/api/people', headers: LOCAL })).json();
    assert.deepEqual(people.people.map((p: any) => [p.name, p.role, p.joined]), [[f.accounts.owner().name, 'owner', false], ['Ada', 'member', true]]);
    const removed = await f.local.inject({ method: 'POST', url: `/api/people/${f.ada.id}/remove`, headers: { ...LOCAL, 'x-papilot-token': 'local-csrf' } });
    assert.equal(removed.statusCode, 200);
    assert.equal((await f.remote.inject({ url: '/api/state', headers: { ...REMOTE, cookie: f.session } })).statusCode, 401);
  } finally { await f.close(); }
});

test('a request whose body arrives after its person was removed or unshared does nothing', async () => {
  const f = await fixture();
  try {
    const slow = (url: string) => { const body = new PassThrough(); return { body, response: f.remote.inject({ method: 'POST', url, headers: { ...f.as, 'content-type': 'application/json' }, payload: body }) }; };
    const unshared = slow('/api/tasks/thesis-task/rename');
    await new Promise(resolve => setTimeout(resolve, 30));
    f.accounts.share(f.ada.id, ['grant']);
    unshared.body.end(JSON.stringify({ title: 'Renamed after unsharing' }));
    assert.deepEqual((await unshared.response).json(), { error: 'Task not found.' });
    const removed = slow('/api/tasks/grant-task/rename');
    await new Promise(resolve => setTimeout(resolve, 30));
    f.accounts.remove(f.ada.id);
    removed.body.end(JSON.stringify({ title: 'Renamed after removal' }));
    assert.equal((await removed.response).statusCode, 401);
    assert.deepEqual([f.store.task('thesis-task').title, f.store.task('grant-task').title], ['thesis-task', 'grant-task']);
  } finally { await f.close(); }
});

test('sign-in attempts are limited per client, an IPv6 client by its /64, with no cap one client can exhaust', () => {
  const address = (forwarded: string) => clientAddress({ headers: { 'x-forwarded-for': forwarded } } as any);
  assert.equal(address('10.0.0.1, 203.0.113.7'), '203.0.113.7');
  assert.equal(address('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(address('2001:db8:1:2::99'), '2001:db8:1:2::/64');
  assert.equal(address('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(address('::ffff:198.51.100.4'), '198.51.100.4');
  assert.equal(clientAddress({ headers: {} } as any), 'unknown');
  const limiter = new Limiter(3, 10, () => 0);
  for (let i = 0; i < 3; i++) assert.ok(limiter.take('2001:db8:1:2::/64'));
  assert.equal(limiter.take('2001:db8:1:2::/64'), false);
  for (let i = 0; i < 500; i++) limiter.take(`198.51.100.${i % 250}-${i}`);
  assert.ok(limiter.take('203.0.113.7'), 'many attackers do not lock out someone else');
  for (let i = 0; i < 10; i++) assert.ok(limiter.take('unknown'));
  assert.equal(limiter.take('unknown'), false);
});

test('messages from an invited person carry their name; the owner\'s carry none', async () => {
  const f = await fixture();
  try {
    const sent = await f.remote.inject({ method: 'POST', url: '/api/tasks/thesis-task/messages', headers: f.as, payload: { text: 'Tighten the abstract.', requestKey: 'ada-request' } });
    assert.equal(sent.statusCode, 200, sent.body);
    const items = f.store.items('thesis-task');
    assert.deepEqual(items.at(-1)?.meta?.author, { id: f.ada.id, name: 'Ada' });
    const own = await f.local.inject({ method: 'POST', url: '/api/tasks/grant-task/messages', headers: { ...LOCAL, 'x-papilot-token': 'local-csrf' }, payload: { text: 'And the title.', requestKey: 'owner-request' } });
    assert.equal(own.statusCode, 200, own.body);
    assert.equal(f.store.items('grant-task').at(-1)?.meta?.author, undefined);
  } finally { await f.close(); }
});

test('this host and the tailnet keep working as before, and refuse Funnel traffic', async () => {
  const f = await fixture();
  try {
    const state = (await f.local.inject({ url: '/api/state', headers: LOCAL })).json();
    assert.deepEqual([state.csrf, state.viewer.role, state.viewer.listener, state.projects.length, state.runtimes.codex.account], ['local-csrf', 'owner', 'local', 2, 'owner@example.com']);
    assert.equal((await f.local.inject({ url: '/api/state', headers: { host: 'mini.example.ts.net:8443', 'tailscale-user-login': 'owner@example' } })).statusCode, 200);
    assert.equal((await f.local.inject({ url: '/api/state', headers: { ...LOCAL, 'tailscale-funnel-request': '?1' } })).statusCode, 403);
    assert.equal((await f.local.inject({ method: 'POST', url: '/api/tasks/grant-task/rename', headers: LOCAL, payload: { title: 'x' } })).statusCode, 403);
    assert.equal((await f.local.inject({ method: 'POST', url: '/api/auth/options', headers: LOCAL, payload: {} })).statusCode, 404, 'sign-in exists only at the public URL');
    // Deleting a task that is already gone still succeeds, so a lost response can be retried.
    const gone = await f.local.inject({ method: 'POST', url: '/api/tasks/gone/delete', headers: { ...LOCAL, 'x-papilot-token': 'local-csrf' }, payload: { confirm: true } });
    assert.equal(gone.statusCode, 200);
  } finally { await f.close(); }
});

test('a route without an access rule stops the server from starting', async () => {
  const f = await fixture();
  try {
    assert.throws(() => f.local.get('/api/unguarded', () => ({})), /has no access rule/);
    assert.throws(() => f.local.get('/api/things/:id', { config: { access: { task: 'thing' } } }, () => ({})), /no :thing parameter/);
  } finally { await f.close(); }
});

test('the public sign-in URL must be its own HTTPS origin', () => {
  assert.equal(accountProblem('', 7275, 7274, PUBLIC), null);
  assert.equal(accountProblem(ORIGIN, 7275, 7274, PUBLIC), null);
  assert.equal(accountProblem('http://localhost:7275', 7275, 7274, ''), null);
  assert.match(accountProblem('http://mini.example.ts.net', 7275, 7274, '')!, /https/);
  assert.match(accountProblem(PUBLIC, 7275, 7274, PUBLIC)!, /differ from PAPILOT_PUBLIC_ORIGIN/);
  assert.match(accountProblem(ORIGIN, 7274, 7274, PUBLIC)!, /PAPILOT_ACCOUNT_PORT/);
  assert.match(accountProblem(ORIGIN + '/papilot', 7275, 7274, PUBLIC)!, /without a path/);
  // HSTS would also cover a plain-HTTP tailnet endpoint on the same host name.
  assert.equal(accountHsts(ORIGIN, PUBLIC), true);
  assert.equal(accountHsts(ORIGIN, 'http://mini.example.ts.net:8081'), false);
  assert.equal(accountHsts(ORIGIN, 'http://100.64.0.1:8081'), true);
  assert.equal(accountHsts('http://localhost:7275', ''), false);
});
