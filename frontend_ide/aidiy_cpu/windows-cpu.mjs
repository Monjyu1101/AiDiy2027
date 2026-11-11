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

// AvatarとIDEは同じWindows指標方針を使う。旧import先は互換のため維持する。
import windowsNativeCpu from './windows-native-cpu.cjs';
export const preferredWindowsCpuMetric = windowsNativeCpu.preferredWindowsCpuMetric;

// 診断で単発CIMが失敗しても更新器では取得できる環境を確認したため、
// CPUはSWbemRefresherを継続使用する。クラス/プロパティ名はOS言語に依存しない。
// 初回の空値を捨て、1秒以上離れた更新値だけを返す。照会要求がない間は更新しない。
export const windowsCpuSamplerCommand = String.raw`
$script:cpuRefresher = $null
$script:cpuRefreshable = $null
$script:cpuClock = $null
$script:cpuSample = $null
function Read-AidiyCpu {
  param([switch]$Fresh)
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
      if ($null -ne $script:cpuSample -and -not $Fresh) { return $script:cpuSample }
      while ($script:cpuClock.ElapsedMilliseconds -lt 1000) {
        [Threading.Thread]::Sleep([int][Math]::Max(1, 1000 - $script:cpuClock.ElapsedMilliseconds))
      }
    }
    $sampleIntervalMs = $script:cpuClock.ElapsedMilliseconds
    $script:cpuClock.Restart()
    [void]$script:cpuRefresher.Refresh()
    $row = @($script:cpuRefreshable.ObjectSet | Where-Object { $_.Properties_.Item('Name').Value -eq '_Total' }) | Select-Object -First 1
    if ($null -eq $row) { throw 'CPU total is unavailable' }
    $time = $null; $utility = $null
    try { $time = $row.Properties_.Item('PercentProcessorTime').Value } catch {}
    try { $utility = $row.Properties_.Item('PercentProcessorUtility').Value } catch {}
    $script:cpuSample = [PSCustomObject]@{ Name = '_Total'; PercentProcessorTime = $time; PercentProcessorUtility = $utility; SampleIntervalMs = $sampleIntervalMs }
    return $script:cpuSample
  } catch {
    $script:cpuRefresher = $null; $script:cpuRefreshable = $null; $script:cpuSample = $null
    throw
  }
}
`;

// CPU/GPUの失敗は独立。常駐プロセスでは更新器の定義・状態を起動時に1回だけ作る。
export function windowsSystemMetricsCommand(gpuCommand = '', readCpu = true, bootstrapCpu = true, freshCpu = false) {
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
` + (readCpu ? `try { $cpu = Read-AidiyCpu${freshCpu ? ' -Fresh' : ''} } catch {}\n` : '') + String.raw`
ConvertTo-Json -InputObject ([PSCustomObject]@{ cpu = $cpu; gpu = @($gpu) }) -Depth 4 -Compress
`;
}
