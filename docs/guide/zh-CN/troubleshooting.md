## 按症状快速恢复

以下恢复操作都不会删除你的论文源文件、任务工作树或尚未发送的对话草稿。

### 提示缺少 Git、latexmk 或 SyncTeX

1. 打开 **Settings → Git** 点击 **Check again**，或打开 **Settings → LaTeX** 点击 **Detect again**。
2. 在运行 Papilot 的主机上安装对应工具（macOS 安装 MacTeX；Windows 安装 TeX Live 或带 Perl 的 MiKTeX；Linux 安装 TeX Live 与 Git；若 Windows 桌面端选用了 **WSL** 模式，则需在对应的 Linux 发行版内部安装）。
3. 如果新开终端已经能运行该命令但 Papilot 仍提示未找到，请**重启 Papilot** 让后端进程继承更新后的 `PATH`。macOS 后台服务可通过 `PAPILOT_SERVICE_PATH=/custom/bin papilot service install` 显式指定工具目录。

### 论文无法编译

1. **首次导入阶段报错**：检查 **Main TeX file**（主文档）与 **LaTeX engine**（含 `fontspec`/`xeCJK` 的中文或 Unicode 论文通常需选 `XeLaTeX` 或 `LuaLaTeX`）后点 **Retry compilation**；或点 **Help fix compilation** 让已连接的智能体自动排查并生成未提交的修复供你审阅。点 **Add and fix later** 也可先进入工作区再修。
2. **日常编辑报错**：展开 PDF 上方的 **Compilation Problems**。可恢复的 LaTeX 错误仍会展示已生成的 PDF 并附上诊断信息；致命错误则会保留上一次编译成功的 PDF 供你对照。
3. 在 **Compilation Problems** 中点击 **Fix with an agent…**：智能体会在一次只读回合中读取编译日志和相关源码——若属于引擎、源码目录或 `latexmkrc` 配置问题会自动测试并保存；若需要修改 `.tex` 源码，点击 **Start task** 即可在隔离的任务工作树中生成修复审阅。
4. **辅助文件缓存或 `minted` Python 报错**：点击 **Recompile** 执行干净重编译。若旧版 `latexminted` 在高版本 Python（如 Python 3.14）下报错，请升级 `latexminted` 或通过 `PAPILOT_SERVICE_PATH` 指定 Python 3.12。若希望遇到首个错误立即终止，可在 `.git/papilot/settings.json` 中设置 `"halt_on_error": true`（详见[审阅引擎参考](../../../engine/docs/reference.md)）。
5. **开启了实验性 PhiTeX**：若启用了 **Settings → Experiments → Compile with PhiTeX**，请注意 LuaLaTeX 仍回退至 `latexmk`、自定义 `latexmkrc` 规则不会执行，且首次 XeLaTeX 字体索引可能耗时数分钟；关闭该开关即可立即切回 `latexmk`。

### 智能体不可用、未登录或连接失败

1. 打开 **Settings → Agents** 点开对应智能体卡片，查看服务端检测到的具体原因。
2. 对于 CLI 智能体（`codex`、`claude`、`copilot`、`grok`、`agy`、`kimi`、`dsh`、`qwen`、`opencode`、`pi`、`qoder`、`codebuddy`），在 Papilot 主机终端执行其登录命令后回到卡片点击 **Reconnect**（或 **Refresh**）。注意：Cursor、Qoder、CodeBuddy、Antigravity 的图形 IDE 启动器不等同于各自的命令行 CLI。
3. 对于通过环境变量配置的密钥（`ANTHROPIC_API_KEY`、`CURSOR_API_KEY`、`ZHIPU_API_KEY` / `ZAI_API_KEY`、`XAI_API_KEY`）或自定义路径（`PAPILOT_*_BIN`），必须在启动 Papilot 的环境中设置并**重启 Papilot**——仅点 **Reconnect** 无法读取其他终端窗口里的环境变量。
4. **网络代理**：若访问模型服务需要 HTTP 代理，请在启动环境中传入 `HTTP_PROXY` 和 `HTTPS_PROXY`，并务必加上 `NO_PROXY=localhost,127.0.0.1,::1` 以免本地审阅引擎通信被代理拦截（仅针对 Antigravity 的代理可设 `PAPILOT_AGY_PROXY`）。
5. **无法发起 `/ai-review` 或生成提交说明**：`Qoder`、`CodeBuddy` 与 `WorkBuddy` 暂不支持只读沙盒模式；请同时连接任意支持只读模式的智能体（如 Papilot Writer、Codex 或 Claude）。

