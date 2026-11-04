// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {join}=require('node:path');
const {attachNativeWindowMove}=require('./長押し窓移動.cjs');

// WebContentsViewの上に重ねる、全画面時だけの独立ヘッダー。本文の矩形は変更しない。
function createBrowserHeader({BrowserWindow,screen,record,entry,notify,fullscreenKey,headers}){
 let window,contents,ready=false,shown=false,animation,stopMove,position,placing=false,disposed=false;
 let height=100,progress=0,placed;
 const zoom=()=>record.window.webContents.getZoomFactor();
 function bounds(){
  const area=record.window.getContentBounds(),width=Math.max(1,Math.min(800,area.width-16));
  return{x:Math.max(area.x,Math.min(position?.x??area.x+Math.floor((area.width-width)/2),area.x+area.width-width)),y:Math.max(area.y,Math.min(position?.y??area.y,area.y+area.height-height)),width,height};
 }
 function frame(value){
  if(!window||window.isDestroyed())return;
  progress=value;const b=bounds();placing=true;
  window.setBounds({...b,height:Math.max(1,Math.round(height*value))});placed=window.getBounds();placing=false;
  contents.send('development:browser-header-frame',(value-1)*height/zoom());
 }
 function animate(visible){
  clearInterval(animation);if(!ready)return;
  if(visible){frame(progress);window.showInactive();window.moveTop();}
  const from=progress,start=Date.now(),to=visible?1:0;
  animation=setInterval(()=>{
   const t=Math.min(1,(Date.now()-start)/220);frame(from+(to-from)*(1-Math.pow(1-t,3)));
   if(t===1){clearInterval(animation);animation=undefined;if(!visible)window.hide();}
  },16);animation.unref?.();
 }
 function ensure(){
  if(window||disposed||!BrowserWindow)return;
  // OSの材質は中央まで濃く覆うため使わず、透明な面とCSSの4辺で表現する。
  window=new BrowserWindow({parent:record.window,show:false,frame:false,roundedCorners:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,minimizable:false,maximizable:false,skipTaskbar:true,alwaysOnTop:true,...bounds(),webPreferences:{preload:join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  contents=window.webContents;headers.set(contents,record);
  window.setAlwaysOnTop(true,process.platform==='win32'?'pop-up-menu':'floating');
  contents.setZoomFactor(zoom());contents.on('before-input-event',fullscreenKey);
  contents.setWindowOpenHandler(()=>({action:'deny'}));
  contents.on('will-navigate',event=>event.preventDefault());
  window.on('move',()=>{if(!placing&&progress===1){const b=window.getBounds();if(b.x!==placed?.x||b.y!==placed?.y)position={x:b.x,y:b.y};}});
  window.on('closed',()=>{headers.delete(contents);stopMove?.();contents.removeListener('before-input-event',fullscreenKey);window=undefined;ready=false;});
  stopMove=attachNativeWindowMove(window,screen,'browser',{onMoveStart(){entry.headerPinned=true;notify();}});
  void window.loadURL(record.url+'#browser-header').then(()=>{
   if(disposed||!window||window.isDestroyed())return;ready=true;notify();if(shown)animate(true);
  }).catch(()=>{if(!disposed){entry.error='全画面パネルを表示できませんでした。F11キーで戻ってください。';notify();}});
 }
 return{
  get window(){return window;},
  resetPosition(){position=undefined;},
  send(channel,value){if(ready&&!contents.isDestroyed())contents.send(channel,value);},
  contains(point,includeHidden=false){if((!shown&&!includeHidden)||!window||window.isDestroyed())return false;const b=includeHidden?bounds():window.getBounds();return point.x>=b.x&&point.x<b.x+b.width&&point.y>=b.y&&point.y<=b.y+b.height+12;},
  show(value){if(disposed)return;if(value&&!shown)position=undefined;if(value)ensure();if(shown===value)return;shown=value;animate(value);},
  measure(value){const next=Math.max(40,Math.ceil(value*zoom()));if(next===height)return;height=next;if(ready)frame(progress);},
  close(){disposed=true;clearInterval(animation);stopMove?.();if(window&&!window.isDestroyed())window.destroy();},
 };
}
module.exports={createBrowserHeader};
