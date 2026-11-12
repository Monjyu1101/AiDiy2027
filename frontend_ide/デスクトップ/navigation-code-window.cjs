// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const size=require('../host/scripts/window-size.cjs');

// Navi自身を右へ広げる。IDE本体や別Naviの寸法は変更しない。
function createNavigationCodeWindow({trustedEvent,panelTarget,readState,sessionKey,screen,isQuitting=()=>false}){
 const saved=new WeakMap(),requests=new WeakMap();
 return async function navigationCode(event,expanded,name){
  const source=trustedEvent(event);
  const record=name===undefined?source:panelTarget(source,name);
  if(typeof expanded!=='boolean'||!source||!record||!['navi','panel-navigation'].includes(record.kind)||
   (record.kind==='panel-navigation'&&(record.owner!==source||source.kind!=='ide'))||
   (record.kind==='navi'&&record!==source))return{ok:false,error:'Naviの表示範囲を変更できません。'};
  const owner=record.owner||record,revision=owner.revision,token={};requests.set(record,token);
  const valid=()=>!record.panelCollapsed&&!isQuitting()&&!record.window.isDestroyed()&&!owner.window.isDestroyed()&&trustedEvent(event)===source&&owner.revision===revision&&requests.get(record)===token&&(!record.owner||record.ownerRevision===revision);
  try{
   const state=await readState(owner);
   if(!valid()||!state.active||(record.owner&&record.linkKey!==sessionKey(state)))throw Error('Naviの利用状態が変わりました。');
   if(owner.vrPanelMoving)throw Error('VRパネルの移動が終わってから開いてください。');
   const {createNavigationSizeMemory,fitNavigationBounds}=await import('../src/components/開発スペース/Navi窓サイズ.js');
   if(!valid())throw Error('Naviの利用状態が変わりました。');
   if(owner.vrPanelMoving)throw Error('VRパネルの移動が終わってから開いてください。');
   const win=record.window;
   let entry=saved.get(record);if(!entry){entry={memory:createNavigationSizeMemory(size.幅*2),keepMaximized:false};saved.set(record,entry);}
   const {memory}=entry;
   const maximized=win.isMaximized?.()||win.isFullScreen?.();
   const current=maximized&&win.getNormalBounds?win.getNormalBounds():win.getBounds();
   const change=memory.prepare(expanded,current);
   if(!change)return{ok:true,width:win.getBounds().width};
   // 最大化・全画面で開く場合は既存領域を使い、通常寸法だけを記憶する。
   if(maximized&&(expanded||entry.keepMaximized)){
    entry.keepMaximized=expanded;memory.commit(change,current);return{ok:true,width:win.getBounds().width};
   }
   if(win.isFullScreen?.())win.setFullScreen(false);
   if(win.isMaximized?.())win.unmaximize();
   const area=screen.getDisplayMatching(current).workArea;
   const next=fitNavigationBounds(current,change.size,area);
   win.setBounds(next);
   entry.keepMaximized=false;memory.commit(change,win.getBounds());
   return{ok:true,width:win.getBounds().width};
  }catch(error){return{ok:false,error:error.message};}
 };
}
const CRUISE_TITLE='Navi Cruise';
function navigationWindowTitle(record,fallback){const title=record.navigationNormalTitle||fallback;return record.navigationCruise?title.replace('Navi',CRUISE_TITLE):title;}
// DOMをIDEから移したNaviにも、通常の番号付きタイトルを保持する。
function registerNavigationCruiseTitle(record){
 if(record.kind!=='panel-navigation')return;
 record.window.webContents.on('page-title-updated',(event,title)=>{
  if(!record.navigationNormalTitle&&/^AiDiy IDE \/ Navi [1-9][0-9]*$/.test(title))record.navigationNormalTitle=title;
  const next=navigationWindowTitle(record);
  if(next){event.preventDefault();record.window.setTitle(next);}
 });
}
function createNavigationCruiseWindow({trustedEvent,panelTarget,readState,sessionKey,isQuitting=()=>false}){
 const requests=new WeakMap();
 return async function navigationCruise(event,active,name){
  const source=trustedEvent(event),record=name===undefined?source:panelTarget(source,name);
  if(typeof active!=='boolean'||!source||!record||!['navi','panel-navigation'].includes(record.kind)||
   (record.kind==='panel-navigation'&&(record.owner!==source||source.kind!=='ide'))||
   (record.kind==='navi'&&record!==source))return{ok:false,error:'Naviのタイトルを変更できません。'};
  const owner=record.owner||record,revision=owner.revision,token={};requests.set(record,token);
  try{
   const state=await readState(owner);
   if(isQuitting()||record.window.isDestroyed()||owner.window.isDestroyed()||trustedEvent(event)!==source||owner.revision!==revision||requests.get(record)!==token||!state.active||
    (record.owner&&(record.ownerRevision!==revision||record.linkKey!==sessionKey(state))))throw Error('Naviの利用状態が変わりました。');
   if(!record.navigationNormalTitle){
    const title=record.window.getTitle();
    if(record.kind==='navi')record.navigationNormalTitle='AiDiy Navi';
    else if(/^AiDiy IDE \/ Navi [1-9][0-9]*$/.test(title))record.navigationNormalTitle=title;
    else throw Error('Naviの通常タイトルを確認できません。');
   }
   record.navigationCruise=active;
   const title=navigationWindowTitle(record);record.window.setTitle(title);
   return{ok:true,title};
  }catch(error){return{ok:false,error:error.message};}
 };
}
module.exports={createNavigationCodeWindow,createNavigationCruiseWindow,registerNavigationCruiseTitle,navigationWindowTitle};
