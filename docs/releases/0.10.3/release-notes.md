# Papilot 0.10.3

This patch corrects Antigravity task status and honors explicit author authorization in task prompts.

## What's fixed

- **A completed Antigravity turn no longer fails because of an earlier API error.** When continuing a conversation, Antigravity could return an old timeout or server error after finishing the new edits and final reply. Papilot now recognizes that completion and generates the PDF comparison. New errors and unfinished work still report a failure.
- **A task blocked by permissions no longer appears completed.** If Antigravity stops at a declined operation without a final reply, Papilot marks the task as needing attention. The conversation identifies the operation, with translated guidance for continuing.
- **Explicit manuscript and Git authorization is respected.** Task prompts no longer contradict an author's explicit request to write to the manuscript, commit or push. Normal edits still use the isolated task directory, and the selected runtime permissions remain enforced.

## Upgrading

No data migration is required from 0.10.2. Existing desktop users can check **Settings → Updates** for a compatible in-place update or the matching installer. Restart Papilot after installing the update so its backend loads the fixes.

If a completed Antigravity task is already marked as failed by an old API error, use **Regenerate PDF comparison** to review its saved edits without asking the agent to repeat them.

## Get 0.10.3

- **Windows x64:** installer and portable executable in the assets below.
- **macOS:** Apple Silicon and Intel installers in the assets below.
- **Linux x64:** AppImage and Debian/Ubuntu packages in the assets below.
- **CLI:** `npm install -g papilot@0.10.3` (Node.js 22.22+).

Compiling your own papers requires Git and a TeX distribution; AI tasks use your connected agent.

[Detailed changelog](https://github.com/PapilotAI/papilot/blob/v0.10.3/CHANGELOG.md) · [All changes since 0.10.2](https://github.com/PapilotAI/papilot/compare/v0.10.2...v0.10.3)
