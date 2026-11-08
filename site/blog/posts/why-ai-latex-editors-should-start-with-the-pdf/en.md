When you revise a research paper, you are almost always looking at the rendered PDF. You read a proof on the page, notice that a notation choice obscures an assumption, or see that a figure caption fails to explain a curve. Yet as soon as you want to make a change—whether by hand or with an AI assistant—conventional tools ask you to leave the page behind and work inside `.tex` source files.

For decades, splitting your attention between the typeset view and raw LaTeX source was treated as the unavoidable price of scientific publishing. Even as coding agents have learned to edit multi-file projects, the dominant tools have kept that outdated interaction model intact: they still reserve the primary workspace for source code and relegate the typeset manuscript to a companion preview.

We built [Papilot](https://github.com/PapilotAI/papilot) around a sharper design conviction: in AI-assisted scientific writing, source-centered interaction is already outdated. The rendered manuscript is where authors think and where readers judge the work, so it deserves the primary workspace. Papilot gives the workspace to the PDF and reserves no permanent source-editor pane at all. Plain LaTeX remains the source of truth on disk—and if an author ever wants to inspect or edit `.tex` files directly, they can open the ordinary local project files in whatever external editor they prefer.

## Why Overleaf and Prism's interaction model is already outdated

Both classic cloud editors and newer AI-first LaTeX tools have missed the core interaction shift because they keep the source editor at the center of the room.

In Overleaf's [redesigned editor](https://docs.overleaf.com/getting-started/how-do-i-use-overleaf/redesigned-overleaf-editor), the editing pane sits on the left with the PDF viewer on the right; users switch between Code and Visual modes, recompile to refresh the output, resize or hide panes, and jump between source and PDF with SyncTeX. Even when you hide panes or use Visual Editor, the editing surface remains separate from the final typeset page, and source editing retains a central role in the workflow.

Putting a stronger assistant inside that layout does not solve the interaction problem. In OpenAI's [Prism troubleshooting guide](https://help.openai.com/en/articles/20001050-troubleshooting-prism), an in-editor assistant proposes LaTeX snippets with Keep or Undo controls, flags inline source errors, applies edits for recompilation, and relies on a separate PDF preview pane. (OpenAI has announced in its [Prism-to-Codex migration guide](https://help.openai.com/en/articles/20001615-prism-to-codex-migration-guide) that Prism is being retired; our critique here is specifically about the source-centered interaction model it used.)

Whether the assistant is bolted onto a traditional cloud IDE or built into a source pane, the fundamental bottleneck is the same: the author is still asked to mediate between intent on the typeset page and implementation in `.tex` markup. You still negotiate changes in an editor pane, trigger or wait on a recompile, and look across to a separate preview to see whether the page actually reads the way you meant.

## Why source diffs ask the author to do the compiler's job

Consider a routine revision in a multi-file paper. You are checking a lemma on page 7 and realize the index sets in an estimator need to distinguish between observed and held-out samples. Making that change cleanly means updating a display equation, adjusting inline notation in the surrounding paragraph, and checking that a cross-referenced table caption still agrees.

In a source-first workflow, you hunt across files for the right `\begin{equation}` or custom macro definition, prompt an assistant from the editor, and receive a red-and-green source diff. To decide whether the suggestion is right, you have to mentally execute LaTeX—tracking `\mathcal`, `\hat`, subscript nesting, spacing tweaks, and macro expansions in your head. Even after recompiling, you still have to scan page 7 in a preview pane and compare the new layout against your memory of what was there a moment ago.

Source diffs are fine for debugging commands, but they do not show how an equation sits on the line or how a caption reads beside a figure. Asking a researcher to approve revisions through raw `.tex` hunks forces them to do the compiler's job before they can do the scholar's job.

## Give the workspace to the manuscript, not the source pane

What changes when the typeset PDF becomes the control surface? Instead of treating the compiled output as a passive preview at the end of a pipeline, Papilot puts the rendered manuscript at the start and end of every revision cycle—and clears the rest of the screen out of the way.

![Diagram of a four-stage revision loop: the author annotates the rendered PDF, the connected AI agent edits the underlying .tex files, Papilot compiles the project, and the author reviews typeset before-and-after changes on the PDF before repeating the cycle.](/assets/blog/pdf-first-workflow.en.svg "In Papilot, the author stays on the rendered page to request and review changes, while the AI agent and compiler handle the underlying .tex source.")

The workflow follows a direct loop on the page:

- **Annotate the page:** You highlight a sentence or draw a box around an equation, table, or figure directly on the PDF and write a short note describing the revision.
- **Let the agent edit the source:** Your connected AI agent locates the relevant `.tex` files in your local project and edits the underlying LaTeX markup.
- **Compile automatically:** Papilot compiles the modified project in the background to produce the updated typesetting.
- **Conduct PDF review:** Instead of reading raw markup diffs, you inspect a rendered before-and-after comparison right on the page and decide whether to accept, reject, or comment for another pass.

Crucially, refusing to reserve workspace for a built-in code editor does not mean abandoning LaTeX or trying to reverse-engineer an arbitrary, source-less PDF. Papilot operates on a real local LaTeX project folder on your machine. Plain `.tex`, `.bib`, and style files remain the actual artifacts on disk. Most of the time, you never need to look at raw markup; when you genuinely want to inspect or hand-edit the source, you simply open those local files in your own external editor.

![Papilot interface showing a rendered manuscript page with a boxed equation and a highlighted sentence, each attached to an author note queued for the next AI task.](/assets/blog/notes.en.png "Pointing directly at a typeset equation and surrounding prose lets you batch related revision notes on the PDF without hunting through .tex files.")

## Better visibility does not replace scholarly judgment

Seeing a change clearly on the page is not the same thing as knowing it is mathematically or scientifically valid. An AI agent can propagate a notation change across three sections or tighten a sprawling proof sketch, and still subtly weaken a hypothesis, drop a boundary condition, or misstate what a figure shows.

Making PDF review effortless is meant to sharpen author scrutiny, not relax it. When you are not spending cognitive energy parsing brace matching, table alignment tokens, or split-pane SyncTeX jumps, you can put your full attention where it belongs: checking whether the theorem still holds, whether the notation is unambiguous, and whether the prose says precisely what you can defend. Every AI suggestion still requires careful scholarly verification, and the author remains solely responsible for the claims, equations, and figures in the manuscript.

## Local files, Git history, and your own agent

Academic writing spans months, involves coauthors with different habits, and depends on personal or institutional toolchains. Because Papilot works directly on plain local files, your project stays compatible with standard Git workflows, external text editors, and coauthor setups. Reviewing a rendered change in the interface and managing version history remain distinct steps: accepting a suggestion records a review decision, while applying reviewed changes to your manuscript, committing them, and pushing to Git remain separate, explicit actions under your control.

The same principle applies to AI models and infrastructure. To run the desktop app on macOS, Linux, or Windows, you bring a local TeX distribution (such as TeX Live or MacTeX), Git, and the AI agent you already use—whether that is Claude, Codex, Cursor, Copilot, DeepSeek, Kimi, Qwen, or another supported CLI login or API key. Papilot is MIT-licensed open source software, and model usage stays directly between you and your chosen provider.

## Try the workflow

If you want to see how directing revisions on the manuscript and reviewing typeset before-and-after changes feels in practice, explore our [prepared interactive demo](/demo/) right in your browser. It walks through curated examples without requiring a live AI connection or a LaTeX backend. When you are ready to try PDF-first editing on your own local projects, visit the [Papilot GitHub repository](https://github.com/PapilotAI/papilot) to download the desktop app or inspect the source.
