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
  const discovered = [paper];
  const preparing = { id: 'task', projectId: project.id, name: 'task', title: 'Revise', document: paper.document, worktree: '', agent: 'codex', status: 'preparing', review: { round: 1 } };
  let snapshot = { projects: [project], tasks: [preparing], requests: [] }, receive: (message: any) => Promise<void>;
  let saveSource: (document: { uri: ReturnType<typeof uri> }) => Promise<void> = async () => assert.fail('Save listener was not registered');
  let resolveChat: () => Promise<void> = async () => assert.fail('Conversation was not registered');
  let publish = async () => {};
  const publishRoute = '/api/tasks/task/publish';
  const paperChoices: string[][] = [];
  const textDocuments: any[] = [];
  let manuscriptReads = 0, staleTaskPdf = false;
  const position = { page: 0, rect: [0.1, 0.2, 0.3, 0.4] };
  const taskPdf = '/api/tasks/task/pdf?round=1&build=task-build';
  const backend = {
    dispose() {},
    async api(route: string, body?: { path: string }) {
      apiCalls.push(route);
      if (route === '/api/state') return snapshot;
      if (route === '/api/projects/register') return { project: discovered.find(paper => paper.project.path === body?.path)!.project };
      const files = /^\/api\/projects\/([^/]+)\/files$/.exec(route);
      if (files) return { files: discovered.filter(paper => paper.project.id === files[1]).map(paper => ({ path: paper.document, root: true })) };
      if (route === publishRoute) { await publish(); return { ok: true }; }
      if (route.startsWith('/api/tasks/task/source/place?')) return staleTaskPdf ? { place: null, stale: true } : { place: position, key: 'task-build', url: taskPdf };
      if (/^\/api\/projects\/[^/]+\/manuscript\/source\/place\?/.test(route)) return { place: position };
      if (/^\/api\/projects\/[^/]+\/manuscript\/problems\?/.test(route)) return { problems: [] };
      if (/^\/api\/projects\/[^/]+\/manuscript\?/.test(route)) {
        return { build: ++manuscriptReads === 1 ? { key: 'old', status: 'building', current: false } : { key: 'new', status: 'ready', current: true } };
      }
      return {};
    },
    async request(route: string) { requests.push(route); return { status: 200, headers: {}, body: Buffer.from('{}').toString('base64') }; },
  };
  const git = {
    state: 'initialized', git: { path: 'git' }, repositories: [],
    getRepository(file: ReturnType<typeof uri>) {
      const root = discovered.find(({ project }) => file.fsPath === project.path || file.fsPath.startsWith(project.path + path.sep))?.project.path;
      return root ? { rootUri: uri(root), status: async () => {} } : undefined;
    },
    onDidOpenRepository: disposable, onDidCloseRepository: disposable,
  };
  const vscode = {
    env: { language: 'zh-tw' },
    l10n: { t: (source: string, args: Record<string, string> = {}) => source.replace(/\{(\w+)\}/g, (_, key) => args[key]) },
    Uri: { file: uri, joinPath: (base: any, ...parts: string[]) => uri(path.join(base.fsPath, ...parts)) },
    EventEmitter: class { event = disposable; fire() {} dispose() {} },
    TabInputText: class {}, Range: class {}, ViewColumn: { Beside: -2, Two: 2 }, ProgressLocation: { Notification: 15 },
    TreeItem: class {}, TreeItemCollapsibleState: { Expanded: 2 }, ThemeIcon: class {}, Diagnostic: class {}, DiagnosticSeverity: {},
    extensions: { getExtension: () => ({ activate: async () => ({ getAPI: () => git }) }) },
    languages: { createDiagnosticCollection: () => ({ ...disposable(), clear() {}, set() {} }) },
    commands: { registerCommand(name: string, fn: any) { commands.set(name, fn); return disposable(); }, async executeCommand(name: string, ...args: any[]) { return commands.get(name)?.(...args); } },
    workspace: {
      isTrusted: true, textDocuments, findFiles: async () => discovered.map(paper => uri(path.join(paper.project.path, paper.document))),
      createFileSystemWatcher: () => ({ ...disposable(), onDidCreate: disposable, onDidDelete: disposable, onDidChange: disposable }),
      onDidSaveTextDocument: (listener: typeof saveSource) => { saveSource = listener; return disposable(); }, onDidChangeWorkspaceFolders: disposable,
      openTextDocument: async (uri: any) => ({ uri, lineCount: 1 }),
    },
    window: {
      createOutputChannel: () => ({ ...disposable(), append() {}, appendLine() {} }),
      registerTreeDataProvider: disposable,
      registerWebviewViewProvider: (_: string, provider: { resolveWebviewView: (view: unknown) => Promise<void> }) => {
        resolveChat = async () => provider.resolveWebviewView({
          visible: false, onDidDispose: disposable,
          webview: {
            asWebviewUri: (uri: unknown) => uri,
            onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return disposable(); },
            postMessage: async (message: any) => responses.push(message),
          },
        });
        return disposable();
      },
      activeTextEditor: undefined as any,
      showQuickPick: async (options: { paper: typeof paper }[]) => { paperChoices.push(options.map(option => option.paper.key)); return options[0]; },
      withProgress: (_: unknown, run: (...args: any[]) => unknown) => run({}, { isCancellationRequested: false }),
      showErrorMessage: (message: string) => errors.push(message), tabGroups: { all: [] },
      showTextDocument: (document: any) => opened.push(document.uri.fsPath),
      createWebviewPanel: () => { let handler: (message: any) => Promise<void>; return ({
        ...disposable(), visible: false, onDidDispose: disposable, onDidChangeViewState: disposable,
        reveal() { receive = handler; },
        webview: { set html(value: string) { if (value.includes('/web/review/')) assert.match(value, /<html lang="zh-Hant">/); }, asWebviewUri: (uri: any) => uri, onDidReceiveMessage: (listener: any) => { handler = receive = listener; return disposable(); }, postMessage: async (message: any) => responses.push(message) },
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
    await commands.get('papilot.openTask')!(preparing);
    await commands.get('papilot.review')!();
    const send = async (message: any) => { await receive({ id: responses.length + 1, ...message }); return responses.at(-1); };
    assert.match((await send({ type: 'source', file: 'main.tex' })).error, /not available yet/);
    assert.deepEqual(opened, [], 'preparing tasks must not open the manuscript');

    snapshot = { ...snapshot, tasks: [{ ...preparing, status: 'reviewing', worktree }] };
    await extension.refresh();
    assert.equal((await send({ type: 'source', file: 'main.tex' })).error, undefined);
    assert.deepEqual(opened, [path.join(worktree, 'main.tex')], 'the existing panel must use the new task snapshot');
    const decide = { type: 'api', route: '/review/project/api/tasks/task/decide', body: { action: 'reject' } };
    textDocuments.push({ isDirty: true, uri: uri(path.join(alias, 'main.tex')) });
    for (const action of ['decide', 'undo']) {
      assert.match((await send({ ...decide, route: decide.route.replace('decide', action) })).error, /Save your edited files/);
    }
    assert.deepEqual(requests, [], 'aliased unsaved task files must block writes');
    const apply = commands.get('papilot.apply')!;
    const applyRoute = `/api/tasks/${preparing.id}/apply`;
    const saveError = 'Save your edited files before applying or rejecting changes.';
    await apply();
    assert.ok(!apiCalls.includes(applyRoute), 'a dirty task source buffer must block apply even if the manuscript is clean');
    assert.deepEqual(errors.splice(0), [saveError]);
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
    await apply();
    assert.deepEqual(errors.splice(0), [saveError, saveError]);
    assert.ok(!apiCalls.includes(applyRoute));
    await commands.get('papilot.changes')!(paper);
    assert.match((await send({ ...decide, route: '/review/project/api/changes/decide' })).error, /Save your edited files/);
    textDocuments[0].isDirty = false;
    await apply();
    assert.deepEqual(apiCalls.filter(route => route === applyRoute), [applyRoute]);
    assert.deepEqual(errors, []);

    const forwardSearch = commands.get('papilot.forwardSearch')!;
    const selectSource = (file: string) => { vscode.window.activeTextEditor = { document: { uri: uri(file), isDirty: false, version: 1 }, selection: { start: { line: 2 }, end: { line: 3 } } }; };
    await fs.writeFile(path.join(worktree, 'main.tex'), 'revision');
    selectSource(path.join(alias, 'main.tex'));
    await commands.get('papilot.openTask')!({ ...preparing, id: 'different-task' });
    await forwardSearch();
    const taskRoute = apiCalls.find(route => route.startsWith('/api/tasks/task/source/place?'));
    assert.ok(taskRoute);
    assert.equal(new URL(taskRoute, 'http://test').searchParams.get('file'), 'main.tex');
    assert.equal(requests.at(-1), taskPdf);
    assert.deepEqual(responses.at(-1)?.place?.place, position);
    staleTaskPdf = true;
    await forwardSearch();
    assert.deepEqual(errors.splice(0), ['Wait for the PDF to compile.']);

    selectSource(path.join(manuscript, 'main.tex'));
    manuscriptReads = 0;
    await forwardSearch();
    const places = apiCalls.filter(route => route.startsWith('/api/projects/project/manuscript/source/place?'));
    assert.equal(places.length, 1);
    assert.equal(new URL(places[0], 'http://test').searchParams.get('key'), 'new');
    assert.deepEqual(responses.at(-1)?.place?.place, position);
    assert.deepEqual(errors, []);

    const secondProject = { id: 'second', path: path.join(directory, 'second'), name: 'Second' };
    await fs.mkdir(secondProject.path);
    for (const document of ['main.tex', 'slides.tex']) {
      await fs.writeFile(path.join(secondProject.path, document), 'second project');
      discovered.push({ project: secondProject, document, key: `second:${document}` });
    }
    const included = path.join(secondProject.path, 'chapter.tex');
    await fs.writeFile(included, 'included source');
    await extension.refresh();
    await commands.get('papilot.open')!(extension.papers.papers[0]);
    selectSource(included);
    await forwardSearch();
    assert.deepEqual(paperChoices, [['second:main.tex', 'second:slides.tex']]);
    const secondPlace = apiCalls.find(route => route.startsWith('/api/projects/second/manuscript/source/place?'));
    assert.ok(secondPlace);
    assert.equal(new URL(secondPlace, 'http://test').searchParams.get('file'), 'chapter.tex');
    assert.deepEqual(errors, []);

    const savedSource = { uri: uri(path.join(worktree, 'main.tex')) };
    const publishCalls = () => apiCalls.filter(route => route === publishRoute).length;
    const task = snapshot.tasks[0];
    snapshot = { ...snapshot, tasks: [{ ...task, status: 'uncertain' }] };
    await extension.refresh();
    await saveSource(savedSource);
    assert.equal(publishCalls(), 0, 'uncertain tasks cannot build');
    snapshot = { ...snapshot, tasks: [task] };
    publish = async () => { throw new Error('The task started another review action.'); };
    await extension.refresh();
    assert.equal(publishCalls(), 1, 'the saved edit should build once the task becomes idle');
    publish = async () => {
      publish = async () => {};
      await saveSource(savedSource);
    };
    await extension.refresh();
    assert.equal(publishCalls(), 2, 'a rejected build request must be retried');
    await extension.refresh();
    assert.equal(publishCalls(), 3, 'a second save during a build request must also be published');
    await extension.refresh();
    assert.equal(publishCalls(), 3, 'an accepted save should be removed from the queue');

    // The old task panel must not fall back to the manuscript after deletion.
    await commands.get('papilot.openTask')!(preparing);
    await commands.get('papilot.review')!();
    snapshot = { ...snapshot, tasks: [] };
    await extension.refresh();
    assert.match((await send({ type: 'source', file: 'main.tex' })).error, /not available yet/);
    assert.deepEqual(opened, [path.join(worktree, 'main.tex')]);

    const manual = { ...preparing, agent: 'chatgpt', status: 'waiting_input', worktree };
    const local = { ...preparing, id: 'local-task', status: 'reviewing', worktree };
    snapshot = { ...snapshot, tasks: [manual, local] };
    await extension.refresh();
    await commands.get('papilot.openTask')!(manual);
    await resolveChat();
    const manualActions = [
      { type: 'api', route: '/api/tasks/task/manual-prompt' },
      { type: 'api', route: '/api/tasks/task/manual-reply', body: { reply: 'Revise the introduction' } },
      { type: 'api', route: '/api/tasks/task/manual-github-sync', body: { remote: 'origin' } },
    ];
    requests.length = 0;
    for (const action of manualActions) assert.equal((await send(action)).error, undefined);
    assert.deepEqual(requests, manualActions.map(action => action.route));
    assert.match((await send({ ...manualActions[0], body: {} })).error, /not available in this view/);
    assert.match((await send({ ...manualActions[0], route: '/api/tasks/local-task/manual-prompt' })).error, /not available in this view/);
    await commands.get('papilot.openTask')!(local);
    assert.match((await send(manualActions[0])).error, /not available in this view/);
    assert.match((await send({ ...manualActions[0], route: '/api/tasks/local-task/manual-prompt' })).error, /not available in this view/);
    assert.equal(requests.length, manualActions.length);
  } finally {
    for (const item of subscriptions.toReversed()) item.dispose();
    delete fixture.papilotTest;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
