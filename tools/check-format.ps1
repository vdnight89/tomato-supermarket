<#
.SYNOPSIS
    rustfmt check over every hand-written tracked Rust file.

.DESCRIPTION
    `cargo fmt --all -- --check` is deliberately not used: it does not reach the
    files this repository keeps outside the crate roots, and it would also try
    to reformat generated bridge code. This enumerates Git-tracked .rs files,
    skips the generated one, and checks each with skip_children so a module's
    formatting is judged on its own text.

.EXAMPLE
    .\tools\check-format.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$files = git ls-files '*.rs' | Where-Object { $_ -notmatch 'frb_generated\.rs$' }
Write-Host "checking $($files.Count) tracked .rs files"

$bad = @()
foreach ($file in $files) {
    & rustfmt --check --edition 2021 --config skip_children=true $file
    if ($LASTEXITCODE -ne 0) { $bad += $file }
}

if ($bad.Count -gt 0) {
    Write-Host ''
    Write-Host 'rustfmt differences in:' -ForegroundColor Red
    $bad | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    exit 1
}
Write-Host 'rustfmt: clean' -ForegroundColor Green
