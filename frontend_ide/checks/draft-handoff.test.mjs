// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {appendDraft,createDraftReceiver,DRAFT_LIMITS} from '../src/components/下書き連携/下書き受け渡し.js';
import routerModule from '../デスクトップ/draft-router.cjs';
const {createDraftRouter}=routerModule;
const tick=()=>new Promise(resolve=>setImmediate(resolve));

for(const kind of ['code','live']){
 test(`下書き ${kind}: 本文をそのまま追加し、上限超過・不正値を全体拒否する`,()=>{
  assert.deepEqual(appendDraft('元の\n下書き','追加\n内容',kind),{ok:true,draft:'元の\n下書き\n\n追加\n内容'});
  assert.deepEqual(appendDraft('','a'.repeat(DRAFT_LIMITS[kind]),kind),{ok:true,draft:'a'.repeat(DRAFT_LIMITS[kind])});
  for(const [current,text] of [['前','a'.repeat(DRAFT_LIMITS[kind])],['','a'.repeat(DRAFT_LIMITS[kind]+1)],['',null],['','\0'],['','   '],[null,'本文']])assert.equal(appendDraft(current,text,kind).ok,false);
 });
}

function receiverFixture(){
 let path='/project',scope='conversation-1',ready=true,value='元の下書き',focusCount=0,clock=1000,next=0,listener,removed=false;
 const registrations=[];
 const receiver=createDraftReceiver({kind:'code',project:()=>path,scope:()=>scope,ready:()=>ready,draft:()=>value,setDraft:text=>{value=text;},focus:()=>focusCount++,now:()=>clock,uuid:()=>`context-${++next}`,
  api:{registerDraftTarget:async value=>{registrations.push(value);},onDraftHandoff:callback=>{listener=callback;return()=>{removed=true;};}}});
 return{receiver,registrations,listener:()=>listener,removed:()=>removed,value:()=>value,focusCount:()=>focusCount,path:v=>{path=v;},scope:v=>{scope=v;},ready:v=>{ready=v;},clock:v=>{clock=v;}};
}

test('受信: 初期化・破棄・会話変更・プロジェクト変更・準備待ちを照合する',()=>{
 const f=receiverFixture(),r=f.receiver;
 assert.equal(r.target(),null);r.mount();const first=r.target();
 const payload={...first,text:'ファイル: test.txt'};
 assert.equal(r.insert(payload).ok,true);assert.equal(f.value(),'元の下書き\n\nファイル: test.txt');assert.equal(f.focusCount(),1);
 f.scope('conversation-2');assert.equal(r.insert(payload).ok,false);const second=r.target();assert.notEqual(second.contextId,first.contextId);
 f.path('/another');assert.equal(r.insert({...second,text:'不可'}).ok,false);
 f.ready(false);r.publish();assert.equal(r.target(),null);assert.equal(f.registrations.at(-1),null);
 f.ready(true);assert.notEqual(r.target().contextId,second.contextId);
 r.dispose();assert.equal(f.removed(),true);assert.equal(r.target(),null);assert.equal(r.insert({...r.target(),text:'不可'}).ok,false);
 assert.equal(f.registrations.at(-1),null);
});

test('受信: 期限切れを拒否し、同じIPCの再配送は重複追記しない',()=>{
 const f=receiverFixture(),r=f.receiver;r.mount();const target=r.target();
 const data={...target,text:'選択本文',requestId:'request-1',expiresAt:2000};
 assert.equal(f.listener()(data).ok,true);assert.equal(f.listener()(data).ok,true);assert.equal(f.value(),'元の下書き\n\n選択本文');assert.equal(f.focusCount(),1);
 f.clock(2001);assert.equal(r.insert({...data,requestId:'request-2'}).ok,false);
 assert.equal(r.insert({...data,expiresAt:Infinity}).ok,false);
 assert.equal(r.insert({...data,requestId:'x'.repeat(129),expiresAt:3000}).ok,false);
});

