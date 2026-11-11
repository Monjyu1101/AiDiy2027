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
import {collectRuntimeComparison} from './cpu-runtime-probe.mjs';
import {discoverCpuServers} from './cpu-server-discovery.mjs';
const execute=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));

// PDHは1つの継続クエリーでTime/Utility/Idleを同時採取し、最初の標本を捨てる。
// SWbemRefresherも同じ時点で更新し、fresh-processの単発CIMとは別に記録する。
export const windowsCpuReferenceCommand=String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$errors=@()
function Cpu-Row($row,[bool]$com=$false) {
  if($null -eq $row){return $null}
  if($com){
    $t=$row.Properties_.Item('PercentProcessorTime').Value;$u=$null;$idle=$null;$stamp=$null
    try{$u=$row.Properties_.Item('PercentProcessorUtility').Value}catch{}
    try{$idle=$row.Properties_.Item('PercentIdleTime').Value}catch{}
    try{$stamp=[string]$row.Properties_.Item('Timestamp_Sys100NS').Value}catch{}
    return [PSCustomObject]@{time=$t;utility=$u;idle=$idle;timestampSys100Ns=$stamp}
  }
  [PSCustomObject]@{time=$row.PercentProcessorTime;utility=$row.PercentProcessorUtility;idle=$row.PercentIdleTime;timestampSys100Ns=[string]$row.Timestamp_Sys100NS}
}
$refresher=$null;$refreshable=$null
try {
  $locator=New-Object -ComObject WbemScripting.SWbemLocator
  $service=$locator.ConnectServer('.', 'root\cimv2')
  $refresher=New-Object -ComObject WbemScripting.SWbemRefresher
  $refreshable=$refresher.AddEnum($service,'Win32_PerfFormattedData_Counters_ProcessorInformation')
  [void]$refresher.Refresh()
} catch { $errors+=('refresher:'+ $_.Exception.HResult);$refresher=$null }
$category='Processor Information';$time='% Processor Time';$utility='% Processor Utility';$idle='% Idle Time'
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
      if($english[$i+1] -eq '% Idle Time'){$idle=$name}
    }
  }
} catch { $errors+=('perflib:'+ $_.Exception.HResult) }
$timePath='\'+$category+'(_Total)\'+$time
$utilityPath='\'+$category+'(_Total)\'+$utility
$idlePath='\'+$category+'(_Total)\'+$idle
$counterErrors=@()
$samples=@(Get-Counter -Counter @($timePath,$utilityPath,$idlePath) -SampleInterval 1 -MaxSamples 9 -ErrorAction SilentlyContinue -ErrorVariable +counterErrors | ForEach-Object {
  $set=$_;$warm=$null
  if($refresher){try{[void]$refresher.Refresh();$warm=Cpu-Row (@($refreshable.ObjectSet | Where-Object {$_.Properties_.Item('Name').Value -eq '_Total'})[0]) $true}catch{}}
  $t=$null;$u=$null;$i=$null;$statuses=@()
  foreach($c in $set.CounterSamples){
    $statuses+=$c.Status
    if($c.Status -ne 0 -and $c.Status -ne 1){continue}
    if($c.Path.EndsWith('\'+$time,[StringComparison]::OrdinalIgnoreCase)){$t=$c.CookedValue}
    if($c.Path.EndsWith('\'+$utility,[StringComparison]::OrdinalIgnoreCase)){$u=$c.CookedValue}
    if($c.Path.EndsWith('\'+$idle,[StringComparison]::OrdinalIgnoreCase)){$i=$c.CookedValue}
  }
  [PSCustomObject]@{timestamp=$set.Timestamp.ToUniversalTime().ToString('o');time=$t;utility=$u;idle=$i;refresher=$warm;statuses=@($statuses)}
} | Select-Object -Skip 1)
$single=$null
try { $single=Cpu-Row (Get-CimInstance -Namespace root/cimv2 -ClassName Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -OperationTimeoutSec 3 | Select-Object -First 1) }
catch { $errors+=('cim:'+ $_.Exception.HResult) }
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
 const keys=['osTimes','rawIdleDeltaMs','rawTotalDeltaMs','rawBusyDeltaMs','windowsProcessorTime','windowsProcessorUtility','windowsProcessorIdle','windowsTimestampSys100Ns','windowsSequence','logicalCpuCount','sampleIntervalMs','cpuSampleAgeMs','cpuStatus','windowsSampleAgeMs','windowsSampleIntervalMs','windowsPreferredMetric','windowsCpuStatus','platform','osRelease','nodeVersion','libuvVersion','systemInformation','cpuError'];
 const runtime=data.cpuDetails?.runtime;
 const safeRuntime=runtime&&typeof runtime==='object'?Object.fromEntries(['collectorId','pid','startedAt','executable','sourceFile','node','uv','electron','arch','systeminformation'].map(key=>[key,['pid','startedAt'].includes(key)?(Number.isFinite(runtime[key])?runtime[key]:null):(typeof runtime[key]==='string'?runtime[key].slice(0,4096):null)])):null;
 return{timestamp:data.timestamp,cpu:data.cpu??null,cpuSource:data.cpuSource??'missing-in-response',details:{...Object.fromEntries(keys.map(key=>[key,data.cpuDetails?.[key]??null])),runtime:safeRuntime}};
}
// URLはloopbackに限定し、リダイレクトと巨大応答を受け入れない。
async function readMetrics(endpoint,fetcher){
 const response=await fetcher(endpoint,{signal:AbortSignal.timeout(2500),redirect:'error'});
 if(!response.ok)throw Error('metrics-unavailable');
 if(Number(response.headers?.get?.('content-length'))>65536)throw Error('metrics-too-large');
 if(!response.body?.getReader)return response.json(); // テスト用fetcherも受け入れる。
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('metrics-too-large');chunks.push(Buffer.from(value));}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function collectCpuDiagnostics({url,platform=process.platform,system=os,run=execute,makeMetrics=createSystemMetrics,fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,compareRuntimes,discoverServers}={}){
 const endpoint=localMetricsUrl(url),startedAt=now();
 const report={schema:2,startedAt:new Date(startedAt).toISOString(),mode:endpoint?'existing-local-server':'new-local-sampler',platform,nodeVersion:process.versions.node,libuvVersion:process.versions.uv,osRelease:system.release(),logicalCpuCount:system.cpus().length,cpuModel:system.cpus()[0]?.model??null,samples:[],reference:null,runtimeComparison:null,runningServers:{status:'not-requested',servers:[],errors:[]}};
 let referenceDone=false,runtimeDone=!compareRuntimes,discoveryDone=!discoverServers||!!endpoint;
 const discovery=discoverServers&&!endpoint?Promise.resolve().then(discoverServers).then(found=>{
  const servers=[];
  for(const server of (found?.servers??[]).slice(0,8)){
   try{localMetricsUrl(server.url);if(!Number.isSafeInteger(server.pid)||server.pid<=0||!['ide','cpu'].includes(server.kind))continue;
    servers.push({pid:server.pid,url:server.url,kind:server.kind,project:server.project,executable:server.executable??null,startedAt:server.startedAt??null,samples:[]});
   }catch{/* 外部URLや不正な発見結果を採用しない。 */}
  }
  report.runningServers={status:found?.status??'discovery-error',servers,errors:found?.errors??[]};
 }).catch(()=>{report.runningServers={status:'discovery-error',servers:[],errors:['discovery-failed']};}).finally(()=>{discoveryDone=true;}):Promise.resolve();
 // 対象探索を終えてから全比較を始める。探索待ちでprobeと実画面の期間をずらさない。
 await discovery;
 const samplingStartedAt=now();report.samplingStartedAt=new Date(samplingStartedAt).toISOString();
 const reference=(platform==='win32'?run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',windowsCpuReferenceCommand],{timeout:25000,maxBuffer:512*1024,windowsHide:true,shell:false}).then(({stdout})=>{try{return JSON.parse(String(stdout).replace(/^\uFEFF/,'').trim());}catch{return{error:'invalid-reference-json'};}}).catch(error=>({error:'reference-command-failed',code:error.code??null,killed:!!error.killed,stderr:String(error.stderr??'').slice(0,4000)})):Promise.resolve({error:'windows-reference-not-run'})).finally(()=>{referenceDone=true;});
 // 新規probeは既存eyesではない。別の結果欄に保存し、表示中の値と混同しない。
 const comparison=compareRuntimes?Promise.resolve().then(compareRuntimes).catch(()=>({error:'runtime-comparison-failed'})).finally(()=>{runtimeDone=true;}):Promise.resolve(null);
 const metrics=endpoint?null:makeMetrics();
 try{
  for(let i=0;i<30&&(i<12||!referenceDone||!runtimeDone||!discoveryDone)&&now()-samplingStartedAt<30000;i++){
   await sleep(1000);
   const local=(async()=>{try{report.samples.push(selectSample(endpoint?await readMetrics(endpoint,fetcher):await metrics.sample()));}
    catch{report.samples.push({timestamp:now(),error:'sample-unavailable'});}})();
   const running=report.runningServers.servers.map(async server=>{
    try{
     const sample=selectSample(await readMetrics(localMetricsUrl(server.url),fetcher));
     const runtimePid=sample.details?.runtime?.pid;
     if(runtimePid!==undefined&&runtimePid!==null&&runtimePid!==server.pid){server.samples.push({timestamp:now(),error:'server-pid-changed'});return;}
     server.samples.push({...sample,runtimeIdentity:runtimePid===server.pid?'matched-pid':'legacy-runtime-unavailable'});
    }catch{server.samples.push({timestamp:now(),error:'sample-unavailable'});}
   });
   await Promise.all([local,...running]);
  }
 }finally{metrics?.close();}
 report.reference=await reference;report.runtimeComparison=await comparison;await discovery;
 const referenceTimes=(report.reference?.samples??[]).map(sample=>Date.parse(sample.timestamp)).filter(Number.isFinite);
 const productionTimes=report.samples.filter(sample=>!sample.error&&Number.isFinite(sample.cpu)).map(sample=>sample.timestamp).filter(Number.isFinite);
 report.overlap={basis:'response-timestamp-range-only',referenceSamplesWithinProductionWindow:referenceTimes.filter(t=>t>=Math.min(...productionTimes)&&t<=Math.max(...productionTimes)).length};
 for(const server of report.runningServers.servers){
  const times=server.samples.filter(sample=>!sample.error&&Number.isFinite(sample.cpu)).map(sample=>sample.timestamp);
  server.referenceSamplesWithinWindow=referenceTimes.filter(t=>t>=Math.min(...times)&&t<=Math.max(...times)).length;
 }
 report.finishedAt=new Date(now()).toISOString();
 return report;
}

export function collectorFingerprint(sources){
 const hash=createHash('sha256');for(const source of sources)hash.update(source.replace(/\r\n/g,'\n'));return hash.digest('hex');
}

async function main(args){
 if(args.includes('--help')){console.log('node frontend_ide/scripts/check-cpu-metrics.mjs [--url http://127.0.0.1:ポート/]\n約30秒の読み取り専用診断。Windowsではこのcheckoutの起動中CPU/IDEサーバーを自動探索し、新規Node・インストール済みAvatar Electronも別々に同時計測します。自動探索できない場合は --url を指定できます。結果は frontend_ide/temp/cpu-diagnostics/ へ保存します。設定変更・負荷試験・外部送信は行いません。');return;}
 if(args.length!==0&&!(args.length===2&&args[0]==='--url'))throw Error('--help で使い方を確認してください。');
 localMetricsUrl(args[1]);
 console.log('CPUを約30秒（探索が遅い場合は約45秒）比較します。問題のCPU画面とeyesを開いたまま、通常の作業を続けてください。設定変更・負荷試験・外部送信は行いません。');
 const report=await collectCpuDiagnostics({url:args[1],compareRuntimes:()=>collectRuntimeComparison(),discoverServers:()=>discoverCpuServers()});
 report.collectorSourceFiles=['aidiy_cpu/metrics.mjs','aidiy_cpu/windows-cpu.mjs','aidiy_cpu/windows-process.mjs','aidiy_cpu/windows-gpu.mjs','aidiy_cpu/os-cpu-monitor.mjs','aidiy_cpu/windows-native-cpu.cjs','aidiy_cpu/systeminformation-cpu.cjs'];
 const sources=await Promise.all(report.collectorSourceFiles.map(file=>readFile(resolve(root,file),'utf8')));
 report.collectorSha256=collectorFingerprint(sources);
 report.collectorHashFormat='utf8-lf';
 report.collectorHashScope='diagnostic-files-on-disk-not-running-server';
 const output=resolve(root,'temp/cpu-diagnostics',report.startedAt.replace(/[:.]/g,'-')+'.json');
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n','utf8');
 console.log('診断結果: '+output);
 console.log(`起動中CPU/IDEサーバー: ${report.runningServers.servers.length}件（${report.runningServers.status}）。新規サンプラーとは別欄へ保存しました。`);
 console.log('Node/Electron比較は旧os.cpus方式の新規probeです。現行eyesのsysteminformationや実表示値を直接読み取ったものではありません。');
 console.log('CPU Time・Utility・Idleは別々に記録しています。ディスクの指紋は稼働サーバーの版を証明しません。');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
