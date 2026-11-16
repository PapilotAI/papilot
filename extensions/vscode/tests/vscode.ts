import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { TaskFiles, taskUri } from '../src/task-files.ts';
import type { RuntimeClient } from '../src/runtime-client.ts';

const until = async (check: () => boolean | Promise<boolean>, message: string, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(message);
};
export async function run() {
  const report = process.env.PAPILOT_TEST_REPORT!, root = process.env.PAPILOT_TEST_ROOT!;
  let browser: any, frame: any, panel: vscode.WebviewPanel | undefined;
  const browserErrors: string[] = [];
  try {
    const extension = vscode.extensions.getExtension('papilot.papilot');
    assert.ok(extension); await extension.activate();
    panel = await vscode.commands.executeCommand<vscode.WebviewPanel>('papilot.open');
    assert.ok(panel?.webview.html, 'The command opens the shared UI');
    const url = JSON.parse(/frame.src = ("[^"]+")/.exec(panel.webview.html)![1]);
    await vscode.commands.executeCommand('papilot.openWorkspace');
    const state = await fetch(url + 'api/state').then(response => response.json()) as any;
    assert.equal(state.projects.length, 1);
    const project = state.projects[0];
    const { chromium } = createRequire(path.join(root, 'engine/package.json'))('playwright');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.PAPILOT_TEST_DEBUG_PORT}`);
    const currentFrame = () => browser.contexts().flatMap((context: any) => context.pages()).flatMap((page: any) => page.frames()).find((candidate: any) => candidate.url().replace(/\/$/, '') === url.replace(/\/$/, ''));
    await until(() => {
      frame = currentFrame();
      return Boolean(frame);
    }, 'Papilot loads inside the VS Code webview');
    frame.page().on('pageerror', (error: Error) => browserErrors.push(error.stack || error.message));
    frame.page().on('console', (message: any) => { if (message.type() === 'error') browserErrors.push(message.text()); });
    frame.page().on('requestfailed', (request: any) => { if (request.url().startsWith(url)) browserErrors.push(`${request.url()}: ${request.failure()?.errorText}`); });
    await frame.goto(url);
    const word = (text: string) => frame.locator('.pdf-view .textLayer span', { hasText: text }).first();
    await word('Original').waitFor({ timeout: 60000 });
    await frame.getByRole('toolbar', { name: 'Marking tools' }).getByRole('button', { name: 'Edit source', exact: true }).click();
    await word('Original').click();
    const file = path.join(project.path, 'main.tex');
    await until(() => vscode.window.activeTextEditor?.document.uri.fsPath === file, 'PDF click opens the actual TeX source in VS Code');
    const editor = vscode.window.activeTextEditor!;
    assert.equal(editor.selection.start.line <= 2 && editor.selection.end.line >= 2, true);
    await editor.edit(edit => edit.replace(new vscode.Range(2, 0, 2, editor.document.lineAt(2).text.length), 'Revised wording from the editor.'));
    assert.equal(await editor.document.save(), true);
    // Moving the panel to a second editor group can recreate its iframe.
    await until(async () => {
      frame = currentFrame();
      return Boolean(frame) && await word('Revised').isVisible().catch(() => false);
    }, 'The saved source appears in the paper beside the editor', 60000);
    assert.equal(panel.visible, true);
    const placed = frame.page().waitForResponse((response: any) => response.url().includes('/manuscript/source/place?'), { timeout: 30000 });
    await vscode.commands.executeCommand('papilot.showPdf');
    assert.ok((await (await placed).json()).place, 'Source selection resolves to the PDF');
    await fs.promises.mkdir(path.join(root, 'test-results'), { recursive: true });
    await frame.page().screenshot({ path: path.join(root, 'test-results/vscode.png') });

    // The provider keeps the editor's original revision, including after a
    // failed save; a retry uses the same request identity.
    const writes: any[] = [];
    let failed = true;
    const source = { file: 'main.tex', text: 'Original', revision: 'old-revision', round: 3 };
    const fake = { request: async (_route: string, body?: unknown) => {
      if (!body) return source;
      writes.push(body);
      if (failed) { failed = false; throw new Error('The response was interrupted.'); }
      return { source: { ...source, text: 'Revised', revision: 'new-revision' }, state: { round: 4 } };
    } } as unknown as RuntimeClient;
    let saved = false;
    const provider = new TaskFiles(async () => fake, () => { saved = true; });
    try {
      const uri = taskUri({ projectId: 'paper', taskId: 'task', file: 'main.tex', lines: [0, 1] });
      assert.equal(Buffer.from(await provider.readFile(uri)).toString(), 'Original');
      await assert.rejects(provider.writeFile(uri, Buffer.from('Revised')), /interrupted/);
      await provider.writeFile(uri, Buffer.from('Revised'));
      assert.deepEqual(writes[0], writes[1]);
      assert.equal(writes[0].revision, 'old-revision'); assert.equal(writes[0].round, 3); assert.equal(saved, true);
    } finally { provider.dispose(); }
    fs.writeFileSync(report, JSON.stringify({ ok: true, url, node: process.versions.node, source: file }));
  } catch (error) {
    const pages = browser?.contexts().flatMap((context: any) => context.pages()) ?? [];
    await fs.promises.mkdir(path.join(root, 'test-results'), { recursive: true });
    if (pages[0]) await pages[0].screenshot({ path: path.join(root, 'test-results/vscode-failed.png'), timeout: 5000 }).catch(() => {});
    const body = await frame?.locator('body').innerText({ timeout: 1000 }).catch(() => 'unavailable');
    fs.writeFileSync(report, JSON.stringify({ ok: false, error: error instanceof Error ? error.stack : String(error), body, browserErrors, frames: pages.flatMap((page: any) => page.frames().map((frame: any) => frame.url())) }));
    throw error;
  } finally { panel?.dispose(); await browser?.close(); }
}
