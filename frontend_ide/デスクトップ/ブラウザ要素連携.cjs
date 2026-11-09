// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {randomUUID}=require('node:crypto');
const {collectBrowserElement,browserElementText}=require('./ブラウザ要素情報.cjs');
const {createBrowserElementPanel}=require('./ブラウザ要素パネル.cjs');
// 既存CDP接続を共有し、detachやDOM.disableは呼ばない。Overlayはmainの選択操作だけが使う。
function createBrowserElementLink({contents,record,available,onChange,onSelected,onError,panelFactory=createBrowserElementPanel}){
 const hostContents=record.window.webContents,debug=contents.debugger;let active=false,inspecting=false,overlayEnabled=false,disposed=false,generation=0,sequence=0,selected,panel,reading=false,pendingHover,selecting=false,queue=Promise.resolve();
 const current=run=>!disposed&&active&&generation===run&&available()&&!contents.isDestroyed()&&!record.window.isDestroyed();
 const command=(method,params={})=>debug.sendCommand(method,params);
 const overlay=action=>{const next=queue.then(action);queue=next.catch(()=>{});return next;};
 function key(event,input){if(active&&input.type==='keyDown'&&input.key==='Escape'){event.preventDefault();void stop();}}
 async function stop(keepSelection=false){
  active=false;inspecting=false;const run=++generation;sequence++;pendingHover=undefined;selecting=false;
  if(!keepSelection)selected=undefined;
  const closing=panel?.close();panel=undefined;onChange();
  // Chromiumはmode:noneでもhighlightConfigを検証する。省略すると選択とクリック抑止が残る。
  const stopped=await overlay(async()=>{
   if(!debug?.isAttached()||contents.isDestroyed()){overlayEnabled=false;return true;}
   if(!overlayEnabled)return true;
   // 検査用Overlayの入力面も破棄してから下書き窓を開く。共有CDP / DOMは維持する。
   try{await command('Overlay.setInspectMode',{mode:'none',highlightConfig:{}});await command('Overlay.hideHighlight');}
   finally{await command('Overlay.disable');overlayEnabled=false;}
   return true;
  }).catch(()=>{
   if(generation===run)selected=undefined;
   if(!disposed&&generation===run&&!contents.isDestroyed()&&!record.window.isDestroyed())onError('要素連携を解除できませんでした。ページを再読み込みしてください。');
   return false;
  });
  await closing;return stopped;
 }
 async function read(node,run){
  const group='aidiy-element-'+run+'-'+randomUUID();
  try{
   const tree=await command('Page.getFrameTree');if(!current(run))return;
   const {executionContextId}=await command('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'aidiy-element-inspector',grantUniveralAccess:false});if(!current(run))return;
   const resolved=await command('DOM.resolveNode',{...node,executionContextId,objectGroup:group});if(!current(run))return;
   const result=await command('Runtime.callFunctionOn',{objectId:resolved.object.objectId,functionDeclaration:collectBrowserElement.toString(),returnByValue:true,silent:true});
   if(result.exceptionDetails||!result.result?.value)throw Error('この要素を取得できません。別の要素を選択してください。');
   const value=result.result.value;
   if(typeof value.html!=='string'||value.html.length>16000||typeof value.selector!=='string'||!value.css||!value.rect)throw Error('要素の情報が不正です。');
   return value;
  }finally{if(debug?.isAttached()&&!contents.isDestroyed())await command('Runtime.releaseObjectGroup',{objectGroup:group}).catch(()=>{});}
 }
 async function hover(nodeId){
  pendingHover=nodeId;if(reading||selecting)return;
  reading=true;
  try{
   while(pendingHover&&active&&!selecting){
    const node=pendingHover;pendingHover=undefined;const run=generation,revision=++sequence;
    try{const value=await read({nodeId:node},run);if(value&&current(run)&&sequence===revision&&!pendingHover&&!selecting){onError('');panel?.update(value);}}
    catch{if(current(run)&&!pendingHover&&!selecting)onError('この要素の情報を取得できません。iframeなどは枠の要素を選択してください。');}
   }
  }finally{reading=false;}
 }
 async function pick(backendNodeId){
  if(!active||selecting)return;
  selecting=true;pendingHover=undefined;sequence++;const run=generation;
  try{
   const value=await read({backendNodeId},run);if(!value||!current(run))return;
   const choice=selected={id:randomUUID(),url:contents.getURL(),value};
   const stopped=await stop(true);
   if(stopped&&!disposed&&selected===choice&&available())onSelected();
  }catch{if(current(run)){await stop();onError('この要素を取得できませんでした。要素連携をもう一度押して、別の要素を選んでください。');}}
 }
 function message(_event,method,params){
  if(!active||!inspecting)return;
  if(method==='Overlay.nodeHighlightRequested')void hover(params.nodeId);
  else if(method==='Overlay.inspectNodeRequested')void pick(params.backendNodeId);
  else if(method==='Overlay.inspectModeCanceled')void stop();
 }
 async function start(){
  if(active){await stop();return;}
  if(disposed||!available())throw Error('tools接続中のみ要素連携を利用できます。');
  if(!debug)throw Error('要素連携を開始できません。Browserを開き直してください。');
  active=true;selected=undefined;const run=++generation;onChange();
  try{
   if(!debug.isAttached())debug.attach('1.3');
   await command('DOM.enable');if(!current(run))return;
   // DOM.enableだけではfrontendのdocument IDが未登録で、ホバーのnodeHighlightRequestedが届かない。
   await command('DOM.getDocument',{depth:0});if(!current(run))return;
   panel=panelFactory({contents,onClose:()=>void stop()});await panel.open();
   await overlay(async()=>{
    if(!current(run))return;
    // 直前の解除完了後に有効化し、連続した取消・再開始でdisableに追い越されない。
    await command('Overlay.enable');overlayEnabled=true;if(!current(run))return;
    // 最初のホバーは開始応答より先に届く場合がある。受信を先に有効にして取りこぼさない。
    inspecting=true;
    await command('Overlay.setInspectMode',{mode:'searchForNode',highlightConfig:{showInfo:false,showStyles:false,contentColor:{r:50,g:180,b:245,a:.15},borderColor:{r:30,g:220,b:255,a:.9}}});
   });
   if(current(run))contents.focus?.();
  }catch(error){if(current(run)){await stop();throw Error('要素連携を開始できません。'+error.message);}}
 }
 function request(projectRoot,source,id){
  if(!selected||!available()||contents.isDestroyed()||contents.getURL()!==selected.url||(id!==undefined&&id!==selected.id))throw Error('選択した要素は無効になりました。もう一度選択してください。');
  if(!source?.session||!source?.tabId)throw Error('Browserの接続先を確認できません。');
  return{projectPath:projectRoot,path:selected.value.url,selection:true,browserElementId:selected.id,text:`session: ${source.session}\ntab_id: ${source.tabId}\n`+browserElementText(selected.value)};
 }
 const navigation=(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame!==false)void stop();};
 const gone=()=>void stop(),detached=()=>{const wasActive=active;void stop();if(wasActive)onError('要素連携の接続が終了しました。もう一度開始してください。');};
 debug?.on('message',message);debug?.on('detach',detached);
 contents.on('before-input-event',key);hostContents.on('before-input-event',key);
 contents.on('did-start-navigation',navigation);contents.on('render-process-gone',gone);record.window.on('minimize',gone);
 function dispose(){if(disposed)return;disposed=true;void stop();debug?.removeListener('message',message);debug?.removeListener('detach',detached);contents.removeListener('before-input-event',key);hostContents.removeListener('before-input-event',key);contents.removeListener('did-start-navigation',navigation);contents.removeListener('render-process-gone',gone);record.window.removeListener('minimize',gone);}
 return{start,stop,key,request,dispose,get active(){return active;}};
}
module.exports={createBrowserElementLink};
