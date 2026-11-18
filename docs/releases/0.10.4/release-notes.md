# Papilot 0.10.4

This patch fixes unintended PDF jumps when clicking floating selection buttons and recognizes Codex backends bundled with desktop apps.

## What's fixed

- **Click the floating pencil without jumping to a PDF link underneath.** Add note and Edit source now fade in at a fixed position. Their click targets stay where you aim, including when clicking an icon or button edge as it appears. Ordinary PDF links continue to work. ([#163](https://github.com/PapilotAI/papilot/pull/163))
- **Use a desktop Codex installation without installing a separate CLI.** Papilot now detects the Codex desktop package on native Windows and supported Codex/ChatGPT desktop installations on macOS. Existing CLI installations still take priority, and reconnect checks again for a newly installed or updated desktop app. ([#162](https://github.com/PapilotAI/papilot/pull/162))

## Also in this release

The homepage, README screenshots and social preview now reflect the current interface. The README includes contributor avatars and Star History, synchronized across all translations. ([#141](https://github.com/PapilotAI/papilot/pull/141))

## Upgrading

No data migration is required from 0.10.3. Existing desktop users can check **Settings → Updates** for a compatible in-place update or the matching installer. Restart Papilot after updating to load the fixes.

If you installed Codex while Papilot was open, reconnect Codex or restart Papilot so it can discover the desktop installation.

## Get 0.10.4

- **Windows x64:** installer and portable executable in the assets below.
- **macOS:** Apple Silicon and Intel installers in the assets below.
- **Linux x64:** AppImage and Debian/Ubuntu packages in the assets below.
- **CLI:** `npm install -g papilot@0.10.4` (Node.js 22.22+).

Compiling your own papers requires Git and a TeX distribution; AI tasks use your connected agent.

Thanks to everyone who reported the floating-button misclicks and desktop Codex detection issues and helped reproduce them.

[Detailed changelog](https://github.com/PapilotAI/papilot/blob/v0.10.4/CHANGELOG.md) · [All changes since 0.10.3](https://github.com/PapilotAI/papilot/compare/v0.10.3...v0.10.4)
