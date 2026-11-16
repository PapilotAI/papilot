import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Codex } from '../src/server/codex.ts';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';

// The real app-server from the @openai/codex dev dependency, with a canned
// local model endpoint. A loaded thread runs the user's stdio MCP servers in
// its working directory; this one records where it runs.
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

// Before, Windows could not remove the helper's folder while those servers
// ran in it, so writing a commit message failed with EPERM.
test('a commit message stops the MCP servers Codex runs for its helper turn and removes its folder', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codex-helper-'));
  const paper = path.join(dir, 'paper'), home = path.join(dir, 'home'), server = path.join(dir, 'mcp-server.mjs'), log = path.join(dir, 'mcp-servers.log');
  for (const folder of [paper, home]) fs.mkdirSync(folder);
  fs.writeFileSync(server, MCP_SERVER);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: paper, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  for (const [key, value] of [['user.name', 'Test'], ['user.email', 'test@localhost'], ['commit.gpgsign', 'false']]) git('config', key, value);
  fs.writeFileSync(path.join(paper, 'main.tex'), 'Original opening.\n');
  git('add', '.'); git('commit', '-qm', 'Draft the introduction');
  fs.writeFileSync(path.join(paper, 'main.tex'), 'Tighter opening.\n');
  const model = createServer(async (req, res) => {
    for await (const _chunk of req) { /* The canned reply ignores the request. */ }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const text = 'Tighten the opening sentence';
    const message = { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
    const response = { id: 'resp_fixture', object: 'response', status: 'completed', output: [message], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    for (const event of [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
      { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: text },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response },
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  const port = (model.address() as { port: number }).port;
  const settings = ['model="fixture"', 'model_provider="fixture"', 'model_providers.fixture.name="Fixture"', `model_providers.fixture.base_url="http://127.0.0.1:${port}/v1"`, 'model_providers.fixture.wire_api="responses"', 'model_providers.fixture.requires_openai_auth=false',
    `mcp_servers.holder.command=${JSON.stringify(process.execPath)}`, `mcp_servers.holder.args=${JSON.stringify([server, log])}`];
  const codex = new Codex(CODEX, ['app-server', '--listen', 'stdio://', ...settings.flatMap(setting => ['-c', setting])], { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TMPDIR: os.tmpdir() });
  const store = new Store(':memory:'), workspace = new Workspace(store, codex);
  const started = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { pid: number; cwd: string }) : [];
  try {
    await codex.start();
    Object.assign(workspace.runtimes.codex, { connected: true, authenticated: true, models: [{ id: 'fixture', name: 'Fixture', isDefault: true, efforts: [], defaultEffort: null }] });
    store.saveProject({ id: 'paper', name: 'Paper', path: paper, createdAt: 1 });
    assert.deepEqual(await workspace.commitMessage('paper', ['main.tex']), { message: 'Tighten the opening sentence', agent: 'codex' });
    const [helper, ...others] = started();
    assert.ok(helper, `Codex did not start the MCP server: ${codex.stderr}`);
    assert.deepEqual(others, []);
    assert.match(path.basename(helper.cwd), /^papilot-helper-/, 'Codex ran the MCP server in the helper’s own folder');
    assert.equal(fs.existsSync(helper.cwd), false);
    assert.deepEqual((await codex.request('thread/loaded/list', {})).data, []);
    await eventually(() => !running(helper.pid), `The helper's MCP server ${helper.pid} is still running.`);
    assert.equal(codex.ready, true);
  } finally {
    // Remove the Codex home only after Codex has exited.
    const child = codex.child, closed = child && child.exitCode === null ? once(child, 'close') : null;
    workspace.close(); await closed;
    store.close(); model.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
