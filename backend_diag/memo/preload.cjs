// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('aidiyMemo',Object.freeze({
 onNewMemo:callback=>{
  if(typeof callback!=='function')return ()=>{};
  const listener=()=>callback();ipcRenderer.on('memo:new',listener);
  return ()=>ipcRenderer.removeListener('memo:new',listener);
 },
 minimize:()=>ipcRenderer.invoke('diag:memo-window','minimize'),
 maximize:()=>ipcRenderer.invoke('diag:memo-window','maximize'),
 close:()=>ipcRenderer.invoke('diag:memo-window','close'),
 togglePin:()=>ipcRenderer.invoke('diag:memo-window','togglePin'),
 setDirty:value=>typeof value==='boolean'?ipcRenderer.invoke('diag:memo-window','setDirty',value):Promise.resolve(false),
 collapsePanel:value=>typeof value==='boolean'?ipcRenderer.invoke('diag:memo-window','collapsePanel',value):Promise.resolve({ok:false}),
 beginWindowMove:()=>ipcRenderer.invoke('diag:memo-window','beginWindowMove'),
 moveWindow:token=>typeof token==='string'?ipcRenderer.invoke('diag:memo-window','moveWindow',token):Promise.resolve(false),
 endWindowMove:token=>typeof token==='string'?ipcRenderer.invoke('diag:memo-window','endWindowMove',token):Promise.resolve(false),
}));
