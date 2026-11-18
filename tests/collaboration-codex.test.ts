import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Codex } from '../src/server/codex.ts';
import { delegateWorkflow, runWorkflowHelper, type WorkflowGenerate } from '../src/server/collaboration.ts';

// The installed native runtime talks only to a disposable canned Responses
// endpoint. This exercises real tool registration, sandboxing and apply_patch,
// without host credentials or live model calls.
test('native Codex workers edit snapshots without inherited tools, network or writable roots', { timeout: 60000 }, async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-codex-worker-')));
  const paper = path.join(dir, 'paper'), extra = path.join(dir, 'extra'), home = path.join(dir, 'home');
  for (const folder of [paper, extra, home]) fs.mkdirSync(folder);
  const original = 'Original text.\n', protectedFile = path.join(extra, 'secret.txt'), marker = path.join(dir, 'mcp-started');
  fs.writeFileSync(path.join(paper, 'main.tex'), original); fs.writeFileSync(protectedFile, 'Protected.\n');
  const mcp = path.join(dir, 'mcp.mjs'); fs.writeFileSync(mcp, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'started');`);
  const requests: any[] = [], starts: any[] = [], turns: any[] = [], runtimes: Codex[] = [];
  const endpoint = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    const number = requests.length;
    const input = number === 2
      ? `*** Begin Patch\n*** Update File: ${protectedFile.replaceAll('\\', '/')}\n@@\n-Protected.\n+Overwritten.\n*** End Patch`
      : '*** Begin Patch\n*** Update File: main.tex\n@@\n-Original text.\n+Checked text.\n*** End Patch';
    const item = number === 1
      ? { id: `tool_${number}`, type: 'function_call', call_id: `call_${number}`, name: 'exec_command', arguments: JSON.stringify({ cmd: 'echo should-not-run' }), status: 'completed' }
      : number <= 3 ? { id: `tool_${number}`, type: 'custom_tool_call', call_id: `call_${number}`, name: 'apply_patch', input, status: 'completed' }
      : { id: `message_${number}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Checked annotation note:1.', annotations: [] }] };
    const response = { id: `response_${number}`, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const event of [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress' } },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response },
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  endpoint.listen(0, '127.0.0.1'); await once(endpoint, 'listening');
  const port = (endpoint.address() as { port: number }).port, selected = 'gpt-6.1-sol';
  const settings = ['model_provider="fixture"', 'model_providers.fixture.name="Fixture"', `model_providers.fixture.base_url="http://127.0.0.1:${port}/v1"`, 'model_providers.fixture.wire_api="responses"', 'model_providers.fixture.requires_openai_auth=false',
    `sandbox_workspace_write.writable_roots=[${JSON.stringify(extra)}]`, 'sandbox_workspace_write.network_access=true', 'features.shell_tool=true', 'features.multi_agent=true',
    `mcp_servers.host_fixture.command=${JSON.stringify(process.execPath)}`, `mcp_servers.host_fixture.args=${JSON.stringify([mcp])}`];
  const binary = path.join(process.cwd(), 'node_modules/.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
  const factory = () => {
    const runtime = new Codex(binary, ['app-server', '--listen', 'stdio://', ...settings.flatMap(setting => ['-c', setting])], { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TMPDIR: os.tmpdir() });
    const request = runtime.request.bind(runtime);
    runtime.request = async (method, params, timeout) => {
      const result = await request(method, params, timeout);
      if (method === 'thread/start') starts.push({ params, result });
      if (method === 'turn/start') turns.push(params);
      return result;
    };
    runtimes.push(runtime); return runtime;
  };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
  let copy = '';
  const generate: WorkflowGenerate = async (worker, prompt, signal, edit) => {
    copy = edit!.cwd;
    assert.equal(copy, fs.realpathSync.native(copy), 'the native sandbox must see expanded Windows paths');
    const summary = await runWorkflowHelper(worker, prompt, signal, edit, undefined, factory);
    assert.equal(fs.readFileSync(path.join(paper, 'main.tex'), 'utf8'), original, 'the worker has not edited the task');
    assert.equal(fs.readFileSync(path.join(copy, 'main.tex'), 'utf8'), 'Checked text.\n');
    return summary;
  };
  try {
    const notes = [{ id: 'note:1', where: 'main.tex', quote: 'Original text.', comment: 'Check the text.' }];
    const result = await delegateWorkflow(paper, notes, { role: 'rigorous', annotationIds: ['note:1'], instruction: 'Check the text.', sources: [{ file: 'main.tex', quote: 'Original text.' }] }, generate, controller.signal, () => true, () => ({ agent: 'codex', model: selected, effort: null }));
    assert.equal(result.status, 'applied'); assert.deepEqual(result.appliedFiles, ['main.tex']);
    assert.equal(fs.readFileSync(path.join(paper, 'main.tex'), 'utf8'), 'Checked text.\n');
    assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'Protected.\n'); assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(copy), false); assert.equal(requests.length, 4);
    const names = (tools: any[]): string[] => tools.flatMap(tool => tool.tools ? names(tool.tools) : [tool.name || tool.function?.name || tool.type]);
    const tools = names(requests[0].tools || requests[0].input.filter((item: any) => item.type === 'additional_tools').flatMap((item: any) => item.tools));
    assert.equal(tools.some((tool: string) => /exec_command|shell|spawn_agent|send_message|mcp|web_search|view_image|browser|computer|image_gen/.test(tool)), false, JSON.stringify(tools));
    assert.match(JSON.stringify(requests[1].input), /unsupported|unknown|not found/i, 'the native runtime refused the shell tool');
    assert.match(JSON.stringify(requests[2].input), /reject|denied|outside|approval/i, 'the native runtime refused the outside patch');
    assert.equal(starts[0].params.model, selected); assert.equal(starts[0].params.cwd, copy);
    assert.equal(starts[0].params.dynamicTools, undefined, 'workers cannot call the coordinator delegation tools');
    assert.equal(starts[0].params.config['mcp_servers.host_fixture.enabled'], false);
    assert.equal(turns[0].sandboxPolicy.type, 'workspaceWrite'); assert.deepEqual(turns[0].sandboxPolicy.writableRoots, []);
    assert.equal(turns[0].sandboxPolicy.networkAccess, false); assert.equal(turns[0].approvalPolicy, 'never');
    assert.ok(runtimes.every(runtime => runtime.child === null));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nNative runtime: ${runtimes.map(runtime => runtime.stderr).join('\n')}`, { cause: error });
  } finally {
    clearTimeout(timer); controller.abort(); runtimes.forEach(runtime => runtime.close());
    endpoint.closeAllConnections(); await new Promise<void>(resolve => endpoint.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
