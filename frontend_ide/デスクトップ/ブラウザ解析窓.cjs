// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {join}=require('node:path');

// native本文を隠したり縮めたりせず、全画面ヘッダーと同じ親子窓で解析を重ねる。
function createBrowserAnalysisWindows({BrowserWindow,screen,context}){
 const entries=new Map(),senders=new Map();
 function trusted(event){
  const entry=senders.get(event.sender),frame=event.senderFrame;
  return entry&&!entry.window.isDestroyed()&&!entry.record.window.isDestroyed()&&frame===event.sender.mainFrame&&frame?.url===entry.url?entry.record:null;
 }
 function close(record){const entry=entries.get(record);if(entry&&!entry.window.isDestroyed())entry.window.destroy();}
 async function open(record){
  let entry=entries.get(record);
  if(entry){await entry.ready;if(!entry.window.isDestroyed()){entry.window.show();entry.window.focus();}return;}
  if(!BrowserWindow)throw Error('解析ウィンドウを開けません。');
  const target=context(record);if(!target)throw Error('解析対象を取得できません。');
  const parent=record.window,area=screen.getDisplayMatching(parent.getBounds()).workArea,b=parent.getBounds();
  const width=Math.min(1000,Math.max(1,area.width-24)),height=Math.min(760,Math.max(1,area.height-48));
  const window=new BrowserWindow({parent,show:false,frame:false,roundedCorners:false,backgroundColor:'#101824',resizable:true,minimizable:false,maximizable:false,skipTaskbar:true,title:'Browser AI解析',
   width,height,x:Math.max(area.x,Math.min(b.x+Math.round((b.width-width)/2),area.x+area.width-width)),y:Math.max(area.y,Math.min(b.y+Math.round((b.height-height)/2),area.y+area.height-height)),
   webPreferences:{preload:join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const contents=window.webContents,url=record.url+'#browser-analysis';
  entry={record,window,url,context:target};entries.set(record,entry);senders.set(contents,entry);
  contents.setZoomFactor(parent.webContents.getZoomFactor());
  contents.setWindowOpenHandler(()=>({action:'deny'}));
  contents.on('will-navigate',event=>event.preventDefault());
  const parentClosed=()=>close(record);
  parent.once('closed',parentClosed);
  window.once('closed',()=>{parent.removeListener('closed',parentClosed);senders.delete(contents);if(entries.get(record)===entry)entries.delete(record);});
  entry.ready=Promise.resolve().then(()=>window.loadURL(url)).then(()=>{if(!window.isDestroyed()&&!parent.isDestroyed()){window.show();window.focus();}}).catch(error=>{if(!window.isDestroyed())window.destroy();throw error;});
  await entry.ready;
 }
 return{open,close,trusted,hasSender:sender=>senders.has(sender),context:event=>trusted(event)?senders.get(event.sender).context:null};
}
module.exports={createBrowserAnalysisWindows};
