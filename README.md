# Papilot

A personal workspace for revising LaTeX papers with an AI agent (currently Codex) and reviewing the resulting PDF changes. Run it on your host computer and continue from a desktop, tablet, or phone.

- Give each editing task an isolated Git worktree and a persistent Codex conversation.
- Compare PDF changes, accept or reject edits, and send review feedback into the next turn.
- Keep tasks and messages across browser sessions, with up to two Codex tasks running concurrently.
- Preview each paper's manuscript as it is on disk, with its Git status.

The interface, built-in messages, and documentation are in English. Codex also defaults to English updates and questions. Your manuscript, project names, comments, and conversation history retain their original language.

Built with TypeScript, React/Vite, Fastify, SQLite, and the official Codex app-server over stdio.

## Run

Requires Node.js 22.22+, Git, a working TeX installation with `latexmk` and `synctex`, and a signed-in Codex account on the host.

```sh
npm ci
npm run setup:review
npm run build
npm start
```

Open [Papilot](http://127.0.0.1:4317). Select **Add paper** and enter the path to a LaTeX Git repository on the host. Later papers are added and switched from the paper menu at the top of the sidebar. The repository must have at least one commit and compile with `latexmk`. Custom root documents can use `.latex-review.json` as described in the [review engine reference](vendor/latex-review/docs/reference.md).

To try a sample first, run `npm run demo`. It registers a separate example Git repository under `.papilot/example-paper` without changing an existing manuscript. Start an editing task from the interface when you are ready to run Codex.

The bundled Codex CLI uses the host's normal Codex login/configuration. To sign in, run `./node_modules/.bin/codex login` on the host. No API key is stored by Papilot. Model selection defaults to the host's configured Codex model.

## Workflow

1. Select **New task**, describe the revision, and press Enter. The first line of the prompt becomes the task title. The paper and Codex model can be changed below the prompt.
2. Follow the conversation and answer any Codex questions or permission requests. Extra tasks queue when both execution slots are occupied.
3. When Codex finishes, Papilot builds the PDF review automatically. Accept, reject, or comment on individual changes in the viewer.
4. Use **Send feedback** below the PDF review to submit saved comments, or write further instructions in the conversation panel. Both actions include new review feedback. Sending comments opens the conversation on a phone, or the split view when reviewing on desktop, while preserving an unsent instruction draft.

While Codex works, the composer shows a stop button that pauses the task; when the chat is hidden, **Pause** appears in the task header instead. The header also keeps status and recovery actions beside the selected task. Choose **Review**, **Split**, or **Chat** for the desktop workspace; choosing a view always shows that view, and the choice is saved in this browser. On phones, switch between **Review** and **Chat** in the header. PDF controls share the review toolbar with the viewer's progress, **Accept all** and **Reject all**: reading zoom, **Full PDF**, and **Review options** for a manual build or a separate review tab. **Accept all** and **Reject all** apply only to changes you have not decided yet; accepted, rejected and commented changes keep their state, and one undo reverses the whole batch. On phones, the current change's Accept, Reject and Comment bar sits at the bottom of the screen, menus open as bottom sheets, **Full PDF** is in **Review options**, and **Fit** crops the page margins so the text block fills the width. The zoom menu enlarges PDF strips; scroll horizontally to read enlarged content. Real-device keyboard and touch behavior still needs validation on iOS and Android.

Select **Manuscript** under the paper in the sidebar to read the manuscript as it is on disk, including review changes you accepted but have not committed yet, beside its Git status: branch, upstream and ahead/behind counts, the last commit, and changed files with line counts. The sidebar shows a one-line summary of the same status. The preview recompiles when the working tree changes, keeping the previous pages visible meanwhile; **Recompile** retries a failed build and **Open PDF** opens the full PDF. A temporary Git index captures the working tree, so your index, branches and files are not touched. Builds reuse the review engine's cache in the repository's `.git/latex-review` folder, and rendered pages are stored under `.papilot/manuscripts`. On phones, switch between **PDF** and **Git** in the header.

The interface follows the manuscript's typography: TeX Gyre Pagella and Inconsolata (bundled in `src/web/fonts` with their licenses), small-capital labels, and the same palette as the review viewer.

**Send feedback** appears only while review comments have not reached Codex. Comments also go with any message you type, and the composer says how many will be included; pausing a queued message returns its comments to the unsent count. When only the chat is visible, a card at the end of the conversation announces a new review round and opens it. In **Split** view, drag the divider between the PDF and the chat to resize the chat; with the divider focused, the arrow keys resize it and Enter or a double-click resets it. The width is saved in this browser. Rename a task from its **Task actions** menu or by double-clicking it in the sidebar; Enter saves and Escape cancels. Each Codex reply has a **Copy** button, and the browser tab shows the selected task and how many tasks are waiting for your reply.

Conversation drafts are saved per task in this browser. Sending review comments preserves an unsent draft, and text entered while a message is sending stays in the composer. Switching tasks preserves pending submissions and unfinished Codex answers. If browser storage is unavailable, the workspace remains usable and drafts stay in the current tab until it closes or reloads. Press Enter to send and Shift+Enter for a new line. On touch keyboards, Enter adds a new line; use the send button. **Command+Enter** on macOS or **Ctrl+Enter** elsewhere always sends. Input-method composition is never sent by Enter. The new-task prompt is also saved in this browser until the task is created. Codex replies render basic Markdown. The **Add a paper** and delete dialogs keep keyboard focus inside them; **Escape** closes them when no submission is in progress.

The mobile task drawer keeps keyboard focus inside it and closes with **Escape**, returning focus to its opener. Long conversations follow new messages until you scroll up; **Latest messages** returns to the bottom. Connection loss is shown above the workspace even when the sidebar is hidden. Failed conversation and PDF review loads offer their own retry controls, so your instruction draft stays in place.

To remove a task, open the **Task actions** menu (the ⋯ button that appears when you hover over or focus that task in the sidebar) and choose **Delete task**. Opening its menu does not change the task you are reading. The confirmation defaults to **Cancel** and explains the permanent removal of its Papilot conversation, worktree, PDF review files, and unaccepted edits and comments. Accepted manuscript changes and other tasks stay in place, but the deleted task's review decisions can no longer be undone. Pause active or queued work first using that task's menu, wait for PDF builds, and resolve uncertain actions before deleting. If cleanup is interrupted, the task stays reserved as **Deleting task**; use **Retry deletion** to confirm cleanup. The review engine owns the file removal. Codex host history and the engine's internal bookkeeping are managed separately.

Use **Full PDF** to open the entire manuscript from the selected review round, after the task’s changes. This is a complete build, even when the diff used a partial build. It includes pending changes from that round, so it is not the accepted main manuscript. The browser PDF viewer supports reading, zooming and downloading. The endpoint also accepts `version=before` and `download=1`.

Review acceptance updates the manuscript's working tree without committing. Git conflicts are surfaced by the review engine; they are not automatically overwritten. Accept, reject, and undo are disabled while the task is running, queued, building, or awaiting reconciliation, with a reason shown in the viewer. Pause the task or resolve that state before deciding its changes. You can still read and add comments while Codex works. Acceptance is a manuscript decision, distinct from a Codex command permission request.

If a Codex start request or a review write has an uncertain outcome, the task displays **Check status**. Further editing and manuscript decisions remain blocked until that action is reconciled. Checking a review write retries its original action ID, so it cannot apply a second decision or undo a different action. Pausing a queued message preserves feedback that has not yet reached Codex.

Messages and queued runs are saved in `.papilot/papilot.sqlite`. Closing the browser does not stop a run. After a process restart, confirmed in-flight turns are marked interrupted and can be continued; already queued follow-up messages are retained. Uncertain operations remain reserved until their outcome is checked. Reconnecting after an uncertain request does not promise exactly-once execution of arbitrary Codex commands.

## Remote access with Tailscale

Papilot binds **only to 127.0.0.1**. Configure a private Tailscale Serve endpoint and the exact owner login shown by your tailnet. The server verifies the remote Host, browser Origin, and Tailscale identity supplied by the local proxy.

```sh
export PAPILOT_PUBLIC_ORIGIN=https://your-mac.your-tailnet.ts.net:8443
export PAPILOT_TAILSCALE_LOGIN=your-tailscale-login
npm run service:install
tailscale serve --bg --https=8443 http://127.0.0.1:4317
```

This uses a separate HTTPS port so an existing service on 443 can stay in place. Keep devices connected to your tailnet. Do not use Funnel for this personal workspace. The Codex app-server itself is never exposed to the network.

If certificate issuance cannot reach Let's Encrypt, use a private HTTP endpoint over the encrypted tailnet instead:

```sh
export PAPILOT_PUBLIC_ORIGIN=http://your-mac.your-tailnet.ts.net:8081
export PAPILOT_TAILSCALE_LOGIN=your-tailscale-login
npm run service:install
tailscale serve --bg --http=8081 http://127.0.0.1:4317
```

With HTTP Serve, the connection is protected by Tailscale rather than browser HTTPS. Browser features that require a secure context, such as the viewer's clipboard button, may be unavailable; native text selection and copying remain available.

If you use a private Tailscale IP instead of a MagicDNS hostname, set `PAPILOT_PUBLIC_ORIGIN` to the exact URL you open in the browser and configure the matching Serve host. Keep the same origin and owner identity when reinstalling the service. Preserve any other Serve endpoints already running on the host.

The launchd user agent starts after login, restarts the service on exit, and uses `caffeinate -i` to prevent idle system sleep while Papilot runs. A full reboot still requires the account to log in. Run `npm run service:stop` to stop it. Logs are in `.papilot/service.log` and `.papilot/service.error.log`.

For SSH access without Tailscale, run `ssh -N -L 4317:127.0.0.1:4317 user@your-host` on the computer running your browser, keep that terminal open, and visit `http://localhost:4317`.

The workspace uses short, non-overlapping polling on HTTP/1 connections so multiple tabs cannot exhaust the browser's connection pool with permanent event streams. HTTP/2 and HTTP/3 connections use event streams. Hidden workspace tabs pause their status refreshes and update when reopened; task switches cancel obsolete conversation requests. If upgrading from an older frontend leaves pages loading indefinitely, close the old Papilot tabs and reopen the workspace.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PAPILOT_PORT` | `4317` | Local HTTP port; the server binds to `127.0.0.1`. |
| `PAPILOT_DATA` | `.papilot` in the project root | SQLite state and generated example project. |
| `PAPILOT_CODEX_BIN` | Bundled Codex CLI, then `codex` on `PATH` | Codex executable used by the backend. |
| `PAPILOT_REVIEW_ENGINE` | `vendor/latex-review` | Review engine directory. |
| `PAPILOT_PUBLIC_ORIGIN` | Unset | Exact remote browser origin, including scheme and port. |
| `PAPILOT_TAILSCALE_LOGIN` | Unset | Tailscale login allowed to access the remote workspace. |

## Development and validation

```sh
npm run typecheck
npm test
npm run build
npm run test:ui
```

`npm run dev` watches the TypeScript backend. After frontend changes, run `npm run build` and reload the browser; the server serves rebuilt assets without a restart. Backend changes require a restart, which interrupts active turns, so wait for running tasks to finish first. To develop alongside an existing instance, use a different `PAPILOT_PORT` and `PAPILOT_DATA` directory.

The automated tests cover restart recovery, access restrictions, review proxy routes, Codex RPC, worktree reservations, stale events, uncertain-operation recovery, rebuilt frontend assets, and draft preservation during feedback, retries, and concurrent editing.

`npm run test:ui` uses Playwright from the review engine's development dependencies (installed by `npm run setup:review`) and an installed Chrome browser. Set `PAPILOT_BROWSER_CHANNEL` to use another installed Playwright browser channel. It exercises English copy, keyboard focus, mobile layouts, request failures, navigation during submission, stale snapshots, unanswered Codex requests, blocked browser storage, connection recovery, long conversations, and task deletion confirmation and retries. It saves screenshots in `test-results`. Browser checks use an isolated local server and simulated task data; they do not start real Codex runs or modify manuscripts. Backend deletion tests also exercise the actual review engine against a disposable Git repository, checking that accepted manuscript content and another task's worktree survive cleanup.

Codex recovery uses the bundled CLI's generated protocol definitions and the [official app-server protocol](https://developers.openai.com/codex/app-server). It matches the pending message identity before adopting a turn and never treats a transport timeout as proof that a turn stopped.

The app reuses the existing review viewer, including its lazy images and immutable assets. Full section-level JSON pagination and text-layer virtualization remain future work.

`scripts/verify-demo.ts --allow-example-writes` is an opt-in integration check for the generated sample only. After two real Codex tasks and a reviewer-requested second round, it checks conflict rejection, accepted changes from independent worktrees, undo, and proxied SVG delivery. Its safety check requires the exact `.papilot/example-paper` project and the recorded smoke-test task IDs; it will not run against an arbitrary manuscript.

## Review engine

`vendor/latex-review` is based on the existing MIT-licensed `latex-review-skill`. Its upstream revision is recorded in `UPSTREAM_COMMIT`; its license and source are preserved. A small viewer integration honors Papilot's decision availability state. Papilot uses the engine's public HTTP interface and does not write its SQLite database. The embedded review gateway only exposes review assets and review decisions, not shutdown or task-deletion endpoints.

See [REQUIREMENTS.md](REQUIREMENTS.md) for the initial scope and acceptance criteria.
