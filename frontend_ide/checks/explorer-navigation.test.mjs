// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as latest from '../src/components/ファイル閲覧/最新ファイル.js';
import * as fileDates from '../src/components/ファイル閲覧/ファイル日時.js';
import * as routeExpansion from '../src/components/ファイル閲覧/軌跡パネル展開.js';
import * as routeTree from '../src/components/開発スペース/軌跡ツリー.js';
import * as routeRecords from '../src/components/開発スペース/経路記録.js';
import * as explorerDrag from '../src/components/ファイル閲覧/エクスプローラードラッグ.js';
import * as explorerActions from '../src/components/ファイル閲覧/エクスプローラー操作.js';
import {scanWarning} from '../src/components/ファイル閲覧/走査警告.js';
import {createSpace} from '../src/components/開発スペース/宇宙描画.js';

const require=createRequire(import.meta.url),vue=require('vue');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const flush=async()=>{for(let n=0;n<15;n++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const reply=value=>({ok:true,json:async()=>value});
const scan=(files,extra={})=>({root:'/project',tree:{n:'project',d:[],f:files.map(path=>[path,20,1000])},truncated:false,...extra});

function explorer(fetcher=async()=>reply({files:[]})){
  const path=new URL('../src/components/ファイル閲覧/ファイル一覧.vue',import.meta.url),{descriptor}=parse(readFileSync(path,'utf8'));
  assert.deepEqual(compileTemplate({source:descriptor.template.content,id:'explorer',filename:path.pathname}).errors,[]);
  const script=compileScript(descriptor,{id:'explorer',genDefaultAs:'component'});
  const {code}=transformSync(`${script.content}\nmodule.exports=component;`,{format:'cjs'});
  const mounted=[],unmounted=[],timers=new Map(),events=[],document=new EventTarget();let id=0;
  document.hidden=false;
  const module={exports:{}};
  vm.runInNewContext(code,{
    module,document,window:Object.assign(new EventTarget(),{innerHeight:800,setTimeout,clearTimeout}),fetch:fetcher,AbortController,URLSearchParams,Date,console,
    localStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:true}),CSS:{escape:value=>value},
    setInterval:(callback,ms)=>{timers.set(++id,{callback,ms});return id;},clearInterval:key=>timers.delete(key),setTimeout,clearTimeout,
    require:id=>id==='vue'?{...vue,onMounted:callback=>mounted.push(callback),onBeforeUnmount:callback=>unmounted.push(callback)}:id.includes('ファイル日時.js')?fileDates:id.includes('最新ファイル')?latest:id.includes('走査警告')?{scanWarning}:id.includes('軌跡パネル展開')?routeExpansion:id.includes('軌跡ツリー')?routeTree:id.includes('経路記録')?routeRecords:id.includes('エクスプローラー操作.js')?explorerActions:id.includes('エクスプローラードラッグ.js')?explorerDrag:{},
  });
  const props=vue.reactive({root:'/project',tree:scan(['old.js']).tree,scan:scan(['old.js']),selected:'',current:'',startedAt:1,open:true,viewHistory:[],filter:true,color:()=>''});
  const scope=vue.effectScope(),state=scope.run(()=>module.exports.setup(props,{expose(){},emit:(...args)=>events.push(args)}));
  for(const callback of mounted)callback();
  return {props,state,events,timers,dispose(){for(const callback of unmounted)callback();scope.stop();}};
}

