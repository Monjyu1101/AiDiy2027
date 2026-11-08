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
function fixture(headerOnly=false){
 const mounted=[],unmounted=[],calls=[],sent=[],listeners={};
 const {descriptor}=parse(readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8'));
 const script=compileScript(descriptor,{id:'element-ui',genDefaultAs:'component'}),template=compileTemplate({source:descriptor.template.content,filename:'Browser.vue',id:'element-ui',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
 const api={onBrowserChanged:fn=>{listeners.changed=fn;return()=>delete listeners.changed;},onBrowserElementSelected:fn=>{listeners.selected=fn;return()=>delete listeners.selected;},browserAction:async(name,value)=>{calls.push({name,value});return ['draft','element-draft'].includes(name)?{ok:true,request:name==='element-draft'?request:{...request,browserElementId:undefined,selection:false}}:{ok:true,url:request.path,available:true};},insertDraft:async value=>{sent.push(value);return{ok:true};}};
 const module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{module,console,window:{aidiyWindow:api},document:{documentElement:{classList:{add(){},remove(){}}}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},require:id=>id==='./ブラウザ解析状態.js'?{...analysisStatus,createBrowserAnalysisStatus:()=>({setPage(){},refresh(){},dispose(){}})}:id==='./URL表示.js'?addresses:id==='vue'?{...vue,withDirectives:node=>node,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:{}});
 const props={standalone:true,headerOnly},state=module.exports.setup(props,{expose(){}});for(const fn of mounted)fn();
 return{state,calls,sent,listeners,render:()=>module.exports.render({},[],props,vue.proxyRefs(state),{},{}),dispose:()=>unmounted.forEach(fn=>fn())};
}
test('要素連携UI: 選択通知でmainの確定内容を取得し、選択IDを下書き追加へ渡す',async()=>{
 const f=fixture();await flush();f.listeners.selected();await flush();assert.equal(f.state.draftRequest.value.browserElementId,'selected-id');assert.equal(f.sent.length,0,'選択時点でAIや連携先へ自動送信しない');
 assert.ok(f.calls.some(call=>call.name==='draft-dialog'&&call.value===true));
 await f.state.insertDraft({targetId:'live',text:'renderer text'});assert.equal(f.sent[0].browserElementId,'selected-id');assert.equal(f.sent[0].targetId,'live');
 f.state.closeDraft();await flush();assert.equal(f.state.draftRequest.value,null);assert.ok(f.calls.some(call=>call.name==='element-stop'));assert.equal(f.calls.at(-1).value,false);
 await f.state.handoff({type:'click'});assert.equal(f.calls.at(-2).name,'draft','通常ボタンのMouseEventを要素モードとして扱わない');await f.state.insertDraft({targetId:'code',text:'normal'});assert.equal(f.sent[1].browserElementId,undefined);f.dispose();assert.equal(f.listeners.selected,undefined);
});
test('要素連携UI: F11ヘッダーは本体へ下書きを依頼し、要素連携を共通mainへ渡す',async()=>{
 const f=fixture(true);await flush();assert.equal(f.listeners.selected,undefined);await f.state.action('element-toggle');assert.equal(f.calls.at(-1).name,'element-toggle');await f.state.handoff();assert.equal(f.calls.at(-1).name,'open-draft');f.dispose();
});
test('要素連携UI: 下書きダイアログは内容をtext補間で確認し、通常連携に追加しない',()=>{
 const source=readFileSync(new URL('../src/dialog/下書き連携ダイアログ.vue',import.meta.url),'utf8'),{descriptor}=parse(source);const compiled=compileTemplate({source:descriptor.template.content,filename:'Draft.vue',id:'draft-element-ui'});assert.deepEqual(compiled.errors,[]);
 assert.match(source,/v-if="request.browserElementId"/);assert.match(source,/<pre>{{request.text}}<\/pre>/);assert.ok(!source.includes('v-html'));assert.match(source,/既存の下書きを残し、送信はその画面で行います/);
});
