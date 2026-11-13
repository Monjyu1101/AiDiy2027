# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# Electron窓（既定はaidiy_diag）のボタンをWindows UI Automationで一覧・押下する。
# Computer Useを使えない環境で、Diagの「設定起動」「ミニ表示」等を実画面のボタンとして押すために使う。
#   一覧: .\diag画面操作.ps1 -List
#   押下: .\diag画面操作.ps1 -Button '設定起動'
param([string]$Button = '', [switch]$List, [string]$Title = 'AiDiy 診断')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$proc = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle.Trim() -eq $Title } | Select-Object -First 1
if (-not $proc) { Write-Output "窓が見つかりません: $Title"; exit 1 }
$win = $AE::FromHandle($proc.MainWindowHandle)
# Chromiumは支援技術を検出してからツリーを作るため、ボタンが出るまで少し待つ。
$cond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
for ($i = 0; $i -lt 10; $i++) { $buttons = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond); if ($buttons.Count -gt 3) { break }; Start-Sleep -Milliseconds 500 }
if ($List) { foreach ($b in $buttons) { Write-Output ("[{0}] enabled={1}" -f $b.Current.Name, $b.Current.IsEnabled) }; exit 0 }
foreach ($b in $buttons) {
  if ($b.Current.Name -eq $Button) {
    if (-not $b.Current.IsEnabled) { Write-Output "押せない状態です: $Button"; exit 3 }
    # タブ等でInvokeに対応しない場合は選択操作、それも無い場合はボタン中央を実クリックする。
    $p = $null
    if ($b.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); Write-Output "押しました: $Button"; exit 0 }
    if ($b.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); Write-Output "選択しました: $Button"; exit 0 }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -Namespace AiDiy -Name Mouse -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
    [AiDiy.Mouse]::SetProcessDPIAware() | Out-Null
    $r = $b.Current.BoundingRectangle
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point ([int]($r.X + $r.Width / 2)), ([int]($r.Y + $r.Height / 2))
    [AiDiy.Mouse]::mouse_event(2, 0, 0, 0, 0); [AiDiy.Mouse]::mouse_event(4, 0, 0, 0, 0)
    Write-Output "クリックしました: $Button"; exit 0
  }
}
Write-Output "ボタンが見つかりません: $Button"; exit 2
