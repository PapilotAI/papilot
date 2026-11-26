#Requires -Version 5.1
[CmdletBinding()]
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT' -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'This updater requires x64 Windows.'
}

function Get-PapilotInstallation {
    # The NSIS GUID is derived from appId ai.papilot.desktop in desktop/builder.cjs.
    $key = 'HKCU:\Software\033e3166-a620-51ab-9617-2d7fd9838c85'
    $directory = (Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue).InstallLocation
    if ($directory -notmatch '^[A-Za-z]:\\' -or $directory -match '["\r\n]') {
        throw 'No per-user Papilot installation was found. Install Papilot with its Windows x64 installer first.'
    }
    $executable = Get-Item -LiteralPath (Join-Path $directory 'Papilot.exe')
    $productVersion = $executable.VersionInfo.ProductVersion
    if ($productVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?$') {
        throw 'Could not read the installed Papilot version.'
    }
    $version = [version]$productVersion
    @{ Directory = $directory; Version = [version]::new($version.Major, $version.Minor, $version.Build) }
}

function Assert-PapilotClosed {
    if (Get-Process -Name Papilot -ErrorAction SilentlyContinue) {
        throw 'Close Papilot before installing an update.'
    }
}

$installation = Get-PapilotInstallation
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/PapilotAI/papilot/releases/latest' -UseBasicParsing -TimeoutSec 30
if ($release.tag_name -notmatch '^v([0-9]+\.[0-9]+\.[0-9]+)$' -or $release.prerelease -or $release.draft) {
    throw 'GitHub did not return a Papilot stable release.'
}
$latest = [version]$Matches[1]
if ($installation.Version -ge $latest) {
    Write-Output "Papilot $($installation.Version) is up to date (latest stable: $latest)."
    return
}

$name = "Papilot-$latest-win-x64.exe"
$url = "https://github.com/PapilotAI/papilot/releases/download/v$latest/$name"
$assets = @($release.assets | Where-Object { $_.name -ceq $name })
if ($assets.Count -ne 1 -or $assets[0].browser_download_url -cne $url -or
    $assets[0].digest -notmatch '^sha256:([0-9a-f]{64})$' -or $assets[0].size -le 0) {
    throw 'The release does not list a verifiable Windows x64 installer.'
}
$sha256 = $Matches[1]
if ($CheckOnly) {
    Write-Output "Papilot $($installation.Version) -> $latest (update available)."
    return
}

$mutex = [System.Threading.Mutex]::new($false, 'Local\Papilot.WindowsInstallerUpdate')
$locked = $false
$installer = $null
try {
    try {
        $locked = $mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
        $locked = $true
    }
    if (-not $locked) {
        throw 'Another Papilot installer update is in progress.'
    }

    $installation = Get-PapilotInstallation
    if ($installation.Version -ge $latest) {
        Write-Output "Papilot $($installation.Version) is up to date (latest stable: $latest)."
        return
    }
    Assert-PapilotClosed

    $installer = Join-Path ([System.IO.Path]::GetTempPath()) "papilot-$([guid]::NewGuid()).exe"
    Write-Host "Downloading the Papilot $latest installer..."
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing -TimeoutSec 600
    if ((Get-Item -LiteralPath $installer).Length -ne $assets[0].size -or
        (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $sha256) {
        throw 'The downloaded Papilot installer size or SHA-256 does not match the release.'
    }

    $beforeInstall = Get-PapilotInstallation
    if ($beforeInstall.Version -ge $latest) {
        Write-Output "Papilot $($beforeInstall.Version) is up to date (latest stable: $latest)."
        return
    }
    if ($beforeInstall.Directory -ne $installation.Directory) {
        throw 'The Papilot installation folder changed during download. Run the updater again.'
    }
    Assert-PapilotClosed
    # NSIS reads the per-user installation folder from the same registry key.
    Write-Host "Installing Papilot $latest in $($beforeInstall.Directory)..."
    $process = Start-Process -FilePath $installer -ArgumentList '/S /currentuser' -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -ne 0) {
        throw "The Papilot installer exited with code $($process.ExitCode)."
    }
    $installed = Get-PapilotInstallation
    if ($installed.Directory -ne $installation.Directory -or $installed.Version -ne $latest) {
        throw "The installer did not leave Papilot $latest in $($installation.Directory)."
    }
    Write-Output "Updated Papilot from $($beforeInstall.Version) to $($installed.Version)."
} finally {
    if ($installer) {
        Remove-Item -LiteralPath $installer -ErrorAction SilentlyContinue
    }
    if ($locked) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
