## Prerequisites at a glance

Papilot runs on your computer (macOS, Windows or Linux) so your files, Git history, TeX compiler and agent sign-ins stay local:

- **Desktop app** ([papilot.ai/#download](https://papilot.ai/#download)): bundles its own Node.js runtime. You need **Git**, a **TeX distribution** with `latexmk` and `synctex` (MacTeX on macOS; TeX Live or MiKTeX with Perl on Windows; TeX Live on Linux), and **one configured AI agent**.
- **CLI (`npm install -g papilot`) or source checkout**: also needs **Node.js 22.22+**. See [Installation](installation.md) for platform packages, WSL, Nix and CLI options.

On first launch, the desktop app includes a prebuilt **Papilot paper** sample PDF that you can read and explore even before installing TeX; compiling revisions requires Git and TeX.

## Six steps to one reviewed revision

1. **Install and launch Papilot.** Download the desktop installer for macOS, Windows or Linux from [papilot.ai/#download](https://papilot.ai/#download) (or install via Homebrew, Scoop, WinGet, APT, AUR or npm — see [Installation](installation.md)).
   - On Windows, first launch lets you choose between **WSL** (recommended for Linux TeX Live and agent CLIs) and native **Windows**; switch anytime in **Settings → General → Environment**.
   - If Git or LaTeX is missing, a banner at the top of the workspace links directly to **Settings → Git** (**Check again**) and **Settings → LaTeX** (**Detect again**).

2. **Connect an agent.** Open **Settings → Agents** (`⌘,` on macOS, or the gear button at the bottom of the sidebar).
   - **Fastest built-in option**: select **Papilot Writer** and sign in with ChatGPT Plus/Pro, GitHub Copilot or an API key (Anthropic, OpenAI, Google, OpenRouter, DeepSeek, xAI, Moonshot, Z.ai or Mistral).
   - **Existing coding agent**: sign in to a CLI already on your machine (such as `codex login`, `claude auth login`, `copilot login`, `kimi login`, `agy`, `qwen`, `opencode auth login`, `pi` or `grok login`), then click **Reconnect** (or **Refresh**) in **Settings → Agents**. See [Agents & Models](agents.md).

3. **Open a paper or start from a template.** Click **New paper** (or **Import or open**):
   - **Open existing folder** (`File › Open Paper…`, `⌘O` / `Ctrl+O`) edits your folder in place and initializes local Git history if needed.
   - **Import a copy** saves an independent copy from a ZIP, folder, arXiv URL, public GitHub URL or read-only Overleaf link; enable **Keep in sync with Overleaf** for live two-way Overleaf sync.
   - **Templates** creates a ready-to-compile folder from the offline **Example project** or any [Papilot Universe](https://papilot.ai/universe/) template. See [Papers & Templates](papers-and-templates.md).

4. **Mark what should change on the PDF.** In **Manuscript**, use the marking toolbar beside the PDF (or at the bottom on a phone):
   - Choose **Note** (`T`) to drag across a sentence, or **Region** (`M`) to box an equation, table or figure, and write what should change. (With **Select** `V`, highlight text and click **Add note**.)
   - Click the right arrow on a note (or **Add to task** in **My notes**) to quote it into **New task**, pick an agent and model below the composer, and press **Enter** (`⌘Enter` / `Ctrl+Enter`).
   - Papilot runs the agent inside an isolated **Git worktree** copy — your manuscript files on disk remain untouched while the agent edits. See [Annotate & Read](annotate-and-read.md).

5. **Review every change typeset.** When the turn finishes, Papilot compiles a before-and-after PDF comparison:
   - Click **Accept** (`✓`) to keep a change in the task, **Reject** (`✕`) to exclude it (which returns any linked manuscript notes back to **Manuscript** so you never lose them), or **Comment** and **Send feedback** for another round.
   - Accepting a change records your decision inside the task; it **does not** modify your manuscript files yet.

6. **Apply or commit to your paper.** Once pending changes are decided, the save bar appears at the top of the review:
   - Click **Apply** (`Apply to workspace`) to write accepted edits into your paper's working files without creating a Git commit.
   - Or enter/generate (`✨`) a commit message and click **Commit** (`Commit to manuscript`) to write the accepted edits **and** record a clean local Git commit on your current branch.
   - Neither button pushes to a Git remote. Open **Version Management** and choose **Sync** (or **Push**) to push or pull Git commits; if linked to Overleaf, applied or committed changes sync automatically in about a second. See [Review & Save](review-and-save.md).

![The six-step Papilot workflow from opening a paper to committing and syncing](../assets/readme-showcase/flow.png)

## Language and appearance

- **Interface language**: **Settings → General → Language** follows your browser by default and offers {{uiLanguageCount}} languages ({{uiLanguageList}}). Your paper, comments and conversations keep whatever language you write them in. Generated Git commit messages have an independent setting in **Settings → Git → Commit message language**.
- **Appearance**: **Settings → Appearance** switches between **Light**, **Dark** and **System**, with independent PDF page appearance controls so equations, figures and green/red diff highlights stay legible in dark mode.

If any step does not behave as expected, jump straight to [Troubleshooting](troubleshooting.md) by symptom instead of starting over.
