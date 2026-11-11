// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {discoverCpuServers,windowsServerDiscoveryCommand} from '../scripts/cpu-server-discovery.mjs';

const sourcePath=String.raw`C:\Users\O'Brien\作業 repo\frontend_ide\launch.mjs`;
const base={platform:'win32',sourcePath};
const row=(pid=41,port=24801,kind='cpu')=>({pid,port,kind});
const response=(kind='cpu',project={name:'別の作業先',path:'D:\\Other project'})=>new Response(JSON.stringify({kind,project}),{headers:{'content-type':'application/json'}});
const runRows=(candidates=[],errors=[])=>async()=>({stdout:JSON.stringify({candidates,errors})});

test('非Windowsではプロセス照会・HTTPを行わずunsupportedを返す',async()=>{
 for(const platform of ['linux','darwin'])assert.deepEqual(await discoverCpuServers({platform,run:()=>assert.fail('run'),fetcher:()=>assert.fail('fetch')}),{status:'unsupported',servers:[],errors:[]});
});

test('対象のPID/ポートだけを確認し、作業先はcheckoutと異なっても保持する',async()=>{
 const calls=[];
 const result=await discoverCpuServers({...base,run:runRows([{...row(),executable:'C:\\Runtime\\node.exe',startedAt:'2026-11-11T01:02:03.1234567Z',CommandLine:'secret command',environment:'secret env'}]),fetcher:async(url,options)=>{
  calls.push({url,options});return response('cpu',{name:'選んだ作業先',path:'D:\\Other project',secret:'not saved'});
 }});
 assert.deepEqual(result,{status:'ok',servers:[{pid:41,url:'http://127.0.0.1:24801/',kind:'cpu',project:{name:'選んだ作業先',path:'D:\\Other project'},executable:'C:\\Runtime\\node.exe',startedAt:'2026-11-11T01:02:03.123Z'}],errors:[]});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:24801/development/config');
 assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.method,'GET');
 assert.doesNotMatch(JSON.stringify(result),/secret|CommandLine|environment/);
});

