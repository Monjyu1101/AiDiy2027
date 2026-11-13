# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# Computer Useを使えない環境で、Electron窓（hwnd指定）をWindows UI Automationで操作する。
#   一覧:   .\electron窓操作.ps1 -Hwnd <hwnd> -List
#   選択:   .\electron窓操作.ps1 -Hwnd <hwnd> -Radio 'Chat'
#   入力:   .\electron窓操作.ps1 -Hwnd <hwnd> -Text 'おはよう'
#   押下:   .\electron窓操作.ps1 -Hwnd <hwnd> -Button 'CODE'
#   文字:   .\electron窓操作.ps1 -Hwnd <hwnd> -Read
param([long]$Hwnd, [switch]$List, [string]$Radio = '', [string]$Text = '', [string]$Button = '', [switch]$Read)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]; $TS = [System.Windows.Automation.TreeScope]; $CT = [System.Windows.Automation.ControlType]
$win = $AE::FromHandle([IntPtr]$Hwnd)
function Find($type) { $win.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $type))) }
for ($i = 0; $i -lt 10; $i++) { if ((Find $CT::Button).Count -gt 0) { break }; Start-Sleep -Milliseconds 500 }
if ($List) {
  foreach ($t in @($CT::Button, $CT::RadioButton, $CT::Edit, $CT::ComboBox)) { foreach ($e in (Find $t)) { "{0} [{1}] enabled={2}" -f $t.ProgrammaticName, $e.Current.Name, $e.Current.IsEnabled } }
}
if ($Radio) {
  $r = (Find $CT::RadioButton) | Where-Object { $_.Current.Name -eq $Radio } | Select-Object -First 1
  if (-not $r) { Write-Output "ラジオが見つかりません: $Radio"; exit 2 }
  $r.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select(); Start-Sleep -Milliseconds 300
  Write-Output ("選択: $Radio selected=" + $r.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected)
}
if ($Text) {
  $e = (Find $CT::Edit) | Where-Object { $_.Current.IsEnabled -and $_.Current.IsKeyboardFocusable } | Select-Object -Last 1
  if (-not $e) { Write-Output '入力欄が見つかりません'; exit 3 }
  $e.SetFocus(); $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Text)
  Write-Output ("入力: [" + $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value + "]")
}
if ($Button) {
  $b = (Find $CT::Button) | Where-Object { $_.Current.Name -eq $Button } | Select-Object -First 1
  if (-not $b) { Write-Output "ボタンが見つかりません: $Button"; exit 4 }
  if (-not $b.Current.IsEnabled) { Write-Output "押せない状態です: $Button"; exit 5 }
  $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Write-Output "押しました: $Button"
}
if ($Read) {
  $seen = @{}
  foreach ($e in (Find $CT::Text)) { $n = $e.Current.Name; if ($n -and -not $seen.ContainsKey($n)) { $seen[$n] = 1; $n } }
}