### 审阅打不开或任务显示 Check status

- 点击任务顶部的 **Check status**。Papilot 会凭幂等操作 ID 安全核对已保存的审阅决定（绝不会重复应用或误撤其他操作），并在确认对比编译因服务重启中断时自动重编一次，工作树修改与草稿完整保留。

### Overleaf 同步或原稿合并出现冲突

- **Overleaf 黄点或双端改了同一处**：点击 **Version Management** 下方的 **Overleaf** 行选择 **Retry**。若离线期间双方改了同一段文字，Overleaf 版本会先行保留以避免打断合作者，面板中并排展示两版差异，点 **Use mine** 或 **Keep Overleaf's** 即可拍板。
- **应用任务时原稿已有重叠新改动**：点击 **Apply** 或 **Commit** 时若发现原稿同一段落已被改动，Papilot 不会强行覆盖，而是在任务工作树中自动生成一轮冲突消解审阅，核对后点 **Confirm and commit** 或 **Confirm and apply** 即可。
- **Git 合并冲突（`!`）**：在 **Version Management** 中点击 **Resolve with** 让智能体整理冲突文件并逐个查看 diff 后 **Commit merge**，或点击 **Abort merge** 一键退回合并前状态。

### 手机或平板连不上 Papilot

1. 确认两台设备均已连入同一个 Tailscale tailnet，且 **未开启 Funnel**（Papilot 会拒绝公网 Funnel 流量）。
2. 检查 `PAPILOT_PUBLIC_ORIGIN` 是否与手机浏览器地址栏里的协议、域名和端口**分毫不差**，以及 `PAPILOT_TAILSCALE_LOGIN` 是否与你的 tailnet 登录账号一致（运行 `papilot doctor` 可自动核验这两项）。
3. 若升级后旧标签页一直转圈，彻底关闭该浏览器标签页后重新打开即可。

### 应用内更新一直等待或自动回滚

- 应用内更新（**Settings → Updates**）会等待运行中的任务、待确认审批与 PDF 编译全部空闲后才重启；请先完成或暂停任务，下载失败时点击 **Retry update**。若新版本启动自检未通过，Papilot 会自动恢复旧版运行时与 SQLite 数据库。系统包管理器或 Nix 安装版（`PAPILOT_INSTALL_METHOD=managed` 或 `nix`）请通过对应包管理器升级。

## 在哪里获取诊断信息与日志

- **桌面端日志**：在顶部应用菜单选择 **Help → Show Logs**（macOS 位于 `~/Library/Logs/Papilot/backend.log`，Linux 位于 `~/.config/Papilot/logs/backend.log`，Windows 位于 `%APPDATA%\Papilot\logs\backend.log`，WSL 模式位于发行版内 `~/.local/share/papilot-desktop/data/logs/backend.log`）。
- **命令行诊断（`papilot doctor`）**：一键检查 Node.js、前端与审阅引擎构建产物、数据目录、Git、`latexmk`、SyncTeX、TeX 引擎、各智能体 CLI/密钥状态以及 Tailscale 配置，全程不发送模型请求也不修改任何文件（退出码 `0` 表示正常或仅有提示警告，`1` 表示存在阻塞错误，`2` 表示命令行参数有误）：

```sh
papilot doctor
papilot doctor --repo /path/to/paper
papilot doctor --json
```

- **更新与后台服务日志**：应用内更新日志位于 `<PAPILOT_DATA>/updates/`（`install.log`、`restart.log`、`desktop/`）；macOS `launchd` 服务日志位于 `~/.papilot/service.log` 和 `service.error.log`。
- **跨平台验证范围说明**：安装与恢复流程已在 macOS 以及确定性的 Linux/Windows CI 与协议测试中验证（原生 Windows 11 x64 与 WSL Ubuntu 24.04 细节见 [Windows 详细参考](../../windows.md)）。