test('最新通知: 自動追跡と独立して一覧更新を要求し、フィルターOFFでも新規ファイルを手動選択できる',async()=>{
  let files=[{path:'new.js',name:'new.js',mtime:2000}];
  const h=explorer(async()=>reply({files}));
  try{
    await h.state.pollLatest();
    assert.equal(h.events.filter(([type])=>type==='freshness').length,1);
    h.state.select({type:'file',path:'new.js',mtime:2000,source:'latest'});
    assert.equal(h.events.at(-1)[1].source,'latest');assert.equal(h.events.at(-1)[1].mtime,2000);
    h.props.filter=false;await vue.nextTick();await flush();
    files=[{path:'other.js',name:'other.js',mtime:3000}];await h.state.pollLatest();
    assert.equal(h.events.filter(([type])=>type==='freshness').at(-1)[1].files[0].path,'other.js');
    assert.equal(h.events.filter(([type])=>type==='latest').at(-1)[1].path,'new.js');
  }finally{h.dispose();}
});

test('ツリー書換えは選択移動を通知せず、新しい最終更新の検知だけで通知する',async()=>{
 const files=[{path:'new.js',name:'new.js',mtime:5000}];
 const h=explorer(async()=>reply({files}));
 try{
  const baseline=h.events.filter(([type])=>type==='latest').length;
  h.props.selected='old.js';h.props.tree=scan(['old.js','new.js']).tree;
  h.props.tree.f.find(row=>row[0]==='new.js')[2]=5000;
  await vue.nextTick();await flush();
  assert.equal(h.events.filter(([type])=>type==='latest').length,baseline);
  assert.equal(h.props.selected,'old.js');
  await h.state.pollLatest();
  assert.equal(h.events.filter(([type])=>type==='latest').length,baseline+1);
  assert.equal(h.events.filter(([type])=>type==='latest').at(-1)[1].path,'new.js');
  h.props.tree=structuredClone(vue.toRaw(h.props.tree));await vue.nextTick();await h.state.pollLatest();
  assert.equal(h.events.filter(([type])=>type==='latest').length,baseline+1,'同じ最終更新やツリー再作成では重ねて通知しない');
 }finally{h.dispose();}
});

test('複数チェック: 行の修飾キーは最終選択を移し、チェック欄は移さず、取得を中断・再開する',async()=>{
 let request;
 const h=explorer((_url,options)=>{request={...deferred(),signal:options.signal};return request.promise;});
 try{
  h.props.tree=scan(['a.js','b.js','c.js']).tree;await vue.nextTick();
  const [a,b,c]=h.state.rows.value;
  h.state.clickRow({},a);h.props.selected=a.path;await vue.nextTick();
  assert.deepEqual([...h.state.checkedPaths.value],[a.path]);
  const waiting=h.state.pollLatest();const before=h.events.filter(([kind])=>kind==='select').length;
  h.state.toggleCheck(c);
  assert.equal(request.signal.aborted,true);assert.equal(h.state.multipleChecked.value,true);
  assert.equal(h.events.filter(([kind])=>kind==='select').length,before,'チェック欄だけでは最終選択を変えない');
  assert.equal(h.events.filter(([kind])=>kind==='pause-refresh').at(-1)[1],true);
  request.resolve(reply({files:[{path:'late.js',mtime:9000}]}));await waiting;
  assert.notEqual(h.events.filter(([kind])=>kind==='latest').at(-1)?.[1].path,'late.js');
  h.state.clickRow({ctrlKey:true},b);assert.equal(h.events.filter(([kind])=>kind==='select').at(-1)[1].path,b.path);
  assert.deepEqual(new Set(h.state.checkedPaths.value),new Set([a.path,b.path,c.path]));
  h.state.clickRow({},a);await vue.nextTick();assert.equal(h.state.multipleChecked.value,false);
  request.resolve(reply({files:[]}));await flush();
  h.state.clickRow({shiftKey:true},c);
  assert.deepEqual(new Set(h.state.checkedPaths.value),new Set([a.path,b.path,c.path]));
  assert.equal(h.events.filter(([kind])=>kind==='select').at(-1)[1].path,c.path);
  h.state.clickRow({shiftKey:true},b);assert.deepEqual([...h.state.checkedPaths.value],[a.path,b.path],'Shiftの基点を維持して範囲を縮める');
 }finally{request?.resolve(reply({files:[]}));h.dispose();}
});

