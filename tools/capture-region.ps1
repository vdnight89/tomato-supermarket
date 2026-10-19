<#
.SYNOPSIS
    截取屏幕上一块矩形区域并保存为 PNG。

.DESCRIPTION
    纯 .NET 实现，不做 P/Invoke —— 这台机器上内联 C# 编译不可靠。
    调用方先用窗口工具把应用窗口摆到已知位置，再把同样的矩形传进来。

.EXAMPLE
    .\tools\capture-region.ps1 -Left 479 -Top 226 -Width 1602 -Height 1089 -Output shots\a.png
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][int]$Left,
    [Parameter(Mandatory = $true)][int]$Top,
    [Parameter(Mandatory = $true)][int]$Width,
    [Parameter(Mandatory = $true)][int]$Height,
    [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$dir = Split-Path -Parent $Output
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$bmp = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($Left, $Top, 0, 0, (New-Object System.Drawing.Size($Width, $Height)))
$g.Dispose()
$bmp.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "captured ${Width}x${Height} at ($Left,$Top) -> $Output"
