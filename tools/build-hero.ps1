<#
.SYNOPSIS
    把 hero-layout.svg 渲染成 README 发布的 hero.png。

.DESCRIPTION
    用无头 Chrome 把 SVG 栅格化到 2 倍尺寸（2400×840），GitHub 按 900px 宽显示时
    正好是 1:1 像素，文字与封面都不会被二次插值糊掉。

    无头 Chrome 用 file:// 加载，SVG 里的相对 <image> 需要 --allow-file-access-from-files
    才能读到同级目录的真实素材。

.EXAMPLE
    .\tools\build-hero.ps1
#>
[CmdletBinding()]
param(
    [string]$Svg = 'assets\readme\source\hero-layout.svg',
    [string]$Png = 'assets\readme\hero.png',
    [int]$Scale = 2
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$chrome = @(
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'no Chrome or Edge binary found' }

# Read the intrinsic size out of the SVG so the window matches the viewBox.
$svgText = Get-Content $Svg -Raw -Encoding UTF8
if ($svgText -notmatch 'viewBox="0 0 (\d+) (\d+)"') { throw 'cannot read viewBox' }
$w = [int]$Matches[1]; $h = [int]$Matches[2]

$profile = Join-Path $env:TEMP "fqpc-hero-$PID"
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$uri = ([uri]((Resolve-Path $Svg).Path)).AbsoluteUri
$out = Join-Path (Get-Location) $Png

$shot = "$env:TEMP\fqpc-hero-$PID.png"
& $chrome --headless=new --disable-gpu --hide-scrollbars `
    --allow-file-access-from-files `
    --force-device-scale-factor=$Scale `
    --default-background-color=00000000 `
    --window-size="$w,$h" `
    --screenshot="$shot" `
    --user-data-dir="$profile" `
    $uri 2>&1 | Out-Null

if (-not (Test-Path $shot)) { throw "chrome produced no screenshot" }
Copy-Item $shot $out -Force
Remove-Item $shot, $profile -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "rendered ${w}x${h} @${Scale}x -> $Png"
