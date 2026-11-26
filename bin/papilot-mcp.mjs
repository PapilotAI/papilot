#!/usr/bin/env node
// Papilot's agent tools as an MCP server over stdio, for agents that start
// MCP servers (ACP agents, Claude). It serves the schemas Papilot wrote beside
// the task's session file and forwards each call to Papilot with the session's
// current token, so one server started with a session reaches every later
// turn; between turns Papilot refuses the calls.
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

const sessionFile = process.argv[2];
if (!sessionFile) {
  process.stderr.write('Usage: node papilot-mcp.mjs SESSION\n');
  process.exit(1);
}
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const tools = () => JSON.parse(fs.readFileSync(path.join(path.dirname(sessionFile), 'tools.json'), 'utf8'))
  .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

async function call(name, args) {
  let session;
  try { session = JSON.parse(fs.readFileSync(sessionFile, 'utf8')); }
  catch { return { ok: false, text: 'Papilot tools are available only while Papilot runs a turn of this task.' }; }
  const url = new URL(session.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/tools') return { ok: false, text: 'Invalid local tool session.' };
  const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ tool: name, arguments: args ?? {} }) });
  const text = await response.text();
  if (response.ok) return { ok: true, text };
  try { return { ok: false, text: JSON.parse(text).error || text }; } catch { return { ok: false, text }; }
}

async function handle(message) {
  const { id, method, params } = message;
  if (id === undefined || id === null) return; // notifications need no reply
  try {
    if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'papilot', version: '1' } } });
    if (method === 'ping') return send({ id, result: {} });
    if (method === 'tools/list') return send({ id, result: { tools: tools() } });
    if (method === 'tools/call') {
      const { ok, text } = await call(params?.name, params?.arguments);
      return send({ id, result: { content: [{ type: 'text', text }], isError: !ok } });
    }
    send({ id, error: { code: -32601, message: `Unknown method: ${method}` } });
  } catch (error) {
    send({ id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
  }
}

createInterface({ input: process.stdin }).on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
  void handle(message);
});
