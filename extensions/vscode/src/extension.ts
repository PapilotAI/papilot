import * as vscode from 'vscode';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Project, Snapshot, SourceFile } from '../../../src/shared.ts';
import type { SourceLocation } from '../../../src/host-events.ts';
import { bridgeScript, panelHtml } from './bridge.ts';
import { RuntimeClient } from './runtime-client.ts';
import { TaskFiles, taskLocation, taskUri } from './task-files.ts';

let active: PapilotExtension | undefined;
export function activate(context: vscode.ExtensionContext) {
  active = new PapilotExtension(context);
  context.subscriptions.push(active);
}
export async function deactivate() { await active?.close(); active = undefined; }

class PapilotExtension implements vscode.Disposable {
  private client?: RuntimeClient;
  private panel?: vscode.WebviewPanel;
  private opening?: Promise<vscode.WebviewPanel>;
  private log = vscode.window.createOutputChannel('Papilot');
  private token = randomBytes(32).toString('hex');
  private ready = false;
  private queue: { type: string; detail: unknown }[] = [];
  private reveal?: SourceLocation;
  private files: TaskFiles;
  constructor(private context: vscode.ExtensionContext) {
    this.files = new TaskFiles(() => this.runtime(), (location, state) => this.send('saved', { ...location, state }));
    const command = (name: string, work: () => Promise<unknown>) => vscode.commands.registerCommand(name, () => work().catch(error => this.error(error)));
    context.subscriptions.push(this.log, this.files,
      vscode.workspace.registerFileSystemProvider('papilot-task', this.files, { isCaseSensitive: true }),
      vscode.workspace.onDidCloseTextDocument(document => { if (document.uri.scheme === 'papilot-task') this.files.forget(document.uri); }),
      command('papilot.open', () => this.open()),
      command('papilot.openWorkspace', () => this.openWorkspace()),
      command('papilot.showPdf', () => this.showPdf()),
    );
  }
  private async runtime() {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before starting Papilot.');
    if (!this.client) {
      const packaged = path.join(this.context.extensionPath, 'runtime');
      const root = fs.existsSync(path.join(packaged, 'package.json')) ? packaged : path.resolve(this.context.extensionPath, '../..');
      if (!fs.existsSync(path.join(root, 'dist/index.html'))) throw new Error('Build Papilot and the review UI before launching the extension. See the extension README.');
      const data = vscode.Uri.joinPath(this.context.storageUri ?? this.context.globalStorageUri, 'papilot');
      await vscode.workspace.fs.createDirectory(data);
      this.client = new RuntimeClient(path.join(this.context.extensionPath, 'dist/runtime-worker.mjs'), root, data.fsPath, bridgeScript(this.token), text => this.log.append(text), process.env.PAPILOT_EXTENSION_TEST !== '1');
    }
    await this.client.ready;
    return this.client;
  }
  private open(): Promise<vscode.WebviewPanel> {
    if (this.opening) return this.opening;
    if (this.panel) { this.panel.reveal(this.panel.viewColumn, true); return Promise.resolve(this.panel); }
    return this.opening = (async () => {
      const runtime = await this.runtime();
      const panel = vscode.window.createWebviewPanel('papilot', 'Papilot', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
      this.panel = panel; this.ready = false;
      panel.onDidDispose(() => { if (this.panel === panel) { this.panel = undefined; this.ready = false; this.queue = []; } });
      panel.webview.onDidReceiveMessage(message => {
        if (message?.channel !== 'papilot' || message.token !== this.token) return;
        if (message.type === 'frame-host') {
          const ancestors = message.detail?.ancestors;
          if (!Array.isArray(ancestors) || !ancestors.length || !ancestors.every(value => typeof value === 'string' && /^(https?|vscode-file|vscode-webview):\/\/[^/\s;]+$/.test(value))) { this.error(new Error('The editor frame origin could not be verified.')); return; }
          void runtime.call({ type: 'host', origin: this.frameOrigin, ancestors }).then(() => {
            void panel.webview.postMessage({ channel: 'papilot', token: this.token, type: 'load' });
          }).catch(error => this.error(error));
        } else if (message.type === 'ready') {
          this.ready = true;
          for (const queued of this.queue.splice(0)) this.send(queued.type, queued.detail);
        } else if (message.type === 'open-source') void this.openSource(message.detail).catch(error => this.error(error));
        else if (message.type === 'source-ready') {
          const pending = this.reveal, current = message.detail;
          if (pending && current?.ready && pending.projectId === current.projectId && pending.taskId === current.taskId) {
            this.reveal = undefined; this.send('show', pending);
          }
        } else if (message.type === 'open-external' && typeof message.detail?.url === 'string') {
          const uri = vscode.Uri.parse(message.detail.url);
          if (['http', 'https', 'mailto'].includes(uri.scheme)) void vscode.env.openExternal(uri);
        }
      });
      try {
        const external = await vscode.env.asExternalUri(vscode.Uri.parse(await runtime.ready));
        this.frameOrigin = new URL(external.toString()).origin;
        panel.webview.html = panelHtml(external.toString(), this.token, randomBytes(16).toString('hex'));
        return panel;
      } catch (error) { panel.dispose(); throw error; }
    })().finally(() => { this.opening = undefined; });
  }
  private frameOrigin = '';
  private send(type: string, detail: unknown) {
    if (!this.panel) return;
    if (!this.ready) { this.queue.push({ type, detail }); return; }
    void this.panel.webview.postMessage({ channel: 'papilot', token: this.token, type, detail });
  }
  private async openWorkspace() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) throw new Error('Open a workspace folder first.');
    const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
    if (!folder) return;
    const runtime = await this.runtime();
    type Opened = { project: Project } | { name: string; candidates: string[] };
    let result = await runtime.request<Opened>('/projects/open', { path: folder.uri.fsPath });
    if (!('project' in result)) {
      const main = await vscode.window.showQuickPick(result.candidates, { title: `Main TeX file for ${result.name}` });
      if (!main) return;
      result = await runtime.request<Opened>('/projects/open', { path: folder.uri.fsPath, main });
    }
    if ('project' in result) { await this.open(); this.send('select', { projectId: result.project.id }); }
  }
  private async openSource(location: SourceLocation) {
    if (!location || typeof location.projectId !== 'string' || typeof location.file !== 'string' || !Array.isArray(location.lines) || location.lines.length !== 2 || !location.lines.every(line => Number.isSafeInteger(line) && line >= 0) || location.lines[1] < location.lines[0]) throw new Error('Invalid source location.');
    const runtime = await this.runtime(), state = await runtime.request<Snapshot>('/state');
    const project = state.projects.find(project => project.id === location.projectId);
    if (!project) throw new Error('This paper is no longer open.');
    let uri: vscode.Uri;
    if (location.taskId) {
      if (!state.tasks.some(task => task.id === location.taskId && task.projectId === project.id)) throw new Error('This task does not belong to the paper.');
      uri = taskUri(location);
    } else {
      // Reuse the backend's path and source validation before opening a file.
      const source = await runtime.request<SourceFile>(`/projects/${project.id}/manuscript/source?file=${encodeURIComponent(location.file)}`);
      uri = vscode.Uri.file(path.join(project.path, source.file));
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const start = document.validatePosition(new vscode.Position(location.lines[0], 0));
    const end = document.validatePosition(new vscode.Position(Math.max(location.lines[0], location.lines[1] - 1), Number.MAX_SAFE_INTEGER));
    const selection = new vscode.Range(start, end);
    // With no editor open, VS Code initially puts even a Beside panel in the
    // first group. Open the source in another group without moving the paper.
    const viewColumn = this.panel?.viewColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One;
    const editor = await vscode.window.showTextDocument(document, { viewColumn, selection, preview: true });
    editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
  private async showPdf() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error('Open a LaTeX source file first.');
    if (editor.document.isDirty && !await editor.document.save()) return;
    const runtime = await this.runtime();
    let location: SourceLocation;
    if (editor.document.uri.scheme === 'papilot-task') location = taskLocation(editor.document.uri);
    else {
      const state = await runtime.request<Snapshot>('/state'), file = fs.realpathSync(editor.document.uri.fsPath);
      const project = state.projects.find(project => {
        const relative = path.relative(project.path, file);
        return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      });
      if (!project) throw new Error('Open this repository with Papilot: Open Workspace Folder first.');
      location = { projectId: project.id, file: path.relative(project.path, file).split(path.sep).join('/'), lines: [0, 1] };
    }
    location.lines = [editor.selection.start.line, Math.max(editor.selection.start.line + 1, editor.selection.end.line + 1)];
    await this.open();
    this.reveal = location;
    this.send('select', location);
    // Also works when the selected paper was already ready and stays selected.
    this.send('show', location);
  }
  private error(error: unknown) { const message = error instanceof Error ? error.message : String(error); this.log.appendLine(message); void vscode.window.showErrorMessage(message); }
  async close() { this.panel?.dispose(); await this.client?.close(); }
  dispose() { void this.close(); }
}
