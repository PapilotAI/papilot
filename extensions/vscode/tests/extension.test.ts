import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Run the actual extension commands and message handlers with disposable files
// and a fake VS Code API. No agent, server, or user's editor state is involved.
test('review actions use the current task and protect aliased unsaved buffers', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'papilot-host-bridge-'));
  const subscriptions: { dispose(): void }[] = [], commands = new Map<string, (...args: any[]) => any>();
  const responses: any[] = [], errors: string[] = [], opened: string[] = [], requests: string[] = [], apiCalls: string[] = [];
  const disposable = () => ({ dispose() {} });
  const uri = (file: string) => ({ fsPath: file, scheme: 'file', toString: () => pathToFileURL(file).href });
  const manuscript = path.join(directory, 'paper'), worktree = path.join(directory, 'task'), alias = path.join(directory, 'alias');
  await fs.mkdir(manuscript); await fs.mkdir(worktree);
  await fs.writeFile(path.join(manuscript, 'main.tex'), 'original');
  await fs.writeFile(path.join(worktree, 'main.tex'), 'revision');
  await fs.symlink(worktree, alias, 'dir');
  const project = { id: 'project', path: manuscript, name: 'Paper' };
  const paper = { project, document: 'main.tex', key: 'project:main.tex' };
  const preparing = { id: 'task', projectId: project.id, name: 'task', title: 'Revise', document: paper.document, worktree: '', status: 'preparing' };
  let snapshot = { projects: [project], tasks: [preparing] }, receive: (message: any) => Promise<void>;
  const textDocuments: any[] = [];
  const backend = {
    dispose() {},
    async api(route: string) { apiCalls.push(route); return route === '/api/state' ? snapshot : {}; },
    async request(route: string) { requests.push(route); return { status: 200, body: Buffer.from('{}').toString('base64') }; },
  };
  const git = { state: 'initialized', git: { path: 'git' }, repositories: [], onDidOpenRepository: disposable, onDidCloseRepository: disposable };
  const vscode = {
    l10n: { t: (source: string, args: Record<string, string> = {}) => source.replace(/\{(\w+)\}/g, (_, key) => args[key]) },
    Uri: { file: uri, joinPath: (base: any, ...parts: string[]) => uri(path.join(base.fsPath, ...parts)) },
    EventEmitter: class { event = disposable; fire() {} dispose() {} },
    TabInputText: class {}, Range: class {}, ViewColumn: { Beside: -2, Two: 2 },
    TreeItem: class {}, TreeItemCollapsibleState: { Expanded: 2 }, ThemeIcon: class {}, Diagnostic: class {}, DiagnosticSeverity: {},
    extensions: { getExtension: () => ({ activate: async () => ({ getAPI: () => git }) }) },
    languages: { createDiagnosticCollection: disposable },
    commands: { registerCommand(name: string, fn: any) { commands.set(name, fn); return disposable(); }, async executeCommand(name: string, ...args: any[]) { return commands.get(name)?.(...args); } },
    workspace: {
      isTrusted: true, textDocuments, findFiles: async () => [],
      createFileSystemWatcher: () => ({ ...disposable(), onDidCreate: disposable, onDidDelete: disposable, onDidChange: disposable }),
      onDidSaveTextDocument: disposable, onDidChangeWorkspaceFolders: disposable,
      openTextDocument: async (uri: any) => ({ uri, lineCount: 1 }),
    },
    window: {
      createOutputChannel: () => ({ ...disposable(), append() {}, appendLine() {} }),
      registerTreeDataProvider: disposable, registerWebviewViewProvider: disposable,
      showErrorMessage: (message: string) => errors.push(message), tabGroups: { all: [] },
      showTextDocument: (document: any) => opened.push(document.uri.fsPath),
      createWebviewPanel: () => { let handler: (message: any) => Promise<void>; return ({
        ...disposable(), visible: false, onDidDispose: disposable, onDidChangeViewState: disposable,
        reveal() { receive = handler; },
        webview: { asWebviewUri: (uri: any) => uri, onDidReceiveMessage: (listener: any) => { handler = receive = listener; return disposable(); }, postMessage: async (message: any) => responses.push(message) },
      }); },
    },
  };
  const fixture = globalThis as typeof globalThis & { papilotTest?: unknown };
  fixture.papilotTest = { vscode, backend };
  try {
    const outfile = path.join(directory, 'extension.mjs');
    await build({ entryPoints: [new URL('../src/extension.ts', import.meta.url).pathname], outfile, bundle: true, platform: 'node', format: 'esm', plugins: [{
      name: 'host-fixture', setup(build) {
        build.onResolve({ filter: /^(?:vscode|\.\/backend\.ts)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'vscode'
          ? `export const {${Object.keys(vscode).join(',')}} = globalThis.papilotTest.vscode;`
          : 'export class Backend { constructor() { return globalThis.papilotTest.backend; } }' }));
      },
    }] });
    const { activate } = await import(pathToFileURL(outfile).href);
    const extension = await activate({ subscriptions, storageUri: uri(directory), extensionPath: directory, extensionUri: uri(directory) });
    extension.papers.papers = [paper];
    await commands.get('papilot.openTask')!(preparing);
    await commands.get('papilot.review')!();
    const send = async (message: any) => { await receive({ id: responses.length + 1, ...message }); return responses.at(-1); };
    assert.match((await send({ type: 'source', file: 'main.tex' })).error, /not available yet/);
    assert.deepEqual(opened, [], 'preparing tasks must not open the manuscript');

    snapshot = { ...snapshot, tasks: [{ ...preparing, status: 'reviewing', worktree }] };
    await extension.refresh(); extension.papers.papers = [paper];
    assert.equal((await send({ type: 'source', file: 'main.tex' })).error, undefined);
    assert.deepEqual(opened, [path.join(worktree, 'main.tex')], 'the existing panel must use the new task snapshot');
    const decide = { type: 'api', route: '/review/project/api/tasks/task/decide', body: { action: 'reject' } };
    textDocuments.push({ isDirty: true, uri: uri(path.join(alias, 'main.tex')) });
    for (const action of ['decide', 'undo']) {
      assert.match((await send({ ...decide, route: decide.route.replace('decide', action) })).error, /Save your edited files/);
    }
    assert.deepEqual(requests, [], 'aliased unsaved task files must block writes');
    const fileAlias = path.join(directory, 'task-file.tex');
    await fs.symlink(path.join(worktree, 'main.tex'), fileAlias);
    await fs.unlink(path.join(worktree, 'main.tex'));
    textDocuments[0].uri = uri(fileAlias);
    assert.match((await send(decide)).error, /Save your edited files/, 'deleted symlink targets still have unsaved buffers');
    assert.deepEqual(requests, []);
    const outside = path.join(directory, 'outside.tex');
    await fs.writeFile(outside, 'external source');
    await fs.symlink(outside, path.join(worktree, 'external.tex'));
    for (const entry of [worktree, alias]) {
      textDocuments[0].uri = uri(path.join(entry, 'external.tex'));
      assert.match((await send(decide)).error, /Save your edited files/, 'Git can replace a symlink entry with an external target');
    }
    assert.deepEqual(requests, []);
    textDocuments[0].uri = uri(path.join(manuscript, 'main.tex'));
    assert.equal((await send(decide)).error, undefined, 'task review should not guard the manuscript instead');
    assert.deepEqual(requests, [decide.route]);

    const manuscriptAlias = path.join(directory, 'paper-alias');
    await fs.symlink(manuscript, manuscriptAlias, 'dir');
    textDocuments[0].uri = uri(path.join(manuscriptAlias, 'main.tex'));
    await commands.get('papilot.build')!(paper);
    await commands.get('papilot.apply')!();
    assert.deepEqual(errors, Array(2).fill('Save your edited files before applying or rejecting changes.'));
    assert.ok(!apiCalls.some(route => route.endsWith('/apply')));
    await commands.get('papilot.changes')!(paper);
    assert.match((await send({ ...decide, route: '/review/project/api/changes/decide' })).error, /Save your edited files/);

    // The old task panel must not fall back to the manuscript after deletion.
    await commands.get('papilot.review')!();
    snapshot = { ...snapshot, tasks: [] };
    await extension.refresh();
    assert.match((await send({ type: 'source', file: 'main.tex' })).error, /not available yet/);
    assert.deepEqual(opened, [path.join(worktree, 'main.tex')]);
  } finally {
    for (const item of subscriptions.toReversed()) item.dispose();
    delete fixture.papilotTest;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
