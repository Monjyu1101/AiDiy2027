// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {randomUUID}=require('node:crypto');
const limits={code:200000,live:20000};
const bounded=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!value.includes('\0');
const fail=error=>({ok:false,error});

// IDE所有者・利用セッション・正確な窓IDを照合して、一つの入力欄だけへ渡す。
// 通信権限の確認（メインフレームとURL）は呼び出し側のtrustedEventで行う。
function createDraftRouter({records,readState,sessionKey,focusWindow,isQuitting=()=>false,timeout=4000,now=Date.now,uuid=randomUUID,setTimer=setTimeout,clearTimer=clearTimeout}){
 const pending=new Map(),focusOrder=new WeakMap();let focusSequence=0;
 const alive=record=>!!record&&!record.window.isDestroyed()&&[...records.values()].includes(record);
 function ownerOf(source){
  if(!alive(source))return null;
  const owner=['ide','code','live'].includes(source.kind)&&!source.owner?source:['viewer','browser'].includes(source.kind)?source.owner:null;
  return alive(owner)&&['ide','code','live'].includes(owner.kind)?owner:null;
 }
 function linked(source,owner,state,revision){
  return !isQuitting()&&ownerOf(source)===owner&&owner.revision===revision&&!!state?.active&&bounded(state.project?.path,4096)&&bounded(sessionKey(state),1024)&&(source===owner||source.linkKey===sessionKey(state));
 }
 function currentTarget(target,owner,state){
  return alive(target)&&(target===owner||target.owner===owner&&target.linkKey===sessionKey(state))&&Object.hasOwn(limits,target.kind)&&(target.kind!=='live'||state.mode==='online')&&target.draftTarget?.projectPath===state.project.path;
 }
 // OSのfocusイベントだけを記録する。IDE・ビューア・登録更新では順番を変えない。
 function focused(record){
  if(alive(record)&&Object.hasOwn(limits,record.kind))focusOrder.set(record,++focusSequence);
 }
 function register(record,value){
  if(!alive(record)||!Object.hasOwn(limits,record.kind))return fail('この画面は渡し先として登録できません。');
  if(value===null){record.draftTarget=null;return{ok:true};}
  if(!value||value.kind!==record.kind||!bounded(value.contextId,128)||!bounded(value.projectPath,4096)||typeof value.label!=='string'||value.label.length>200)return fail('渡し先の情報が不正です。');
  record.draftId??=uuid();
  record.draftTarget={contextId:value.contextId,projectPath:value.projectPath,label:value.label};
  return{ok:true};
 }
 async function list(source){
  const owner=ownerOf(source);if(!owner)return fail('この画面からは下書きを渡せません。');
  const revision=owner.revision;
  try{
   const state=await readState(owner);
   if(!linked(source,owner,state,revision))return fail('IDEの利用状態が変わりました。');
   const targets=[...records.values()].filter(target=>currentTarget(target,owner,state)).map(target=>({id:target.draftId,kind:target.kind,label:`${target.kind==='code'?`Code ${target.slot+1}`:'Live'}${target.draftTarget.label&&!['Code','Live'].includes(target.draftTarget.label)?` · ${target.draftTarget.label}`:''}`,contextId:target.draftTarget.contextId,projectPath:state.project.path,maxLength:limits[target.kind]}));
   const frontmost=[...records.values()].filter(target=>currentTarget(target,owner,state)&&focusOrder.has(target)&&target.window.isMinimized?.()!==true&&target.window.isVisible?.()!==false).sort((a,b)=>focusOrder.get(b)-focusOrder.get(a))[0];
   return{ok:true,sessionKey:sessionKey(state),projectPath:state.project.path,mode:state.mode,targets,frontmostTargetId:frontmost?.draftId||''};
  }catch{return fail('IDEの利用状態を確認できません。');}
 }
 async function insert(source,data){
  const owner=ownerOf(source);if(!owner)return fail('この画面からは下書きを渡せません。');
  if(!data||!bounded(data.targetId,128)||!bounded(data.contextId,128)||!bounded(data.sessionKey,1024)||!bounded(data.projectPath,4096)||!bounded(data.text,200000)||!data.text.trim())return fail('下書きの受け渡し情報が不正、または長すぎます。');
  const revision=owner.revision;
  try{
   const state=await readState(owner);
   if(!linked(source,owner,state,revision)||data.sessionKey!==sessionKey(state)||data.projectPath!==state.project.path)return fail('IDEの利用状態やプロジェクトが変わりました。渡し先を選び直してください。');
   const target=[...records.values()].find(record=>record.draftId===data.targetId);
   if(!currentTarget(target,owner,state)||target.draftTarget.contextId!==data.contextId)return fail('選んだ画面が閉じたか、会話が変わりました。渡し先を選び直してください。');
   if(data.text.length>limits[target.kind])return fail('選んだ入力欄に渡す内容が長すぎます。');
   if(pending.size>=64||[...pending.values()].some(item=>item.source===source||item.target===target))return fail('下書きへの追加を確認中です。しばらくお待ちください。');
   const requestId=uuid(),expiresAt=now()+timeout;
   return await new Promise(resolve=>{
    const item={source,owner,target,state,revision,contextId:data.contextId,resolve,timer:null};
    pending.set(requestId,item);
    item.timer=setTimer(()=>finish(requestId,fail('下書きへの追加を確認できませんでした。渡し先の入力欄を確認してください。')),timeout);
    item.timer?.unref?.();
    try{target.window.webContents.send('development:draft-handoff',{requestId,contextId:data.contextId,projectPath:state.project.path,text:data.text,expiresAt});}
    catch{finish(requestId,fail('選んだ画面に下書きを渡せませんでした。'));}
   });
  }catch{return fail('IDEの利用状態を確認できません。');}
 }
 function finish(id,result){const item=pending.get(id);if(!item)return;pending.delete(id);clearTimer(item.timer);item.resolve(result);}
 function acknowledge(record,data){
  if(!data||!bounded(data.requestId,128)||typeof data.ok!=='boolean')return;
  const item=pending.get(data.requestId);if(!item||item.target!==record)return;
  if(!linked(item.source,item.owner,item.state,item.revision)||!currentTarget(record,item.owner,item.state)||record.draftTarget.contextId!==item.contextId){finish(data.requestId,fail('受け渡し中に画面や利用状態が変わりました。'));return;}
  const result=data.ok?{ok:true}:fail(typeof data.error==='string'?data.error.slice(0,500):'下書きを追加できませんでした。');
  if(result.ok)focusWindow(record.window);
  finish(data.requestId,result);
 }
 function invalidate(record){
  if(record)record.draftTarget=null;
  for(const [id,item] of pending)if(item.source===record||item.target===record||item.owner===record)finish(id,fail('受け渡し中に画面が閉じたか、利用が終了しました。'));
 }
 return{register,list,insert,acknowledge,invalidate,focused};
}
module.exports={createDraftRouter};
