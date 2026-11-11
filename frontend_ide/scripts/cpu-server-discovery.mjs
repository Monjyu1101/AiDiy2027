// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {win32} from 'node:path';
import {fileURLToPath} from 'node:url';

const execute=promisify(execFile);
const defaultSourcePath=fileURLToPath(new URL('../launch.mjs',import.meta.url));
const MAX_CANDIDATES=8,PROCESS_OUTPUT_LIMIT=64*1024,DEFAULT_BODY_LIMIT=32*1024;
const processErrors=new Set(['process-query-failed','command-line-parser-failed','listener-query-failed','candidate-limit']);
const configErrors=new Set(['config-timeout','config-redirect','config-http-error','config-body-too-large','config-invalid-json','config-kind-mismatch']);
const bounded=(value,fallback,max)=>Number.isInteger(value)&&value>0?Math.min(value,max):fallback;
const psLiteral=value=>`'${value.replaceAll("'","''")}'`;

// 相対script名から他プロセスのcwdを推測しない。通常のlaunchDetachedは絶対パスで起動する。
// Windowsのargv解析はOSに任せ、コマンドライン・環境変数をJSONへ渡さない。
export function windowsServerDiscoveryCommand(sourcePath=defaultSourcePath,{maxCandidates=MAX_CANDIDATES}={}){
 if(typeof sourcePath!=='string'||sourcePath.length>32767||/[\0-\x1f]/.test(sourcePath))throw Error('invalid-source-path');
 const source=win32.normalize(sourcePath.replace(/^\\\\\?\\/,'').replaceAll('/','\\'));
 if(!/^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+\\)/i.test(source)||win32.basename(source).toLowerCase()!=='launch.mjs')throw Error('invalid-source-path');
 const limit=bounded(maxCandidates,MAX_CANDIDATES,MAX_CANDIDATES);
 return String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$sourcePath=${psLiteral(source)}
