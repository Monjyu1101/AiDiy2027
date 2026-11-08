// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {app,BrowserWindow,WebContentsView,ipcMain,shell,clipboard,session,screen,dialog,Menu}=require('electron');
const {join,resolve}=require('node:path');
const {projectRoot,programDataDirectory}=require('./host/scripts/project-storage.cjs');
const {mkdirSync,mkdtempSync,rmSync}=require('node:fs');
const {projectProfile}=require('./デスクトップ/project-profile.cjs');
const {taskTeamProfile}=require('./デスクトップ/タスクチーム起動.cjs');
const projectFixed=process.env.AIDIY_DEVELOPMENT_PROJECT_FIXED==='1';
const url=process.env.AIDIY_DEVELOPMENT_URL,kind=process.env.AIDIY_DEVELOPMENT_KIND;
if(!url||!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url)||!['code','live','ide','console','task','team','browser','navi'].includes(kind))throw Error('起動元が不正です。');
const cliConsoleWindow=kind==='console'&&process.env.AIDIY_DEVELOPMENT_CLI_WINDOW==='1';
const appName=`AiDiy ${kind==='navi'?'Navigator':kind==='ide'?'IDE':kind==='code'?'Code':kind==='live'?'Live':kind==='task'?'Task':kind==='team'?'Team':kind==='browser'?'Browser':'Console'}`;
app.setName(process.platform==='darwin'?appName:`aidiy_${kind}`);
// ランチャーが引数を解決したプロジェクトで、ロック取得より先にIDEのプロファイルを分ける。
const project=projectRoot(process.env.AIDIY_DEVELOPMENT_PROJECT??'',resolve(__dirname,'..'));
const profile=kind==='ide'?projectProfile(undefined,project):['task','team'].includes(kind)?taskTeamProfile(undefined,kind,project,projectFixed):join(programDataDirectory(project,`aidiy_${kind}`),'electron');
mkdirSync(profile,{recursive:true,mode:0o700});
app.setPath('userData',profile);
app.setPath('sessionData',profile);
const independent=kind==='console'||kind==='browser'||!['live','task','team'].includes(kind)&&process.env.AIDIY_DEVELOPMENT_NEW_WINDOW==='1';
if(independent){
 const temporaryProfile=mkdtempSync(join(profile,'window-'));
 app.setPath('userData',temporaryProfile);
 app.setPath('sessionData',temporaryProfile);
 app.on('quit',()=>{try{rmSync(temporaryProfile,{recursive:true,force:true,maxRetries:2,retryDelay:100});}catch{}});
}
const {windowBounds,windowMinimumSize,allWindowBounds}=require('./デスクトップ/window-layout.cjs');
const {createTaskWindows,taskWindowBounds}=require('./デスクトップ/task-windows.cjs');
const {reserveConsoleSlot}=require('./デスクトップ/console-window-slot.cjs');
const {拡大表示}=require('./host/scripts/window-opening.cjs');
// 同じプログラム・プロジェクトだけ既存窓へ戻す。Console / Browserは複数起動する。
if(!independent&&!app.requestSingleInstanceLock()){
 if(process.send)process.send({existingWindow:true},()=>app.exit(0));else app.exit(0);
 return;
}
const windows=new Map(),closing=new Set(),closedServers=new WeakSet();
const taskWindows=createTaskWindows({authenticated:projectFixed,owns:record=>!record.owner,records:windows,trustedEvent,focusWindow,isQuitting:()=>quitting,onLastClosed:()=>app.quit(),createWindow:(view,payload)=>createWindow('task',url+'#task-view='+view,undefined,undefined,undefined,undefined,undefined,undefined,{view,payload})});
const {createWindowPins}=require('./デスクトップ/最前面ピン.cjs');
const windowPins=createWindowPins({onChanged(window,state){
 const record=windows.get(window.webContents);if(!record)return;
 // DOMを親から移した別窓の操作も、所有するIDEのpreloadだけを通す。
 const receiver=record.name?record.owner:record;
 if(receiver&&!receiver.window.isDestroyed()&&!receiver.window.webContents.isDestroyed?.())receiver.window.webContents.send('development:pin-changed',{...state,...(record.name?{panelName:record.name}:{})});
}});
function registerWindowPin(record){
 windowPins.register(record.window,{pinned:!!record.owner||(projectFixed&&['task','team'].includes(record.kind)),locked:!!record.owner&&allDisplays.isActive(record.owner)});
 vrPanelStacking.register(record);
}
const {createDraftRouter}=require('./デスクトップ/draft-router.cjs');
const {readDevelopmentState}=require('./デスクトップ/desktop-session.cjs');
const draftRouter=createDraftRouter({records:windows,readState,sessionKey:state=>sessionKey(state),focusWindow,isQuitting:()=>quitting});
const {createSharedDraftBridge}=require('./デスクトップ/下書き共有.cjs');
let sharedDraftBridge;
const sharedDrafts=()=>sharedDraftBridge??=createSharedDraftBridge({directory:join(app.getPath('temp'),'aidiy-draft-links'),records:windows,router:draftRouter,readState,sessionKey:state=>sessionKey(state)});
app.on('quit',()=>{void sharedDraftBridge?.then(bridge=>bridge.close(),()=>{});});
const {createNativePreviewActions}=require('./デスクトップ/native-preview-actions.cjs');
const nativePreviewActions=createNativePreviewActions({records:windows,trustedEvent,readState,sessionKey:state=>sessionKey(state),clipboard,shell,dialog,isQuitting:()=>quitting});
let quitting=false,forcedQuit=false;
function closeApplication(){
 if(kind==='task'){
  const peers=[...windows.values()].filter(record=>record.kind==='task'&&['request','flow','detail'].includes(record.taskView)&&!record.window.isDestroyed());
  if(peers.length){for(const record of peers)record.window.close();}else app.quit();
  return;
 }
 const main=[...windows.values()].find(record=>!record.owner&&!record.window.isDestroyed())?.window;
 if(main)main.close();else app.quit();
}
const {panelBounds,createPanelWindows}=require('./デスクトップ/panel-windows.cjs');
const panelWindows=createPanelWindows({windows,trustedEvent,readState,sessionKey:state=>sessionKey(state),screen,BrowserWindow,拡大表示,isQuitting:()=>quitting,isAllDisplays:record=>allDisplays.state(record).active,attachWindowMove,registerWindowPin,windowPins});
const {createNavigationCodeWindow,createNavigationCruiseWindow,navigationWindowTitle}=require('./デスクトップ/navigation-code-window.cjs');
const navigationCodeWindow=createNavigationCodeWindow({trustedEvent,panelTarget:(owner,name)=>panelWindows.dragTarget(owner,name),readState,sessionKey:state=>sessionKey(state),screen,isQuitting:()=>quitting});
const navigationCruiseWindow=createNavigationCruiseWindow({trustedEvent,panelTarget:(owner,name)=>panelWindows.dragTarget(owner,name),readState,sessionKey:state=>sessionKey(state),isQuitting:()=>quitting});
const {createCodeDrag}=require('./デスクトップ/code-drag.cjs');
const codeDrag=createCodeDrag({trustedEvent,screen,resolvePanel:panelWindows.dragTarget,isCenterMove:record=>allDisplays.isActive(record)});
const {installNativeWindowMove}=require('./デスクトップ/長押し窓移動.cjs');
function attachWindowMove(record,contents){
 const stopMove=installNativeWindowMove({record,contents,drag:codeDrag,screen});
 const stopExit=allDisplays.attachExitKey(record,contents);
 return()=>{stopExit();stopMove();};
}
const {createAllDisplays}=require('./デスクトップ/全画面横断.cjs');
const {createVRPanelPlacement}=require('./デスクトップ/VRパネル配置.cjs');
const {createVRPanelStacking}=require('./デスクトップ/VRパネル前面.cjs');
const vrPanelStacking=createVRPanelStacking({windows,isActive:owner=>allDisplays.isActive(owner),isPinned:record=>windowPins.state(record.window).pinned});
const vrPanels=createVRPanelPlacement({windows,screen,isActive:owner=>allDisplays.isActive(owner)});
const allDisplays=createAllDisplays({screen,trustedEvent,panels:vrPanels,syncChildren:owner=>{
 const locked=allDisplays.isActive(owner);
 // Browser全画面とIDEのVRは独立したロック理由。片方の解除で他方を消さない。
 for(const record of windows.values())if((record===owner||record.owner===owner)&&!record.window.isDestroyed())windowPins.setLocked(record.window,locked||(record.kind==='browser'&&record.window.isFullScreen()));
 vrPanelStacking.refresh(owner);
}});
const {createBrowserViews,browserFileTarget,browserOpenable,browserStartupURL,HOME}=require('./デスクトップ/ブラウザ.cjs');
const {saveBrowserCapture}=require('./デスクトップ/ブラウザ撮影.cjs');
const {validPreviewPath}=require('./デスクトップ/native-preview-actions.cjs');
const {createBrowserSourceSelection,createBrowserAnalysisContext}=require('./デスクトップ/ブラウザ解析連携.cjs');
const selectBrowserSource=createBrowserSourceSelection({trustedEvent,readState,sessionKey:state=>sessionKey(state),connected:state=>browserConnected(state),context:record=>browserViews?.analysisContext(record),focusWindow,isQuitting:()=>quitting});
const browserAnalysisContext=createBrowserAnalysisContext({trustedEvent,context:record=>browserViews?.analysisContext(record),discover:async record=>(await sharedDrafts()).viewerStatus(record),isQuitting:()=>quitting});
let browserViews;
const browserBridges=new WeakMap();
let standaloneBrowserBridge;
const standaloneBrowsers=()=>[...windows.values()].filter(record=>record.kind==='browser'&&!record.owner&&!record.window.isDestroyed());
async function ensureStandaloneBrowserBridge(){
 if(standaloneBrowserBridge)return standaloneBrowserBridge;
 standaloneBrowserBridge=(async()=>{
  const {createBrowserCDP}=require('./デスクトップ/ブラウザCDP.cjs');
  const bridge=await createBrowserCDP({directory:process.env.AIDIY_BROWSER_SESSIONS_DIR||join(__dirname,'../backend_tools/temp/_ide_browser_sessions'),sessionPrefix:'aidiy_browser',
   canUse:async()=>{const record=standaloneBrowsers()[0];return !quitting&&!!record&&browserConnected(await readState(record));},
   allowedURL:target=>browserViews.allowedURL(target),
   openPanel:async target=>{
    const source=standaloneBrowsers()[0];if(quitting||!source||!browserConnected(await readState(source)))throw Error('tools接続中のみ起動できます。');
    const window=await createWindow('browser',url+'#browser',undefined,undefined,undefined,undefined,undefined,target);return windows.get(window.webContents);
   }});
  if(quitting||!standaloneBrowsers().length){bridge.close();throw Error('Browserの利用が終了しました。');}
  return bridge;
 })();
 try{return await standaloneBrowserBridge;}catch(error){standaloneBrowserBridge=undefined;throw error;}
}
async function checkStandaloneBrowser(record){
 if(record.checking||record.window.isDestroyed())return;record.checking=true;
 try{browserViews?.setAvailable(record,browserConnected(await readState(record)));}
 catch{browserViews?.setAvailable(record,false);}
 finally{record.checking=false;}
}
const browserConnected=state=>state.active&&state.mode==='online'&&state.connected===true;
async function ensureBrowserBridge(record){
 if(browserBridges.has(record))return browserBridges.get(record);
 const owner=record.owner,revision=owner.revision;
 const pending=(async()=>{
  const {createBrowserCDP}=require('./デスクトップ/ブラウザCDP.cjs');
  const bridge=await createBrowserCDP({directory:process.env.AIDIY_BROWSER_SESSIONS_DIR||join(__dirname,'../backend_tools/temp/_ide_browser_sessions'),
   canUse:async()=>{const state=await readState(owner);return !quitting&&!record.window.isDestroyed()&&!owner.window.isDestroyed()&&owner.revision===revision&&record.linkKey===sessionKey(state)&&browserConnected(state);},
   allowedURL:url=>browserViews.allowedURL(url),
   openPanel:async target=>{
    const state=await readState(owner);if(!browserConnected(state)||record.window.isDestroyed()||owner.window.isDestroyed()||owner.revision!==revision||record.linkKey!==sessionKey(state))throw Error('tools接続中のみ起動できます。');
    const window=await createWindow('browser',owner.url+'#browser',undefined,owner,sessionKey(state),undefined,undefined,target);return windows.get(window.webContents);
   }});
  if(record.window.isDestroyed()||owner.window.isDestroyed()||owner.revision!==revision){bridge.close();throw Error('IDEの利用が終了しました。');}
  record.window.once('closed',()=>bridge.close());return bridge;
 })();
 browserBridges.set(record,pending);
 try{return await pending;}catch(error){browserBridges.delete(record);throw error;}
}
function focusWindow(window){
 if(!window||window.isDestroyed())return;
 if(window.isMinimized())window.restore();window.show();window.focus();
}
app.on('second-instance',()=>focusWindow([...windows.values()].find(record=>!record.owner)?.window));
app.on('activate',()=>focusWindow([...windows.values()].find(record=>!record.owner)?.window));
function closeServer(server){
 if(!server||closedServers.has(server))return;closedServers.add(server);
 const pending=server.close().catch(error=>console.error(error));closing.add(pending);
 void pending.finally(()=>closing.delete(pending));
}
const sessionKey=state=>state.active?`${state.mode}:${state.startedAt}`:'';
async function readState(record){return readDevelopmentState(record);}
function closeChildren(owner){
 owner.revision++;draftRouter.invalidate(owner);
 for(const child of [...windows.values()])if(child.owner===owner&&!child.window.isDestroyed())child.window.destroy();
}
async function checkChildren(owner){
 if(owner.checking||owner.window.isDestroyed()||![...windows.values()].some(child=>child.owner===owner))return;
 owner.checking=true;const revision=owner.revision;
 try{
  const state=await readState(owner);
  if(owner.window.isDestroyed()||owner.revision!==revision)return;
  browserViews?.setAvailable(owner,browserConnected(state));
  if(!sessionKey(state)||[...windows.values()].some(child=>child.owner===owner&&child.linkKey!==sessionKey(state)))closeChildren(owner);
 }catch{ /* 一時的な通信断・不正応答は終了の根拠にせず、次回の監視で再確認する。 */ }finally{owner.checking=false;}
}
function trustedEvent(event){
 const record=windows.get(event.sender)||browserViews?.trustedHeader(event),frame=event.senderFrame;
 return record&&!record.window.isDestroyed()&&frame&&frame===event.sender.mainFrame&&typeof frame.url==='string'&&frame.url.split('#')[0]===record.url?record:null;
}
function audioAllowed(contents,permission,details){
 const record=windows.get(contents);
 return !!record&&record.kind==='live'&&permission==='media'&&details?.isMainFrame===true&&details.requestingUrl?.split('#')[0]===record.url;
}
function selectedAllDisplay(owner,displayId){
 if(displayId===undefined)return null;
 if(!owner||!allDisplays.state(owner).active||!Number.isInteger(displayId))throw Error('VRモードの表示状態が変わりました。');
 const display=screen.getAllDisplays().find(display=>display.id===displayId);
 if(!display)throw Error('選んだディスプレイが見つかりません。');
 return display;
}
async function createWindow(kind,url,server,owner,linkKey,anchor,displayId,browserTarget,taskOptions){
 // ピン留めのビューアは #viewer=ファイル で開く。照合・遷移の判定は # より前の URL で行う。
 const [base,hash='']=url.split('#');
 const viewerPath=kind==='viewer'&&hash.startsWith('viewer=')?decodeURIComponent(hash.slice('viewer='.length)):'';
 const taskView=kind==='task'?(taskOptions?.view||'request'):undefined;
 const ownerBounds=owner?.window.getBounds();
 const area=(ownerBounds?screen.getDisplayMatching(ownerBounds):screen.getDisplayNearestPoint(screen.getCursorScreenPoint())).workArea;
 const used=new Set([...windows.values()].filter(item=>item.owner===owner&&item.kind===kind&&!item.window.isDestroyed()).map(item=>item.slot));
 const ownerRevision=owner?.revision;
 const placement=kind==='console'?await reserveConsoleSlot():null;
 if(quitting||owner&&(owner.window.isDestroyed()||owner.revision!==ownerRevision)){placement?.close();throw Error('起動元の利用が終了しました。');}
 let slot=placement?.slot||0;if((owner||kind==='browser')&&['code','viewer','browser'].includes(kind))while(used.has(slot))slot++;
 let bounds,displaySlot;
 try{
  const display=selectedAllDisplay(owner,displayId);
  if(display){displaySlot=0;const occupied=new Set([...windows.values()].filter(item=>item.owner===owner&&item.kind===kind&&item.displayId===displayId&&!item.window.isDestroyed()).map(item=>item.displaySlot));while(occupied.has(displaySlot))displaySlot++;}
  bounds=display?allWindowBounds(kind,display.workArea,displaySlot):(anchor&&owner?panelBounds(anchor,owner,screen):null)||windowBounds(kind,area,ownerBounds,slot,cliConsoleWindow&&!owner);
 }catch(error){placement?.close();throw error;}
 if(kind==='task')bounds=taskWindowBounds(taskView,area);
 const baseTitle=['task','team'].includes(kind)?`AiDiy ${(owner||projectFixed)?'IDE / ':''}${kind.toUpperCase()}`:kind==='browser'?(owner?`AiDiy IDE / Browser ${slot+1}`:'AiDiy Browser'):kind==='viewer'?`AiDiy IDE / Viewer - ${viewerPath.split('/').at(-1)}`:`AiDiy ${owner?'IDE / ':''}${kind==='navi'?'Navigator':kind==='ide'?'IDE':kind==='code'?`Code${owner?' '+(slot+1):''}`:kind==='console'?`Console${owner?' '+(slot+1):''}`:kind==='task'?'Task':kind==='team'?'Team':'Live'}`;
 let window;
 let title=baseTitle+(kind==='console'&&!owner&&cliConsoleWindow&&process.env.AIDIY_DEVELOPMENT_CLI_NAME?' / '+process.env.AIDIY_DEVELOPMENT_CLI_NAME:'');
 try{window=new BrowserWindow({title,...bounds,...(kind==='task'?{minWidth:bounds.minWidth,minHeight:bounds.minHeight}:windowMinimumSize(kind,bounds)),show:false,frame:false,roundedCorners:false,...(kind==='browser'?{enableLargerThanScreen:true}:{}),backgroundColor:'#000',autoHideMenuBar:true,icon:kind==='browser'&&!owner?join(__dirname,'public','AiDiy.png'):join(__dirname,'public',`AiDiy_${['navi','code','live','console','task','team'].includes(kind)?kind:'ide'}.png`),webPreferences:{preload:join(__dirname,'デスクトップ/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,autoplayPolicy:'no-user-gesture-required'}});}catch(error){placement?.close();throw error;}
 window.once('closed',()=>placement?.close());
 // autoplayPolicy: ビューアの「表示」で開いた HTML（ナレーション付きの動画ページなど）の音声を、クリックなしで再生できるようにする。
 // Windowsのフレームレス窓も、外枠の論理座標を明示してDPI差を補正する。
 window.setBounds(bounds);
 const contents=window.webContents;
 contents.on('page-title-updated',event=>{event.preventDefault();window.setTitle(kind==='navi'?navigationWindowTitle(record,title):title);});
 // 窓番号は全体で一意、重ね位置は選択した画面ごとに数える。
 const record={window,kind,...(kind==='navi'?{navigationNormalTitle:title}:{}),url:base,viewerPath,server,owner,linkKey,slot,displayId,displaySlot,taskView,taskController:taskOptions?.controller||taskWindows,taskPayload:taskOptions?.payload,revision:0,pending:new Map()};windows.set(contents,record);
 let browserReady;
 if(kind==='browser')record.browserReady=new Promise(resolve=>{browserReady=resolve;});
 // 起動元・寿命はrecord.ownerで管理し、OS上は独立したパネルのままピンを設定する。
 registerWindowPin(record);
 attachWindowMove(record);
 if(kind==='ide')allDisplays.register(record);
 window.on('focus',()=>{draftRouter.focused(record);});
 // IDEの×・Alt+F4は、利用中（接続利用・オフライン利用の開始後）だけ確認してから全体を閉じる。
 // 初期画面と「終了」で起動画面へ戻った後は、守る作業がないので確認しない（状態が不明な時は作業を守るため確認する）。利用終了は子窓だけを閉じる。
 if(kind==='ide'){
  let confirming=false,approved=false;
  window.on('close',event=>{
   if(quitting||approved)return;
   event.preventDefault();if(confirming)return;confirming=true;
   void (async()=>{
    const active=await readState(record).then(state=>state.active,()=>true);
    if(window.isDestroyed())return;
    if(!active){approved=true;window.close();return;}
    // 📌連携窓の背後に終了確認を隠さない。確認中だけ同じ前面層へ上げ、取消時も元の状態へ戻す。
    const previousPin=windowPins.state(window);let response;
    windowPins.setLocked(window,true);window.moveTop();
    try{({response}=await dialog.showMessageBox(window,{type:'question',title:'AiDiy IDE',message:'AiDiy IDE を終了しますか？',buttons:['終了する','キャンセル'],defaultId:1,cancelId:1,noLink:true}));}
    finally{if(!window.isDestroyed())windowPins.setLocked(window,previousPin.locked);}
    if(response===0&&!window.isDestroyed()){approved=true;window.close();}
   })().catch(error=>console.error(error)).finally(()=>{confirming=false;});
  });
 }
 const monitor=kind==='ide'?setInterval(()=>void checkChildren(record),400):kind==='browser'&&!owner?setInterval(()=>void checkStandaloneBrowser(record),400):undefined;monitor?.unref();
 window.once('closed',()=>{browserReady?.(false);if(kind==='task')record.taskController.closed(record);clearInterval(monitor);draftRouter.invalidate(record);nativePreviewActions.invalidate(record);closeChildren(record);windows.delete(contents);if(kind==='browser'&&!owner&&!standaloneBrowsers().length){const pending=standaloneBrowserBridge;standaloneBrowserBridge=undefined;void pending?.then(bridge=>bridge.close(),()=>{});}closeServer(server);if(kind==='viewer'&&owner&&!owner.window.isDestroyed())owner.window.webContents.send('development:viewer-closed',viewerPath);});
 contents.on('did-start-navigation',(_event,_url,isInPlace,isMainFrame)=>{if(isMainFrame){nativePreviewActions.invalidate(record);if(!isInPlace)draftRouter.invalidate(record);}});
 contents.on('render-process-gone',()=>{draftRouter.invalidate(record);nativePreviewActions.invalidate(record);});
 contents.on('will-navigate',(event,target)=>{if(target.split('#')[0]!==base)event.preventDefault();});
 contents.on('will-redirect',event=>event.preventDefault());contents.on('will-attach-webview',event=>event.preventDefault());
 contents.setWindowOpenHandler(details=>{const allowed=kind==='ide'?panelWindows.open(record,details):null;if(allowed)return allowed;if(/^https?:\/\//i.test(details.url))void shell.openExternal(details.url);return{action:'deny'};});
 contents.on('did-create-window',(child,details)=>panelWindows.created(record,child,details));
 try{
  if(kind==='browser'){
   browserViews??=createBrowserViews({BrowserWindow,WebContentsView,session,screen,windowPins,isVRActive:record=>allDisplays.isActive(record.owner||record),
    leaveVR:record=>{
     const owner=record.owner||record;
     try{allDisplays.leave(owner);}catch(error){owner.window.webContents.send('development:all-displays-changed',{...allDisplays.state(owner),error:error.message});}
    },
    captureImage:({png})=>saveBrowserCapture(process.env.AIDIY_DEVELOPMENT_PROJECT||process.cwd(),png),trustedEvent,projectRoot:process.env.AIDIY_DEVELOPMENT_PROJECT||process.cwd()});
   const bridge=await (owner?ensureBrowserBridge(record):ensureStandaloneBrowserBridge());
   if(!owner&&browserTarget===undefined)browserTarget=await browserStartupURL();
   const current=await readState(owner||record);
   if(window.isDestroyed()||owner&&(owner.window.isDestroyed()||owner.revision!==ownerRevision||sessionKey(current)!==linkKey||!browserConnected(current)))throw Error('tools接続中のみBrowserを起動できます。');
   // Browser番号はCDPの排他レジストリと共通。複数IDEでも衝突せず、閉じた最小番号を再利用する。
   if(owner){
    record.slot=Number(bridge.name.slice('aidiy_ide '.length))-1;title=`AiDiy IDE / Browser ${record.slot+1}`;window.setTitle(title);
    if(displayId===undefined&&!anchor)window.setBounds(windowBounds(kind,area,ownerBounds,record.slot));
   }
   record.browserSession=bridge.name;const page=browserViews.attach(record,browserTarget,browserConnected(current));attachWindowMove(record,page);bridge.add(record,page);if(!owner)browserViews.setAvailable(record,browserConnected(current));
   browserReady(true);
  }
  await window.loadURL(url);
  if(!window.isDestroyed()){
   await contents.executeJavaScript("document.documentElement.classList.add('desktop-opening')");
   if(await 拡大表示(BrowserWindow,window,{background:'#000'}))await contents.executeJavaScript("document.documentElement.classList.remove('desktop-opening');window.dispatchEvent(new Event('aidiy-window-shown'))");
  }
  return window;
 }
 catch(error){if(!window.isDestroyed())window.destroy();throw error;}
}
process.on('disconnect',()=>{forcedQuit=true;app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
 if(quitting)return;
 // Mac の Dock「終了」でも、IDE本体の close にある利用中確認を経由する。
 if(process.platform==='darwin'&&!forcedQuit&&[...windows.values()].some(record=>!record.owner&&!record.window.isDestroyed())){
  event.preventDefault();closeApplication();return;
 }
 event.preventDefault();quitting=true;
 for(const {window} of windows.values())window.destroy();
 void Promise.allSettled([...closing]).finally(()=>app.quit());
});
app.whenReady().then(async()=>{
 if(process.platform==='darwin')require('./host/scripts/MacOS-Menu.cjs').Macメニューを設定({app,Menu,名前:appName,閉じる:closeApplication,icon:join(__dirname,'public',kind==='browser'?'AiDiy.png':`AiDiy_${kind}.png`),platform:process.platform});
 // 同一Electronプロセスの複数窓を識別し、Liveのメインフレームだけ音声入力を許可する。
 session.defaultSession.setPermissionCheckHandler((contents,permission,origin,details)=>{
  const record=windows.get(contents);if(!record)return false;
  let sameOrigin=false;try{sameOrigin=new URL(origin).origin===new URL(record.url).origin;}catch{}
  if(permission==='clipboard-sanitized-write')return sameOrigin;
  return sameOrigin&&audioAllowed(contents,permission,details)&&details.mediaType==='audio';
 });
 session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(audioAllowed(contents,permission,details)&&details.mediaTypes?.length===1&&details.mediaTypes[0]==='audio'));
 ipcMain.handle('development:task-windows',(event,action,payload)=>(trustedEvent(event)?.taskController||taskWindows).handle(event,action,payload));
 ipcMain.handle('development:task-session',(event,action,value)=>(trustedEvent(event)?.taskController||taskWindows).session(event,action,value));
 ipcMain.handle('development:window',(event,action)=>{
  const record=trustedEvent(event);if(!record)return;
  if(action==='minimize')record.window.minimize();else if(action==='close')record.window.close();
  else if(action==='maximize'){if(record.kind==='browser'&&browserViews)return browserViews.maximize(record);if(!allDisplays.leave(record,{maximize:true})){if(record.window.isMaximized())record.window.unmaximize();else record.window.maximize();}}
  if(action==='title')return record.window.getTitle();
  if(action==='pin-state')return windowPins.state(record.window);
  if(action==='toggle-pin')return windowPins.toggle(record.window);
  if(action==='maximize'||action==='isMaximized')return record.window.isMaximized();
 });
 ipcMain.handle('development:all-displays',(event,action)=>allDisplays.handle(event,action));
 ipcMain.handle('development:browser-action',async(event,action,value)=>{
  const record=trustedEvent(event);
  if(record?.kind==='browser'&&!['bounds','state','size','fullscreen','element-stop','draft-dialog','analysis-dialog','header-size','header-pin-state','header-toggle-pin'].includes(action)){
   try{if(!browserConnected(await readState(record.owner||record)))return{ok:false,error:'tools接続中のみBrowserを操作できます。'};}catch{return{ok:false,error:'toolsの接続を確認できません。'};}
  }
  if(action==='analysis-context')return browserAnalysisContext(event);
  if(action==='analysis-select-source')return selectBrowserSource(event,value);
  return browserViews?.action(event,action,value)||{ok:false,error:'ブラウザが起動していません。'};
 });
 ipcMain.handle('development:open-browser',async(event,path,displayId,displayUrl='',reuseSingleBrowser=false)=>{
  const source=trustedEvent(event),owner=source?.kind==='viewer'?source.owner:source;
  if(!owner||owner.kind!=='ide'||owner.owner||!['ide','viewer'].includes(source.kind))return{ok:false,error:'IDEから開いてください。'};
  const revision=owner.revision;
  try{
   if((displayUrl!==''&&path===undefined)||(path!==undefined&&(!validPreviewPath(path)||!await browserOpenable(path,displayUrl))))throw Error('HTML / Vue・音声・動画ファイルを選んでください。');
   if(displayId!==undefined&&source!==owner)throw Error('画面の選択はIDE本体から行ってください。');
   selectedAllDisplay(owner,displayId);
   const state=await readState(owner),key=sessionKey(state);
   const valid=()=>!quitting&&!owner.window.isDestroyed()&&!source.window.isDestroyed()&&trustedEvent(event)===source&&owner.revision===revision;
   if(!valid()||!key||!state.project?.path||(source!==owner&&source.linkKey!==key))throw Error('IDEの利用を開始してください。');
   if(!browserConnected(state))throw Error('tools接続中のみBrowserを起動できます。');
   let target=HOME;
   if(path!==undefined){
    target=await browserFileTarget(state.project.path,path,displayUrl);
   }
   const current=await readState(owner);
   if(!valid()||sessionKey(current)!==key||current.project?.path!==state.project.path||!browserConnected(current))throw Error('IDEの利用状態が変わりました。');
   if(reuseSingleBrowser===true&&displayUrl!==''){
    const singleBrowser=()=>{
     const matches=[...windows.values()].filter(record=>record.kind==='browser'&&record.owner===owner&&record.linkKey===key&&!record.window.isDestroyed());
     return matches.length===1?matches[0]:null;
    };
    let existing;
    // AI解析のURLだけ、同じIDEに1枚あるBrowserを使う。準備中の窓も待ち、二重起動しない。
    while((existing=singleBrowser())){
     const ready=await existing.browserReady,current=await readState(owner);
     if(!valid()||sessionKey(current)!==key||current.project?.path!==state.project.path||!browserConnected(current))throw Error('IDEの利用状態が変わりました。');
     if(singleBrowser()!==existing)continue;
     if(!ready)throw Error('Browserを起動できませんでした。もう一度開いてください。');
     browserViews.setAvailable(existing,true);await browserViews.navigate(existing,target);focusWindow(existing.window);
     return{ok:true,reused:true};
    }
   }
   await createWindow('browser',owner.url+'#browser',undefined,owner,key,undefined,displayId,target);
   return{ok:true};
  }catch(error){return{ok:false,error:error.message};}
 });
 ipcMain.handle('development:draft-target-register',async(event,value)=>{const result=draftRouter.register(trustedEvent(event),value);if(result.ok&&value)await sharedDrafts();return result;});
 ipcMain.handle('development:copy-file-path',(event,path)=>nativePreviewActions.copyFilePath(event,path));
 ipcMain.handle('development:open-file',(event,path)=>nativePreviewActions.openFile(event,path));
 ipcMain.handle('development:open-folder',(event,path)=>nativePreviewActions.openFolder(event,path));
 ipcMain.handle('development:draft-targets',async event=>{const source=trustedEvent(event);try{return ['browser','navi'].includes(source?.kind)?await(await sharedDrafts()).list(source):await draftRouter.list(source);}catch(error){return{ok:false,error:error.message};}});
 ipcMain.handle('development:draft-insert',async(event,value)=>{
  const source=trustedEvent(event);
  if(source?.kind==='navi'){try{return await(await sharedDrafts()).insert(source,value);}catch(error){return{ok:false,error:error.message};}}
  if(source?.kind!=='browser')return draftRouter.insert(source,value);
  try{const elementId=value?.browserElementId;if(elementId!==undefined&&(typeof elementId!=='string'||elementId.length>128))throw Error('要素の指定が不正です。');const draft=await browserViews.action(event,elementId===undefined?'draft':'element-draft',elementId);if(!draft.ok)return draft;return await(await sharedDrafts()).insert(source,{...value,text:draft.request.text});}catch(error){return{ok:false,error:error.message};}
 });
 ipcMain.on('development:draft-result',(event,value)=>draftRouter.acknowledge(trustedEvent(event),value));
 ipcMain.handle('development:end-session',async event=>{
  const record=trustedEvent(event);if(!record||record.kind!=='ide')return;
  closeChildren(record);await Promise.allSettled([...closing]);
 });
 ipcMain.handle('development:child-windows',event=>{
  const owner=trustedEvent(event);
  return{live:!!owner&&owner.kind==='ide'&&[...windows.values()].some(child=>child.owner===owner&&child.kind==='live'&&!child.window.isDestroyed())};
 });
 ipcMain.handle('development:open-app',async(event,type,displayId)=>{
  const source=trustedEvent(event),record=source?.kind==='viewer'?source.owner:source;
  if(!record||record.kind!=='ide'||!['ide','viewer'].includes(source.kind)||!['code','live','console','task','team'].includes(type))return{ok:false,error:'この画面からは開けません。'};
  // ピン留めからの明示起動も、元のIDEと同じ利用セッションだけに限定する。
  const revision=record.revision;let state;
  try{
   if(displayId!==undefined&&source!==record)throw Error('画面の選択はIDE本体から行ってください。');
   selectedAllDisplay(record,displayId);
   state=await readState(record);
   if(quitting||trustedEvent(event)!==source||source.window.isDestroyed()||record.window.isDestroyed()||record.revision!==revision||!state.active||!state.project?.path||(source!==record&&source.linkKey!==sessionKey(state)))throw Error('IDEの利用状態が変わりました。');
   if(['live','task','team'].includes(type)&&state.mode!=='online')throw Error('Live / TASK / TEAMはAiDiy接続利用で開けます。');
  }catch(error){return{ok:false,error:error.message};}
  // Codeは依頼ごとに別窓。Liveだけ初期化中も共有して1窓にする。
  if(['live','task','team'].includes(type)&&record.pending.has(type))return record.pending.get(type);
  const opening=(async()=>{
   let child;
   try{
    const key=sessionKey(state);
    const existing=[...windows.values()].find(item=>item.owner===record&&item.kind===type&&item.linkKey===key&&!item.window.isDestroyed());
    if(['live','task','team'].includes(type)&&existing){focusWindow(existing.window);return{ok:true,reused:true};}
    const {startDevelopment}=await import('./server.mjs');
    child=await startDevelopment(state.project.path,{kind:type,offline:state.mode==='offline',linked:true,projectFixed:['task','team'].includes(type)});
    const current=await readState(record);
    if(quitting||trustedEvent(event)!==source||source.window.isDestroyed()||record.revision!==revision||record.window.isDestroyed()||!current.active||current.project?.path!==state.project.path||sessionKey(current)!==key||(source!==record&&source.linkKey!==key))throw Error('IDEの利用状態が変わりました。もう一度開いてください。');
    if(type==='task'){
     const service=child;
     const controller=createTaskWindows({authenticated:true,records:windows,trustedEvent,focusWindow,isQuitting:()=>quitting||record.window.isDestroyed()||record.revision!==revision,
      owns:item=>item.taskController===controller,
      onLastClosed:()=>closeServer(service),
      createWindow:(view,payload)=>createWindow('task',service.url+'#task-view='+view,undefined,record,key,undefined,displayId,undefined,{view,payload,controller})});
     const result=await controller.start();if(!result.ok)throw Error(result.error);
    }else await createWindow(type,child.url,child,record,key,undefined,displayId);
    child=undefined;
    return{ok:true};
   }catch(error){closeServer(child);return{ok:false,error:error.message};}
  })();
  if(['live','task','team'].includes(type))record.pending.set(type,opening);
  try{return await opening;}finally{if(record.pending.get(type)===opening)record.pending.delete(type);}
 });
 ipcMain.handle('development:code-move-begin',event=>codeDrag.begin(event));
 ipcMain.handle('development:code-move',(event,token)=>codeDrag.move(event,token));
 ipcMain.handle('development:code-move-end',(event,token)=>codeDrag.end(event,token));
 ipcMain.handle('development:window-move-begin',(event,name)=>codeDrag.begin(event,name));
 ipcMain.handle('development:window-move',(event,token,name)=>codeDrag.move(event,token,name));
 ipcMain.handle('development:window-move-end',(event,token,name)=>codeDrag.end(event,token,name));
 ipcMain.handle('development:prepare-explorer',(event,rect,kind,previewRect)=>panelWindows.prepare(event,rect,kind,previewRect));
 ipcMain.handle('development:show-explorer',(event,name,reduced)=>panelWindows.show(event,name,reduced));
 ipcMain.handle('development:navigation-cruise',(event,active,name)=>navigationCruiseWindow(event,active,name));
 ipcMain.handle('development:navigation-code',(event,expanded,name)=>navigationCodeWindow(event,expanded,name));
 ipcMain.handle('development:resize-routes',(event,name,height)=>panelWindows.resizeRoutes(event,name,height));
 ipcMain.handle('development:panel-action',(event,name,action)=>panelWindows.action(event,name,action));
 // ピン留め: IDEのプレビューを、同じIDEサーバーのファイルAPIを使う独立ウィンドウ（record.ownerでIDEに所属）で開く。
 // 同じファイルは既存の窓を前面へ出す。利用終了・セッション切り替えでは他の子ウィンドウと一緒に閉じる。
 ipcMain.handle('development:open-viewer',async(event,path,anchor)=>{
  const record=trustedEvent(event);
  if(!record||record.kind!=='ide'||typeof path!=='string'||!path||path.length>4096||path.includes('\0'))return{ok:false,error:'この画面からは開けません。'};
  const pendingKey='viewer:'+path;if(record.pending.has(pendingKey))return record.pending.get(pendingKey);
  const revision=record.revision;
  const opening=(async()=>{try{
   const state=await readState(record);
   if(record.revision!==revision||trustedEvent(event)!==record)throw Error('IDEの利用状態が変わりました。');
   if(!state.active)throw Error('IDEの利用を開始してください。');
   const existing=[...windows.values()].find(item=>item.owner===record&&item.kind==='viewer'&&item.viewerPath===path&&!item.window.isDestroyed());
   if(existing){focusWindow(existing.window);return{ok:true,reused:true};}
   if(quitting||record.window.isDestroyed())throw Error('IDEが終了しています。');
   await createWindow('viewer',`${record.url}#viewer=${encodeURIComponent(path)}`,undefined,record,sessionKey(state),anchor);
   return{ok:true};
  }catch(error){return{ok:false,error:error.message};}})();
  record.pending.set(pendingKey,opening);
  try{return await opening;}finally{if(record.pending.get(pendingKey)===opening)record.pending.delete(pendingKey);}
 });
 await createWindow(kind,kind==='task'?url+'#task-view=request':kind==='browser'?url+'#browser':url);if(kind==='task')await taskWindows.start();process.send?.({windowShown:true});
 // Code / Liveが未起動でも、同じプロジェクトのIDEがあることだけをBrowserへ知らせる。
 if(kind==='ide')void sharedDrafts().catch(()=>{});
}).catch(error=>{console.error(error);app.quit();});
