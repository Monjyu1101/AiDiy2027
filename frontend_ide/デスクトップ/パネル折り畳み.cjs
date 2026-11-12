// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {setWindowBounds}=require('./全画面横断.cjs');
// 窓の高さそのものを変更する。連打時は現在位置から反転し、移動した座標を維持する。
function createPanelCollapse({trustedEvent,resolvePanel=()=>null,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,duration=220,canCollapse=()=>true,onChange=()=>{}}){
 const states=new WeakMap();
 return function collapse(event,collapsed,name){
  const source=trustedEvent(event),record=name===undefined?source:resolvePanel(source,name),win=record?.window;
  if(typeof collapsed!=='boolean'||!['code','live','console','browser','navi','task','team','diag','panel-navigation','explorer','panel-viewer','viewer'].includes(record?.kind)||!win||win.isDestroyed()||win.isFullScreen()||record.vrPanelMoving||record.owner?.vrPanelMoving||!canCollapse(record))return Promise.resolve({ok:false});
  let state=states.get(win);
  if(!state){
   if(!collapsed)return Promise.resolve({ok:true});
   state={width:win.getNormalBounds?.().width||win.getBounds().width,height:win.getNormalBounds?.().height||win.getBounds().height,min:win.getMinimumSize(),resizable:win.isResizable(),maximizable:win.isMaximizable(),maximized:win.isMaximized()};
   states.set(win,state);record.panelCollapsed=true;
   // closed後のBrowserWindow.webContents getterはElectron/OSにより破棄済み例外になる。
   // 生存中にEventEmitterを保持し、終了時は窓・表示更新APIに触れない。
   const contents=win.webContents;
   const cleanup=()=>{if(state.cleaned)return;state.cleaned=true;clearTimer(state.timer);state.resolve?.({ok:false});state.resolve=null;states.delete(win);record.panelCollapsed=false;win.removeListener('closed',cleanup);contents.removeListener('did-start-navigation',reload);if(!win.isDestroyed())onChange(record,false);};
   // 幅は開始時のDIP値を維持し、getBounds/setBoundsのOS外枠・端数DPI差を累積させない。
   const restore=()=>{const position=win.getBounds();win.setMinimumSize(...state.min);win.setResizable(state.resizable);win.setMaximizable(state.maximizable);setWindowBounds(win,{...position,width:state.width,height:state.height});if(state.maximized)win.maximize();};
   state.restore=restore;
   const reload=()=>{if(!win.isDestroyed())restore();cleanup();};
   state.cleanup=cleanup;win.once('closed',cleanup);contents.once('did-start-navigation',reload);
   if(state.maximized)win.unmaximize();
   win.setMinimumSize(state.min[0],1);win.setResizable(false);win.setMaximizable(false);
  }
  if(collapsed)onChange(record,true);
  clearTimer(state.timer);state.resolve?.({ok:false,superseded:true});
  const start=now(),from=win.getBounds().height;
  const target=collapsed?Math.ceil(31*(win.webContents.getZoomFactor?.()||1)):state.height;
  return new Promise(resolve=>{
   state.resolve=resolve;
   function frame(){
    if(win.isDestroyed()){state.cleanup();return;}
    const t=Math.min(1,(now()-start)/duration),ease=1-Math.pow(1-t,3);
    setWindowBounds(win,{...win.getBounds(),width:state.width,height:Math.round(from+(target-from)*ease)});
    if(t<1){state.timer=setTimer(frame,16);return;}
    state.resolve=null;
    if(!collapsed){state.restore();state.cleanup();}
    resolve({ok:true});
   }
   frame();
  });
 };
}
module.exports={createPanelCollapse};
