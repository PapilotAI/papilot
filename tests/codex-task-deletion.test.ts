import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Codex, RpcResponseError } from '../src/server/codex.ts';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';
import type { ReviewClient } from '../src/server/review.ts';
import { Fixture } from '../engine/tests/ts/helpers.ts';
import { createServer } from '../engine/src/server.ts';

// The real app-server from the @openai/codex dev dependency. A loaded thread
// runs the user's stdio MCP servers in its working directory, which Windows
// then cannot delete (issue #179). This one records where it runs.
const CODEX = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
const MCP_SERVER = `import fs from 'node:fs';
import { createInterface } from 'node:readline';
fs.appendFileSync(process.argv[2], JSON.stringify({ pid: process.pid, cwd: process.cwd() }) + '\\n');
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'folder-holder', version: '1.0.0' } } });
  else if (method === 'tools/list') send({ id, result: { tools: [] } });
  else if (id !== undefined) send({ id, error: { code: -32601, message: 'Not found' } });
}).on('close', () => process.exit(0));
`;
const running = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function eventually(check: () => boolean | Promise<boolean>, what: string) {
  for (const deadline = Date.now() + 15000; Date.now() < deadline; await new Promise(resolve => setTimeout(resolve, 50))) if (await check()) return;
  assert.fail(what);
}

test('deleting a Codex task stops the MCP servers Codex runs in its worktree, then removes it', { timeout: 60000 }, async () => {
  const disk = new Fixture(), app = disk.app(), engine = createServer(app), store = new Store(':memory:');
  const home = path.join(disk.base, 'codex-home'), server = path.join(disk.base, 'mcp-server.mjs'), log = path.join(disk.base, 'mcp-servers.log');
  fs.mkdirSync(home); fs.writeFileSync(server, MCP_SERVER);
  const codex = new Codex(CODEX, ['app-server', '--listen', 'stdio://', '-c', `mcp_servers.holder.command=${JSON.stringify(process.execPath)}`, '-c', `mcp_servers.holder.args=${JSON.stringify([server, log])}`],
    { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TMPDIR: os.tmpdir() });
  let workspace: Workspace | undefined;
  const started = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { pid: number; cwd: string }) : [];
  try {
    const target = app.tasks.create('p-task', 'Delete this task', [], ['paper']);
    app.url = await engine.listen({ port: 0, host: '127.0.0.1' });
    const call = async (method: string, route: string, body?: unknown) => {
      const response = await fetch(app.url + route, { method, headers: { 'Content-Type': 'application/json', 'X-Review-Token': app.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      return value;
    };
    const review: ReviewClient = { url: app.url, token: app.csrf, get: route => call('GET', route), post: (route, body = {}) => call('POST', route, body) };
    workspace = new Workspace(store, codex, async () => review);
    await codex.start();
    const loaded = async () => (await codex.request('thread/loaded/list', {})).data as string[];
    // The task's thread, as its first turn starts it.
    const { thread } = await codex.request('thread/start', { cwd: target.worktree, approvalPolicy: 'on-request', sandbox: 'workspace-write' });
    await eventually(() => started().length > 0, `Codex did not start the MCP server: ${codex.stderr}`);
    const [held] = started();
    assert.equal(fs.realpathSync.native(held.cwd), fs.realpathSync.native(target.worktree), 'Codex runs MCP servers in the thread’s working directory');
    // Each later turn resolves its permissions on a probe thread there; the
    // probe unloads as soon as it is done, rather than holding the folder.
    await codex.taskPermissionConfig('workspace', target.worktree);
    await eventually(async () => JSON.stringify(await loaded()) === JSON.stringify([thread.id]), 'The permission probe stayed loaded.');
    store.saveProject({ id: 'paper', name: 'Paper', path: disk.root, createdAt: 1 });
    store.saveTask({ id: 'task-id', projectId: 'paper', agent: 'codex', name: target.name, title: target.title, instructions: 'Edit the paper.', worktree: target.worktree, threadId: thread.id, turnId: null, model: null, status: 'idle', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null });
    assert.deepEqual(await workspace.deleteTask('task-id'), { ok: true });
    assert.equal(fs.existsSync(target.worktree), false);
    assert.equal(store.tasks().length, 0);
    assert.equal(app.tasks.get(target.name, false).closed !== null, true);
    // Codex is still running: only the deleted task's thread has stopped.
    await eventually(() => !running(held.pid), `The task thread's MCP server ${held.pid} is still running.`);
    await eventually(async () => (await loaded()).length === 0, 'The task thread is still loaded.');
    for (const entry of started()) await eventually(() => !running(entry.pid), `The MCP server ${entry.pid} in ${entry.cwd} is still running.`);
    assert.equal(codex.ready, true);
  } finally {
    // Remove the Codex home only after Codex has exited.
    const child = codex.child, closed = child && child.exitCode === null ? once(child, 'close') : null;
    workspace?.close(); codex.close(); await closed;
    store.close(); await engine.close(); await disk.close();
  }
});

test('Codex unsubscribes from a thread it cannot archive, so the thread still unloads', async () => {
  const codex = new Codex();
  const calls: string[] = [];
  codex.request = async method => {
    calls.push(method);
    if (method === 'thread/archive') throw new RpcResponseError('no rollout found for thread id thread');
    return { status: 'unsubscribed' };
  };
  await assert.rejects(codex.closeThread('thread'), /no rollout found/);
  assert.deepEqual(calls, ['thread/archive', 'thread/unsubscribe']);
});
