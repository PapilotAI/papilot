import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';
import { Manuscripts } from '../src/server/manuscript.ts';
import { ensureSinglePaper } from '../src/server/runtime.ts';
import { buildApp, gitQueue } from '../src/server/app.ts';
import { parseAllowedAgents, readHostChromeConfig, resolveHostChrome } from '../src/server/host-chrome.ts';
import type { Codex } from '../src/server/codex.ts';
import type { ReviewClient } from '../src/server/review.ts';
import { AGENT_IDS, type AgentId } from '../src/shared.ts';

class CountingAgent extends EventEmitter {
  ready = false;
  detectCalls = 0;
  startCalls = 0;
  detect() { this.detectCalls++; return true; }
  async start() { this.startCalls++; this.ready = true; }
  async request(method: string) {
    if (method === 'account/read') return { account: { email: 'user@example.com' }, requiresOpenaiAuth: false };
    if (method === 'model/list') return { data: [{ id: 'model-a', displayName: 'Model A', isDefault: true, supportedReasoningEfforts: [] }] };
    return {};
  }
  respond() {}
  reject() {}
  close() {}
}

test('parseAllowedAgents parses valid allowlists and preserves AGENT_IDS order', () => {
  assert.equal(parseAllowedAgents(undefined), null);
  assert.equal(parseAllowedAgents('   '), null);
  assert.deepEqual(parseAllowedAgents('papilot'), ['papilot']);
  assert.deepEqual(parseAllowedAgents('claude, papilot, unknown, PAPILOT'), ['papilot', 'claude']);
  assert.deepEqual(parseAllowedAgents('unknown-only'), []);
});

test('readHostChromeConfig validates http/https URLs and rejects unsafe schemes', () => {
  assert.equal(readHostChromeConfig({}), null);
  const cfg = readHostChromeConfig({
    PAPILOT_HOST_NAME: 'Lab Host',
    PAPILOT_HOST_HOME_URL: 'https://host.example/projects',
    PAPILOT_HOST_ACCOUNT_URL: 'javascript:alert(1)',
    PAPILOT_HOST_BILLING_URL: 'http://localhost:3000/usage',
    PAPILOT_HOST_LOGOUT_URL: 'data:text/html,nope',
    PAPILOT_TRUST_HOST_HEADERS: '1',
  });
  assert.deepEqual(cfg, {
    name: 'Lab Host',
    homeUrl: 'https://host.example/projects',
    billingUrl: 'http://localhost:3000/usage',
    trustHeaders: true,
  });
});

test('resolveHostChrome trusts user headers only from loopback when enabled', () => {
  const trusted = readHostChromeConfig({
    PAPILOT_HOST_HOME_URL: 'https://host.example/',
    PAPILOT_TRUST_HOST_HEADERS: '1',
  });
  const untrusted = readHostChromeConfig({
    PAPILOT_HOST_HOME_URL: 'https://host.example/',
  });
  const headers = {
    'x-papilot-user-name': 'Ada Lovelace',
    'x-papilot-user-email': 'ada@example.com',
    'x-papilot-user-plan': 'Pro',
    'x-papilot-usage-pct': '42.4',
  };
  assert.deepEqual(resolveHostChrome(trusted, headers, '127.0.0.1'), {
    homeUrl: 'https://host.example/',
    user: { name: 'Ada Lovelace', email: 'ada@example.com', plan: 'Pro', usagePercent: 42 },
  });
  assert.deepEqual(resolveHostChrome(trusted, { 'x-papilot-usage-pct': '150' }, '::1'), {
    homeUrl: 'https://host.example/',
    user: { usagePercent: 100 },
  });
  assert.deepEqual(resolveHostChrome(trusted, headers, '10.0.0.5'), {
    homeUrl: 'https://host.example/',
  });
  assert.deepEqual(resolveHostChrome(untrusted, headers, '127.0.0.1'), {
    homeUrl: 'https://host.example/',
  });
});

