// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {randomUUID}=require('node:crypto');
const {join}=require('node:path');
const {windowBounds,windowMinimumSize}=require('./window-layout.cjs');
const size=require('../host/scripts/window-size.cjs');
const explorerHeight=900;
const {registerNavigationCruiseTitle}=require('./navigation-code-window.cjs');

// getContentBounds / screen.workArea はDIP。CSS pxにzoomだけ掛け、OSのDPI倍率は掛けない。
function panelBounds(rect,owner,screen,kind='explorer'){
 if(!rect||!['left','top','width','height'].every(key=>Number.isFinite(rect[key]))||rect.width<=0||rect.height<=0)return null;
 const origin=owner.window.getContentBounds(),zoom=owner.window.webContents.getZoomFactor();
 const desired={x:Math.round(origin.x+rect.left*zoom),y:Math.round(origin.y+rect.top*zoom),width:Math.round(Math.max(300,rect.width)*zoom),height:Math.round(Math.max(kind==='panel-routes'?40:320,rect.height)*zoom)};
 // NaviはDIPで初期480×800を指定。表示後の手動リサイズは変更しない。
 if(kind==='panel-navigation'){desired.width=size.幅;desired.height=size.ナビ高さ;}
 // 別画面へまたがるパネルは、そのパネルが最も重なるディスプレイを選ぶ。
 const area=screen.getDisplayMatching(desired).workArea,margin=8;
 if(kind==='panel-navigation')return windowBounds('navi',area);
 // Explorer・ファイルビューアの連携別窓は初期900 DIP（作業領域に収まらない画面では下の計算で縮める）。
 // 元パネルの高さやzoomには依存させない。
 if(kind==='explorer'||kind==='panel-viewer')desired.height=explorerHeight;
 const width=Math.min(desired.width,Math.max(1,area.width-margin*2)),height=Math.min(desired.height,Math.max(1,area.height-margin*2));
 return {x:Math.max(area.x+margin,Math.min(desired.x,area.x+area.width-width-margin)),y:Math.max(area.y+margin,Math.min(desired.y,area.y+area.height-height-margin)),width,height};
}

