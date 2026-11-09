// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as vue from 'vue';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';
import {transformSync} from 'esbuild';
import * as addresses from '../src/components/ブラウザ/URL表示.js';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(headerOnly=false){
 const mounted=[],unmounted=[],calls=[],listeners={},pending=[];
 const initial={url:'https://example.test/',available:true,capturePath:'',stateRevision:0,navigationRevision:0};
 const {descriptor}=parse(readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8'));
 const script=compileScript(descriptor,{id:'capture-ui',genDefaultAs:'component'}),template=compileTemplate({source:descriptor.template.content,filename:'Browser.vue',id:'capture-ui',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
 const api={onBrowserChanged:fn=>{listeners.changed=fn;return()=>delete listeners.changed;},browserAction:async(name,value)=>{calls.push({name,value});if(name==='capture'){const request=deferred();pending.push(request);return request.promise;}return{ok:true,...initial};}};
 const module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{module,console,window:{aidiyWindow:api},document:{documentElement:{classList:{add(){},remove(){}}}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},require:id=>id==='./ブラウザ解析状態.js'?{browserAnalysisPageKey:value=>value,createBrowserAnalysisStatus:()=>({setPage(){},refresh(){},dispose(){}})}:id==='./URL表示.js'?addresses:id==='vue'?{...vue,withDirectives:node=>node,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:{}});
 const props={standalone:true,headerOnly},state=module.exports.setup(props,{expose(){}});for(const fn of mounted)fn();
 const tools=()=>nodes(module.exports.render({},[],props,vue.proxyRefs(state),{},{})).find(n=>n.children?.['connection-tools']).children['connection-tools']();
 return{state,calls,pending,tools,changed:value=>listeners.changed({...initial,...value}),status:()=>nodes({children:tools()}).find(n=>n.props?.class==='browser-capture-status'),dispose:()=>unmounted.forEach(fn=>fn())};
}
function nodes(node,found=[]){if(!node||typeof node!=='object')return found;found.push(node);if(Array.isArray(node.children))for(const child of node.children)nodes(child,found);return found;}
for(const headerOnly of [false,true]){
 test(`Browser撮影UI: ${headerOnly?'F11ヘッダー':'通常窓'}は保存成功後だけ撮影ボタンのすぐ横に表示する`,async t=>{
  const f=fixture(headerOnly);t.after(()=>f.dispose());await flush();assert.equal(f.status(),undefined);
  const saving=f.state.capture();await f.state.capture();assert.equal(f.pending.length,1,'連打で二重撮影しない');assert.equal(f.state.capturing.value,true);assert.equal(f.status(),undefined);
  f.changed({capturePath:'temp/input/first.png'});assert.equal(f.status(),undefined,'mainの保存通知が操作応答より先に届いても撮影中は隠す');
  f.pending[0].resolve({ok:true,path:'temp/input/first.png',message:'temp/input/first.png に保存しました。'});await saving;
  assert.equal(f.state.capturing.value,false);const tools=f.tools(),group=tools.find(n=>n.props?.class==='browser-capture-tools');
  assert.equal(group.children[0].props.class,'browser-capture');
  assert.equal(group.children[1].props.class,'browser-capture-status');assert.equal(group.children[1].children,'保存済み');assert.equal(group.children[1].props.role,'status');assert.match(group.children[1].props.title,/first.png/);
  assert.equal(tools[tools.indexOf(group)+1]?.props?.class,'browser-handoff','撮影と保存済みの後にCode / Liveへを置く');
  f.changed({capturePath:'temp/input/first.png',fullscreen:!headerOnly});assert.ok(f.status(),'通常/F11切替で保存済みを維持する');
 });
 test(`Browser撮影UI: ${headerOnly?'F11ヘッダー':'通常窓'}は失敗・不完全応答・再撮影中に古い保存済みを表示しない`,async t=>{
  const f=fixture(headerOnly);t.after(()=>f.dispose());await flush();f.changed({capturePath:'temp/input/previous.png'});assert.ok(f.status());
  for(const response of [{ok:false,error:'ディスクに保存できません。'},{ok:true,message:'撮影しました。'},new Error('IPC切断')]){
   const saving=f.state.capture();assert.equal(f.status(),undefined);f.changed({capturePath:'temp/input/previous.png',loading:true});assert.equal(f.status(),undefined);
   if(response instanceof Error)f.pending.at(-1).reject(response);else f.pending.at(-1).resolve(response);await saving;
   assert.equal(f.state.capturing.value,false);assert.equal(f.status(),undefined);assert.ok(f.state.error.value);
   f.changed({capturePath:'temp/input/previous.png',loading:false});assert.equal(f.status(),undefined,'無関係な状態通知で前回の成功を復活させない');
  }
  const retry=f.state.capture();f.pending.at(-1).resolve({ok:true,path:'temp/input/retry.png'});await retry;assert.equal(f.status().props.title,'temp/input/retry.png');assert.equal(f.state.error.value,'');
  f.changed({capturePath:'temp/input/retry.png'});assert.ok(f.status());f.changed({capturePath:''});assert.equal(f.status(),undefined,'mainが保存情報を破棄したら消す');
 });
 test(`Browser撮影UI: ${headerOnly?'F11ヘッダー':'通常窓'}は移動・戻る・進む・クエリ・ハッシュ変更で保存表示を消す`,async t=>{
  const f=fixture(headerOnly);t.after(()=>f.dispose());await flush();
  for(const url of ['https://example.test/next','https://example.test/','https://example.test/next','https://example.test/next?item=2','https://example.test/next?item=2#detail']){
   const saving=f.state.capture();f.pending.at(-1).resolve({ok:true,path:'temp/input/before.png'});await saving;assert.ok(f.status());
   f.changed({url,capturePath:'temp/input/before.png'});assert.equal(f.status(),undefined,'古いパスが通知に残っていてもページ移動で消す');
   f.changed({url,capturePath:'temp/input/before.png',fullscreen:!headerOnly});assert.equal(f.status(),undefined,'F11切替で復活しない');
  }
  const retry=f.state.capture();f.pending.at(-1).resolve({ok:true,path:'temp/input/new-page.png'});await retry;assert.ok(f.status(),'移動先の再撮影は表示する');
 });
 for(const response of ['success','failure','rejection'])test(`Browser撮影UI: ${headerOnly?'F11ヘッダー':'通常窓'}は移動して戻った後の遅い${response}を無視する`,async t=>{
  const f=fixture(headerOnly);t.after(()=>f.dispose());await flush();const saving=f.state.capture();
  f.changed({url:'https://example.test/next',navigationRevision:1});f.changed({navigationRevision:2});
  f.state.error.value='現在のページのエラー';
  if(response==='rejection')f.pending[0].reject(Error('古い撮影エラー'));else f.pending[0].resolve(response==='success'?{ok:true,path:'temp/input/stale.png'}:{ok:false,error:'古い撮影エラー'});
  await saving;assert.equal(f.status(),undefined);assert.equal(f.state.error.value,'現在のページのエラー');assert.equal(f.state.capturing.value,false);
 });
 test(`Browser撮影UI: ${headerOnly?'F11ヘッダー':'通常窓'}はURL確定前の遷移通知でもリセットする`,async t=>{
  const f=fixture(headerOnly);t.after(()=>f.dispose());await flush();f.changed({capturePath:'temp/input/before.png',navigationRevision:0});
  const saving=f.state.capture();f.pending[0].resolve({ok:true,path:'temp/input/before.png'});await saving;assert.ok(f.status());
  f.changed({navigationRevision:1});assert.equal(f.status(),undefined);
 });
 test(`Browser撮影UI: ${headerOnly?'F11ヘッダー':'通常窓'}の初回状態で現在ページの保存を復元する`,async t=>{
  const f=fixture(headerOnly);t.after(()=>f.dispose());f.changed({capturePath:'temp/input/current.png',stateRevision:2,navigationRevision:3});await flush();assert.ok(f.status());
  f.changed({stateRevision:1,navigationRevision:2});assert.ok(f.status(),'古い状態応答を無視する');
 });

}
test('Browser撮影UI: 破棄後の撮影応答で成功表示を変更しない',async()=>{
 const f=fixture();await flush();const saving=f.state.capture();f.dispose();f.pending[0].resolve({ok:true,path:'temp/input/late.png'});await saving;assert.equal(f.state.captureMessage.value,'');assert.equal(f.state.error.value,'');assert.equal(f.pending.length,1);await f.state.capture();assert.equal(f.pending.length,1);
});
