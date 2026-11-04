# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# 指定した窓（タイトル一致のElectron窓）または画面全体を、実画面から撮影する。既存画像は上書きしない。
#   .\窓撮影.ps1 -Title 'AiDiy 診断' -Out <保存先.png>
#   .\窓撮影.ps1 -Full -Out <保存先.png>
param([string]$Title = 'AiDiy 診断', [Parameter(Mandatory)][string]$Out, [switch]$Full)
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public class AiDiyWin32 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  public struct RECT { public int L, T, R, B; }
}
"@
[AiDiyWin32]::SetProcessDPIAware() | Out-Null
if (Test-Path $Out) { Write-Output "既存画像を上書きしません: $Out"; exit 2 }
if ($Full) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $x = $b.X; $y = $b.Y; $w = $b.Width; $h = $b.Height
} else {
  $proc = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle.Trim() -eq $Title } | Select-Object -First 1
  if (-not $proc) { Write-Output "窓が見つかりません: $Title"; exit 1 }
  [AiDiyWin32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 400
  $r = New-Object AiDiyWin32+RECT
  [AiDiyWin32]::DwmGetWindowAttribute($proc.MainWindowHandle, 9, [ref]$r, 16) | Out-Null
  $x = $r.L; $y = $r.T; $w = $r.R - $r.L; $h = $r.B - $r.T
}
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))
$dir = Split-Path $Out; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
Write-Output "保存しました ${w}x${h} ($x,$y): $Out"
