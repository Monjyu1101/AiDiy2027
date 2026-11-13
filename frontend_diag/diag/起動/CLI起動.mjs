// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn} from 'node:child_process';
import {stat,realpath,mkdir,open} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
// 任意コマンド・モデル・引数・実行ファイルはAPIから受け取らない。
// 存在確認はファイル探索のみ。CLIの起動・認証・バージョン確認は行わない。
export function createCliLauncher({root=ROOT,node=process.execPath,spawnFn=spawn,resolveCli,loadDefinitions=()=>import('../../../frontend_ide/aidiy_console/cli-launch.mjs'),timeout=30000,env=process.env}={}){
 async function definitions(){
  try{const shared=await loadDefinitions();return {items:shared.CLI_LAUNCHERS,resolve:resolveCli||shared.resolveCliLaunch};}
  catch{throw fail('Console のCLI起動ファイルが不足しています。同じ版の frontend_ide を準備してください。',503);}
 }
 async function catalog(){
  const {items,resolve}=await definitions();
  const 対象=await Promise.all(items.map(async item=>{
   try{await resolve(item.id,{autoApprove:true,env});return {id:item.id,名前:item.name,モード:item.mode,利用可能:true};}
   catch{return {id:item.id,名前:item.name,モード:item.mode,利用可能:false};}
  }));
  return {対象};
 }
 async function launch(id,project,approved){
  const {items,resolve}=await definitions();
  const item=items.find(value=>value.id===id);
  if(!item)throw fail('CLIの起動対象が不正です。');
  if(approved!==true)throw fail('自動承認モードの注意事項を確認してください。');
  if(typeof project!=='string'||!project.trim()||project.length>4096||/[\0\r\n]/.test(project)||!isAbsolute(project))throw fail('プロジェクトフォルダを選択してください。');
  let cwd;try{cwd=await realpath(project);if(!(await stat(cwd)).isDirectory())throw Error();}catch{throw fail('フォルダが見つからないか、アクセスできません。');}
  // 同じCLI・プロジェクトでも要求ごとに独立したConsoleを開く。
  // 起動完了後のCLI・サーバー・窓の所有権と終了処理は、そのConsoleだけが持つ。
  try{await resolve(id,{autoApprove:true,env});}catch{throw fail(`${item.name} の実行ファイルが見つからないか、利用できません。導入状況を確認してください。`,503);}
  const args=[join(root,'frontend_ide','launch.mjs'),'--app','console','--project',cwd,'--new-window','--cli',id,'--cli-auto-approve','--foreground'];
  const childEnv={...env,AIDIY_LAUNCHER_CHILD:'1'};
  for(const name of Object.keys(childEnv))if(/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH|AIDIY_(?:DIAG_LAUNCHER_CHILD|DIAG_SETTINGS|DIAG_RUN))$/i.test(name))delete childEnv[name];
  const logs=join(root,'temp','aidiy_diag','アプリ起動');await mkdir(logs,{recursive:true});
  const logPath=join(logs,`cli-${id}-${randomUUID()}.log`),output=await open(logPath,'a',0o600);let child;
  try{
   child=spawnFn(node,args,{cwd,env:childEnv,detached:true,windowsHide:true,shell:false,stdio:['ignore',output.fd,output.fd,'ipc']});
   await new Promise((resolve,reject)=>{
    let finished=false;const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timer);child.off('message',message);child.off('error',failed);child.off('exit',exited);error?reject(error):resolve();};
    const message=value=>{if(value?.launchReady===true)finish();else if(value?.launchError)finish(fail(`${item.name} を開始できませんでした。Console のセットアップと起動ログを確認してください。`,503));};
    const failed=()=>finish(fail('Console の起動に失敗しました。セットアップを確認してください。',503));
    const exited=()=>finish(fail('Console が起動完了前に終了しました。起動ログを確認してください。',503));
    const timer=setTimeout(()=>finish(fail('Console の起動がタイムアウトしました。起動ログを確認してください。',504)),timeout);
    child.on('message',message);child.once('error',failed);child.once('exit',exited);
   });
   if(child.connected)child.disconnect();child.unref();
  }catch(error){if(child?.connected)child.disconnect();child?.kill();throw error.status?error:fail('Console の起動に失敗しました。セットアップを確認してください。',503);}
  finally{await output.close();}
  return {受付:true,通知:'',ログ:logPath};
 }
 return {catalog,launch};
}
