// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { spawn } from 'node:child_process';
import { existsSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { startDevelopment } from './server.mjs';
import { cliTitleName } from './src/components/コンソール/CLIタイトル.js';
import { validateCliOptions, resolveCliLaunch } from './aidiy_console/cli-launch.mjs';
import { createCliOwnerLifetime } from './aidiy_console/cli-session.mjs';
import { projectFolder,useBrowser,electronExecutable } from './viewer/launch-options.mjs';
import { ブラウザで開く, ウィンドウ } from './host/scripts/launch-project.mjs';
import { spawnDesktop } from './デスクトップ/desktop-process.mjs';
import projectProfiles from './デスクトップ/project-profile.cjs';
const {projectIdentity}=projectProfiles;
// サーバーとElectronは別のNodeプロセスに所有させ、表示完了後に呼出元へ戻る。
async function launchDetached(defaultKind,args){
 const label=defaultKind==='navi'?'Navi':defaultKind==='ide'?'IDE':defaultKind==='live'?'Live':defaultKind==='console'?'Console':defaultKind==='task'?'Task':defaultKind==='team'?'Team':defaultKind==='browser'?'Browser':'Code';
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--app',defaultKind,'--foreground',...args],{cwd:process.cwd(),env:{...process.env,AIDIY_LAUNCHER_CHILD:'1'},detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
 try{
  const result=await new Promise((done,reject)=>{
   const timer=setTimeout(()=>finish(Error(`${label}の起動がタイムアウトしました。`)),30000);
   const finish=(error,value)=>{clearTimeout(timer);child.off('message',message);child.off('exit',exit);child.off('error',failure);error?reject(error):done(value);};
   const message=value=>{if(value?.launchReady)finish(null,value);else if(value?.launchError)finish(Error(value.launchError));};
   const exit=code=>finish(Error(`${label}を起動できませんでした（終了コード: ${code}）。`));
   const failure=error=>finish(error);
   child.on('message',message);child.once('exit',exit);child.once('error',failure);
  });
  if(child.connected)child.disconnect();child.unref();
  console.log(result.existingWindow?`起動済みの${label}画面を前面に表示しました。`:`AiDiy ${label}を起動しました。`);
  return result;
 }catch(error){if(child.connected)child.disconnect();child.kill();throw error;}
}
export async function launch(defaultKind='ide',args=process.argv.slice(2)){
 const {values,positionals}=parseArgs({args,allowPositionals:true,options:{app:{type:'string'},project:{type:'string'},'project-fixed':{type:'boolean'},provider:{type:'string'},model:{type:'string'},cli:{type:'string'},'cli-auto-approve':{type:'boolean'},port:{type:'string'},'strict-port':{type:'boolean'},browser:{type:'boolean'},'no-open':{type:'boolean'},offline:{type:'boolean'},connect:{type:'boolean'},foreground:{type:'boolean'},serve:{type:'boolean'},wait:{type:'boolean'},'ready-file':{type:'string'},'new-window':{type:'boolean'},help:{type:'boolean'}}});
 const kind=values.app||defaultKind;
 if(values['project-fixed']&&!['task','team'].includes(kind))throw Error('--project-fixed はTask / Team専用です。');
 if(!['code','live','ide','console','task','team','browser','navi'].includes(kind))throw Error('--app はcode / live / ide / console / task / team / browser / naviから指定してください。');
 if(values.help&&kind==='browser'){console.log('aidiy_browser [作業フォルダ | --project 作業フォルダ] [--port 番号] [--strict-port] [--new-window] [--foreground | --wait]');console.log('IDE共通のBrowserをElectronで単独起動します。tools接続時にchrome_devtoolsから操作できます。Web版への切り替えは行いません。');return;}
 if(values.help){console.log(`aidiy_${kind} [作業フォルダ | --project 作業フォルダ] [--browser] [--no-open] [--port 番号] [--strict-port]${['task','team','navi'].includes(kind)?'':' [--provider 名前] [--model モデル]'}${kind==='code'?' [--offline]':''}${kind==='live'?'':' [--new-window]'}${kind==='console'?' [--cli 名前] [--cli-auto-approve]':''} [--foreground | --wait]`);console.log('起動フォルダをプロジェクトにしてElectronで開きます。Codespaces等ではWeb版。ポートは自動割り当て。');console.log('単独ウィンドウの表示後はプロンプトへ戻ります。--foreground / --wait で終了まで待機します。');return;}
 if(kind==='browser'&&['browser','no-open','serve','offline','connect','provider','model','cli','cli-auto-approve'].some(name=>values[name]!==undefined))throw Error('BrowserはElectron専用です。Web起動・AIモデル・CLIのオプションは利用できません。');
 if(['task','team','navi'].includes(kind)&&['provider','model','offline','connect'].some(name=>values[name]!==undefined))throw Error('Task / Team のモデル・接続設定は画面内で指定してください（--provider / --model / --offline / --connect は利用できません）。');
 validateCliOptions(kind,{cli:values.cli,cliAutoApprove:values['cli-auto-approve'],provider:values.provider,model:values.model});
 const cliLaunch=values.cli?await resolveCliLaunch(values.cli,{autoApprove:!!values['cli-auto-approve']}):undefined;
 const requestedProject=projectFolder(positionals,values.project);
 const project=['ide','task','team'].includes(kind)?projectIdentity(requestedProject).path:requestedProject,port=values.port===undefined?0:Number(values.port);
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('--port は0〜65535で指定してください。');
 if(values.offline&&['live','task','team'].includes(kind))throw Error(`${kind}はAiDiy接続が必要です。`);
 let provider=values.provider?.trim(),model=values.model?.trim();
 if(values.provider!==undefined&&!provider||values.model!==undefined&&!model)throw Error('Provider / モデルに値を指定してください。');
 if(kind==='live'){
  const aliases={freeai:'freeai_live',gemini:'gemini_live',openai:'openai_live',freeai_live:'freeai_live',gemini_live:'gemini_live',openai_live:'openai_live'};
  if(provider&&!aliases[provider])throw Error('LiveのProviderはfreeai / gemini / openaiを指定してください。');provider=aliases[provider];
  if(model&&!provider)throw Error('Liveの--modelには--providerも指定してください。');
 }
 if(!existsSync(fileURLToPath(new URL(['task','team'].includes(kind)?'./dist/taskteam.js':'./dist/app.js',import.meta.url))))throw Error('Vue画面を準備してください: python frontend_ide/_setup.py');
 if(!values.foreground&&!values.wait&&!values.serve&&!values['no-open']&&!values.browser&&(kind==='browser'||!useBrowser()))return launchDetached(kind,args);
 let app,desktop,lifetime,stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;lifetime?.dispose();if(desktop?.connected)desktop.disconnect();await app?.close();};
 if(values.cli)lifetime=createCliOwnerLifetime(stop);
 app=await startDevelopment(project,{kind,projectFixed:!!values['project-fixed'],port,strict:values['strict-port'],offline:values.offline,provider,model,cli:values.cli,cliAutoApprove:values['cli-auto-approve'],autoConnect:values.connect,onCliStarted:()=>lifetime?.started(),onCliAbandoned:stop});
 const launcherChild=process.env.AIDIY_LAUNCHER_CHILD==='1'&&!!process.send;
 if(launcherChild)process.once('disconnect',stop);
 const notifyReady=message=>{if(launcherChild){process.removeListener('disconnect',stop);process.send?.({launchReady:true,...message});}};
 process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
 const ready={url:app.url,publicUrl:app.publicUrl,pid:process.pid,kind,project};
 const publishReady=async(browser=false)=>{
  try{if(values['ready-file'])writeFileSync(resolve(values['ready-file']),JSON.stringify(ready),'utf8');}catch(error){await stop();throw error;}
  const label=kind==='navi'?'Navi':kind==='ide'?'IDE':kind[0].toUpperCase()+kind.slice(1);
  console.log(browser?`AiDiy ${label}: ${app.publicUrl}`:`AiDiy ${label}を起動しました。`);
  if(browser&&kind!=='code')console.log(`プロジェクト: ${project}`);
 };
 if(values['no-open']||values.serve){await publishReady(true);return app;}
 let browser=kind!=='browser'&&(values.browser||useBrowser());
 if(!browser){
  try{
   const env={...process.env,AIDIY_DEVELOPMENT_URL:app.url,AIDIY_DEVELOPMENT_KIND:kind,AIDIY_DEVELOPMENT_PROJECT:project,AIDIY_DEVELOPMENT_PROJECT_FIXED:values['project-fixed']?'1':'0',AIDIY_DEVELOPMENT_CLI_WINDOW:values.cli?'1':'0',AIDIY_DEVELOPMENT_CLI_NAME:cliTitleName(cliLaunch),AIDIY_DEVELOPMENT_NEW_WINDOW:values['new-window']&&kind!=='live'?'1':'0'};delete env.ELECTRON_RUN_AS_NODE;
   let executable;try{executable=electronExecutable();}catch{executable=electronExecutable(new URL('./host/package.json',import.meta.url));}
   desktop=spawnDesktop(executable,[fileURLToPath(new URL('./desktop.cjs',import.meta.url)),'--app',kind],{cwd:project,env,background:launcherChild});
   const shown=await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('Electronの表示がタイムアウトしました。')),20000);desktop.once('error',error=>{clearTimeout(timer);reject(error);});desktop.once('exit',code=>{clearTimeout(timer);reject(Error(`Electron終了: ${code}`));});desktop.on('message',message=>{if(message?.windowShown===true||message?.existingWindow===true){clearTimeout(timer);done(message);}});});
   if(shown.existingWindow){await stop();notifyReady({existingWindow:true});console.log('起動済みの画面を前面に表示しました。');return;}
   desktop.once('exit',code=>{if(code)process.exitCode=code;void stop();});
  }catch(error){if(launcherChild||kind==='browser'){if(desktop?.connected)desktop.disconnect();desktop?.kill();await stop();throw error;}console.warn(error.message+' Web版へ切り替えます。');if(desktop?.connected)desktop.disconnect();desktop?.kill();desktop=undefined;browser=true;}
 }
 await publishReady(browser);
 if(browser){
  const opened=await ブラウザで開く(app.publicUrl,{ローカルURL:app.url,height:kind==='navi'?ウィンドウ.ナビ高さ:undefined});
  if(values.cli&&!opened){await stop();throw Error('CLI用のConsole画面をブラウザで開けませんでした。既定ブラウザまたはElectronのセットアップを確認して、もう一度起動してください。');}
 }
 lifetime?.arm();
 notifyReady(ready);
 return app;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)launch().catch(error=>{console.error(error.message);process.exitCode=1;if(process.env.AIDIY_LAUNCHER_CHILD==='1'&&process.connected)process.send({launchError:error.message},()=>process.disconnect());});