test('PowerShellはshellを介さず上限つきで実行し、stdout以外は報告しない',async()=>{
 let calls=0;
 const result=await discoverCpuServers({...base,run:async(file,args,options)=>{
  calls++;assert.equal(file,'powershell.exe');assert.deepEqual(args.slice(0,4),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand']);
  const script=Buffer.from(args[4],'base64').toString('utf16le');assert.equal(script,windowsServerDiscoveryCommand(sourcePath));
  assert.equal(options.timeout,12000);assert.equal(options.maxBuffer,64*1024);assert.equal(options.windowsHide,true);assert.equal(options.encoding,'utf8');assert.ok(!options.shell);
  return {stdout:'\uFEFF{"candidates":[],"errors":[]}',stderr:'secret stderr'};
 },fetcher:()=>assert.fail('fetch')});
 assert.equal(calls,1);assert.deepEqual(result,{status:'not-found',servers:[],errors:[]});
});

test('PowerShellのsource literalは引用符・空白・日本語・区切りを安全に扱う',()=>{
 const script=windowsServerDiscoveryCommand("C:/Users/O'Brien/作業 repo/frontend_ide/./launch.mjs");
 assert.ok(script.includes("$sourcePath='C:\\Users\\O''Brien\\作業 repo\\frontend_ide\\launch.mjs'"));
 assert.match(script,/CommandLineToArgvW/);assert.match(script,/OrdinalIgnoreCase/);
 assert.match(script,/-Filter "Name='node.exe'"/);assert.match(script,/-State Listen -LocalAddress '127\.0\.0\.1' -OwningProcess/);
 assert.match(script,/\$words\[1\]/);assert.match(script,/GetFullPath/);
 assert.doesNotMatch(script,/Stop-Process|Start-Process|Set-Item|EnvironmentVariables|Invoke-WebRequest|Invoke-Expression/);
 assert.doesNotMatch(script,/Select-Object[^\n]*(?:CommandLine|ExecutablePath)/);
 const injected=windowsServerDiscoveryCommand("C:\\a';Write-Output SECRET;'\\launch.mjs");
 assert.ok(injected.includes("$sourcePath='C:\\a'';Write-Output SECRET;''\\launch.mjs'"));
 for(const invalid of ['launch.mjs','C:launch.mjs','/tmp/launch.mjs','C:\\Repo\\server.mjs','C:\\x\n\\launch.mjs','C:\\x\0\\launch.mjs'])assert.throws(()=>windowsServerDiscoveryCommand(invalid),/invalid-source-path/);
 assert.ok(windowsServerDiscoveryCommand('\\\\server\\share\\frontend_ide\\launch.mjs').includes("$sourcePath='\\\\server\\share\\frontend_ide\\launch.mjs'"));
});

test('sourcePath不正は実行前にdiscovery-errorとする',async()=>{
 const result=await discoverCpuServers({...base,sourcePath:'./launch.mjs',run:()=>assert.fail('run'),fetcher:()=>assert.fail('fetch')});
 assert.deepEqual(result,{status:'discovery-error',servers:[],errors:['invalid-source-path']});
});

test('CIMや実行の失敗は秘密情報を含まない固定コードにする',async()=>{
 const result=await discoverCpuServers({...base,run:async()=>{throw Object.assign(Error('secret commandline'),{stderr:'secret token'});},fetcher:()=>assert.fail('fetch')});
 assert.deepEqual(result,{status:'discovery-error',servers:[],errors:['process-discovery-failed']});
 const returned=await discoverCpuServers({...base,run:runRows([],['process-query-failed','secret token']),fetcher:()=>assert.fail('fetch')});
 assert.deepEqual(returned,{status:'discovery-error',servers:[],errors:['process-query-failed','invalid-discovery-response']});
});

test('不正・過大なプロセス応答は報告に複製せずHTTPにも進まない',async()=>{
 for(const stdout of ['{secret','x'.repeat(65537),null,JSON.stringify({candidates:'secret',errors:[]}),JSON.stringify({candidates:[],errors:null})]){
  const result=await discoverCpuServers({...base,run:async()=>({stdout}),fetcher:()=>assert.fail('fetch')});
  assert.equal(result.status,'discovery-error');assert.deepEqual(result.servers,[]);assert.doesNotMatch(JSON.stringify(result),/secret/);
 }
});

test('無効なPID・port・kind・ロック18439にはHTTPを送らない',async()=>{
 const candidates=[{...row(),pid:0},{...row(),pid:0x100000000},{...row(),port:'24801'},{...row(),port:65536},{...row(),port:-1},{...row(),kind:'code'},row(48,18439),null];
 const result=await discoverCpuServers({...base,run:runRows(candidates),fetcher:()=>assert.fail('fetch')});
 assert.deepEqual(result,{status:'discovery-error',servers:[],errors:['invalid-candidate']});
 const lock=await discoverCpuServers({...base,run:runRows([row(48,18439)]),fetcher:()=>assert.fail('fetch')});
 assert.deepEqual(lock,{status:'not-found',servers:[],errors:[]});
});

test('候補は重複排除し、呼出側が増やしても最大8接続に制限する',async()=>{
 const candidates=Array.from({length:12},(_,i)=>row(i+1,25000+i));let requests=0;
 const result=await discoverCpuServers({...base,maxCandidates:1000,run:runRows(candidates),fetcher:async()=>{requests++;return response();}});
 assert.equal(requests,8);assert.equal(result.servers.length,8);assert.deepEqual(result.errors,['candidate-limit']);
 const duplicates=await discoverCpuServers({...base,run:runRows([row(),row()]),fetcher:async()=>response()});assert.equal(duplicates.servers.length,1);
 const lower=await discoverCpuServers({...base,maxCandidates:1,run:runRows([row(),row(42,25000)]),fetcher:async()=>response()});assert.equal(lower.servers.length,1);
});

test('構成kindはcpu/ideだけでなく実プロセスのapp値とも一致する必要がある',async()=>{
 for(const kind of ['code','browser','ide',null]){
  const result=await discoverCpuServers({...base,run:runRows([row()]),fetcher:async()=>response(kind)});
  assert.deepEqual(result,{status:'discovery-error',servers:[],errors:['config-kind-mismatch']});
 }
 const ide=await discoverCpuServers({...base,run:runRows([row(42,25000,'ide')]),fetcher:async()=>response('ide')});assert.equal(ide.servers[0].kind,'ide');
});

test('失敗候補があっても正常な候補を返し、メタデータは限定する',async()=>{
 const result=await discoverCpuServers({...base,run:runRows([{...row(),executable:'bad\nvalue',startedAt:'not a date'},row(42,25000,'ide')]),fetcher:async(url)=>url.includes(':25000/')?new Response('secret',{status:503}):response('cpu',{name:'ok\nname',path:'D:\\work\u0000'})});
 assert.equal(result.status,'ok');assert.equal(result.servers.length,1);assert.deepEqual(result.errors,['config-http-error']);
 assert.equal(result.servers[0].executable,null);assert.equal(result.servers[0].startedAt,null);assert.deepEqual(result.servers[0].project,{name:'okname',path:'D:\\work'});
});

test('HTTPリダイレクト・URL置換・例外を拒否し、例外本文を返さない',async()=>{
 for(const fetcher of [async()=>new Response(null,{status:302,headers:{location:'https://outside.example/secret'}}),async()=>({status:200,redirected:true}),async()=>({status:200,url:'https://outside.example/'}),async()=>{throw Error('secret URL or credentials');}]){
  const result=await discoverCpuServers({...base,run:runRows([row()]),fetcher});assert.equal(result.status,'discovery-error');assert.deepEqual(result.servers,[]);assert.doesNotMatch(JSON.stringify(result),/secret|outside/);
 }
});

test('Content-Lengthとストリームの両方でbody上限を守る',async()=>{
 for(const fetcher of [async()=>new Response('{}',{headers:{'content-length':'1025'}}),async()=>new Response('x'.repeat(1025)),async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(800));controller.enqueue(new Uint8Array(800));controller.close();}}))]){
  const result=await discoverCpuServers({...base,maxBodyBytes:1024,run:runRows([row()]),fetcher});assert.deepEqual(result,{status:'discovery-error',servers:[],errors:['config-body-too-large']});
 }
});

