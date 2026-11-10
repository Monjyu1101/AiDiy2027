// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { startServer } from './viewer/server.mjs';
import { createCoreConnection, coreTarget } from './viewer/core-connection.mjs';
import { createTaskTeamProxy } from './タスクチーム/api-proxy.mjs';
import { createPanels } from './viewer/panels.mjs';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { basename,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reserveNavigationSlot } from './ファイル機能/navigation-slot.mjs';
import { createNavigationInstances } from './ファイル機能/navigation.mjs';
import { createNavigationSound } from './ファイル機能/navigation-sound.mjs';
import { createAISearch } from './ファイル機能/ai-search.mjs';
import { createFileAnalysis } from './ファイル機能/file-analysis.mjs';
import { createBrowserAnalysis } from './ファイル機能/browser-analysis.mjs';
import { normalizeDisplayUrls, isPageSource } from './viewer/表示URL.mjs';
import { startConsole } from './aidiy_console/console.mjs';
import { cliTitleName } from './src/components/コンソール/CLIタイトル.js';
import { validateCliOptions, resolveCliLaunch } from './aidiy_console/cli-launch.mjs';
import { createFileHistory } from './ファイル機能/file-history.mjs';
import { catppuccinAsset } from './src/components/ファイル閲覧/ファイルアイコン.js';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('.',import.meta.url)),vscodeRoot=fileURLToPath(new URL('./host/',import.meta.url));
export async function startDevelopment(project,{kind='ide',linked=false,projectFixed=false,port=0,strict=false,offline=false,provider,model,cli,cliAutoApprove=false,onCliStarted,onCliAbandoned,autoConnect=false,env=process.env,connection,aiSearchOptions,navigationOptions,fileAnalysisOptions,browserAnalysisOptions,explorerOptions}={}){
 if(!['code','live','ide','console','task','team','browser','navi'].includes(kind))throw Error('アプリはcode / live / ide / console / task / team / browser / naviから指定してください。');
 validateCliOptions(kind,{cli,cliAutoApprove,provider,model});
 const cliLaunch=cli?await resolveCliLaunch(cli,{autoApprove:cliAutoApprove,env}):undefined;
 project=require('./host/scripts/project-storage.cjs').projectRoot(project,fileURLToPath(new URL('../',import.meta.url)));
 const taskTeam=['task','team'].includes(kind);
 if(projectFixed){if(!taskTeam)throw Error('プロジェクト固定はTask / Team専用です。');project=require('./デスクトップ/project-profile.cjs').projectIdentity(project).path;}
 const taskTeamProxy=taskTeam?createTaskTeamProxy(root,project,{projectFixed}):undefined;
 const backend=coreTarget(root,project);
 const standalone={active:true,mode:offline?'offline':'online',connected:false,startedAt:Date.now(),backend,project:{name:basename(project),path:project}};
 connection??=['ide','browser','navi'].includes(kind)?createCoreConnection(project,{keepActive:kind!=='ide'}):{state:()=>standalone,close(){standalone.active=false;},connect:async()=>standalone,disconnect:()=>standalone,offline:()=>standalone};
 if(['browser','navi'].includes(kind)&&!offline)void connection.connect();
 if(['browser','navi'].includes(kind)&&offline)connection.offline();
 const files={'/':[taskTeam?'taskteam.html':'index.html','text/html; charset=utf-8'],'/development/app.js':['app.js','text/javascript; charset=utf-8'],'/development/app.css':['app.css','text/css; charset=utf-8'],'/development/AiDiy.png':['AiDiy.png','image/png'],'/development/sending.png':['sending.png','image/png'],'/development/abort.png':['abort.png','image/png'],'/development/speaker.png':['speaker.png','image/png'],'/development/microphone.png':['microphone.png','image/png'],'/development/THIRD_PARTY_NOTICES.txt':['THIRD_PARTY_NOTICES.txt','text/plain; charset=utf-8'],'/development/LICENSE':['LICENSE','text/plain; charset=utf-8']};
 files['/development/taskteam.js']=['taskteam.js','text/javascript; charset=utf-8'];
 files['/development/taskteam.css']=['taskteam.css','text/css; charset=utf-8'];
 const aiSearch=createAISearch(project,{...aiSearchOptions,state:connection.state});
 let navigationSlot, panels;
 const navigation=createNavigationInstances(project,{...navigationOptions,instancePrefix:kind==='navi'?'standalone-':'',state:connection.state});
 const navigationSound=createNavigationSound(project,{...navigationOptions?.sound,state:connection.state});
 const fileAnalysis=createFileAnalysis(project,{...fileAnalysisOptions,state:connection.state});
 const browserAnalysis=createBrowserAnalysis(project,{...browserAnalysisOptions,state:connection.state});
 const fileHistory=createFileHistory(project,{state:connection.state});
 const app=await startServer(project,port,{strict,env,connection,explorerOptions,
  requestHandler:async(req,res,url)=>{
   // Browser単独画面にはページ解析だけを公開し、一般のプロジェクト操作・Console APIは公開しない。
   if(kind==='browser'&&url.pathname.startsWith('/api/')&&!['/api/connection','/api/browser-analysis'].includes(url.pathname)){res.writeHead(url.pathname.startsWith('/api/connection/')?405:404).end();return true;}
   if(kind==='navi'&&url.pathname.startsWith('/api/')&&!['/api/navigation','/api/navigation/code','/api/navigation/sound','/api/connection'].includes(url.pathname)){res.writeHead(404).end();return true;}
   if (['ide','navi'].includes(kind) && url.pathname === '/api/navigation/code') {
    const reply=(status,data)=>res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(data));
    const instance=url.searchParams.get('instance'), snapshot=connection.state();
    req.resume();
    if (!['POST','DELETE'].includes(req.method)) { reply(405,{error:'POST / DELETE required'});return true; }
    if (!instance || !/^navi-[1-9][0-9]{0,5}$/.test(instance) || (kind==='navi' && instance!==navigationSlot?.instance)) { reply(400,{error:'Navi IDが不正です。'});return true; }
    if (!snapshot.active || url.searchParams.get('session')!==String(snapshot.startedAt)) { reply(409,{error:'利用セッションが変わりました。'});return true; }
    try {
     if (req.method==='DELETE') { await panels.release('code',instance);reply(200,{}); }
     else reply(200,{url:await panels.open('code',instance)});
    } catch(error) { reply(400,{error:error.message}); }
    return true;
   }
   if(taskTeamProxy && await taskTeamProxy.handle(req,res,url))return true;
   if(['ide','navi'].includes(kind)&&await navigationSound.handle(req,res,url))return true;
   if(['ide','navi'].includes(kind)&&await navigation.handle(req,res,url))return true;
   if(kind==='ide'&&await aiSearch.handle(req,res,url))return true;
   if(['ide','browser'].includes(kind)&&await browserAnalysis.handle(req,res,url))return true;
   // 保存した画面URLを優先する。HTML/Vueは未解析・URL不明なら従来表示、JS等は根拠のある保存URLだけを使う。
   if(kind==='ide'&&req.method==='GET'&&url.pathname==='/api/preview'&&isPageSource(url.searchParams.get('path'))){
    try{
     const saved=await fileAnalysis.get(url.searchParams.get('path'));
     const routes=normalizeDisplayUrls(saved.result?.displayUrls,{limit:60}).map(item=>({path:item.label||item.url,url:item.url,...(item.reason?{reason:item.reason}:{})}));
     if(routes.length){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify({kind:'analysis',routes,stale:saved.stale,reason:saved.result.displayUrlReason||''}));return true;}
     if(!/\.(html?|vue)$/i.test(saved.path)){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify({kind:'analysis',routes:[],error:saved.result?.displayUrlReason||'表示URLがありません。AI解析で、このソースを使用する画面を調べてください。'}));return true;}
    }catch{/* 解析記録が読めなくても、従来のファイル検証・表示は維持する。 */}
   }
   if(kind==='ide'&&await fileAnalysis.handle(req,res,url))return true;
   if(kind==='ide'&&await fileHistory.handle(req,res,url))return true;
   if(url.pathname==='/development/config'){
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({kind,linked,host:false,project:standalone.project,navigationInstance:navigationSlot?.instance,...(cliLaunch?{cliName:cliTitleName(cliLaunch)}:{}),...(taskTeam?{taskTeamBase:'/taskteam-api',projectFixed,fixedProject:projectFixed?project:undefined}:{}),icon:'/development/AiDiy.png'}));return true;
   }
   const iconAsset=url.pathname.startsWith('/development/')?catppuccinAsset(url.pathname.slice('/development/'.length)):undefined;
   const asset=Object.hasOwn(files,url.pathname)?files[url.pathname]:iconAsset;if(!asset){if(taskTeam){res.writeHead(404).end();return true;}return false;}
   if(req.method!=='GET'){res.writeHead(405).end();return true;}
   const content=await readFile(join(root,'dist',asset[0]));
   res.writeHead(200,{'content-type':asset[1],'cache-control':'no-store','x-content-type-options':'nosniff',...(iconAsset?{'content-security-policy':"default-src 'none'; sandbox"}:{})}).end(content);return true;
  },
  panelsFactory:(project,state)=>(panels=createPanels(project,state,async(type,folder,snapshot,{instance}={})=>{
   if(kind!=='ide'&&type!==kind&&!(kind==='navi'&&type==='code'&&instance))throw Error('このアプリでは利用できません。');
   if(type==='console')return startConsole(folder,{env,cli,cliAutoApprove,onCliStarted,onCliAbandoned});
   const bundle=require(join(vscodeRoot,'dist',`aidiy_${type}`,'server.cjs'));
   if(type==='code')return bundle.単独起動(folder,backend,{offline:snapshot.mode==='offline',lockedMode:kind==='ide'||kind==='navi'||linked,keepAlive:true,provider,model});
   const vendor=provider==='openai_live'?'OPENAI':provider==='freeai_live'?'FREEAI':'GEMINI';
   const settings={...(provider?{LIVE_AI_NAME:provider}:{}),...(model?{[`LIVE_${vendor}_MODEL`]:model}:{})};
   return bundle.ライブ起動(vscodeRoot,backend,false,folder,settings,undefined,autoConnect);
  }))
 });
 if(kind==='navi'){try{navigationSlot=await reserveNavigationSlot(project);}catch(error){await app.close();throw error;}}
 app.server.once('close',()=>{void navigationSlot?.close();taskTeamProxy?.close();aiSearch.close();navigation.close();fileAnalysis.close();browserAnalysis.close();});
 const close=app.close;app.close=async()=>{await navigationSlot?.close();taskTeamProxy?.close();aiSearch.close();navigation.close();fileAnalysis.close();browserAnalysis.close();await close();};
 return app;
}
