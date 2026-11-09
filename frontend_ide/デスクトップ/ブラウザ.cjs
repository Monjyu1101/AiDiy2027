// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const HOME='https://www.google.com/';
const {pathToFileURL,fileURLToPath}=require('node:url');
const {relative,isAbsolute,sep,resolve,basename}=require('node:path');
const {previewFile}=require('./native-preview-actions.cjs');
const {createBrowserSizing}=require('./ブラウザ表示領域.cjs');
const {createBrowserHeader}=require('./ブラウザ全画面パネル.cjs');
const {createBrowserAnalysisWindows}=require('./ブラウザ解析窓.cjs');
const {createBrowserChildWindows}=require('./ブラウザ補助窓.cjs');
const {createBrowserElementLink}=require('./ブラウザ要素連携.cjs');
// 単独Browserの初期表示だけを選ぶ。検索・ホームや明示されたURLは変更しない。
async function browserStartupURL(request=fetch){
 const target='http://127.0.0.1:8090/';
 try{
  const response=await request(target,{method:'HEAD',cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(1500)});
  if(response.ok||(response.status>=300&&response.status<400))return target;
 }catch{}
 return HOME;
}
function browserFileURL(root,path){return pathToFileURL(previewFile(root,path).full).href;}
// 直接開くのはHTMLと音声・動画。ページ関連ソースは確認した表示URLが必要。
async function browserOpenable(path,displayUrl=''){
 if(displayUrl!==''){const {isPageSource}=await import('../viewer/表示URL.mjs');return isPageSource(path)&&!!await browserDisplayURL(displayUrl);}
 const {MEDIA_PATTERN}=await import('../viewer/media-types.mjs');
 return /\.html?$/i.test(path)||MEDIA_PATTERN.test(path);
}
// 保存された表示URLはアドレス欄の検索語・file URLとは別に厳密に検証する。
async function browserDisplayURL(value){
 const {normalizeDisplayUrls}=await import('../viewer/表示URL.mjs');
 const url=typeof value==='string'&&normalizeDisplayUrls([{url:value}])[0]?.url;
 if(!url)throw Error('表示URLには認証情報を含まない http / https のURLを指定してください。');
 return url;
}
// AiDiy 保守中の登録HTML・public の音声・動画は正式なリンク、それ以外は file:// で開く。
async function browserFileTarget(root,path,displayUrl=''){
 const fileURL=browserFileURL(root,path);
 if(displayUrl!==''){
  const {isPageSource}=await import('../viewer/表示URL.mjs');
  if(!isPageSource(path))throw Error('表示URLはページ関連ソースで利用できます。');
  return browserDisplayURL(displayUrl);
 }
 const [{registeredHTMLURL,publicMediaURL},{MEDIA_PATTERN}]=await Promise.all([import('../viewer/登録HTMLルート.mjs'),import('../viewer/media-types.mjs')]);
 if(MEDIA_PATTERN.test(path))return await publicMediaURL(root,path)||fileURL;
 return await registeredHTMLURL(root,path)||fileURL;
}
function browserURL(value){
 if(typeof value!=='string'||value.length>8192)throw Error('URLまたは検索語を入力してください。');
 const text=value.trim();if(!text)return HOME;if(text==='about:blank')return text;
 if(isAbsolute(text))return pathToFileURL(text).href;
 if(/^file:/i.test(text)){const url=new URL(text);fileURLToPath(url);return url.href;}
 if(/^[a-z][a-z\d+.-]*:/i.test(text)&&!/^https?:/i.test(text)&&! /^(localhost|[\w-]+(?:\.[\w-]+)+):\d+(?:[/?#]|$)/i.test(text))throw Error('http / https のURLを指定してください。');
 const address=/^https?:\/\//i.test(text)?text:/^(localhost(?::\d+)?|\[[\da-f:]+\]|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:[/?#]|$)/i.test(text)&&! /\s/.test(text)?(/^(localhost|127\.)/i.test(text)?'http://':'https://')+text:HOME+'search?q='+encodeURIComponent(text);
 const url=new URL(address);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('このURLは開けません。');return url.href;
}
function browserDraftRequest(projectRoot,url,capture,now=Date.now(),source){
 if(!source?.session||!source?.tabId)throw Error('Browserの接続先を確認できません。もう一度開いてください。');
 const age=capture?now-capture.at:Infinity;
 const image=capture&&age>=0&&age<=60000?resolve(projectRoot,capture.path):'';
 return{projectPath:projectRoot,path:url,text:`session: ${source.session}\ntab_id: ${source.tabId}\n`+url+(image?'\n画像: '+image:''),selection:false};
}
function createBrowserViews({BrowserWindow,WebContentsView,session,screen,windowPins,isVRActive=()=>false,leaveVR,captureImage,trustedEvent,projectRoot,now=Date.now}){
 const entries=new Map(),headers=new Map(),blockedOrigins=new Set();
 const analysisWindows=createBrowserAnalysisWindows({BrowserWindow,screen,context:analysisContext});
 const draftWindows=createBrowserChildWindows({BrowserWindow,screen,title:'Code / Live の下書きへ追加',hash:'#browser-draft',maxWidth:760,maxHeight:700,context:draftRequest,onClosed:record=>{void entries.get(record)?.elementLink.stop();}});
 const localFileAllowed=url=>{try{const path=relative(projectRoot,fileURLToPath(url)).split(sep).join('/');browserFileURL(projectRoot,path);return true;}catch{return false;}};
 const isolated=session.fromPartition('aidiy-browser');
 isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 isolated.setPermissionCheckHandler(()=>false);
 isolated.webRequest.onBeforeRequest((details,callback)=>{
  let blocked=false;try{const url=new URL(details.url);blocked=blockedOrigins.has(url.origin)||(url.protocol==='file:'&&!localFileAllowed(url));}catch{}
  callback({cancel:blocked});
 });
 const allowed=url=>{if(url==='about:blank')return true;try{const parsed=new URL(url);if(parsed.protocol==='file:')return localFileAllowed(parsed);return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&!blockedOrigins.has(parsed.origin);}catch{return false;}};
 function attach(record,target=HOME,available=true){
  const hostContents=record.window.webContents;
  blockedOrigins.add(new URL(record.url).origin);
  const view=new WebContentsView({webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,webSecurity:true}});
  const contents=view.webContents,entry={view,error:'',rect:null,run:0,available,pendingTarget:available?null:target};entries.set(record,entry);
  record.window.contentView.addChildView(view);view.setVisible(false);
  let stateRevision=0;
  const snapshot=()=>({stateRevision:++stateRevision,url:contents.getURL()||target,title:contents.getTitle(),session:record.browserSession,available:entry.available,elementPicking:!!entry.elementLink?.active,fullscreen:record.window.isFullScreen(),headerVisible:!!entry.headerVisible,headerPinned:!!entry.headerPinned,capturePath:entry.capture?.path||'',loading:contents.isLoading(),back:contents.navigationHistory.canGoBack(),forward:contents.navigationHistory.canGoForward(),error:entry.available?entry.error:'toolsとの接続が切れています。再接続後に操作できます。'});
  const notify=()=>{if(!record.window.isDestroyed()&&!contents.isDestroyed()){const value=snapshot();hostContents.send('development:browser-changed',value);entry.header?.send('development:browser-changed',value);}};
  entry.snapshot=snapshot;entry.notify=notify;
  entry.elementLink=createBrowserElementLink({contents,record,BrowserWindow,screen,available:()=>entry.available,onChange:notify,onSelected:()=>hostContents.send('development:browser-element-selected'),onError:message=>{if(entry.error!==message){entry.error=message;notify();}}});
  const sizing=createBrowserSizing({window:record.window,view,screen});entry.sizing=sizing;
  const toggleFullscreen=()=>sizing.toggleFullscreen();
  entry.toggleFullscreen=toggleFullscreen;
  let pointerTimer;
  function pointer(){
   if(record.window.isDestroyed()||!record.window.isFullScreen())return;
   const point=screen.getCursorScreenPoint(),bounds=record.window.getContentBounds();
   const inside=point.x>=bounds.x&&point.x<bounds.x+bounds.width;
   const top=inside&&point.y>=bounds.y&&point.y<=bounds.y+4;
   if(entry.headerSuppressed&&!top&&!entry.header?.contains(point,true))entry.headerSuppressed=false;
   const visible=!draftWindows.isOpen(record)&&!record.window.isMinimized?.()&&!entry.headerSuppressed&&(!!entry.headerPinned||top||entry.header?.contains(point));
   if(visible!==!!entry.headerVisible){entry.headerVisible=visible;entry.header?.show(visible);notify();}
  }
  function fullscreenChanged(){
   clearInterval(pointerTimer);pointerTimer=undefined;entry.headerVisible=false;entry.headerSuppressed=false;entry.header?.show(false);
   // 保存したVR状態ではなく現在の両方の理由から再計算し、利用者のピン選択は保持する。
   windowPins?.setLocked(record.window,record.window.isFullScreen()||isVRActive(record));
   if(record.window.isFullScreen()){
    // F11で入り直したときは、前回移動したヘッダー位置を引き継がず上端中央へ戻す。
    entry.header?.resetPosition();
    pointerTimer=setInterval(pointer,80);pointerTimer.unref?.();
   }
   entry.layout?.();notify();
  }
  function fullscreenKey(event,key){
   entry.elementLink.key(event,key);
   // ホスト側はVR解除の購読が先。同じF11で解除済みでも、消費した入力は再処理しない。
   if(event.defaultPrevented||key.type!=='keyDown'||key.key!=='F11'||key.control||key.alt||key.shift||key.meta)return;
   // 専用ヘッダーにはIDEのキー購読がないため、同じVR解除をmainへ委ねる。
   if(isVRActive(record)){if(leaveVR){event.preventDefault();if(!key.isAutoRepeat)leaveVR(record);}return;}
   event.preventDefault();if(!key.isAutoRepeat)toggleFullscreen();
  }
  entry.header=createBrowserHeader({BrowserWindow,screen,record,entry,notify,fullscreenKey,headers});
  entry.pointer=pointer;
  for(const page of [hostContents,contents])page.on('before-input-event',fullscreenKey);
  entry.navigate=async value=>{
   const url=browserURL(value);if(!entry.available||!allowed(url))throw Error('このURLはブラウザパネルでは開けません。');
   draftWindows.close(record);void entry.elementLink.stop();
   const run=++entry.run;entry.error='';
   // 読み込み完了を待たず窓を表示する。失敗は同じパネルの操作欄へ通知する。
   void contents.loadURL(url).catch(error=>{if(run===entry.run&&!contents.isDestroyed()&&error.code!=='ERR_ABORTED'){entry.error='ページを読み込めませんでした。URLや接続を確認して再読み込みしてください。';notify();}});
   notify();
  };
  const guard=(event,url)=>{if(!entry.available||!allowed(url||event.url)){event.preventDefault();entry.error='このリンクはブラウザパネルでは開けません。';notify();}};
  contents.on('will-navigate',guard);contents.on('will-redirect',guard);contents.on('will-frame-navigate',guard);
  contents.on('will-attach-webview',event=>event.preventDefault());
  contents.setWindowOpenHandler(({url})=>{void entry.navigate(url).catch(error=>{entry.error=error.message;notify();});return{action:'deny'};});
  for(const name of ['did-navigate','did-navigate-in-page','did-start-loading','did-stop-loading','page-title-updated'])contents.on(name,notify);
  contents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame!==false)draftWindows.close(record);});
  record.window.on('minimize',()=>draftWindows.close(record));
  contents.on('render-process-gone',()=>{draftWindows.close(record);entry.error='ページの表示が停止しました。再読み込みしてください。';notify();});
  function layout(){
   sizing.layout();view.setVisible(entry.available);
  }
  entry.layout=layout;
  record.window.on('enter-full-screen',fullscreenChanged);record.window.on('leave-full-screen',fullscreenChanged);
  record.window.once('closed',()=>{entry.elementLink.dispose();sizing.dispose();clearInterval(pointerTimer);entry.header.close();for(const page of [hostContents,contents])page.removeListener('before-input-event',fullscreenKey);entries.delete(record);if(!contents.isDestroyed())contents.close({waitForBeforeUnload:false});});
  if(available)void entry.navigate(target).catch(error=>{entry.error=error.message;notify();});
  return contents;
 }
 async function action(event,name,value){
  const record=trustedEvent(event),entry=record?.kind==='browser'?entries.get(record):null;
  if(!entry)return{ok:false,error:'ブラウザパネルから操作してください。'};
  const contents=entry.view.webContents;
  try{
   if(['back','forward','reload','stop','open-analysis','capture','element-stop'].includes(name)){draftWindows.close(record);await entry.elementLink.stop();}
   if(name==='element-toggle'){if(draftWindows.isOpen(record))throw Error('ダイアログを閉じてから要素連携を開始してください。');entry.error='';await entry.elementLink.start();}
   else if(name==='element-stop')await entry.elementLink.stop();
   else if(name==='element-draft')return{ok:true,request:elementRequest(record,value)};
   else if(name==='open-draft'){
    const element=value===true;if(draftWindows.isOpen(record)&&entry.draftElement!==element)draftWindows.close(record);
    if(!element&&!draftWindows.isOpen(record))await entry.elementLink.stop();entry.draftElement=element;
    await draftWindows.open(record,element);
   }
   else if(name==='draft-window-context')return{ok:true,request:draftWindowRequest(event)};
   else if(name==='draft-window-close'){if(!draftWindows.trusted(event))throw Error('連携先選択ウィンドウから操作してください。');draftWindows.close(record);return{ok:true};}
   else if(name==='navigate')await entry.navigate(value);
   else if(name==='home')await entry.navigate(HOME);
   else if(name==='back'){if(contents.navigationHistory.canGoBack())contents.navigationHistory.goBack();}
   else if(name==='forward'){if(contents.navigationHistory.canGoForward())contents.navigationHistory.goForward();}
   else if(name==='reload'){entry.error='';contents.reload();}
   else if(name==='stop'){
    // 手動停止後にloadURLのrejectが届いても、取消済みの読込を通信障害として表示しない。
    ++entry.run;entry.error='';contents.stop();
   }
   else if(name==='draft')return{ok:true,request:draftRequest(record)};
   else if(name==='analysis-context')return{ok:true,context:analysisContext(record)};
   else if(name==='open-analysis'){await entry.elementLink.stop(false);await analysisWindows.open(record);}
   else if(name==='analysis-window-context'){const context=analysisWindows.context(event);return context?{ok:true,context}:{ok:false,error:'解析ウィンドウから操作してください。'};}
   else if(name==='analysis-window-close'){if(!analysisWindows.trusted(event))throw Error('解析ウィンドウから操作してください。');analysisWindows.close(record);return{ok:true};}
   else if(name==='header-size'){
    if(headers.get(event.sender)!==record||!Number.isFinite(value)||value<1||value>1000)throw Error('パネルの高さが不正です。');
    entry.header.measure(value);
   }
   else if(name==='header-pin-state'||name==='header-toggle-pin'){
    if(name==='header-toggle-pin'){entry.headerPinned=!entry.headerPinned;entry.headerSuppressed=!entry.headerPinned;entry.pointer();entry.notify();}
    return{pinned:!!entry.headerPinned,locked:false};
   }
   else if(name==='capture'){
    if(!entry.available)throw Error('tools接続中のみ撮影できます。');
    if(entry.capturing)throw Error('撮影中です。しばらくお待ちください。');
    if(!captureImage)throw Error('画像の送信先が設定されていません。');
    entry.capturing=true;
    try{
     const at=now(),url=contents.getURL(),image=await contents.capturePage();
     if(contents.isDestroyed()||record.window.isDestroyed()||!entry.available||contents.getURL()!==url)throw Error('表示中のページや接続が変わりました。もう一度撮影してください。');
     if(image.isEmpty())throw Error('Web画面を撮影できませんでした。');
     const result=await captureImage({record,png:image.toPNG(),size:image.getSize()});
     entry.capture={path:result.path,at};entry.notify();
     return{ok:true,...entry.snapshot(),...result};
    }finally{entry.capturing=false;}
   }
   else if(name==='fullscreen')entry.toggleFullscreen();
   else if(name==='size')await entry.sizing.preset(value);
   else if(name==='bounds'){
    entry.sizing.measure(value);entry.layout();
   }else if(name!=='state')throw Error('対応していない操作です。');
   return{ok:true,...entry.snapshot()};
  }catch(error){return{ok:false,error:error.message};}
 }
 function setAvailable(owner,available){for(const [record,entry]of entries)if((record===owner||record.owner===owner)&&entry.available!==available){entry.available=available;if(!available){draftWindows.close(record);void entry.elementLink.stop();entry.view.webContents.stop();}else if(entry.pendingTarget!==null){const target=entry.pendingTarget;entry.pendingTarget=null;void entry.navigate(target).catch(error=>{entry.error=error.message;entry.notify();});}entry.layout();entry.notify();}}
 function trustedHeader(event){
  const record=headers.get(event.sender),frame=event.senderFrame;
  return record&&!record.window.isDestroyed()&&frame===event.sender.mainFrame&&frame?.url===record.url+'#browser-header'?record:null;
 }
 function elementRequest(record,id){
  const entry=entries.get(record);if(!entry||record.window.isDestroyed())throw Error('Browserが終了しています。');
  return entry.elementLink.request(projectRoot,{session:record.browserSession,tabId:record.browserTabId},id);
 }
 function draftRequest(record,element=false){
  const entry=entries.get(record);if(!entry?.available||record.window.isDestroyed()||entry.view.webContents.isDestroyed())throw Error('tools接続中のみ連携できます。');
  if(element)return elementRequest(record);
  return browserDraftRequest(projectRoot,entry.view.webContents.getURL(),entry.capture,now(),{session:record.browserSession,tabId:record.browserTabId});
 }
 function draftWindowRequest(event){
  const record=draftWindows.trusted(event),request=draftWindows.context(event);
  if(!record||!request)throw Error('連携先選択ウィンドウから操作してください。');
  if(request.browserElementId)return elementRequest(record,request.browserElementId);
  const current=draftRequest(record);if(current.path!==request.path)throw Error('表示中のページが変わりました。連携先を選び直してください。');
  return current;
 }
 function analysisContext(record){
  const entry=entries.get(record);if(!entry||record.window.isDestroyed()||entry.view.webContents.isDestroyed())return null;
  return{url:entry.view.webContents.getURL(),title:entry.view.webContents.getTitle(),baseName:basename(projectRoot),projectPath:projectRoot,canSelectSource:record.owner?.kind==='ide'&&!record.owner.window.isDestroyed()};
 }
 function navigate(record,value){
  const entry=entries.get(record);
  if(!entry||record.window.isDestroyed()||entry.view.webContents.isDestroyed())throw Error('Browserが終了しています。もう一度開いてください。');
  return entry.navigate(value);
 }
 return{attach,action,navigate,setAvailable,trustedHeader,trustedAnalysis:analysisWindows.trusted,isAnalysisSender:analysisWindows.hasSender,trustedDraft:draftWindows.trusted,isDraftSender:draftWindows.hasSender,draftWindowRequest,analysisContext,analysisWindowContext:analysisWindows.context,allowedURL:allowed,maximize:record=>entries.get(record)?.sizing.maximize()};
}
module.exports={HOME,browserStartupURL,browserDisplayURL,browserURL,browserFileURL,browserFileTarget,browserOpenable,createBrowserViews,browserDraftRequest};
