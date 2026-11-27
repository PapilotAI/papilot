<div align="center">

<img src="../assets/wordmark.svg#gh-light-mode-only" width="220" height="69" alt="Papilot"><img src="../assets/wordmark-dark.svg#gh-dark-mode-only" width="220" height="69" alt="Papilot"><br>**新一代 AI LaTeX 编辑器**

<h3>无需读写&nbsp;<code>.tex</code>&emsp; 直接在&nbsp;<img src="../assets/pdf.svg" width="17" height="24" align="absmiddle" alt="PDF">&nbsp;上修改</h3>

<a href="https://papilot.ai"><b>papilot.ai</b></a>&emsp;<a href="https://papilot.ai/demo">在线演示</a>&emsp;<a href="#get-started">快速上手</a>&emsp;<a href="#agents">智能体</a>&emsp;<a href="#how-it-works">工作原理</a>

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
  <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-showcase/hero-compact-dark.zh-CN.png">
  <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/hero-dark.zh-CN.png">
  <source media="(max-width: 600px)" srcset="../assets/readme-showcase/hero-compact.zh-CN.png">
  <img src="../assets/readme-showcase/hero.zh-CN.png" alt="Papilot 在 PDF 上以排版后的前后对比形式展示 AI 修改，并提供接受、拒绝和评论按钮。" width="900">
</picture>
</a>
</p>

<a id="features"></a>

<a id="why-papilot"></a>

## 为什么选择 Papilot

<table>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-annotate-dark.zh-CN.png"><img src="../assets/readme-showcase/why-annotate.zh-CN.png" alt="PDF 上框选了一句话和一张图，分别附有发给智能体的批注。" width="100%"></picture><br>
<b>在页面上直接指点</b><br>
划选句子，或框选公式与图表，写下修改要求。无论源码在哪个文件中，智能体都能准确定位到对应的源码行。
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-review-dark.zh-CN.png"><img src="../assets/readme-showcase/why-review.zh-CN.png" alt="以排版效果展示修改前后的对比，带有接受、拒绝和评论选项。" width="100%"></picture><br>
<b>以排版效果审阅每处修改</b><br>
每次修改都会在 PDF 上呈现排版后的前后对比。你可以接受、拒绝或发表评论；在点击接受前，任何改动都不会写入你的论文。
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-overleaf-dark.zh-CN.png"><img src="../assets/readme-showcase/why-overleaf.zh-CN.png" alt="Papilot 与 Overleaf 并排显示，双向实时同步，Overleaf 中可见合作者的光标。" width="100%"></picture><br>
<b><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/overleaf-dark.svg"><img src="../assets/readme-icons/overleaf.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;与 Overleaf 实时同步</b><br>
合作者可以继续在 Overleaf 中写作。你接受的修改约一秒即可同步给他们，而他们的改动也会署着各自的名字实时更新到你的文件和 PDF 中。
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-agents-dark.zh-CN.png"><img src="../assets/readme-showcase/why-agents.zh-CN.png" alt="聊天框下方的模型菜单，包含来自 Codex、Claude 和 GLM 的模型。" width="100%"></picture><br>
<b>任意智能体，任意模型</b><br>
在聊天框下方从已连接的任意智能体中选择模型。切换到其他智能体时，Papilot 会使用新智能体重新运行你的请求。
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-record-dark.zh-CN.png"><img src="../assets/readme-showcase/why-record.zh-CN.png" alt="版本历史中，已接受的修改附带提交说明完成提交并推送。" width="100%"></picture><br>
<b>每处改动皆有记录</b><br>
每个任务都在各自独立的 Git 工作树中运行，不会直接触碰你的文件。提交已接受的修改是独立的一步，每次改动都会保存在你的 Git 历史中。
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-phone-dark.zh-CN.png"><img src="../assets/readme-showcase/why-phone.zh-CN.png" alt="手机上显示着与桌面窗口相同的审阅界面。" width="100%"></picture><br>
<b>在手机上审阅</b><br>
通过 <a href="../guide.md#remote-access-with-tailscale">Tailscale</a> 在手机或平板上打开 Papilot，即使不在桌前，也能阅读 PDF、添加标记并接受修改。
</td>
</tr>
<tr>
<td colspan="2" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-universe-dark.zh-CN.png"><img src="../assets/readme-showcase/why-universe.zh-CN.png" alt="Papilot Universe：适用于学位论文、期刊、会议、简历和海报的 LaTeX 模板。" width="100%"></picture><br>
<b>从模板开始</b><br>
<a href="https://papilot.ai/universe/">Papilot Universe</a> 汇集了学位论文、期刊与会议套件、幻灯片、海报、简历和书籍模板，并为 400 多个学术会议匹配了征稿通知所要求的模板。任选其一，Papilot 即可创建可直接编译的论文。
</td>
</tr>
</table>

<a id="quick-start"></a>
<a id="get-started"></a>
<a id="downloads"></a>

<a id="get-started"></a>

## 快速上手

