import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { RuntimeClient } from '../src/runtime-client.ts';
import { bridgeScript } from '../src/bridge.ts';
import type { Project, Snapshot, SourceFile, SourceSave } from '../../../src/shared.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const script = path.join(root, 'extensions/vscode/src/runtime-worker.mjs');
const paper = '\\documentclass{article}\n\\begin{document}\nOriginal wording.\n\\end{document}\n';
test('embedded runtime uses the existing project, source-save and compile APIs, and stops without a backend process', { timeout: 90000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-extension-')), repo = path.join(home, 'paper');
  fs.mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', path.join(home, 'no-hooks'));
  fs.writeFileSync(path.join(repo, 'main.tex'), paper);
  git('add', '.'); git('commit', '-qm', 'Initial');
  const log: string[] = [], data = path.join(home, 'data');
  let client = new RuntimeClient(script, root, data, bridgeScript('test-token'), text => log.push(text), false);
  try {
    const url = await client.ready;
    assert.equal((await client.request<Snapshot>('/state')).projects.length, 0);
    const ordinary = await fetch(url);
    assert.equal(ordinary.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(await ordinary.text(), /\/host.js/);
    await client.call({ type: 'host', origin: url, ancestors: ['https://editor.example'] });
    const embedded = await fetch(url);
    assert.equal(embedded.headers.get('x-frame-options'), null);
    assert.equal(embedded.headers.get('content-security-policy'), "frame-ancestors 'self' https://editor.example");
    assert.equal((await fetch(url + '/api/projects/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }) })).status, 403);
    const { project } = await client.request<{ project: Project }>('/projects/open', { path: repo });
    assert.equal((await client.request<{ project: Project }>('/projects/open', { path: repo })).project.id, project.id);
    assert.equal(git('status', '--porcelain'), '');
    const source = await client.request<SourceFile>(`/projects/${project.id}/manuscript/source?file=main.tex`);
    const input = { id: 'test-save', file: source.file, revision: source.revision, text: paper.replace('Original', 'Revised') };
    const saved = await client.request<SourceSave>(`/projects/${project.id}/manuscript/source`, input);
    assert.equal(saved.source.text, input.text);
    const replay = await client.request<SourceSave>(`/projects/${project.id}/manuscript/source`, input);
    assert.equal(replay.source.revision, saved.source.revision);
    await assert.rejects(client.request(`/projects/${project.id}/manuscript/source`, { ...input, id: 'stale-save', text: paper }), /changed/i);
    await assert.rejects(client.request(`/projects/${project.id}/manuscript/source?file=..%2Foutside.tex`));
    let built: any;
    for (let i = 0; i < 100; i++) {
      built = await client.request(`/projects/${project.id}/manuscript`);
      if (built.build.status !== 'building') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(built.build.status, 'ready', JSON.stringify(built.build));
    const pdf = await fetch(url + `/api/projects/${project.id}/manuscript.pdf?key=${built.build.key}`);
    assert.equal(pdf.status, 200);
    assert.match(Buffer.from(await pdf.arrayBuffer()).subarray(0, 8).toString(), /%PDF/);
    // The HTTP proxy starts the normal review engine, now in an owned thread.
    await fetch(url + `/review/${project.id}/`);
    const connectionFile = path.join(repo, '.git/papilot/server/connection.json');
    const connection = JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
    assert.equal(connection.pid, process.pid, 'The engine shares the extension host process');
    const info = await fetch(connection.url + '/api/info').then(response => response.json());
    assert.equal(info.root, repo);
    const engine = async (route: string, body?: unknown): Promise<any> => {
      const response = await fetch(connection.url + route, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', 'x-review-token': info.csrf },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json(); assert.equal(response.ok, true, JSON.stringify(value)); return value;
    };
    const task = await engine('/api/tasks', { name: 'editing', files: ['main.tex'], deferred: true });
    fs.writeFileSync(path.join(task.worktree, 'main.tex'), paper.replace('Original', 'Proposed'));
    const job = await engine('/api/tasks/editing/publish', { requestId: 'publish-edit' });
    let result;
    for (let i = 0; i < 250; i++) {
      result = await engine(`/api/jobs/${job.job}`);
      if (!['queued', 'running'].includes(result.status)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(result.status, 'done', JSON.stringify(result));
    assert.equal(fs.readFileSync(path.join(repo, 'main.tex'), 'utf8'), input.text, 'Review keeps the manuscript unchanged');
    await client.close();
    assert.equal(fs.existsSync(connectionFile), false);
    await assert.rejects(fetch(url + '/api/health'));
    client = new RuntimeClient(script, root, data, bridgeScript('new-token'), text => log.push(text), false);
    await client.ready;
    const state = await client.request<Snapshot>('/state');
    assert.deepEqual(state.projects.map(item => item.id), [project.id]);
    assert.equal(fs.readFileSync(path.join(repo, 'main.tex'), 'utf8'), input.text);
  } catch (error) { console.error(log.join('')); throw error; }
  finally { await client.close(); fs.rmSync(home, { recursive: true, force: true }); }
});
