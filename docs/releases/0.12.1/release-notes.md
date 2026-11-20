# Papilot 0.12.1

Finish a Typeless PDF note without moving the mouse away from the passage you selected. This patch improves the optional macOS voice-note workflow introduced in 0.12.0. ([#253](https://github.com/PapilotAI/papilot/pull/253))

## Keep the mouse in place

With **Settings → Experiments → Typeless voice notes** enabled, choose the PDF's **Note** tool and select a passage. Papilot focuses the draft and sends your configured Typeless shortcut. The microphone appears where you released the mouse: click there to send the shortcut again, wait for the transcript, then review the text and click the arrow in the same position to quote the note in the task.

- Region and sticky notes also place the action at the mouse release or click. In Select mode, it stays at the **Add note** button's click position after you open the draft.
- Long drafts grow or scroll beside the fixed action, including near viewport edges. The editor's microphone remains available for further dictation and stays in place while sending the shortcut.
- Transcription never submits automatically. Keyboard and touch entry keep their existing controls.

## Setup and limitations

The experiment remains off by default and requires the macOS desktop app, a running and configured Typeless installation, and Papilot's Accessibility permission. Typeless manages its own microphone permission and account.

The arrow means the draft contains text; it does not confirm that recording stopped or transcription is complete. Shortcut delivery does not expose Typeless's recording state, and closing a note does not stop dictation or cancel a late paste. **Stop dictation and wait for transcription before leaving the note.** See [setup and limitations](https://github.com/PapilotAI/papilot/blob/v0.12.1/docs/typeless.md).

## Installation and updates

- **Desktop 0.12.0:** use **Settings → Updates → Stable → Update now**. This release keeps the same desktop shell and production dependencies, so official 0.12.0 installations can receive the smaller app update without reinstalling Desktop. Older or incompatible installers may instead offer a full desktop download.
- **New desktop installations:** choose the matching release asset: macOS Apple Silicon/Intel DMG or ZIP, Windows x64 installer/portable executable, or Linux x64 AppImage/deb. Typeless controls are available only on macOS.
- **CLI/server:** run `npm install -g papilot@0.12.1` with Node.js 22.22 or newer, then restart Papilot. Browser clients receive their server's version; they cannot control the desktop Typeless integration.
- **Managed deployments:** rebuild the image or update the package through the deployment system.

Your existing papers and data are preserved. Updating does not enable the experiment.

[Detailed changelog](https://github.com/PapilotAI/papilot/blob/v0.12.1/CHANGELOG.md) · [All changes since 0.12.0](https://github.com/PapilotAI/papilot/compare/v0.12.0...v0.12.1)
