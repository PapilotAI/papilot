## CLI commands and background service

Install the CLI globally (`npm install -g papilot`, requires Node.js 22.22+) to run Papilot in a browser or on a remote workstation:

```sh
papilot                         # start at http://127.0.0.1:7274
papilot demo                    # copy the disposable 26-page example paper, then start
papilot doctor --json           # inspect environment, TeX, agents and Tailscale health
papilot service install         # macOS: register launchd user service (with caffeinate -i)
papilot service stop            # macOS: stop background service
```

- **Data locations**: the CLI stores its SQLite database, uploads and imported copies in `~/.papilot` (`%USERPROFILE%\.papilot` on Windows), separate from the desktop app's data folder (`~/Library/Application Support/Papilot` on macOS, `~/.config/Papilot` on Linux, `%APPDATA%\Papilot` on Windows, or `~/.local/share/papilot-desktop/data` inside WSL).
- **Custom port or data directory**: pass `--port <number>` (`PAPILOT_PORT`) or `--data <folder>` (`PAPILOT_DATA`); run `papilot --help` for the full flag list.

## Activity statistics

Open **Settings → Statistics** to inspect local activity across all papers or one paper over **7 days**, **30 days**, **90 days** or **All time**:

- Tracks accepted and rejected changes, agent working time, tasks started, daily activity calendar, acceptance rate, token/spend breakdown, active hours and agent/model usage.
- Click **Share** to render a theme-matched summary card (excluding paper names) as a PNG. All activity events stay strictly in your local SQLite workspace database.

## Updates and release channels

- **In-app updates**: open **Settings → Updates** to switch between **Stable** (tagged releases, currently `v{{release}}`) and **Dev (GitHub main)**. Downloads apply only when active tasks, pending approvals and PDF builds are idle; if a new runtime fails its startup check, Papilot automatically rolls back to the previous version and database snapshot.
- **Package-managed installs**: installations through Homebrew Cask, Scoop, WinGet, signed APT, Arch AUR, Nix or containers set `PAPILOT_INSTALL_METHOD=managed` (or `nix`), disabling in-app downloads so your package manager stays in charge while preserving all papers, notes and settings.

## Environment variables reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `PAPILOT_PORT` | `7274` | Local HTTP port (`127.0.0.1` only). |
| `PAPILOT_DATA` | `~/.papilot` (CLI) / `.papilot` (checkout) | SQLite database, uploads, updates and imported copies (Desktop uses OS app-data; override for testing with `PAPILOT_DESKTOP_DATA`). |
| `PAPILOT_WORKTREES` | `~/.papilot/worktrees` | Default root folder for new task Git worktrees (per-paper override: `worktrees` in `.git/papilot/settings.json`). |
| `PAPILOT_MEMORY` | `~/.papilot/memory.md` | Custom path for the global **All papers** writing memory file. |
| `PAPILOT_PUBLIC_ORIGIN` | Unset | Exact Tailscale URL (`scheme://host:port`) allowed for remote browser access. |
| `PAPILOT_TAILSCALE_LOGIN` | Unset | Tailscale account login permitted to open the remote workspace. |
| `PAPILOT_SERVICE_PATH` | Unset | Priority `PATH` directories saved for the macOS `papilot service install` agent. |
| `PAPILOT_INSTALL_METHOD` | Unset | Set to `managed` (or `nix`) when an external package/container pins Papilot's version and disables in-app updates/downloads. |
| `PAPILOT_*_BIN` | CLI on `PATH` | Explicit executable override for any CLI agent (`CODEX`, `CLAUDE`, `COPILOT`, `GROK`, `AGY`, `KIMI`, `DSH`, `QWEN`, `OPENCODE`, `PI`, `ZCODE`, `QODER`, `CODEBUDDY`, `WORKBUDDY`). |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `CURSOR_API_KEY`, `ZHIPU_API_KEY`, `ZAI_API_KEY`, `XAI_API_KEY` | Unset | Provider API keys and custom Anthropic-compatible gateway settings. |
| `PAPILOT_AGY_PROXY` | Unset | HTTP proxy applied only to `agy` child processes. |
| `PAPILOT_REVIEW_ENGINE` | `engine` | Path to the PDF review engine directory. |
