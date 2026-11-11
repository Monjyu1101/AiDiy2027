// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {windowsGpuCimCommand,windowsGpuCounterCommand,parseWindowsGpuUtilization} from '../aidiy_cpu/windows-gpu.mjs';
const execute=promisify(execFile);

test('Windowsの固定コマンドは3D限定、現地語ID照合、2番目の有効サンプルを使う',()=>{
 assert.match(windowsGpuCimCommand,/Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine/);
 assert.match(windowsGpuCimCommand,/-Filter "Name LIKE '%engtype_3D%'"/);
 assert.match(windowsGpuCounterCommand,/\\009/);assert.match(windowsGpuCounterCommand,/\\CurrentLanguage/);
 assert.match(windowsGpuCounterCommand,/\$names\[\[string\]\$english\[\$i\]\]/);
 assert.match(windowsGpuCounterCommand,/-MaxSamples 2 -ErrorAction SilentlyContinue/);
 assert.match(windowsGpuCounterCommand,/Select-Object -Last 1/);
 assert.match(windowsGpuCounterCommand,/\$_.Status -eq 0 -or \$_.Status -eq 1/);
 for(const command of [windowsGpuCimCommand,windowsGpuCounterCommand])assert.doesNotMatch(command,/Set-ItemProperty|Set-ExecutionPolicy|Start-Process/);
});

// Windowsで実行するとPowerShellそのものに固定スクリプトを解釈させる。
// OSカウンターはmockなのでGPU、管理者権限、現地語OSを必要としない。
const name='pid_1_luid_0x00000000_0x0000abcd_phys_0_eng_0_engtype_3D';
for(const localized of [false,true])test(`PowerShell実行: ${localized?'日本語':'英語'}PerflibをIDで照合し、最終標本だけ採用`,{skip:process.platform!=='win32'},async()=>{
 const expected=localized?'\\GPU エンジン(*engtype_3D)\\使用率':'\\GPU Engine(*engtype_3D)\\Utilization Percentage';
 const script=`
function Get-ItemProperty {
 param($LiteralPath,$Name)
 if ($LiteralPath.EndsWith('\\009')) { return @{ Counter = @('100','GPU Engine','200','Utilization Percentage') } }
 ${localized?"return @{ Counter = @('200','使用率','100','GPU エンジン') }":"throw 'Perflib localization unavailable'"}
}
function Get-Counter {
 param($Counter,$SampleInterval,$MaxSamples,$ErrorAction)
 if ($Counter -ne '${expected}' -or $SampleInterval -ne 1 -or $MaxSamples -ne 2 -or $ErrorAction -ne 'SilentlyContinue') { throw 'invalid counter arguments' }
 [PSCustomObject]@{ CounterSamples = @([PSCustomObject]@{InstanceName='${name}';CookedValue=80;Status=0}) }
 [PSCustomObject]@{ CounterSamples = @([PSCustomObject]@{InstanceName='${name}';CookedValue=12.5;Status=1},[PSCustomObject]@{InstanceName='${name}';CookedValue=90;Status=2147485649}) }
}
${windowsGpuCounterCommand}`;
 const {stdout}=await execute('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{timeout:10000,windowsHide:true,shell:false});
 assert.equal(parseWindowsGpuUtilization(stdout),12.5);
});

test('PowerShell実行: CIMの3D照会と単一オブジェクトのJSON配列化',{skip:process.platform!=='win32'},async()=>{
 const script=`
function Get-CimInstance {
 param($Namespace,$ClassName,$Filter,$Property,$OperationTimeoutSec)
 if($ClassName -ne 'Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine' -or $Filter -ne "Name LIKE '%engtype_3D%'") { throw 'invalid CIM arguments' }
 [PSCustomObject]@{ Name='${name}'; UtilizationPercentage=0 }
}
${windowsGpuCimCommand}`;
 const {stdout}=await execute('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{timeout:10000,windowsHide:true,shell:false});
 assert.ok(Array.isArray(JSON.parse(stdout.trim())));assert.equal(parseWindowsGpuUtilization(stdout),0);
});