$candidateLimit=${limit}
$errors=@();$candidates=@()
try {
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AiDiyCpuDiscoveryArgv {
 [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 private static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
 [DllImport("kernel32.dll")]
 private static extern IntPtr LocalFree(IntPtr memory);
 public static string[] Parse(string commandLine) {
  int count; IntPtr memory=CommandLineToArgvW(commandLine, out count);
  if(memory==IntPtr.Zero) throw new InvalidOperationException();
  try {
   string[] result=new string[count];
   for(int i=0;i<count;i++) result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory,i*IntPtr.Size));
   return result;
  } finally { LocalFree(memory); }
 }
}
'@
} catch { $errors+='command-line-parser-failed' }
function Get-LaunchKind([string]$commandLine) {
 if([string]::IsNullOrWhiteSpace($commandLine)){return $null}
 try {
  $words=[AiDiyCpuDiscoveryArgv]::Parse($commandLine)
  if($words.Length -lt 3){return $null}
  $scriptPath=$words[1].Replace('/','\')
  if($scriptPath.StartsWith('\\?\')){$scriptPath=$scriptPath.Substring(4)}
  if($scriptPath -notmatch '^(?:[a-zA-Z]:\\|\\\\[^\\]+\\[^\\]+\\)'){return $null}
  $scriptPath=[IO.Path]::GetFullPath($scriptPath)
  if(![string]::Equals($scriptPath,$sourcePath,[StringComparison]::OrdinalIgnoreCase)){return $null}
  $kind=$null
  $stringOptions=@('--app','--project','--provider','--model','--cli','--port','--ready-file')
  $booleanOptions=@('--project-fixed','--cli-auto-approve','--strict-port','--browser','--no-open','--offline','--connect','--foreground','--serve','--wait','--new-window','--help')
  for($i=2;$i -lt $words.Length;$i++){
   $word=$words[$i]
   if($word -ceq '--'){break}
   if(!$word.StartsWith('-')){continue}
   $parts=$word.Split([string[]]@('='),2,[StringSplitOptions]::None);$option=$parts[0]
   if($stringOptions -ccontains $option){
    if($parts.Length -eq 2){$value=$parts[1]}
    else{$i++;if($i -ge $words.Length -or $words[$i].StartsWith('-')){return $null};$value=$words[$i]}
    if($option -ceq '--app'){$kind=$value}
   } elseif($booleanOptions -ccontains $option -and $parts.Length -eq 1){continue}
   else{return $null}
  }
  if($kind -ceq 'cpu' -or $kind -ceq 'ide'){return $kind}
 } catch {}
 return $null
}
if($errors.Count -eq 0){
 try {
  $matchedProcesses=@(Get-CimInstance -ClassName Win32_Process -Filter "Name='node.exe'" -Property ProcessId,CommandLine,ExecutablePath,CreationDate -OperationTimeoutSec 3 | ForEach-Object {
   $kind=Get-LaunchKind $_.CommandLine
   if($kind){
    $startedAt=$null;try{if($_.CreationDate){$startedAt=([datetime]$_.CreationDate).ToUniversalTime().ToString('o')}}catch{}
    [PSCustomObject]@{pid=[uint32]$_.ProcessId;kind=$kind;executable=$_.ExecutablePath;startedAt=$startedAt}
   }
  } | Sort-Object pid | Select-Object -First ($candidateLimit+1))
  if($matchedProcesses.Count -gt $candidateLimit){$errors+='candidate-limit';$matchedProcesses=@($matchedProcesses | Select-Object -First $candidateLimit)}
 } catch { $errors+='process-query-failed';$matchedProcesses=@() }
 if($matchedProcesses.Count -gt 0){
  try {
   $owners=@{};foreach($item in $matchedProcesses){$owners[[string]$item.pid]=$item}
   $connections=@()
   foreach($item in $matchedProcesses){
    try{
     $connections+=@(Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -OwningProcess ([uint32]$item.pid) -ErrorAction Stop)
    }catch{
     # 照会中に終了したPID・Listenなしは他の候補の失敗にしない。
     if($_.CategoryInfo.Category -ne [System.Management.Automation.ErrorCategory]::ObjectNotFound){$errors+='listener-query-failed'}
    }
   }
   $candidates=@($connections | Where-Object {
    $_.LocalAddress -ceq '127.0.0.1' -and [string]$_.State -eq 'Listen' -and $owners.ContainsKey([string]$_.OwningProcess) -and $_.LocalPort -ne 18439
   } | ForEach-Object {
    $owner=$owners[[string]$_.OwningProcess]
    [PSCustomObject]@{pid=[uint32]$_.OwningProcess;port=[int]$_.LocalPort;kind=$owner.kind;executable=$owner.executable;startedAt=$owner.startedAt}
   } | Sort-Object pid,port -Unique | Select-Object -First ($candidateLimit+1))
   if($candidates.Count -gt $candidateLimit){$errors+='candidate-limit';$candidates=@($candidates | Select-Object -First $candidateLimit)}
  } catch { $errors+='listener-query-failed' }
 }
}
ConvertTo-Json -InputObject ([PSCustomObject]@{candidates=@($candidates);errors=@($errors | Select-Object -Unique)}) -Depth 3 -Compress
`;
}

function selectedProject(project){
 // config全体には将来ほかの設定が増えても、そのまま診断結果へ複製しない。
 if(!project||typeof project!=='object'||typeof project.path!=='string')return null;
 const safe=value=>value.replace(/[\0-\x1f\x7f]/g,'').slice(0,4096);
 return {name:typeof project.name==='string'?safe(project.name).slice(0,256):'',path:safe(project.path)};
}

async function verifyConfig(candidate,{fetcher,timeoutMs,maxBodyBytes}){
 const origin=`http://127.0.0.1:${candidate.port}/`,url=new URL('development/config',origin).href;
 const controller=new AbortController();let timer,reader;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('config-timeout'));controller.abort();void reader?.cancel().catch(()=>{});},timeoutMs);});
 try{
  const config=await Promise.race([timeout,(async()=>{
   const response=await fetcher(url,{method:'GET',redirect:'error',signal:controller.signal,headers:{accept:'application/json'},credentials:'omit'});
   if(response.redirected||(response.status>=300&&response.status<400)||(response.url&&response.url!==url))throw Error('config-redirect');
   if(response.status!==200)throw Error('config-http-error');
   const length=Number(response.headers?.get('content-length'));
   if(Number.isFinite(length)&&length>maxBodyBytes)throw Error('config-body-too-large');
   if(!response.body?.getReader)throw Error('config-invalid-json');
   reader=response.body.getReader();let size=0;const chunks=[];
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBodyBytes)throw Error('config-body-too-large');chunks.push(value);}
   try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}catch{throw Error('config-invalid-json');}
  })()]);
  if(!config||config.kind!==candidate.kind||!['ide','cpu'].includes(config.kind))throw Error('config-kind-mismatch');
  return {server:{pid:candidate.pid,url:origin,kind:config.kind,project:selectedProject(config.project),executable:candidate.executable,startedAt:candidate.startedAt}};
 }catch(error){
  return {error:configErrors.has(error?.message)?error.message:'config-request-failed'};
 }finally{
  clearTimeout(timer);
  if(reader){void reader.cancel().catch(()=>{});}
  // content-length過大など、reader生成前に拒否した応答も中止して接続を解放する。
  controller.abort();
 }
}

