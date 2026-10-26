# Papilot

A personal TypeScript workspace for real Codex sessions and LaTeX PDF review, running on your Mac mini. React/Vite frontend, Fastify backend, SQLite persistence, and the official Codex app-server over stdio.

## Run

Requires Node 22.22+ (Node 24 LTS recommended), Git, a working TeX installation with `latexmk` and `synctex`, and a signed-in Codex account on the host.

```sh
npm install
npm run setup:review
npm run build
npm run demo
npm start
```

Open `http://127.0.0.1:4317`. The demo creates a separate example Git repository under `.papilot/example-paper`; it does not modify an existing manuscript. Create a task to run real Codex, or add your own repository by its absolute path on the host. Custom root documents can use `.latex-review.json` as documented in `vendor/latex-review/docs/reference.md`.

The bundled Codex CLI uses the host's normal Codex login/configuration. To sign in, run `./node_modules/.bin/codex login` on the host. No API key is stored by Papilot. Model selection defaults to the host's configured Codex model.

## Workflow

The toolbar controls the task sidebar, PDF review, and Codex conversation panels. Collapse either content panel for a full-width view; desktop layout choices are saved in this browser. On phones, switch between review and conversation tabs. The review zoom menu enlarges PDF strips; swipe a strip horizontally to read the enlarged content. The layout follows the visual viewport when the keyboard opens. Checked in Chrome device simulation at 320 × 568 and 390 × 844: task drawer, review/conversation switching, 200% reading zoom, comment placement, and unsent draft preservation. iOS/Android keyboard and touch behavior still need real-device validation.

Use **完整 PDF** to open the entire manuscript from the selected review round, after the task’s changes. This is a complete build, even when the diff used a partial build. It includes pending changes from that round, so it is not the accepted main manuscript. The browser PDF viewer supports reading, zooming and downloading. The endpoint also accepts `version=before` and `download=1`.

Each task gets a review-engine worktree and a persistent Codex thread. Codex edits the worktree; Papilot automatically publishes the PDF review when the turn ends. Accept/reject/comment in the embedded viewer. Use the conversation panel to send saved feedback back to the same Codex thread. You can run two tasks concurrently; extra tasks queue.

Review acceptance updates the manuscript's working tree without committing. Git conflicts are surfaced by the review engine; they are not automatically overwritten. Pause a running task before accepting/rejecting/undoing its changes. Acceptance is a manuscript decision, distinct from a Codex command permission request.

Messages and queued runs are saved in `.papilot/papilot.sqlite`. Closing the browser does not stop a run. After a process restart, in-flight work is marked interrupted and can be continued; already queued follow-up messages are retained. Reconnecting after an uncertain request does not promise exactly-once execution of arbitrary Codex commands.

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

The initial Mac mini deployment uses this mode because its ACME connection is reset by the upstream network. The browser-to-server connection is protected by Tailscale, rather than browser HTTPS. Browser secure-context-only conveniences such as the original viewer's clipboard button may be unavailable; native text selection/copy remains available.

The current deployment is **http://100.92.130.21:8081/**, restricted to the owner's Tailscale identity. It uses the private IP to avoid sending the MagicDNS hostname through a browser's external proxy. Tailscale 1.98's HTTP handler appends the tailnet suffix to bare hosts, so its Serve config includes `100.92.130.21.basa-tailor.ts.net:8081` as an alias for the same loopback backend. The previous Serve configuration is saved at `.papilot/tailscale-serve-before-ip.json`; the existing HTTPS 443 service is preserved. When reinstalling this deployment, set `PAPILOT_PUBLIC_ORIGIN=http://100.92.130.21:8081` and keep the configured owner identity.

The launchd user agent starts after login, restarts the service on exit, and uses `caffeinate -i` to prevent idle system sleep while Papilot runs. A full reboot still requires the account to log in. Run `npm run service:stop` to stop it. Logs are in `.papilot/service.log` and `.papilot/service.error.log`.

Optional environment variables: `PAPILOT_PORT` (4317), `PAPILOT_DATA`, `PAPILOT_CODEX_BIN`, `PAPILOT_REVIEW_ENGINE`, `PAPILOT_PUBLIC_ORIGIN`, `PAPILOT_TAILSCALE_LOGIN`. Keep the same remote variables when reinstalling the service.

## Development and validation

```sh
npm run typecheck
npm test
npm run build
```

`npm run dev` watches the TypeScript backend; rebuild the frontend after changes. The initial version deliberately reuses the existing review viewer, including its lazy images and immutable assets. Full section-level JSON pagination and text-layer virtualization remain future work.

`scripts/verify-demo.ts --allow-example-writes` is an opt-in integration check for the generated sample only. After two real Codex tasks and a reviewer-requested second round, it checks conflict rejection, accepted changes from independent worktrees, undo, and proxied SVG delivery. Its safety check requires the exact `.papilot/example-paper` project and the recorded smoke-test task IDs; it will not run against an arbitrary manuscript.

## Review engine

`vendor/latex-review` is a pinned copy of the existing MIT-licensed `latex-review-skill`. Its revision is recorded in `UPSTREAM_COMMIT`; its license and source are preserved. Papilot uses its public HTTP interface and does not write its SQLite database. The gateway only exposes review assets and review decisions, not shutdown or task-deletion endpoints.

See [REQUIREMENTS.md](REQUIREMENTS.md) for the initial scope and acceptance criteria.
