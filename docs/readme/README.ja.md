<div align="center">

<img src="../assets/wordmark.svg#gh-light-mode-only" width="220" height="69" alt="Papilot"><img src="../assets/wordmark-dark.svg#gh-dark-mode-only" width="220" height="69" alt="Papilot"><br>**次世代 AI LaTeX エディタ**

<h3><code>.tex</code>&nbsp;は読み書きせず&emsp;<img src="../assets/pdf.svg" width="17" height="24" align="absmiddle" alt="PDF">&nbsp;の上でそのまま作業</h3>

<a href="https://papilot.ai"><b>papilot.ai</b></a>&emsp;<a href="https://papilot.ai/demo">オンラインデモ</a>&emsp;<a href="#get-started">はじめる</a>&emsp;<a href="#agents">エージェント</a>&emsp;<a href="#how-it-works">仕組み</a>

<!-- BEGIN BADGES -->
[![License: MIT](https://img.shields.io/github/license/PapilotAI/papilot?style=flat&color=22c55e)](../../LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/PapilotAI/papilot/ci.yml?branch=main&style=flat&label=CI)](https://github.com/PapilotAI/papilot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/PapilotAI/papilot?style=flat&label=release&color=0969da)](https://github.com/PapilotAI/papilot/releases/latest)
[![GitHub total downloads](https://img.shields.io/github/downloads/PapilotAI/papilot/total?style=flat&logo=github&label=downloads&color=0969da)](https://github.com/PapilotAI/papilot/releases)
[![npm monthly downloads](https://img.shields.io/npm/dm/papilot?style=flat&logo=npm&label=downloads&color=cb3837)](https://www.npmjs.com/package/papilot)
[![GitHub stars](https://img.shields.io/github/stars/PapilotAI/papilot?style=flat&logo=github&label=stars&color=0969da)](https://github.com/PapilotAI/papilot/stargazers)
[![Discord](https://img.shields.io/badge/Discord-Join%20us-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/WdgZDDAvwj)
<!-- END BADGES -->

<p data-language-switcher><sub><a href="../../README.md">English</a>&emsp;<a href="README.zh-CN.md">简体中文</a>&emsp;<a href="README.zh-Hant.md">繁體中文</a>&emsp;<a href="README.ja.md">日本語</a>&emsp;<a href="README.ko.md">한국어</a>&emsp;<a href="README.de.md">Deutsch</a>&emsp;<a href="README.fr.md">Français</a>&emsp;<a href="README.es.md">Español</a>&emsp;<a href="README.pt.md">Português</a>&emsp;<a href="README.it.md">Italiano</a>&emsp;<a href="README.sv.md">Svenska</a></sub></p>

</div>

<p align="center">
<a href="https://papilot.ai">
<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-showcase/hero-compact-dark.png">
  <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/hero-dark.png">
  <source media="(max-width: 600px)" srcset="../assets/readme-showcase/hero-compact.png">
  <img src="../assets/readme-showcase/hero.png" alt="Papilot は AI による編集を、承認・却下・コメント付きの組版済み前後比較として PDF 上に表示します。" width="900">
</picture>
</a>
</p>

<a id="features"></a>

<a id="why-papilot"></a>

## Papilot が選ばれる理由

<table>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-annotate-dark.png"><img src="../assets/readme-showcase/why-annotate.png" alt="PDF 上で枠囲みされた文と図。それぞれにエージェントへの注釈が付いています。" width="100%"></picture><br>
<b>ページ上を直接指定</b><br>
文を選択するか、数式や図を枠で囲んで、変更したい内容を記入します。どのファイルにあっても、エージェントには対応する正確なソース行が渡されます。
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-review-dark.png"><img src="../assets/readme-showcase/why-review.png" alt="承認・却下・コメント付きで組版表示された変更前後の比較。" width="100%"></picture><br>
<b>すべての変更を組版結果でレビュー</b><br>
各編集は PDF 上の前後比較として返ってきます。承認・却下・コメントが可能で、承認するまで論文には一切反映されません。
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-overleaf-dark.png"><img src="../assets/readme-showcase/why-overleaf.png" alt="左右に並んだ Papilot と Overleaf。双方向でリアルタイム同期され、Overleaf には共著者のカーソルが表示されています。" width="100%"></picture><br>
<b><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/overleaf-dark.svg"><img src="../assets/readme-icons/overleaf.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;Overleaf とのリアルタイム同期</b><br>
共著者はそのまま Overleaf で執筆を続けられます。承認した変更は約 1 秒で共著者に届き、共著者の変更も名前付きであなたのファイルと PDF に反映されます。
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-agents-dark.png"><img src="../assets/readme-showcase/why-agents.png" alt="チャット下部のモデルメニュー。Codex、Claude、GLM のモデルが表示されています。" width="100%"></picture><br>
<b>あらゆるエージェント、あらゆるモデル</b><br>
チャットの下から接続済みの任意のエージェントのモデルを選択できます。別のエージェントに切り替えれば、Papilot がそのエージェントでリクエストを再実行します。
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-record-dark.png"><img src="../assets/readme-showcase/why-record.png" alt="バージョン履歴内でメッセージ付きでコミット・プッシュされた承認済みの変更。" width="100%"></picture><br>
<b>すべての変更を履歴に記録</b><br>
各タスクは元のファイルから隔離された専用の Git 作業ツリーで実行されます。承認した変更のコミットは別ステップになっており、すべての変更が Git 履歴に残ります。
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-phone-dark.png"><img src="../assets/readme-showcase/why-phone.png" alt="デスクトップウィンドウの手前にあるスマートフォン上の同じレビュー画面。" width="100%"></picture><br>
<b>スマートフォンからレビュー</b><br>
<a href="../guide.md#remote-access-with-tailscale">Tailscale</a> 経由でスマートフォンやタブレットから Papilot を開き、外出先でも PDF の閲覧、注釈の追加、変更の承認が行えます。
</td>
</tr>
<tr>
<td colspan="2" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-universe-dark.png"><img src="../assets/readme-showcase/why-universe.png" alt="Papilot Universe: 学位論文、ジャーナル、国際会議、履歴書（CV）、ポスター用の LaTeX テンプレート。" width="100%"></picture><br>
<b>テンプレートから開始</b><br>
<a href="https://papilot.ai/universe/">Papilot Universe</a> には学位論文、ジャーナル・会議キット、スライド、ポスター、履歴書（CV）、書籍のテンプレートが揃っており、400 以上の会議について論文募集（CFP）で指定されたテンプレートに対応しています。テンプレートを選ぶだけで、すぐにコンパイル可能な論文を Papilot が作成します。
</td>
</tr>
</table>

<a id="quick-start"></a>
<a id="get-started"></a>
<a id="downloads"></a>

<a id="get-started"></a>

## はじめる

<p align="center">
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/mac-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/mac-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/mac-compact.png"><img src="../assets/readme-downloads/mac.png" alt="macOS 版をダウンロード：Apple Silicon・Intel 対応、DMG・ZIP または Homebrew。" width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/windows-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/windows-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/windows-compact.png"><img src="../assets/readme-downloads/windows.png" alt="Windows 版をダウンロード：x64 インストーラー、ポータブル版または Scoop。" width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/linux-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/linux-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/linux-compact.png"><img src="../assets/readme-downloads/linux.png" alt="Linux 版をダウンロード：AppImage、APT (.deb)、AUR または Nix。" width="49%"></picture></a>
<a href="../guide.md#install-and-run"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/terminal-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact.png"><img src="../assets/readme-downloads/terminal.png" alt="ターミナルでインストール: npm install -g papilot を実行後、papilot demo を実行。Node.js 22.22+ が必要です。" width="49%"></picture></a>
</p>

<details>
<summary><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/pm-bar-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/pm-bar-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/pm-bar-compact.png"><img src="../assets/readme-downloads/pm-bar.png" alt="パッケージマネージャー：Homebrew、Scoop、APT、AUR、Nix — インストールコマンドを表示" width="96%" align="absmiddle"></picture></summary>

<table>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/homebrew-dark.svg"><img src="../assets/readme-icons/homebrew.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;<b>macOS</b> · <a href="https://github.com/PapilotAI/homebrew-tap">Homebrew</a>

```sh
brew tap PapilotAI/tap
brew trust PapilotAI/tap
brew install --cask PapilotAI/tap/papilot
```

<sub>未署名 — 初回起動時は「プライバシーとセキュリティ」で許可してください（<a href="https://github.com/PapilotAI/homebrew-tap#gatekeeper-note">詳細</a>）。</sub>
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/scoop-dark.svg"><img src="../assets/readme-icons/scoop.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;<b>Windows</b> · <a href="https://github.com/PapilotAI/scoop-bucket">Scoop</a>

```powershell
scoop bucket add papilot https://github.com/PapilotAI/scoop-bucket
scoop install papilot/papilot
```

<sub><code>scoop update papilot</code> でいつでも更新できます。</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/debian-dark.svg"><img src="../assets/readme-icons/debian.svg" width="15" height="15" align="absmiddle" alt=""></picture>&nbsp;<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/ubuntu-dark.svg"><img src="../assets/readme-icons/ubuntu.svg" width="15" height="15" align="absmiddle" alt=""></picture>&nbsp;<b>Debian / Ubuntu</b> · <a href="../apt.md">APT</a>

```sh
curl -fsSL https://papilot.ai/apt/gpg.key | \
  sudo gpg --dearmor -o /etc/apt/keyrings/papilot.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/papilot.gpg] https://papilot.ai/apt stable main" | \
  sudo tee /etc/apt/sources.list.d/papilot.list
sudo apt update && sudo apt install papilot
```

<sub>署名済みリポジトリ — フィンガープリントは <a href="../apt.md">APT ガイド</a>を参照。</sub>
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/archlinux-dark.svg"><img src="../assets/readme-icons/archlinux.svg" width="15" height="15" align="absmiddle" alt=""></picture>&nbsp;<b>Arch</b> · <a href="../aur.md">AUR</a> &nbsp;&amp;&nbsp; <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/nixos-dark.svg"><img src="../assets/readme-icons/nixos.svg" width="15" height="15" align="absmiddle" alt=""></picture>&nbsp;<b>Nix</b> · <a href="../nix.md">Flake</a>

```sh
# Arch Linux (AUR)
paru -S papilot-bin

# Nix
nix run github:PapilotAI/papilot -- demo
```

<sub>詳細は <a href="../aur.md">Arch ガイド</a>と <a href="../nix.md">Nix ガイド</a>を参照。</sub>
</td>
</tr>
</table>

</details>

<p align="center"><sub>無料・オープンソース。Git、TeX ディストリビューション、およびサインイン済みの<a href="#agents">エージェント</a>が必要です。</sub></p>

<a id="agents"></a>

<a id="works-with-your-agent"></a>

## お使いのエージェントと連携

<p align="center">
  <a href="../guide.md#agents">
    <picture>
      <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-agents/grid-compact-dark.png">
      <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-agents/grid-dark.png">
      <source media="(max-width: 600px)" srcset="../assets/readme-agents/grid-compact.png">
      <img src="../assets/readme-agents/grid.png" alt="Papilot Writer, Codex, Claude, Cursor, GitHub Copilot, Grok, Antigravity, Kimi, GLM, ZCode, DeepSeek, Qwen, OpenCode, Qoder, CodeBuddy, WorkBuddy, Pi" width="848">
    </picture>
  </a>
</p>

<p align="center"><sub>既存のログイン情報や API キーをそのまま利用するか、内蔵の Papilot Writer を使用できます。<a href="../guide.md#agents">セットアップ</a></sub></p>

<a id="how-it-works"></a>

<a id="how-it-works"></a>

## 仕組み

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-showcase/flow-compact-dark.png">
    <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/flow-dark.png">
    <source media="(max-width: 600px)" srcset="../assets/readme-showcase/flow-compact.png">
    <img src="../assets/readme-showcase/flow.png" alt="1. 論文を開く: フォルダ、Overleaf プロジェクト、またはテンプレートから開きます。 2. PDF に注釈を付ける。 3. エージェントが専用の Git 作業ツリー内のコピーを編集します。 4. 組版結果を確認: 文がページ上に描画された T-Abs 推論規則に変わります。 5. 判断する: 承認、却下、またはコメントして再調整を依頼します。 6. コミットと同期: 変更がファイルと Git 履歴に反映され、リンクされていれば Overleaf にも同期されます。" width="1000">
  </picture>
</p>

<a id="documentation-and-community"></a>

<a id="community"></a>

## コミュニティ

<p align="center">
<a href="https://github.com/PapilotAI/papilot/issues/new/choose"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/issue-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/issue-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/issue-compact.png"><img src="../assets/readme-community/issue.png" alt="バグを報告: 簡単な内容でも構いませんので Issue を作成してください。" width="49%"></picture></a>
<a href="https://github.com/PapilotAI/papilot/discussions"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discussion-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discussion-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discussion-compact.png"><img src="../assets/readme-community/discussion.png" alt="Discussions で質問したりアイデアを共有したりできます。" width="49%"></picture></a>
<a href="https://discord.gg/WdgZDDAvwj"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discord-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discord-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discord-compact.png"><img src="../assets/readme-community/discord.png" alt="Discord で Papilot の開発者やユーザーとチャットできます。" width="49%"></picture></a>
<a href="../../.github/CONTRIBUTING.md"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/contribute-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/contribute-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/contribute-compact.png"><img src="../assets/readme-community/contribute.png" alt="コントリビュート: AI エージェントと作成したものをはじめ、プルリクエストを歓迎します。" width="49%"></picture></a>
</p>

Papilot は頻繁にアップデートされています。[変更履歴](../../CHANGELOG.md)をご覧ください。

<a id="contributors"></a>

## コントリビューター

<p>
  <a href="https://github.com/PapilotAI/papilot/graphs/contributors">
    <picture>
      <source media="(max-width: 600px)" srcset="https://papilot.ai/readme-contributors/compact.svg">
      <img src="https://papilot.ai/readme-contributors/desktop.svg" alt="Papilot のコントリビューター">
    </picture>
  </a>
</p>

<a id="star-history"></a>

## スター履歴

Papilot で時間を節約できたら、他の研究者も見つけやすくなるようスターをお願いします。

<a href="https://www.star-history.com/?repos=papilotai%2Fpapilot&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
   <img alt="スター履歴チャート" src="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
 </picture>
</a>

---

<p align="center"><sub><a href="../../LICENSE">MIT</a> © 2026 PapilotAI. <a href="https://linux.do/">LINUX DO</a> の皆様に感謝いたします。</sub></p>
