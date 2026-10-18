<#
.SYNOPSIS
    Builds the single-file Windows release and stages it in dist/.

.DESCRIPTION
    Produces dist\fqpc.exe plus a SHA256SUMS manifest next to it, so a copied
    folder is the whole deliverable. The Web UI and the default configuration
    are compiled into the executable, so nothing else needs to ship.

.PARAMETER Offline
    Pass --offline to cargo. The full dependency set is already in the local
    registry cache, which is what keeps this build working without network.

.EXAMPLE
    .\tools\build.ps1
    .\tools\build.ps1 -Offline
#>
[CmdletBinding()]
param([switch]$Offline)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host '==> building release' -ForegroundColor Cyan
$args = @('build', '--release', '-p', 'fqpc')
if ($Offline) { $args += '--offline' }
& cargo @args
if ($LASTEXITCODE -ne 0) { throw "cargo build failed with exit code $LASTEXITCODE" }

$exe = Join-Path (Get-Location) 'target\release\fqpc.exe'
if (-not (Test-Path $exe)) { throw "expected $exe to exist after a successful build" }

$dist = Join-Path (Get-Location) 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$staged = Join-Path $dist 'fqpc.exe'
Copy-Item $exe $staged -Force

$hash = (Get-FileHash $staged -Algorithm SHA256).Hash.ToLowerInvariant()
$lines = @("$hash  fqpc.exe")
[System.IO.File]::WriteAllLines((Join-Path $dist 'SHA256SUMS'), $lines, (New-Object System.Text.UTF8Encoding($false)))

$size = [math]::Round((Get-Item $staged).Length / 1MB, 2)
Write-Host ''
Write-Host "==> dist\fqpc.exe  $size MB" -ForegroundColor Green
Write-Host "    sha256 $hash"
Write-Host ''
Write-Host 'Copy that one file anywhere and run it.' -ForegroundColor Green
