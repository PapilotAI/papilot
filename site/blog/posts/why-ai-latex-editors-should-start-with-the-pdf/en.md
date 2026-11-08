When you revise a research paper, you are almost always looking at the rendered PDF. You read a proof on the page, notice that a notation choice obscures an assumption, or see that a figure caption fails to explain a curve. Yet as soon as you want to make a change—whether by hand or with an AI assistant—most tools ask you to leave the page behind and work inside `.tex` source files.

For decades, moving between the typeset view and raw LaTeX source was simply the price of admission for mathematical and scientific publishing. Now that coding agents can edit multi-file projects, it is tempting to treat an AI LaTeX editor as just a code IDE with a PDF preview bolted to the side. You prompt an assistant, and it hands you a red-and-green diff of backslashes, environments, and macro calls.

We built [Papilot](https://github.com/PapilotAI/papilot) around a simpler conviction: if the rendered document is what you and your readers care about, the PDF should be the primary interface where you direct and judge revisions, while plain LaTeX remains the source of truth underneath.

## Why source diffs ask the author to do the compiler's job

Consider a routine revision in a multi-file paper. You are checking a lemma on page 7 and realize the index sets in an estimator need to distinguish between observed and held-out samples. Making that change cleanly means updating a display equation, adjusting inline notation in the surrounding paragraph, and checking that a cross-referenced table caption still agrees.

In a source-first workflow, you first hunt across files for the right `\begin{equation}` or custom macro definition, copy context into a prompt, and wait for a patch. When the AI responds, you are presented with a source diff. To decide whether the suggestion is actually right, you have to mentally execute LaTeX: tracking `\mathcal`, `\hat`, subscript nesting, spacing tweaks, and macro expansions in your head. Even after you compile the project, you still have to visually hunt down what changed on page 7 and compare it from memory against what was there a moment ago.

Source diffs are useful for checking commands and implementation details. They do not show how an equation reads on the page or how a caption sits beside a figure. Asking a researcher to verify an argument through raw `.tex` hunks forces them to do the compiler's job before they can do the scholar's job.

## Turning the rendered page into the workspace

What changes when the typeset PDF becomes the control surface? Instead of treating the compiled output as a passive preview at the end of a pipeline, Papilot puts the rendered page at the start and end of every revision cycle.

![Diagram of a four-stage revision loop: the author annotates the rendered PDF, the connected AI agent edits the underlying .tex files, Papilot compiles the project, and the author reviews typeset before-and-after changes on the PDF before repeating the cycle.](/assets/blog/pdf-first-workflow.en.svg "In Papilot, the author stays on the rendered page to request and review changes, while the AI agent and compiler handle the underlying .tex source.")

The workflow follows a direct loop:

- **Annotate the page:** You highlight a sentence or draw a box around an equation, table, or figure directly on the PDF and write a short note describing the revision.
- **Let the agent edit the source:** Your connected AI agent locates the relevant `.tex` files in your local project and edits the underlying LaTeX markup.
- **Compile automatically:** Papilot compiles the modified project in the background to produce the updated typesetting.
- **Conduct PDF review:** Instead of reading raw markup diffs, you inspect a rendered before-and-after comparison right on the page and decide whether to accept, reject, or comment for another pass.

Crucially, this does not mean abandoning LaTeX or trying to reverse-engineer an arbitrary, source-less PDF. Papilot operates on a real local LaTeX project folder on your machine. Plain `.tex`, `.bib`, and style files remain the actual artifact on disk, so you keep every benefit of standard scientific typesetting without having to navigate raw markup for routine drafting and revision.

![Papilot interface showing a rendered manuscript page with a boxed equation and a highlighted sentence, each attached to an author note queued for the next AI task.](/assets/blog/notes.en.png "Pointing directly at a typeset equation and surrounding prose lets you batch related revision notes on the PDF without hunting through .tex files.")

## Better visibility does not replace scholarly judgment

Seeing a change clearly is not the same thing as knowing it is valid. An AI agent can propagate a notation change across three sections or tighten a sprawling proof sketch, and still subtly weaken a hypothesis, drop a boundary condition, or misstate what a figure shows.

Making PDF review effortless is meant to sharpen author scrutiny, not relax it. When you are not spending cognitive energy parsing brace matching or table alignment tokens, you can put your full attention where it belongs: checking whether the theorem still holds, whether the notation is unambiguous, and whether the prose says precisely what you can defend. Every AI suggestion still requires careful scholarly verification. The author remains solely responsible for the claims, equations, and figures in the manuscript.

## Local files, Git history, and your own agent

Academic writing often spans months, involves coauthors with different habits, and depends on institutional or personal toolchains. A writing environment should fit into that reality rather than locking manuscripts into a proprietary cloud database.

Because Papilot works directly on plain local files, your project stays compatible with standard Git workflows and coauthor setups. Reviewing a rendered change in the interface and managing your version history remain distinct steps: accepting a suggestion records a review decision; applying the reviewed changes to your manuscript, committing them, and pushing to Git remain explicit actions under your control.

The same principle applies to AI models and infrastructure. To run the desktop app on macOS, Linux, or Windows, you bring a local TeX distribution (such as TeX Live or MacTeX), Git, and the AI agent you already use—whether that is Claude, Codex, Cursor, Copilot, DeepSeek, Kimi, Qwen, or another supported CLI login or API key. Papilot itself is MIT-licensed open source software, and model usage stays directly between you and your chosen provider.

## Try the workflow

If you want to see how directing revisions and reviewing typeset before-and-after changes feels in practice, you can explore our [prepared interactive demo](/demo/) right in your browser. It walks through curated examples without requiring a live AI connection or a LaTeX backend. When you are ready to try PDF-first editing on your own manuscripts, visit the [Papilot GitHub repository](https://github.com/PapilotAI/papilot) to download the desktop app or inspect the source.
