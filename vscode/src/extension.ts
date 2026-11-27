import * as vscode from 'vscode';
import { t } from './i18n.ts';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { Backend } from './backend.ts';
import { reviewAssets } from './assets.ts';
import { allowedCommand } from './commands.ts';
import { inside, insideReal, routePath, sourcePath } from './paths.ts';
import { supportedLanguage } from '../../engine/src/locales.ts';
import type { GitExtension, Repository } from './git.ts';
import type { Manuscript, ManuscriptProblems, Project, Snapshot, SourcePlace, Task } from '../../src/shared.ts';

type Paper = { project: Project; document: string; key: string };
type View = { kind: 'paper'; paper: Paper } | { kind: 'review'; project: Project; task?: Pick<Task, 'id' | 'name'>; document?: string } | { kind: 'chat' } | { kind: 'taskPdf'; id: string };
type PdfPosition = { place: SourcePlace; key: string; at: number };
type TaskPosition = { place: null; stale?: true } | { place: SourcePlace; key: string; url: string };
type Node = Paper | Task;
const isPaper = (node: Node): node is Paper => 'document' in node && 'project' in node;
const paperRoute = (paper: Paper, suffix = '') => `/api/projects/${paper.project.id}/manuscript${suffix}?document=${encodeURIComponent(paper.document)}`;
const encode = encodeURIComponent;

class Papers implements vscode.TreeDataProvider<Node> {
  readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  papers: Paper[] = [];
  tasks: Task[] = [];
  getTreeItem(node: Node) {
    if (isPaper(node)) {
      const item = new vscode.TreeItem(node.document, vscode.TreeItemCollapsibleState.Expanded);
      item.id = node.key; item.description = node.project.name; item.resourceUri = vscode.Uri.file(path.join(node.project.path, node.document));
      item.command = { command: 'papilot.open', title: t('Open PDF'), arguments: [node] };
      return item;
    }
    const item = new vscode.TreeItem(node.title);
    item.id = node.id; item.description = node.status; item.iconPath = new vscode.ThemeIcon('comment-discussion');
    item.command = { command: 'papilot.openTask', title: t('Open conversation'), arguments: [node] };
    return item;
  }
  getChildren(node?: Node): Node[] {
    if (!node) return this.papers;
    return isPaper(node) ? this.tasks.filter(task => task.projectId === node.project.id && task.document === node.document) : [];
  }
}

