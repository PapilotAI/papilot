# Papilot for VS Code

Keep LaTeX papers and project code in the same editor. Papilot discovers papers in the workspace's Git repositories and opens each PDF in its own tab. The conversation lives in a separate sidebar, so switching between source, PDFs and reviews keeps it open.

- Edit LaTeX with VS Code's normal text editors, undo and save controls.
- Jump from PDF passages to LaTeX source, or use **Papilot: Show LaTeX Source in PDF** from an editor.
- Compile several papers in the same repository without changing Papilot's default document.
- Read compilation diagnostics in Problems and the TeX log in Papilot's Output channel. Recoverable errors can accompany a PDF.
- Add PDF notes, include them in tasks, and review the resulting changes with Papilot's existing viewer.
- Browse earlier review rounds and return to the current changes in the same tab. Source navigation opens the task's current worktree.
- Apply a reviewed task to the working tree, then stage and commit in VS Code's Source Control. Unsaved edits block operations that could overwrite them.

Requires VS Code 1.119 or newer, Git, a local TeX distribution, and a signed-in agent CLI for agent tasks. Open a trusted workspace containing a committed Git repository. Papilot lists independently buildable TeX roots and refreshes the list when TeX files change; included files stay with their paper.

The extension starts and stops its bundled runtime. There is no separate application server to install or start. Remote workspaces run Papilot and TeX on the remote host. The standalone app keeps its current interface and selected document.

PDF pages, changed passages, and review highlights follow VS Code's light or dark theme. Native commands and prompts use VS Code's display language.

## Development

From the repository root:

```sh
npm ci
npm run setup:review
npm --prefix extensions/vscode ci
npm --prefix extensions/vscode run typecheck
npm --prefix extensions/vscode test
npm --prefix extensions/vscode run build
npm --prefix extensions/vscode run test:web
npm --prefix extensions/vscode run test:host
npm --prefix extensions/vscode run package
```

`test:host` launches an isolated VS Code window with disposable papers. Set `PAPILOT_CODE` to a VS Code executable if it is not on PATH. On headless Linux, run it under `xvfb-run -a`.

Native strings use `src/i18n.ts` and `package.nls.json`. The shared i18n commands extract them alongside the app's messages; the extension build generates VS Code localization bundles from those catalogs.

Set `PAPILOT_TEST_VSIX` to a packaged VSIX to exercise its bundled runtime instead of the source checkout. The test opens two papers, edits LaTeX in the native editor, checks diagnostics and PDF navigation, renders the conversation sidebar, and stages a reviewed change in Git. It makes no live agent calls. `PAPILOT_HOST_INSPECT=1` keeps its temporary directory and screenshots.

Packaging uses the repository's npm package allowlist and lockfiles. It produces a VSIX for the build machine's OS and architecture, including production dependencies. Install it with **Extensions: Install from VSIX…**. Git, TeX, and agent installations remain local tools, as in Papilot's standalone app.
