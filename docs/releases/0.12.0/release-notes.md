# Papilot 0.12.0

Turn feedback into PDF notes, see which passages are already being revised, and check references without losing your place. This release also remembers model settings and removes small interruptions from review and committing.

## Turn feedback into notes

**Ask an agent to place comments on your manuscript.** For example: “Turn the feedback in comments.txt into PDF annotations without changing the manuscript.” Ordinary tasks can search the current PDF, read the relevant passages, and create or revise notes at their actual locations. Comments can also come from the conversation. Notes appear in **Manuscript → My notes** and are saved as the agent works, so an interrupted turn does not discard notes already created. ([#250](https://github.com/PapilotAI/papilot/pull/250))

Codex and Papilot Writer have native annotation tools. Other supported agents use a local client and need command and local-network access; Cursor's network-disabled sandbox cannot use it. A current compiled PDF with selectable text is required. These tools annotate the manuscript, not unaccepted task edits.

## Keep reading while revisions run

- **See work already in progress.** Notes sent to a task remain on the manuscript as faint dashed marks, with status dots for running and ready tasks. Click a mark or use its keyboard-accessible dot to open the task's review. Unfinished paused or failed tasks remain visible; marks clear after completion, application, commit or deletion. This makes it easier to continue reading without requesting the same edit twice. ([#248](https://github.com/PapilotAI/papilot/pull/248))
- **Peek at an equation, figure, table or citation.** Hover an internal PDF link, Alt-click it (Option-click on Mac), or focus it with the keyboard to see an excerpt without changing the page, zoom or reading position. Escape dismisses it; ordinary clicks and touch taps still navigate. Embedded internal links are required, and large objects may extend beyond the excerpt. ([#249](https://github.com/PapilotAI/papilot/pull/249))
- **Stay in PDF review until you choose to inspect source.** Changes without a visible PDF difference, unavailable previews and failed comparisons show compact status messages with explicit **Show LaTeX source** and **Retry comparison** actions. Pending review decisions are preserved. Annotation alternatives start preparing earlier and prioritize the option being inspected, while optional previews continue to load without blocking the main review. ([#246](https://github.com/PapilotAI/papilot/pull/246), [#239](https://github.com/PapilotAI/papilot/pull/239))

## Repeat fewer settings

- **Remember model choices.** Reasoning effort and Fast mode are remembered per model, and editing permissions per agent, across model switches and reloads. Switching an existing task to another agent restores that agent's supported settings. Preferences stay in this browser or desktop app; they do not sync between devices. ([#247](https://github.com/PapilotAI/papilot/pull/247))
- **Control commit messages in Settings → Git.** Generation follows the current conversation's agent, model, effort and Fast mode by default, or uses your saved explicit choice. Choose the commit-message language independently of the interface; **Auto** follows recent commits. These choices apply to task commits as well as the Git panel. ([#238](https://github.com/PapilotAI/papilot/pull/238), [#244](https://github.com/PapilotAI/papilot/pull/244))
- **Check Antigravity quotas from the model menu.** New and existing tasks show reported five-hour and weekly usage, reset times and model groups. Missing quota data does not block a conversation. ([#237](https://github.com/PapilotAI/papilot/pull/237))

## Typeless voice notes: an opt-in Mac experiment

Enable **Settings → Experiments → Typeless voice notes** in the macOS desktop app to send Typeless's configured dictation shortcut when opening a new PDF note, or from the note's microphone button. Typeless must be installed, running and configured, with its own account and microphone permissions; Papilot needs macOS Accessibility permission. ([#242](https://github.com/PapilotAI/papilot/pull/242))

The success icon confirms shortcut delivery, not recording state. Opening a note while Typeless is already recording can stop it. Closing or switching notes does not stop dictation or cancel a late paste: **wait for transcription before leaving the note**. The experiment starts off and is unavailable in browser clients, Windows and Linux. See [setup and limitations](https://github.com/PapilotAI/papilot/blob/v0.12.0/docs/typeless.md).

## Other fixes and improvements

- Reading anchors remain usable at their saved positions while relocation is pending or fails, with a retry for failed lookups. ([#243](https://github.com/PapilotAI/papilot/pull/243))
- Successful Antigravity turns can proceed to review when the CLI repeats an older capacity error after a model switch. Windows detects DeepSeek Harness in a custom installation folder even when `dsh` is missing from PATH. ([#240](https://github.com/PapilotAI/papilot/pull/240), [#241](https://github.com/PapilotAI/papilot/pull/241))
- Successful tasks stay green until their results are applied or committed. New-paper progress starts after **Create paper**, instead of during folder selection. ([#235](https://github.com/PapilotAI/papilot/pull/235), [#225](https://github.com/PapilotAI/papilot/pull/225))
- The full five-stripe logo appears consistently in the app and browser tabs. The README now illustrates the writing workflow and installation choices, and the website adds clearer GitHub links. ([#232](https://github.com/PapilotAI/papilot/pull/232), [#245](https://github.com/PapilotAI/papilot/pull/245), [#230](https://github.com/PapilotAI/papilot/pull/230))

## Installation and updates

- **Desktop:** upgrading from 0.11.0 requires downloading the new desktop package. Use **Settings → Updates** or the matching release asset: macOS Apple Silicon/Intel DMG or ZIP, Windows x64 installer/portable executable, or Linux x64 AppImage/deb. Quit Papilot before replacing the application. Keep your existing Papilot data and paper folders.
- **CLI/server:** run `npm install -g papilot@0.12.0` with Node.js 22.22 or newer, then restart Papilot. Browser users receive the version installed on their server. npm updates do not replace the desktop application.
- **Managed deployments:** rebuild the image or upgrade the package through its deployment system.

Compiling papers requires Git and a TeX distribution on the host. Configure your chosen agent or Writer provider for AI tasks; model access and usage remain with your provider. Updating does not enable experiments.

## Thanks

Thanks to @chengluyu for making the Git-sync conflict regression independent of local Git settings ([#217](https://github.com/PapilotAI/papilot/pull/217)).

[Detailed changelog](https://github.com/PapilotAI/papilot/blob/v0.12.0/CHANGELOG.md) · [All changes since 0.11.0](https://github.com/PapilotAI/papilot/compare/v0.11.0...v0.12.0)