function routerFixture(){
 const records=new Map(),delivered=[],focused=[],timers=new Map();let count=0,readHook,quitting=false;
 const state={active:true,mode:'online',startedAt:10,project:{path:'/project'}};
 const sessionKey=s=>s.active?`${s.mode}:${s.startedAt}`:'';
 function add(kind,owner,linkKey=sessionKey(state)){
  const window={destroyed:false,isDestroyed(){return this.destroyed;},webContents:{send(channel,data){delivered.push({record,channel,data});}}};
  const record={kind,window,owner,linkKey,revision:0,slot:[...records.values()].filter(item=>item.kind===kind).length};records.set(window.webContents,record);return record;
 }
 const owner=add('ide'),viewer=add('viewer',owner),code1=add('code',owner),code2=add('code',owner),live=add('live',owner);
 const router=createDraftRouter({records,readState:async()=>{await readHook?.();return structuredClone(state);},sessionKey,focusWindow:window=>focused.push(window),isQuitting:()=>quitting,
  uuid:()=>`uuid-${++count}`,now:()=>1000,setTimer:callback=>{timers.set(++count,callback);return count;},clearTimer:id=>timers.delete(id)});
 for(const item of [code1,code2,live])router.register(item,{kind:item.kind,contextId:`context-${item.slot}-${item.kind}`,projectPath:'/project',label:'会話の題名'});
 const payload=target=>({targetId:target.draftId,contextId:target.draftTarget.contextId,sessionKey:sessionKey(state),projectPath:state.project.path,text:'ファイル: a.txt\n\n選択本文'});
 return{records,state,owner,viewer,code1,code2,live,router,delivered,focused,timers,add,payload,readHook:callback=>{readHook=callback;},quit:()=>{quitting=true;}};
}

test('Electron一覧: 所有IDEの稼働中Code複数・Liveだけを列挙し、他プロジェクト・未登録・古いセッションを除外する',async()=>{
 const f=routerFixture(),other=f.add('ide'),foreign=f.add('code',other);
 f.router.register(foreign,{kind:'code',contextId:'foreign',projectPath:'/project',label:'他のIDE'});
 f.add('code',f.owner);
 const stale=f.add('code',f.owner,'offline:9');f.router.register(stale,{kind:'code',contextId:'stale',projectPath:'/project',label:'古い'});
 const wrong=f.add('code',f.owner);f.router.register(wrong,{kind:'code',contextId:'wrong',projectPath:'/other',label:'別プロジェクト'});
 const result=await f.router.list(f.viewer);
 assert.equal(result.ok,true);assert.deepEqual(result.targets.map(x=>x.id),[f.code1.draftId,f.code2.draftId,f.live.draftId]);
 assert.match(result.targets[0].label,/Code 1/);assert.match(result.targets[1].label,/Code 2/);
 assert.equal((await f.router.list(f.code1)).ok,false);assert.equal((await f.router.list(null)).ok,false);
 f.viewer.linkKey='offline:9';assert.equal((await f.router.list(f.viewer)).ok,false);
 f.state.active=false;assert.equal((await f.router.list(f.owner)).ok,false);
});

test('Electron追加: 選んだ正確なCodeへ一回だけ配送し、対象本人の成功ACK後にだけ前面へ出す',async()=>{
 const f=routerFixture();const waiting=f.router.insert(f.viewer,f.payload(f.code2));await tick();
 assert.equal(f.delivered.length,1);assert.equal(f.delivered[0].record,f.code2);assert.equal(f.delivered[0].channel,'development:draft-handoff');assert.equal(f.focused.length,0);
 const {requestId}=f.delivered[0].data;
 f.router.acknowledge(f.code1,{requestId,ok:true});assert.equal(f.timers.size,1);
 f.router.acknowledge(f.code2,{requestId,ok:true});assert.deepEqual(await waiting,{ok:true});assert.deepEqual(f.focused,[f.code2.window]);assert.equal(f.timers.size,0);
 assert.equal(f.delivered[0].data.expiresAt,5000);
});

