# Papilot 0.13.0

Review edits directly in place on the full PDF, decide individual annotations that share a paragraph, sort and tag manuscript notes, and configure a dedicated Git conflict-resolution agent.

## Full-PDF review and annotation-scoped decisions

- **Review changes directly on the full PDF.** Changes appear in place inside the full paper with a single-row review toolbar, top-bar change navigator, and full-paper ChangeMap scrollbar, removing the `PDF | Changes` toggle and intermediate `AppliedPaper` builds — built on the full-document review prototype and discussion by [@RIvance](https://github.com/RIvance). ([#263](https://github.com/PapilotAI/papilot/pull/263), [#310](https://github.com/PapilotAI/papilot/pull/310))
- **Inline annotations, alternative options, and per-annotation splitting.** Linked annotations and alternative-option previews render inline directly beneath each change header, removing the separate bottom note drawer and scope switcher. When annotations divide a single change block, numbered chips (`1 #5`, `2`, `3`) let you review and decide each annotation group directly on the PDF (compiling a single clean mixed preview once a split block finishes with both accepts and rejects). Unannotated blocks and blocks covered by a single annotation stay one-click decisions. ([#316](https://github.com/PapilotAI/papilot/pull/316), [#317](https://github.com/PapilotAI/papilot/pull/317))
- **Cleaner diff granularity and page crops.** Heavily rewritten prose passages consolidate into coherent units, running headers and page numbers stay out of body diffs unless directly edited, merged strips stay in reading order, and word highlights align cleanly across hyphenation, prose rewraps, and justified LaTeX spaces. ([#310](https://github.com/PapilotAI/papilot/pull/310), [#316](https://github.com/PapilotAI/papilot/pull/316), [#317](https://github.com/PapilotAI/papilot/pull/317))

## Manuscript annotations

- **Sort annotations in My notes.** Order notes and color groups by **Original order**, **PDF position**, or **Newest first**, while keeping unconfirmed notes at the end in PDF position order and preserving PDF marker numbers. ([#291](https://github.com/PapilotAI/papilot/issues/291), [#311](https://github.com/PapilotAI/papilot/pull/311))
- **Color groups and quick-note stamps in agent tools.** `annotation_create` and `annotation_update` now accept optional color `group` (`yellow`, `green`, `purple`, `orange`, `red`) and `stamp` labels (including updating or clearing them without resending `comment`), displayed on grouped notes in **My notes** and colored PDF marks. ([#292](https://github.com/PapilotAI/papilot/issues/292), [#312](https://github.com/PapilotAI/papilot/pull/312))
- **Smooth wheel scrolling over note cards.** Scroll through **My notes** and **Notes in this task** while the pointer is over annotation cards or inline editors, keeping overscroll contained inside the list and floating popovers. ([#293](https://github.com/PapilotAI/papilot/issues/293), [#294](https://github.com/PapilotAI/papilot/pull/294))

## Git, desktop, and packaging

- **Dedicated conflict-resolution agent.** Pick a separate agent in **Settings → Git** for resolving merge conflicts, defaulting to the current conversation, and review the resolution before committing. ([#269](https://github.com/PapilotAI/papilot/issues/269), [#285](https://github.com/PapilotAI/papilot/pull/285))
- **Faster Typeless note confirmation on macOS.** Keep the Typeless microphone and quote-confirm arrow at the pointer release location when creating a PDF note; transcription still requires explicit confirmation. See [Typeless voice notes](https://github.com/PapilotAI/papilot/blob/v0.13.0/docs/typeless.md). ([#253](https://github.com/PapilotAI/papilot/pull/253))
- **Centralized task worktrees.** New task worktrees are stored under `~/.papilot/worktrees` by default while preserving existing task paths and project overrides. ([#273](https://github.com/PapilotAI/papilot/issues/273), [#288](https://github.com/PapilotAI/papilot/pull/288))
- **Linux package distribution.** Added automated signed APT (amd64) and Arch Linux AUR (x86_64) release recipes for official desktop builds with package-managed upgrades. ([#267](https://github.com/PapilotAI/papilot/issues/267), [#268](https://github.com/PapilotAI/papilot/issues/268), [#283](https://github.com/PapilotAI/papilot/pull/283), [#284](https://github.com/PapilotAI/papilot/pull/284))

## Other fixes

- Honor the configured commit-message language when drafting initial task-review commits. ([#255](https://github.com/PapilotAI/papilot/issues/255), [#274](https://github.com/PapilotAI/papilot/pull/274))
- Keep PDF reference previews aligned with their links as the document scrolls, zooms, or resizes, and close them when the link leaves view. ([#260](https://github.com/PapilotAI/papilot/issues/260), [#277](https://github.com/PapilotAI/papilot/pull/277))
- Open Settings from the macOS Papilot menu or with **⌘,** without discarding the active settings page or unsaved edits. ([#262](https://github.com/PapilotAI/papilot/issues/262), [#279](https://github.com/PapilotAI/papilot/pull/279))
- Refresh the website's GitHub star count with a 15-minute edge cache and graceful fallback. ([#257](https://github.com/PapilotAI/papilot/issues/257), [#276](https://github.com/PapilotAI/papilot/pull/276))

## Update or install

- **Desktop:** upgrading from 0.12.1 requires downloading the new 0.13.0 desktop installer/package because the desktop shell and bundled dependencies changed. Download the matching release asset (macOS Apple Silicon/Intel DMG or ZIP, Windows x64 installer or portable executable, or Linux x64 AppImage/deb) or open the release link from **Settings → Updates**. Quit Papilot before replacing the application; your papers, tasks, and settings stay intact.
- **Command line and web server:** run `npm install -g papilot@0.13.0` with Node.js 22.22 or newer, then restart Papilot.
- **Managed, APT, and AUR installations:** update through your package manager or deployment system.

Compiling manuscripts requires Git and a TeX distribution on the host. Experiments remain off unless enabled.

## Thanks

Thanks to [@RIvance](https://github.com/RIvance) for the full-document review prototype and discussion ([#263](https://github.com/PapilotAI/papilot/pull/263)) and [@iyuzhang](https://github.com/iyuzhang) for fixing wheel scrolling in **My notes** and **Notes in this task** ([#294](https://github.com/PapilotAI/papilot/pull/294)).

[Detailed changelog](https://github.com/PapilotAI/papilot/blob/v0.13.0/CHANGELOG.md) · [All changes since 0.12.1](https://github.com/PapilotAI/papilot/compare/v0.12.1...v0.13.0)