test('Explorerキーボード: Spaceはチェックだけ、Ctrl+Aは同一階層、Escは最終選択を残して解除',async()=>{
 const h=explorer();
 const key=(key,extra={})=>h.state.key({key,preventDefault(){},stopPropagation(){},...extra});
 try{
  h.props.tree={n:'root',f:[['a.txt',1,1000],['b.txt',1,1000]],d:[{n:'folder',f:[['child.txt',1,1000]],d:[]}]};
  h.state.expanded.value=new Set(['folder']);await vue.nextTick();
  h.props.selected='a.txt';await vue.nextTick();h.state.cursor.value='b.txt';
  const before=h.events.filter(([type])=>type==='select').length;
  key(' ');assert.deepEqual(new Set(h.state.checkedPaths.value),new Set(['a.txt','b.txt']));
  assert.equal(h.events.filter(([type])=>type==='select').length,before);
  key('a',{ctrlKey:true});assert.deepEqual(new Set(h.state.checkedPaths.value),new Set(['folder','a.txt','b.txt']));
  assert.equal(h.state.checkedPaths.value.has('folder/child.txt'),false);
  key('Escape');assert.deepEqual([...h.state.checkedPaths.value],['a.txt']);
 }finally{h.dispose();}
});

test('Shiftは同一階層に限定し、Ctrlとチェック欄は階層をまたいで追加できる',async()=>{
 const h=explorer();
 try{
  h.props.tree={n:'root',f:[['root.txt',1,1000]],d:[{n:'folder',f:[['a.txt',1,1000],['b.txt',1,1000]],d:[]}]};
  h.state.expanded.value=new Set(['folder']);await vue.nextTick();
  const find=path=>h.state.rows.value.find(row=>row.path===path);
  h.state.clickRow({},find('folder'));h.state.clickRow({shiftKey:true},find('folder/a.txt'));
  assert.deepEqual([...h.state.checkedPaths.value],['folder/a.txt']);
  h.state.clickRow({shiftKey:true},find('folder/b.txt'));
  assert.deepEqual([...h.state.checkedPaths.value],['folder/a.txt','folder/b.txt']);
  h.state.toggleCheck(find('root.txt'));assert.deepEqual(new Set(h.state.checkedPaths.value),new Set(['folder/a.txt','folder/b.txt','root.txt']));
  h.state.clickRow({},find('root.txt'));h.state.clickRow({ctrlKey:true},find('folder/a.txt'));assert.deepEqual(new Set(h.state.checkedPaths.value),new Set(['root.txt','folder/a.txt']));
 }finally{h.dispose();}
});

test('最新取得: 重複取得しない。フィルター・セッション変更と破棄の後に古い応答を反映しない',async()=>{
  const requests=[];const h=explorer((_url,options)=>{const request={...deferred(),signal:options.signal};requests.push(request);return request.promise;});
  const payload=path=>reply({files:[{path,name:path,mtime:5000}]});
  try{
    const first=h.state.pollLatest();await h.state.pollLatest();assert.equal(requests.length,1);
    h.props.filter=false;await vue.nextTick();assert.equal(requests[0].signal.aborted,true);
    requests[0].resolve(payload('stale.js'));await first;assert.equal(h.state.recentUpdates.value.length,0);
    h.props.startedAt=2;await vue.nextTick();assert.equal(requests[1].signal.aborted,true);
    requests[1].resolve(payload('old-session.js'));await flush();assert.equal(h.state.recentUpdates.value.length,0);
    h.dispose();requests[2].resolve(payload('after-dispose.js'));await flush();assert.equal(h.state.recentUpdates.value.length,0);assert.equal(h.timers.size,0);
  }finally{for(const request of requests)request.resolve(payload('done.js'));}
});

