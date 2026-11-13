# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# 指定プロセス（既定はAvatarのElectron）が持つトップレベル窓を、名前・位置・大きさ付きで一覧する。
#   .\electron窓一覧.ps1 -ProcessId <PID>
param([int]$ProcessId = 0)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
if (-not $ProcessId) {
  $p = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -match 'frontend_avatar' -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
  if (-not $p) { Write-Output 'Avatarのプロセスが見つかりません'; exit 1 }
  $ProcessId = $p.ProcessId
}
$cond = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $ProcessId)
$wins = $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
foreach ($w in $wins) { $r = $w.Current.BoundingRectangle; "[{0}] {1}x{2} @({3},{4}) hwnd={5}" -f $w.Current.Name, [int]$r.Width, [int]$r.Height, [int]$r.X, [int]$r.Y, $w.Current.NativeWindowHandle }
