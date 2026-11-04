// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn} from 'node:child_process';
import {stat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {catalog,resolveProgram} from '../診断/probes.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
// 導入タブと同じ探索。Windows の cmd はシェル実行せず、同梱の実体を開く。
export async function resolveVSCode({platform=process.platform,env=process.env,resolveFn=resolveProgram,statFn=stat}={}){
 const entry=(await catalog()).find(item=>item.id==='code');
 const executable=await resolveFn(entry,{platform,env});
 if(!executable)return null;
 if(platform!=='win32'||! /\.(cmd|bat)$/i.test(executable))return executable;
 const p=path.win32,root=p.dirname(p.dirname(executable));
 const names=/insiders/i.test(p.basename(executable))?['Code - Insiders.exe']:['Code.exe'];
 for(const name of names){const candidate=p.join(root,name);try{if((await statFn(candidate)).isFile())return candidate;}catch{}}
 return null;
}
export function createVSCodeLauncher({spawnFn=spawn,resolveFn=resolveVSCode,env=process.env,platform=process.platform,realpathFn=realpath,statFn=stat,startupGrace=1000}={}){
 async function catalog(){let available=false;try{available=Boolean(await resolveFn({platform,env}));}catch{}
  return {id:'vscode',名前:'VS Code',種類:'editor',モード:'プロジェクトフォルダを開く',利用可能:available};
 }
 async function launch(project){
  if(typeof project!=='string'||!project.trim()||project.length>4096||/[\0\r\n]/.test(project)||!(platform==='win32'?path.win32:path).isAbsolute(project))throw fail('プロジェクトフォルダを選択してください。');
  let cwd;try{cwd=await realpathFn(project);if(!(await statFn(cwd)).isDirectory())throw Error();}catch{throw fail('フォルダが見つからないか、アクセスできません。');}
  let executable;try{executable=await resolveFn({platform,env});}catch{}
  if(!executable)throw fail('VS Code の実行ファイルが見つかりません。導入状況を確認してください。',503);
  const childEnv={...env};
  for(const key of Object.keys(childEnv))if(/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH|AIDIY_(?:DIAG_LAUNCHER_CHILD|LAUNCHER_CHILD|DIAG_SETTINGS|DIAG_RUN))$/i.test(key))delete childEnv[key];
  try{
   const child=spawnFn(executable,['--new-window',cwd],{cwd,env:childEnv,detached:true,windowsHide:false,shell:false,stdio:'ignore'});
   // GUI 実体へ SW_HIDE を渡さない。spawn は窓の表示完了を意味しないため、
   // 起動直後の異常終了だけは検出する。既存 VS Code への引渡し後の exit=0 は正常。
   await new Promise((resolve,reject)=>{
    let timer,finished=false;
    const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);child.off('exit',exited);error?reject(error):resolve();};
    const exited=(code,signal)=>finish(code===0&&!signal?undefined:fail(`VS Code が起動直後に終了しました（終了コード: ${Number.isInteger(code)?code:'なし'}）。導入状況を確認してください。`,503));
    child.once('spawn',()=>{if(!finished)timer=setTimeout(()=>finish(),startupGrace);});
    child.once('error',()=>finish(fail('VS Code を起動できませんでした。導入状況を確認してください。',503)));
    child.once('exit',exited);
   });child.unref();
  }catch(error){throw error.status?error:fail('VS Code を起動できませんでした。導入状況を確認してください。',503);}
  return {受付:true,通知:''};
 }
 return {catalog,launch};
}