test('grep: 行・列・検索時の条件を選択へ渡し、ツリーマークを保持する',async()=>{
  const match={path:'src/file.js',line:8,column:3,snippet:'  Japanese 日本語',mtime:2000,size:40,length:3};
  const h=explorer(async()=>reply({paths:[match.path],matches:[match],checked:2,skipped:0,truncated:false}));
  try{
    h.state.mode.value='grep';await vue.nextTick();h.state.query.value='日本語';h.state.caseSensitive.value=true;await h.state.grep();
    assert.equal(h.state.matches.value.has(match.path),true);assert.equal(h.state.expanded.value.has('src'),true);
    h.state.query.value='edited input';h.state.caseSensitive.value=false;
    assert.equal(h.state.searchResultsOpen.value,false);
    h.state.selectSearchResult(h.state.searchResults.value[0]);const value=h.events.at(-1)[1];
    assert.equal(value.line,8);assert.equal(value.column,3);assert.equal(value.query,'日本語');assert.equal(value.caseSensitive,true);assert.equal(value.matchMtime,2000);assert.equal(value.matchLength,3);
    assert.equal(h.state.matches.value.has(match.path),true);
  }finally{h.dispose();}
});

test('grep: 再検索・解除・フィルター変更・セッション変更・終了で遅い結果を破棄する',async()=>{
  const requests=[];const h=explorer(url=>{if(url.startsWith('/api/latest'))return Promise.resolve(reply({files:[]}));const request=deferred();requests.push(request);return request.promise;});
  const result=path=>reply({paths:[path],matches:[{path,line:1,column:1,snippet:path}],checked:1,skipped:0,truncated:false});
  try{
    h.state.mode.value='grep';await vue.nextTick();h.state.query.value='first';const first=h.state.grep();
    h.state.query.value='second';const second=h.state.grep();requests[1].resolve(result('second.js'));await second;requests[0].resolve(result('first.js'));await first;
    assert.deepEqual([...h.state.matches.value],['second.js']);
    for(const cancel of [()=>h.state.clearSearch(),()=>{h.props.filter=!h.props.filter;},()=>{h.props.startedAt++;},()=>h.dispose()]){
      h.state.query.value='pending';const run=h.state.grep();cancel();await vue.nextTick();requests.at(-1).resolve(result('stale.js'));await run;
      assert.equal(h.state.matches.value.size,0);assert.equal(h.state.grepResults.value.length,0);
      if(h.state.mode.value==='grep')assert.equal(h.state.searchResults.value.length,0);
      assert.equal(h.state.searchResultsOpen.value,false);
    }
  }finally{for(const request of requests)request.resolve(result('done.js'));}
});

test('走査上限は一覧・最新・grepに未表示の候補があることを明示する',()=>{
  assert.equal(scanWarning({truncated:false}),'');
  for(const reason of ['files','directories','entries','depth','time','cancelled'])assert.match(scanWarning({truncated:true,truncationReason:reason}),/一部のみ/);
  const h=explorer();try{h.props.scan={truncated:true,truncationReason:'directories'};assert.match(h.state.treeWarning.value,/フォルダ数/);}finally{h.dispose();}
});

