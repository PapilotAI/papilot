## 环境准备一览

Papilot 运行在你自己的电脑（macOS、Windows 或 Linux）上，文稿文件、Git 历史、TeX 编译器与智能体登录状态都保存在本地：

- **桌面应用**（[papilot.ai/#download](https://papilot.ai/#download)）：已内置 Node.js 运行时。主机上只需安装 **Git**、包含 `latexmk` 与 `synctex` 的 **TeX 发行版**（macOS 推荐 MacTeX；Windows 推荐 TeX Live 或带 Perl 的 MiKTeX；Linux 推荐 TeX Live），以及**至少一个已配置的 AI 智能体**。
- **命令行版（`npm install -g papilot`）或源码运行**：还需要 **Node.js 22.22+**。各平台安装包、WSL、Nix 与 CLI 方式详见[安装指南](installation.md)。

桌面端首次启动自带预编译好的 **Papilot paper** 示例 PDF，尚未安装 TeX 也能先行浏览体验；编译修改则需要 Git 与 TeX。

## 六步完成第一次受审阅的修订

1. **安装并打开 Papilot。** 从 [papilot.ai/#download](https://papilot.ai/#download) 下载 macOS、Windows 或 Linux 桌面安装包（或通过 Homebrew、Scoop、WinGet、APT、AUR、npm 安装——详见[安装指南](installation.md)）。
   - 在 Windows 上，首次启动可选择 **WSL**（推荐用于搭配 Linux 版 TeX Live 与各类 CLI 智能体）或原生 **Windows** 环境；之后随时可在 **Settings → General → Environment** 中切换。
   - 若主机缺少 Git 或 LaTeX，工作区顶部提示条可直接打开 **Settings → Git**（点击 **Check again**）或 **Settings → LaTeX**（点击 **Detect again**）。

2. **连接智能体。** 打开 **Settings → Agents**（macOS 按 `⌘,`，或点击侧边栏底部的齿轮图标）。
   - **最省心的内置方式**：选择 **Papilot Writer**，通过浏览器登录 ChatGPT Plus/Pro 或 GitHub Copilot，或填写 API 密钥（支持 Anthropic、OpenAI、Google、OpenRouter、DeepSeek、xAI、Moonshot、Z.ai、Mistral）。
   - **复用本机编程智能体**：在主机终端完成对应 CLI 登录（如 `codex login`、`claude auth login`、`copilot login`、`kimi login`、`agy`、`qwen`、`opencode auth login`、`pi` 或 `grok login`），随后在 **Settings → Agents** 中点击 **Reconnect**（或 **Refresh**）。详见[智能体与模型](agents.md)。

3. **打开论文或从模板新建。** 点击 **New paper**（或 **Import or open**）：
   - **Open existing folder**（`File › Open Paper…`，`⌘O` / `Ctrl+O`）直接在原文件夹就地编辑，并在需要时自动初始化本地 Git 历史。
   - **Import a copy** 会将文件夹、ZIP、arXiv 链接、公开 GitHub 仓库或只读 Overleaf 链接复制为独立副本；如果导入可编辑 Overleaf 项目且希望双向同步，保持开启 **Keep in sync with Overleaf**。
   - **Templates** 可从离线可用的 **Example project** 或 [Papilot Universe](https://papilot.ai/universe/) 模板库创建开箱即编译的新论文。详见[论文导入与模板](papers-and-templates.md)。

4. **直接在 PDF 上指出要改什么。** 在 **Manuscript** 视图中，使用 PDF 旁边的标注工具栏（手机端位于底部）：
   - 选 **Note**（`T`）划选句子，或选 **Region**（`M`）框选公式、表格或插图，写下修改要求（使用 **Select** `V` 划选文字后也可点击旁边的 **Add note**）。
   - 点击批注上的右箭头（或在 **My notes** 中使用 **Add to task**）将批注引用到 **New task**，在输入框下方选好智能体与模型，按 **Enter**（`⌘Enter` / `Ctrl+Enter`）发送。
   - 智能体会在独立的 **Git 工作树（worktree）** 副本中修改源码——修改期间你磁盘上的原稿文件完全不受影响。详见[PDF 批注与阅读](annotate-and-read.md)。

5. **逐条审阅排版后的前后对比。** 智能体完成后，Papilot 自动编译出排版级修改前后对比：
   - 点击 **Accept**（`✓`）在当前任务中保留该处改动，点击 **Reject**（`✕`）排除该处改动（关联的原稿批注会自动退回 **Manuscript**，不会丢失），或点击 **Comment** 写下改进意见再点 **Send feedback** 继续打磨。
   - 点击 **Accept** 只是在任务内拍板，**尚未修改**你的原稿文件。

6. **应用或提交到原稿。** 当所有待定改动都拍板后，审阅顶部会出现保存栏：
   - 点击 **Apply**（`Apply to workspace`）：仅把已接受的改动写入论文工作区文件，不创建 Git 提交。
   - 或填写/点击 `✨` 自动生成提交说明后点击 **Commit**（`Commit to manuscript`）：把已接受的改动写入文件，**同时**在当前分支创建一条只包含本任务已接受改动的本地 Git 提交。
   - 这两个按钮都不会自动推送到远端。需要拉取或推送 Git 历史时，打开 **Version Management** 点击 **Sync**（或 **Push**）；若论文已关联 Overleaf，应用或提交后的改动约一秒内就会自动同步给合作者。详见[审阅、应用与提交](review-and-save.md)。

![从打开论文、PDF 批注到审阅提交与同步的六步流程](../../assets/readme-showcase/flow.zh-CN.png)

## 界面语言与外观

- **界面语言**：**Settings → General → Language** 默认跟随浏览器，支持 {{uiLanguageCount}} 种界面语言（{{uiLanguageListZh}}）。你的论文内容、批注和对话始终保留你所使用的原始语言；自动生成的 Git 提交说明可在 **Settings → Git → Commit message language** 中独立设置语言。
- **外观主题**：**Settings → Appearance** 支持 **Light**、**Dark** 和 **System**，并提供独立的 PDF 页面深色显示控制，保证深色模式下公式、图表以及红绿对比高亮依然清晰易读。

## 排列面板与窗口

- **停靠或浮动面板**：稿件侧边面板（新建任务与源码编辑器）和任务的对话默认位于右侧。在面板标题栏末尾的位置按钮中选择**停靠在左侧**、**停靠在底部**或**浮动在页面上方**；也可以拖动这个按钮或标题栏的空白处：停靠的面板放在另一条边附近即停靠到该边，放在其他位置即浮动。浮动面板可以在整个窗口内（包括侧边栏上方）自由移动，需要停靠时从菜单中选择。拖动时按 **Escape** 取消。拖动停靠面板与页面之间的边界，或浮动面板的任意一条边或一个角，可以调整大小；双击恢复默认大小。
- **使用另一块屏幕**：在同一菜单中选择**在新窗口中打开**，或把面板拖出 Papilot 窗口的边缘，面板会连同标签页、草稿和菜单移入独立窗口。工具栏中的**显示对话窗口**或**显示面板窗口**可把它带到前面；在它的菜单中选择位置或关闭窗口，面板会回到原处。源码编辑器标签页上的**在新窗口中打开**只移出编辑器，并保留未保存的文本和撤销历史；**移回此处**可把它放回。桌面应用会在上次关闭的位置、按**界面大小**重新打开各窗口；在浏览器中请允许 Papilot 弹出窗口。
- **重置**：每个面板会在此浏览器中记住位置和大小；**重置面板布局**会把它放回右侧。窗口宽度小于 900 px 时，稿件面板保持在 PDF 下方；手机端一次显示一个面板。

如果任何一步遇到阻碍，无需从头重装，直接按症状查阅[故障排查](troubleshooting.md)即可。