export async function activate(context: vscode.ExtensionContext) {
  if (!vscode.workspace.isTrusted) return;
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!gitExtension) throw new Error(t('Enable VS Code Git support to use Papilot.'));
  const git = (await gitExtension.activate()).getAPI(1);
  if (git.state === 'uninitialized') await new Promise<void>(resolve => { const listener = git.onDidChangeState(state => { if (state === 'initialized') { listener.dispose(); resolve(); } }); context.subscriptions.push(listener); });
  const output = vscode.window.createOutputChannel('Papilot');
  const storage = context.storageUri || context.globalStorageUri;
  await fs.mkdir(storage.fsPath, { recursive: true });
  const assetRoot = await fs.mkdtemp(path.join(storage.fsPath, 'assets-'));
  const backend = new Backend(context.extensionPath, path.join(storage.fsPath, 'data'), git.git.path, line => output.append(line));
  const papers = new Papers();
  const diagnostics = vscode.languages.createDiagnosticCollection('Papilot');
  const diagnosticsByPaper = new Map<string, Map<string, vscode.Diagnostic[]>>();
  const panels = new Map<string, { panel: vscode.WebviewPanel; view: View }>();
  const places = new Map<string, PdfPosition>();
  const taskPdfs = new Map<string, PdfPosition & { url: string }>();
  let nextPlace = 0;
  const repositories = new Map<string, vscode.Disposable>();
  let snapshot: Snapshot | undefined, chat: vscode.WebviewView | undefined, selectedTask: string | undefined, selectedPaper: Paper | undefined;
  const savedTasks = new Set<string>();
  let refreshing: Promise<void> | undefined, polling = false, closed = false;
  const errors = (error: unknown) => { output.appendLine(String(error)); void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); };
  const register = (command: string, run: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(command, (...args) => Promise.resolve().then(() => run(...args)).catch(errors)));
  context.subscriptions.push(output, backend, diagnostics, papers.changed, vscode.window.registerTreeDataProvider('papilot.papers', papers));

  async function choosePaper(node?: Paper): Promise<Paper | undefined> {
    if (node && isPaper(node)) return node;
    const file = vscode.window.activeTextEditor?.document.uri.fsPath;
    const exact = papers.papers.find(paper => path.join(paper.project.path, paper.document) === file);
    if (exact) return exact;
    if (selectedPaper && papers.papers.includes(selectedPaper)) return selectedPaper;
    if (papers.papers.length === 1) return papers.papers[0];
    return (await vscode.window.showQuickPick(papers.papers.map(paper => ({ label: paper.document, description: paper.project.name, paper })), { placeHolder: t('Choose a paper') }))?.paper;
  }
  async function refresh() {
    return refreshing ??= (async () => {
      const tex = await vscode.workspace.findFiles('**/*.tex', '**/{.git,node_modules,.papilot}/**');
      const roots = new Map(tex.map(uri => git.getRepository(uri)).filter((repo): repo is Repository => Boolean(repo)).map(repo => [repo.rootUri.toString(), repo]));
      const found: Paper[] = [];
      for (const repository of roots.values()) {
        try {
          const { project } = await backend.api<{ project: Project }>('/api/projects/register', { path: repository.rootUri.fsPath });
          const { files } = await backend.api<{ files: { path: string; root?: boolean }[] }>(`/api/projects/${project.id}/files`);
          for (const file of files.filter(file => file.root)) found.push({ project, document: file.path, key: `${project.id}:${file.path}` });
        } catch (error) { output.appendLine(`${repository.rootUri.fsPath}: ${String(error)}`); }
      }
      papers.papers = found;
      if (selectedPaper) selectedPaper = found.find(paper => paper.key === selectedPaper?.key);
      papers.changed.fire();
      await poll();
    })().finally(() => { refreshing = undefined; });
  }
  function updateDiagnostics(paper: Paper, value: ManuscriptProblems) {
    const entries = new Map<string, vscode.Diagnostic[]>();
    for (const problem of value.problems) {
      const file = path.resolve(paper.project.path, problem.file || paper.document);
      if (!inside(paper.project.path, file)) continue;
      const start = Math.max(0, (problem.line || 1) - 1), end = Math.max(start, (problem.end || problem.line || 1) - 1);
      const diagnostic = new vscode.Diagnostic(new vscode.Range(start, 0, end, 1000), problem.message,
        problem.severity === 'error' ? vscode.DiagnosticSeverity.Error : problem.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
      diagnostic.source = `Papilot (${paper.document})`;
      const list = entries.get(file) || []; list.push(diagnostic); entries.set(file, list);
    }
    diagnosticsByPaper.set(paper.key, entries);
    const combined = new Map<string, vscode.Diagnostic[]>();
    for (const documents of diagnosticsByPaper.values()) for (const [file, entries] of documents) combined.set(file, [...(combined.get(file) || []), ...entries]);
    diagnostics.clear(); diagnostics.set([...combined].map(([file, entries]) => [vscode.Uri.file(file), entries]));
  }
  const assets = new Map<string, Promise<string>>();
  async function asset(webview: vscode.Webview, route: string) {
    let pending = assets.get(route);
    if (!pending) {
      pending = (async () => {
        const response = await backend.request(route);
        if (response.status >= 400) throw new Error(t('Could not load Papilot asset ({status}).', { status: response.status }));
        const extension = response.headers['content-type']?.includes('pdf') ? '.pdf' : response.headers['content-type']?.includes('png') ? '.png' : '.bin';
        const file = path.join(assetRoot, createHash('sha256').update(route).digest('hex') + extension);
        await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.from(response.body, 'base64'));
        return file;
      })();
      assets.set(route, pending); pending.catch(() => assets.delete(route));
    }
    return webview.asWebviewUri(vscode.Uri.file(await pending)).toString();
  }
  async function mapAssets(webview: vscode.Webview, value: any, view: View): Promise<any> {
    const scoped = (route: string) => view.kind === 'review' && view.document ? route + (route.includes('?') ? '&' : '?') + 'document=' + encode(view.document) : route;
    if (Array.isArray(value)) return Promise.all(value.map(item => mapAssets(webview, item, view)));
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (key === 'files' && typeof item === 'string' && item.startsWith('/review/') && item.endsWith('/')) {
          const names = reviewAssets(value);
          const folder = path.join(assetRoot, createHash('sha256').update(scoped(item)).digest('hex'));
          await fs.mkdir(folder, { recursive: true });
          await Promise.all([...names].map(async name => {
            const target = path.join(folder, name);
            try { await fs.access(target); return; } catch { /* Fetch each immutable image once. */ }
            const response = await backend.request(scoped(item + name));
            if (response.status >= 400) throw new Error(t('Could not load review image ({status}).', { status: response.status }));
            await fs.writeFile(target, Buffer.from(response.body, 'base64'));
          }));
          result[key] = webview.asWebviewUri(vscode.Uri.file(folder)).toString() + '/';
        } else if ((key === 'pdf' || key === 'passes') && typeof item === 'string') result[key] = item;
        else result[key] = await mapAssets(webview, item, view);
      }
      return result;
    }
    if (typeof value === 'string' && /^\/review\/[^/]+\/(?:files|option-files|mixed-files|pdf|changes\/(?:files|pdf))\//.test(value)) return asset(webview, scoped(value));
    if (typeof value === 'string' && /^\/api\/tasks\/[^/]+\/pages\//.test(value)) return asset(webview, value);
    return value;
  }
  async function showSource(root: string, file: string, line = 1, end = line) {
    const target = await sourcePath(root, file);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    const start = Math.min(document.lineCount - 1, Math.max(0, line - 1));
    const finish = Math.min(document.lineCount - 1, Math.max(start, end - 1));
    const column = vscode.window.tabGroups.all.find(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText))?.viewColumn || vscode.ViewColumn.Beside;
    await vscode.window.showTextDocument(document, { viewColumn: column, selection: new vscode.Range(start, 0, finish, 0) });
  }
  async function requireSaved(root: string) {
    for (const doc of vscode.workspace.textDocuments) {
      if (!doc.isDirty || doc.uri.scheme !== 'file') continue;
      const file = doc.uri.fsPath;
      // Protect both an entry Git can replace and a target opened via an alias.
      if (inside(root, file) || await insideReal(root, path.dirname(file)) || await insideReal(root, file)) throw new Error(t('Save your edited files before applying or rejecting changes.'));
    }
  }
  function reviewRoot(view: Extract<View, { kind: 'review' }>) {
    if (!view.task) return view.project.path;
    const task = snapshot?.tasks.find(task => task.id === view.task!.id && task.projectId === view.project.id);
    if (!task?.worktree) throw new Error(t('The task source is not available yet.'));
    return task.worktree;
  }
  function allowed(view: View, route: string, write: boolean) {
    const pathname = routePath(route);
    const projectId = view.kind === 'paper' ? view.paper.project.id : view.kind === 'review' ? view.project.id : undefined;
    if (view.kind === 'review') {
      const prefix = `/review/${projectId}/api/${view.task ? `tasks/${encode(view.task.name)}` : 'changes'}`;
      const suffix = pathname.slice(prefix.length);
      if (!write && view.task && pathname.startsWith(`/review/${projectId}/pdf/${encode(view.task.name)}/`) && /\/\d+\/passes$/.test(pathname)) return;
      if (pathname.startsWith(prefix + '/') && (write ? /^\/(?:decide|undo|look|source\/options\/preview|rounds\/\d+\/(?:mixed|references\/confirm))$/.test(suffix) : !suffix.startsWith('/source'))) return;
    }
    if (view.kind === 'paper') {
      const prefix = `/api/projects/${projectId}`, suffix = pathname.slice(prefix.length);
      if (pathname.startsWith(prefix + '/') && (write ? /^\/(?:manuscript\/anchors(?:\/resolve)?|annotations(?:\/[^/]+(?:\/(?:delete|restore))?)?)$/.test(suffix) : suffix === '/manuscript/words')) return;
    }
    if (view.kind === 'chat') {
      const task = snapshot?.tasks.find(task => task.id === selectedTask);
      if (task && pathname.startsWith(`/api/tasks/${task.id}/`) && /^\/(?:items|messages|model|permissions|agent|interrupt|prepare|reconcile|workers\/stop|note-results|notes\/[^/]+\/(?:return|undo-return))$/.test(pathname.slice(`/api/tasks/${task.id}`.length))) return;
      if (task && pathname.startsWith(`/api/projects/${task.projectId}/`) && /^attachments(?:\/[^/]+\/discard)?$/.test(pathname.slice(`/api/projects/${task.projectId}/`.length))) return;
      if (task && snapshot?.requests.some(request => pathname === `/api/requests/${request.id}` && request.taskId === task.id)) return;
      if (pathname === '/api/reconnect' || /^\/api\/runtime\/[a-z-]+\/usage$/.test(pathname)) return;
    }
    if (!write && ['/api/quick-notes', '/api/settings/effects', '/api/settings/note-alternatives'].includes(pathname)) return;
    throw new Error(t('This request is not available in this view.'));
  }
  async function wire(webview: vscode.Webview, view: View) {
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist'), vscode.Uri.file(assetRoot)] };
    webview.onDidReceiveMessage(async message => {
      if (!message || typeof message.id !== 'number' || typeof message.type !== 'string') return;
      try {
        let value: unknown;
        if (message.type === 'ready') {
          value = view;
          try { await push(webview, view); }
          catch (error) { await webview.postMessage({ type: 'state', view, error: String(error) }); }
        } else if (message.type === 'resource' && view.kind === 'chat') {
          const task = snapshot?.tasks.find(task => task.id === message.taskId && task.id === selectedTask);
          const route = routePath(message.route);
          if (!task || !(route.startsWith(`/api/projects/${task.projectId}/attachments/`) || route.startsWith(`/api/tasks/${task.id}/pages/`))) throw new Error(t('This resource is not available in this conversation.'));
          value = await asset(webview, message.route);
        } else if (message.type === 'resource' && view.kind === 'review') {
          const route = routePath(message.route), prefix = view.task ? `/review/${view.project.id}/pdf/${encode(view.task.name)}/` : `/review/${view.project.id}/changes/pdf/`;
          if (!route.startsWith(prefix) || !/^\d+$/.test(route.slice(prefix.length))) throw new Error(t('This PDF is not available in this review.'));
          value = await asset(webview, view.document ? message.route + (message.route.includes('?') ? '&' : '?') + 'document=' + encode(view.document) : message.route);
        } else if (message.type === 'publish' && view.kind === 'review' && view.task) {
          await backend.api(`/api/tasks/${view.task.id}/publish`, {});
        } else if (message.type === 'api') {
          allowed(view, message.route, message.body !== undefined || Boolean(message.file));
          if (view.kind === 'chat' && message.body !== undefined && routePath(message.route).endsWith('/reconcile')) {
            const task = snapshot?.tasks.find(task => task.id === selectedTask);
            if (task?.worktree) await requireSaved(task.worktree);
          }
          if (view.kind === 'review' && message.body !== undefined && /\/(?:decide|undo)$/.test(routePath(message.route))) await requireSaved(reviewRoot(view));
          const scopedRoute = view.kind === 'review' && view.document ? message.route + (message.route.includes('?') ? '&' : '?') + 'document=' + encode(view.document) : message.route;
          const response = await backend.request(scopedRoute, message.body, message.file);
          const data = JSON.parse(Buffer.from(response.body, 'base64').toString());
          if (response.status >= 400) throw new Error(data.error || t('Papilot request failed ({status}).', { status: response.status }));
          value = await mapAssets(webview, data, view);
        } else if (message.type === 'source' && view.kind === 'paper') {
          const located = await backend.api(`/api/projects/${view.paper.project.id}/manuscript/source/locate`, message.target);
          if (!located.source) throw new Error(t('No LaTeX source was found at this position.'));
          await showSource(view.paper.project.path, located.source.file, located.source.focus[0] + 1, located.source.focus[1]);
        } else if (message.type === 'source' && view.kind === 'review') {
          await showSource(reviewRoot(view), message.file, (message.lines?.[0] || 0) + 1, message.lines?.[1]);
        } else if (message.type === 'command') {
          if (!allowedCommand(view.kind, message.command, message.taskId, selectedTask)) throw new Error(t('This action is not available in this view or the selected conversation changed.'));
          value = await vscode.commands.executeCommand(message.command, view.kind === 'paper' ? view.paper : undefined, message.notes);
        } else throw new Error(t('Unknown Papilot action.'));
        await webview.postMessage({ id: message.id, value });
      } catch (error) { await webview.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
    }, undefined, context.subscriptions);
    const nonce = randomBytes(24).toString('base64');
    const bundle = view.kind === 'taskPdf' ? 'paper' : view.kind;
    const uri = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, `dist/web/${bundle}`, name));
    const language = view.kind === 'review' ? ` lang="${supportedLanguage(vscode.env.language) || 'en'}"` : '';
    webview.html = `<!doctype html><html${language}><head><meta charset="UTF-8"><meta name="color-scheme" content="light dark"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:; connect-src ${webview.cspSource} blob:; worker-src ${webview.cspSource} blob:; object-src 'none'; base-uri 'none';"><link rel="stylesheet" href="${uri('view.css')}"></head><body><div id="root"></div><script type="module" nonce="${nonce}" src="${uri('view.js')}"></script></body></html>`;
  }
  async function push(webview: vscode.Webview, view: View) {
    if (view.kind === 'paper') {
      const manuscript = await backend.api<Manuscript>(paperRoute(view.paper));
      const problems = await backend.api<ManuscriptProblems>(paperRoute(view.paper, '/problems'));
      updateDiagnostics(view.paper, problems);
      const pdf = manuscript.build.key ? await asset(webview, `/api/projects/${view.paper.project.id}/manuscript.pdf?key=${encode(manuscript.build.key)}`) : undefined;
      await webview.postMessage({ type: 'state', view, manuscript, pdf, place: places.get(view.paper.key) });
    } else if (view.kind === 'taskPdf') {
      const target = taskPdfs.get(view.id);
      if (target) await webview.postMessage({ type: 'state', view, pdf: await asset(webview, target.url), place: target });
    } else if (view.kind === 'chat') {
      const task = snapshot?.tasks.find(task => task.id === selectedTask);
      const skills = task ? await backend.api(`/api/projects/${task.projectId}/skills`) : { skills: [] };
      await webview.postMessage({ type: 'state', view, snapshot, task, skills: skills.skills });
    } else await webview.postMessage({ type: 'state', view });
  }
  async function poll() {
    if (polling || closed) return;
    polling = true;
    try {
      snapshot = await backend.api<Snapshot>('/api/state');
      const projectIds = new Set(papers.papers.map(paper => paper.project.id));
      for (const id of savedTasks) {
        const task = snapshot.tasks.find(task => task.id === id);
        if (!task) { savedTasks.delete(id); continue; }
        if (task.preparation || ['running', 'waiting_input', 'queued', 'building', 'deleting'].includes(task.status)) continue;
        savedTasks.delete(id);
        await backend.api(`/api/tasks/${id}/publish`, {});
      }
      papers.tasks = snapshot.tasks.filter(task => projectIds.has(task.projectId));
      papers.changed.fire();
      await Promise.all([...panels.values()].filter(({ panel, view }) => panel.visible && view.kind === 'paper').map(async ({ panel, view }) => {
        try { await push(panel.webview, view); }
        catch (error) { await panel.webview.postMessage({ type: 'state', view, error: String(error) }); }
      }));
      if (chat?.visible) await push(chat.webview, { kind: 'chat' });
    } catch (error) { output.appendLine(String(error)); }
    finally { polling = false; }
  }
  async function panel(key: string, title: string, view: View) {
    const existing = panels.get(key);
    if (existing) {
      const column = existing.panel.viewColumn;
      existing.panel.reveal(vscode.window.activeTextEditor?.viewColumn === column ? vscode.ViewColumn.Beside : column);
      return existing.panel;
    }
    const column = [...panels.values()].find(({ panel }) => panel.visible)?.panel.viewColumn || [...panels.values()][0]?.panel.viewColumn || vscode.ViewColumn.Two;
    const panel = vscode.window.createWebviewPanel('papilot.document', title, column, { enableScripts: true, retainContextWhenHidden: true });
    panels.set(key, { panel, view });
    panel.onDidDispose(() => {
      panels.delete(key);
      if (view.kind === 'taskPdf') taskPdfs.delete(view.id);
    });
    panel.onDidChangeViewState(() => { if (panel.active && view.kind === 'paper') selectedPaper = view.paper; });
    await wire(panel.webview, view);
    return panel;
  }
  register('papilot.refresh', refresh);
  register('papilot.open', async (node?: Paper) => { const paper = await choosePaper(node); if (paper) { selectedPaper = paper; await panel(paper.key, paper.document + ' · PDF', { kind: 'paper', paper }); } });
  register('papilot.build', async (node?: Paper) => { const paper = await choosePaper(node); if (!paper) return; await requireSaved(paper.project.path); await backend.api(paperRoute(paper), {}); await vscode.commands.executeCommand('papilot.open', paper); });
  register('papilot.log', async (node?: Paper) => { const paper = await choosePaper(node); if (!paper) return; const response = await backend.request(paperRoute(paper, '/log')); output.appendLine(Buffer.from(response.body, 'base64').toString()); output.show(); });
  register('papilot.git', () => vscode.commands.executeCommand('workbench.view.scm'));
  register('papilot.newTask', async (node?: Paper, noteIds?: string[]) => {
    const paper = await choosePaper(node); if (!paper) return;
    const manuscript = await backend.api<Manuscript>(paperRoute(paper));
    const notes = noteIds ? manuscript.annotations.filter(note => noteIds.includes(note.id)) : manuscript.annotations;
    const picked = notes.length ? await vscode.window.showQuickPick(notes.map(note => ({ label: note.comment || note.quote, description: t('Page {page}', { page: note.page + 1 }), note, picked: Boolean(noteIds) })), { canPickMany: true, placeHolder: t('PDF notes to include (optional)') }) : [];
    if (!picked) return;
    const instructions = await vscode.window.showInputBox({ prompt: t('Instructions for {document}', { document: paper.document }), placeHolder: t('Ask a question or request changes') });
    if (instructions === undefined || (!instructions.trim() && !picked.length)) return;
    await poll();
    const runtimes = Object.entries(snapshot?.runtimes || { codex: snapshot?.runtime }).filter(([, runtime]) => runtime?.connected && runtime.authenticated && !runtime.hidden);
    const choice = await vscode.window.showQuickPick(runtimes.map(([agent]) => ({ label: agent })), { placeHolder: t('Choose an agent') });
    if (!choice) { if (!runtimes.length) throw new Error(t('No signed-in agent is available. Sign in to your agent CLI, then reload Papilot.')); return; }
    const task = await backend.api<Task>('/api/tasks', { id: randomBytes(16).toString('hex'), projectId: paper.project.id, document: paper.document, title: (instructions.trim() || picked[0]?.note.comment || t('Review PDF notes')).slice(0, 120), instructions, annotations: picked.map(item => item.note.id), agent: choice.label });
    await vscode.commands.executeCommand('papilot.openTask', task);
  });
  register('papilot.openTask', async (task: Task) => {
    selectedTask = task.id;
    const paper = papers.papers.find(paper => paper.project.id === task.projectId && paper.document === task.document);
    if (paper) { selectedPaper = paper; await backend.api(paperRoute(paper)).catch(error => output.appendLine(String(error))); }
    await poll(); await vscode.commands.executeCommand('papilot.chat.focus'); if (chat) await push(chat.webview, { kind: 'chat' });
  });
  register('papilot.review', async () => { const task = snapshot?.tasks.find(task => task.id === selectedTask); if (!task) return; const project = papers.papers.find(paper => paper.project.id === task.projectId)?.project; if (project) await panel(task.id, t('{title} · Review', { title: task.title }), { kind: 'review', task, project }); });
  register('papilot.changes', async (node?: Paper) => { const paper = await choosePaper(node); if (paper) await panel(paper.key + ':changes', t('{document} · Changes', { document: paper.document }), { kind: 'review', project: paper.project, document: paper.document }); });
  register('papilot.apply', async () => {
    const task = snapshot?.tasks.find(task => task.id === selectedTask), project = papers.papers.find(paper => paper.project.id === task?.projectId)?.project;
    if (!task || !project) return;
    await requireSaved(project.path);
    // Apply can also replace task files when it prepares a merge review.
    if (task.worktree) await requireSaved(task.worktree);
    const result = await backend.api<Task>(`/api/tasks/${task.id}/apply`, { mode: 'workspace' });
    if (result.delivery?.pending) throw new Error(t('The task needs conflict resolution before it can be applied. See the conversation.'));
    await git.getRepository(vscode.Uri.file(project.path))?.status(); await poll();
  });
  register('papilot.forwardSearch', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') return;
    const { document, selection } = editor, version = document.version, at = ++nextPlace;
    if (document.isDirty) throw new Error(t('Save this file before locating it in the compiled PDF.'));
    const query = new URLSearchParams({ start: String(selection.start.line), end: String(selection.end.line + 1) });
    const unchanged = () => at === nextPlace && !document.isDirty && document.version === version && !closed;
    const file = await fs.realpath(document.uri.fsPath);
    // A task source tab can stay open while the user selects another task.
    // Resolve its worktree from the file, independently of that selection.
    for (const task of snapshot?.tasks ?? []) {
      if (!task.worktree) continue;
      const root = await fs.realpath(task.worktree).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!root || !inside(root, file)) continue;
      if (!unchanged()) return;
      if (!task.review?.round) throw new Error(t('Compile this paper first.'));
      query.set('file', path.relative(root, file).split(path.sep).join('/'));
      const result = await backend.api<TaskPosition>(`/api/tasks/${encode(task.id)}/source/place?${query}`);
      if (!unchanged()) return;
      if (!result.place) throw new Error(result.stale ? t('Wait for the PDF to compile.') : t('No PDF position was found for these lines.'));
      const view = { kind: 'taskPdf', id: task.id } as const;
      taskPdfs.set(task.id, { ...result, at });
      const pdf = await panel(`task-pdf:${task.id}`, task.title + ' · PDF', view);
      await push(pdf.webview, view);
      return;
    }
    const paper = await choosePaper();
    if (!paper || !unchanged()) return;
    const root = await fs.realpath(paper.project.path);
    if (!inside(root, file)) throw new Error(t('No PDF position was found for these lines.'));
    const route = paperRoute(paper);
    let { build } = await backend.api<Manuscript>(route);
    if (!build.current && build.status === 'building') {
      const current = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Compiling the PDF…'), cancellable: true }, async (_, token) => {
        while (!token.isCancellationRequested && unchanged() && build.status === 'building') {
          await new Promise(resolve => setTimeout(resolve, 500));
          if (token.isCancellationRequested || !unchanged()) return false;
          ({ build } = await backend.api<Manuscript>(route));
        }
        return !token.isCancellationRequested && unchanged();
      });
      if (!current) return;
    }
    if (!unchanged()) return;
    if (!build.current || !build.key) throw new Error(t('Compile this paper first.'));
    query.set('key', build.key);
    query.set('file', path.relative(root, file).split(path.sep).join('/'));
    const { place } = await backend.api<{ place: SourcePlace | null }>(`/api/projects/${paper.project.id}/manuscript/source/place?${query}`);
    if (!unchanged()) return;
    if (!place) throw new Error(t('No PDF position was found for these lines.'));
    places.set(paper.key, { place, key: build.key, at });
    const pdf = await panel(paper.key, paper.document + ' · PDF', { kind: 'paper', paper });
    await push(pdf.webview, { kind: 'paper', paper });
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('papilot.chat', { resolveWebviewView: async view => { chat = view; await wire(view.webview, { kind: 'chat' }); view.onDidDispose(() => { chat = undefined; }); } }, { webviewOptions: { retainContextWhenHidden: true } }));
  function watch(repository: Repository) { if (!repositories.has(repository.rootUri.toString())) repositories.set(repository.rootUri.toString(), repository.state.onDidChange(() => void poll())); }
  git.repositories.forEach(watch);
  context.subscriptions.push(git.onDidOpenRepository(repository => { watch(repository); void refresh().catch(errors); }), git.onDidCloseRepository(repository => { repositories.get(repository.rootUri.toString())?.dispose(); repositories.delete(repository.rootUri.toString()); void refresh().catch(errors); }));
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.tex');
  let discovery: ReturnType<typeof setTimeout> | undefined;
  function scheduleDiscovery() { clearTimeout(discovery); discovery = setTimeout(() => void refresh().catch(errors), 500); }
  context.subscriptions.push(watcher, watcher.onDidCreate(scheduleDiscovery), watcher.onDidDelete(scheduleDiscovery), watcher.onDidChange(scheduleDiscovery), vscode.workspace.onDidSaveTextDocument(document => {
    void (async () => {
      if (document.uri.scheme === 'file') for (const task of papers.tasks) if (task.worktree && await insideReal(task.worktree, document.uri.fsPath)) savedTasks.add(task.id);
      await poll();
    })().catch(errors);
  }), vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh().catch(errors)));
  const timer = setInterval(() => void poll(), 2000);
  context.subscriptions.push({ dispose() { closed = true; clearInterval(timer); clearTimeout(discovery); for (const disposable of repositories.values()) disposable.dispose(); for (const { panel } of panels.values()) panel.dispose(); void fs.rm(assetRoot, { recursive: true, force: true }); } });
  await refresh().catch(errors);
  return { backend, refresh, papers };
}
