// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import vm from 'node:vm';
import sessionModule from '../デスクトップ/desktop-session.cjs';
import taskModule from '../デスクトップ/task-windows.cjs';
import appProcesses from '../../scripts/アプリプロセス.cjs';
const {validateDevelopmentState,readDevelopmentState}=sessionModule;
const valid={active:true,mode:'online',startedAt:10,project:{path:'/fixture'}};

test('IDE終了確認: 連携ピンの前に表示し、取消・失敗でも元のロックを復元する',async()=>{
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('const previousPin=windowPins.state(window);'),source.indexOf('if(response===0&&!window.isDestroyed())'));
 for(const locked of [false,true])for(const outcome of ['cancel','close','error']){
  const calls=[],window={isDestroyed:()=>false,moveTop:()=>calls.push('raise')};
  const context={window,windowPins:{state:()=>({locked}),setLocked:(_w,value)=>calls.push(value)},dialog:{showMessageBox:async()=>{assert.deepEqual(calls,[true,'raise']);if(outcome==='error')throw Error('fixture');return{response:outcome==='close'?0:1};}}};
  const result=vm.runInNewContext('(async()=>{'+body+'return response;})()',context);
  if(outcome==='error')await assert.rejects(result,/fixture/);else assert.equal(await result,outcome==='close'?0:1);
  assert.deepEqual(calls,[true,'raise',locked]);
 }
});

test('Electron状態: 正常な利用中・終了だけを受理し、不正応答を終了と取り違えない',()=>{
 assert.equal(validateDevelopmentState(valid),valid);assert.deepEqual(validateDevelopmentState({active:false}),{active:false});
 for(const value of [null,{},[],{active:0},{active:'false'},...['mode','startedAt','project'].map(key=>({...valid,[key]:undefined})),{...valid,mode:'bad'},{...valid,startedAt:Infinity},{...valid,project:{path:'x'.repeat(4097)}}])assert.throws(()=>validateDevelopmentState(value));
});

test('Electron状態: fetch失敗・HTTPエラー・JSON不正・未検証応答は呼び出し元へ返す',async()=>{
 const record={url:'http://127.0.0.1:1/'};
 for(const request of [async()=>{throw Error('offline');},async()=>({ok:false}),async()=>({ok:true,json:async()=>{throw Error('bad json');}}),async()=>({ok:true,json:async()=>({})})])await assert.rejects(readDevelopmentState(record,request));
 let options;assert.deepEqual(await readDevelopmentState(record,async(url,value)=>{assert.equal(url.href,'http://127.0.0.1:1/api/connection');options=value;return{ok:true,json:async()=>valid};}),valid);
 assert.equal(options.cache,'no-store');assert.ok(options.signal);
});

