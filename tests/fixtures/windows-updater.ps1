param(
    [Parameter(Mandatory = $true)][string] $Updater,
    [Parameter(Mandatory = $true)][string] $FixtureRoot
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$configuration = $env:PAPILOT_UPDATER_FIXTURE | ConvertFrom-Json
$installDirectory = Join-Path $FixtureRoot 'Papilot with spaces'
$installKey = 'HKCU:\Software\033e3166-a620-51ab-9617-2d7fd9838c85'
$releaseTag = 'v0.14.1'
$assetName = 'Papilot-0.14.1-win-x64.exe'
$assetUrl = "https://github.com/PapilotAI/papilot/releases/download/$releaseTag/$assetName"
$installerBytes = [Text.Encoding]::UTF8.GetBytes('Papilot installer fixture')
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $digest = [BitConverter]::ToString($sha.ComputeHash($installerBytes)).Replace('-', '').ToLowerInvariant()
} finally {
    $sha.Dispose()
}
$windowsUpdaterFixture = @{
    configuration = $configuration
    installKey = $installKey
    installDirectory = $installDirectory
    movedInstallDirectory = Join-Path $FixtureRoot 'Moved Papilot'
    releaseTag = $releaseTag
    assetName = $assetName
    assetUrl = $assetUrl
    installerBytes = $installerBytes
    digest = $digest
    version = [version] $configuration.installedVersion
    events = [Collections.Generic.List[object]]::new()
    processChecks = 0
    downloadPath = $null
}

function Get-ItemProperty {
    [CmdletBinding()]
    param([string] $LiteralPath)
    if ($LiteralPath -ne $windowsUpdaterFixture.installKey) { throw "Unexpected registry key $LiteralPath" }
    [pscustomobject] @{ InstallLocation = $windowsUpdaterFixture.installDirectory }
}

function Get-Item {
    [CmdletBinding()]
    param([string] $LiteralPath)
    if ($LiteralPath -eq (Join-Path $windowsUpdaterFixture.installDirectory 'Papilot.exe')) {
        return [pscustomobject] @{ VersionInfo = [pscustomobject] @{ ProductVersion = $windowsUpdaterFixture.version.ToString() } }
    }
    Microsoft.PowerShell.Management\Get-Item @PSBoundParameters
}

function Invoke-RestMethod {
    [CmdletBinding()]
    param([string] $Uri, [int] $TimeoutSec, [switch] $UseBasicParsing)
    $windowsUpdaterFixture.events.Add(@{ kind = 'release'; uri = $Uri })
    if ($windowsUpdaterFixture.configuration.updateDuringRelease) {
        $windowsUpdaterFixture.version = [version] '0.14.2.0'
    }
    $assetDigest = if ($windowsUpdaterFixture.configuration.invalidDigest) { '0' * 64 } else { $windowsUpdaterFixture.digest }
    [pscustomobject] @{
        tag_name = $windowsUpdaterFixture.releaseTag
        prerelease = $false
        draft = $false
        assets = @(
            [pscustomobject] @{ name = 'Papilot-0.14.1-win-x64-portable.exe'; browser_download_url = $windowsUpdaterFixture.assetUrl.Replace('.exe', '-portable.exe') },
            [pscustomobject] @{
                name = $windowsUpdaterFixture.assetName
                browser_download_url = $windowsUpdaterFixture.assetUrl
                digest = "sha256:$assetDigest"
                size = $windowsUpdaterFixture.installerBytes.Length
            }
        )
    }
}

function Invoke-WebRequest {
    [CmdletBinding()]
    param([string] $Uri, [string] $OutFile, [switch] $UseBasicParsing, [int] $TimeoutSec)
    $windowsUpdaterFixture.events.Add(@{ kind = 'download'; uri = $Uri; basicParsing = [bool] $UseBasicParsing })
    $windowsUpdaterFixture.downloadPath = $OutFile
    [IO.File]::WriteAllBytes($OutFile, $windowsUpdaterFixture.installerBytes)
    if ($windowsUpdaterFixture.configuration.updateDuringDownload) {
        $windowsUpdaterFixture.version = [version] '0.14.2.0'
    }
    if ($windowsUpdaterFixture.configuration.moveDuringDownload) {
        $windowsUpdaterFixture.installDirectory = $windowsUpdaterFixture.movedInstallDirectory
    }
}

function Get-Process {
    [CmdletBinding()]
    param([string] $Name)
    if ($Name -ne 'Papilot') { throw "Unexpected process name $Name" }
    $windowsUpdaterFixture.processChecks++
    if ($windowsUpdaterFixture.configuration.running -or ($windowsUpdaterFixture.configuration.startDuringDownload -and $windowsUpdaterFixture.downloadPath)) {
        [pscustomobject] @{ Name = $Name }
    }
}

function Start-Process {
    [CmdletBinding()]
    param([string] $FilePath, [string[]] $ArgumentList, [switch] $PassThru, [switch] $Wait, [string] $WindowStyle)
    $windowsUpdaterFixture.events.Add(@{
        kind = 'install'
        path = $FilePath
        arguments = $ArgumentList
        downloaded = $FilePath -eq $windowsUpdaterFixture.downloadPath -and [IO.File]::Exists($FilePath)
        passThru = [bool] $PassThru
        wait = [bool] $Wait
        windowStyle = $WindowStyle
    })
    if (-not $windowsUpdaterFixture.configuration.installerExitCode -and -not $windowsUpdaterFixture.configuration.leaveInstalledVersion) {
        $windowsUpdaterFixture.version = [version] '0.14.1.0'
    }
    [pscustomobject] @{ ExitCode = [int] $windowsUpdaterFixture.configuration.installerExitCode }
}

$failure = $null
$output = @()
$global:LASTEXITCODE = 0
try {
    $output = @(& $Updater -CheckOnly:([bool] $configuration.checkOnly) 6>&1 | ForEach-Object ToString)
    if ($LASTEXITCODE) { $failure = "Updater exited with code $LASTEXITCODE" }
} catch {
    $failure = $_.Exception.Message
}

[pscustomobject] @{
    error = $failure
    output = @($output)
    events = @($windowsUpdaterFixture.events.ToArray())
    processChecks = $windowsUpdaterFixture.processChecks
    registeredDirectory = $windowsUpdaterFixture.installDirectory
    installedVersion = $windowsUpdaterFixture.version.ToString()
    downloadRemains = [bool] ($windowsUpdaterFixture.downloadPath -and [IO.File]::Exists($windowsUpdaterFixture.downloadPath))
} | ConvertTo-Json -Depth 5 -Compress
