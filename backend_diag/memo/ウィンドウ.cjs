// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const path=require('node:path');
const {createPanelCollapse}=require('../../frontend_ide/デスクトップ/パネル折り畳み.cjs');
const {createCodeDrag}=require('../../frontend_ide/デスクトップ/code-drag.cjs');
const {createWindowPins}=require('../../frontend_ide/デスクトップ/最前面ピン.cjs');
// Diag の起動認証と非永続 session を共有。任意 URL・ファイル・IPC は公開しない。
function メモ窓を作成({BrowserWindow,ipcMain,dialog,screen,url,session}){
 let window,record,opening,confirming=false,allowUnload=false,parentClose,finishParentClose;
 const target=new URL('memo.html',url);target.hash=url.hash;
 const pins=createWindowPins();
 const trusted=event=>window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame?record:null;
 const collapse=createPanelCollapse({trustedEvent:trusted});
 const drag=createCodeDrag({trustedEvent:trusted,screen});
 ipcMain.handle('diag:memo-window',(event,action,value)=>{
  if(!trusted(event))return false;
  if(action==='minimize'){window.minimize();return true;}
  if(action==='maximize'){if(record.panelCollapsed)return false;window.isMaximized()?window.unmaximize():window.maximize();return true;}
  if(action==='togglePin')return pins.toggle(window);
  if(action==='close'){window.close();return true;}
  if(action==='setDirty')return typeof value==='boolean'; // 終了判定は最新の renderer beforeunload で行う。
  if(action==='collapsePanel')return typeof value==='boolean'?collapse(event,value):{ok:false};
  if(action==='beginWindowMove')return drag.begin(event);
  if(action==='moveWindow')return typeof value==='string'&&drag.move(event,value);
  if(action==='endWindowMove'){if(typeof value==='string')drag.end(event,value);return false;}
  return false;
 });
 function finishClose(value){const resolve=finishParentClose;finishParentClose=null;parentClose=null;resolve?.(value);}
 async function open(createNew=false){
  if(typeof createNew!=='boolean')return false;
  if(opening){const loaded=await opening;if(loaded&&createNew&&window&&!window.isDestroyed())window.webContents.send('memo:new');return loaded;}
  if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();if(createNew)window.webContents.send('memo:new');return true;}
  opening=(async()=>{
   allowUnload=false;
   const current=new BrowserWindow({width:600,height:450,minWidth:320,minHeight:200,title:'AiDiy Memo',frame:false,roundedCorners:false,show:false,backgroundColor:'#000000',icon:path.join(__dirname,'../static/AiDiy_diag.png'),webPreferences:{session,preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
   window=current;record={window:current,kind:'diag',revision:0};pins.register(current,{pinned:true,locked:true});
   current.setMenuBarVisibility(false);
   current.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   current.webContents.on('will-navigate',event=>event.preventDefault());
   current.webContents.on('will-redirect',event=>event.preventDefault());
   current.webContents.on('will-attach-webview',event=>event.preventDefault());
   current.webContents.on('will-prevent-unload',event=>{
    // Electron は beforeunload の確認を自動表示しない。既定は取消、明示承認時だけ破棄。
    if(allowUnload){event.preventDefault();return;}
    if(confirming)return;
    confirming=true;
    void dialog.showMessageBox(current,{type:'question',title:'AiDiy Memo',message:'保存していないメモがあります。変更を破棄して閉じますか？',buttons:['破棄して閉じる','戻る'],defaultId:1,cancelId:1,noLink:true}).then(result=>{
     if(result.response===0&&!current.isDestroyed()){allowUnload=true;current.close();}
     else finishClose(false);
    }).catch(()=>finishClose(false)).finally(()=>{confirming=false;});
   });
   current.once('closed',()=>{if(window===current){window=null;record=null;}finishClose(true);});
   try{await current.loadURL(target.href);if(!current.isDestroyed())current.show();return true;}
   catch{
    if(current.isDestroyed())return false;
    current.destroy();
    try{await dialog.showMessageBox({type:'error',title:'AiDiy Memo',message:'メモ画面を開けませんでした。Diag の「Memo」から再度開いてください。',buttons:['閉じる']});}catch{}
    return false;
   }
  })();
  try{const loaded=await opening;if(loaded&&createNew&&window&&!window.isDestroyed())window.webContents.send('memo:new');return loaded;}finally{opening=null;}
 }
 function closeForParent(){
  if(!window||window.isDestroyed())return Promise.resolve(true);
  if(parentClose)return parentClose;
  const result=parentClose=new Promise(resolve=>{finishParentClose=resolve;});
  window.close();return result;
 }
 return {open,closeForParent};
}
module.exports={メモ窓を作成};