test('Electron追加: 閉じたIDを代替窓へ送らず、会話変更・別ID・別セッション・別パスを拒否する',async()=>{
 const f=routerFixture(),data=f.payload(f.code1);
 for(const patch of [{targetId:'missing'},{contextId:'old'},{sessionKey:'offline:9'},{projectPath:'/other'},{text:'x'.repeat(200001)}])assert.equal((await f.router.insert(f.owner,{...data,...patch})).ok,false);
 f.code1.window.destroyed=true;assert.equal((await f.router.insert(f.owner,data)).ok,false);
 assert.equal(f.delivered.length,0);assert.equal(f.focused.length,0);
});

test('Electron追加: 非同期状態取得中の終了・所有変更・プロジェクト変更を再照合する',async()=>{
 for(const change of [f=>f.owner.revision++,f=>{f.owner.window.destroyed=true;},f=>{f.state.project.path='/changed';},f=>{f.viewer.owner=f.add('ide');},f=>f.quit()]){
  const f=routerFixture(),data=f.payload(f.code1);f.readHook(()=>change(f));
  assert.equal((await f.router.insert(f.viewer,data)).ok,false);assert.equal(f.delivered.length,0);
 }
});

test('Electron追加: ACK前の終了・会話変更・受信拒否とタイムアウトは成功にせず、連打を配送しない',async()=>{
 for(const ending of ['close','context','reject','timeout']){
  const f=routerFixture(),waiting=f.router.insert(f.owner,f.payload(f.code1));await tick();
  assert.equal((await f.router.insert(f.owner,f.payload(f.code2))).ok,false);assert.equal(f.delivered.length,1);
  const {requestId}=f.delivered[0].data;
  if(ending==='close')f.router.invalidate(f.code1);
  if(ending==='context'){f.code1.draftTarget.contextId='new';f.router.acknowledge(f.code1,{requestId,ok:true});}
  if(ending==='reject')f.router.acknowledge(f.code1,{requestId,ok:false,error:'既存の下書きが長すぎます。'});
  if(ending==='timeout')[...f.timers.values()][0]();
  assert.equal((await waiting).ok,false);assert.equal(f.focused.length,0);assert.equal(f.timers.size,0);
  f.router.acknowledge(f.code1,{requestId,ok:true});assert.equal(f.focused.length,0);
 }
});

test('Electron登録: 対象の種類・文字列上限を照合し、解除時は一覧から外す',async()=>{
 const f=routerFixture();
 for(const record of [f.owner,f.viewer,null])assert.equal(f.router.register(record,{kind:'code',contextId:'x',projectPath:'/project',label:''}).ok,false);
 for(const patch of [{kind:'live'},{contextId:'x'.repeat(129)},{projectPath:'x'.repeat(4097)},{label:'x'.repeat(201)}])assert.equal(f.router.register(f.code1,{kind:'code',contextId:'x',projectPath:'/project',label:'',...patch}).ok,false);
 f.router.register(f.code1,null);assert.equal((await f.router.list(f.owner)).targets.length,2);
});

