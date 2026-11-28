## Desktop app and package managers

Download the latest release (`v{{release}}`) from [papilot.ai/#download](https://papilot.ai/#download) or [GitHub Releases](https://github.com/PapilotAI/papilot/releases/latest), or install via your platform's package manager. Desktop installers bundle Node.js; install Git, a TeX distribution (`latexmk` + `synctex`) and any external agent CLI on the host.

| Platform | Installers & package managers | Host tools needed to compile edits |
| --- | --- | --- |
| **macOS** | Apple silicon & Intel `.dmg`/`.zip`, Homebrew tap | Git (Xcode Command Line Tools or Homebrew) and [MacTeX](https://www.tug.org/mactex/) / [TeX Live](https://www.tug.org/texlive/) |
| **Windows (x64)** | Scoop, WinGet, NSIS `.exe` installer, portable `.exe` | **WSL** mode: Linux Node.js 22.22+, npm, Git and TeX Live. **Native Windows**: [Git for Windows](https://git-scm.com/download/win) and TeX Live (or MiKTeX + Perl) |
| **Linux (x64)** | Signed APT (`https://papilot.ai/apt`), Arch AUR (`papilot-bin`), `.AppImage`, `.deb`, Nix | Git and TeX Live with `latexmk` and `synctex` (bundled by Nix) |

- **Checking prerequisites**: open **Settings → Git** (**Check again**) and **Settings → LaTeX** (**Detect again**). If you installed Git or TeX after launching Papilot and it is still not detected, restart Papilot so it inherits the updated `PATH`.

## macOS

Download the Apple silicon or Intel `.dmg` from [papilot.ai/#download](https://papilot.ai/#download), or install via Homebrew:

```sh
brew tap PapilotAI/tap
brew trust PapilotAI/tap
brew install --cask PapilotAI/tap/papilot
```

- Install Git (`xcode-select --install`) and [MacTeX](https://www.tug.org/mactex/) (or TeX Live via Homebrew) so `latexmk` and `synctex` are available.
- Desktop state lives in `~/Library/Application Support/Papilot` and logs in `~/Library/Logs/Papilot/backend.log`.

## Windows and WSL

Install Papilot `v{{release}}` on Windows x64 via **Scoop**, **WinGet**, or the `.exe` installer (`Papilot-{{release}}-win-x64.exe`) / portable executable (`Papilot-{{release}}-win-x64-portable.exe`) from [GitHub Releases](https://github.com/PapilotAI/papilot/releases/latest):

```powershell
# Scoop (official Papilot bucket)
scoop bucket add papilot https://github.com/PapilotAI/scoop-bucket
scoop install papilot/papilot

# WinGet
winget install PapilotAI.Papilot
```

### Choose WSL or native Windows

On first launch, the Windows desktop app lets you choose the backend environment (changeable anytime in **Settings → General → Environment** or the **Environment** app menu):

| Mode | Where Git, TeX and agents run | Data directory | Best when… |
| --- | --- | --- | --- |
| **WSL** *(recommended)* | Inside your chosen Linux distribution (WSL 2) | `~/.local/share/papilot-desktop/data` (inside WSL) | You prefer Linux TeX Live and Linux-native agent CLIs while keeping the native Windows app window |
| **Native Windows** | Directly on Windows | `%APPDATA%\Papilot` | Your LaTeX repos, TeX Live/MiKTeX and CLIs already live on Windows without WSL |

### WSL and native prerequisites

- **WSL mode**: install WSL (`wsl --install -d Ubuntu` in an administrator PowerShell), then install **Node.js 22.22+**, **npm**, **Git**, **TeX Live** (`latexmk` + `synctex`) and any agent CLI *inside that Linux distribution*. Select the distro in Papilot and click **Prepare WSL**. Keep papers inside the Linux filesystem (`\\wsl.localhost\<distro>\home`) for fast compilation.
- **Native Windows mode**: install [Git for Windows](https://git-scm.com/download/win) and **TeX Live for Windows** (includes Perl for `latexmk`), or **MiKTeX** with `latexmk` and Perl on `PATH`. Papilot automatically prioritizes TeX Live's bundled Perl during TeX Live builds so non-ASCII paths and BibTeX keep working.
- **PowerShell & advanced Windows details**: if `npm` scripts are blocked in PowerShell, run `npm.cmd`. Native Windows runs Claude in **Accept edits** mode without a command sandbox. See the full [Windows reference](../windows.md) for WorkBuddy ACP launchers and packaging details.

## Linux and Nix

### Debian and Ubuntu (signed APT)

Verify the signing key fingerprint (`880137ACF48D4E8CA78CE9857A85E7B6DD990D51`) and add the official amd64 repository at `https://papilot.ai/apt`:

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

Upgrade later with `sudo apt update && sudo apt install --only-upgrade papilot-desktop`. Maintainer details live in [docs/apt.md](../apt.md).

### Arch Linux (AUR)

Install the official x86_64 desktop package `papilot-bin` via an AUR helper or `makepkg`:

```sh
paru -S papilot-bin
```

Install a TeX distribution with `latexmk` and `synctex` on the host to compile papers. See [docs/aur.md](../aur.md) for details.

### Direct AppImage and .deb downloads

Download the Linux x64 `.deb` or `.AppImage` from [GitHub Releases](https://github.com/PapilotAI/papilot/releases/latest):

- **`.deb`**: `sudo apt install ./Papilot-{{release}}-linux-amd64.deb` (pulls Git automatically).
- **`.AppImage`**: `chmod +x Papilot-{{release}}-linux-x86_64.AppImage`. On systems without FUSE, launch with `APPIMAGE_EXTRACT_AND_RUN=1 ./Papilot-{{release}}-linux-x86_64.AppImage`.

### Nix flakes

Run Papilot reproducibly with bundled Node.js, Git and full TeX Live (first build downloads TeX Live):

```sh
nix run github:PapilotAI/papilot -- demo
```

On Linux, `.#papilot-desktop` also packages the Electron desktop launcher; agent CLIs remain configured on your host. Package-managed installs (APT, AUR, Nix) disable in-app updates and leave upgrades to your package manager. See [docs/nix.md](../nix.md).

## CLI, VS Code and source

- **CLI server (`npm`)**: run Papilot in your browser or on a remote workstation (requires **Node.js 22.22+**, Git and TeX):

```sh
npm install -g papilot
papilot demo   # copy the disposable 26-page example paper, then start
papilot        # start at http://127.0.0.1:7274
```

  See [CLI, Stats & Config](reference.md#cli-commands-and-background-service) for flags, data directories and macOS `launchd` service setup.
- **VS Code extension (`Papilot Workspace`)**: open and review Papilot papers directly inside VS Code alongside your editor tabs.
- **From source**: see [Development and internals](../development.md).
