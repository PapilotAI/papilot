# Papilot 0.15.0

Manage cited PDFs and check claims in the new **Library**, compare whole review pages **side by side**, use Papilot directly inside **VS Code**, orchestrate any connected agents in **Collaboration Mode v2**, install via **Homebrew, Scoop, WinGet, and signed APT**, and explore the new searchable **documentation site**.

## Library, citation checks, Zotero, and native MCP tools

- **Paper Library & PDF collection.** The new **Library** in the sidebar (below **Version Management**, replacing **Reference check**) keeps one shared PDF per cited work across all your papers — pulled from your local Zotero library, a connected Zotero web account (**Settings → Zotero**), arXiv / OpenAlex open-access copies (verified by DOI or full title on the first pages), drag-and-drop uploads, or **Ask an agent to find N PDFs** (`library_add`). PDFs stay in Papilot's data directory and never enter your paper's Git repository. ([#337](https://github.com/PapilotAI/papilot/pull/337))
- **Citation verification & uncited-claim suggestions.** Start a **Check** from the Library with your configured **Quick model** (**Settings → General → Quick model**) to verify whether each citing sentence is *supported*, *partly supported*, *not supported*, or *cannot tell* with exact quotes from the cited PDF. Turn on **Show in the paper** to display color-coded margin bars beside paragraphs and jump straight to the cited passage (and back). The same check surfaces **Could cite** suggestions for uncited claims with one-click **Ask an agent to cite it**. ([#337](https://github.com/PapilotAI/papilot/pull/337))
- **Full-text PDF search & native agent tools.** Search across all cited PDFs in the Library with highlighted page thumbnails. Agents now receive `library_list`, `library_search`, `library_read`, `library_add`, `citations_list`, `citation_record`, and `memory_*` tools natively — including through an automatic `papilot` MCP server for Claude and ACP agents (DeepSeek, Kimi, Qwen, OpenCode, and others). See [Agent tools](https://github.com/PapilotAI/papilot/blob/v0.15.0/docs/agent-tools.md). ([#337](https://github.com/PapilotAI/papilot/pull/337))

## Side-by-side whole-page review

- **Compare old and new pages side by side.** Click the two-page toggle in the review toolbar (on desktop windows ≥ 720 px) to view whole pages of the old version on the left and the new version on the right, aligned by content with red/green highlights and a numbered change bar between the pages. Select a bar or change to shade its lines on both pages and open Accept/Reject/Comment, copy-reference, and LaTeX controls; page, contents, zoom, and find stay synchronized across layouts. ([#358](https://github.com/PapilotAI/papilot/pull/358); proposed by [@CatIIIIIIII](https://github.com/CatIIIIIIII) in [#40](https://github.com/PapilotAI/papilot/pull/40))

## Papilot Workspace for VS Code

- **Write and review inside VS Code.** Install **Papilot Workspace** (`PapilotAI.papilot-vscode`, VS Code 1.96.4+) from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=PapilotAI.papilot-vscode) to combine native LaTeX editors, a conversation sidebar, PDF and review tabs (with dark-theme readability and localized prompts), forward/reverse search, compilation diagnostics, Git staging, and multi-document discovery with a bundled Node.js runtime. See [vscode/README.md](https://github.com/PapilotAI/papilot/blob/v0.15.0/vscode/README.md). ([#67](https://github.com/PapilotAI/papilot/issues/67), [#193](https://github.com/PapilotAI/papilot/pull/193), [#362](https://github.com/PapilotAI/papilot/pull/362), [#363](https://github.com/PapilotAI/papilot/pull/363), [#365](https://github.com/PapilotAI/papilot/pull/365))

## Agents, Collaboration Mode v2, and ChatGPT Pro (web)

- **Collaboration Mode v2 (experimental).** Replaces the Codex-only prototype with a universal multi-agent orchestrator supporting any connected agent and model. A fast router assigns annotations to configurable **Task lanes** (built-in *Simple edits*, *Prose & polish*, *Math & rigorous*, *Layout & LaTeX*, plus custom lanes); multi-model lanes race in parallel with LaTeX/citation checks and a blind Judge selecting the default proposal while showing competing proposals inline on the PDF, tracked by a live **Routing & dispatch** card in Chat. See [Collaboration mode](https://github.com/PapilotAI/papilot/blob/v0.15.0/docs/annotation-routing.md). ([#355](https://github.com/PapilotAI/papilot/pull/355))
- **ChatGPT Pro (web) relay (experimental).** Opt in under **Settings → Experiments** to route PDF annotations into ChatGPT Pro on the web (optionally syncing a non-destructive task snapshot branch to your GitHub remote for full-repository context), paste any reply back into Chat, and let a local agent apply the edits for standard typeset PDF review. ([#359](https://github.com/PapilotAI/papilot/pull/359))
- **ZCode, Papilot Writer Custom API, and Codex Ultrafast.** Added **ZCode** CLI support ([#348](https://github.com/PapilotAI/papilot/pull/348)), third-party OpenAI-compatible endpoints under **Papilot Writer → Custom API** ([#342](https://github.com/PapilotAI/papilot/pull/342), both requested in [#338](https://github.com/PapilotAI/papilot/issues/338)), and **Ultrafast** speed selection in the Codex model picker ([#351](https://github.com/PapilotAI/papilot/pull/351)).

## Desktop appearance, packaging, documentation, and self-hosting

- **Interface size, editor font size, and Linux window buttons.** Set desktop **Interface size** from 100% to 200% in **Settings → Appearance** (`Ctrl`/`⌘` `+/−/0` now always zoom the interface while PDF zoom stays on the toolbar, pinch, or `Ctrl`/`⌘` + scroll) ([#314](https://github.com/PapilotAI/papilot/issues/314), [#335](https://github.com/PapilotAI/papilot/pull/335), [#347](https://github.com/PapilotAI/papilot/pull/347)), adjust **Editor font size** independently from 10–24 px ([#345](https://github.com/PapilotAI/papilot/issues/345), [#347](https://github.com/PapilotAI/papilot/pull/347)), and automatically follow your Linux desktop's native window button layout on GNOME, Cinnamon, MATE, KDE Plasma, and Xfce ([#344](https://github.com/PapilotAI/papilot/issues/344), [#349](https://github.com/PapilotAI/papilot/pull/349)).
- **Official package managers.** Install and upgrade Papilot via **Homebrew** (`PapilotAI/tap`), **Scoop** (`PapilotAI/scoop-bucket`), **WinGet** (`PapilotAI.Papilot`), and our self-hosted signed Debian/Ubuntu **APT** repository (`https://papilot.ai/apt`), alongside Arch AUR and Nix. ([#339](https://github.com/PapilotAI/papilot/issues/339), [#360](https://github.com/PapilotAI/papilot/pull/360), [#361](https://github.com/PapilotAI/papilot/pull/361))
- **Bilingual user documentation site.** Reorganized user docs into a searchable site at [papilot.ai/guide/](https://papilot.ai/guide/) and [papilot.ai/zh-CN/guide/](https://papilot.ai/zh-CN/guide/) with 5 sections, 13 focused guides, instant `⌘K` search, and streamlined GitHub Markdown hubs (`docs/guide.md`, `docs/guide.zh-CN.md`, `docs/development.md`). ([#258](https://github.com/PapilotAI/papilot/issues/258), [#368](https://github.com/PapilotAI/papilot/pull/368))
- **Self-hosted & institutional deployments.** Added `GET /api/health?busy=1` (`computing` / `waitingForUser`), shared frontend/review route helpers, path-independent preview cache keys with variable-length SyncTeX relocation, and an environment-configured unified model gateway provider for Papilot Writer. ([#366](https://github.com/PapilotAI/papilot/pull/366))

## Windows & reliability fixes

- **Windows LaTeX compilation and CRLF delivery.** Fixed TeX Live / MiKTeX builds broken when Git for Windows' Perl is on `PATH` or when compiling in non-ASCII directories ([#340](https://github.com/PapilotAI/papilot/pull/340), [#346](https://github.com/PapilotAI/papilot/issues/346), [#350](https://github.com/PapilotAI/papilot/pull/350)), fixed false CRLF delivery and commit conflicts under `core.autocrlf=true` ([#352](https://github.com/PapilotAI/papilot/issues/352), [#367](https://github.com/PapilotAI/papilot/pull/367)), surfaced actionable errors for non-UTF-8 / null-byte `.tex` files ([#352](https://github.com/PapilotAI/papilot/issues/352), [#354](https://github.com/PapilotAI/papilot/pull/354)), and extended the Windows toolbar divider to the window edge ([#356](https://github.com/PapilotAI/papilot/pull/356)).
- **First-launch Codex & UI polish.** CLI `papilot` now uses a newly downloaded Codex immediately even when an older copy is on `PATH` ([#341](https://github.com/PapilotAI/papilot/pull/341)), and the PDF zoom menu keeps a steady width across percentages.

## Update or install

- **Desktop:** upgrading from 0.14.1 requires a new 0.15.0 desktop installer/package because the desktop shell changed (`desktop/`, `bin/`, and bundled dependencies). Download the matching release asset (macOS Apple Silicon/Intel DMG or ZIP, Windows x64 installer or portable executable, or Linux x64 AppImage/deb) or open the release link from **Settings → Updates**. Quit Papilot before replacing the application; your papers, tasks, and settings stay intact.
- **Package managers:**
  - macOS (Homebrew): `brew tap PapilotAI/tap && brew trust PapilotAI/tap && brew install --cask PapilotAI/tap/papilot`
  - Windows (Scoop / WinGet): `scoop bucket add papilot https://github.com/PapilotAI/scoop-bucket && scoop install papilot/papilot` or `winget install PapilotAI.Papilot`
  - Debian/Ubuntu (signed APT) & Arch Linux (AUR): upgrade via `apt` or your AUR helper (`papilot-bin`)
- **Command line and web server:** run `npm install -g papilot@0.15.0` with Node.js 22.22 or newer, then restart Papilot.
- **VS Code:** install **Papilot Workspace** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=PapilotAI.papilot-vscode).

Compiling manuscripts requires Git and a TeX distribution on the host. Experiments remain off unless enabled.

## Thanks

A huge thank-you to every community contributor, proposer, and issue reporter who helped shape Papilot 0.15.0:

- [@RIvance](https://github.com/RIvance) — built the **Papilot Workspace** VS Code extension ([#67](https://github.com/PapilotAI/papilot/issues/67), [#193](https://github.com/PapilotAI/papilot/pull/193))
- [@jiangsy](https://github.com/jiangsy) — built side-by-side whole-page PDF review ([#358](https://github.com/PapilotAI/papilot/pull/358)), desktop interface size scaling ([#335](https://github.com/PapilotAI/papilot/pull/335)), unified interface zoom and LaTeX editor font size ([#347](https://github.com/PapilotAI/papilot/pull/347)), and Linux native window button layout ([#349](https://github.com/PapilotAI/papilot/pull/349))
- [@KESAI-LAB](https://github.com/KESAI-LAB) — diagnosed and fixed Windows TeX Live / MiKTeX preamble compilation under Git for Windows Perl ([#340](https://github.com/PapilotAI/papilot/pull/340))
- [@CatIIIIIIII](https://github.com/CatIIIIIIII) — proposed side-by-side PDF review comparison ([#40](https://github.com/PapilotAI/papilot/pull/40))
- [@lbq789](https://github.com/lbq789) — requested app-wide interface and text size controls ([#314](https://github.com/PapilotAI/papilot/issues/314))
- [@czhhbp](https://github.com/czhhbp) — requested ZCode agent support and third-party OpenAI-compatible APIs in Papilot Writer ([#338](https://github.com/PapilotAI/papilot/issues/338))
- [@he-linyun](https://github.com/he-linyun) — requested Homebrew cask distribution for macOS ([#339](https://github.com/PapilotAI/papilot/issues/339))
- [@penguinway](https://github.com/penguinway) — requested Linux and Windows desktop window button layout customization ([#344](https://github.com/PapilotAI/papilot/issues/344))
- [@Guihua-Yu](https://github.com/Guihua-Yu) — requested adjustable font size in the LaTeX source editor ([#345](https://github.com/PapilotAI/papilot/issues/345))
- [@chaoshengt](https://github.com/chaoshengt) — reported the Windows `pdflatex` / `latexmk` compilation failure with diagnostic details ([#346](https://github.com/PapilotAI/papilot/issues/346))
- [@NanFeng683](https://github.com/NanFeng683) — reported and helped diagnose Windows CRLF delivery conflicts and LaTeX source encoding errors ([#352](https://github.com/PapilotAI/papilot/issues/352))

See the [detailed changelog](https://github.com/PapilotAI/papilot/blob/v0.15.0/CHANGELOG.md) and [all changes since 0.14.1](https://github.com/PapilotAI/papilot/compare/v0.14.1...v0.15.0).
