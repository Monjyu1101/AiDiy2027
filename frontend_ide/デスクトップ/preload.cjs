// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('aidiyWindow',{
 nativeWindowMove:true,
 taskWindows:(action,payload)=>ipcRenderer.invoke('development:task-windows',action,payload),
 taskSession:(action,value)=>ipcRenderer.invoke('development:task-session',action,value),
 onTaskSession:callback=>{if(typeof callback!=='function')return()=>{};const listener=(_event,value)=>callback(value);ipcRenderer.on('development:task-session',listener);return()=>ipcRenderer.removeListener('development:task-session',listener);},
 pinState:()=>ipcRenderer.invoke('development:window','pin-state'),
 togglePin:()=>ipcRenderer.invoke('development:window','toggle-pin'),
 onPinChanged:callback=>{if(typeof callback!=='function')return()=>{};const listener=(_event,state)=>callback(state);ipcRenderer.on('development:pin-changed',listener);return()=>ipcRenderer.removeListener('development:pin-changed',listener);},
 onSpaceCenterMove:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('development:space-center-move',listener);return()=>ipcRenderer.removeListener('development:space-center-move',listener);},
 openBrowser:(path,displayId)=>ipcRenderer.invoke('development:open-browser',path,displayId),
 browserAction:(action,value)=>ipcRenderer.invoke('development:browser-action',action,value),
 onBrowserChanged:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('development:browser-changed',listener);return()=>ipcRenderer.removeListener('development:browser-changed',listener);},
 onBrowserHeaderFrame:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('development:browser-header-frame',listener);return()=>ipcRenderer.removeListener('development:browser-header-frame',listener);},
 onBrowserOpenDraft:callback=>{const listener=()=>callback();ipcRenderer.on('development:browser-open-draft',listener);return()=>ipcRenderer.removeListener('development:browser-open-draft',listener);},
 beginWindowMove:name=>ipcRenderer.invoke('development:window-move-begin',name),
 moveWindow:(token,name)=>ipcRenderer.invoke('development:window-move',token,name),
 endWindowMove:(token,name)=>ipcRenderer.invoke('development:window-move-end',token,name),
 allDisplays:action=>ipcRenderer.invoke('development:all-displays',action),
 onAllDisplaysChanged:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('development:all-displays-changed',listener);return()=>ipcRenderer.removeListener('development:all-displays-changed',listener);},
 beginCodeMove:()=>ipcRenderer.invoke('development:code-move-begin'),
 moveCode:token=>ipcRenderer.invoke('development:code-move',token),
 endCodeMove:token=>ipcRenderer.invoke('development:code-move-end',token),
 prepareExplorer:(rect,kind,previewRect)=>ipcRenderer.invoke('development:prepare-explorer',rect,kind,previewRect),
 resizeRoutes:(name,height)=>ipcRenderer.invoke('development:resize-routes',name,height),
 showExplorer:(name,reduced)=>ipcRenderer.invoke('development:show-explorer',name,reduced),
 panelAction:(name,action)=>ipcRenderer.invoke('development:panel-action',name,action),
 onViewerClosed:callback=>{const listener=(_event,path)=>callback(path);ipcRenderer.on('development:viewer-closed',listener);return()=>ipcRenderer.removeListener('development:viewer-closed',listener);},
 title:()=>ipcRenderer.invoke('development:window','title'),
 copyFilePath:path=>ipcRenderer.invoke('development:copy-file-path',path),
 openFile:path=>ipcRenderer.invoke('development:open-file',path),
 openFolder:path=>ipcRenderer.invoke('development:open-folder',path),
 draftTargets:()=>ipcRenderer.invoke('development:draft-targets'),
 insertDraft:value=>ipcRenderer.invoke('development:draft-insert',value),
 registerDraftTarget:value=>ipcRenderer.invoke('development:draft-target-register',value),
 onDraftHandoff:callback=>{
  if(typeof callback!=='function')return()=>{};
  const listener=(_event,data)=>{
   if(!data||typeof data.requestId!=='string'||data.requestId.length>128)return;
   try{
    // 同期した下書き更新の成否だけを返す。Electronのeventや任意のIPCは公開しない。
    const result=callback(data);
    ipcRenderer.send('development:draft-result',{requestId:data.requestId,ok:result?.ok===true,error:typeof result?.error==='string'?result.error.slice(0,500):undefined});
   }catch{ipcRenderer.send('development:draft-result',{requestId:data.requestId,ok:false,error:'下書きを追加できませんでした。'});}
  };
  ipcRenderer.on('development:draft-handoff',listener);
  return()=>ipcRenderer.removeListener('development:draft-handoff',listener);
 },
 childWindows:()=>ipcRenderer.invoke('development:child-windows'),endSession:()=>ipcRenderer.invoke('development:end-session'),openApp:(kind,displayId)=>ipcRenderer.invoke('development:open-app',kind,displayId),openViewer:(path,rect)=>ipcRenderer.invoke('development:open-viewer',path,rect),maximize:()=>ipcRenderer.invoke('development:window','maximize'),isMaximized:()=>ipcRenderer.invoke('development:window','isMaximized'),minimize:()=>ipcRenderer.invoke('development:window','minimize'),close:()=>ipcRenderer.invoke('development:window','close')});
