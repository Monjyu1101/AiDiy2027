// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {execFile}=require('node:child_process');
const {join}=require('node:path');
const {createServer,connect}=require('node:net');
const {promisify}=require('node:util');
const execute=promisify(execFile);
const options={encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:8*1024*1024};

// コマンドラインは稼働判定にだけ使い、画面やログに返さない。
async function タスク一覧(platform=process.platform,{python=true}={}){
 if(platform==='win32'){
  const filter="Name='node.exe' OR Name='electron.exe'"+(python?" OR Name LIKE 'python%.exe'":"");
  const script=String.raw`$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process -Filter "${filter}" -Property Name,ProcessId,CommandLine | Where-Object { $_.Name -match '^(node|electron|python(?:w|3(?:\.\d+)?)?)\.exe$' } | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress`;
  const command=Buffer.from(script,'utf16le').toString('base64');
  const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',command],options);
  const values=JSON.parse(stdout.trim()||'[]');
  return (Array.isArray(values)?values:[values]).map(item=>({pid:item.ProcessId,command:item.CommandLine||''}));
 }
 const {stdout}=await execute('ps',['-ax','-o','pid=,args='],options);
 return stdout.split('\n').flatMap(line=>{const match=line.match(/^\s*(\d+)\s+(.+)$/);return match?[{pid:Number(match[1]),command:match[2]}]:[];});
}

// Consoleの配置用ポート(18440〜)と分け、OSが終了時に解放する。
const 起動枠={task:18437,team:18438,cpu:18439};
const 単一起動部品=Object.freeze(Object.keys(起動枠));
async function 起動枠を確保(id){
 const server=createServer(socket=>socket.destroy());
 try{
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen({host:'127.0.0.1',port:起動枠[id],exclusive:true},resolve);
  });
 }catch(error){if(error.code==='EADDRINUSE')return null;throw error;}
 server.unref();
 return ()=>{if(server.listening)server.close();};
}
function 起動枠の使用中(id){
 return new Promise((resolve,reject)=>{
  const socket=connect({host:'127.0.0.1',port:起動枠[id]});
  socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('error',error=>{if(error.code==='ECONNREFUSED')resolve(false);else reject(error);});
  socket.setTimeout(1000,()=>{socket.destroy();reject(Error('起動状態を確認できません。'));});
 });
}

async function 単独起動中の部品(ideRoot,tasks=()=>タスク一覧(process.platform,{python:false})){
 const path=join(ideRoot).replaceAll('\\','/').replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&');
 const entry=new RegExp('(?:^|[\\s"])'+path+'/(?:desktop\\.cjs|launch\\.mjs)"?\\s+--app(?:=|\\s+)(task|team|cpu)(?=\\s|$)',process.platform==='win32'?'i':'');
 const running=new Set();
 for(const {command=''} of await tasks()){
  const args=command.replaceAll('\\','/');
  if(/(?:^|\s)(?:--eval|-e|--test|--no-open|--serve|--help)(?:\s|$)/.test(args))continue;
  const match=entry.exec(args);
  if(match)running.add(match[1].toLowerCase());
 }
 return running;
}

module.exports={タスク一覧,単一起動部品,単独起動中の部品,起動枠を確保,起動枠の使用中};
