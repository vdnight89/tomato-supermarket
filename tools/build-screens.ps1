<#
.SYNOPSIS
    把 assets\readme\screens\*.png 转成同名 .webp，供 README 正文引用。

.DESCRIPTION
    实机截图是 1600×900 的 PNG，单张 1 MB 上下，九张进仓库接近 4.3 MB。
    README 里实际只需要压缩过的 WebP（GitHub 原生支持），体积降到 600 KB 上下。

    PNG 保留为母版，hero-layout.svg 里的叠层小卡引用的就是 PNG。

.EXAMPLE
    .\tools\build-screens.ps1
#>
[CmdletBinding()]
param(
    [string]$Dir = 'assets\readme\screens',
    [int]$Quality = 84
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$ff = @(
    (Get-Command ffmpeg -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    'D:\nvm\nodejs\ffmpeg.exe'
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $ff) { throw 'ffmpeg not found on PATH' }

$before = 0
$after = 0
Get-ChildItem -LiteralPath $Dir -Filter '*.png' | ForEach-Object {
    $out = Join-Path $_.DirectoryName ($_.BaseName + '.webp')
    & $ff -hide_banner -loglevel error -i $_.FullName -quality $Quality -compression_level 6 -y $out
    if (-not (Test-Path $out)) { throw "ffmpeg produced no output for $($_.Name)" }
    $before += $_.Length
    $after += (Get-Item $out).Length
    Write-Host ("{0,-28} {1,8:N0} KB -> {2,7:N0} KB" -f $_.Name, ($_.Length / 1KB), ((Get-Item $out).Length / 1KB))
}
Write-Host ''
Write-Host ("screens: {0:N0} KB -> {1:N0} KB" -f ($before / 1KB), ($after / 1KB))
