// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const size=require('../host/scripts/window-size.cjs');

// Navigator自身を右へ広げる。IDE本体や別Navigatorの寸法は変更しない。
function createNavigationCodeWindow({trustedEvent,panelTarget,readState,sessionKey,screen,isQuitting=()=>false}){
 const saved=new WeakMap(),requests=new WeakMap();
 return async function navigationCode(event,expanded,name){
  const source=trustedEvent(event);
  const record=name===undefined?source:panelTarget(source,name);
  if(typeof expanded!=='boolean'||!source||!record||!['navi','panel-navigation'].includes(record.kind)||
   (record.kind==='panel-navigation'&&(record.owner!==source||source.kind!=='ide'))||
   (record.kind==='navi'&&record!==source))return{ok:false,error:'Navigatorの表示範囲を変更できません。'};
  const owner=record.owner||record,revision=owner.revision,token={};requests.set(record,token);
  const valid=()=>!isQuitting()&&!record.window.isDestroyed()&&!owner.window.isDestroyed()&&trustedEvent(event)===source&&owner.revision===revision&&requests.get(record)===token&&(!record.owner||record.ownerRevision===revision);
  try{
   const state=await readState(owner);
   if(!valid()||!state.active||(record.owner&&record.linkKey!==sessionKey(state)))throw Error('Navigatorの利用状態が変わりました。');
   if(owner.vrPanelMoving)throw Error('VRパネルの移動が終わってから開いてください。');
   const win=record.window,previous=saved.get(record);
   let current=win.getBounds();
   // 最大化・全画面から開くときは既存領域を使う。拡張後に最大化した窓を閉じる場合は元の寸法へ戻す。
   if(win.isMaximized?.()||win.isFullScreen?.()){
    if(expanded||!previous)return{ok:true,width:current.width};
    if(win.isFullScreen?.())win.setFullScreen(false);
    if(win.isMaximized?.())win.unmaximize();
    current={...previous};
   }
   if(expanded&&previous||!expanded&&!previous)return{ok:true,width:current.width};
   const area=screen.getDisplayMatching(current).workArea,margin=8;
   const width=Math.min(expanded?current.width+size.幅:previous.width,Math.max(1,area.width-margin*2));
   const height=Math.min(expanded?current.height:previous.height,Math.max(1,area.height-margin*2));
   const next={x:Math.max(area.x+margin,Math.min(current.x,area.x+area.width-margin-width)),y:Math.max(area.y+margin,Math.min(current.y,area.y+area.height-margin-height)),width,height};
   win.setBounds(next);
   if(expanded)saved.set(record,current);else saved.delete(record);
   return{ok:true,width};
  }catch(error){return{ok:false,error:error.message};}
 };
}
const CRUISE_TITLE='Navigation Cruise';
function navigationWindowTitle(record,fallback){const title=record.navigationNormalTitle||fallback;return record.navigationCruise?title.replace('Navigator',CRUISE_TITLE):title;}
// DOMをIDEから移したNavigatorにも、通常の番号付きタイトルを保持する。
function registerNavigationCruiseTitle(record){
 if(record.kind!=='panel-navigation')return;
 record.window.webContents.on('page-title-updated',(event,title)=>{
  if(!record.navigationNormalTitle&&/^AiDiy IDE \/ Navigator [1-9][0-9]*$/.test(title))record.navigationNormalTitle=title;
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
   (record.kind==='navi'&&record!==source))return{ok:false,error:'Navigatorのタイトルを変更できません。'};
  const owner=record.owner||record,revision=owner.revision,token={};requests.set(record,token);
  try{
   const state=await readState(owner);
   if(isQuitting()||record.window.isDestroyed()||owner.window.isDestroyed()||trustedEvent(event)!==source||owner.revision!==revision||requests.get(record)!==token||!state.active||
    (record.owner&&(record.ownerRevision!==revision||record.linkKey!==sessionKey(state))))throw Error('Navigatorの利用状態が変わりました。');
   if(!record.navigationNormalTitle){
    const title=record.window.getTitle();
    if(record.kind==='navi')record.navigationNormalTitle='AiDiy Navigator';
    else if(/^AiDiy IDE \/ Navigator [1-9][0-9]*$/.test(title))record.navigationNormalTitle=title;
    else throw Error('Navigatorの通常タイトルを確認できません。');
   }
   record.navigationCruise=active;
   const title=navigationWindowTitle(record);record.window.setTitle(title);
   return{ok:true,title};
  }catch(error){return{ok:false,error:error.message};}
 };
}
module.exports={createNavigationCodeWindow,createNavigationCruiseWindow,registerNavigationCruiseTitle,navigationWindowTitle};
