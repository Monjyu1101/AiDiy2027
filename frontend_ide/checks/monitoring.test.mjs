// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { startTerminal } from '../aidiy_console/terminal.mjs';
import { createSpace, ORBIT_PATH_SCALE } from '../src/components/開発スペース/宇宙描画.js';
import { validConnectionState } from '../src/components/共通表示/接続状態.js';
import { createDraftTargetRegistry } from '../src/components/下書き連携/連携先登録.js';
import { createTextWidthCache } from '../src/components/開発スペース/文字幅キャッシュ.js';
import { installWindowMove } from '../src/components/共通表示/長押し窓移動.js';
const require=createRequire(import.meta.url);
const vue=require('vue'),{parse,compileScript}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};

function component(name,{props={},windowAPI,hash='',fetcher=async()=>({ok:true,json:async()=>({active:true})})}={}){
  const {descriptor}=parse(readFileSync(new URL(`../src/${name}.vue`,import.meta.url),'utf8'));
  const script=compileScript(descriptor,{id:name,genDefaultAs:'component'});
  const {code}=transformSync(`${script.content}\nmodule.exports=component;`,{format:'cjs'});
  const mounted=[],unmounted=[],moveInstalls=[],timers=new Map(),document=new EventTarget(),window=new EventTarget();
  document.hidden=false;window.document=document;if(windowAPI)window.aidiyWindow=windowAPI;let id=0;
  const module={exports:{}};
  vm.runInNewContext(code,{
    module,document,window,fetch:fetcher,AbortSignal,AbortController,Date,location:{hash},
    setInterval:(callback,ms)=>{timers.set(++id,{callback,ms});return id;},clearInterval:key=>timers.delete(key),
    require:id=>id==='vue'?{...vue,provide(){},onMounted:callback=>mounted.push(callback),onBeforeUnmount:callback=>unmounted.push(callback)}:id.endsWith('/接続状態.js')?{validConnectionState}:id==='./components/下書き連携/連携先登録.js'?{createDraftTargetRegistry}:id==='./components/共通表示/長押し窓移動.js'?{installWindowMove:options=>{moveInstalls.push(options);return installWindowMove({...options,win:window});}}:{},
  });
  const reactive=vue.reactive(props),scope=vue.effectScope();
  const state=scope.run(()=>module.exports.setup(reactive,{expose(){}}));
  return {state,timers,document,moveInstalls,props:reactive,async mount(){for(const callback of mounted)await callback();},dispose(){for(const callback of unmounted)callback();scope.stop();}};
}

test('独立ビューアのhash起動もIDE本体と区別して共通の窓移動へ接続する',async()=>{
 const f=component('App',{props:{config:{kind:'ide'}},hash:'#viewer=sample.txt',fetcher:async()=>{throw Error('独立ビューアはIDEの監視を起動しない');}});
 try{await f.mount();assert.equal(f.moveInstalls[0].kind,'viewer');assert.equal(f.timers.size,0);}finally{f.dispose();}
});

test('VR移行: ピン留め完了まで巨大化せず、失敗時は元の窓を維持する',async()=>{
 const calls=[];let release;
 const f=component('App',{props:{config:{kind:'ide'}},windowAPI:{allDisplays:async action=>{calls.push(action);return{ok:true,active:true};}}});
 try{
  f.state.state.value={active:true};
  f.state.spaceView.value={prepareAll:()=>new Promise(resolve=>{release=resolve;})};
  const pending=f.state.toggleAllDisplays();await flush();
  assert.equal(f.state.allBusy.value,true);assert.match(f.state.allMessage.value,/VR空間へ移行中/);assert.deepEqual(calls,[]);
  await f.state.toggleAllDisplays();assert.deepEqual(calls,[]);
  release();await pending;assert.deepEqual(calls,['toggle']);assert.equal(f.state.allBusy.value,false);
  f.state.allDisplayState.value={active:false};calls.length=0;
  f.state.spaceView.value={prepareAll:async()=>{throw Error('ピン留め失敗');}};
  await f.state.toggleAllDisplays();assert.deepEqual(calls,[]);assert.equal(f.state.allBusy.value,false);assert.match(f.state.error.value,/ピン留め失敗/);
 }finally{f.dispose();}
});

