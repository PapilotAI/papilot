## Recover by symptom

None of the steps below delete manuscript files, task worktrees or unsent chat drafts.

### Git, latexmk or SyncTeX is missing

1. Open **Settings → Git** and click **Check again**, or open **Settings → LaTeX** and click **Detect again**.
2. Install the missing tool on the machine running Papilot (MacTeX on macOS; TeX Live or MiKTeX + Perl on Windows; TeX Live + Git on Linux; inside the selected Linux distro when using Windows **WSL** mode).
3. If the tool works in a new terminal but Papilot still reports it missing, **restart Papilot** so the backend inherits the updated `PATH`. For the macOS background service, pass custom binary directories via `PAPILOT_SERVICE_PATH=/custom/bin papilot service install`.

### The paper does not compile

1. **During import**: check **Main TeX file** and **LaTeX engine** (`pdfLaTeX`, `XeLaTeX` for `fontspec`/`xeCJK`, or `LuaLaTeX`) and click **Retry compilation**, or click **Help fix compilation** to let a connected agent diagnose and propose uncommitted repairs. **Add and fix later** opens the workspace even before the first build succeeds.
2. **In the workspace**: expand **Compilation Problems** above the PDF. Recoverable LaTeX errors still display the generated PDF while listing diagnostics; fatal errors keep the previous good PDF visible.
3. Click **Fix with an agent…** inside **Compilation Problems**: in one read-only turn, the agent inspects the compiler log and either tests a build-setting fix (engine, source folder or `latexmkrc`) or offers **Start task** to fix `.tex` errors in an isolated task worktree.
4. **Auxiliary-file or `minted` issues**: click **Recompile** to rebuild cleanly. If `latexminted` fails under a newer system Python (such as Python 3.14), update `latexminted` or point `PAPILOT_SERVICE_PATH` at Python 3.12. To fail at the first error instead of continuing past recoverable errors, set `"halt_on_error": true` in `.git/papilot/settings.json` (see [engine reference](../../engine/docs/reference.md)).
5. **Experimental PhiTeX**: if **Settings → Experiments → Compile with PhiTeX** is enabled, note that LuaLaTeX stays on `latexmk`, custom `latexmkrc` rules do not run, and the first XeLaTeX font index can take several minutes. Turn the switch off to return immediately to `latexmk`.

### An agent is unavailable, signed out or fails to connect

1. Open **Settings → Agents** and select the agent's card to see the exact detection result.
2. For CLI agents (`codex`, `claude`, `copilot`, `grok`, `agy`, `kimi`, `dsh`, `qwen`, `opencode`, `pi`, `qoder`, `codebuddy`), run the CLI's login command in a terminal on the Papilot host, then click **Reconnect** (or **Refresh**). Note that IDE launchers (Cursor app, Qoder IDE, CodeBuddy IDE, Antigravity IDE) are separate from their headless agent CLIs.
3. For environment-variable keys (`ANTHROPIC_API_KEY`, `CURSOR_API_KEY`, `ZHIPU_API_KEY` / `ZAI_API_KEY`, `XAI_API_KEY`) or custom binary paths (`PAPILOT_*_BIN`), set them in the environment that launches Papilot and **restart Papilot** — clicking **Reconnect** cannot read variables from a different terminal session.
4. **Proxies**: if your network requires an HTTP proxy, start Papilot with `HTTP_PROXY` and `HTTPS_PROXY` set and include `NO_PROXY=localhost,127.0.0.1,::1` so local review-engine traffic stays direct (`PAPILOT_AGY_PROXY` sets a proxy for Antigravity only).
5. **AI review or commit-message helper refused**: `Qoder`, `CodeBuddy` and `WorkBuddy` do not offer a verified read-only mode; connect another agent (such as Papilot Writer, Codex or Claude) for `/ai-review`, compilation diagnosis and `✨` commit messages.

### A review will not open or shows Check status

- Click **Check status** in the task header. Papilot reconciles saved review decisions using idempotent action IDs (so a decision is never applied twice) and resumes or rebuilds once if the PDF comparison service was interrupted by a restart. Your task worktree and unsent drafts remain intact.

### Overleaf sync or manuscript merge conflicts

- **Overleaf amber dot or conflict**: click the **Overleaf** row below **Version Management** and choose **Retry**. If both you and an Overleaf coauthor edited the same passage while offline, Overleaf's text stays live while the panel shows both versions — choose **Use mine** or **Keep Overleaf's**.
- **Overlapping manuscript edits when applying a task**: if the manuscript changed while a task was running, clicking **Apply** or **Commit** never overwrites the newer wording; instead Papilot prepares a conflict-resolution review in the task worktree for you to inspect and confirm (**Confirm and commit** / **Confirm and apply**).
- **Git merge conflict (`!`)**: in **Version Management**, use **Resolve with** to let an agent draft a clean merge in the conflicted files, inspect each file diff and click **Commit merge** — or click **Abort merge** to return immediately to your pre-merge state.

### Phone or tablet cannot reach Papilot

1. Confirm both devices are connected to the same Tailscale tailnet and that **Funnel is off** (Papilot refuses public Funnel requests).
2. Verify `PAPILOT_PUBLIC_ORIGIN` matches the **exact** scheme, hostname and port opened in the mobile browser, and `PAPILOT_TAILSCALE_LOGIN` matches your tailnet login (`papilot doctor` validates both).
3. If an older tab hangs after an update, close the tab completely and reopen the URL.

### An update waits or rolls back

- In-app updates (**Settings → Updates**) wait until active tasks, pending approvals and PDF builds are idle. Pause or finish running tasks, or click **Retry update** if a download failed. If a new runtime fails its startup check, Papilot automatically restores the previous version and SQLite database. System-packaged and Nix installs (`PAPILOT_INSTALL_METHOD=managed` or `nix`) leave upgrades to your package manager.

## Where to get diagnostics and logs

- **Desktop logs**: choose **Help → Show Logs** from the app menu (`~/Library/Logs/Papilot/backend.log` on macOS, `~/.config/Papilot/logs/backend.log` on Linux, `%APPDATA%\Papilot\logs\backend.log` on Windows, or `~/.local/share/papilot-desktop/data/logs/backend.log` inside WSL).
- **CLI diagnostics (`papilot doctor`)**: checks Node.js, built assets, data directory, Git, `latexmk`, SyncTeX, TeX engines, agent CLIs/keys and Tailscale settings without sending any model prompt or modifying files (`0` = healthy/warnings only, `1` = blocking error, `2` = invalid flags):

```sh
papilot doctor
papilot doctor --repo /path/to/paper
papilot doctor --json
```

- **Update and service logs**: update logs live under `<PAPILOT_DATA>/updates/` (`install.log`, `restart.log`, `desktop/`); macOS `launchd` logs live in `~/.papilot/service.log` and `service.error.log`.
- **Platform verification note**: setup and recovery steps are verified on macOS and through deterministic Linux/Windows CI and protocol suites (native Windows 11 x64 + WSL Ubuntu 24.04 details are recorded in [Windows reference](../windows.md)).
