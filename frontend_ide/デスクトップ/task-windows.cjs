// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const views=new Set(['request','flow','detail']);
function taskWindowBounds(view,area){
 const dialog=view==='dialog',margin=16,width=Math.min(dialog?1280:520,Math.max(1,area.width-margin*2)),height=Math.min(dialog?800:620,Math.max(1,area.height-margin*2));
 const order=view==='flow'?1:view==='detail'?2:0;
 return{x:Math.round(dialog?area.x+(area.width-width)/2:Math.min(area.x+margin+(width+12)*order,area.x+area.width-width-margin)),y:Math.round(dialog?area.y+(area.height-height)/2:area.y+margin),width,height,minWidth:Math.min(dialog?640:440,width),minHeight:Math.min(dialog?480:420,height)};
}
function copyPayload(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!['request','detail','response'].includes(value.kind))throw Error('タスク編集内容が不正です。');
 const text=JSON.stringify(value);if(Buffer.byteLength(text,'utf8')>2*1024*1024)throw Error('タスク編集内容が大きすぎます。');
 return JSON.parse(text);
}
function createTaskWindows({records,trustedEvent,createWindow,focusWindow,onLastClosed=()=>{},isQuitting=()=>false,owns=()=>true,authenticated=false}){
 const pending=new Map();let revision=0,dialogRevision=0,ending=false,authRevision=0,token=authenticated?'ide-internal':'';
 const valid=record=>record&&record.kind==='task'&&owns(record)&&!record.window.isDestroyed()&&!isQuitting()&&!ending;
 const live=()=>[...records.values()].filter(r=>valid(r));
 function source(event){const record=trustedEvent(event);if(!valid(record))throw Error('Task画面から操作してください。');return record;}
 const find=view=>live().find(r=>r.taskView===view);
 const session=()=>({revision:authRevision,token});
 const broadcastSession=()=>{for(const record of live())record.window.webContents?.send('development:task-session',session());};
 function closed(record){
  if(record.kind!=='task'||!owns(record)||ending)return;
  if(!live().some(r=>views.has(r.taskView))){ending=true;revision++;token='';authRevision++;pending.clear();for(const r of records.values())if(r.kind==='task'&&owns(r)&&!r.window.isDestroyed())r.window.destroy();onLastClosed();}
 }
 async function open(view,payload){
  if(ending||isQuitting())return{ok:false,error:'Taskは終了しています。'};
  const dialog=view==='dialog';
  if(!dialog){if(pending.has(view))return pending.get(view);const existing=find(view);if(existing){focusWindow(existing.window);return{ok:true,reused:true};}}
  const generation=revision,dialogGeneration=dialog?++dialogRevision:dialogRevision;
  if(dialog){const existing=find(view);if(existing)existing.window.destroy();}
  const request=(async()=>{
   const window=await createWindow(view,payload);
   if(ending||isQuitting()||revision!==generation||dialog&&dialogRevision!==dialogGeneration){if(!window.isDestroyed())window.destroy();return{ok:false,error:'Taskの表示状態が変わりました。'};}
   return{ok:true};
  })();
  pending.set(view,request);
  try{return await request;}finally{if(pending.get(view)===request)pending.delete(view);}
 }
 async function setSession(event,value){
  source(event);
  if(!value||typeof value.token!=='string'||value.token.length>16384||/[\r\n\0]/.test(value.token)||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0)throw Error('Task認証情報が不正です。');
  if(value.expectedRevision!==authRevision)return{ok:false,error:'認証状態が更新されました。',...session()};
  token=value.token;const run=++authRevision;
  // Pending windows from a previous authentication must not survive logout.
  if(!token){revision++;dialogRevision++;pending.clear();}
  broadcastSession();
  if(!token){
   // Keep a primary panel alive before removing the last surviving peer.
   const result=await open('request');
   if(run!==authRevision)return{ok:false,error:'認証状態が更新されました。',...session()};
   if(!result.ok)return{...result,...session()};
   for(const record of live())if(record.taskView!=='request')record.window.destroy();
  }
  return{ok:true,...session()};
 }
 // 配置復元専用。残す主画面を先に開き、最後の主画面を閉じてサービスを終了させない。
 async function restoreViews(selected){
  if(!authenticated||!token||!Array.isArray(selected)||!selected.length||selected.some(view=>!views.has(view)))return{ok:false,error:'TASKの復元対象が不正です。'};
  const generation=revision;
  for(const view of new Set(selected)){const result=await open(view);if(!result.ok)return result;}
  if(generation!==revision||ending||isQuitting())return{ok:false,error:'TASKの利用状態が変わりました。'};
  for(const record of live())if(views.has(record.taskView)&&!selected.includes(record.taskView))record.window.destroy();
  return{ok:true};
 }
 return{closed,restoreViews,start:()=>open('request'),async session(event,action,value){try{source(event);if(action==='get')return{ok:true,...session()};if(action!=='set')throw Error('Task認証操作が不正です。');return await setSession(event,value);}catch(error){return{ok:false,error:error.message,...session()};}},async handle(event,action,payload){
  try{
   const record=source(event);
   if(action==='state')return{ok:true,views:live().filter(r=>views.has(r.taskView)).map(r=>r.taskView)};
   if(action==='dialog-payload')return record.taskView==='dialog'?{ok:true,payload:copyPayload(record.taskPayload)}:{ok:false,error:'編集画面から取得してください。'};
   if(action==='close-children'){revision++;dialogRevision++;pending.clear();for(const r of live())if(r!==record)r.window.destroy();return{ok:true};}
   if(!token)throw Error('ログイン後にタスク画面を開いてください。');
   if(action==='dialog')return await open('dialog',copyPayload(payload));
   if(action==='open-all'){const result=await Promise.all([...views].map(view=>open(view)));return result.find(r=>!r.ok)||{ok:true};}
   if(action==='open'&&views.has(payload?.view))return await open(payload.view);
   throw Error('Taskの操作が不正です。');
  }catch(error){return{ok:false,error:error.message};}
 }};
}
module.exports={createTaskWindows,taskWindowBounds,copyPayload};
