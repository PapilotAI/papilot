#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$job = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'job.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$folder = Join-Path $job.data 'updates\desktop'
$statusPath = Join-Path $folder 'status.json'
$artifact = Join-Path (Join-Path $folder 'installer') "Papilot-$($job.version)-win-x64.exe"
$installKey = 'HKCU:\Software\033e3166-a620-51ab-9617-2d7fd9838c85'
$lock = Join-Path $folder 'install.lock'
$log = Join-Path $folder 'installer.log'

function Read-UpdateStatus {
    Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Test-UpdateOwnership($status) {
    $status.pid -eq $PID -and $status.phase -eq 'restarting' -and $status.latestVersion -ceq $job.version
}

function Write-Log([string]$message) {
    ("{0:O} {1}" -f [DateTimeOffset]::Now, $message) | Add-Content -LiteralPath $log -Encoding UTF8 -ErrorAction SilentlyContinue
}

function Get-InstalledVersion {
    $location = (Get-ItemProperty -LiteralPath $installKey -ErrorAction SilentlyContinue).InstallLocation
    if ($location -notmatch '^[A-Za-z]:\\' -or $location -match '["\r\n]' -or
        [IO.Path]::GetFullPath((Join-Path $location 'Papilot.exe')) -ne [IO.Path]::GetFullPath($job.executable)) {
        throw 'The Papilot installation folder changed before the installer could run.'
    }
    $executable = Get-Item -LiteralPath $job.executable
    if ($executable.PSIsContainer -or $executable.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'The registered Papilot executable is invalid.'
    }
    $version = [version]$executable.VersionInfo.FileVersion
    [version]::new($version.Major, $version.Minor, $version.Build)
}

function Write-UpdateStatus($status, [bool]$succeeded, [string]$failure) {
    $status.checkedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($succeeded) {
        $status.phase = 'updated'
        $status.currentVersion = $job.version
        $status.error = $null
    } else {
        $status.phase = 'failed'
        $status.error = $failure
    }
    $temporary = "$statusPath.$PID.tmp"
    $backup = "$statusPath.$PID.old"
    try {
        [IO.File]::WriteAllText($temporary, ($status | ConvertTo-Json -Depth 6 -Compress), [Text.UTF8Encoding]::new($false))
        [IO.File]::Replace($temporary, $statusPath, $backup)
    } finally {
        Remove-Item -LiteralPath $temporary,$backup -Force -ErrorAction SilentlyContinue
    }
}

$parentExited = $false
$locked = $false
$succeeded = $false
$failure = $null
$mutex = $null

try {
    # Distinguish a reused PID from the desktop process that launched us.
    $parent = Get-Process -Id $job.parent -ErrorAction SilentlyContinue
    if ($parent -and (-not $parent.Path -or $parent.Path -eq $job.executable) -and -not $parent.WaitForExit(60000)) {
        throw 'Papilot did not close before the installer could run. Close it and retry the update.'
    }
    $parentExited = $true
    $status = Read-UpdateStatus
    if (-not (Test-UpdateOwnership $status)) {
        throw 'Papilot did not confirm the installer handoff.'
    }

    # Serialize Windows installer handoffs in this session.
    $mutex = [Threading.Mutex]::new($false, 'Local\Papilot.WindowsInstallerUpdate')
    try { $locked = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Another Papilot installer update is in progress.' }

    $target = [version]$job.version
    $installed = Get-InstalledVersion
    if ($installed -gt $target) { throw 'A newer Papilot version is already installed.' }
    if ($installed -lt $target) {
        $file = Get-Item -LiteralPath $artifact
        if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or
            $file.Length -ne $job.size -or (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash -ne $job.sha256) {
            throw 'The downloaded Papilot installer size or SHA-256 does not match the release.'
        }
        if (Get-Process -Name Papilot -ErrorAction SilentlyContinue) {
            throw 'Papilot was reopened before the installer could run. Close it and retry the update.'
        }
        Write-Log "Installing Papilot $target."
        # An in-place NSIS upgrade can take several minutes. Do not terminate
        # the installer during file replacement.
        $process = Start-Process -FilePath $artifact -ArgumentList '/S /currentuser' -PassThru -Wait -WindowStyle Hidden
        if ($process.ExitCode -ne 0) { throw "The Papilot installer exited with code $($process.ExitCode)." }
    }
    if ((Get-InstalledVersion) -ne $target) { throw "The installed Papilot executable did not report version $target." }
    $succeeded = $true
    Write-Log "Verified Papilot $target."
} catch {
    $failure = $_.Exception.Message
    Write-Log $failure
} finally {
    try {
        $status = Read-UpdateStatus
        if (Test-UpdateOwnership $status) {
            try { Write-UpdateStatus $status $succeeded $failure }
            finally {
                Remove-Item -LiteralPath $lock,$artifact -Force -ErrorAction SilentlyContinue
                if ($parentExited -and (Test-Path -LiteralPath $job.executable -PathType Leaf)) {
                    [Environment]::SetEnvironmentVariable('PSModulePath', $job.psModulePath)
                    Start-Process -FilePath $job.executable -WorkingDirectory ([IO.Path]::GetDirectoryName($job.executable))
                }
            }
        }
    } catch { Write-Log $_.Exception.Message }
    finally {
        if ($locked) { $mutex.ReleaseMutex() }
        if ($mutex) { $mutex.Dispose() }
        Set-Location -LiteralPath $folder
        Remove-Item -LiteralPath (Join-Path $PSScriptRoot 'job.json'),$PSCommandPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $PSScriptRoot -Force -ErrorAction SilentlyContinue
    }
}
