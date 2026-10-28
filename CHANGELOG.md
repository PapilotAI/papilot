# Changelog

Notable changes to Papilot, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `papilot doctor` checks the environment and suggests fixes without installing software or changing papers; `--repo` checks a paper and `--json` outputs a report for scripts.

### Changed

- The PDF's contents sit in the side panel beside Notes and Git.

### Fixed

- The macOS background service keeps the tool search path of the shell it was installed from, and `PAPILOT_SERVICE_PATH` picks a particular TeX or Python installation for it.
- KOMA-Script papers build and review correctly.
- Build errors show the TeX diagnostic together with any Python helper exception, such as one from `latexminted`.

## [0.1.1] - 2026-10-27

### Changed

- Papilot listens on port 7274 by default, which spells PAPI on a phone keypad. Use `--port 4317` or `PAPILOT_PORT=4317` to keep the old port.

## [0.1.0] - 2026-10-27

The first release on npm.

### Added

- `npm install -g papilot` and the `papilot` command. `papilot demo` adds a 26-page example paper, and `papilot codex login` signs in to Codex.
- An existing Codex of the tested version or newer is used as it is; otherwise Codex is installed once on first start. The Claude Agent SDK is downloaded the first time Claude is used with an API key.
- Tasks run on Codex, Claude or Antigravity, each in its own Git worktree, with up to two at once.
- Every change comes back as a typeset PDF diff to accept, reject or comment on. Each decision can be undone, and Accept all and Reject all act only on undecided changes.
- A PDF reader with contents, search, zoom and exact text selection. Notes on a passage or a marked region reach the agent with their LaTeX lines.
- A Git panel to diff files, commit the chosen ones, and fetch, pull or push.
- Remote access through Tailscale, and a background service on macOS.

[Unreleased]: https://github.com/cu1ch3n/papilot/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/cu1ch3n/papilot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cu1ch3n/papilot/releases/tag/v0.1.0
