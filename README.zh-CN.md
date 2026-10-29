<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo.svg" width="104" height="104" alt="Papilot 标志">
</picture>

<h1>Papilot</h1>

<p><b>像 Cursor 一样改论文：<br>直接在 PDF 上批注和审阅，完全不用碰 LaTeX。</b></p>

<p><a href="README.md">English</a> · 简体中文</p>

[![CI](https://github.com/cu1ch3n/papilot/actions/workflows/ci.yml/badge.svg)](https://github.com/cu1ch3n/papilot/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/papilot?color=2563eb&logo=npm)](https://www.npmjs.com/package/papilot)
[![License: MIT](https://img.shields.io/badge/license-MIT-2563eb)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522.22-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-19-087EA4?logo=react&logoColor=white)](https://react.dev)
[![LaTeX](https://img.shields.io/badge/LaTeX-008080?logo=latex&logoColor=white)](https://www.latex-project.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-22c55e)](https://github.com/cu1ch3n/papilot/pulls)

[![Codex](https://img.shields.io/badge/Codex-supported-10A37F?logo=openai&logoColor=white)](#-智能体)
[![Claude](https://img.shields.io/badge/Claude-supported-D97757?logo=claude&logoColor=white)](#-智能体)
[![Antigravity](https://img.shields.io/badge/Antigravity-supported-4285F4?logo=google&logoColor=white)](#-智能体)

<br>

<img src="docs/assets/demo.gif" alt="Papilot：描述修改、审阅排版后的差异、阅读 PDF、在页面上批注并提交" width="100%">

</div>

<br>

你像导师批改学生的稿子一样，直接在 PDF 上阅读和批注；AI 智能体去改 LaTeX，每一处改动都以排版后修改前后的对比回到你面前。你点头之前，论文一个字都不会变。

## ✨ 功能

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/assets/feature-note.png" alt="在 PDF 选中的段落上写批注">
<h3>📝 在 PDF 上批注</h3>
选中一句话或框出一个公式，写下要怎么改。SyncTeX 会把对应的 LaTeX 行准确交给智能体。
</td>
<td width="50%" valign="top">
<img src="docs/assets/feature-review.png" alt="改动的修改前后对比，带接受和拒绝按钮">
<h3>✅ 逐条点头</h3>
每处改动都以排版后的差异呈现。接受、拒绝或评论，任何决定都能撤销。
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/assets/feature-contents.png" alt="打开目录菜单的 PDF 阅读器">
<h3>📖 像本地 PDF 一样阅读</h3>
用目录随意跳转，全文搜索，缩放清晰。选中的文字与印出的词完全对齐。
</td>
<td width="50%" valign="top">
<img src="docs/assets/feature-git.png" alt="带差异和提交信息的 Git 面板">
<h3>🌿 满意了再提交</h3>
查看差异，只提交你勾选的文件，提交信息可以让 agent 来写。可以 pull、push，也可以合并合作者的改动，冲突交给 agent 解决。
</td>
</tr>
</table>

此外：✨ **技能（skill）**，如润色、校对、检查数学，输入 `/` 即可选用，也能添加你自己的 · 🤖 **Codex、Claude 或 Antigravity**，各用你自己的登录 · 🌳 **每个任务都有独立的 Git 工作树**，最多两个同时运行 · 🌗 **浅色与深色** · 📱 **运行在你的电脑上**，也能用手机打开。

## 🚀 快速开始

> [!NOTE]
> 需要 **Node.js 22.22+**、**Git** 和完整的 **TeX** 发行版（[MacTeX](https://www.tug.org/mactex/) 或 [TeX Live](https://www.tug.org/texlive/)）。修改论文还需要至少一个[已登录的智能体](#-智能体)。

```sh
npm install -g papilot
papilot demo
```

打开 **http://127.0.0.1:7274**，在侧栏选择 **PDF**。demo 会添加一篇示例论文供你修改：一篇讲 Papilot 本身的 26 页 LaTeX 论文，满是公式。准备好之后，运行 `papilot`，选择 **Add paper**，即可添加任何放在 Git 仓库里的 LaTeX 项目。

## 🤖 智能体

| 智能体 | 登录（一次即可） | Papilot 如何运行它 |
| --- | --- | --- |
| **Codex** | `papilot codex login` | 通过 Codex app server 在其工作区沙箱中运行；已装有 `codex` 就直接用，没有则在首次启动时自动安装。 |
| **Claude** | 设置好 `ANTHROPIC_API_KEY` 再启动 `papilot` | 通过 Claude Agent SDK 运行，首次使用时下载；该 SDK 不接受 Pro 或 Max 订阅登录。 |
| **Antigravity** | 安装 Antigravity 并登录 `agy` | 运行 `agy -p`，每轮一个进程，只编辑文件；所在地区需要代理时设置 `PAPILOT_AGY_PROXY`。 |

Papilot 从不读取、保存或转发你的凭据。没有安装或没有登录的智能体会显示为不可用。

启动遇到问题？运行 `papilot doctor` 检查环境并查看修复建议，或用 `papilot doctor --repo /path/to/paper` 一并检查论文。加上 `--json` 可输出机器可读的报告。诊断不会安装软件、启动服务或修改论文。检查范围见[诊断指南](docs/guide.md#diagnostics)。

<details>
<summary><b>⚙️ 选项与远程访问</b></summary>

<br>

```sh
papilot --port 4400            # 使用其他本地端口
papilot --data ~/papilot-data  # 把状态放在别处（默认 ~/.papilot）
papilot service install        # macOS：登录后自动启动，退出后自动重启
npm uninstall -g papilot       # 卸载；状态仍保留在 ~/.papilot，可自行删除
```

Papilot 只监听 `127.0.0.1`。若要从其他设备访问，用 Tailscale Serve 把它发布到你的 tailnet，并设置 `PAPILOT_PUBLIC_ORIGIN` 和 `PAPILOT_TAILSCALE_LOGIN`；Papilot 会校验每个请求的主机、浏览器来源和 Tailscale 身份。具体步骤见[指南](docs/guide.md#remote-access-with-tailscale)。

要邀请导师或合作者，用 `PAPILOT_ACCOUNT_ORIGIN` 给 Papilot 一个公开的 HTTPS 地址，然后打开 **成员**：每个人用通行密钥登录，只能看到你共享的论文。只邀请你愿意把这台 Mac 交给的人，详见[协作者](docs/guide.md#collaborators)。

</details>

<details>
<summary><b>🛠️ 参与开发</b></summary>

<br>

```sh
git clone https://github.com/cu1ch3n/papilot && cd papilot
npm ci && npm run setup:review
npm run build && npm start
```

提交 pull request 前，请运行 `npm run typecheck`、`npm test` 和 `npm run test:ui`。

</details>

## 📚 文档

**[指南](docs/guide.md)**（英文）介绍工作台的每个部分、配置变量、重启后的恢复以及开发流程。[`examples/papilot-paper`](examples/papilot-paper) 中的示例论文深入讲解了设计，并附有证明。每个版本的变化见[更新日志](CHANGELOG.md)。

## 💬 社区

- 💡 **提问和想法**：[Discussions](https://github.com/cu1ch3n/papilot/discussions)
- 🐛 **遇到问题**：[提交 issue](https://github.com/cu1ch3n/papilot/issues/new/choose)
- 🤝 **想参与**：从 [good first issue](https://github.com/cu1ch3n/papilot/labels/good%20first%20issue) 开始，并阅读 [CONTRIBUTING.md](CONTRIBUTING.md)

如果 Papilot 帮你省下了改论文的时间，点个 ⭐ 能让更多研究者发现它。

<a href="https://github.com/cu1ch3n/papilot/graphs/contributors"><img src="https://contrib.rocks/image?repo=cu1ch3n/papilot" alt="Papilot 贡献者"></a>

## 📄 许可证

[MIT](LICENSE) © 2026 Cui Chen。内置的审阅引擎 [`vendor/latex-review`](vendor/latex-review) 同样采用 MIT 许可证。