// 全ポートの走査やプロセスの起動・終了は行わない。stdout/stderrと例外本文も報告しない。
export async function discoverCpuServers({platform=process.platform,run=execute,fetcher=globalThis.fetch,sourcePath=defaultSourcePath,maxCandidates=MAX_CANDIDATES,timeoutMs=1500,maxBodyBytes=DEFAULT_BODY_LIMIT}={}){
 if(platform!=='win32')return {status:'unsupported',servers:[],errors:[]};
 const limit=bounded(maxCandidates,MAX_CANDIDATES,MAX_CANDIDATES),errors=[];
 let command,output;
 try{command=windowsServerDiscoveryCommand(sourcePath,{maxCandidates:limit});}catch{return {status:'discovery-error',servers:[],errors:['invalid-source-path']};}
 try{
  const result=await run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',timeout:12000,maxBuffer:PROCESS_OUTPUT_LIMIT,windowsHide:true});
  if(typeof result.stdout!=='string'||Buffer.byteLength(result.stdout)>PROCESS_OUTPUT_LIMIT)throw Error();
  output=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
 }catch{return {status:'discovery-error',servers:[],errors:['process-discovery-failed']};}
 if(!output||!Array.isArray(output.candidates)||!Array.isArray(output.errors))return {status:'discovery-error',servers:[],errors:['invalid-discovery-response']};
 for(const error of output.errors)errors.push(processErrors.has(error)?error:'invalid-discovery-response');
 if(output.candidates.length>limit)errors.push('candidate-limit');
 const candidates=[],seen=new Set();
 for(const candidate of output.candidates.slice(0,limit)){
  if(!candidate||!Number.isInteger(candidate.pid)||candidate.pid<1||candidate.pid>0xffffffff||!Number.isInteger(candidate.port)||candidate.port<1||candidate.port>65535||!['cpu','ide'].includes(candidate.kind)){errors.push('invalid-candidate');continue;}
  if(candidate.port===18439)continue;
  const key=`${candidate.pid}:${candidate.port}`;if(seen.has(key))continue;seen.add(key);
  const executable=typeof candidate.executable==='string'&&candidate.executable.length<=4096&&!/[\0-\x1f\x7f]/.test(candidate.executable)?candidate.executable:null;
  const startedAt=typeof candidate.startedAt==='string'&&candidate.startedAt.length<=64&&Number.isFinite(Date.parse(candidate.startedAt))?new Date(candidate.startedAt).toISOString():null;
  candidates.push({pid:candidate.pid,port:candidate.port,kind:candidate.kind,executable,startedAt});
 }
 const results=await Promise.all(candidates.map(candidate=>verifyConfig(candidate,{fetcher,timeoutMs:bounded(timeoutMs,1500,5000),maxBodyBytes:bounded(maxBodyBytes,DEFAULT_BODY_LIMIT,64*1024)})));
 const servers=[];for(const result of results){if(result.server)servers.push(result.server);else errors.push(result.error);}
 return {status:servers.length?'ok':errors.length?'discovery-error':'not-found',servers,errors:[...new Set(errors)]};
}
