<div align="center">

<img src="docs/assets/wordmark.svg#gh-light-mode-only" width="220" height="69" alt="Papilot"><img src="docs/assets/wordmark-dark.svg#gh-dark-mode-only" width="220" height="69" alt="Papilot"><br>**Next-Generation AI LaTeX Editor**

<h3>Don't&nbsp;read&nbsp;or&nbsp;write&nbsp;<code>.tex</code>&emsp; Just&nbsp;work&nbsp;on&nbsp;the&nbsp;<img src="docs/assets/pdf.svg" width="17" height="24" align="absmiddle" alt="PDF"></h3>

<a href="https://papilot.ai"><b>papilot.ai</b></a>&emsp;<a href="https://papilot.ai/demo">Online demo</a>&emsp;<a href="#get-started">Get started</a>&emsp;<a href="#agents">Agents</a>&emsp;<a href="#how-it-works">How it works</a>

<!-- BEGIN BADGES -->
[![License: MIT](https://img.shields.io/github/license/PapilotAI/papilot?style=flat&color=22c55e)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/PapilotAI/papilot/ci.yml?branch=main&style=flat&label=CI)](https://github.com/PapilotAI/papilot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/PapilotAI/papilot?style=flat&label=release&color=0969da)](https://github.com/PapilotAI/papilot/releases/latest)
[![GitHub total downloads](https://img.shields.io/github/downloads/PapilotAI/papilot/total?style=flat&logo=github&label=downloads&color=0969da)](https://github.com/PapilotAI/papilot/releases)
[![npm monthly downloads](https://img.shields.io/npm/dm/papilot?style=flat&logo=npm&label=downloads&color=cb3837)](https://www.npmjs.com/package/papilot)
[![GitHub stars](https://img.shields.io/github/stars/PapilotAI/papilot?style=flat&logo=github&label=stars&color=0969da)](https://github.com/PapilotAI/papilot/stargazers)
[![Discord](https://img.shields.io/badge/Discord-Join%20us-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/WdgZDDAvwj)
<!-- END BADGES -->

<p data-language-switcher><sub><a href="README.md">English</a>&emsp;<a href="docs/readme/README.zh-CN.md">简体中文</a>&emsp;<a href="docs/readme/README.zh-Hant.md">繁體中文</a>&emsp;<a href="docs/readme/README.ja.md">日本語</a>&emsp;<a href="docs/readme/README.ko.md">한국어</a>&emsp;<a href="docs/readme/README.de.md">Deutsch</a>&emsp;<a href="docs/readme/README.fr.md">Français</a>&emsp;<a href="docs/readme/README.es.md">Español</a>&emsp;<a href="docs/readme/README.pt.md">Português</a>&emsp;<a href="docs/readme/README.it.md">Italiano</a>&emsp;<a href="docs/readme/README.sv.md">Svenska</a></sub></p>

</div>

<p align="center">
<a href="https://papilot.ai">
<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="docs/assets/readme-showcase/hero-compact-dark.png">
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-showcase/hero-dark.png">
  <source media="(max-width: 600px)" srcset="docs/assets/readme-showcase/hero-compact.png">
  <img src="docs/assets/readme-showcase/hero.png" alt="Papilot shows an AI edit as a typeset before-and-after on the PDF, with Accept, Reject and Comment." width="900">
</picture>
</a>
</p>

<a id="features"></a>

## Why Papilot

<table>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-showcase/why-annotate-dark.png"><img src="docs/assets/readme-showcase/why-annotate.png" alt="A sentence and a figure boxed on the PDF, each with a note for the agent." width="100%"></picture><br>
<b>Point at the page</b><br>
Select a sentence, or box an equation or a figure, and write what should change. Your agent gets the exact source lines, whichever file they are in.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-showcase/why-review-dark.png"><img src="docs/assets/readme-showcase/why-review.png" alt="A change shown typeset, before and after, with Accept, Reject and Comment." width="100%"></picture><br>
<b>Review every change typeset</b><br>
Each edit comes back as a before-and-after on the PDF. Accept, reject or comment on it; nothing reaches your paper until you accept it.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-showcase/why-overleaf-dark.png"><img src="docs/assets/readme-showcase/why-overleaf.png" alt="Papilot and Overleaf side by side, synced live both ways, with coauthors' cursors in Overleaf." width="100%"></picture><br>
<b><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-icons/overleaf-dark.svg"><img src="docs/assets/readme-icons/overleaf.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;Live sync with Overleaf</b><br>
Coauthors keep writing in Overleaf. Your accepted changes reach them in about a second, and theirs land in your files and PDF with their names on them.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-showcase/why-agents-dark.png"><img src="docs/assets/readme-showcase/why-agents.png" alt="The model menu below the chat, with models from Codex, Claude and GLM." width="100%"></picture><br>
<b>Any agent, any model</b><br>
Pick a model from any connected agent below the chat. Switch to another agent and Papilot reruns your request with it.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-showcase/why-record-dark.png"><img src="docs/assets/readme-showcase/why-record.png" alt="Accepted changes committed with a message and pushed, in the version history." width="100%"></picture><br>
<b>Every change on the record</b><br>
Each task runs in its own Git worktree, away from your files. Committing accepted changes is a separate step, and every change stays in your Git history.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-showcase/why-phone-dark.png"><img src="docs/assets/readme-showcase/why-phone.png" alt="The same review on a phone, in front of the desktop window." width="100%"></picture><br>
<b>Review from your phone</b><br>
Open Papilot on your phone or tablet over <a href="docs/guide.md#remote-access-with-tailscale">Tailscale</a>, then read the PDF, mark it up and accept changes away from your desk.
</td>
</tr>
<tr>
<td colspan="2" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-showcase/why-universe-dark.png"><img src="docs/assets/readme-showcase/why-universe.png" alt="Papilot Universe: LaTeX templates for theses, journals, conferences, CVs and posters." width="100%"></picture><br>
<b>Start from a template</b><br>
<a href="https://papilot.ai/universe/">Papilot Universe</a> has theses, journal and conference kits, slides, posters, CVs and books, and points more than 400 conferences to the template their call for papers asks for. Choose one and Papilot creates the paper, ready to compile.
</td>
</tr>
</table>

<a id="quick-start"></a>
<a id="get-started"></a>
<a id="downloads"></a>

## Get started

<p align="center">
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="docs/assets/readme-downloads/mac-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-downloads/mac-dark.png"><source media="(max-width: 600px)" srcset="docs/assets/readme-downloads/mac-compact.png"><img src="docs/assets/readme-downloads/mac.png" alt="Download for macOS: Apple silicon and Intel, DMG or ZIP." width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="docs/assets/readme-downloads/windows-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-downloads/windows-dark.png"><source media="(max-width: 600px)" srcset="docs/assets/readme-downloads/windows-compact.png"><img src="docs/assets/readme-downloads/windows.png" alt="Download for Windows: x64 installer or portable app." width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="docs/assets/readme-downloads/linux-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-downloads/linux-dark.png"><source media="(max-width: 600px)" srcset="docs/assets/readme-downloads/linux-compact.png"><img src="docs/assets/readme-downloads/linux.png" alt="Download for Linux: AppImage, .deb or Nix." width="49%"></picture></a>
<a href="docs/guide.md#install-and-run"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="docs/assets/readme-downloads/terminal-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-downloads/terminal-dark.png"><source media="(max-width: 600px)" srcset="docs/assets/readme-downloads/terminal-compact.png"><img src="docs/assets/readme-downloads/terminal.png" alt="Install in a terminal: npm install -g papilot, then papilot demo. Needs Node.js 22.22+." width="49%"></picture></a>
</p>

<p align="center"><sub>Free and open source. Needs Git, a TeX distribution and a signed-in <a href="#agents">agent</a>.</sub></p>

<a id="agents"></a>

## Works with your agent

<p align="center">
  <a href="docs/guide.md#agents">
    <picture>
      <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="docs/assets/readme-agents/grid-compact-dark.png">
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-agents/grid-dark.png">
      <source media="(max-width: 600px)" srcset="docs/assets/readme-agents/grid-compact.png">
      <img src="docs/assets/readme-agents/grid.png" alt="Papilot Writer, Codex, Claude, Cursor, GitHub Copilot, Grok, Antigravity, Kimi, GLM, ZCode, DeepSeek, Qwen, OpenCode, Qoder, CodeBuddy, WorkBuddy and Pi" width="848">
    </picture>
  </a>
</p>

<p align="center"><sub>Bring the login or API key you already have, or use the built-in Papilot Writer. <a href="docs/guide.md#agents">Setup</a></sub></p>

<a id="how-it-works"></a>

## How it works

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="docs/assets/readme-showcase/flow-compact-dark.png">
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-showcase/flow-dark.png">
    <source media="(max-width: 600px)" srcset="docs/assets/readme-showcase/flow-compact.png">
    <img src="docs/assets/readme-showcase/flow.png" alt="1. Open your paper: a folder, an Overleaf project or a template. 2. Mark the PDF. 3. The agent edits a copy in its own Git worktree. 4. See it typeset: the sentence becomes the T-Abs inference rule, drawn on the page. 5. You decide: accept, reject or comment for another round. 6. Commit and sync: changes land in your files and Git history, and sync to Overleaf if linked." width="1000">
  </picture>
</p>

<a id="documentation-and-community"></a>

## Community

<p align="center">
<a href="https://github.com/PapilotAI/papilot/issues/new/choose"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="docs/assets/readme-community/issue-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-community/issue-dark.png"><source media="(max-width: 600px)" srcset="docs/assets/readme-community/issue-compact.png"><img src="docs/assets/readme-community/issue.png" alt="Report a bug: open an issue, even a rough one." width="49%"></picture></a>
<a href="https://github.com/PapilotAI/papilot/discussions"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="docs/assets/readme-community/discussion-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-community/discussion-dark.png"><source media="(max-width: 600px)" srcset="docs/assets/readme-community/discussion-compact.png"><img src="docs/assets/readme-community/discussion.png" alt="Ask a question or share an idea in Discussions." width="49%"></picture></a>
<a href="https://discord.gg/WdgZDDAvwj"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="docs/assets/readme-community/discord-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-community/discord-dark.png"><source media="(max-width: 600px)" srcset="docs/assets/readme-community/discord-compact.png"><img src="docs/assets/readme-community/discord.png" alt="Chat on Discord with the people who build and use Papilot." width="49%"></picture></a>
<a href=".github/CONTRIBUTING.md"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="docs/assets/readme-community/contribute-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-community/contribute-dark.png"><source media="(max-width: 600px)" srcset="docs/assets/readme-community/contribute-compact.png"><img src="docs/assets/readme-community/contribute.png" alt="Contribute: pull requests are welcome, including ones written with AI agents." width="49%"></picture></a>
</p>

Papilot ships often: see the [changelog](CHANGELOG.md).

## Contributors

<p>
  <a href="https://github.com/PapilotAI/papilot/graphs/contributors">
    <picture>
      <source media="(max-width: 600px)" srcset="https://papilot.ai/readme-contributors/compact.svg">
      <img src="https://papilot.ai/readme-contributors/desktop.svg" alt="Papilot's contributors">
    </picture>
  </a>
</p>

## Star History

If Papilot saves you time, a star helps other researchers find it.

<a href="https://www.star-history.com/?repos=papilotai%2Fpapilot&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
 </picture>
</a>

---

<p align="center"><sub><a href="LICENSE">MIT</a> © 2026 PapilotAI. Thanks to our friends at <a href="https://linux.do/">LINUX DO</a>.</sub></p>
