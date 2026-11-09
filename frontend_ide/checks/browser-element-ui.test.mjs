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
import * as analysisStatus from '../src/components/ブラウザ/ブラウザ解析状態.js';
import * as addresses from '../src/components/ブラウザ/URL表示.js';
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const request={projectPath:'/project',path:'https://example.test/',text:'session: s\ntab_id: t\n選択要素',selection:true,browserElementId:'selected-id'};
function fixture(headerOnly=false,response){
 const mounted=[],unmounted=[],calls=[],sent=[],listeners={};
 const {descriptor}=parse(readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8'));
 const script=compileScript(descriptor,{id:'element-ui',genDefaultAs:'component'}),template=compileTemplate({source:descriptor.template.content,filename:'Browser.vue',id:'element-ui',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
 const api={onBrowserChanged:fn=>{listeners.changed=fn;return()=>delete listeners.changed;},onBrowserElementSelected:fn=>{listeners.selected=fn;return()=>delete listeners.selected;},browserAction:async(name,value)=>{calls.push({name,value});if(response&&name==='open-draft')return response();return ['draft','element-draft'].includes(name)?{ok:true,request:name==='element-draft'?request:{...request,browserElementId:undefined,selection:false}}:{ok:true,url:request.path,available:true};},insertDraft:async value=>{sent.push(value);return{ok:true};}};
 const module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{module,console,window:{aidiyWindow:api},document:{documentElement:{classList:{add(){},remove(){}}}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},require:id=>id==='./ブラウザ解析状態.js'?{...analysisStatus,createBrowserAnalysisStatus:()=>({setPage(){},refresh(){},dispose(){}})}:id==='./URL表示.js'?addresses:id==='vue'?{...vue,withDirectives:node=>node,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:{}});
 const props={standalone:true,headerOnly},state=module.exports.setup(props,{expose(){}});for(const fn of mounted)fn();
 return{state,calls,sent,listeners,render:()=>module.exports.render({},[],props,vue.proxyRefs(state),{},{}),dispose:()=>unmounted.forEach(fn=>fn())};
}
test('要素連携UI: 通常・選択要素ともnative子窓を依頼し、ページを隠さず自動送信しない',async()=>{
 const f=fixture();await flush();f.listeners.selected();await flush();assert.equal(f.sent.length,0);
 assert.ok(f.calls.some(call=>call.name==='open-draft'&&call.value===true));assert.ok(!f.calls.some(call=>call.name==='draft-dialog'));
 await f.state.handoff({type:'click'});assert.equal(f.calls.at(-1).name,'open-draft');assert.equal(f.calls.at(-1).value,false,'通常ボタンのMouseEventを要素モードとして扱わない');
 f.dispose();assert.equal(f.listeners.selected,undefined);
});
test('要素連携UI: F11ヘッダーは本体へ下書きを依頼し、要素連携を共通mainへ渡す',async()=>{
 const f=fixture(true);await flush();assert.equal(f.listeners.selected,undefined);await f.state.action('element-toggle');assert.equal(f.calls.at(-1).name,'element-toggle');await f.state.handoff();assert.equal(f.calls.at(-1).name,'open-draft');f.dispose();
});
test('要素連携UI: 下書きダイアログは内容をtext補間で確認し、通常連携に追加しない',()=>{
 const source=readFileSync(new URL('../src/dialog/下書き連携ダイアログ.vue',import.meta.url),'utf8'),{descriptor}=parse(source);const compiled=compileTemplate({source:descriptor.template.content,filename:'Draft.vue',id:'draft-element-ui'});assert.deepEqual(compiled.errors,[]);
 assert.match(source,/v-if="request.browserElementId"/);assert.match(source,/<pre>{{request.text}}<\/pre>/);assert.ok(!source.includes('v-html'));assert.match(source,/既存の下書きを残し、送信はその画面で行います/);
});

function windowFixture(response=async()=>({ok:true,request})){
 const mounted=[],unmounted=[],calls=[],inserted=[],module={exports:{}};
 const {descriptor}=parse(readFileSync(new URL('../src/components/ブラウザ/ブラウザ下書きウィンドウ.vue',import.meta.url),'utf8'));
 const script=compileScript(descriptor,{id:'draft-window-ui',genDefaultAs:'component'}),template=compileTemplate({source:descriptor.template.content,filename:'DraftWindow.vue',id:'draft-window-ui',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
 const api={browserAction:async(name,value)=>{calls.push({name,value});return response(name);},draftTargets:async()=>({ok:true,targets:[]}),insertDraft:async value=>{inserted.push(value);return{ok:true};}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{module,window:{aidiyWindow:api},require:id=>id==='vue'?{...vue,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:{}});
 const state=module.exports.setup({}, {expose(){}});for(const fn of mounted)fn();
 return{state,calls,inserted,render:()=>module.exports.render({},[],{},vue.proxyRefs(state),{},{}),dispose:()=>unmounted.forEach(fn=>fn())};
}
test('Browser連携子窓UI: 確定文脈を取得し共通dialogを再利用、連携は明示操作だけ、取消は子窓だけ',async()=>{
 const f=windowFixture();await flush();assert.equal(f.state.request.value.browserElementId,request.browserElementId);assert.equal(f.render().props['native-window'],'');assert.equal(f.inserted.length,0);
 assert.equal((await f.state.loadTargets()).ok,true);await f.state.insertDraft({targetId:'live',text:request.text});assert.equal(f.inserted.length,1);await f.state.close();assert.equal(f.calls.at(-1).name,'draft-window-close');f.dispose();
});
test('Browser連携子窓UI: 取得失敗を表示し、閉鎖後の遅い応答は使わない',async()=>{
 const failed=windowFixture(async()=>({ok:false,error:'選択が無効'}));await flush();assert.equal(failed.state.error.value,'選択が無効');assert.equal(failed.state.request.value,null);await failed.state.close();assert.equal(failed.calls.at(-1).name,'draft-window-close');failed.dispose();
 let resolve;const late=windowFixture(()=>new Promise(done=>{resolve=done;}));late.dispose();resolve({ok:true,request});await flush();assert.equal(late.state.request.value,null);
});

test('Browser連携UI: 連打を抑止し、ページ変更後・破棄後の古い応答は反映しない',async()=>{
 for(const dispose of [false,true]){
  let resolve;const f=fixture(false,()=>new Promise(done=>{resolve=done;}));await flush();const opening=f.state.handoff();await f.state.handoff();assert.equal(f.calls.filter(call=>call.name==='open-draft').length,1);
  if(dispose)f.dispose();else f.listeners.changed({url:'https://example.test/other',available:true});f.state.error.value='新しいページの通知';resolve({ok:false,error:'古い失敗'});await opening;assert.equal(f.state.error.value,'新しいページの通知');if(!dispose)f.dispose();
 }
});
