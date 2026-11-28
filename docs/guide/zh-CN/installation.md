## 桌面应用与包管理器

前往 [papilot.ai/#download](https://papilot.ai/#download) 或 [GitHub Releases](https://github.com/PapilotAI/papilot/releases/latest) 下载最新版本（`v{{release}}`），或通过系统包管理器安装。桌面安装包已内置 Node.js；主机需另行安装 Git、TeX 发行版（含 `latexmk` 与 `synctex`）及所需的外部智能体 CLI。

| 平台 | 安装包与包管理器 | 编译修订所需的主机工具 |
| --- | --- | --- |
| **macOS** | Apple 芯片与 Intel `.dmg`/`.zip`、Homebrew tap | Git（Xcode Command Line Tools 或 Homebrew）与 [MacTeX](https://www.tug.org/mactex/) / [TeX Live](https://www.tug.org/texlive/) |
| **Windows (x64)** | Scoop、WinGet、NSIS 安装版（`.exe`）、便携版（`.exe`） | **WSL** 模式：Linux 版 Node.js 22.22+、npm、Git 与 TeX Live；**原生 Windows**：[Git for Windows](https://git-scm.com/download/win) 与 TeX Live（或带 Perl 的 MiKTeX） |
| **Linux (x64)** | 签名 APT（`https://papilot.ai/apt`）、Arch AUR（`papilot-bin`）、`.AppImage`、`.deb`、Nix | Git 与带 `latexmk`、`synctex` 的 TeX Live（Nix 自动内置） |

- **检查运行环境**：打开 **Settings → Git**（点击 **Check again**）与 **Settings → LaTeX**（点击 **Detect again**）。若启动 Papilot 后才安装 Git 或 TeX 且仍未识别，请重启 Papilot 以读取更新后的 `PATH`。

## macOS

从 [papilot.ai/#download](https://papilot.ai/#download) 下载 Apple 芯片或 Intel 版 `.dmg`，或使用 Homebrew 安装：

```sh
brew tap PapilotAI/tap
brew trust PapilotAI/tap
brew install --cask PapilotAI/tap/papilot
```

- 在主机安装 Git（`xcode-select --install`）与 [MacTeX](https://www.tug.org/mactex/)（或通过 Homebrew 安装 TeX Live），确保 `latexmk` 与 `synctex` 可用。
- 桌面端数据默认保存在 `~/Library/Application Support/Papilot`，日志位于 `~/Library/Logs/Papilot/backend.log`。

## Windows 与 WSL

在 Windows x64 上可通过 **Scoop**、**WinGet**，或前往 [GitHub Releases](https://github.com/PapilotAI/papilot/releases/latest) 下载安装包（`Papilot-{{release}}-win-x64.exe`）/ 绿色便携版（`Papilot-{{release}}-win-x64-portable.exe`）：

```powershell
# Scoop（官方 Papilot bucket）
scoop bucket add papilot https://github.com/PapilotAI/scoop-bucket
scoop install papilot/papilot

# WinGet
winget install PapilotAI.Papilot
```

### 选择 WSL 还是原生 Windows

Windows 桌面端首次启动时会引导选择运行后端（之后随时可在 **Settings → General → Environment** 或顶部 **Environment** 菜单中切换）：

| 模式 | Git、TeX 与智能体运行位置 | 数据目录 | 适用场景 |
| --- | --- | --- | --- |
| **WSL**（*推荐*） | 运行在所选 WSL 2 Linux 发行版内 | WSL 内的 `~/.local/share/papilot-desktop/data` | 既想保留原生 Windows 桌面窗口，又想使用 Linux TeX Live 和 Linux 生态的智能体 CLI |
| **原生 Windows** | 直接运行在 Windows 主机 | `%APPDATA%\Papilot` | 论文仓库、TeX Live/MiKTeX 和智能体 CLI 均已配置在 Windows 上，不想启用 WSL |

### WSL 与原生环境前置依赖

- **WSL 模式**：若未安装 WSL，在管理员 PowerShell 中运行 `wsl --install -d Ubuntu`，重启并完成初始设置；随后**在该 Linux 发行版内**安装 **Node.js 22.22+**、**npm**、**Git**、含 `latexmk` 与 `synctex` 的 **TeX Live** 及所需智能体 CLI。回到 Papilot 选择该发行版并点击 **Prepare WSL**，建议将论文存放在 Linux 文件系统内（`\\wsl.localhost\<distro>\home`）以获得更快的编译速度。
- **原生 Windows 模式**：安装 [Git for Windows](https://git-scm.com/download/win) 与 **TeX Live for Windows**（自带 `latexmk` 所需的 Perl），或安装 **MiKTeX** 并补充 `latexmk` 与 Perl。Papilot 在运行 TeX Live 构建时会自动优先选用其自带 Perl，避免非 ASCII 路径或 BibTeX 异常。
- **PowerShell 与进阶参考**：若 PowerShell 阻止执行 `npm`，改用 `npm.cmd` 即可。原生 Windows 下 Claude 以不含命令沙盒的 **Accept edits** 模式运行。WorkBuddy ACP 启动器与打包细节见 [Windows 详细参考](../../windows.md)。

## Linux 与 Nix

### Debian 与 Ubuntu（官方签名 APT）

核对官方签名公钥指纹（`880137ACF48D4E8CA78CE9857A85E7B6DD990D51`）后添加 amd64 仓库 `https://papilot.ai/apt`：

```sh
curl -fsSL https://papilot.ai/apt/gpg.key -o /tmp/papilot-signing.key
gpg --show-keys --with-fingerprint /tmp/papilot-signing.key

sudo install -d -m 755 /etc/apt/keyrings
sudo gpg --dearmor --output /etc/apt/keyrings/papilot.gpg /tmp/papilot-signing.key
sudo chmod 644 /etc/apt/keyrings/papilot.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/papilot.gpg] https://papilot.ai/apt stable main" |
  sudo tee /etc/apt/sources.list.d/papilot.list
sudo apt update && sudo apt install papilot
```

后续升级运行 `sudo apt update && sudo apt install --only-upgrade papilot-desktop`。仓库维护架构见 [docs/apt.md](../../apt.md)。

### Arch Linux（AUR）

通过 AUR 助手或 `makepkg` 安装 x86_64 桌面包 `papilot-bin`：

```sh
paru -S papilot-bin
```

请在主机上另行安装含 `latexmk` 和 `synctex` 的 TeX 发行版以编译论文。详见 [docs/aur.md](../../aur.md)。

### 直接下载 AppImage 与 .deb

从 [GitHub Releases](https://github.com/PapilotAI/papilot/releases/latest) 直接下载 Linux x64 `.deb` 或 `.AppImage`：

- **`.deb`**：`sudo apt install ./Papilot-{{release}}-linux-amd64.deb`（自动补齐 Git 依赖）。
- **`.AppImage`**：`chmod +x Papilot-{{release}}-linux-x86_64.AppImage`；若系统未安装 FUSE，使用 `APPIMAGE_EXTRACT_AND_RUN=1 ./Papilot-{{release}}-linux-x86_64.AppImage` 启动。

### Nix Flake

使用 Nix 可一次性获得内置的 Node.js、Git 与完整 TeX Live（首次构建会下载 TeX Live）：

```sh
nix run github:PapilotAI/papilot -- demo
```

Linux 下还可通过 `.#papilot-desktop` 启动 Electron 桌面端；智能体 CLI 仍在主机侧配置。通过 APT、AUR、Nix 安装的版本会关闭应用内更新并由系统包管理器接管升级。详见 [docs/nix.md](../../nix.md)。

## 命令行、VS Code 扩展与源码

- **CLI 本地服务（`npm`）**：在浏览器或远程工作站上运行 Papilot（需要 **Node.js 22.22+**、Git 与 TeX）：

```sh
npm install -g papilot
papilot demo   # 复制一份可随意试验的 26 页示例论文并启动
papilot        # 启动服务：http://127.0.0.1:7274
```

  命令行参数、数据目录与 macOS `launchd` 后台服务见[命令行、统计与配置](reference.md#命令行与后台服务)。
- **VS Code 扩展（`Papilot Workspace`）**：可在 VS Code 内直接打开并审阅 Papilot 论文与改动。
- **从源码构建**：详见[开发与内部架构](../../development.md)。