test('壊れたJSON・UTF8・空応答を固定エラーへ変換する',async()=>{
 for(const fetcher of [async()=>new Response('secret invalid json'),async()=>new Response(new Uint8Array([0xff])),async()=>new Response(null)]){
  const result=await discoverCpuServers({...base,run:runRows([row()]),fetcher});assert.deepEqual(result,{status:'discovery-error',servers:[],errors:['config-invalid-json']});
 }
});

test('fetch待ちとbody待ちの両方に期限を適用し中止する',async()=>{
 for(const bodyWait of [false,true]){
  let signal,cancelled=false;
  const result=await discoverCpuServers({...base,timeoutMs:15,run:runRows([row()]),fetcher:async(_,options)=>{
   signal=options.signal;
   return bodyWait?new Response(new ReadableStream({cancel(){cancelled=true;}})):new Promise(()=>{});
  }});
  assert.deepEqual(result,{status:'discovery-error',servers:[],errors:['config-timeout']});assert.equal(signal.aborted,true);if(bodyWait)assert.equal(cancelled,true);
 }
});

// PowerShell/CommandLineToArgvW自体の解釈を検証する。Linuxのmock通過で代用しない。
const execute=promisify(execFile),quote=value=>`'${value.replaceAll("'","''")}'`;
async function runWindowsFixture(rows,{failProcess=false,failListen=false,missingPids=[],failedPids=[],extraListeners=[],targetPath=sourcePath}={}){
 const script=`
function Get-CimInstance {
 param($ClassName,$Filter,$Property,$OperationTimeoutSec)
 if($ClassName -ne 'Win32_Process' -or $Filter -ne "Name='node.exe'" -or $OperationTimeoutSec -ne 3){throw 'wrong scope'}
 ${failProcess?"throw 'secret process data'":`ConvertFrom-Json -InputObject ${quote(JSON.stringify(rows))}`}
}
function Get-NetTCPConnection {
 param($State,$LocalAddress,$OwningProcess,$ErrorAction)
 if($State -ne 'Listen' -or $LocalAddress -ne '127.0.0.1' -or !$OwningProcess -or @($OwningProcess).Count -ne 1){throw 'wrong scope'}
 if(@(${missingPids.join(',')}) -contains $OwningProcess){Write-Error 'no listener for this PID' -Category ObjectNotFound;return}
 if(@(${failedPids.join(',')}) -contains $OwningProcess){throw 'secret listener data'}
 ${failListen?"throw 'secret listener data'":`foreach($owner in $OwningProcess){[PSCustomObject]@{LocalAddress='127.0.0.1';State='Listen';OwningProcess=$owner;LocalPort=(25000+[int]$owner)}}
 ConvertFrom-Json -InputObject ${quote(JSON.stringify(extraListeners))}`}
}
${windowsServerDiscoveryCommand(targetPath)}`;
 const encoded=Buffer.from(script,'utf16le').toString('base64');assert.ok(encoded.length<32000,'Windows command length');
 const {stdout}=await execute('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:64*1024});
 return JSON.parse(stdout.replace(/^\uFEFF/,''));
}

test('PowerShell実行: quotedパス・app値を厳密照合し、別checkoutや埋込み文字列を除外',{skip:process.platform!=='win32'},async()=>{
 const quoted=value=>`"${value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')}"`;
 const command=(path=sourcePath,args='--app cpu')=>`"C:\\Program Files\\nodejs\\node.exe" "${path}" ${args}`;
 const lines=[
  [command(),true],
  [command(sourcePath.replaceAll('\\','/'),'--app=cpu --foreground'),true],
  [command(sourcePath.toUpperCase(),`--project ${quoted('D:\\Some space\\')} --app ide`),true],
  [command(sourcePath.replace('frontend_ide\\','frontend_ide\\.\\'),'--app cpu --app ide'),true],
  [command(sourcePath.replace("O'Brien\\作業 repo",'different checkout')),false],
  [command(sourcePath+'.bak'),false],
  [command(sourcePath,'--project "--app cpu"'),false],
  [command(sourcePath,'--app cpu --app code'),false],
  [command(sourcePath,'-- --app cpu'),false],
  [command(sourcePath,'--APP cpu'),false],
  [command(sourcePath,'--app CPU'),false],
  [command(sourcePath,'--project --app cpu'),false],
  [command(sourcePath,'--app cpu --unknown'),false],
  [command('.\\launch.mjs'),false],
  [`node.exe -e "${sourcePath}" --app cpu`,false],
 ];
 const rows=lines.map(([CommandLine],i)=>({ProcessId:i+1,CommandLine,ExecutablePath:'C:\\Runtime\\node.exe',CreationDate:'2026-11-11T00:00:00Z'}));
 const extraListeners=[{LocalAddress:'0.0.0.0',State:'Listen',OwningProcess:1,LocalPort:25099},{LocalAddress:'127.0.0.1',State:'Established',OwningProcess:1,LocalPort:25098},{LocalAddress:'127.0.0.1',State:'Listen',OwningProcess:99,LocalPort:25097},{LocalAddress:'127.0.0.1',State:'Listen',OwningProcess:1,LocalPort:18439}];
 const result=await runWindowsFixture(rows,{extraListeners});
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.candidates.map(c=>c.pid),lines.flatMap(([,yes],i)=>yes?[i+1]:[]));
 assert.equal(result.candidates[2].kind,'ide');assert.equal(result.candidates[0].executable,'C:\\Runtime\\node.exe');assert.ok(result.candidates[0].startedAt.startsWith('2026-11-11T00:00:00'));
 assert.doesNotMatch(JSON.stringify(result),/CommandLine|Program Files|Some space|different checkout/);
});

