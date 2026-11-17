# Papilot for VS Code

Papilot's existing paper workspace runs inside VS Code, alongside ordinary source editors. The extension reuses the app and review engine: project opening, compilation, agents, Git operations, annotations and review decisions use the same implementations.

The extension uses Papilot's repository and document selection. The **Files** menu opens source files and lets you choose which root document to compile; existing tasks keep their own document. Opening a TeX file in VS Code does not register a project or scan the workspace.

## Use

1. Open a repository in VS Code and run **Papilot: Open Workspace Folder**. Papilot uses its existing main-file detection and asks you to choose when needed.
2. Use the paper workspace in the Papilot editor tab. **Papilot: Open Papilot** reopens that tab without opening another project.
3. Select **Edit source** in the PDF tools and click a passage to open its LaTeX file in a native editor.
4. Run **Papilot: Show Selection in Paper** from a source editor to navigate back to the paper. It saves pending edits first.

Manuscript files open as ordinary workspace files. Task source opens through a `papilot-task:` filesystem provider. Its saves use Papilot's existing revision checks and review publication API, so a stale draft cannot silently overwrite a task's newer edits. Creating, deleting and renaming task files remains in Papilot's existing workflows.

Install Git, a working LaTeX distribution including `latexmk`, and any agent CLI you want to use on the workspace machine. The extension package includes Papilot's code, web assets and JavaScript dependencies. It uses VS Code's Node runtime and does not require a separate Papilot or Node installation. VS Code 1.119 or later is required.

## Build and package

From the repository root:

```sh
npm ci
npm --prefix engine ci
npm --prefix extensions/vscode ci
npm run build
npm --prefix engine run build
npm run vscode:build
code --extensionDevelopmentPath="$PWD/extensions/vscode" /path/to/paper-repository
```

To produce an installable VSIX:

```sh
npm run vscode:package
```

The package script builds both existing web interfaces and includes Papilot using the root package's existing npm allowlist. Packages are built for the current OS and CPU because dependencies include platform binaries. Install the resulting `extensions/vscode/papilot-*.vsix` using **Extensions: Install from VSIX**. The VSIX contains its own runtime, including the optional agent SDKs. Development launches use the checkout unless packaging has created `extensions/vscode/runtime`; remove that generated directory to return to the checkout.

## Structure

- `src/extension.ts` owns VS Code commands, the webview and native editor navigation.
- `src/task-files.ts` adapts native editor reads and writes to the existing task-source API.
- `src/runtime-client.ts` and `src/runtime-worker.mjs` own the embedded runtime. The shared app and review engines run in worker threads inside the extension-host process. They use loopback HTTP listeners for the existing web interfaces; there is no detached backend process.
- `src/bridge.ts` connects webview messages to the app's generic host events. The app and engine contain no VS Code imports or extension protocol handling.

The standalone app uses the same `createRuntime()` services with its original defaults. CLI process startup and shutdown remain in its entry point. Review engine connection discovery, repository locking and recovery remain shared with the CLI; the embedding API supplies a thread launcher. App updates are managed by the extension package in this host.

The runtime lives with the extension host. Closing the Papilot tab keeps tasks available while the workspace stays open; closing the VS Code window shuts down owned services. Papilot's existing recovery handles interrupted work on the next launch. A remembered loopback port preserves browser preferences and drafts across launches when that port remains available.

The extension is declared as a workspace extension and uses VS Code's port forwarding for its webview. The packaged extension has been tested with VS Code 1.119.0 on Linux x64. Remote hosts, other platforms and live agent execution need integration testing before release. Browser-only workspaces without a Node extension host are unsupported.

## Checks

```sh
npm --prefix extensions/vscode run typecheck
npm --prefix extensions/vscode test
npm --prefix extensions/vscode run test:vscode
```

Build both web interfaces before the tests. Runtime tests exercise actual source saves, compilation, review rendering, persistence and shutdown without model calls. The VS Code test uses an isolated profile and repository, opens the PDF, jumps to source, saves through the native editor and navigates back. It also checks task-save retry identity. It needs an installed VS Code (`PAPILOT_VSCODE_EXECUTABLE` can override `code`), Git, LaTeX and, on Linux, Xvfb. It writes a screenshot to `test-results/vscode.png`.

Set `PAPILOT_VSCODE_EXTENSION_PATH` to an extracted VSIX's `extension` directory to test the packaged runtime instead of the development directory.
