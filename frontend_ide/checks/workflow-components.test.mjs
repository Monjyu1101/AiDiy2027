// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { componentPaths, componentName } from './component-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as fileAnalysisStatus from '../src/components/ファイル閲覧/ファイル解析状態.js';
import * as displayUrls from '../viewer/表示URL.mjs';
import * as viewerIdle from '../src/components/ファイル閲覧/閲覧待機.js';
import * as fileReference from '../src/components/ファイル閲覧/ファイル参照.js';
import * as fileActions from '../src/components/ファイル閲覧/ファイル操作.js';
import * as explorerActions from '../src/components/ファイル閲覧/エクスプローラー操作.js';
const require=createRequire(import.meta.url),vue=require('vue');
const {parse,compileScript}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function component(name,{props={},modules={},globals={},provided={}}={}){
  const {descriptor}=parse(readFileSync(new URL(`../src/${componentPaths[name]}`,import.meta.url),'utf8'));
  const {content}=compileScript(descriptor,{id:name,genDefaultAs:'component'});
  const mounted=[],unmounted=[],emitted=[],module={exports:{}};
  const window=new EventTarget();
  vm.runInNewContext(transformSync(content+'\nmodule.exports=component;',{format:'cjs'}).code,{
    module,window,AbortController,AbortSignal,URLSearchParams,Response,Date,
    localStorage:{getItem:()=>null,setItem(){}},getComputedStyle:()=>({getPropertyValue:()=>10}),
    setTimeout:()=>0,clearTimeout(){},
    require:id=>id.endsWith('/ファイル解析状態.js')?fileAnalysisStatus:id==='../../../viewer/表示URL.mjs'?displayUrls:id==='../ファイル閲覧/閲覧待機.js'?viewerIdle:id==='vue'?{...vue,inject:(key,fallback)=>provided[key]??fallback,onMounted:callback=>mounted.push(callback),onBeforeUnmount:callback=>unmounted.push(callback)}:id==='../ファイル閲覧/ファイル操作.js'?fileActions:id==='../ファイル閲覧/エクスプローラー操作.js'?explorerActions:modules[id]||{},
    ...globals,
  });
  const scope=vue.effectScope(),reactive=vue.reactive(props);
  const state=scope.run(()=>module.exports.setup(reactive,{expose(){},emit:(...args)=>emitted.push(args)}));
  return{state,props:reactive,emitted,async mount(){for(const callback of mounted)await callback();await flush();},dispose(){for(const callback of unmounted)callback();scope.stop();}};
}
test('ALL中新規選択: IDE内で1件ずつ差し替え、手動でピン留めした窓だけを保持する',async()=>{
 const f=component('SpaceView',{props:{startedAt:1,viewMode:'3d',allDisplays:true},globals:{document:new EventTarget()}}),calls=[];
 try{
  f.state.viewerRefs.set('one.txt',{pin:()=>calls.push('pin'),focus:()=>calls.push('focus')});
  f.state.selected.value={name:'one.txt',path:'one.txt'};await flush();
  f.state.selected.value={name:'two.txt',path:'two.txt'};await flush();
  assert.deepEqual(calls,[]);assert.equal(f.state.viewerSessions.value.length,1);assert.equal(f.state.viewerSessions.value[0].file.path,'two.txt');
  f.state.selected.value={name:'one.txt',path:'one.txt'};await flush();
  const pinned=f.state.viewerSessions.value[0];f.state.pinningViewer(pinned,true);
  f.state.selected.value={name:'two.txt',path:'two.txt'};await flush();
  assert.equal(f.state.viewerSessions.value.length,2,'手動ピン留めの表示待ち中に選び替えても元セッションを破棄しない');
  f.state.detachedViewer(pinned);f.state.pinningViewer(pinned,false);
  assert.equal(f.state.viewerSessions.value.length,2);assert.equal(f.state.viewerSessions.value.filter(entry=>!entry.detached).length,1);
  f.state.selected.value={name:'one.txt',path:'one.txt'};await flush();assert.deepEqual(calls,['focus']);
  assert.equal(f.state.viewerSessions.value.length,1);assert.equal(f.state.viewerSessions.value[0],pinned);
 }finally{f.dispose();}
});

