param(
    [Parameter(Mandatory = $true)][string] $Helper,
    [Parameter(Mandatory = $true)][string] $FixtureRoot,
    [ValidateSet('success', 'digest', 'unconfirmed', 'parent')][string] $Scenario
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$folder = Join-Path $FixtureRoot 'updates\desktop'
$stage = New-Item -ItemType Directory -Path (Join-Path $folder 'installer') -Force
$handoff = New-Item -ItemType Directory -Path (Join-Path $folder 'windows-handoff-fixture')
$install = New-Item -ItemType Directory -Path (Join-Path $FixtureRoot 'Registered App')
$exe = Join-Path $install.FullName 'Papilot.exe'
$status = Join-Path $folder 'status.json'
$lock = Join-Path $folder 'install.lock'
$artifact = Join-Path $stage.FullName 'Papilot-0.14.1-win-x64.exe'
$script = Join-Path $handoff.FullName 'windows-update.ps1'
[IO.File]::WriteAllText($exe, 'registered executable')
[IO.File]::WriteAllText($artifact, 'installer fixture')
[IO.File]::WriteAllText($lock, '{"pid":123}')
[IO.File]::Copy($Helper, $script)
$file = Get-Item -LiteralPath $artifact
$sha = if ($Scenario -eq 'digest') { '0' * 64 } else { (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash }
@{ parent = 123; data = $FixtureRoot; executable = $exe; version = '0.14.1'; size = $file.Length; sha256 = $sha } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $handoff.FullName 'job.json') -Encoding UTF8
@{ pid = $(if ($Scenario -eq 'unconfirmed') { 123 } else { $PID }); phase = 'restarting'; latestVersion = '0.14.1';
    currentVersion = '0.10.4'; checkedAt = 0; error = $null; channel = 'stable' } |
    ConvertTo-Json | Set-Content -LiteralPath $status -Encoding UTF8

$fixture = @{ installed = '0.10.4'; executable = $exe; calls = [Collections.Generic.List[object]]::new() }

function Get-ItemProperty {
    [CmdletBinding()]
    param([string] $LiteralPath)
    if ($LiteralPath -ne 'HKCU:\Software\033e3166-a620-51ab-9617-2d7fd9838c85') { throw "Unexpected key $LiteralPath" }
    [pscustomobject] @{ InstallLocation = [IO.Path]::GetDirectoryName($fixture.executable) }
}

function Get-Item {
    [CmdletBinding()]
    param([string] $LiteralPath)
    if ($LiteralPath -eq $fixture.executable) {
        return [pscustomobject] @{ VersionInfo = [pscustomobject] @{ FileVersion = $fixture.installed }; Attributes = [IO.FileAttributes]::Normal }
    }
    Microsoft.PowerShell.Management\Get-Item @PSBoundParameters
}

function Get-Process {
    [CmdletBinding()]
    param([int] $Id, [string] $Name)
    if ($Id -eq 123 -and $Scenario -eq 'parent') {
        [pscustomobject] @{ Path = $fixture.executable } |
            Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($timeout) $false } -PassThru
    }
}

function Start-Process {
    [CmdletBinding()]
    param([string] $FilePath, [string] $ArgumentList, [switch] $PassThru, [switch] $Wait, [string] $WindowStyle,
        [string] $WorkingDirectory)
    if ($FilePath -ceq $fixture.executable) {
        $fixture.calls.Add(@{ kind = 'reopen'; workingDirectory = $WorkingDirectory })
    } else {
        if ($FilePath -cne $artifact) { throw "Unexpected installer $FilePath" }
        $fixture.calls.Add(@{ kind = 'installer'; arguments = $ArgumentList; wait = [bool] $Wait; hidden = $WindowStyle -eq 'Hidden' })
        $fixture.installed = '0.14.1'
        [pscustomobject] @{ ExitCode = 0 }
    }
}

& $script
[pscustomobject] @{
    calls = @($fixture.calls.ToArray())
    status = Get-Content -LiteralPath $status -Raw -Encoding UTF8 | ConvertFrom-Json
    lockExists = Test-Path -LiteralPath $lock
    artifactExists = Test-Path -LiteralPath $artifact
    handoffExists = Test-Path -LiteralPath $handoff.FullName
} | ConvertTo-Json -Depth 6 -Compress