function space(t,fetcher){
  const old=new Map(),frames=new Map(),timers=new Map(),changes=[];let clock=0,id=0;
  const window=new EventTarget(),document=new EventTarget();document.hidden=false;
  const context=new Proxy({font:'',createRadialGradient:()=>({addColorStop(){}}),measureText:text=>({width:text.length*6})},{get:(object,key)=>key in object?object[key]:()=>{}});
  const canvas=new EventTarget();Object.assign(canvas,{getContext:()=>context,classList:{add(){},remove(){},toggle(){}},style:{removeProperty(){}},setAttribute(){},animate:()=>({finished:Promise.resolve(),cancel(){}})});
  document.createElement=()=>({getContext:()=>context});
  const location={hash:''};Object.assign(window,{devicePixelRatio:1,history:{pushState(_a,_b,hash){location.hash=hash;}},requestAnimationFrame:callback=>{frames.set(++id,callback);return id;},cancelAnimationFrame:id=>frames.delete(id)});
  for(const [key,value] of Object.entries({window,document,location,innerWidth:1280,innerHeight:800,localStorage:{getItem:()=>null,setItem(){}},fetch:fetcher,setTimeout:callback=>{timers.set(++id,callback);return id;},clearTimeout:key=>timers.delete(key)})){
    old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  t.mock.method(performance,'now',()=>clock);
  const engine=createSpace(canvas,{tooltip:{}},{change:value=>changes.push(value)});
  engine.setAutoSpin(false);
  const pump=async()=>{clock+=100;const frameCallbacks=[...frames.values()];frames.clear();for(const callback of frameCallbacks)callback(clock);const callbacks=[...timers.values()];timers.clear();for(const callback of callbacks)callback();await flush();};
  const finish=async promise=>{let done=false,result,error;promise.then(value=>{done=true;result=value;},value=>{done=true;error=value;});for(let n=0;n<200&&!done;n++)await pump();assert.equal(done,true,'navigation completes');if(error)throw error;return result;};
  return {engine,changes,finish,pump,selected:()=>changes.filter(value=>'scan'in value).at(-1)?.selected,dispose(){engine.dispose();for(const [key,descriptor] of old)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}};
}

test('手動Latest: 自動探索OFFでも新規パスを再走査して開く。最新mtimeとgrep再クリック位置も反映する',async t=>{
  let files=['old.js'];const calls=[];const h=space(t,async url=>{calls.push(url);return reply(scan(files));});
  try{
    await h.engine.refresh(1);files=['old.js','new.js'];
    assert.equal(await h.finish(h.engine.goTo({type:'file',path:'new.js',source:'latest',mtime:2000})),true);
    assert.equal(h.selected().path,'new.js');assert.match(calls.at(-1),/fresh=1/);
    const entry={type:'file',path:'new.js',line:2,column:4,query:'x',caseSensitive:true,matchMtime:1000,matchLength:1};
    await h.engine.goTo(entry);const first=h.selected().navigationId;await h.engine.goTo({...entry,line:9});
    assert.equal(h.selected().line,9);assert.notEqual(h.selected().navigationId,first);
    await h.engine.refresh();assert.equal(h.selected().line,9);
  }finally{h.dispose();}
});

test('手動Latest: 再走査中の新しい選択・閉じる・フィルター変更・セッション変更・破棄を優先する',async t=>{
  for(const action of ['select','clear','filter','session','dispose']){
    let request=null;const requests=[];const h=space(t,()=>{if(!request)return Promise.resolve(reply(scan(['old.js'])));const next=deferred();requests.push(next);return next.promise;});
    try{
      await h.engine.refresh(1);request=true;
      const first=h.engine.goTo({type:'file',path:'new.js',source:'latest'});assert.equal(requests.length,1);
      let newer;
      if(action==='select')newer=h.engine.goTo({type:'file',path:'old.js'});
      if(action==='clear')h.engine.clear();
      if(action==='filter')h.engine.setFilter(false);
      if(action==='session')newer=h.engine.refresh(2);
      if(action==='dispose')h.engine.dispose();
      for(const pending of requests)pending.resolve(reply(scan(['old.js','new.js'])));
      assert.equal(await h.finish(first),false,action);
      if(newer)await h.finish(newer);
      assert.notEqual(h.selected()?.path,'new.js',action);
      if(action==='select')assert.equal(h.selected()?.path,'old.js');
    }finally{h.dispose();}
  }
});

test('grep: フィルター外の一致も現在の視点を維持して開き、後続の一覧更新で閉じない',async t=>{
  const h=space(t,async()=>reply(scan(['old.js'])));
  try{
    await h.engine.refresh(1);const before={...h.engine.cam};
    assert.equal(await h.engine.goTo({type:'file',path:'hidden/file.txt',source:'grep',line:3,column:2,query:'x',mtime:1000}),true);
    assert.equal(h.selected().path,'hidden/file.txt');assert.equal(h.selected().line,3);assert.deepEqual(h.engine.cam,before);
    await h.engine.refresh();assert.equal(h.selected().path,'hidden/file.txt');
  }finally{h.dispose();}
});

test('手動Latest: 古い進行中の走査へ合流しても、未発見なら新しい走査で新規ファイルを開く',async t=>{
  let calls=0;const old=deferred();
  const h=space(t,()=>{calls++;return calls===2?old.promise:Promise.resolve(reply(scan(calls===1?['old.js']:['old.js','new.js'])));});
  try{
    await h.engine.refresh(1);const background=h.engine.refresh(undefined,{fresh:false});
    const selected=h.engine.goTo({type:'file',path:'new.js',source:'latest'});
    assert.equal(calls,2,'同じ条件の進行中リクエストを重ねない');
    old.resolve(reply(scan(['old.js'])));await background;
    assert.equal(await h.finish(selected),true);assert.equal(calls,3);assert.equal(h.selected().path,'new.js');
  }finally{h.dispose();}
});

test('手動Latest: 連打は最後のファイルだけ開き、遅いバックグラウンド更新で選択を奪わない',async t=>{
  let calls=0;const pending=deferred();
  const h=space(t,()=>{calls++;return calls===2?pending.promise:Promise.resolve(reply(scan(['old.js','second.js'])));});
  try{
    await h.engine.refresh(1);
    const first=h.engine.goTo({type:'file',path:'first.js',source:'latest'});
    const second=h.engine.goTo({type:'file',path:'second.js',source:'latest'});
    pending.resolve(reply(scan(['old.js','first.js','second.js'])));
    assert.equal(await h.finish(first),false);assert.equal(await h.finish(second),true);
    assert.equal(h.selected().path,'second.js');assert.equal(calls,2);
  }finally{h.dispose();}
});

test('手動Latest: 新しい深いフォルダを再走査して通常・高速ワープの両方から開く',async t=>{
  for(const fast of [false,true]){
    let deep=false;const h=space(t,async()=>reply(deep?scan(['old.js'],{tree:{n:'project',f:[['old.js',20,1000]],d:[{n:'src',f:[],d:[{n:'new',d:[],f:[['deep.js',40,2000]]}]}]}}):scan(['old.js'])));
    try{
      await h.engine.refresh(1);h.engine.setFastWarp(fast);deep=true;
      assert.equal(await h.finish(h.engine.goTo({type:'file',path:'src/new/deep.js',source:'latest',mtime:2000})),true);
      assert.equal(h.selected().path,'src/new/deep.js');assert.deepEqual(h.engine.trail,['src','new']);
    }finally{h.dispose();}
  }
});

test('時刻プリセット: 境界のマーク・軌跡と終了入力を同期し、切替・解除で前の上限を残さない',async()=>{
  const h=explorer();
  try{
    const expected=fileDates.timeSearchRange('morning',h.props.startedAt);
    const {since:day,until:boundary}=expected;
    h.props.tree={n:'project',d:[],f:[['before.txt',1,day-1],['morning.txt',1,boundary-0.5],['afternoon.txt',1,boundary],['tomorrow.txt',1,fileDates.nextLocalMidnight()]]};
    await vue.nextTick();
    h.state.choose('morning');await vue.nextTick();
    assert.equal(h.state.since.value,day);assert.equal(h.state.until.value,boundary);
    assert.equal(h.state.endDateInput.value,fileDates.localDateTimeInput(boundary-1000));
    assert.deepEqual([...h.state.routePaths.value],['morning.txt']);
    h.state.choose('afternoon');await vue.nextTick();
    assert.deepEqual([...h.state.routePaths.value],['afternoon.txt']);
    h.state.choose('today');await vue.nextTick();
    assert.deepEqual([...h.state.routePaths.value],['morning.txt','afternoon.txt']);
    h.state.chooseDate(h.state.endDateInput.value,true);await vue.nextTick();
    assert.equal(h.state.preset.value,'custom');assert.equal(h.state.until.value,fileDates.nextLocalMidnight());
    for(const preset of ['fifteen','hour','twoHours','start']){
      h.state.choose('morning');h.state.choose(preset);await vue.nextTick();
      assert.equal(h.state.until.value,null);assert.equal(h.state.endDateInput.value,'');assert.equal(h.state.dateError.value,'');
    }
    assert.equal(h.state.since.value,h.props.startedAt);
    h.state.choose('morning');h.state.choose('clear');await vue.nextTick();
    assert.equal(h.state.since.value,null);assert.equal(h.state.until.value,null);
    assert.equal(h.state.dateInput.value,'');assert.equal(h.state.endDateInput.value,'');
    assert.deepEqual([...h.state.routePaths.value],[]);
  }finally{h.dispose();}
});


test('共通検索一覧: 初期は閉じ、時刻の境界・階層・表示フィルターに追従する',async()=>{
  const h=explorer();
  try{
    assert.equal(h.state.searchResultsOpen.value,false);
    h.props.tree={n:'project',f:[['before.txt',1,999],['start.txt',2,1000],['end.txt',3,2000]],d:[{n:'src',f:[['inside.txt',4,1500]],d:[]}]};
    h.state.since.value=1000;h.state.until.value=2000;await vue.nextTick();
    assert.deepEqual([...h.state.searchResults.value.map(row=>row.path)].sort(),['src/inside.txt','start.txt']);
    assert.equal(h.state.searchResultsOpen.value,false,'結果到着では開かない');
    const row=h.state.searchResults.value.find(row=>row.path==='src/inside.txt');
    h.state.selectSearchResult(row);assert.equal(h.events.at(-1)[1].path,row.path);assert.equal(h.events.at(-1)[1].mtime,1500);
    h.state.searchResultsOpen.value=true;
    h.props.tree={n:'project',f:[['start.txt',2,1000]],d:[]};await vue.nextTick();
    assert.deepEqual([...h.state.searchResults.value.map(row=>row.path)],['start.txt']);
    h.state.until.value=1000;await vue.nextTick();assert.equal(h.state.searchResults.value.length,0);
    h.state.until.value=null;h.state.since.value=null;await vue.nextTick();assert.equal(h.state.searchResults.value.length,0);
  }finally{h.dispose();}
});

test('共通検索一覧: AIの理由・一覧外候補を保ち、空結果と失敗でも勝手に展開しない',async()=>{
  const h=explorer(async url=>url.startsWith('/api/grep')?{ok:false,text:async()=> '検索失敗'}:reply({files:[]}));
  try{
    h.state.acceptAI({title:'構成',query:'関連を探す',route:['hidden/file.js'],files:[{path:'hidden/file.js',reason:'設定を読み込む'}]});await vue.nextTick();
    assert.equal(h.state.searchResultsOpen.value,false);
    assert.equal(h.state.searchResults.value[0].path,'hidden/file.js');assert.equal(h.state.searchResults.value[0].reason,'設定を読み込む');
    assert.equal(h.state.hiddenAI.value,1);
    h.state.selectSearchResult(h.state.searchResults.value[0]);assert.equal(h.events.at(-1)[1].path,'hidden/file.js');
    h.state.acceptAI({title:'なし',query:'なし',route:[],files:[]});await vue.nextTick();assert.equal(h.state.searchResults.value.length,0);
    h.state.mode.value='grep';await vue.nextTick();h.state.query.value='bad';await h.state.grep();
    assert.match(h.state.status.value,/検索失敗/);assert.equal(h.state.searchResults.value.length,0);assert.equal(h.state.searchResultsOpen.value,false);
  }finally{h.dispose();}
});
