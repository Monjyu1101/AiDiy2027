// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn,execFile} from 'node:child_process';
import {stat,realpath,readdir,mkdir,open,readFile} from 'node:fs/promises';
import {join,dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {readConfig,configured} from '../runtime/model_probe.mjs';
import {catalog as programCatalog,resolveProgram} from '../診断/probes.mjs';
import {createPortStatusChecker} from './ポート状態.mjs';
import {createWebBrowserOpener} from './Webブラウザ.mjs';
import {createTaskTeamStatus} from './TaskTeam接続.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const アプリ一覧=Object.freeze(['avatar','task','team','ide','navi','console','code','live','discord','slack','chrome','browser'].map(id=>Object.freeze({id,名前:({avatar:'Avatar',task:'Task',team:'Team',ide:'IDE',navi:'Navigator',console:'Console',code:'Code',live:'Live',discord:'Discord',slack:'Slack',chrome:'Chrome',browser:'aidiy_browser'})[id],単一起動:['avatar','live','discord','slack'].includes(id)})));
const execute=(command,args,options={})=>new Promise((resolve,reject)=>execFile(command,args,{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:8*1024*1024,...options},(error,stdout)=>error?reject(error):resolve(stdout)));

// 明示起動時だけ取得する。タスクのコマンドラインや一覧を画面・ログへ返さない。
export async function タスク一覧(platform=process.platform){
 if(platform==='win32'){
  const script="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|electron|python(?:w|3(?:\\.\\d+)?)?)\\.exe$' } | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress";
  const values=JSON.parse((await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script])).trim()||'[]');
  return (Array.isArray(values)?values:[values]).map(item=>({pid:item.ProcessId,command:item.CommandLine||''}));
 }
 const output=await execute('ps',['-ax','-o','pid=,args=']);
 return output.split('\n').flatMap(line=>{const match=line.match(/^\s*(\d+)\s+(.+)$/);return match?[{pid:Number(match[1]),command:match[2]}]:[];});
}
export function アプリタスク(id,{command=''}){
 const text=command.replaceAll('\\','/');
 // 実行入口に限定。引用された文章やテストの検索語を起動済みと誤認しない。
 if(/(?:^|\s)(?:--eval|-e|--test)(?:\s|$)/.test(text))return false;
 const entry=path=>new RegExp('(?:^|[\\s"\'])[^\\s"\']*'+path+'(?=[\\s"\']|$)','i').test(text);
 if(id==='avatar')return entry('frontend_avatar/(?:launch\\.mjs|_start\\.py|dist-electron/main\\.js)')||entry('frontend_avatar/node_modules/[^\\s"\']*electron[^\\s"\']*')&&/\s\.\s*$/.test(text);
 if(id==='live')return (entry('frontend_ide/desktop\\.cjs')||entry('frontend_ide/launch\\.mjs'))&&/--app(?:=|\s+)live(?:[\s"']|$)/.test(text)||entry('frontend_ide/(?:host/)?aidiy_live/(?:launch\\.mjs|desktop\\.cjs)');
 if(id==='discord')return entry('frontend_channels/discord/(?:panel/(?:desktop\\.cjs|launch\\.mjs)|src/(?:web-server|panel-worker|main)\\.ts)');
 if(id==='slack')return entry('frontend_channels/slack/(?:panel/(?:desktop\\.cjs|launch\\.mjs)|src/(?:web-server|panel-worker|main)\\.ts)');
 return false;
}
// 導入タブと同じ Chrome 定義を使う。実行ファイルのパスは公開しない。
export async function isChromeInstalled({resolveFn=resolveProgram}={}){
 try{return Boolean(await resolveFn((await programCatalog()).find(item=>item.id==='chrome')));}catch{return false;}
}
export function createAppLauncher({root=ROOT,spawnFn=spawn,tasks=タスク一覧,node=process.execPath,pythonCommand,taskTeamStatus,chromeInstalled=isChromeInstalled,portStatusFn=createPortStatusChecker(),webBrowserOpenFn=createWebBrowserOpener({portStatusFn})}={}){
 const pending=new Set();
 const slackEntry=join(root,'frontend_channels','slack','panel','launch.mjs');
 async function slackAvailability(){try{if((await stat(slackEntry)).isFile())return {利用可能:true,無効理由:'',無効表示:''};}catch{}return {利用可能:false,無効理由:'Slack の起動ファイルが見つかりません。セットアップを確認してください。',無効表示:'未導入'};}
 const checkTaskTeam=taskTeamStatus||createTaskTeamStatus({root});
 const taskTeam=id=>id==='task'||id==='team';
 const availability=async()=>{try{return await checkTaskTeam();}catch{return {利用可能:false,無効理由:'Task / Team バックエンドを確認できません。'};}};
 async function browserAvailability(){try{const ports=await portStatusFn();if(ports.対象.some(item=>item.id==='tools'&&item.開放===true))return {利用可能:true,無効理由:''};}catch{}return {利用可能:false,無効理由:'Tools / MCP が稼働中の場合だけ開けます。'};}
 async function catalog(){
  const state=await availability(),browserState=await browserAvailability(),slackState=await slackAvailability();
  let chromeState={利用可能:false,無効理由:'Tools / MCP と Web が両方とも稼働中の場合だけ開けます。'};
  try{const ports=await portStatusFn();if(['tools','web'].every(id=>ports.対象.some(item=>item.id===id&&item.開放===true)))chromeState={利用可能:true,無効理由:''};}catch{}
  const [,config]=await readConfig(()=>readFile(join(root,'_config','AiDiy_key.json'),'utf8'));
  let showChrome=false;try{showChrome=await chromeInstalled()===true;}catch{}
  const project=config.CODE_BASE_PATH;
  // 設定全体やキーは公開せず、明示されたプロジェクトだけを初期値として渡す。
  const フォルダ=typeof project==='string'?project:'';
  const normalized=フォルダ.trim().replaceAll('\\','/');
  // 表示は設定値そのまま。起動引数だけAIコアと同じbackend_server基準で解決する。
  // 空欄・制御文字・ドライブ相対値から別のフォルダを補完しない。
  const 起動フォルダ=!normalized||フォルダ.length>4096||/[\u0000-\u001f\u007f]/.test(フォルダ)||(/^[a-z]:/i.test(normalized)&&!isAbsolute(normalized))?'':resolve(root,'backend_server',normalized);
  // Discord / Slack は先頭の Bot キーだけで表示を判断する。ID・接続成功は条件にしない。
  // 判定はサーバー内で完結し、設定値やキーをランチャーへ渡さない。
  // Chrome は導入タブと同じ実行ファイル探索のみ。起動やバージョン確認はしない。
  const visibleApps=アプリ一覧.filter(app=>app.id==='chrome'?showChrome:!['discord','slack'].includes(app.id)||configured(config[`${app.id}_bot_token`],app.id));
  return {対象:visibleApps.map(app=>taskTeam(app.id)?{...app,...state}:app.id==='slack'?{...app,...slackState}:app.id==='chrome'?{...app,...chromeState}:app.id==='browser'?{...app,...browserState}:app),フォルダ,起動フォルダ};
 }
 async function folder(value){
  if(typeof value!=='string'||!value.trim()||value.length>4096||value.includes('\0')||!isAbsolute(value))throw fail('プロジェクトフォルダを選択してください。');
  try{const path=await realpath(value);if(!(await stat(path)).isDirectory())throw Error();return path;}catch{throw fail('フォルダが見つからないか、アクセスできません。');}
 }
 async function folders(value){
  const path=await folder(value||root);
  try{return {フォルダ:path,親:dirname(path),子フォルダ:(await readdir(path,{withFileTypes:true})).filter(item=>item.isDirectory()).map(item=>({名前:item.name,パス:join(path,item.name)})).sort((a,b)=>a.名前.localeCompare(b.名前,'ja'))};}
  catch{throw fail('このフォルダの一覧を取得できません。');}
 }
 async function python(){
  if(pythonCommand)return [pythonCommand,[]];
  for(const [cmd,args] of [[process.env.DIAG_START_PYTHON||'python',[]],['python3',[]],['py',['-3']]]){
   try{if(/^Python 3\./.test((await execute(cmd,[...args,'--version'])).trim()))return [cmd,args];}catch{}
  }throw fail('Python 3 が見つかりません。',503);
 }
 async function launch(id,project){
  const app=アプリ一覧.find(item=>item.id===id);if(!app)throw fail('起動対象が不正です。');
  if(id==='chrome'){const result=await webBrowserOpenFn();return {受付:true,通知:result.メッセージ,URL:result.URL};}
  const path=await folder(project); // Avatarも未選択では起動不可。
  if(pending.has(id))throw fail('このアプリの起動処理中です。',409);
  pending.add(id);
  try{
   if(id==='slack'){const state=await slackAvailability();if(!state.利用可能)throw fail(state.無効理由,503);}
   if(id==='browser'){const state=await browserAvailability();if(!state.利用可能)throw fail(state.無効理由,409);}
   if(taskTeam(id)){const state=await availability();if(state.利用可能!==true)throw fail(state.無効理由||'Task / Team バックエンドを起動してください。',409);}
   if(app.単一起動){
    let running;try{running=(await tasks()).some(task=>アプリタスク(id,task));}catch{throw fail('起動中のタスクを確認できませんでした。もう一度お試しください。',503);}
    if(running)return {起動済み:true,通知:`${app.名前} は起動済みです。`};
   }
   let command=node,args,cwd=path;
   if(id==='avatar'){args=[join(root,'frontend_avatar','launch.mjs')];cwd=root;}
   else if(id==='discord')args=[join(root,'frontend_channels','discord','panel','launch.mjs'),'--project',path];
   else if(id==='slack')args=[slackEntry,'--project',path];
   else args=[join(root,'frontend_ide','launch.mjs'),'--app',id,'--project',path,...(id==='live'?[]:['--new-window'])];
   const env={...process.env,PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1'};
   for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH|AIDIY_(?:DIAG_LAUNCHER_CHILD|LAUNCHER_CHILD|DIAG_SETTINGS|DIAG_RUN))$/i.test(key))delete env[key];
   const logs=join(root,'temp','aidiy_diag','アプリ起動');await mkdir(logs,{recursive:true});
   const logPath=join(logs,`${id}-${randomUUID()}.log`),output=await open(logPath,'a',0o600);
   let child;
   try{
    child=spawnFn(command,args,{cwd,env,detached:true,windowsHide:true,shell:false,stdio:['ignore',output.fd,output.fd]});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();
   }catch{throw fail(`起動できませんでした。${app.名前} のセットアップを確認してください。`,503);}
   finally{await output.close();}
   // Diagの終了・システム停止に紐付けない。起動完了後の定時監視も行わない。
   return {受付:true,通知:`${app.名前} の起動を要求しました。`,ログ:logPath};
  }finally{pending.delete(id);}
 }
 return {catalog,folders,launch};
}
