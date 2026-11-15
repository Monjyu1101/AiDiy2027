// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.

// ページにIPC権限を渡さず、隔離worldから変更番号だけを読む。
// タイマーはmain側に置き、折畳んでWebContentsViewが隠れていても監視する。
function contentRevision(action) {
 const key='__aidiyContentChanges';
 let state=globalThis[key];
 if(action==='stop'){
  if(state){state.observer.disconnect();document.removeEventListener('input',state.changed,true);document.removeEventListener('change',state.changed,true);delete globalThis[key];}
  return null;
 }
 if(!state){
  state={documentId:Date.now()+':'+Math.random(),revision:0};
  state.changed=()=>{state.revision++;};
  state.observer=new MutationObserver(records=>{
   if(records.some(record=>record.type==='childList'||(record.type==='attributes'?record.target.getAttribute(record.attributeName):record.target.data)!==record.oldValue))state.changed();
  });
  state.observer.observe(document,{subtree:true,childList:true,characterData:true,characterDataOldValue:true,attributes:true,attributeOldValue:true});
  document.addEventListener('input',state.changed,true);document.addEventListener('change',state.changed,true);
  globalThis[key]=state;
 }
 return state.documentId+':'+state.revision;
}

function createBrowserContentMonitor({contents,changed,setTimer=setTimeout,clearTimer=clearTimeout}){
 let enabled=false,disposed=false,timer,epoch=0,previous;
 async function execute(action){
  if(contents.isDestroyed()||!contents.executeJavaScriptInIsolatedWorld)return null;
  try{return await contents.executeJavaScriptInIsolatedWorld(1006,[{code:`(${contentRevision.toString()})(${JSON.stringify(action)})`}]);}catch{return null;}
 }
 async function sample(run){
  const value=await execute('read');
  if(disposed||!enabled||run!==epoch)return;
  if(typeof value==='string'){
   if(previous!==undefined&&value!==previous)changed();
   previous=value;
  }
  timer=setTimer(()=>sample(run),1000);timer?.unref?.();
 }
 function setEnabled(value){
  if(disposed||enabled===!!value)return;
  enabled=!!value;epoch++;clearTimer(timer);timer=undefined;previous=undefined;
  if(enabled)void sample(epoch);else void execute('stop');
 }
 function dispose(){if(disposed)return;setEnabled(false);disposed=true;}
 return{setEnabled,dispose};
}
module.exports={createBrowserContentMonitor,contentRevision};