test('Electron子窓監視: 通信断・不明は保持し、確定終了とセッション変更だけ閉じる',async()=>{
 // desktop.cjsの実関数を取り出し、Electron資源だけ置き換えて監視分岐を検証する。
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function checkChildren(owner){'),source.indexOf('function trustedEvent(event){'));
 const owner={window:{isDestroyed:()=>false}},child={owner,linkKey:'online:10'},windows=new Map([['child',child]]);
 let result=valid,error,closed=0;
 const context={avatarLauncher:{active:()=>false},browserViews:null,windows,readState:async()=>{if(error)throw error;return validateDevelopmentState(result);},sessionKey:state=>state.active?`${state.mode}:${state.startedAt}`:'',closeChildren:()=>closed++};
 vm.runInNewContext(body+';globalThis.check=checkChildren;',context);
 error=Error('temporary');await context.check(owner);assert.equal(closed,0);assert.equal(owner.checking,false);
 error=null;result={};await context.check(owner);assert.equal(closed,0);
 result=valid;await context.check(owner);assert.equal(closed,0);
 result={active:false};await context.check(owner);assert.equal(closed,1);
 result={...valid,startedAt:11};await context.check(owner);assert.equal(closed,2);
 assert.match(source,/readState\(record\)\.then\(state=>state\.active,\(\)=>true\)/,'終了確認では状態不明を作業中として扱う');
});

test('Electron子窓監視: 取得待ち中に利用を終了し直したら古い結果を無視する',async()=>{
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function checkChildren(owner){'),source.indexOf('function trustedEvent(event){'));
 const owner={window:{isDestroyed:()=>false},revision:1},windows=new Map([['child',{owner,linkKey:'online:10'}]]);let resolve,closed=0;
 const context={avatarLauncher:{active:()=>false},browserViews:null,windows,readState:()=>new Promise(done=>{resolve=done;}),sessionKey:()=>'',closeChildren:()=>closed++};vm.runInNewContext(body+';globalThis.check=checkChildren;',context);
 const waiting=context.check(owner);owner.revision++;resolve({active:false});await waiting;
 assert.equal(closed,0);assert.equal(owner.checking,false);
});

test('Electron IPC: 同じメインフレーム・正確なURLだけを信用し、iframe・他URL・閉じた窓を拒否する',()=>{
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function trustedEvent(event){'),source.indexOf('function audioAllowed('));
 const frame={url:'http://127.0.0.1:111/#viewer=readme.md'},sender={mainFrame:frame},record={url:'http://127.0.0.1:111/',window:{isDestroyed:()=>false}};
 const context={windows:new Map([[sender,record]])};vm.runInNewContext(body+';globalThis.trust=trustedEvent;',context);
 assert.equal(context.trust({sender,senderFrame:frame}),record);
 assert.equal(context.trust({sender,senderFrame:{url:frame.url}}),null);
 frame.url='http://127.0.0.1:222/';assert.equal(context.trust({sender,senderFrame:frame}),null);
 assert.equal(context.trust({sender,senderFrame:null}),null);
 frame.url=record.url;record.window.isDestroyed=()=>true;assert.equal(context.trust({sender,senderFrame:frame}),null);
});

function launchFixture(running=new Set(),occupied=new Set()){
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf(' async function openApp(event,type,displayId){'),source.indexOf(" const {createLayoutManager}=require('./デスクトップ/配置保存.cjs');"))
  .replace("const {startDevelopment}=await import('./server.mjs');","const {startDevelopment}=testServer;");
 const windows=new Map(),state={...valid,project:{...valid.project}},starts=[],created=[],focused=[],closed=[];let launch,hold;
 const owner={kind:'ide',window:{isDestroyed:()=>false},revision:0,pending:new Map()},viewer={kind:'viewer',owner,linkKey:'online:10',window:{isDestroyed:()=>false}};
 const avatar={active:false,calls:[],open:async(record,path)=>{avatar.active=true;avatar.calls.push(path);await hold;return{ok:true};}};
 const context={avatarLauncher:{active:()=>avatar.active,open:avatar.open},voiceActive:record=>avatar.active||record.pending.has('live')||[...windows.values()].some(child=>child.owner===record&&child.kind==='live'),createTaskWindows:taskModule.createTaskWindows,selectedAllDisplay:()=>null,ipcMain:{handle:(_name,handler)=>{launch=handler;}},windows,quitting:false,trustedEvent:event=>event.record,
  __dirname:'/fixture',単一起動部品:appProcesses.単一起動部品,単独起動中の部品:async()=>running,起動枠を確保:async type=>occupied.has(type)?null:()=>{},
  readState:async()=>structuredClone(state),sessionKey:value=>value.active?`${value.mode}:${value.startedAt}`:'',
  focusWindow:window=>focused.push(window),closeServer:server=>{if(server)closed.push(server);},
  testServer:{startDevelopment:async(path,options)=>{starts.push({path,options});await hold;return{url:'http://127.0.0.1:1234/'};}},
  createWindow:async(...args)=>{created.push(args);const window={isDestroyed:()=>false,once(){}};windows.set(window,{window,kind:args[0],owner:args[3],linkKey:args[4],taskView:args[8]?.view,taskController:args[8]?.controller});return window;}};
 vm.runInNewContext(body,context);
 return{launch,state,owner,viewer,windows,starts,created,focused,closed,avatar,hold:promise=>{hold=promise;}};
}

test('Electron明示起動: 同じセッションのピン留めからだけCode/Live/Consoleを開ける',async()=>{
 for(const kind of ['code','live','console']){
  const f=launchFixture();assert.equal((await f.launch({record:f.viewer},kind)).ok,true);assert.equal(f.starts.length,1);
  assert.equal(f.starts[0].path,'/fixture');assert.equal(f.starts[0].options.kind,kind);assert.equal(f.created[0][3],f.owner);assert.equal(f.created[0][4],'online:10');
 }
 for(const change of [f=>{f.viewer.linkKey='online:9';},f=>{f.viewer.window.isDestroyed=()=>true;},f=>{f.state.active=false;},f=>{f.viewer.kind='code';}]){
  const f=launchFixture();change(f);assert.equal((await f.launch({record:f.viewer},'code')).ok,false);assert.equal(f.starts.length,0);
 }
 const f=launchFixture();f.state.mode='offline';f.viewer.linkKey='offline:10';assert.equal((await f.launch({record:f.viewer},'live')).ok,false);assert.equal(f.starts.length,0);
});

test('Electron明示起動: Live連打は同じ起動を待ち、終了後の遅延起動は破棄する',async()=>{
 let release;const f=launchFixture();f.hold(new Promise(resolve=>{release=resolve;}));
 const one=f.launch({record:f.viewer},'live'),two=f.launch({record:f.owner},'live');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.starts.length,1);release();assert.equal((await one).ok,true);assert.equal((await two).ok,true);assert.equal(f.created.length,1);
 const g=launchFixture();g.hold(new Promise(resolve=>{release=resolve;}));const late=g.launch({record:g.viewer},'code');await new Promise(resolve=>setImmediate(resolve));
 g.owner.revision++;release();assert.equal((await late).ok,false);assert.equal(g.created.length,0);assert.equal(g.closed.length,1);
});

test('IDE TASK/TEAM: concurrent launch reuses owner session, fixed project and primary-only Task',async()=>{
 for(const kind of ['task','team']){
  let release;const f=launchFixture();f.hold(new Promise(resolve=>release=resolve));
  const a=f.launch({record:f.owner},kind),b=f.launch({record:f.owner},kind);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.starts.length,1);release();
  assert.equal((await a).ok,true);assert.equal((await b).ok,true);
  assert.equal(f.starts[0].options.projectFixed,true);assert.equal(f.created.length,1);
  assert.equal(f.created[0][3],f.owner);
  if(kind==='task')assert.equal(f.created[0][8].view,'request');
  assert.equal((await f.launch({record:f.owner},kind)).reused,true);
  assert.equal(f.created.length,1);assert.equal(f.focused.length,1);
 }
});

test('Task / Team / CPUの単独版または別プロセスの起動枠がある場合はIDEから追加起動しない',async()=>{
 const ids=new Set(appProcesses.単一起動部品);
 for(const f of [launchFixture(ids),launchFixture(new Set(),ids)]){
  for(const kind of ids){
   const result=await f.launch({record:f.owner},kind);
   assert.equal(result.ok,true);assert.equal(result.alreadyRunning,true);
  }
  assert.equal(f.starts.length,0);assert.equal(f.created.length,0);
 }
});

test('単独版の判定は配置元のElectron起動入口と対象アプリを照合する',async()=>{
 const root=resolve('test fixture [AiDiy]','frontend_ide'),entry=join(root,'desktop.cjs');
 const rows=[
  {command:`electron "${entry}" --app task`},
  {command:`electron "${entry}" --app=cpu`},
  {command:`electron "${entry}" --app ide`},
  {command:`electron "${entry}.old" --app team`},
  {command:`node --test "${entry}" --app team`},
 ];
 assert.deepEqual(await appProcesses.単独起動中の部品(root,async()=>rows),new Set(['task','cpu']));
});


test('IDE Avatar: プロジェクトを渡し、Liveとの同時起動・別窓からの連打を拒否する',async()=>{
 for(const first of ['live','avatar']){
  let release;const f=launchFixture();f.hold(new Promise(resolve=>release=resolve));
  const opening=f.launch({record:f.owner},first);await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.launch({record:f.viewer},first==='live'?'avatar':'live')).ok,false);
  if(first==='avatar')assert.equal((await f.launch({record:f.owner},'avatar')).ok,false);
  release();assert.equal((await opening).ok,true);
  assert.equal((await f.launch({record:f.owner},first==='live'?'avatar':'live')).ok,false);
  if(first==='avatar'){assert.deepEqual(f.avatar.calls,['/fixture']);assert.equal(f.starts.length,0);f.avatar.active=false;assert.equal((await f.launch({record:f.owner},'live')).ok,true);}
 }
});

test('IDE Avatar: offline / 未開始 / 信頼できない画面からは起動しない',async()=>{
 for(const change of [f=>{f.state.mode='offline';},f=>{f.state.active=false;},f=>{f.owner.kind='code';},f=>{f.owner.window.isDestroyed=()=>true;}]){
  const f=launchFixture();change(f);assert.equal((await f.launch({record:f.owner},'avatar')).ok,false);assert.deepEqual(f.avatar.calls,[]);
 }
});

test('AvatarだけのIDE子監視: 一時障害は保持し、セッション切替と終了で閉じる',async()=>{
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function checkChildren(owner){'),source.indexOf('function trustedEvent(event){'));
 const owner={window:{isDestroyed:()=>false},avatarKey:'online:10'};let state=valid,closed=0,error;
 const context={avatarLauncher:{active:()=>true},browserViews:null,windows:new Map(),readState:async()=>{if(error)throw error;return state;},sessionKey:state=>state.active?`${state.mode}:${state.startedAt}`:'',closeChildren:()=>closed++};
 vm.runInNewContext(body+';globalThis.check=checkChildren;',context);
 await context.check(owner);assert.equal(closed,0);error=Error('temporary');await context.check(owner);assert.equal(closed,0);
 error=null;state={...valid,startedAt:11};await context.check(owner);assert.equal(closed,1);
 state={active:false};await context.check(owner);assert.equal(closed,2);
});