test('PowerShell実行: 空白なしのunquoted絶対パスと8候補制限',{skip:process.platform!=='win32'},async()=>{
 const targetPath='C:\\Repo\\frontend_ide\\launch.mjs';
 const rows=Array.from({length:10},(_,i)=>({ProcessId:i+1,CommandLine:`node.exe ${targetPath} --app=cpu`}));
 const result=await runWindowsFixture(rows,{targetPath});
 assert.equal(result.candidates.length,8);assert.deepEqual(result.errors,['candidate-limit']);
});

test('PowerShell実行: process/listener失敗を固定コードだけにする',{skip:process.platform!=='win32'},async()=>{
 const rows=[{ProcessId:1,CommandLine:`node.exe "${sourcePath}" --app cpu`}];
 for(const [options,error] of [[{failProcess:true},'process-query-failed'],[{failListen:true},'listener-query-failed']]){
  const result=await runWindowsFixture(rows,options);assert.deepEqual(result,{candidates:[],errors:[error]});
 }
});

test('PowerShell実行: 終了したPID・Listen照会失敗が他の正常候補を消さない',{skip:process.platform!=='win32'},async()=>{
 const rows=[1,2,3].map(ProcessId=>({ProcessId,CommandLine:`node.exe "${sourcePath}" --app cpu`}));
 const gone=await runWindowsFixture(rows,{missingPids:[1]});
 assert.deepEqual(gone.candidates.map(row=>row.pid),[2,3]);assert.deepEqual(gone.errors,[]);
 const failed=await runWindowsFixture(rows,{missingPids:[1],failedPids:[2]});
 assert.deepEqual(failed.candidates.map(row=>row.pid),[3]);assert.deepEqual(failed.errors,['listener-query-failed']);
});