// Explorerは同じDOMを親から移すため、許可したabout:blankだけwindow.openで作る。
// 任意URL・別フレーム・別セッションからの要求は許可しない。
function createPanelWindows({windows,trustedEvent,readState,sessionKey,screen,BrowserWindow,拡大表示,isQuitting,isAllDisplays=()=>false,attachWindowMove=()=>{},registerWindowPin=()=>{},windowPins}){
 const requests=new WeakMap();
 async function prepare(event,rect,kind='explorer',previewRect){
  if(!['explorer','panel-viewer','panel-routes','panel-navigation'].includes(kind))return{ok:false,error:'対応していないパネルです。'};
  const owner=trustedEvent(event);if(!owner||owner.kind!=='ide')return{ok:false,error:'この画面からは開けません。'};
  const revision=owner.revision;
  try{
   const state=await readState(owner);
   if(!state.active||isQuitting()||owner.window.isDestroyed()||revision!==owner.revision||trustedEvent(event)!==owner)throw Error('IDEの利用状態が変わりました。');
   const separate=isAllDisplays(owner);
   let bounds;
   if(separate){
    // ALLの仮想的な右端には実画面がないことがある。操作した画面の作業領域へ新規窓を収める。
    const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const slot=[...windows.values()].filter(item=>item.owner===owner&&item.kind===kind&&!item.window.isDestroyed()).length;
    bounds=kind==='panel-navigation'?windowBounds('navi',area):kind==='panel-viewer'?windowBounds('viewer',area,undefined,slot):{x:area.x+8,y:area.y+8,width:Math.min(kind==='panel-routes'?360:340,area.width-16),height:Math.min(kind==='panel-routes'?40:explorerHeight,area.height-16)};
   }else bounds=panelBounds(rect,owner,screen,kind);
   if(!bounds)throw Error('パネルの位置を取得できません。');
   const existing=[...windows.values()].find(item=>item.owner===owner&&item.kind==='explorer'&&!item.window.isDestroyed());
   if(kind==='explorer'&&existing)throw Error('Explorerはすでに別窓で開いています。');
   let preview;
   if(previewRect&&!separate){
    if(!panelBounds(previewRect,owner,screen,kind))throw Error('元の表示範囲を取得できません。');
    const zoom=owner.window.webContents.getZoomFactor(),content=owner.window.getContentBounds();
    const x=Math.max(0,Math.floor(previewRect.left*zoom)),y=Math.max(0,Math.floor(previewRect.top*zoom));
    const width=Math.min(content.width,Math.ceil((previewRect.left+previewRect.width)*zoom))-x;
    const height=Math.min(content.height,Math.ceil((previewRect.top+previewRect.height)*zoom))-y;
    if(width<=0||height<=0)throw Error('元の表示が画面内にありません。');
    const image=await owner.window.webContents.capturePage({x,y,width,height},{stayHidden:true});
    if(image.isEmpty())throw Error('元の表示を保持できません。');
    if(isQuitting()||owner.window.isDestroyed()||revision!==owner.revision||trustedEvent(event)!==owner)throw Error('IDEの利用状態が変わりました。');
    preview={src:image.toDataURL(),rect:{left:x/zoom,top:y/zoom,width:width/zoom,height:height/zoom}};
   }
   const name='aidiy-explorer-'+randomUUID();
   requests.set(owner,{name,bounds,kind,key:sessionKey(state),revision,expires:Date.now()+10000});return{ok:true,name,preview};
  }catch(error){return{ok:false,error:error.message};}
 }
 function open(owner,details){
  const request=requests.get(owner);
  if(!request||request.used||details.url!=='about:blank'||details.frameName!==request.name||Date.now()>request.expires||request.revision!==owner.revision||isQuitting())return null;
  request.used=true;
  const route=request.kind==='panel-routes';
  // window.open経由の別窓は本体のiconを継承しないため、所有モジュール内の配布画像を指定する。
  const icon=join(__dirname,'../public',request.kind==='panel-navigation'?'AiDiy_navi.png':'AiDiy_ide.png');
  return{action:'allow',overrideBrowserWindowOptions:{...request.bounds,icon,show:false,frame:false,roundedCorners:false,...(route?{transparent:true,resizable:false,hasShadow:false,minWidth:300,minHeight:40}:request.kind==='panel-navigation'?windowMinimumSize('navi',request.bounds):request.kind==='explorer'?{minWidth:Math.min(300,request.bounds.width),minHeight:Math.min(320,request.bounds.height)}:{minWidth:300,minHeight:320}),title:'AiDiy IDE / Explorer',backgroundColor:route?'#00000000':'#080c1a',autoHideMenuBar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}};
 }
 function created(owner,window,details){
  const request=requests.get(owner);requests.delete(owner);
  if(!request?.used||request.name!==details.frameName||owner.window.isDestroyed()||owner.revision!==request.revision||isQuitting()){window.destroy();return;}
  // window.openのDOM連携は維持し、OSの親子関係だけ外す。所属・終了連携はrecord.ownerで管理する。
  window.setParentWindow(null);window.setBounds(request.bounds);
  const contents=window.webContents;
  const record={window,owner,kind:request.kind,url:'about:blank',linkKey:request.key,revision:0,ownerRevision:request.revision,barHeight:request.bounds.height,pending:new Map(),name:request.name};windows.set(contents,record);
  registerNavigationCruiseTitle(record);
  registerWindowPin(record);
  attachWindowMove(record);
  contents.setWindowOpenHandler(()=>({action:'deny'}));
  contents.on('will-navigate',(event,url)=>{if(url!=='about:blank')event.preventDefault();});
  contents.on('will-redirect',event=>event.preventDefault());contents.on('will-attach-webview',event=>event.preventDefault());
  window.once('closed',()=>{clearTimeout(record.timeout);windows.delete(contents);});
  record.timeout=setTimeout(()=>{if(!record.shown&&!window.isDestroyed())window.destroy();},12000);record.timeout.unref?.();
 }
 async function show(event,name){
  const owner=trustedEvent(event),child=[...windows.values()].find(item=>['explorer','panel-viewer','panel-routes','panel-navigation'].includes(item.kind)&&item.owner===owner&&item.name===name&&!item.window.isDestroyed());
  if(!owner||owner.kind!=='ide'||!child||isQuitting())return{ok:false,error:'Explorerの利用が終了しました。'};
  try{if(child.linkKey!==sessionKey(await readState(owner))||owner.window.isDestroyed()||child.window.isDestroyed())return{ok:false,error:'IDEの利用状態が変わりました。'};}catch{return{ok:false,error:'IDEの利用状態を確認できません。'};}
  // 旧IPCの第3引数が届いても、全パネルで共通の表示開始演出を使う。
  if(!child.shown){child.shown=true;clearTimeout(child.timeout);await 拡大表示(BrowserWindow,child.window,{background:'#080c1a'});}
  return{ok:!child.window.isDestroyed()};
 }
 function resizeRoutes(event,name,height){
  const owner=trustedEvent(event),child=[...windows.values()].find(item=>item.owner===owner&&item.name===name&&item.kind==='panel-routes'&&!item.window.isDestroyed());
  if(!owner||owner.kind!=='ide'||!child||owner.revision!==child.ownerRevision||isQuitting()||!Number.isFinite(height)||height<1||height>2000)return{ok:false,error:'軌跡パネルの表示範囲を変更できません。'};
  const win=child.window,current=win.getBounds(),zoom=win.webContents.getZoomFactor();
  const area=screen.getDisplayMatching(current).workArea,margin=8;
  // 上端は維持する。移動で画面外へ出た場合だけバーを見える範囲へ戻す。
  if(height<160)child.barHeight=Math.max(40,Math.ceil(height*zoom));
  const y=Math.max(area.y+margin,Math.min(current.y,area.y+area.height-margin-child.barHeight));
  const next={...current,y,height:Math.max(1,Math.min(Math.ceil(height*zoom),area.y+area.height-margin-y))};
  if(next.height!==current.height||next.y!==current.y)win.setBounds(next);
  return{ok:true,height:win.getContentBounds().height/zoom};
 }
 function action(event,name,value){
  const owner=trustedEvent(event),child=[...windows.values()].find(item=>item.owner===owner&&item.name===name&&['explorer','panel-viewer','panel-routes','panel-navigation'].includes(item.kind)&&!item.window.isDestroyed());
  if(!owner||owner.kind!=='ide'||!child||owner.revision!==child.ownerRevision||isQuitting()||!['minimize','maximize','isMaximized','close','pin-state','toggle-pin'].includes(value))return false;
  const target=child.window;
  if(value==='pin-state')return windowPins?.state(target)||{pinned:false,locked:false};
  if(value==='toggle-pin')return windowPins?.toggle(target)||{pinned:false,locked:false};
  if(value==='close'){target.close();return true;}
  if(child.kind==='panel-routes')return false; // 軌跡バーには最小化・最大化を提供せず寸法を維持する。
  if(value==='minimize')target.minimize();
  if(value==='maximize'){if(child.panelCollapsed)return false;if(target.isMaximized())target.unmaximize();else target.maximize();}
  return target.isMaximized();
 }
 function dragTarget(owner,name){
  if(!owner||owner.kind!=='ide'||owner.window.isDestroyed()||isQuitting())return null;
  return [...windows.values()].find(child=>child.owner===owner&&child.name===name&&['explorer','panel-viewer','panel-routes','panel-navigation'].includes(child.kind)&&child.shown&&child.ownerRevision===owner.revision&&!child.window.isDestroyed())||null;
 }
 return{prepare,open,created,show,resizeRoutes,action,dragTarget};
}
module.exports={panelBounds,createPanelWindows};
