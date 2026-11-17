import * as vscode from 'vscode';
import path from 'node:path';
import type { DiscoveredPaper, PaperSearchFolder } from '../../../src/server/paper-discovery.ts';
import type { RuntimeClient } from './runtime-client.ts';

export async function workspacePapers(runtime: () => Promise<RuntimeClient>, token: vscode.CancellationToken): Promise<DiscoveredPaper[]> {
  const folders: PaperSearchFolder[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const config = vscode.workspace.getConfiguration(undefined, folder.uri);
    const excludes = { ...config.get<Record<string, unknown>>('files.exclude'), ...config.get<Record<string, unknown>>('search.exclude') };
    const patterns = ['**/{.git,node_modules,.papilot,build,out,output}/**', ...Object.entries(excludes).filter(([, enabled]) => enabled === true).map(([pattern]) => pattern)];
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.[tT][eE][xX]'), `{${patterns.join(',')}}`, undefined, token);
    if (token.isCancellationRequested) return [];
    folders.push({ path: folder.uri.fsPath, files: files.map(file => path.relative(folder.uri.fsPath, file.fsPath).split(path.sep).join('/')) });
  }
  if (!folders.some(folder => folder.files.length)) return [];
  const papers = await (await runtime()).call<DiscoveredPaper[]>({ type: 'papers', folders });
  return token.isCancellationRequested ? [] : papers;
}
