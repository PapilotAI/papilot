# Papilot 用户文档

推荐在网页版阅读（支持分组侧边栏与站内即时搜索）：**[papilot.ai/zh-CN/guide/](https://papilot.ai/zh-CN/guide/)** · Language: **[English](guide.md)** ([Web](https://papilot.ai/guide/)) | **简体中文** · 产品概览：**[README](readme/README.zh-CN.md)**

`docs/guide/` 是用户文档的唯一正文来源。本页作为 GitHub 目录索引，集中链接到各专题指南并保留既有 `#anchor` 兼容锚点，避免多处重复维护。

## 按主题浏览

### 快速开始

- **[快速上手](guide/zh-CN/quickstart.md)** — 六步走通你的第一次受审阅修订。
- **[安装指南](guide/zh-CN/installation.md)** — macOS、Windows 与 WSL（[windows.md](windows.md)）、Linux APT（[apt.md](apt.md)）、Arch AUR（[aur.md](aur.md)）、AppImage/`.deb`、Nix（[nix.md](nix.md)）、CLI 与 VS Code 扩展。
- **[论文导入与模板](guide/zh-CN/papers-and-templates.md)** — 打开本地文件夹、从 arXiv/GitHub/ZIP/Overleaf 导入、使用 Papilot Universe 模板与切换多主文档。

### 写作与审阅

- **[PDF 批注与阅读](guide/zh-CN/annotate-and-read.md)** — PDF 标注工具（`Q`/`T`/`M`/`P`/`D`/`E`/`V`）、`My notes` 管理、引用预览、阅读锚点、裁切白边与只读 `/ai-review`。
- **[审阅、应用与提交](guide/zh-CN/review-and-save.md)** — 排版对比审阅、参考文献核验、Accept/Apply/Commit/Sync 边界、被拒批注退回与手动编辑 LaTeX 源码。

### 智能体与定制

- **[智能体与模型](guide/zh-CN/agents.md)** — 内置 Papilot Writer、已连接编程智能体、模型与推理强度切换及任务权限。
- **[技能、写作记忆与附件](guide/zh-CN/skills-and-memory.md)** — 内置与自定义 `/` 技能、三层作用域写作记忆以及文件与图片附件。

### 协作与多端

- **[Overleaf 同步](guide/zh-CN/overleaf.md)** — 一次性快照导入与双向实时同步、在线光标署名及离线冲突处理。
- **[Git 与版本历史](guide/zh-CN/git-and-history.md)** — 版本管理、AI 提交说明、远端同步、安全回退与合并冲突解决。
- **[手机与平板远程访问](guide/zh-CN/remote-access.md)** — 私有 Tailscale Serve 配置、SSH 端口转发与移动端审阅技巧。

### 参考与排查

- **[故障排查](guide/zh-CN/troubleshooting.md)** — 按症状排查、`papilot doctor` 与诊断日志位置。
- **[命令行、统计与配置参考](guide/zh-CN/reference.md)** — CLI 命令、macOS 后台服务、活动统计面板、更新渠道与环境变量速查表。
- **[实验性功能](guide/zh-CN/experiments.md)** — 多智能体协作模式、ChatGPT Pro（网页接力）、PhiTeX 增量编译与 macOS Typeless 语音批注。

## 快捷索引与兼容锚点

<a id="your-first-revision"></a>
<a id="install-and-run"></a>

- **快速上手、安装与论文导入**：[快速上手](guide/zh-CN/quickstart.md) · [安装指南](guide/zh-CN/installation.md) · [论文导入与模板](guide/zh-CN/papers-and-templates.md)

<a id="agents"></a>
<a id="task-permissions"></a>
<a id="skills"></a>
<a id="task-attachments"></a>
<a id="writing-memory"></a>

- **智能体、权限、技能、附件与写作记忆**：[智能体与模型](guide/zh-CN/agents.md) · [任务权限](guide/zh-CN/agents.md#任务权限) · [复用技能](guide/zh-CN/skills-and-memory.md#复用技能) · [写作记忆](guide/zh-CN/skills-and-memory.md#写作记忆) · [文件与图片附件](guide/zh-CN/skills-and-memory.md#文件与图片附件) · [Agent 工具接口](agent-tools.md) · [Papilot Writer 架构](paper-agent.md)

<a id="workflow"></a>
<a id="reading-with-anchors"></a>
<a id="crop-pdf-margins"></a>
<a id="edit-a-passage-yourself"></a>
<a id="browse-files-and-switch-documents"></a>
<a id="ask-an-agent-to-annotate"></a>
<a id="ai-review"></a>

- **PDF 批注、审阅与手动修改源码**：[PDF 批注与阅读](guide/zh-CN/annotate-and-read.md) · [审阅、应用与提交](guide/zh-CN/review-and-save.md) · [Accept、Apply、Commit 与 Sync](guide/zh-CN/review-and-save.md#关键区别acceptapplycommit-与-sync) · [手动编辑 LaTeX 源码](guide/zh-CN/review-and-save.md#自己动手修改-latex-源码) · [多文档仓库管理](guide/zh-CN/papers-and-templates.md#管理论文与多主文档仓库)

<a id="sync-with-overleaf"></a>
<a id="version-history-and-git"></a>
<a id="commit-message-language"></a>

- **Overleaf 与 Git**：[Overleaf 同步](guide/zh-CN/overleaf.md) · [Git 与版本历史](guide/zh-CN/git-and-history.md)

<a id="remote-access-with-tailscale"></a>

- **手机与平板远程访问**：[手机与平板远程访问](guide/zh-CN/remote-access.md)

<a id="compile-with-phitex-experimental"></a>

- **实验性功能（协作模式、ChatGPT Pro 网页、PhiTeX、Typeless）**：[实验性功能](guide/zh-CN/experiments.md) · [协作模式详解](annotation-routing.md) · [Typeless 语音批注](typeless.md)

<a id="troubleshooting"></a>
<a id="diagnostics"></a>
<a id="fix-a-latex-build"></a>
<a id="statistics"></a>
<a id="updates"></a>
<a id="configuration"></a>

- **故障排查、诊断、统计、更新与配置**：[故障排查](guide/zh-CN/troubleshooting.md) · [论文无法编译](guide/zh-CN/troubleshooting.md#论文无法编译) · [诊断信息与日志](guide/zh-CN/troubleshooting.md#在哪里获取诊断信息与日志) · [命令行、统计与配置参考](guide/zh-CN/reference.md) · [环境变量速查表](guide/zh-CN/reference.md#环境变量速查表)

<a id="development-and-validation"></a>
<a id="review-engine"></a>

- **开发、测试与架构**：[开发与内部架构](development.md) · [编译性能](performance.md) · [审阅引擎参考](../engine/docs/reference.md) · [参与贡献](../.github/CONTRIBUTING.md)