test('ALL準備: 比較を含む閲覧セッションを維持し、Explorerと軌跡のピン留めだけを待つ',async()=>{
 const f=component('SpaceView',{props:{startedAt:1,viewMode:'3d'},globals:{document:new EventTarget()}}),calls=[];
 try{
  f.state.selected.value={name:'one.txt',path:'one.txt'};await flush();const entry=f.state.viewerSessions.value[0];
  f.state.viewerRefs.set('one.txt',{pin:()=>{throw Error('閲覧は自動ピン留めしない');}});
  f.state.explorer.value={pinForAll:async()=>calls.push('bars')};
  await f.state.prepareAll();assert.deepEqual(calls,['bars']);assert.equal(f.state.viewerSessions.value[0],entry);assert.equal(entry.detached,false);
 }finally{f.dispose();}
});

test('ALLの宇宙中心: パネル寸法を参照せず画面中央へ固定し、解除後は従来の補正に戻る',()=>{
 const fixture=component('SpaceView',{props:{startedAt:1,viewMode:'3d',allDisplays:true},globals:{innerWidth:3840,innerHeight:2160,document:new EventTarget()}});
 let measured=0;
 fixture.state.root.value={style:{setProperty(){}},querySelector:selector=>{measured++;return selector==='.viewer-popup'?{}:{getBoundingClientRect:()=>({right:1000,left:16})};}};
 fixture.state.open.value=true;
 try{
  for(const preview of [true,false]){const value=fixture.state.layout({preview});assert.equal(value.centerX,1920);assert.equal(value.centerY,1080);assert.equal(value.preview,false);}
  assert.equal(measured,0);
  fixture.props.allDisplays=false;assert.notEqual(fixture.state.layout({preview:true}).centerX,1920);assert.ok(measured>0);
 }finally{fixture.dispose();}
});

