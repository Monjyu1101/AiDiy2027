# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# Computer Useを使えない環境で、実画面をOSのマウス・キーボード入力で操作する。
# 座標は 窓撮影.ps1 -Full の画像（物理ピクセル、表示倍率の影響なし）と同じ。
#   クリック:   .\実画面操作.ps1 -Click 960,540
#   文字入力:   .\実画面操作.ps1 -Type 'おはよう'        （クリップボード経由で貼り付け）
#   キー:       .\実画面操作.ps1 -Key '{ENTER}'          （SendKeys 形式。例 '^a' '{TAB}'）
#   前面化:     .\実画面操作.ps1 -Front 'Google Chrome'  （窓タイトルの一部）
param([int[]]$Click, [string]$Type, [string]$Key, [string]$Front, [int]$Wait = 300)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace AiDiyReal -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
'@
[AiDiyReal.Win]::SetProcessDPIAware() | Out-Null
if ($Front) {
  # タイトルの完全一致を優先し、なければ部分一致（例: Electron の「AiDiy Avatar」と Chrome の「AiDiy Avatar - Google Chrome」を区別）
  $p = Get-Process | Where-Object { $_.MainWindowTitle.Trim() -eq $Front } | Select-Object -First 1
  if (-not $p) { $p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$Front*" } | Select-Object -First 1 }
  if (-not $p) { Write-Output "窓が見つかりません: $Front"; exit 1 }
  # 最小化中だけ元に戻す（最大化している窓は最大化のまま前面へ）
  if ([AiDiyReal.Win]::IsIconic($p.MainWindowHandle)) { [AiDiyReal.Win]::ShowWindow($p.MainWindowHandle, 9) | Out-Null }
  [AiDiyReal.Win]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds $Wait; Write-Output "前面化: $($p.MainWindowTitle)"
}
if ($Click) {
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point $Click[0], $Click[1]
  Start-Sleep -Milliseconds 120
  [AiDiyReal.Win]::mouse_event(2, 0, 0, 0, 0); [AiDiyReal.Win]::mouse_event(4, 0, 0, 0, 0)
  Start-Sleep -Milliseconds $Wait; Write-Output "クリック: $($Click -join ',')"
}
if ($Type) {
  Set-Clipboard -Value $Type
  [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds $Wait
  Write-Output "入力: $($Type.Length)文字"
}
if ($Key) { [System.Windows.Forms.SendKeys]::SendWait($Key); Start-Sleep -Milliseconds $Wait; Write-Output "キー: $Key" }
