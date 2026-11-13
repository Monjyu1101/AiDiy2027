// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const path=require('node:path');
const http=require('node:http');
const {randomUUID}=require('node:crypto');
const {createCodeDrag}=require('../../frontend_ide/デスクトップ/code-drag.cjs');
const {createWindowPins}=require('../../frontend_ide/デスクトップ/最前面ピン.cjs');
function メモ一覧を読む(value,scope='normal'){
 const url=new URL(value),token=new URLSearchParams(url.hash.slice(1)).get('token');
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||!token)throw Error('invalid memo URL');
 const endpoint=new URL('api/'+encodeURIComponent('メモ')+(scope==='system'?'/'+encodeURIComponent('単体'):''),url);endpoint.hash='';
 return new Promise((resolve,reject)=>{
  let request,response,done=false,size=0;const chunks=[];
  const finish=(error,data)=>{if(done)return;done=true;clearTimeout(timer);request?.destroy();response?.destroy();error?reject(error):resolve(data);};
  const timer=setTimeout(()=>finish(Error('memo timeout')),5000);
  request=http.get(endpoint,{agent:false,headers:{Authorization:'Bearer '+token}},incoming=>{
   response=incoming;if(incoming.statusCode!==200)return finish(Error('memo unavailable'));
   incoming.on('data',chunk=>{size+=chunk.length;if(size>128*1024*1024)return finish(Error('memo too large'));chunks.push(chunk);});
   incoming.on('error',()=>finish(Error('memo unavailable')));incoming.on('aborted',()=>finish(Error('memo unavailable')));
   incoming.on('end',()=>{try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!Array.isArray(data.保存先)||!Array.isArray(data.メモ))throw Error();finish(null,data);}catch{finish(Error('memo unavailable'));}});
  });request.on('error',()=>finish(Error('memo unavailable')));
 });
}
function 付箋範囲(note,screen,index=0){
 const primary=screen.getPrimaryDisplay().workArea;
 const finite=(value,fallback)=>Number.isFinite(value)?Math.round(value):fallback;
 const candidate={x:finite(note?.位置?.x,primary.x+40+index%8*24),y:finite(note?.位置?.y,primary.y+40+index%8*24),width:Math.max(200,Math.min(1200,finite(note?.サイズ?.width,280))),height:Math.max(84,Math.min(1600,finite(note?.サイズ?.height,230)))};
 const area=screen.getDisplayMatching(candidate)?.workArea||primary;
 candidate.width=Math.min(candidate.width,area.width);candidate.height=Math.min(candidate.height,area.height);
 candidate.x=Math.max(area.x,Math.min(candidate.x,area.x+area.width-candidate.width));candidate.y=Math.max(area.y,Math.min(candidate.y,area.y+area.height-candidate.height));return candidate;
}
// 元の付箋があるモニターの作業領域を使い、画面外・タスクバー上に出さない。
function 追加付箋範囲(origin,screen){
 const area=screen.getDisplayMatching(origin)?.workArea||screen.getPrimaryDisplay().workArea;
 const width=Math.min(280,area.width),height=Math.min(230,area.height),gap=8;
 const fits=b=>b.x>=area.x&&b.y>=area.y&&b.x+width<=area.x+area.width&&b.y+height<=area.y+area.height;
 for(const point of [{x:origin.x+origin.width+gap,y:origin.y},{x:origin.x,y:origin.y+origin.height+gap}]){
  if(fits(point))return {...point,width,height};
 }
 return {x:area.x,y:area.y,width,height};
}
// renderer が保存APIから受け取った成功結果のみを再読込用snapshotに保持する。
// このIPCからファイルへは書かず、保存先・既存IDの変更を認めない。
function 保存済メモは有効(note){
 if(!note||typeof note!=='object'||Array.isArray(note)||Object.keys(note).some(name=>!['id','保存先','タイトル','本文','色','位置','サイズ','形式','revision','画像'].includes(name)))return false;
 if(typeof note.id!=='string'||note.id.length>240||note.id.startsWith('.')||/[\\/\x00-\x1f]/.test(note.id)||! /\.(?:memo\.json|md|txt)$/i.test(note.id))return false;
 if(typeof note.保存先!=='string'||note.保存先.length>128||typeof note.タイトル!=='string'||note.タイトル.length>200||typeof note.本文!=='string'||Buffer.byteLength(note.本文)>1024*1024-4096)return false;
 if(!['yellow','pink','blue','green','purple'].includes(note.色)||!['memo','text'].includes(note.形式)||typeof note.revision!=='string'||! /^[a-f0-9]{64}$/.test(note.revision))return false;
 for(const [name,limits]of [['位置',{x:[-100000,100000],y:[-100000,100000]}],['サイズ',{width:[200,1200],height:[84,1600]}]]){
  const value=note[name];if(value===undefined)continue;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||Object.keys(value).some(key=>!Object.hasOwn(limits,key))||Object.entries(limits).some(([key,[min,max]])=>!Number.isFinite(value[key])||value[key]<min||value[key]>max))return false;
 }
 if(note.画像!==undefined&&(typeof note.画像!=='string'||note.画像.length>7*1024*1024||note.画像&&!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(note.画像)))return false;
 return Buffer.byteLength(JSON.stringify(note))<=9*1024*1024;
}
function メモ窓を作成({BrowserWindow,ipcMain,dialog,screen,url,session,readSnapshot=()=>メモ一覧を読む(url),readSystemSnapshot=()=>メモ一覧を読む(url,'system'),onEmpty=()=>{},isStandalone=()=>false}){
 const target=new URL('memo.html',url);target.hash=url.hash;
 const records=new Map(),pins=createWindowPins();let queue=Promise.resolve(),parentClose,lastWarnings='',busy=0,projectChanging=false,creationBlocked=false;
 const trusted=event=>{const record=records.get(event.sender);return record&&!record.window.isDestroyed()&&event.senderFrame===event.sender.mainFrame?record:null;};
 const drag=createCodeDrag({trustedEvent:trusted,screen});
 const key=(source,id)=>JSON.stringify([String(source).replace(/^(?:launch|project):/,''),id]);
 const send=(record,name,value)=>{if(!record.window.isDestroyed()&&!record.window.webContents.isDestroyed())record.window.webContents.send(name,value);};
 function settle(record,ok){clearTimeout(record.closeTimer);const resolve=record.closeResolve;record.closeResolve=null;record.closePromise=null;record.closeId=null;resolve?.(ok);}
 async function failedClose(record){
  if(record.confirming)return;record.confirming=true;clearTimeout(record.closeTimer);
  try{const answer=await dialog.showMessageBox(record.window,{type:'question',title:'AiDiy Memo',message:'メモを保存できませんでした。変更を破棄して閉じますか？',detail:'戻ると付箋を残したまま、内容の確認や保存の再試行ができます。',buttons:['破棄して閉じる','戻る'],defaultId:1,cancelId:1,noLink:true});if(answer.response===0&&!record.window.isDestroyed()){record.window.destroy();}else settle(record,false);}catch{settle(record,false);}finally{record.confirming=false;}
 }
 function sendBounds(record){clearTimeout(record.boundsTimer);if(!record.window.isDestroyed())send(record,'memo:bounds',record.window.getBounds());}
 function dispatchClose(record){
  if(!record.ready||!record.closeId||record.closeSent)return;
  record.closeSent=true;if(!record.waitOnly)sendBounds(record);send(record,'memo:close-requested',{requestId:record.closeId,waitOnly:record.waitOnly,...(!record.waitOnly?{bounds:record.window.getBounds()}: {})});
 }
 function requestClose(record,waitOnly=false){
  if(record.window.isDestroyed())return Promise.resolve(true);
  if(record.closePromise)return record.closePromise;
  record.closeId=randomUUID();record.closeSent=false;record.waitOnly=waitOnly;
  const result=record.closePromise=new Promise(resolve=>{record.closeResolve=resolve;});
  record.closeTimer=setTimeout(()=>void failedClose(record),15000);record.closeTimer.unref?.();dispatchClose(record);return result;
 }
 ipcMain.handle('diag:memo-window',(event,action,value)=>{
  const record=trusted(event);if(!record)return false;
  if(action==='getInitialState'){record.ready=true;setImmediate(()=>dispatchClose(record));return {...record.initial,bounds:record.window.getBounds()};}
  if(action==='updateSavedNote'){
   if(!保存済メモは有効(value)||value.保存先!==record.initial.sourceId)return false;
   const identity=key(value.保存先,value.id);
   if(record.identity&&record.identity!==identity||[...records.values()].some(other=>other!==record&&other.identity===identity))return false;
   record.identity=identity;record.initial.note=structuredClone(value);return true;
  }
  if(action==='setNoteIdentity'){
   if(!value||typeof value.id!=='string'||value.id.length>240||/[\\/\x00-\x1f]/.test(value.id)||typeof value.sourceId!=='string'||!record.initial.sources.some(source=>source.id===value.sourceId))return false;
   const identity=key(value.sourceId,value.id);if(value.sourceId!==record.initial.sourceId||record.identity&&record.identity!==identity)return false;if([...records.values()].some(other=>other!==record&&other.identity===identity))return false;record.identity=identity;return true;
  }
  if(action==='completeClose'){
   if(!value||value.requestId!==record.closeId||typeof value.ok!=='boolean'||record.confirming)return false;
   if(value.ok)record.window.destroy();else void failedClose(record);return true;
  }
  if(action==='newMemo'){
   if(record.adding)return false;record.adding=true;
   const origin=record.window.getBounds();
   return enqueue(true,isStandalone()?'system':'normal',false,false,origin).finally(()=>{record.adding=false;});
  }
  if(action==='close'){void requestClose(record);return true;}
  if(action==='beginWindowMove')return drag.begin(event);
  if(action==='moveWindow')return typeof value==='string'&&drag.move(event,value);
  if(action==='endWindowMove'){if(typeof value==='string')drag.end(event,value);return false;}
  return false;
 });
 async function create(note,sources,sourceId,scope='normal',focus=false,origin=null){
  const identity=note?key(note.保存先,note.id):null;
  const existing=identity&&[...records.values()].find(record=>record.identity===identity);
  if(existing){if(focus&&!existing.window.isDestroyed()){if(existing.window.isMinimized?.())existing.window.restore();existing.window.show();existing.window.focus();}return true;}
  const bounds=!note&&origin?追加付箋範囲(origin,screen):付箋範囲(note,screen,records.size);
  const palette={yellow:'#fff2a8',pink:'#ffd7e5',blue:'#d1eaff',green:'#d7f3cd',purple:'#e5dbff','vivid-red':'#c62828','vivid-blue':'#1565c0','vivid-green':'#15803d','vivid-orange':'#c2410c','vivid-purple':'#7e22ce','vivid-cyan':'#007f8b'};
  const window=new BrowserWindow({...bounds,minWidth:200,minHeight:84,maxWidth:1200,maxHeight:1600,title:'AiDiy Memo',frame:false,roundedCorners:false,show:false,backgroundColor:palette[note?.色]||palette.yellow,icon:path.join(__dirname,'../static/AiDiy_memo.png'),webPreferences:{session,preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  const contents=window.webContents;
  const record={window,kind:'diag',revision:0,identity,initial:{note,sources,sourceId,bounds,scope}};records.set(window.webContents,record);pins.register(window,{pinned:true,locked:true});window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  for(const name of ['will-navigate','will-redirect','will-attach-webview'])window.webContents.on(name,event=>event.preventDefault());
  window.on('close',event=>{event.preventDefault();void requestClose(record);});
  window.on('blur',()=>{if(window.isDestroyed())return;sendBounds(record);send(record,'memo:blur',{bounds:window.getBounds()});});
  const boundsChanged=()=>{sendBounds(record);};window.on('move',boundsChanged);window.on('resize',boundsChanged);
  window.once('closed',()=>{clearTimeout(record.boundsTimer);records.delete(contents);settle(record,true);if(!records.size&&!busy)onEmpty();});
  try{await window.loadURL(target.href+(scope==='system'?'&scope=system':''));if(!window.isDestroyed())window.show();return true;}catch{if(!window.isDestroyed())window.destroy();return false;}
 }
 async function performOpen(createNew,scope='normal',refresh=false,prepare=false,origin=null){
  try{
   let snapshot=await (scope==='system'?readSystemSnapshot():readSnapshot());
   // システム付箋は選択プロジェクトとは別の寿命を持つ。読み込み失敗時は
   // 既存窓を触らず、保存済みデータを誤って空一覧として扱わない。
   let system=scope==='normal'?await readSystemSnapshot():null;
   if(refresh||prepare){
    if(snapshot.警告?.length||system?.警告?.length)throw Error('incomplete snapshot');
    const persistent=new Set([...(system?.保存先||[]),...snapshot.保存先.filter(source=>source.id.startsWith('launch:'))].map(source=>key(source.id,'')));
    for(const record of [...records.values()]){
     if(record.initial.scope==='system'||persistent.has(key(record.initial.sourceId,'')))continue;
     if(!await requestClose(record,true))return false;
    }
    // close の flush 完了後に取り直す。閉じる前の古い本文を再表示しない。
    if(prepare)return true;
    snapshot=await readSnapshot();
    system=await readSystemSnapshot();
   }
   if(system)for(const note of system.メモ)if(!await create(note,system.保存先,note.保存先,'system'))throw Error('load');
   const warnings=[...(snapshot.警告||[]),...(system?.警告||[])].filter(item=>typeof item==='string').slice(0,5).join('\n').slice(0,2000);
   if(warnings&&warnings!==lastWarnings){lastWarnings=warnings;await dialog.showMessageBox({type:'warning',title:'AiDiy Memo',message:'一部のメモを読み込めませんでした。元のファイルは変更していません。',detail:warnings,buttons:['閉じる']});}
   if(!createNew&&scope==='system'&&!snapshot.メモ.length){
    const blank=[...records.values()].find(record=>record.initial.scope==='system'&&!record.identity);
    if(blank&&!blank.window.isDestroyed()){blank.window.show();blank.window.focus();return true;}
   }
   if(createNew||scope==='system'&&!snapshot.メモ.length){const source=snapshot.保存先.find(item=>item.id.startsWith('project:'))||snapshot.保存先[0];if(!source)throw Error('no source');const shared=system?.保存先.find(item=>key(item.id,'')===key(source.id,''));return await create(null,shared?system.保存先:snapshot.保存先,shared?.id||source.id,shared?'system':scope,false,origin);}
   let ok=true;for(const note of snapshot.メモ)if(!await create(note,snapshot.保存先,note.保存先,scope,scope==='system'))ok=false;
   if(!ok)throw Error('load');return true;
  }catch{try{await dialog.showMessageBox({type:'error',title:'AiDiy Memo',message:'付箋を開けませんでした。Diag の「+メモ」から再試行してください。',buttons:['閉じる']});}catch{}return false;}
 }
 function enqueue(createNew,scope,refresh=false,prepare=false,origin=null){if(parentClose||projectChanging&&!refresh||createNew&&scope==='normal'&&creationBlocked||typeof createNew!=='boolean')return Promise.resolve(false);busy++;const task=queue.then(()=>performOpen(createNew,scope,refresh,prepare,origin)).finally(()=>{busy--;if(!records.size&&!busy)onEmpty();});queue=task.catch(()=>{});return task;}
 async function prepareRefresh(){if(projectChanging)return false;creationBlocked=true;const pending=enqueue(false,'normal',false,true);projectChanging=true;const ok=await pending;if(!ok){projectChanging=false;await enqueue(false,'normal');}return ok;}
 const open=(createNew=false)=>enqueue(createNew,'normal');
 const openSystem=(createNew=false)=>enqueue(createNew,'system');
 function closeForParent(){
  if(parentClose)return parentClose;
  parentClose=(async()=>{await queue;for(const record of [...records.values()])if(!await requestClose(record))return false;return true;})().finally(()=>{parentClose=null;});return parentClose;
 }
 return {open,openSystem,prepareRefresh,refresh:(release=true)=>enqueue(false,'normal',true).then(ok=>{if(ok&&release)creationBlocked=false;return ok;}).finally(()=>{projectChanging=false;}),closeForParent,get count(){return records.size;},get busy(){return busy>0;}};
}
module.exports={メモ窓を作成,メモ一覧を読む,付箋範囲,追加付箋範囲};
