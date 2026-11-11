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
  if (!Number.isFinite(time) || time < 0 || time > 100) return null;
  // Utilityは周波数補正を含む別指標。大きい方の採用や倍率補正は行わない。
  return { time, utility: Number.isFinite(utility) && utility >= 0 ? utility : null };
}

// 追加のPowerShellプロセスは作らず、既存GPU照会と同じ起動で全CPUを取得する。
// GPUとCPUの失敗は独立。GPU未対応の休止期間にはCPUだけを照会できる。
export function windowsSystemMetricsCommand(gpuCommand = '', readCpu = true) {
  return String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$gpu = @()
try { $gpuJson = & {
` + gpuCommand + String.raw`
}
  $gpu = ConvertFrom-Json -InputObject ($gpuJson -join [Environment]::NewLine) -ErrorAction Stop
} catch { $gpu = @() }
$cpu = $null
` + (readCpu ? String.raw`
try {
  $cpu = Get-CimInstance -Namespace root/cimv2 -ClassName Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -Property Name,PercentProcessorTime,PercentProcessorUtility -OperationTimeoutSec 3 | Select-Object -First 1 Name,PercentProcessorTime,PercentProcessorUtility
} catch {}
` : '') + String.raw`
ConvertTo-Json -InputObject ([PSCustomObject]@{ cpu = $cpu; gpu = @($gpu) }) -Depth 4 -Compress
`;
}