test('IDE: 初回即時・以後10秒の状態取得、手動開始は待たず、破棄中の初回応答でタイマーを残さない',async()=>{
  const calls=[];
  const fixture=component('App',{props:{config:{kind:'ide'}},fetcher:async(url)=>{calls.push(url);return{ok:true,json:async()=>({active:true,startedAt:1,mode:'online',project:{path:'/fixture'}})};}});
  try{
    await fixture.mount();assert.deepEqual(calls,['/api/connection']);
    assert.deepEqual([...fixture.timers.values()].map(timer=>timer.ms),[10000]);
    await fixture.state.start('connect');assert.equal(calls.at(-1),'/api/connection/connect');
  }finally{fixture.dispose();}
  assert.equal(fixture.timers.size,0);
  let release;
  const delayed=component('App',{props:{config:{kind:'ide'}},fetcher:()=>new Promise(resolve=>{release=resolve;})});
  const mounting=delayed.mount();delayed.dispose();release({ok:true,json:async()=>({active:true})});await mounting;
  assert.equal(delayed.timers.size,0);
});

test('ピン留めビューア: 10秒間隔、遅い応答を重ねず、閉じた後の応答を捨てる',async()=>{
  let release,calls=0,signal;
  const fixture=component('components/ファイル閲覧/閲覧ウィンドウ',{props:{path:'file.txt'},fetcher:(_url,options)=>{calls++;signal=options.signal;return new Promise(resolve=>{release=resolve;});}});
  await fixture.mount();const [timer]=fixture.timers.values();assert.equal(timer.ms,10000);assert.equal(calls,1);
  await timer.callback();assert.equal(calls,1);
  release({ok:true,json:async()=>({active:true,connected:true,mode:'online',startedAt:1,project:{path:'/fixture'}})});await flush();assert.equal(fixture.state.state.value.active,true);
  const pending=timer.callback();assert.equal(calls,2);fixture.dispose();assert.equal(signal.aborted,true);
  release({ok:true,json:async()=>({active:false})});await pending;assert.equal(fixture.state.state.value.active,true);
  assert.equal(fixture.timers.size,0);
});

