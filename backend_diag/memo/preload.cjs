// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// See LICENSE for full terms.
'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const subscribe=(name,callback)=>{if(typeof callback!=='function')return ()=>{};const listener=(_event,value)=>callback(value);ipcRenderer.on(name,listener);return ()=>ipcRenderer.removeListener(name,listener);};
contextBridge.exposeInMainWorld('aidiyMemo',Object.freeze({
 getInitialState:()=>ipcRenderer.invoke('diag:memo-window','getInitialState'),
 onBounds:callback=>subscribe('memo:bounds',callback),
 onBlur:callback=>subscribe('memo:blur',callback),
 onCloseRequested:callback=>subscribe('memo:close-requested',callback),
 completeClose:value=>ipcRenderer.invoke('diag:memo-window','completeClose',value),
 updateSavedNote:note=>ipcRenderer.invoke('diag:memo-window','updateSavedNote',note),
 setNoteIdentity:value=>ipcRenderer.invoke('diag:memo-window','setNoteIdentity',value),
 close:()=>ipcRenderer.invoke('diag:memo-window','close'),
 beginWindowMove:()=>ipcRenderer.invoke('diag:memo-window','beginWindowMove'),
 moveWindow:token=>typeof token==='string'?ipcRenderer.invoke('diag:memo-window','moveWindow',token):Promise.resolve(false),
 endWindowMove:token=>typeof token==='string'?ipcRenderer.invoke('diag:memo-window','endWindowMove',token):Promise.resolve(false),
}));
