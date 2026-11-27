import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const waitFor = async <T>(read: () => T | Promise<T>, accept: (value: T) => boolean, timeout = 60000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error('Timed out waiting for the extension');
};
async function checks() {
  const extension = vscode.extensions.getExtension('PapilotAI.papilot-vscode'); assert.ok(extension);
  const api = await extension.activate();
  await api.refresh();
  assert.equal(api.papers.papers.length, 2, JSON.stringify(api.papers.papers));
  const [paper, slides] = api.papers.papers;
  assert.notEqual(paper.document, slides.document);
  await vscode.commands.executeCommand('papilot.open', paper);
  await vscode.commands.executeCommand('papilot.open', slides);
  const state = await waitFor(() => api.backend.api(`/api/projects/${slides.project.id}/manuscript?document=${encodeURIComponent(slides.document)}`), (state: any) => state.build.status !== 'building');
  assert.equal((state as any).build.status, 'ready');
  await vscode.commands.executeCommand('papilot.chat.focus');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(paper.project.path, paper.document)));
  const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  editor.selection = new vscode.Selection(2, 0, 3, 0);
  await waitFor(() => api.backend.api(`/api/projects/${paper.project.id}/manuscript?document=${encodeURIComponent(paper.document)}`), (state: any) => state.build.status === 'ready');
  await vscode.commands.executeCommand('papilot.forwardSearch');
  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  const edit = new vscode.WorkspaceEdit(); edit.insert(document.uri, new vscode.Position(2, 0), '\\undefinedcommand\nUpdated paper text.\n');
  await vscode.workspace.applyEdit(edit); await document.save();
  await vscode.commands.executeCommand('papilot.open', paper);
  await waitFor(() => vscode.languages.getDiagnostics(document.uri), entries => entries.some(entry => entry.severity === vscode.DiagnosticSeverity.Error));
  const savedText = document.getText(), insertion = new vscode.Position(2, 0);
  const unsaved = new vscode.WorkspaceEdit(); unsaved.insert(document.uri, insertion, 'Unsaved text.\n');
  assert.ok(await vscode.workspace.applyEdit(unsaved));
  await fs.writeFile(path.join(process.env.PAPILOT_HOST_ARTIFACTS!, 'host-ready'), 'ready');
  // The browser harness inspects both editor webviews and the independent sidebar.
  await waitFor(() => fs.access(path.join(process.env.PAPILOT_HOST_ARTIFACTS!, 'revert-draft')).then(() => true, () => false), Boolean, 180000);
  assert.ok(document.isDirty && document.getText().includes('Unsaved text.'), 'Review must preserve unsaved editor text');
  assert.equal(await fs.readFile(document.uri.fsPath, 'utf8'), savedText, 'Review must leave the saved source unchanged');
  const restore = new vscode.WorkspaceEdit();
  restore.delete(document.uri, new vscode.Range(insertion, insertion.translate(1)));
  assert.ok(await vscode.workspace.applyEdit(restore));
  assert.equal(document.getText(), savedText);
  assert.ok(await document.save());
  assert.equal(document.isDirty, false);
  await fs.writeFile(path.join(process.env.PAPILOT_HOST_ARTIFACTS!, 'draft-reverted'), 'ready');
  await waitFor(() => fs.access(path.join(process.env.PAPILOT_HOST_ARTIFACTS!, 'light-theme')).then(() => true, () => false), Boolean, 180000);
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Global);
  await waitFor(() => fs.access(path.join(process.env.PAPILOT_HOST_ARTIFACTS!, 'inspected')).then(() => true, () => false), Boolean, 180000);
  const git = vscode.extensions.getExtension('vscode.git')!.exports.getAPI(1);
  const repository = git.getRepository(document.uri);
  await repository.status();
  assert.ok(repository.state.indexChanges.some((change: any) => change.uri.fsPath === document.uri.fsPath), 'Review staging must appear in VS Code Source Control');
  assert.ok(!repository.state.indexChanges.some((change: any) => change.uri.fsPath.endsWith(slides.document)), 'Staging this paper must not stage another document');
}

export async function run() {
  try { await checks(); }
  catch (error) { await fs.writeFile(path.join(process.env.PAPILOT_HOST_ARTIFACTS!, 'host-error'), error instanceof Error ? error.stack ?? error.message : String(error)); throw error; }
}
