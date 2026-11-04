// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {access} from 'node:fs/promises';
const root=fileURLToPath(new URL('../../',import.meta.url));
// HTTPの通常code_agents/runには読取専用境界がないため使わない。
// セットアップ済みPythonから既存CLI読取専用オプションを固定した入口だけを呼ぶ。
export async function runNavigationAgent({project,prompt,signal,selection}){
 const python=join(root,'backend_tools','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 await access(python);
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawn(python,['-B',join(root,'backend_tools','tools_proc','process_lifetime.py'),'--parent-pid',String(process.pid),'--',python,'-B',fileURLToPath(new URL('./navigation_readonly.py',import.meta.url))],{cwd:root,windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'},signal});
  const chunks=[];let size=0,oversize=false;
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){oversize=true;child.kill();}else chunks.push(chunk);});
  child.on('error',reject);child.stdin.on('error',()=>{});
  child.on('close',code=>{
   if(oversize)return reject(Error('Navigationの回答が大きすぎます。'));
   try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(code!==0||result.error||typeof result.content!=='string')throw Error(result.error||'読取専用AIの回答を確認できません。');resolve(result);}
   catch(e){reject(e instanceof SyntaxError?Error('読取専用AIの応答形式を確認できません。'):e);}
  });
  child.stdin.end(JSON.stringify({project,prompt,selection}));
 });
}

// 常駐Tools/Coreへの接続は要求しない。ローカル実行依存だけを確認する。
export async function navigationAvailability(selection){
 try{await access(join(root,'backend_tools','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'));}catch{return {available:false,reason:'Navigator用のPython環境が見つかりません。セットアップ後に再確認してください。'};}
 if(selection.provider==='aidiy_hermes'){
  try{await access(join(root,'command_hermes','prediction_main.py'));await access(join(root,'command_hermes','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'));}catch{return {available:false,reason:'Hermesの実行環境が見つかりません。セットアップ後に再確認してください。'};}
 }else{
  const command={codex_cli:'codex',copilot_cli:'copilot',claude_cli:'claude',grok_cli:'grok'}[selection.provider];
  if(!command)return {available:false,reason:'対応していないAIです。'};
  try{await promisify(execFile)(process.platform==='win32'?'where.exe':'which',[command],{timeout:10000,windowsHide:true});}catch(error){
   if(error.killed||error.signal)return {available:false,reason:command+' コマンドの確認がタイムアウトしました。しばらくしてから再確認してください。'};
   if(error.code===1)return {available:false,reason:command+' コマンドが見つかりません。導入状態を確認してください。'};
   return {available:false,reason:command+' コマンドの確認に失敗しました。実行環境を確認してください。'};
  }
 }
 return {available:true,reason:''};
}
