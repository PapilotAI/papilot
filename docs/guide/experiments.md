## Collaboration mode

Open **Settings → Experiments → Enable collaboration mode** to route PDF annotations across multiple connected agents and models in a single task. It works with any agents connected in **Settings → Agents**.

- **3-stage pipeline (`Router → Task lanes → Judge`)**: a fast read-only router groups nearby annotations into spatial clusters and routes each cluster to a matching lane (**Simple edits**, **Prose & polish**, **Math & rigorous**, **Layout & LaTeX**, or up to 8 custom lanes).
- **Direct execution or parallel racing**: lanes with 1 model run directly; lanes with 2–4 models race in parallel on isolated snapshots, pass deterministic LaTeX/citation fidelity checks, and are blind-compared by a rigorous **Judge** that picks the default winner while exposing competing proposals inline on the PDF.
- **Per-task strategies**: select **Collaboration mode** in the model picker and choose **Balanced · Auto route & race**, **Fast · Route only**, or **Thorough · Race & verify**.

For lane configuration, live dispatch cards and verification details, see [Collaboration mode](../annotation-routing.md).

## ChatGPT Pro (web) relay

Enable **ChatGPT Pro (web)** in **Settings → Experiments** to combine ChatGPT Pro on the web with local LaTeX execution and PDF diff review:

1. Mark annotations on the PDF and start a task with **ChatGPT Pro (web)** like any other agent.
2. Optionally sync the task snapshot to a GitHub remote branch so ChatGPT Pro can read the full repository context.
3. Copy the prepared prompt into ChatGPT Pro, paste its reply back into the same task conversation, and choose which connected local agent, model and reasoning effort applies the edits into the task worktree for typeset PDF review.

## Compile with PhiTeX

Install [PhiTeX](https://phitex.org) (a separate AGPL-3.0 incremental TeX compiler) on your host `PATH` and enable **Settings → Experiments → Compile with PhiTeX** for faster incremental `pdfLaTeX` rebuilds.

- LuaLaTeX papers and chapter-only comparisons remain on `latexmk`.
- Custom `latexmkrc` rules do not run under PhiTeX, and initial XeLaTeX font indexing can take several minutes.
- Turn the switch off at any time to return immediately to `latexmk`.

## Typeless voice notes (macOS)

On the macOS desktop app, enable **Settings → Experiments → Typeless voice notes** to trigger your configured [Typeless](https://www.typeless.com/) dictation shortcut automatically when creating a PDF note.

- Requires macOS **Accessibility** permission for Papilot (**System Settings → Privacy & Security → Accessibility**) plus Typeless's own microphone permission.
- Available only in the macOS desktop app (not in browser clients, Windows or Linux). Papilot posts the shortcut without reading recordings or confirming transcription completion; review the pasted text before quoting it into a task.

See [Typeless voice notes](../typeless.md) for setup steps and current limitations.
