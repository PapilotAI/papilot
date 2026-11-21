# Papilot 0.12.1

Return manuscript annotations for another edit, undo review decisions and annotation changes, and keep important tasks pinned.

## Manuscript and review

- **Return an original annotation.** Reject a linked edit or use the checked note icon in Chat or Review to put an unresolved annotation back in the manuscript. Its card flies to the count next to **Manuscript**, and its comment, passage, mark, and color are available for editing. Ctrl+Z or ⌘Z takes back a manual return. Undoing a rejection restores the proposed edit and removes only the annotation copies that rejection returned to the manuscript. ([#264](https://github.com/PapilotAI/papilot/issues/264), [#290](https://github.com/PapilotAI/papilot/pull/290))
- **Edit and regroup annotations.** Use the pencil to edit a grouped comment. Use the swatch on a note or group to change its color or remove the color. Undo an entire group change in one step. You can also clear a document's annotations with confirmation and undo the clear from **My notes**. ([#261](https://github.com/PapilotAI/papilot/issues/261), [#290](https://github.com/PapilotAI/papilot/pull/290))
- **Pin several tasks.** Use the pushpin in the task list to keep important tasks at the top in a stable order. ([#265](https://github.com/PapilotAI/papilot/issues/265))

The PDF marking toolbar stays in place when you open a note. Notes link more reliably through LaTeX constructs and follow-up edits, small changes in ACM papers stay close to their edited passages, and internal note-option JSON stays out of Chat. ([#256](https://github.com/PapilotAI/papilot/issues/256), [#266](https://github.com/PapilotAI/papilot/issues/266), [#270](https://github.com/PapilotAI/papilot/issues/270), [#271](https://github.com/PapilotAI/papilot/issues/271), [#272](https://github.com/PapilotAI/papilot/issues/272))

## Update or install

- **Desktop 0.12.0.** In **Settings → Updates**, select **Update now**. The app downloads the application update and restarts when tasks are idle. Your papers, tasks, and settings stay in place.
- **New or older desktop installations.** Download the installer for your system from the release assets.
- **Command line and web server.** Use `npm install -g papilot@0.12.1` for an npm installation. Managed installations use their own deployment or package manager.

[Full changelog](https://github.com/PapilotAI/papilot/compare/v0.12.0...v0.12.1)
