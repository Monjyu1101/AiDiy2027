// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// 固定ウィンドウ操作だけ。ミニ表示の幅や汎用 invoke は公開せず、高さも範囲を限定する。
contextBridge.exposeInMainWorld('aidiyWindow',Object.freeze({
 prepareMemos:()=>ipcRenderer.invoke('diag:window','prepareMemos'),
 refreshMemos:(release=true)=>typeof release==='boolean'?ipcRenderer.invoke('diag:window','refreshMemos',release):Promise.resolve(false),
 openMemo:(createNew=false)=>typeof createNew==='boolean'?ipcRenderer.invoke('diag:window','openMemo',createNew):Promise.resolve(false),
 customNormalTitle:process.platform==='win32',
 initialMini:process.argv.includes('--aidiy-diag-initial-mini'),
 collapsePanel:collapsed=>typeof collapsed==='boolean'?ipcRenderer.invoke('diag:window','collapsePanel',collapsed):Promise.resolve({ok:false}),
 beginWindowMove:()=>ipcRenderer.invoke('diag:window','beginWindowMove'),
 moveWindow:token=>typeof token==='string'?ipcRenderer.invoke('diag:window','moveWindow',token):Promise.resolve(false),
 endWindowMove:token=>typeof token==='string'?ipcRenderer.invoke('diag:window','endWindowMove',token):Promise.resolve(false),
 minimize:()=>ipcRenderer.invoke('diag:window','minimize'),
 maximize:()=>ipcRenderer.invoke('diag:window','maximize'),
 isMaximized:()=>ipcRenderer.invoke('diag:window','isMaximized'),
 getPinState:()=>ipcRenderer.invoke('diag:window','getPinState'),
 togglePin:()=>ipcRenderer.invoke('diag:window','togglePin'),
 onPinState:callback=>{
  if(typeof callback!=='function')return ()=>{};
  const listener=(_event,state)=>{if(state&&typeof state.pinned==='boolean'&&typeof state.locked==='boolean')callback({pinned:state.pinned,locked:state.locked});};
  ipcRenderer.on('diag:pin-state',listener);
  return ()=>ipcRenderer.removeListener('diag:pin-state',listener);
 },
 showMicroMenu:items=>Array.isArray(items)?ipcRenderer.invoke('diag:window','microMenu',items):Promise.resolve(false),
 onMicroMenu:callback=>{
  if(typeof callback!=='function')return ()=>{};
  const listener=(_event,action)=>{if(['mini','normal'].includes(action))callback(action);else if(action?.type==='launch'&&typeof action.key==='string')callback({type:'launch',key:action.key});};
  ipcRenderer.on('diag:micro-menu',listener);
  return ()=>ipcRenderer.removeListener('diag:micro-menu',listener);
 },
 close:()=>ipcRenderer.invoke('diag:window','close'),
 selectProject:()=>ipcRenderer.invoke('diag:window','selectProject'),
 startMini:enabled=>typeof enabled==='boolean'?ipcRenderer.invoke('diag:window','startMini',enabled):Promise.resolve(false),
 finishMini:()=>ipcRenderer.invoke('diag:window','finishMini'),
 startMicro:enabled=>typeof enabled==='boolean'?ipcRenderer.invoke('diag:window','startMicro',enabled):Promise.resolve(false),
 expandMicro:(expanded,count=13)=>typeof expanded==='boolean'&&Number.isInteger(count)&&count>=0&&count<=32?ipcRenderer.invoke('diag:window','expandMicro',{expanded,count}):Promise.resolve(false),
 resizeMicroLabel:height=>Number.isInteger(height)&&height>=18&&height<=4096?ipcRenderer.invoke('diag:window','resizeMicroLabel',height):Promise.resolve(false),
 beginMicroMove:()=>ipcRenderer.invoke('diag:window','beginMicroMove'),
 moveMicro:token=>typeof token==='string'?ipcRenderer.invoke('diag:window','moveMicro',token):Promise.resolve(false),
 endMicroMove:token=>typeof token==='string'?ipcRenderer.invoke('diag:window','endMicroMove',token):Promise.resolve(false),
 beginDisplay:mode=>['normal','mini','micro'].includes(mode)?ipcRenderer.invoke('diag:window','beginDisplay',mode):Promise.resolve(false),
 finishDisplay:()=>ipcRenderer.invoke('diag:window','finishDisplay'),
 resizeMini:height=>Number.isInteger(height)&&height>=80&&height<=360?ipcRenderer.invoke('diag:window','resizeMini',height):Promise.resolve(false),
}));
