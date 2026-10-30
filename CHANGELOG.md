# Changelog

Notable changes to Papilot, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- The review's own bar stays under Papilot's PDF tools. When something scrolled the whole review page rather than its paper, the bar slid away and the tools sat over the PDF.

## [0.6.0] - 2026-10-30

### Added

- The PDF review lists the places an edit changes away from its own lines under that edit: the uses of a redefined macro, equations and references renumbered after an inserted equation, a new bibliography entry. The first three are shown and **Show N more** renders the rest. The places have no buttons; deciding the edit decides them. When a round has several edits, Papilot compiles the accepted text with some of them to tell which edit causes each change, so such a round can take longer to build.

### Changed

- On touch screens, the review and the PDF view select text with Papilot's own highlight, handles and **Add note** menu instead of the system's, which covered Papilot's: a long press picks a word, dragging extends it, and the handles move its ends.
- Every PDF build of a day prints the same date: Papilot sets TeX's `SOURCE_DATE_EPOCH` to the local date, unless you set it, so `\today` shows today and `\time` shows 12:00. A build kept from an earlier day is rebuilt rather than compared with today's.

### Fixed

- On phones, a long file path no longer widens the review past the screen, which cut the diff in half and put its buttons under the PDF tools.
- On phones, notes and comments are written in a card under the review toolbar, which the keyboard never covers. A note closed before it is written no longer blocks the next selection, and one left half-written reopens after a reload.

## [0.5.0] - 2026-10-29

### Added

- **Changes** beside **PDF** on the PDF page shows what changed since the last commit as a typeset diff, like a task's review. Each change can be staged, unstaged or reverted on its own (**Undo revert** puts a revert back), so one revision can become several commits.

### Changed

- The Git panel's checkboxes are the Git index: a ticked file is staged, a half-ticked one partly staged. **Commit** takes what is staged, or with nothing staged, every file but build output as before.

## [0.4.0] - 2026-10-29

### Added

- **People**: invite an advisor or co-authors to chosen papers. They sign in with a passkey at a public HTTPS address (`PAPILOT_ACCOUNT_ORIGIN`, for example Tailscale Funnel on port 10000), see only the papers you share, and can work in them as you do. Their messages and notes show their name. You can unshare a paper, remove a device or a person at any time, and get your own passkey to use the public address. Invite only people you would trust with access to the computer Papilot runs on: agents and builds can read any file on it.

### Changed

- Commit messages are written by the agent's small model (GPT Luna, Claude Haiku or Gemini Flash, when the agent offers one), and a finished review's message is written as soon as you decide the last change, so **Commit…** usually opens with it ready. The generate button writes a new one.

### Fixed

- Mathematical letters such as 𝐹 no longer turn into Hangul syllables in PDF note quotes, marked regions and review diffs.
- The **Language** setting uses the same menu as the model picker, instead of the browser's plain list with a different size and arrow.

## [0.3.0] - 2026-10-29

### Added

- A finished review offers an optional **Commit…**: the task's agent writes the message, and **Commit and push** pushes too. Accepted changes are still in the manuscript without it.
- The Git panel's ✨ button writes the commit message, like Cursor's: the agent you chose reads the ticked files' changes and follows the style of your recent commits.
- When your branch and its upstream have both changed, the Git panel offers **Merge**; an agent resolves the conflicts, and you read the diffs, then **Commit merge** or **Abort merge**.
- Untracked build output (LaTeX's `.aux`, `.log` and the like, minted's cache, `.DS_Store`) gets **Add to .gitignore**, which adds one pattern per kind of file.

### Fixed

- A task no longer stops at **This step needs attention** when the agent's own edits stop the PDF build, for example by also editing a project note outside the paper's source folder. The agent gets the error and fixes it in one more turn, and its instructions now say which files the review covers.
- Build output in the Git panel is unticked from the moment it appears, so a quick commit cannot include it.
- **Accept all** and **Reject all** no longer break onto two lines or slide under the PDF tools in a narrow review panel or on a phone. Their count is a badge, and the toolbar makes room in steps, down to each button's icon and count.

## [0.2.0] - 2026-10-29

### Added

- Skills: type `/` in any prompt, or pick a suggestion on the new-task page, to run **Polish**, **Proofread**, **Shorten**, **Check math**, **Consistency**, **Fix LaTeX warnings** or **Address reviewers** without writing the prompt. Add your own as Markdown files in `~/.papilot/skills` or a paper's `.papilot/skills`.
- **Settings** in the sidebar holds **Appearance** (light, dark or the system setting, for the workspace and the review viewer; in dark, PDF pages turn dark too), **Language** (English or Simplified Chinese, following the browser by default) and **Notifications** (a browser notification when a task needs your reply, its review is ready, or it stops with an error while Papilot is in the background).
- **Notes** in the PDF review: select any text, including accepted or unchanged text, or mark a region, and send the notes to the task's agent together.
- Agent replies typeset LaTeX mathematics.
- `papilot doctor` checks the environment and suggests fixes without installing software or changing papers; `--repo` checks a paper and `--json` outputs a report for scripts.

### Changed

- The chat shows what you did rather than the prompt the agent receives: a skill by name with your words, and sent review feedback as its decisions and comments.
- **Send feedback** asks only for comments, or for a round you rejected entirely; accepted and rejected decisions reach the agent with your next message.
- Decided changes leave the current review and become clean PDF text. **History** holds earlier diffs and **Undo last decision**; sending feedback shows the agent's progress until new changes arrive.
- The PDF's contents sit in the side panel beside Notes and Git.

### Fixed

- **Send feedback** includes accepted and rejected review decisions, so a round without comments can still be sent to the agent. Queued or delivered feedback no longer prompts another send.
- Claude is available with `ANTHROPIC_AUTH_TOKEN`, the key a gateway or another service's Anthropic-compatible `ANTHROPIC_BASE_URL` uses, instead of asking for an Anthropic API key. The guide shows how to map the model menu onto that service's models.
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

[Unreleased]: https://github.com/cu1ch3n/papilot/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/cu1ch3n/papilot/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/cu1ch3n/papilot/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/cu1ch3n/papilot/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/cu1ch3n/papilot/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/cu1ch3n/papilot/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/cu1ch3n/papilot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cu1ch3n/papilot/releases/tag/v0.1.0