function viewerFixture({fetcher,fallback=false,file={name:'sample.md',path:'sample.md',line:2,column:1,query:'日本語'}}={}){
  const revealed=[],selections=[],drafts=[],requests=[];let selected=null;
  const editor={getModel:()=>({dispose(){},getValueInRange:()=>selected?.text||''}),dispose(){},onDidScrollChange:()=>({dispose(){}}),setSelection:range=>selections.push(range),revealLineInCenter:line=>revealed.push(line),getSelection:()=>selected};
  const fixture=component('FileViewer',{props:{root:'/same',file},modules:{'../ファイル閲覧/ファイル参照.js':fileReference,'../ファイル閲覧/コード表示.js':{loadMonaco:async()=>{if(fallback)throw Error();return{editor:{create:()=>editor}};},monacoLanguage:()=> 'text'}},provided:{openFileDraft:value=>drafts.push(value)},globals:{fetch:async(url,options)=>{requests.push(url);return fetcher?fetcher(url,options):new Response(JSON.stringify({kind:'text',text:'start\n日本語の行\nend',size:30}));}}});
  return{...fixture,revealed,selections,drafts,requests,select:text=>{selected={text,startLineNumber:2,endLineNumber:2,isEmpty:()=>false};}};
}
test('ビューア: grepクリックはプレビュー設定よりコード表示を優先し、照合した行へ移動する',async()=>{
  const fixture=viewerFixture();
  try{await fixture.mount();assert.equal(fixture.state.mode.value,'code');assert.deepEqual(fixture.revealed,[2]);assert.equal(fixture.selections[0].startLineNumber,2);assert.match(fixture.state.jumpNote.value,/2行/);
    fixture.props.file={name:'sample.md',path:'sample.md',line:2,column:1,query:'日本語',navigationId:2};await flush();assert.deepEqual(fixture.revealed,[2,2]);
    fixture.select('日本語');fixture.state.handoff();assert.equal(fixture.drafts.length,1);assert.equal(fixture.drafts[0].projectPath,'/same');assert.match(fixture.drafts[0].text,/参照ファイル: sample.md\n選択範囲: 2〜2行/);assert.equal(fixture.requests.every(url=>url.startsWith('/api/file?')),true);
  }finally{fixture.dispose();}
});
test('ビューア: 変更後の不一致・削除は誤った行を強調せず案内し、Monaco失敗時にも位置を保持する',async()=>{
  const stale=viewerFixture({file:{name:'x',path:'x',line:2,column:1,query:'old'}});
  const fallback=viewerFixture({fallback:true});
  const missing=viewerFixture({fetcher:async()=>new Response('not found',{status:404})});
  try{await stale.mount();assert.deepEqual(stale.revealed,[]);assert.match(stale.state.jumpNote.value,/検索し直して/);
    await fallback.mount();assert.equal(fallback.state.fallback.value,true);assert.equal(fallback.state.fallbackParts.value.match,'日本語');
    await missing.mount();assert.match(missing.state.error.value,/移動・削除/);
  }finally{stale.dispose();fallback.dispose();missing.dispose();}
});
test('ビューア: ファイル切替より前に始めた遅い読込は新しい選択を上書きしない',async()=>{
  let release;
  const fixture=viewerFixture({file:{name:'old',path:'old'},fetcher:async url=>url.endsWith('old')?new Promise(resolve=>{release=resolve;}):new Response(JSON.stringify({kind:'text',text:'new',size:3}))});
  try{fixture.props.file={name:'new',path:'new'};await flush();assert.equal(fixture.state.data.value.text,'new');release(new Response(JSON.stringify({kind:'text',text:'old',size:3})));await flush();assert.equal(fixture.state.data.value.text,'new');}
  finally{fixture.dispose();}
});
test('ビューア操作: Monaco/iframeの同期scrollを無視し、文書差替え・破棄で購読解除',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);
 const fixture=viewerFixture();
 const document=()=>{const listeners=new Map();return{listeners,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};};
 const first=document(),second=document();
 try{
  await fixture.mount();const state=fixture.state;
  state.userActivity.scroll();assert.equal(fixture.emitted.length,0);
  state.activity({type:'wheel',isTrusted:true});state.userActivity.scroll();assert.equal(fixture.emitted.length,2);
  now=2000;state.userActivity.scroll();assert.equal(fixture.emitted.length,2);
  state.bindFrame({target:{tagName:'IFRAME',contentDocument:first}});assert.equal(first.listeners.size,9);
  first.listeners.get('scroll')({type:'scroll',isTrusted:true});assert.equal(fixture.emitted.length,2);
  first.listeners.get('touchmove')({type:'touchmove',isTrusted:true});first.listeners.get('scroll')({type:'scroll',isTrusted:true});assert.equal(fixture.emitted.length,4);
  state.bindFrame({target:{tagName:'IFRAME',contentDocument:second}});assert.equal(first.listeners.size,0);assert.equal(second.listeners.size,9);
 }finally{fixture.dispose();assert.equal(first.listeners.size,0);assert.equal(second.listeners.size,0);}
});
function dialogFixture(targets){
  const inserted=[],launched=[];let current=targets,result={ok:true};
  const fixture=component('DraftHandoffDialog',{props:{request:{path:'file',projectPath:'/same',text:'reference'},loadTargets:async()=>({ok:true,sessionKey:'session',projectPath:'/same',mode:'online',targets:current,frontmostTargetId:current.length===1?current[0].id:''}),insertDraft:async request=>{inserted.push(request);return result;},launchTarget:async kind=>{launched.push(kind);return{ok:true};}}});
  return{...fixture,inserted,launched,setTargets:value=>current=value,setResult:value=>result=value};
}
const target=(id,kind='code')=>({id,kind,label:kind+' '+id,contextId:'context-'+id,projectPath:'/same',maxLength:200000});
test('連携先: 有効な1件を初期選択、通常更新後の複数候補は明示選択し、表示しただけでは追加しない',async()=>{
  const fixture=dialogFixture([target('one')]);
  try{await fixture.mount();assert.equal(fixture.state.selected.value,'one');assert.equal(fixture.inserted.length,0);
    fixture.setTargets([target('two'),target('three'),target('live','live')]);await fixture.state.refresh();assert.equal(fixture.state.selected.value,'');await fixture.state.insert();assert.equal(fixture.inserted.length,0);
    fixture.state.selected.value='three';await fixture.state.insert();assert.equal(fixture.inserted[0].targetId,'three');assert.equal(fixture.inserted[0].contextId,'context-three');assert.deepEqual(fixture.emitted,[['close']]);
  }finally{fixture.dispose();}
});
test('連携先: ゼロ件の起動は明示操作のみ、閉じた対象の失敗は下書き追加を完了扱いにしない',async()=>{
  const fixture=dialogFixture([]);
  try{await fixture.mount();assert.deepEqual(fixture.launched,[]);await fixture.state.launch('code');assert.deepEqual(fixture.launched,['code']);assert.deepEqual(fixture.inserted,[]);
    fixture.setTargets([target('closed')]);await fixture.state.refresh();fixture.setResult({ok:false,error:'連携先が閉じられました'});await fixture.state.insert();assert.match(fixture.state.error.value,/閉じられ/);assert.equal(fixture.emitted.length,0);
  }finally{fixture.dispose();}
});

