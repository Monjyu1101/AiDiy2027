// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// Windowsは3Dに限定。同一GPU・物理エンジンのプロセス別値だけを合計する。
// 終了したプロセス等の不正な1行で、他の正常なカウンターまで捨てない。
export function parseWindowsGpuUtilization(stdout) {
  let rows;
  try { rows = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim()); } catch { return null; }
  if (!Array.isArray(rows)) rows = rows && typeof rows === 'object' ? [rows] : [];
  const engines = new Map();
  for (const row of rows) {
    const name = typeof row?.Name === 'string' ? row.Name : '';
    if (!/_engtype_3D(?:#\d+)?$/i.test(name)) continue;
    const engine = name.match(/(?:^|_)luid_(0x[0-9a-f]+_0x[0-9a-f]+)_phys_(\d+)_eng_(\d+)(?:_|$)/i);
    const raw = row?.UtilizationPercentage;
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    if (!engine || !Number.isFinite(value) || value < 0 || value > 100) continue;
    // PDHの有効値/新規値だけを採用する。CIMにはStatusを要求しない。
    if (row.Status !== undefined && row.Status !== 0 && row.Status !== 1) continue;
    const key = engine.slice(1).join('_').toLowerCase();
    engines.set(key, (engines.get(key) || 0) + value);
  }
  return engines.size ? Math.min(100, Math.max(...engines.values())) : null;
}

const preamble = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); ";
export const windowsGpuCimCommand = preamble + String.raw`
$rows = @(Get-CimInstance -Namespace root/cimv2 -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Filter "Name LIKE '%engtype_3D%'" -Property Name,UtilizationPercentage -OperationTimeoutSec 3 | Select-Object Name,UtilizationPercentage)
ConvertTo-Json -InputObject $rows -Compress
`;

// CIMのGPUクラスが使えないIntel等でも、PDHが提供されていれば計測する。
// Get-CounterのパスはOS言語依存。英語PerflibのIDを現地語名へ変換する。
// レジストリーは読込だけ。名前を取得できない場合は英語名のまま試す。
export const windowsGpuCounterCommand = preamble + String.raw`
$category = 'GPU Engine'
$counter = 'Utilization Percentage'
try {
  $base = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib'
  $english = (Get-ItemProperty -LiteralPath ($base + '\009') -Name Counter).Counter
  $localized = (Get-ItemProperty -LiteralPath ($base + '\CurrentLanguage') -Name Counter).Counter
  $names = @{}
  for ($i = 0; $i + 1 -lt $localized.Length; $i += 2) { $names[[string]$localized[$i]] = $localized[$i + 1] }
  for ($i = 0; $i + 1 -lt $english.Length; $i += 2) {
    $name = $names[[string]$english[$i]]
    if ($name) {
      if ($english[$i + 1] -eq 'GPU Engine') { $category = $name }
      if ($english[$i + 1] -eq 'Utilization Percentage') { $counter = $name }
    }
  }
} catch {}
$path = '\' + $category + '(*engtype_3D)\' + $counter
# 率カウンターを初期化してから2回目を採用。消滅したインスタンスのエラーは他へ波及させない。
$samples = @(Get-Counter -Counter $path -SampleInterval 1 -MaxSamples 2 -ErrorAction SilentlyContinue)
$rows = @($samples | Select-Object -Last 1 | ForEach-Object { $_.CounterSamples } | Where-Object { $_.Status -eq 0 -or $_.Status -eq 1 } | ForEach-Object {
  [PSCustomObject]@{ Name = $_.InstanceName; UtilizationPercentage = $_.CookedValue; Status = $_.Status }
})
ConvertTo-Json -InputObject $rows -Compress
`;
