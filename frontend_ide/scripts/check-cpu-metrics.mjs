// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 読み取り専用のCPU比較。表示式・設定・レジストリーを変更せず、結果だけをtempへ保存する。
import * as os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createSystemMetrics} from '../aidiy_cpu/metrics.mjs';
const execute=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));

// PDHは1つの継続クエリーでTime/Utilityを同時採取し、最初の標本を捨てる。
// SWbemRefresherも同じ時点で更新し、fresh-processの単発CIMとは別に記録する。
export const windowsCpuReferenceCommand=String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$errors=@()
function Cpu-Row($row,[bool]$com=$false) {
  if($null -eq $row){return $null}
  if($com){
    $t=$row.Properties_.Item('PercentProcessorTime').Value;$u=$null;$stamp=$null
    try{$u=$row.Properties_.Item('PercentProcessorUtility').Value}catch{}
    try{$stamp=[string]$row.Properties_.Item('Timestamp_Sys100NS').Value}catch{}
    return [PSCustomObject]@{time=$t;utility=$u;timestampSys100Ns=$stamp}
  }
  [PSCustomObject]@{time=$row.PercentProcessorTime;utility=$row.PercentProcessorUtility;timestampSys100Ns=[string]$row.Timestamp_Sys100NS}
}
$single=$null
try { $single=Cpu-Row (Get-CimInstance -Namespace root/cimv2 -ClassName Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -OperationTimeoutSec 3 | Select-Object -First 1) }
catch { $errors+=('cim:'+ $_.Exception.HResult) }
$refresher=$null;$refreshable=$null
try {
  $locator=New-Object -ComObject WbemScripting.SWbemLocator
  $service=$locator.ConnectServer('.', 'root\cimv2')
  $refresher=New-Object -ComObject WbemScripting.SWbemRefresher
  $refreshable=$refresher.AddEnum($service,'Win32_PerfFormattedData_Counters_ProcessorInformation')
  [void]$refresher.Refresh()
} catch { $errors+=('refresher:'+ $_.Exception.HResult);$refresher=$null }
$category='Processor Information';$time='% Processor Time';$utility='% Processor Utility'
try {
  $base='HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib'
  $english=(Get-ItemProperty -LiteralPath ($base+'\009') -Name Counter).Counter
  $localized=(Get-ItemProperty -LiteralPath ($base+'\CurrentLanguage') -Name Counter).Counter
  $names=@{}
  for($i=0;$i+1 -lt $localized.Length;$i+=2){$names[[string]$localized[$i]]=$localized[$i+1]}
  for($i=0;$i+1 -lt $english.Length;$i+=2){
    $name=$names[[string]$english[$i]]
    if($name){
      if($english[$i+1] -eq 'Processor Information'){$category=$name}
      if($english[$i+1] -eq '% Processor Time'){$time=$name}
      if($english[$i+1] -eq '% Processor Utility'){$utility=$name}
    }
  }
} catch { $errors+=('perflib:'+ $_.Exception.HResult) }
$timePath='\'+$category+'(_Total)\'+$time
$utilityPath='\'+$category+'(_Total)\'+$utility
$counterErrors=@()
$samples=@(Get-Counter -Counter @($timePath,$utilityPath) -SampleInterval 1 -MaxSamples 9 -ErrorAction SilentlyContinue -ErrorVariable +counterErrors | ForEach-Object {
  $set=$_;$warm=$null
  if($refresher){try{[void]$refresher.Refresh();$warm=Cpu-Row (@($refreshable.ObjectSet | Where-Object {$_.Properties_.Item('Name').Value -eq '_Total'})[0]) $true}catch{}}
  $t=$null;$u=$null;$statuses=@()
  foreach($c in $set.CounterSamples){
    $statuses+=$c.Status
    if($c.Status -ne 0 -and $c.Status -ne 1){continue}
    if($c.Path.EndsWith('\'+$time,[StringComparison]::OrdinalIgnoreCase)){$t=$c.CookedValue}
    if($c.Path.EndsWith('\'+$utility,[StringComparison]::OrdinalIgnoreCase)){$u=$c.CookedValue}
  }
  [PSCustomObject]@{timestamp=$set.Timestamp.ToUniversalTime().ToString('o');time=$t;utility=$u;refresher=$warm;statuses=@($statuses)}
} | Select-Object -Skip 1)
$build=$null
try{$v=Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion';$build=[PSCustomObject]@{build=$v.CurrentBuildNumber;revision=$v.UBR;displayVersion=$v.DisplayVersion}}catch{}
ConvertTo-Json -InputObject ([PSCustomObject]@{singleCim=$single;samples=@($samples);errors=@($errors);counterErrors=@($counterErrors | ForEach-Object {$_.FullyQualifiedErrorId} | Select-Object -Unique);windows=$build;powershell=$PSVersionTable.PSVersion.ToString()}) -Depth 6 -Compress
`;

export function localMetricsUrl(value){
 if(value===undefined)return null;
 const url=new URL(value);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('--url は http://127.0.0.1:ポート/ の形式にしてください。');
 return new URL('/api/system-metrics',url).href;
}
export function selectSample(data){
 if(!data||typeof data!=='object'||!Number.isFinite(data.timestamp))return{error:'invalid-metrics-response'};
 const keys=['osTimes','windowsProcessorTime','windowsProcessorUtility','logicalCpuCount','sampleIntervalMs','windowsSampleAgeMs','platform','osRelease','nodeVersion','libuvVersion'];
 return{timestamp:data.timestamp,cpu:data.cpu??null,cpuSource:data.cpuSource??'missing-in-response',details:Object.fromEntries(keys.map(key=>[key,data.cpuDetails?.[key]??null]))};
}
export async function collectCpuDiagnostics({url,platform=process.platform,system=os,run=execute,makeMetrics=createSystemMetrics,fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}){
 const endpoint=localMetricsUrl(url);
 const report={schema:1,startedAt:new Date(now()).toISOString(),mode:endpoint?'existing-local-server':'new-local-sampler',platform,nodeVersion:process.versions.node,libuvVersion:process.versions.uv,osRelease:system.release(),logicalCpuCount:system.cpus().length,cpuModel:system.cpus()[0]?.model??null,samples:[],reference:null};
 const reference=platform==='win32'?run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',windowsCpuReferenceCommand],{timeout:25000,maxBuffer:512*1024,windowsHide:true,shell:false}).then(({stdout})=>{try{return JSON.parse(String(stdout).replace(/^\uFEFF/,'').trim());}catch{return{error:'invalid-reference-json'};}}).catch(error=>({error:'reference-command-failed',code:error.code??null,killed:!!error.killed,stderr:String(error.stderr??'').slice(0,4000)})):Promise.resolve({error:'windows-reference-not-run'});
 const metrics=endpoint?null:makeMetrics();
 try{
  for(let i=0;i<12;i++){
    await sleep(1000);
    try{
      let data;
      if(endpoint){const response=await fetcher(endpoint,{signal:AbortSignal.timeout(3000),redirect:'error'});if(!response.ok)throw Error('HTTP '+response.status);data=await response.json();}
      else data=await metrics.sample();
      report.samples.push(selectSample(data));
    }catch{report.samples.push({timestamp:now(),error:'sample-unavailable'});}
  }
 }finally{metrics?.close();}
 report.reference=await reference;
 report.finishedAt=new Date(now()).toISOString();
 return report;
}

async function main(args){
 if(args.includes('--help')){console.log('node frontend_ide/scripts/check-cpu-metrics.mjs [--url http://127.0.0.1:ポート/]\n約15秒の読み取り専用診断。既定では現在のソースを別に計測し、--url 指定時だけ起動中の画面サーバーを読みます。結果は frontend_ide/temp/cpu-diagnostics/ へ保存します。設定変更・負荷試験・外部送信は行いません。');return;}
 if(args.length!==0&&!(args.length===2&&args[0]==='--url'))throw Error('--help で使い方を確認してください。');
 localMetricsUrl(args[1]);
 console.log('CPUを約15秒比較します。通常の作業を続けてください。設定変更や外部送信は行いません。');
 const report=await collectCpuDiagnostics({url:args[1]});
 const hash=createHash('sha256');for(const file of ['aidiy_cpu/metrics.mjs','aidiy_cpu/windows-cpu.mjs'])hash.update(await readFile(resolve(root,file)));
 report.collectorSha256=hash.digest('hex');
 const output=resolve(root,'temp/cpu-diagnostics',report.startedAt.replace(/[:.]/g,'-')+'.json');
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n','utf8');
 console.log('診断結果: '+output);
 if(report.mode==='new-local-sampler')console.log('現在のソースを別に計測した結果です。既存の画面が同じ版で動作しているとは限りません。');
 console.log('CPU TimeとUtilityは別の指標です。この診断だけで大きい方を正しい値とは判定しません。');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