test('preload: IPC eventを公開せず、限定された受信と結果ACKだけをつなぎ解除できる',()=>{
 let api;const listeners=new Map(),sent=[];
 const ipcRenderer={invoke:(...args)=>Promise.resolve(args),on:(name,callback)=>listeners.set(name,callback),send:(...args)=>sent.push(args),removeListener:(name,callback)=>{if(listeners.get(name)===callback)listeners.delete(name);}};
 vm.runInNewContext(readFileSync(new URL('../デスクトップ/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld(name,value){assert.equal(name,'aidiyWindow');api=value;}},ipcRenderer})});
 let payload;const stop=api.onDraftHandoff(data=>{payload=data;return{ok:true};});
 const event={private:'not exposed'},data={requestId:'one',text:'本文'};listeners.get('development:draft-handoff')(event,data);
 assert.equal(payload,data);assert.equal(sent[0][0],'development:draft-result');assert.equal(sent[0][1].ok,true);assert.equal(sent[0][1].requestId,'one');
 stop();assert.equal(listeners.size,0);
 assert.equal(Object.hasOwn(api,'send'),false);assert.equal(Object.hasOwn(api,'invoke'),false);
});

test('最前面: 作成順・登録更新ではなく対象窓のfocus順で選び、IDEとビューアは除外する',async()=>{
 const f=routerFixture();
 assert.equal((await f.router.list(f.owner)).frontmostTargetId,'');
 f.router.focused(f.live);f.router.focused(f.code1);f.router.focused(f.viewer);f.router.focused(f.owner);
 f.router.register(f.code2,{kind:'code',contextId:'updated',projectPath:'/project',label:'更新'});
 const result=await f.router.list(f.viewer);
 assert.equal(result.frontmostTargetId,f.code1.draftId);
 assert.deepEqual(result.targets.map(item=>item.id),[f.code1.draftId,f.code2.draftId,f.live.draftId]);
 f.router.focused(f.code2);assert.equal((await f.router.list(f.owner)).frontmostTargetId,f.code2.draftId);
 f.code2.window.isMinimized=()=>true;assert.equal((await f.router.list(f.owner)).frontmostTargetId,f.code1.draftId);
 f.code2.window.isMinimized=()=>false;f.code2.window.isVisible=()=>false;assert.equal((await f.router.list(f.owner)).frontmostTargetId,f.code1.draftId);
 assert.equal(f.delivered.length,0);assert.equal(f.focused.length,0);
});

test('最前面: 閉鎖・未登録・古いセッション・別IDE・別プロジェクト・offline Liveを除外する',async()=>{
 const f=routerFixture();f.router.focused(f.code1);f.router.focused(f.code2);f.code2.window.destroyed=true;
 assert.equal((await f.router.list(f.owner)).frontmostTargetId,f.code1.draftId);
 for(const [kind,owner,key,path] of [['code',f.owner,'old','/project'],['code',f.add('ide'),'online:10','/project'],['code',f.owner,'online:10','/other']]){
  const record=f.add(kind,owner,key);f.router.register(record,{kind,contextId:'excluded',projectPath:path,label:''});f.router.focused(record);
  assert.equal((await f.router.list(f.owner)).frontmostTargetId,f.code1.draftId);
 }
 const unready=f.add('code',f.owner);f.router.focused(unready);
 assert.equal((await f.router.list(f.owner)).frontmostTargetId,f.code1.draftId);
 f.router.focused(f.live);f.state.mode='offline';f.code1.linkKey='offline:10';f.live.linkKey='offline:10';
 assert.equal((await f.router.list(f.owner)).frontmostTargetId,f.code1.draftId);
 f.router.invalidate(f.code1);assert.equal((await f.router.list(f.owner)).frontmostTargetId,'');
});

test('最前面: 新規窓の登録前focusを保持し、非同期一覧取得中の最新focusと閉鎖を反映する',async()=>{
 const f=routerFixture();f.router.focused(f.code1);
 const newlyOpened=f.add('code',f.owner);f.router.focused(newlyOpened);
 f.router.register(newlyOpened,{kind:'code',contextId:'new',projectPath:'/project',label:'新規'});
 assert.equal((await f.router.list(f.owner)).frontmostTargetId,newlyOpened.draftId);
 f.readHook(()=>{newlyOpened.window.destroyed=true;f.router.focused(f.live);});
 assert.equal((await f.router.list(f.owner)).frontmostTargetId,f.live.draftId);
 assert.equal(f.delivered.length,0);
});

test('Electron配線: 各窓のfocusを信頼済みホストで記録する',()=>{
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 assert.match(source,/window\.on\('focus',\(\)=>\{\s*draftRouter\.focused\(record\);/);
 const preload=readFileSync(new URL('../デスクトップ/preload.cjs',import.meta.url),'utf8');
 assert.doesNotMatch(preload,/draftRouter\.focused|frontmostTargetId/);
});
