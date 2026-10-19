<#
.SYNOPSIS
    生成 GitHub 仓库的社交预览图（分享链接时的封面 / og:image）。

.DESCRIPTION
    GitHub 的社交预览要求 2:1 比例，推荐 1280×640，文件不超过 1 MB。
    README 主视觉 hero.png 是 2400×840（2.86:1），直接上传会被拒。

    这里把 hero 等比缩到 1280×448 居中放在 1280×640 的画布上，
    画布底图用 hero 放大模糊后的版本，两侧与上下自然衔接，看不出接缝。

    产物：.github\social-preview.png

    注意：GitHub 没有开放社交预览的 REST 接口（api.github.com 上没有该端点，
    github.com 上的走 CSRF 表单，必须有浏览器会话），所以这张图需要手动上传：
      仓库 Settings → General → Social preview → Edit → Upload an image…

.EXAMPLE
    .\tools\build-social-preview.ps1
#>
[CmdletBinding()]
param(
    [string]$Hero = 'assets\readme\hero.png',
    [string]$Out = '.github\social-preview.png',
    [int]$Width = 1280,
    [int]$Height = 640
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$ff = @(
    (Get-Command ffmpeg -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    'D:\nvm\nodejs\ffmpeg.exe'
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $ff) { throw 'ffmpeg not found on PATH' }
if (-not (Test-Path $Hero)) { throw "hero not found: $Hero" }

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

# 主视觉等比缩到画布宽度（scale=宽:-2 保持比例，高度取偶数），居中叠在画布上；
# 底图是同一张图放大模糊后铺满，两侧与上下自然衔接，看不出接缝。
$filter = "[0:v]scale=${Width}:-2[s];[0:v]scale=${Width}:${Height},boxblur=28:2[bg];[bg][s]overlay=(W-w)/2:(H-h)/2"

& $ff -hide_banner -loglevel error -i $Hero -filter_complex $filter -frames:v 1 -y $Out
if (-not (Test-Path $Out)) { throw "ffmpeg produced no output for $Out" }

$size = [math]::Round((Get-Item $Out).Length / 1KB, 1)
Write-Host "social preview: $Out  ${Width}x${Height}  ${size} KB"
if ($size -gt 1024) { Write-Warning 'over 1 MB — GitHub will reject it' }
