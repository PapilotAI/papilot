## 多智能体协作模式（Collaboration mode）

在 **Settings → Experiments** 中开启 **Enable collaboration mode**，即可在单个任务中把多条 PDF 批注自动分流给多个已连接的智能体与模型协同处理（无需限定 Codex，适配任意已连接智能体）。

- **三阶段流水线（`Router → Task lanes → Judge`）**：轻量只读路由器会先按空间位置把同段批注聚簇，再分派到对应任务通道（内置 **Simple edits**、**Prose & polish**、**Math & rigorous**、**Layout & LaTeX**，并支持自定义最多 8 条通道）。
- **单模型直出或并行赛马**：配置 1 个模型的通道直接执行；配置 2～4 个模型的通道会在隔离快照上并行赛马，经过 LaTeX 语法与引用保真校验后，由严谨的 **Judge** 匿名盲评出默认方案，同时把其他候选方案内嵌到 PDF 改动卡片上供对比切换。
- **任务级策略**：在模型菜单选择 **Collaboration mode** 后，可切换 **Balanced · Auto route & race**、**Fast · Route only** 或 **Thorough · Race & verify**。

通道图编辑、实时分派卡片与实现细节见 [协作模式详解](../../annotation-routing.md)。

## ChatGPT Pro（网页接力）

在 **Settings → Experiments** 中启用 **ChatGPT Pro (web)**，可把网页版 ChatGPT Pro 的推理能力接入本地 LaTeX 审阅流：

1. 与普通智能体一样，在 PDF 上批注后选择 **ChatGPT Pro (web)** 发起任务。
2. 如需完整仓库上下文，可一键把任务快照同步到 GitHub 远端分支供网页端读取。
3. 复制生成的提示词到 ChatGPT Pro，再把回复粘贴回同一任务对话中，并指定一个本地已连接的智能体与模型把修改落地到工作树，随后照常审阅排版 PDF 对比。

## PhiTeX 增量编译

在主机 `PATH` 中安装 [PhiTeX](https://phitex.org)（独立的 AGPL-3.0 增量 TeX 编译器）后，可在 **Settings → Experiments → Compile with PhiTeX** 中开启，以加快 `pdfLaTeX` 的增量重编。

- LuaLaTeX 论文与仅编译改动章节的审阅仍使用 `latexmk`。
- PhiTeX 不执行自定义 `latexmkrc` 规则，且 XeLaTeX 首次建立字体索引可能需要数分钟。
- 随时关闭开关即可立即切回 `latexmk`。

## Typeless 语音批注（macOS）

在 macOS 桌面端开启 **Settings → Experiments → Typeless voice notes** 后，新建 PDF 批注时会自动触发你在 [Typeless](https://www.typeless.com/) 中配置的听写快捷键。

- 需在 **系统设置 → 隐私与安全性 → 辅助功能** 中允许 Papilot，并在 Typeless 内完成麦克风授权。
- 仅在 macOS 桌面端可用（浏览器客户端、Windows 与 Linux 不可用）。Papilot 仅发送快捷键而不读取录音或听写状态，请核对插入的文本后再加入任务。

详细配置与限制说明见 [Typeless 语音批注](../../typeless.md)。
