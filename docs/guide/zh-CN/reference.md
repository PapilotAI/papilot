## 命令行与后台服务

全局安装 CLI（`npm install -g papilot`，需要 Node.js 22.22+）即可在浏览器或远程工作站上运行 Papilot：

```sh
papilot                         # 启动本地服务：http://127.0.0.1:7274
papilot demo                    # 复制一份可随意试验的 26 页示例论文并启动
papilot doctor --json           # 诊断环境、TeX、智能体与 Tailscale 配置
papilot service install         # macOS：注册 launchd 后台服务（含 caffeinate -i 防休眠）
papilot service stop            # macOS：停止后台服务
```

- **数据目录位置**：CLI 将 SQLite 数据库、上传附件与导入副本保存在 `~/.papilot`（Windows 为 `%USERPROFILE%\.papilot`），与桌面端数据目录（macOS 为 `~/Library/Application Support/Papilot`，Linux 为 `~/.config/Papilot`，Windows 为 `%APPDATA%\Papilot`，WSL 内为 `~/.local/share/papilot-desktop/data`）相互独立。
- **自定义端口或数据目录**：通过 `--port <端口>`（`PAPILOT_PORT`）或 `--data <目录>`（`PAPILOT_DATA`）覆盖默认设置；运行 `papilot --help` 可查看全部参数。

## 活动统计面板

打开 **Settings → Statistics** 可按全部论文或单篇论文查看最近 **7 天**、**30 天**、**90 天** 或 **全部时间** 的本地修订统计：

- 涵盖已接受/已拒绝改动数、智能体累计耗时、启动任务数、日历活跃热力图、接受率、Token 与估算费用分布、活跃时段与各智能体/模型占比。
- 点击 **Share** 可按当前主题生成不含论文名称的 PNG 分享卡片；所有统计事件仅保存在本地 SQLite 工作区数据库中。

## 更新与发布渠道

- **应用内更新**：在 **Settings → Updates** 中可选择 **Stable**（正式发布版，当前 `v{{release}}`）或 **Dev (GitHub main)**。下载完成后会等待运行中的任务、待审批操作与 PDF 编译空闲再重启；若新版本自检未通过，会自动回滚到旧版运行时与数据库快照。
- **系统包管理器安装**：通过 Homebrew Cask、Scoop、WinGet、签名 APT、Arch AUR、Nix 或容器安装的版本会自动设置 `PAPILOT_INSTALL_METHOD=managed`（或 `nix`），关闭应用内更新并交由系统包管理器升级，且完整保留用户目录中的论文、批注与设置。

## 环境变量速查表

| 变量名 | 默认值 | 用途 |
| --- | --- | --- |
| `PAPILOT_PORT` | `7274` | 本地 HTTP 监听端口（固定仅绑定 `127.0.0.1`）。 |
| `PAPILOT_DATA` | `~/.papilot`（CLI）/ `.papilot`（源码目录） | SQLite 数据库、上传附件、更新与导入副本目录（桌面端默认使用系统应用数据目录，测试可用 `PAPILOT_DESKTOP_DATA` 覆盖）。 |
| `PAPILOT_WORKTREES` | `~/.papilot/worktrees` | 新建任务 Git 工作树的默认根目录（单篇论文可在 `.git/papilot/settings.json` 的 `worktrees` 字段单独覆盖）。 |
| `PAPILOT_MEMORY` | `~/.papilot/memory.md` | 自定义全局（**All papers**）写作记忆文件路径。 |
| `PAPILOT_PUBLIC_ORIGIN` | 未设置 | 允许远程浏览器访问的精确 Tailscale 地址（`协议://域名:端口`）。 |
| `PAPILOT_TAILSCALE_LOGIN` | 未设置 | 允许访问远程工作区的 Tailscale 登录账号。 |
| `PAPILOT_SERVICE_PATH` | 未设置 | 为 macOS `papilot service install` 后台服务优先注入的工具 `PATH` 目录。 |
| `PAPILOT_INSTALL_METHOD` | 未设置 | 容器镜像或系统包固定版本时设为 `managed`（Nix 自动设为 `nix`），禁用应用内更新与运行时下载。 |
| `PAPILOT_*_BIN` | `PATH` 中的同名命令 | 显式指定任意 CLI 智能体的可执行文件路径（`CODEX`、`CLAUDE`、`COPILOT`、`GROK`、`AGY`、`KIMI`、`DSH`、`QWEN`、`OPENCODE`、`PI`、`ZCODE`、`QODER`、`CODEBUDDY`、`WORKBUDDY`）。 |
| `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`CURSOR_API_KEY`、`ZHIPU_API_KEY`、`ZAI_API_KEY`、`XAI_API_KEY` | 未设置 | 各模型服务商 API 密钥及自定义 Anthropic 兼容网关配置。 |
| `PAPILOT_AGY_PROXY` | 未设置 | 仅作用于 `agy` 子进程的 HTTP 代理地址。 |
| `PAPILOT_REVIEW_ENGINE` | `engine` | PDF 审阅引擎目录路径。 |