<p align="center">
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/mac-compact-dark.zh-CN.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/mac-dark.zh-CN.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/mac-compact.zh-CN.png"><img src="../assets/readme-downloads/mac.zh-CN.png" alt="下载 macOS 版：支持 Apple silicon 和 Intel，提供 DMG 或 ZIP 格式。" width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/windows-compact-dark.zh-CN.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/windows-dark.zh-CN.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/windows-compact.zh-CN.png"><img src="../assets/readme-downloads/windows.zh-CN.png" alt="下载 Windows 版：提供 x64 安装程序或便携版应用。" width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/linux-compact-dark.zh-CN.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/linux-dark.zh-CN.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/linux-compact.zh-CN.png"><img src="../assets/readme-downloads/linux.zh-CN.png" alt="下载 Linux 版：提供 AppImage、.deb 或 Nix。" width="49%"></picture></a>
<a href="../guide.md#install-and-run"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact-dark.zh-CN.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/terminal-dark.zh-CN.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact.zh-CN.png"><img src="../assets/readme-downloads/terminal.zh-CN.png" alt="在终端中安装：运行 npm install -g papilot，然后运行 papilot demo。需要 Node.js 22.22+。" width="49%"></picture></a>
</p>

<p align="center"><sub>免费且开源。需要 Git、TeX 发行版以及已登录的<a href="#agents">智能体</a>。</sub></p>

<a id="agents"></a>

<a id="works-with-your-agent"></a>

## 支持你常用的智能体

<p align="center">
  <a href="../guide.md#agents">
    <picture>
      <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-agents/grid-compact-dark.png">
      <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-agents/grid-dark.png">
      <source media="(max-width: 600px)" srcset="../assets/readme-agents/grid-compact.png">
      <img src="../assets/readme-agents/grid.png" alt="Papilot Writer、Codex、Claude、Cursor、GitHub Copilot、Grok、Antigravity、Kimi、GLM、ZCode、DeepSeek、Qwen、OpenCode、Qoder、CodeBuddy、WorkBuddy 和 Pi" width="848">
    </picture>
  </a>
</p>

<p align="center"><sub>可直接使用你现有的账号登录或 API 密钥，也可使用内置的 Papilot Writer。<a href="../guide.md#agents">配置指南</a></sub></p>

<a id="how-it-works"></a>

<a id="how-it-works"></a>

## 工作原理

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-showcase/flow-compact-dark.zh-CN.png">
    <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/flow-dark.zh-CN.png">
    <source media="(max-width: 600px)" srcset="../assets/readme-showcase/flow-compact.zh-CN.png">
    <img src="../assets/readme-showcase/flow.zh-CN.png" alt="1. 打开你的论文：本地文件夹、Overleaf 项目或模板。2. 在 PDF 上标记。3. 智能体在独立的 Git 工作树中编辑副本。4. 查看排版效果：文字描述转化为直接呈现在页面上的 T-Abs 推导规则。5. 由你决定：接受、拒绝，或发表评论以进行下一轮修改。6. 提交并同步：修改写入本地文件与 Git 历史，若已关联 Overleaf 则同步至 Overleaf。" width="1000">
  </picture>
</p>

<a id="documentation-and-community"></a>

<a id="community"></a>

## 社区

<p align="center">
<a href="https://github.com/PapilotAI/papilot/issues/new/choose"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/issue-compact-dark.zh-CN.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/issue-dark.zh-CN.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/issue-compact.zh-CN.png"><img src="../assets/readme-community/issue.zh-CN.png" alt="反馈问题：提交 Issue，哪怕只是初步描述。" width="49%"></picture></a>
<a href="https://github.com/PapilotAI/papilot/discussions"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discussion-compact-dark.zh-CN.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discussion-dark.zh-CN.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discussion-compact.zh-CN.png"><img src="../assets/readme-community/discussion.zh-CN.png" alt="在 Discussions 中提问或分享想法。" width="49%"></picture></a>
<a href="https://discord.gg/WdgZDDAvwj"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discord-compact-dark.zh-CN.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discord-dark.zh-CN.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discord-compact.zh-CN.png"><img src="../assets/readme-community/discord.zh-CN.png" alt="在 Discord 上与 Papilot 的开发者和用户交流。" width="49%"></picture></a>
<a href="../../.github/CONTRIBUTING.md"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/contribute-compact-dark.zh-CN.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/contribute-dark.zh-CN.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/contribute-compact.zh-CN.png"><img src="../assets/readme-community/contribute.zh-CN.png" alt="参与贡献：欢迎提交 Pull Request，包括借助 AI 智能体编写的贡献。" width="49%"></picture></a>
</p>

Papilot 更新频繁：请查看[更新日志](../../CHANGELOG.md)。

<a id="contributors"></a>

## 贡献者

<p>
  <a href="https://github.com/PapilotAI/papilot/graphs/contributors">
    <picture>
      <source media="(max-width: 600px)" srcset="https://papilot.ai/readme-contributors/compact.svg">
      <img src="https://papilot.ai/readme-contributors/desktop.svg" alt="Papilot 的贡献者">
    </picture>
  </a>
</p>

<a id="star-history"></a>

## Star 历史

如果 Papilot 为你节省了时间，欢迎点亮一颗 Star，帮助更多研究者发现它。

<a href="https://www.star-history.com/?repos=papilotai%2Fpapilot&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
   <img alt="Star 历史趋势图" src="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
 </picture>
</a>

---

<p align="center"><sub><a href="../../LICENSE">MIT</a> © 2026 PapilotAI. 感谢 <a href="https://linux.do/">LINUX DO</a> 社区伙伴们的支持。</sub></p>
