// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

const numeric = value => typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
export function parseWindowsCpuUtilization(row) {
  if (Array.isArray(row)) row = row.find(item => String(item?.Name).toLowerCase() === '_total');
  if (String(row?.Name).toLowerCase() !== '_total') return null;
  const time = numeric(row.PercentProcessorTime), utility = numeric(row.PercentProcessorUtility);
  const validTime = Number.isFinite(time) && time >= 0 && time <= 100 ? time : null;
  const validUtility = Number.isFinite(utility) && utility >= 0 ? utility : null;
  return validTime === null && validUtility === null ? null : { time: validTime, utility: validUtility };
}

// Windows 10/11 23H2以前のTask Managerは周波数補正を含むUtilityを使用する。
// 24H2以降はTimeを既定とする。更新の段階展開もあるため完全一致は保証しない。
// 不明なOSでは従来のTimeを維持し、大きい方の採用や倍率補正は行わない。
export function preferredWindowsCpuMetric(release) {
  const match = /^10\.0\.(\d+)(?:\.|$)/.exec(String(release));
  return match && Number(match[1]) >= 10240 && Number(match[1]) <= 22631 ? 'utility' : 'time';
}

// 診断で単発CIMが失敗しても更新器では取得できる環境を確認したため、
// CPUはSWbemRefresherを継続使用する。クラス/プロパティ名はOS言語に依存しない。
// 初回の空値を捨て、1秒以上離れた更新値だけを返す。照会要求がない間は更新しない。
export const windowsCpuSamplerCommand = String.raw`
$script:cpuRefresher = $null
$script:cpuRefreshable = $null
$script:cpuClock = $null
$script:cpuSample = $null
function Read-AidiyCpu {
  try {
    if ($null -eq $script:cpuRefresher) {
      $locator = New-Object -ComObject WbemScripting.SWbemLocator
      $service = $locator.ConnectServer('.', 'root\cimv2')
      $script:cpuRefresher = New-Object -ComObject WbemScripting.SWbemRefresher
      $script:cpuRefreshable = $script:cpuRefresher.AddEnum($service, 'Win32_PerfFormattedData_Counters_ProcessorInformation')
      [void]$script:cpuRefresher.Refresh()
      $script:cpuClock = [Diagnostics.Stopwatch]::StartNew()
      $script:cpuSample = $null
    }
    if ($script:cpuClock.ElapsedMilliseconds -lt 1000) {
      if ($null -ne $script:cpuSample) { return $script:cpuSample }
      [Threading.Thread]::Sleep([int][Math]::Max(0, 1000 - $script:cpuClock.ElapsedMilliseconds))
    }
    [void]$script:cpuRefresher.Refresh()
    $script:cpuClock.Restart()
    $row = @($script:cpuRefreshable.ObjectSet | Where-Object { $_.Properties_.Item('Name').Value -eq '_Total' }) | Select-Object -First 1
    if ($null -eq $row) { throw 'CPU total is unavailable' }
    $time = $null; $utility = $null
    try { $time = $row.Properties_.Item('PercentProcessorTime').Value } catch {}
    try { $utility = $row.Properties_.Item('PercentProcessorUtility').Value } catch {}
    $script:cpuSample = [PSCustomObject]@{ Name = '_Total'; PercentProcessorTime = $time; PercentProcessorUtility = $utility }
    return $script:cpuSample
  } catch {
    $script:cpuRefresher = $null; $script:cpuRefreshable = $null; $script:cpuSample = $null
    throw
  }
}
`;

// CPU/GPUの失敗は独立。常駐プロセスでは更新器の定義・状態を起動時に1回だけ作る。
export function windowsSystemMetricsCommand(gpuCommand = '', readCpu = true, bootstrapCpu = true) {
  return String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
` + (readCpu && bootstrapCpu ? windowsCpuSamplerCommand : '') + String.raw`
$gpu = @()
try { $gpuJson = & {
` + gpuCommand + String.raw`
}
  $gpu = ConvertFrom-Json -InputObject ($gpuJson -join [Environment]::NewLine) -ErrorAction Stop
} catch { $gpu = @() }
$cpu = $null
` + (readCpu ? 'try { $cpu = Read-AidiyCpu } catch {}\n' : '') + String.raw`
ConvertTo-Json -InputObject ([PSCustomObject]@{ cpu = $cpu; gpu = @($gpu) }) -Depth 4 -Compress
`;
}