test('PAPILOT_ALLOWED_AGENTS restricts agent startup, snapshot runtimes, and task/settings routes', async () => {
  const store = new Store(':memory:');
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-allowed-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>app</html>');
  const agents = Object.fromEntries(AGENT_IDS.map(id => [id, new CountingAgent()])) as Record<AgentId, CountingAgent>;
  const review: ReviewClient = { url: 'http://127.0.0.1:9', token: 'tok', get: async () => ({}) as any, post: async () => ({}) as any };
  const workspace = new Workspace(
    store,
    agents.codex as unknown as Codex,
    async () => review,
    Object.fromEntries(AGENT_IDS.filter(id => id !== 'codex').map(id => [id, agents[id] as unknown as Codex])),
    ['papilot'],
  );
  store.saveProject({ id: 'paper-1', name: 'Paper 1', path: '/unused/paper-1', createdAt: 1 });
  const listener = { kind: 'local' as const, port: 7274, publicOrigin: '', owner: '' };
  const app = await buildApp({
    listener, store, workspace, manuscripts: new Manuscripts(), csrf: 'csrf-tok',
    serialGit: gitQueue(), dist, version: '0.15.0', connectReview: async () => review,
    singlePaper: true,
    hostChrome: { homeUrl: 'https://host.example/', billingUrl: 'https://host.example/usage', trustHeaders: true },
  });
  try {
    await workspace.connect();
    assert.equal(agents.papilot.startCalls, 1);
    assert.equal(agents.codex.startCalls, 0);
    assert.equal(agents.codex.detectCalls, 0);
    assert.equal(agents.claude.startCalls, 0);

    const stateRes = await app.inject({
      url: '/api/state',
      remoteAddress: '127.0.0.1',
      headers: {
        host: '127.0.0.1:7274',
        'x-papilot-user-name': 'Grace Hopper',
        'x-papilot-user-email': 'grace@example.com',
        'x-papilot-usage-pct': '37',
      },
    });
    assert.equal(stateRes.statusCode, 200);
    const state = stateRes.json();
    assert.deepEqual(state.allowedAgents, ['papilot']);
    assert.deepEqual(Object.keys(state.runtimes), ['papilot']);
    assert.equal(state.singlePaper, true);
    assert.deepEqual(state.host, {
      homeUrl: 'https://host.example/',
      billingUrl: 'https://host.example/usage',
      user: { name: 'Grace Hopper', email: 'grace@example.com', usagePercent: 37 },
    });

    const headers = { host: '127.0.0.1:7274', origin: 'http://127.0.0.1:7274', 'x-papilot-token': 'csrf-tok' };
    // Disallowed agent rejected on task creation, agent-settings, and usage routes.
    const badTask = await app.inject({
      method: 'POST', url: '/api/tasks', headers,
      payload: { id: 'task-1234567890abcdef', projectId: 'paper-1', title: 'Edit', instructions: 'Polish intro', agent: 'codex' },
    });
    assert.equal(badTask.statusCode, 400);
    assert.match(badTask.json().error, /not enabled on this host/i);

    const badSettings = await app.inject({
      method: 'POST', url: '/api/agent-settings', headers,
      payload: { agent: 'claude', enabled: true },
    });
    assert.equal(badSettings.statusCode, 400);

    const badUsage = await app.inject({ method: 'POST', url: '/api/runtime/codex/usage', headers });
    assert.equal(badUsage.statusCode, 400);

    const badCollab = await app.inject({ method: 'POST', url: '/api/collaboration', headers, payload: { reset: true } });
    assert.equal(badCollab.statusCode, 400);

    const badChatgpt = await app.inject({ method: 'POST', url: '/api/chatgpt-pro', headers, payload: { autoSyncGithub: true } });
    assert.equal(badChatgpt.statusCode, 400);

    store.saveTask({ id: 'legacy-codex-task', projectId: 'paper-1', name: 'p-legacy', title: 'Legacy', instructions: 'Edit', worktree: '/unused', threadId: null, turnId: null, agent: 'codex', model: null, status: 'idle', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null });
    const badMsg = await app.inject({ method: 'POST', url: '/api/tasks/legacy-codex-task/messages', headers, payload: { text: 'More', requestKey: 'req-1' } });
    assert.equal(badMsg.statusCode, 400);
    assert.match(badMsg.json().error, /not enabled on this host/i);

    // Single-paper mode blocks adding/removing/importing papers while keeping rename available.
    const createRes = await app.inject({ method: 'POST', url: '/api/projects/create', headers, payload: { name: 'Other' } });
    assert.equal(createRes.statusCode, 403);
    const importRes = await app.inject({ method: 'GET', url: '/api/imports/any-id', headers: { host: '127.0.0.1:7274' } });
    assert.equal(importRes.statusCode, 403);
    const removeRes = await app.inject({ method: 'POST', url: '/api/projects/paper-1/remove', headers, payload: {} });
    assert.equal(removeRes.statusCode, 403);
    const renameRes = await app.inject({ method: 'POST', url: '/api/projects/paper-1/rename', headers, payload: { name: 'Renamed Paper' } });
    assert.equal(renameRes.statusCode, 200);
    assert.equal(renameRes.json().name, 'Renamed Paper');
  } finally {
    await app.close();
    workspace.close();
    store.close();
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test('ensureSinglePaper initializes and registers a dedicated paper directory idempotently', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-single-paper-'));
  const store = new Store(':memory:');
  const workspace = new Workspace(store, new CountingAgent() as unknown as Codex, undefined, undefined, ['papilot']);
  try {
    fs.writeFileSync(path.join(dir, 'main.tex'), '\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n');
    const first = await ensureSinglePaper(workspace, dir, 'My Manuscript');
    assert.ok(first);
    assert.equal(first.name, 'My Manuscript');
    const second = await ensureSinglePaper(workspace, dir, 'Ignored Second Name');
    assert.equal(second?.id, first.id);
    assert.equal(store.projects().length, 1);
    const head = execFileSync('git', ['-C', dir, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.ok(head.length >= 7);
  } finally {
    workspace.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
