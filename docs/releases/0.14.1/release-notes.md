# Papilot 0.14.1

Choose among a note's alternatives without holding up the review, let the conflict-resolution agent prepare merge suggestions, and select text anywhere on a review's whole PDF.

## Note alternatives

- **Accept an alternative without waiting.** Accepting one of a note's prepared alternatives used to wait for its PDF and then compile the whole task into a new round. Every other note stayed locked meanwhile, and the new round discarded the PDFs prepared for the other notes' alternatives. Now it takes effect at once in the current review, like accepting any change, even before the alternative's PDF is ready. Undo reverses it, and you can choose another alternative. ([#329](https://github.com/PapilotAI/papilot/pull/329))
- **Only the chosen passage's PDF is prepared.** The accepted change's card shows the alternative's own PDF once it is compiled. The other notes stay open and keep their prepared PDFs, which show the rest of the round as proposed. ([#329](https://github.com/PapilotAI/papilot/pull/329))

## Merge suggestions

- **The conflict-resolution agent prepares them.** When saving a task finds that the manuscript changed in overlapping passages, the agent chosen under **Settings → Git → Conflict-resolution agent** now prepares the merge suggestion instead of the task's own agent. It takes over the task's conversation for the merge and can ask about passages it cannot settle. Once the merge is saved, the task returns to its own agent and settings. With **Follow current conversation**, the task's agent prepares it as before. ([#331](https://github.com/PapilotAI/papilot/pull/331))
- **No silent substitutes.** The merge waits until the chosen agent is connected. If that agent cannot take the task, for example because its model is no longer available, the merge ends with an error instead of running on another agent. ([#331](https://github.com/PapilotAI/papilot/pull/331))

## Review PDF

- **Select text anywhere on the whole paper.** Only the changes' before and after rows could be selected, because the rest of each page was drawn as an image. The pages now carry a text layer, as the manuscript's PDF does, and a drag through the margin stops at the line's end. ([#332](https://github.com/PapilotAI/papilot/pull/332))
- **Compile progress beside the page count.** While the complete PDF compiles and an earlier version shows, a small progress indicator beside the page count says so, instead of a notice floating over the pages. On a desktop, hovering over it shows how long the build has taken. ([#332](https://github.com/PapilotAI/papilot/pull/332))
- **A steady toolbar during rebuilds.** The PDF controls stay in place, disabled, while the round's comparison renders again, so on a narrow window the toolbar no longer jumps between one and two rows and moves the pages. ([#332](https://github.com/PapilotAI/papilot/pull/332))

## Reliability fixes

- **Comparing PDFs with gradient fills.** Comparing the drawings of a PDF with a shading, such as a TikZ or Beamer gradient, could fail with "Rendering the PDF comparison failed." or leave out a changed drawing. The shading was released while the PDF reader still used it. ([#328](https://github.com/PapilotAI/papilot/pull/328))
- **New paper keeps its folder.** Typing a paper name right after opening **New paper** could clear the default folder where the paper is saved. The import dialog's fields now update the same safe way. ([#330](https://github.com/PapilotAI/papilot/pull/330))

## Update or install

- **Desktop:** update from 0.14.0 in **Settings → Updates**. The desktop shell is unchanged, so only Papilot's code downloads; no new installer is needed. New installs can download the matching release asset (macOS Apple Silicon/Intel DMG or ZIP, Windows x64 installer or portable executable, or Linux x64 AppImage/deb).
- **Command line and web server:** run `npm install -g papilot@0.14.1` with Node.js 22.22 or newer, then restart Papilot.
- **Managed, APT, and AUR installations:** update through your package manager or deployment system.

Compiling manuscripts requires Git and a TeX distribution on the host. Experiments remain off unless enabled.

See the [detailed changelog](https://github.com/PapilotAI/papilot/blob/v0.14.1/CHANGELOG.md) and [all changes since 0.14.0](https://github.com/PapilotAI/papilot/compare/v0.14.0...v0.14.1).
