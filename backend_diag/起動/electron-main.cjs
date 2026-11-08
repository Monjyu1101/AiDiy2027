// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {app,BrowserWindow,session,ipcMain,dialog,Menu,screen,shell}=require('electron');
const path=require('node:path');
const {mkdirSync}=require('node:fs');
const {programDataDirectory}=require('../../frontend_ide/host/scripts/project-storage.cjs');
const {アイコンメニューを作成}=require('./アイコンメニュー.cjs');
const {拡大表示}=require('../../frontend_ide/host/scripts/window-opening.cjs');
const {ミニ表示を作成,ミニ高さは有効,ミニ幅}=require('./ミニ表示.cjs');
const {マイクロ表示を作成,閉じた幅}=require('./マイクロ表示.cjs');
const {画面サイズ演出を作成}=require('./サイズ切替.cjs');
const {通常窓サイズを作成}=require('./通常窓サイズ.cjs');
const {表示切替基準を作成}=require('./表示切替位置.cjs');
const {標準タイトル操作を取り付け}=require('./標準タイトル操作.cjs');
const {checkPort}=require('./ポート接続.cjs');
const {attachNativeWindowMove}=require('../../frontend_ide/デスクトップ/長押し窓移動.cjs');
const {createWindowPins,pinLevel}=require('../../frontend_ide/デスクトップ/最前面ピン.cjs');
const {起動状態を読む,終了確認を作成}=require('./終了確認.cjs');
const {アプリ名,Macメニューを設定}=require('./MacOS-Menu.cjs');
if(process.platform==='darwin')app.setName(アプリ名);
// 単体ファイル起動では既定の Electron プロファイルが Avatar と重なり、
// 相互に別インスタンスと誤認する。排他ロック・キャッシュを Diag 専用にする。
const projectRoot=path.resolve(__dirname,'../..');
const profile=path.join(programDataDirectory(projectRoot,'aidiy_diag',projectRoot),'electron');
mkdirSync(profile,{recursive:true,mode:0o700});
app.setPath('userData',profile);
app.setPath('sessionData',profile);
let window, failed=false,終了確認;
const pins=createWindowPins({onChanged:(target,state)=>{
  if(!target.isDestroyed()&&!target.webContents.isDestroyed())target.webContents.send('diag:pin-state',state);
}});
function fail(code) {
  if(failed)return;failed=true;
  // 例外本文や loadURL の URL は返さず、固定の原因コードだけを IPC へ送る。
  if(process.connected && process.send){
    const fallback=setTimeout(()=>app.exit(1),250);fallback.unref?.();
    try{process.send({type:'diag-failed',code},()=>{clearTimeout(fallback);app.exit(1);});}catch{app.exit(1);}
  }else app.exit(1);
}
function validUrl(value) {
  const url=new URL(value);
  if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || !url.port || url.username || url.password || url.search || !/^#token=[A-Za-z0-9_-]{43}$/.test(url.hash)) throw new Error('invalid URL');
  return url;
}
async function start(value) {
  let url;try{url=validUrl(value);}catch{fail('URL');return;}
  await app.whenReady();
  const initialMini=await checkPort(8095)===true;
  // 通常表示は中央ではなく、ミニ（作業領域の左上角）より少し内側の左上から表示を始める。
  const area=screen.getPrimaryDisplay().workArea,通常表示の余白=48;
  if(failed||!process.connected)return;
  // 非永続 session。preload は固定ウィンドウ操作だけ公開し、Node・任意IPCは公開しない。
  const isolated=session.fromPartition('aidiy-diag-'+process.pid,{cache:false});
  isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  isolated.setPermissionCheckHandler(()=>false);
  isolated.webRequest.onBeforeRequest((details,callback)=>{
    try {const target=new URL(details.url);callback({cancel:target.origin!==url.origin});} catch {callback({cancel:true});}
  });
  window=new BrowserWindow({x:area.x+通常表示の余白,y:area.y+通常表示の余白,width:800,height:600,title:'AiDiy Diag',icon:path.join(__dirname,'../static/AiDiy_diag.png'),show:false,frame:false,roundedCorners:false,transparent:true,hasShadow:false,backgroundColor:'#00000000',minWidth:420,minHeight:320,webPreferences:{session:isolated,preload:path.join(__dirname,'preload.cjs'),additionalArguments:initialMini?['--aidiy-diag-initial-mini']:[],nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.setMenuBarVisibility(false);
  pins.register(window);
  終了確認=終了確認を作成({window,状態取得:()=>起動状態を読む(url.href),確認:(parent,options)=>dialog.showMessageBox(parent,options)});
  Macメニューを設定({app,Menu,window,icon:path.join(__dirname,'../static/AiDiy_diag.png')});
  const sizeEffect=画面サイズ演出を作成(BrowserWindow,window,{topmostLevel:()=>micro.active&&process.platform==='win32'?'pop-up-menu':pinLevel});
  const sizingWindow=通常窓サイズを作成(sizeEffect.window||window,screen);
  const displayPosition=表示切替基準を作成(screen);
  const mini=ミニ表示を作成(sizingWindow,{screen,位置:displayPosition});
  const micro=マイクロ表示を作成(sizingWindow,{screen,位置:displayPosition,pins:{setLocked:(_target,value)=>pins.setLocked(window,value),state:()=>pins.state(window)}});
  window.once('closed',()=>sizeEffect.中止());
  let firstLoad=true,opening=false,pendingMiniHeight,pendingMicroHeight,displaySwitch=false,displayOrigin;
  let maximizeOperation;
  function 最大化取消(){if(maximizeOperation){maximizeOperation=undefined;sizeEffect.中止();}titleControls.cancel();}
  window.once('closed',()=>最大化取消());
  const 標準操作可能=()=>!mini.active&&!micro.active&&!opening&&!displaySwitch&&!sizeEffect.active;
  function 最大化切替(){
    if(!標準操作可能()||window.isFullScreen?.())return false;
    titleControls.cancel();const operation={};maximizeOperation=operation;
    const maximized=sizingWindow.isMaximized(),target=maximized?sizingWindow.getNormalBounds():screen.getDisplayMatching(window.getBounds()).workArea;
    return sizeEffect.準備(target).then(async ready=>{
      if(!ready||maximizeOperation!==operation||window.isDestroyed()||window.isMinimized()||window.isFullScreen?.()||mini.active||micro.active||displaySwitch)return false;
      if(maximized)sizingWindow.unmaximize();else sizingWindow.maximize();return sizeEffect.完了();
    }).finally(()=>{if(maximizeOperation===operation){maximizeOperation=undefined;if(sizeEffect.active)sizeEffect.中止();}});
  }
  const titleControls=標準タイトル操作を取り付け(sizingWindow,screen,{enabled:標準操作可能,toggleMaximize:最大化切替});
  // 長押しも同じ疑似最大化状態を見る。標準タイトルはDOM側で対象外にする。
  attachNativeWindowMove(sizingWindow,screen,'diag');
  window.webContents.on('did-start-loading',()=>{
    最大化取消();
    // 初回の描画より先にミニ状態にし、初期表示の高さ通知を取りこぼさない。
    // 再読込時は従来どおり通常表示へ戻す。
    sizeEffect.中止();displaySwitch=false;displayOrigin=undefined;micro.set(false);pendingMicroHeight=undefined;pendingMiniHeight=undefined;mini.set(firstLoad&&initialMini,{topLeft:true});firstLoad=false;
  });
  const iconMenu=アイコンメニューを作成(window);
  let selectingFolder=false;
  ipcMain.handle('diag:window',(event,action,value)=>{
    if(!window || window.isDestroyed() || event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame)return false;
    if(action==='microMenu'){
      if(!micro.active||opening||displaySwitch||!Array.isArray(value)||value.length>32||value.some(item=>!item||typeof item.key!=='string'||!/^(app|cli):[a-z_]+$/.test(item.key)||typeof item.label!=='string'||item.label.length>100||item.enabled!==undefined&&typeof item.enabled!=='boolean'||item.reason!==undefined&&(typeof item.reason!=='string'||item.reason.length>200)))return false;
      const send=action=>{if(!window.isDestroyed())window.webContents.send('diag:micro-menu',action);};
      iconMenu.open(value,send);return true;
    }
    if(action==='beginDisplay'){
      最大化取消();
      if(!['normal','mini','micro'].includes(value)||opening||displaySwitch||sizeEffect.active)return false;
      displayOrigin=window.getBounds();
      const base=micro.normalBounds||mini.normalBounds||window.getNormalBounds();
      const target=displayPosition.計算(displayOrigin,value==='micro'?{width:閉じた幅,height:閉じた幅}:value==='mini'?{width:ミニ幅,height:360}:base,{画面内:value==='micro'});
      pendingMicroHeight=undefined;displaySwitch=true;
      return sizeEffect.準備(target).then(ready=>{if(!ready)displaySwitch=false;return ready;});
    }
    if(action==='finishDisplay'){
      if(pendingMicroHeight!==undefined){micro.resizeLabel(pendingMicroHeight);pendingMicroHeight=undefined;}
      return sizeEffect.完了({beforeCapture:()=>{if(pendingMicroHeight!==undefined){micro.resizeLabel(pendingMicroHeight);pendingMicroHeight=undefined;}}}).finally(()=>{
        // アイコン化専用の最前面層を演出の完了後にも適用する。
        micro.最前面維持();
        displaySwitch=false;displayOrigin=undefined;pendingMicroHeight=undefined;
        if(pendingMiniHeight!==undefined){mini.resize(pendingMiniHeight);pendingMiniHeight=undefined;}
      });
    }
    if(action==='selectProject'){
      if(selectingFolder)return null;selectingFolder=true;
      return dialog.showOpenDialog(window,{title:'プロジェクトフォルダを選択',properties:['openDirectory']}).then(result=>result.canceled?null:result.filePaths[0]||null).finally(()=>{selectingFolder=false;});
    }
    if(action==='startMini'){
      最大化取消();
      if(typeof value!=='boolean'||micro.active)return false;
      if(value===false)pendingMiniHeight=undefined;
      if(!displaySwitch&&!opening&&window.isVisible()&&value!==mini.active)return sizeEffect.準備(mini.演出範囲(value)).then(ready=>ready&&mini.set(value));
      return mini.set(value,{origin:displayOrigin});
    }
    if(action==='startMicro'){
      最大化取消();
      if(typeof value!=='boolean'||opening||sizeEffect.active&&!displaySwitch||mini.active)return false;
      return micro.set(value,{origin:displayOrigin});
    }
    // アイコンを離れる途中のwatcher/遅延収納で、撮影済みの元窓を動かさない。
    if(action==='expandMicro')return !opening&&!displaySwitch&&!sizeEffect.active&&value&&typeof value==='object'?micro.expand(value.expanded,value.count):false;
    if(action==='resizeMicroLabel'){
      if(!Number.isInteger(value)||value<18||value>4096||opening)return false;
      // 準備中は旧画面を撮影するため寸法を変えず、完成画像の前に測定値を反映する。
      if(displaySwitch){pendingMicroHeight=value;return true;}
      return !sizeEffect.active?micro.resizeLabel(value):false;
    }
    if(action==='beginMicroMove')return micro.beginMove();
    if(action==='moveMicro')return typeof value==='string'&&micro.move(value);
    if(action==='endMicroMove'){if(typeof value==='string')micro.endMove(value);return false;}
    if(action==='finishMini')return displaySwitch?true:sizeEffect.完了().finally(()=>{if(pendingMiniHeight!==undefined){mini.resize(pendingMiniHeight);pendingMiniHeight=undefined;}});
    if(action==='resizeMini'){
      // 表示開始・切替準備の撮影中は元寸法を保持し、最新の測定値を失わない。
      // 透明化後のmini初期測定は通常どおり適用し、完成画像へ反映する。
      if((opening||sizeEffect.preparing)&&mini.active){if(!ミニ高さは有効(value))return false;pendingMiniHeight=value;return true;}
      const accepted=mini.resize(value);if(accepted)pendingMiniHeight=undefined;return accepted;
    }
    if(action==='isMaximized')return sizingWindow.isMaximized();
    if(action==='getPinState')return pins.state(window);
    if(action==='togglePin')return pins.toggle(window);
    if(action==='minimize'){最大化取消();window.minimize();}
    else if(action==='maximize')return 最大化切替();
    else if(action==='close'){最大化取消();window.close();}
    return false;
  });
  window.webContents.setWindowOpenHandler(({url:target}={})=>{
    const sites=require('../ui/src/components/導入状況/公式サイト.json');
    if(Object.values(sites).includes(target))void shell.openExternal(target).catch(()=>{});
    return {action:'deny'};
  });
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.on('will-redirect',event=>event.preventDefault());
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  window.webContents.once('did-fail-load',(_event,_code,_description,_url,isMainFrame)=>{if(isMainFrame!==false)fail('LOAD');});
  window.webContents.once('render-process-gone',()=>fail('RENDERER'));
  try{await window.loadURL(url.href);}catch{fail('LOAD');return;}
  if(failed || window.isDestroyed())return;
  // Code / Live / Console / IDE と同じ共通演出。内容は拡大完了後にフェード表示する。
  await window.webContents.executeJavaScript("document.documentElement.classList.add('desktop-opening','desktop-window')");
  opening=true;
  const shown=await 拡大表示(BrowserWindow,window,{background:'#080b10'});opening=false;
  if(!shown || failed)return;
  if(pendingMiniHeight!==undefined){mini.resize(pendingMiniHeight);pendingMiniHeight=undefined;}
  await window.webContents.executeJavaScript("document.documentElement.classList.remove('desktop-opening')");
  if(!failed && !window.isDestroyed() && process.connected)process.send({type:'diag-shown'},error=>{if(error)fail('IPC');});
}
// 同じ作業環境の診断ウィンドウは1つだけ。2つ目は既存ウィンドウを前面に出し、起動元へ固定の通知だけ返して終了する。
function existing() {
  const done=()=>app.exit(0);
  if(process.connected && process.send){const fallback=setTimeout(done,250);fallback.unref?.();try{process.send({type:'diag-existing'},()=>{clearTimeout(fallback);done();});}catch{done();}}
  else done();
}
function primary() {
  app.on('second-instance',()=>{
    if(!window || window.isDestroyed())return;
    if(window.isMinimized())window.restore();
    window.show();window.focus();
  });
  // Electron on Windows replaces stdin with an empty EOF stream. Use the inherited Node IPC channel.
  const timer=setTimeout(()=>fail('TIMEOUT'),10000);
  process.once('message',message=>{
    clearTimeout(timer);
    if(message?.type!=='diag-start' || typeof message.url!=='string' || message.url.length>4096){fail('IPC');return;}
    start(message.url).catch(()=>fail('WINDOW'));
  });
  process.once('disconnect',()=>{clearTimeout(timer);終了確認?.許可();app.quit();});
  if(process.connected && process.send){
    try{process.send({type:'diag-ready'},error=>{if(error)fail('IPC');});}catch{fail('IPC');}
  }else{clearTimeout(timer);fail('IPC');}
  app.on('window-all-closed',()=>app.quit());
}
if(app.requestSingleInstanceLock())primary();else existing();
