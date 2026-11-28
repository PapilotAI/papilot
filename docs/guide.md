# Papilot documentation

Read on the web with search and sidebar navigation: **[papilot.ai/guide/](https://papilot.ai/guide/)** · 语言：**English** | **[简体中文](guide.zh-CN.md)** ([网页版](https://papilot.ai/zh-CN/guide/)) · Overview: **[README](../README.md)**

`docs/guide/` is the single source of truth for user documentation. Every topic below links directly to its canonical guide page (and preserves legacy `#anchor` links from READMEs, release notes and the app).

## Browse by topic

### Getting started

- **[Quickstart](guide/quickstart.md)** — complete your first reviewed revision in six steps.
- **[Installation](guide/installation.md)** — macOS, Windows & WSL ([windows.md](windows.md)), Linux APT ([apt.md](apt.md)), Arch AUR ([aur.md](aur.md)), AppImage/`.deb`, Nix ([nix.md](nix.md)), CLI and VS Code.
- **[Papers & Templates](guide/papers-and-templates.md)** — open local folders, import from arXiv/GitHub/ZIP/Overleaf, start from Papilot Universe templates and switch root documents.

### Writing & review

- **[Annotate & Read](guide/annotate-and-read.md)** — PDF marking tools (`Q`/`T`/`M`/`P`/`D`/`E`/`V`), `My notes`, reference peek, reading anchors, margin crop and read-only `/ai-review`.
- **[Review & Save](guide/review-and-save.md)** — typeset diffs, bibliography verification, Accept vs Apply vs Commit vs Sync, rejected-note recovery and inline LaTeX editing.

### Agents & customization

- **[Agents & Models](guide/agents.md)** — built-in Papilot Writer, connected coding agents, model/effort switching and task permissions.
- **[Skills, Memory & Attachments](guide/skills-and-memory.md)** — built-in and custom `/` skills, three-scope Writing Memory and file/image attachments.

### Collaborate & sync

- **[Overleaf Sync](guide/overleaf.md)** — snapshot imports vs live two-way Overleaf sync, coauthor cursors and offline conflict resolution.
- **[Git & Version History](guide/git-and-history.md)** — Version Management, AI commit messages, remote sync, restoring versions and merge conflict resolution.
- **[Phone & Tablet Access](guide/remote-access.md)** — private Tailscale Serve setup, SSH tunneling and mobile reading/review.

### Reference & help

- **[Troubleshooting](guide/troubleshooting.md)** — symptom-led recovery, `papilot doctor` and diagnostic logs.
- **[CLI, Statistics & Configuration](guide/reference.md)** — CLI commands, macOS background service, activity statistics, update channels and environment variables.
- **[Experimental Features](guide/experiments.md)** — Collaboration mode, ChatGPT Pro (web), PhiTeX incremental compilation and macOS Typeless voice notes.

## Quick links & topic anchors

<a id="your-first-revision"></a>
<a id="install-and-run"></a>

- **Quickstart, installation & papers**: [Quickstart](guide/quickstart.md) · [Installation](guide/installation.md) · [Papers & Templates](guide/papers-and-templates.md)

<a id="agents"></a>
<a id="task-permissions"></a>
<a id="skills"></a>
<a id="task-attachments"></a>
<a id="writing-memory"></a>

- **Agents, permissions, skills, attachments & writing memory**: [Agents & Models](guide/agents.md) · [Task permissions](guide/agents.md#task-permissions) · [Reusable skills](guide/skills-and-memory.md#reusable-skills) · [Writing memory](guide/skills-and-memory.md#writing-memory) · [Attachments](guide/skills-and-memory.md#file-and-image-attachments) · [Agent tools](agent-tools.md) · [Papilot Writer architecture](paper-agent.md)

<a id="workflow"></a>
<a id="reading-with-anchors"></a>
<a id="crop-pdf-margins"></a>
<a id="edit-a-passage-yourself"></a>
<a id="browse-files-and-switch-documents"></a>
<a id="ask-an-agent-to-annotate"></a>
<a id="ai-review"></a>

- **PDF annotation, review & direct LaTeX edits**: [Annotate & Read](guide/annotate-and-read.md) · [Review & Save](guide/review-and-save.md) · [Accept, Apply, Commit & Sync](guide/review-and-save.md#accept-apply-commit-and-sync) · [Edit LaTeX source yourself](guide/review-and-save.md#edit-latex-source-yourself) · [Browse files & switch documents](guide/papers-and-templates.md#manage-papers-and-multi-document-repositories)

<a id="sync-with-overleaf"></a>
<a id="version-history-and-git"></a>
<a id="commit-message-language"></a>

- **Overleaf & Git**: [Overleaf Sync](guide/overleaf.md) · [Git & Version History](guide/git-and-history.md)

<a id="remote-access-with-tailscale"></a>

- **Phone & tablet remote access**: [Phone & Tablet Access](guide/remote-access.md)

<a id="compile-with-phitex-experimental"></a>

- **Experimental features (Collaboration mode, ChatGPT Pro web, PhiTeX, Typeless)**: [Experimental Features](guide/experiments.md) · [Collaboration mode details](annotation-routing.md) · [Typeless voice notes](typeless.md)

<a id="troubleshooting"></a>
<a id="diagnostics"></a>
<a id="fix-a-latex-build"></a>
<a id="statistics"></a>
<a id="updates"></a>
<a id="configuration"></a>

- **Troubleshooting, diagnostics, statistics, updates & configuration**: [Troubleshooting](guide/troubleshooting.md) · [The paper does not compile](guide/troubleshooting.md#the-paper-does-not-compile) · [Diagnostics & logs](guide/troubleshooting.md#where-to-get-diagnostics-and-logs) · [CLI, Statistics & Configuration](guide/reference.md) · [Environment variables](guide/reference.md#environment-variables-reference)

<a id="development-and-validation"></a>
<a id="review-engine"></a>

- **Development, tests & architecture**: [Development and internals](development.md) · [Compilation performance](performance.md) · [Review engine reference](../engine/docs/reference.md) · [Contributing](../.github/CONTRIBUTING.md)
