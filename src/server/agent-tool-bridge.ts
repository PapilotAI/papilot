import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Tool failures are read by the agent, as with Writer's toolError, not UI copy.
export const agentToolError = (message: string) => new Error(message);

interface Session { token: string; file: string; current(): boolean; call(tool: string, args: unknown): Promise<unknown> }
// A transport for agents with shell tools but no host-tool API. Capabilities
// belong to one task turn, never grant general API access, and expire with it.
export class AgentToolBridge {
  private server?: Server;
  private starting?: Promise<number>;
  private folder?: string;
  private sessions = new Map<string, Session>();
  private closed = false;
  constructor(private definitions: readonly unknown[]) {}

  private listen() {
    return this.starting ??= new Promise<number>((resolve, reject) => {
      const server = this.server = createServer(async (request, response) => {
        const send = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
        const fail = (status: number, error: string) => send(status, { error });
        const port = (server.address() as { port: number } | null)?.port;
        if (this.closed || request.headers.host !== `127.0.0.1:${port}` || request.headers.origin || request.method !== 'POST' || request.url !== '/tools') { fail(403, 'Invalid tool connection.'); return; }
        const session = [...this.sessions.values()].find(item => request.headers.authorization === `Bearer ${item.token}`);
        if (!session || !session.current()) { fail(403, 'This agent tool session has ended.'); return; }
        try {
          let size = 0; const chunks: Buffer[] = [];
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 256 * 1024) { fail(413, 'Tool request exceeds 256 KiB. Split the work into smaller calls.'); return; }
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!session.current()) throw agentToolError('This agent tool session has ended.');
          const result = body.tool === 'help' ? { tools: this.definitions } : await session.call(body.tool, body.arguments ?? {});
          send(200, result);
        } catch (error) { send(400, { error: error instanceof Error ? error.message : String(error) }); }
      });
      server.requestTimeout = 30000;
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.unref(); resolve((server.address() as { port: number }).port); });
    });
  }

  // The folder holds the tool schemas, which need no session, and one
  // private session file per task, rewritten with a new token every turn.
  private place() {
    if (!this.folder) {
      this.folder = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-tools-'));
      fs.writeFileSync(path.join(this.folder, 'tools.json'), JSON.stringify(this.definitions), { mode: 0o600 });
    }
    return this.folder;
  }
  private files = new Map<string, string>();
  /** The task's session file. It keeps its path across turns, so an agent
   * that starts a tool server once per session (MCP) reaches every later
   * turn; between turns its calls are refused. */
  file(id: string) {
    if (this.closed) throw agentToolError('Agent tools are closed.');
    let file = this.files.get(id);
    if (!file) this.files.set(id, file = path.join(this.place(), randomBytes(16).toString('hex') + '.json'));
    return file;
  }

  async open(id: string, current: () => boolean, call: Session['call']) {
    if (this.closed) throw agentToolError('Agent tools are closed.');
    const port = await this.listen();
    if (this.closed || !current()) throw agentToolError('This agent turn has ended.');
    const file = this.file(id), token = randomBytes(32).toString('hex');
    const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ url: `http://127.0.0.1:${port}/tools`, token }), { mode: 0o600 });
    fs.renameSync(temporary, file);
    this.sessions.set(id, { token, file, current, call });
    return file;
  }

  close() {
    this.closed = true;
    this.sessions.clear(); this.files.clear();
    this.server?.close(); this.server?.closeAllConnections();
    if (this.folder) fs.rmSync(this.folder, { recursive: true, force: true });
  }
}
