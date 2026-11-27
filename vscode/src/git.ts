import type * as vscode from 'vscode';
// Only the public surface used here, from vscode.git's version 1 API.
export interface Repository {
  rootUri: vscode.Uri;
  state: { onDidChange: vscode.Event<void> };
  status(): Promise<void>;
}
export interface GitAPI {
  state: "uninitialized" | "initialized";
  onDidChangeState: vscode.Event<"uninitialized" | "initialized">;
  git: { path: string };
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
  onDidCloseRepository: vscode.Event<Repository>;
  getRepository(uri: vscode.Uri): Repository | null;
}
export interface GitExtension { getAPI(version: 1): GitAPI }
