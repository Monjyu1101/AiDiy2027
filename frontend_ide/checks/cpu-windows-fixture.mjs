// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// PowerShellを実行するWindows専用試験のCOM境界。実カウンターは読み取らない。
export function mockCpuRefresher({ failure = false, time = 64, utility = 92 } = {}) {
  return String.raw`
$script:refreshCount = 0; $script:refresherCreates = 0
$script:cpuProperties = [PSCustomObject]@{}
$script:cpuProperties | Add-Member -MemberType ScriptMethod -Name Item -Value {
  param($name)
  $value = $null
  switch ($name) {
    'Name' { $value = '_Total' }
    'PercentProcessorTime' { if ($script:refreshCount -lt 2) { throw 'Unprimed time' }; $value = ` + time + String.raw` }
    'PercentProcessorUtility' { if ($script:refreshCount -lt 2) { throw 'Unprimed utility' }; $value = ` + utility + String.raw` }
  }
  return [PSCustomObject]@{ Value = $value }
}
$script:fakeCpuRows = [PSCustomObject]@{ ObjectSet = @([PSCustomObject]@{ Properties_ = $script:cpuProperties }) }
function New-Object {
  param([Parameter(Position=0)]$TypeName, $ComObject, [Parameter(Position=1)]$ArgumentList)
  if ($ComObject -eq 'WbemScripting.SWbemLocator') {
    $locator = [PSCustomObject]@{}
    $locator | Add-Member -MemberType ScriptMethod -Name ConnectServer -Value { param($server,$namespace); if ($server -ne '.' -or $namespace -ne 'root\cimv2') { throw 'Invalid target' }; return [PSCustomObject]@{} }
    return $locator
  }
  if ($ComObject -eq 'WbemScripting.SWbemRefresher') {
    $script:refresherCreates++
    $refresher = [PSCustomObject]@{}
    $refresher | Add-Member -MemberType ScriptMethod -Name AddEnum -Value { param($service,$class); if ($class -ne 'Win32_PerfFormattedData_Counters_ProcessorInformation') { throw 'Invalid CPU class' }; return $script:fakeCpuRows }
    $refresher | Add-Member -MemberType ScriptMethod -Name Refresh -Value { ` + (failure ? "throw 'CPU refresher unavailable'" : '$script:refreshCount++') + String.raw` }
    return $refresher
  }
  # 元のNew-ObjectはUTF8Encoding等の通常用途に使う。
  return Microsoft.PowerShell.Utility\New-Object -TypeName $TypeName -ArgumentList $ArgumentList
}
`;
}