test('Console: toolsの初回確認は即時、既定10秒、遅い確認は重複せず終了で止まる',async t=>{
  t.mock.timers.enable({apis:['setInterval']});let calls=0,release;
  const app=await startTerminal(tmpdir(),{spawnTerminal(){throw Error('PTYを起動しない');},checkTools:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
  try{
    assert.equal(calls,1);release(true);await flush();
    t.mock.timers.tick(9999);assert.equal(calls,1);t.mock.timers.tick(1);assert.equal(calls,2);
    t.mock.timers.tick(10000);assert.equal(calls,2);release(true);await flush();
    t.mock.timers.tick(10000);assert.equal(calls,3);
  }finally{await app.close();release?.(true);await flush();}
  t.mock.timers.tick(30000);assert.equal(calls,3);
});

test('接続バー: 未接続・非表示は20Hzタイマー0個、表示復帰は時刻同期して1個だけ再開',async()=>{
  const fixture=component('components/共通表示/状態バー',{props:{clockPulse:true,connected:false,mode:'online'}});
  await fixture.mount();assert.equal(fixture.timers.size,0);
  fixture.props.connected=true;await vue.nextTick();assert.equal(fixture.timers.size,1);assert.equal([...fixture.timers.values()][0].ms,50);
  fixture.document.hidden=true;fixture.document.dispatchEvent(new Event('visibilitychange'));assert.equal(fixture.timers.size,0);
  fixture.document.hidden=false;fixture.document.dispatchEvent(new Event('visibilitychange'));assert.equal(fixture.timers.size,1);
  fixture.document.dispatchEvent(new Event('visibilitychange'));assert.equal(fixture.timers.size,1);
  fixture.props.connected=false;await vue.nextTick();assert.equal(fixture.timers.size,0);
  fixture.props.mode='offline';await vue.nextTick();assert.equal(fixture.timers.size,1);
  fixture.dispose();assert.equal(fixture.timers.size,0);
  fixture.document.dispatchEvent(new Event('visibilitychange'));assert.equal(fixture.timers.size,0);
});

test('Canvas文字幅: 同一ラベル600フレームを1回の計測にまとめ、フォント変更・明示無効化で再計測',t=>{
  let calls=0;const context={font:'12px sans-serif',measureText:text=>{calls++;return{width:text.length*6};}};
  const cache=createTextWidthCache(context);
  for(let n=0;n<600;n++)assert.equal(cache.measure('日本語.txt'),42);
  assert.equal(calls,1);t.diagnostic('同一ラベルの600回の幅取得: 実measureTextは1回（従来600回）。CPU使用率の計測ではない。');
  context.font='14px sans-serif';cache.measure('日本語.txt');assert.equal(calls,2);
  cache.clear();cache.measure('日本語.txt');assert.equal(calls,3);
});

test('IDE描画: 非表示ではフレーム/DOM計測を止め、復帰・再非表示・破棄でもループは増殖しない',async t=>{
  const old=new Map();let frameId=0,clock=0,layoutCalls=0;
  const frames=new Map(),window=new EventTarget(),document=new EventTarget();
  Object.assign(window,{devicePixelRatio:1,requestAnimationFrame:callback=>{frames.set(++frameId,callback);return frameId;},cancelAnimationFrame:id=>frames.delete(id)});
  const context=new Proxy({font:'',createRadialGradient:()=>({addColorStop(){}}),measureText:text=>({width:text.length*6})},{get:(object,key)=>key in object?object[key]:()=>{}});
  const canvas=new EventTarget();canvas.getContext=()=>context;canvas.classList={add(){},remove(){},toggle(){}};canvas.style={removeProperty(){}};canvas.setAttribute=()=>{};
  document.hidden=false;document.createElement=()=>({getContext:()=>context});
  for(const [key,value] of Object.entries({window,document,innerWidth:1280,innerHeight:800})){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
  t.mock.method(performance,'now',()=>clock);
  let engine;
  try{
    engine=createSpace(canvas,{tooltip:{}},{layout:()=>{layoutCalls++;return{};}});
    const frame=()=>{clock+=1000/60;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(clock);};
    for(let n=0;n<60;n++)frame();assert.equal(layoutCalls,60);assert.equal(frames.size,1);
    document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(frames.size,0);
    for(let n=0;n<600;n++)frame();assert.equal(layoutCalls,60);
    document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('visibilitychange'));assert.equal(frames.size,1);
    frame();assert.equal(layoutCalls,61);assert.equal(frames.size,1);
    document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(frames.size,0);
    document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));engine.dispose();assert.equal(frames.size,0);
    document.dispatchEvent(new Event('visibilitychange'));assert.equal(frames.size,0);
    t.diagnostic('非表示の600フレーム相当: Canvasフレーム0回・layout取得0回。表示復帰後は1ループ。');
  }finally{engine?.dispose();for(const [key,descriptor] of old)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});

test('軌道案内線は元軌道の90%を描画し、船の飛行座標を変更しない',()=>{
  assert.equal(ORBIT_PATH_SCALE,.9);
  const point={x:100,y:-200,z:300};assert.deepEqual(Object.values(point).map(value=>value*ORBIT_PATH_SCALE),[90,-180,270]);
  assert.deepEqual(point,{x:100,y:-200,z:300});
  const source=readFileSync(new URL('../src/components/開発スペース/宇宙描画.js',import.meta.url),'utf8');
  assert.match(source,/project\(point\.x\*ORBIT_PATH_SCALE,point\.y\*ORBIT_PATH_SCALE,point\.z\*ORBIT_PATH_SCALE\)/);
});

test('IDE: 状態確認の通信失敗・不正応答でも作業、下書き、PTYを保持し、同じセッションへ復帰する',async()=>{
  const active={active:true,startedAt:1,mode:'online',connected:true,project:{path:'/fixture',name:'fixture'}};
  let reply=active,fail=false;
  const fixture=component('App',{props:{config:{kind:'ide'}},fetcher:async()=>{if(fail)throw Error('offline');return{ok:true,json:async()=>reply};}});
  try{
    await fixture.mount();const state=fixture.state;
    Object.assign(state.base,{code:'/code/',live:'/live/',console:'/console/'});state.panelOpen.value=true;
    state.analysis.value={file:'sample'};state.history.value={file:'history'};
    fail=true;await state.status();
    assert.equal(state.state.value.active,true);assert.equal(state.base.console,'/console/');assert.equal(state.base.code,'/code/');assert.equal(state.base.live,'/live/');
    assert.equal(state.panelOpen.value,true);assert.equal(state.analysis.value.file,'sample');assert.equal(state.history.value.file,'history');assert.match(state.statusError.value,/保持/);
    fail=false;reply={};await state.status();assert.equal(state.base.console,'/console/');assert.equal(state.state.value.active,true);
    reply={active:true};await state.status();assert.equal(state.base.console,'/console/');
    reply={...active,connected:false};await state.status();assert.equal(state.state.value.connected,false);assert.equal(state.statusError.value,'');assert.equal(state.base.console,'/console/');
    reply={...active,startedAt:2};await state.status();assert.equal(state.base.console,'');assert.equal(state.analysis.value,null);
    state.base.console='/next/';reply={...active,active:false};await state.status();assert.equal(state.base.console,'');assert.equal(state.state.value.active,false);
  }finally{fixture.dispose();}
});

test('IDE: 子ウィンドウの確認失敗は有効な接続状態を利用終了に変えない',async()=>{
  const fixture=component('App',{props:{config:{kind:'ide'}},windowAPI:{childWindows:async()=>{throw Error('ipc');}},fetcher:async()=>({ok:true,json:async()=>({active:true,startedAt:1,mode:'online',connected:false,project:{path:'/fixture'}})})});
  try{await fixture.mount();fixture.state.base.console='/console/';await fixture.state.status();assert.equal(fixture.state.state.value.active,true);assert.equal(fixture.state.base.console,'/console/');assert.match(fixture.state.statusError.value,/子ウィンドウ/);}
  finally{fixture.dispose();}
});

test('IDE: 手動終了より前に始めた遅い状態応答は終了後の画面を復活させない',async()=>{
  let release,delay=false;
  const active={active:true,startedAt:1,mode:'offline',project:{path:'/fixture'}};
  const fixture=component('App',{props:{config:{kind:'ide'}},fetcher:async url=>url.endsWith('/disconnect')?{ok:true,json:async()=>({active:false})}:delay?new Promise(resolve=>{release=resolve;}):{ok:true,json:async()=>active}});
  try{await fixture.mount();delay=true;const polling=fixture.state.status();await fixture.state.start('disconnect');release({ok:true,json:async()=>active});await polling;assert.equal(fixture.state.state.value.active,false);assert.equal(fixture.state.base.console,'');}
  finally{fixture.dispose();}
});

test('IDE: 下書き連携の遅い状態確認は手動終了・新セッションを巻き戻さない',async()=>{
  let delayed=false,release;
  const active={active:true,startedAt:1,mode:'online',project:{path:'/fixture'}};
  const fixture=component('App',{props:{config:{kind:'ide'}},fetcher:async url=>url.endsWith('/disconnect')?{ok:true,json:async()=>({active:false})}:delayed?new Promise(resolve=>{release=resolve;}):{ok:true,json:async()=>active}});
  try{
    await fixture.mount();delayed=true;
    const checking=fixture.state.confirmDraftSession({projectPath:'/fixture'});
    await fixture.state.start('disconnect');
    fixture.state.update({...active,startedAt:2});fixture.state.base.console='/new-console/';
    release({ok:true,json:async()=>active});await assert.rejects(checking,/利用状態が変わり/);
    assert.equal(fixture.state.state.value.startedAt,2);assert.equal(fixture.state.base.console,'/new-console/');
  }finally{fixture.dispose();}
});

test('Webピン留め: 連携確認の途中で送信元が閉じた場合は追加しない',async()=>{
  let delayed=false,release,insertions=0;
  const active={active:true,startedAt:1,mode:'online',project:{path:'/fixture'}};
  const fixture=component('App',{props:{config:{kind:'ide'}},fetcher:async()=>delayed?new Promise(resolve=>{release=resolve;}):{ok:true,json:async()=>active}});
  try{
    await fixture.mount();const state=fixture.state,source={closed:false};
    state.codePanel.value={draftTarget:()=>({kind:'code',projectPath:'/fixture',contextId:'one',label:'Code',maxLength:200000}),insertDraft:()=>{insertions++;return{ok:true};}};
    const listing=await state.loadDraftTargets({projectPath:'/fixture'});
    state.pinnedViewers.set(source,{sessionKey:listing.sessionKey,projectPath:'/fixture'});
    const request={...listing.targets[0],targetId:listing.targets[0].id,sessionKey:listing.sessionKey,text:'参照'};
    delayed=true;const pending=state.draftLink.insert(source,request);source.closed=true;release({ok:true,json:async()=>active});
    await assert.rejects(pending,/ピン留め元/);assert.equal(insertions,0);
  }finally{fixture.dispose();}
});