test('Explorer変更: 配下の別窓を閉じ、選択中ファイルを名前変更後のパスで開き直す',async()=>{
 const f=component('SpaceView',{props:{startedAt:1,viewMode:'3d'},globals:{document:new EventTarget()}}),calls=[];
 try{
  f.state.scan.value={root:'/project'};
  f.state.ready({marks(){},route(){},refresh:async()=>true,clear(){f.state.selected.value=null;},goTo:async file=>calls.push(file)});
  f.state.selected.value={path:'docs/one.txt',name:'one.txt'};await flush();
  f.state.viewerSessions.value.push({file:{path:'docs/two.txt'},detached:true},{file:{path:'other.txt'},detached:true});
  await f.state.applyFileChange({action:'rename',previousPath:'docs',path:'renamed',name:'renamed',type:'directory'});
  assert.deepEqual(calls.map(file=>file.path),['renamed/one.txt']);assert.equal(f.state.viewerSessions.value.length,1);assert.equal(f.state.viewerSessions.value[0].file.path,'other.txt');
 }finally{f.dispose();}
});
test('Explorer変更: 更新中の新しい操作・利用セッション切替後に古い選択へ戻さない',async()=>{
 for(const change of ['navigation','session']){
  const f=component('SpaceView',{props:{startedAt:1,viewMode:'3d'},globals:{document:new EventTarget()}}),calls=[];let finish,wait=false;
  try{
   f.state.scan.value={root:'/project'};
   f.state.ready({marks(){},route(){},refresh:()=>wait?new Promise(done=>{finish=done;}):Promise.resolve(true),clear(){f.state.selected.value=null;},goTo:async file=>calls.push(file)});
   f.state.selected.value={path:'docs/one.txt',name:'one.txt'};await flush();wait=true;
   const result=f.state.applyFileChange({action:'rename',previousPath:'docs',path:'renamed',name:'renamed',type:'directory'});
   if(change==='navigation')f.state.navigationActivity();else f.props.startedAt=2;
   wait=false;finish(true);await result;await flush();assert.deepEqual(calls,[]);
  }finally{f.dispose();}
 }
});


test('外部Explorer時の左寄せ軌跡: 縦表示のビューア中心は軌跡一覧の右側、通常配置とVRは維持', () => {
  for (const [width, height] of [[768, 1000], [1280, 800]]) {
    const f = component('SpaceView', { props: { startedAt: 1, viewMode: '3d', allDisplays: false }, globals: { innerWidth: width, innerHeight: height, document: new EventTarget() } });
    let list = null, routesLeft = false;
    f.state.root.value = { style: { setProperty() {} }, querySelector: selector => selector === '.explorer-routes.explorer-detached' ? (routesLeft ? {} : null) : selector === '.route-file-list' && list ? { getBoundingClientRect: () => list } : null };
    try {
      for (let cycle = 0; cycle < 2; cycle++) {
        f.state.explorerDetached.value = true; routesLeft = true;
        list = { left: 16, right: 376 };
        const right = height >= width ? width - 16 : width * .67 - 24;
        assert.equal(f.state.layout({ preview: true }).centerX, (384 + right) / 2);
        if (height >= width) assert.equal(f.state.layout({ preview: false }).centerX, width / 2, 'ビューアなしは画面中央を維持');
        list = null;
        assert.equal(f.state.layout({ preview: true }).centerX, (16 + right) / 2, '軌跡一覧を閉じた余白を解放');
        routesLeft = false;
        list = { left: width - 376, right: width - 16 };
        if (height >= width) assert.equal(f.state.layout({ preview: true }).centerX, (16 + list.left - 8) / 2, 'VR準備中はExplorerが外部化済みでも軌跡の実配置は右側');
        f.state.explorerDetached.value = false;
        if (height >= width) assert.equal(f.state.layout({ preview: true }).centerX, (16 + list.left - 8) / 2, '本体復帰後の縦画面では右側一覧へ戻る');
      }
      f.props.allDisplays = true;
      assert.equal(f.state.layout({ preview: true }).centerX, width / 2, 'VR固定中心は配置から独立');
    } finally { f.dispose(); }
  }
});
