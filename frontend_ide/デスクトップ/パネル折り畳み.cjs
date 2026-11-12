// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 窓の高さそのものを変更する。連打時は現在位置から反転し、移動した座標を維持する。
function createPanelCollapse({trustedEvent,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,duration=220}){
 const states=new WeakMap();
 return function collapse(event,collapsed){
  const record=trustedEvent(event),win=record?.window;
  if(typeof collapsed!=='boolean'||!['code','live'].includes(record?.kind)||!win||win.isDestroyed()||win.isFullScreen()||record.vrPanelMoving||record.owner?.vrPanelMoving)return Promise.resolve({ok:false});
  let state=states.get(win);
  if(!state){
   if(!collapsed)return Promise.resolve({ok:true});
   state={height:win.getNormalBounds?.().height||win.getBounds().height,min:win.getMinimumSize(),resizable:win.isResizable(),maximizable:win.isMaximizable(),maximized:win.isMaximized()};
   states.set(win,state);
   const cleanup=()=>{clearTimer(state.timer);state.resolve?.({ok:false});states.delete(win);win.removeListener('closed',cleanup);win.webContents.removeListener('did-start-navigation',reload);};
   const reload=()=>{if(!win.isDestroyed()){win.setMinimumSize(...state.min);win.setResizable(state.resizable);win.setMaximizable(state.maximizable);win.setBounds({...win.getBounds(),height:state.height});}cleanup();};
   state.cleanup=cleanup;win.once('closed',cleanup);win.webContents.once('did-start-navigation',reload);
   if(state.maximized)win.unmaximize();
   win.setMinimumSize(state.min[0],1);win.setResizable(false);win.setMaximizable(false);
  }
  clearTimer(state.timer);state.resolve?.({ok:false,superseded:true});
  const start=now(),from=win.getBounds().height;
  const target=collapsed?Math.ceil(31*(win.webContents.getZoomFactor?.()||1)):state.height;
  return new Promise(resolve=>{
   state.resolve=resolve;
   function frame(){
    if(win.isDestroyed()){state.cleanup();return;}
    const t=Math.min(1,(now()-start)/duration),ease=1-Math.pow(1-t,3);
    win.setBounds({...win.getBounds(),height:Math.round(from+(target-from)*ease)},false);
    if(t<1){state.timer=setTimer(frame,16);return;}
    state.resolve=null;
    if(!collapsed){win.setMinimumSize(...state.min);win.setResizable(state.resizable);win.setMaximizable(state.maximizable);if(state.maximized)win.maximize();state.cleanup();}
    resolve({ok:true});
   }
   frame();
  });
 };
}
module.exports={createPanelCollapse};
