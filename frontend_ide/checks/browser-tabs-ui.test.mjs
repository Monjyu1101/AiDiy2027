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
import * as addressTools from '../src/components/ブラウザ/URL表示.js';
import {browserAnalysisPageKey} from '../src/components/ブラウザ/ブラウザ解析状態.js';
const require=createRequire(import.meta.url),vue=require('vue');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const source=readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8');
function fixture(headerOnly=false){
 const mounted=[],unmounted=[],pending=[],monitors=[];let listener;
 const {descriptor}=parse(source),script=compileScript(descriptor,{id:'browser',genDefaultAs:'component'});
 const template=compileTemplate({source:descriptor.template.content,filename:'Browser.vue',id:'browser',compilerOptions:{bindingMetadata:script.bindings}});
 assert.deepEqual(template.errors,[]);const module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{
  module,console,requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},document:{documentElement:{classList:{add(){},remove(){}}}},
  window:{aidiyWindow:{onBrowserChanged(fn){listener=fn;return()=>{};},browserAction(name,value){return new Promise(resolve=>pending.push({name,value,resolve}));}}},
  require:id=>id==='./ブラウザ解析状態.js'?{browserAnalysisPageKey,createBrowserAnalysisStatus:()=>({setPage:(...args)=>monitors.push(args),refresh(){},dispose(){}})}:id==='./URL表示.js'?addressTools:id==='vue'?{...vue,withDirectives:node=>node,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:{},
 });
 const props={standalone:true,headerOnly},state=module.exports.setup(props,{expose(){}});mounted.forEach(fn=>fn());
 return{state,pending,monitors,notify:value=>listener(value),render:()=>module.exports.render({},[],props,vue.proxyRefs(state),{},{}),close:()=>unmounted.forEach(fn=>fn())};
}
const tabs=[{id:'a',url:'https://example.test/',title:'ページA'},{id:'b',url:'https://example.test/',title:'ページB',loading:true}];
const snapshot=(stateRevision,activeTabId='a',extra={})=>({ok:true,stateRevision,activeTabId,tabs,url:'https://example.test/',title:activeTabId,session:'test',navigationRevision:stateRevision,available:true,connected:true,headerVisible:true,...extra});
function nodes(vnode){if(Array.isArray(vnode))return vnode.flatMap(nodes);if(!vnode||typeof vnode!=='object')return[];return[vnode,...nodes(vnode.children)];}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
for(const header of [false,true])test(`Browser tabs ${header?'fullscreen header':'normal'} render selected tab, close and new controls`,()=>{
 const f=fixture(header);try{f.notify(snapshot(2));const all=nodes(f.render()),tabButtons=all.filter(v=>v.props?.role==='tab');assert.equal(tabButtons.length,2);assert.equal(tabButtons[0].props['aria-selected'],true);assert.equal(tabButtons[0].props.tabindex,0);assert.equal(tabButtons[1].props.tabindex,-1);assert.equal(all.filter(v=>v.props?.['aria-label']?.endsWith('のタブを閉じる')).length,2);assert.ok(all.some(v=>v.props?.['aria-label']==='新しいタブ'));}finally{f.close();}
});
test('same URL tab switch isolates address edit and discards stale capture result, analysis monitor is tab-specific',async()=>{
 const f=fixture();try{
  f.notify(snapshot(2));f.state.focusAddress();f.state.address.value='old unfinished address';f.state.error.value='old error';
  const capture=f.state.capture(),job=f.pending.at(-1);f.notify(snapshot(3,'b'));
  assert.equal(f.state.address.value,'https://example.test/');assert.equal(f.state.error.value,'');
  assert.notEqual(f.monitors.at(-2)[2],f.monitors.at(-1)[2]);
  job.resolve({ok:true,path:'old.png'});await capture;assert.equal(f.state.captureMessage.value,'');
  const navigation=f.state.action('navigate','old');const old=f.pending.at(-1);f.notify(snapshot(4,'a'));old.resolve({ok:false,error:'old navigation error'});await navigation;assert.equal(f.state.error.value,'');
  f.notify(snapshot(3,'b'));assert.equal(f.state.page.value.activeTabId,'a','old snapshot cannot restore old tab');
 }finally{f.close();}
});
test('keyboard tab navigation and close use tab IDs and focus selected tab after response',async()=>{
 const f=fixture();try{f.notify(snapshot(2));let focused=0,prevented=0;f.state.tabList.value={querySelector:()=>({focus(){focused++;}})};
  for(const [key,id] of [['ArrowRight','b'],['ArrowLeft','b'],['Home','a'],['End','b']]){
   f.state.tabKeydown({key,preventDefault(){prevented++;}},'a');const job=f.pending.at(-1);assert.equal(job.name,'tab-select');assert.equal(job.value,id);job.resolve(snapshot(3+prevented,id));await flush();
  }
  f.state.tabKeydown({key:'Delete',preventDefault(){prevented++;}},'b');const job=f.pending.at(-1);assert.equal(job.name,'tab-close');assert.equal(job.value,'b');job.resolve(snapshot(10,'a',{tabs:[tabs[0]]}));await flush();assert.equal(focused,5);
  let addressFocused=false;f.state.addressInput.value={focus(){addressFocused=true;}};const create=f.state.tabAction('tab-new');f.pending.at(-1).resolve(snapshot(11,'c'));await create;assert.equal(addressFocused,true);
 }finally{f.close();}
});
test('tabs are disabled before use and async selection after unmount does not focus',async()=>{
 const f=fixture();f.notify(snapshot(2,'a',{available:false}));const count=f.pending.length;await f.state.tabAction('tab-new');assert.equal(f.pending.length,count);assert.ok(nodes(f.render()).filter(v=>v.props?.role==='tab').every(v=>v.props.disabled));
 f.notify(snapshot(3));let focused=false;f.state.addressInput.value={focus(){focused=true;}};const job=f.state.tabAction('tab-new'),pending=f.pending.at(-1);f.close();pending.resolve(snapshot(4,'b'));await job;assert.equal(focused,false);
});

test('unfinished addresses restore per tab, including empty draft; close and session changes clean drafts',()=>{
 const f=fixture();try{
  f.notify(snapshot(2));f.state.focusAddress();f.state.address.value='draft A';f.state.blurAddress();
  f.notify(snapshot(3,'b'));f.state.focusAddress();f.state.address.value='';f.state.blurAddress();
  f.notify(snapshot(4,'a'));assert.equal(f.state.address.value,'draft A');
  f.notify(snapshot(5,'b'));assert.equal(f.state.address.value,'');
  f.notify(snapshot(6,'b',{tabs:[tabs[1]]}));f.notify(snapshot(7,'a'));assert.equal(f.state.address.value,'https://example.test/','closed draft removed');
  f.notify(snapshot(8,'b',{session:'new session'}));assert.equal(f.state.address.value,'https://example.test/','session resets drafts');
 }finally{f.close();}
});
test('navigation retains failed drafts and clears successful draft even when its tab is inactive',async()=>{
 const f=fixture();try{
  f.notify(snapshot(2));f.state.address.value='draft A';f.state.navigate();let job=f.pending.at(-1);
  job.resolve({ok:false,error:'cannot navigate'});await flush();f.notify(snapshot(3));assert.equal(f.state.address.value,'draft A');
  f.state.navigate();job=f.pending.at(-1);f.notify(snapshot(4,'b'));job.resolve(snapshot(5,'a'));await flush();
  assert.equal(f.state.page.value.activeTabId,'b');f.notify(snapshot(6,'a'));assert.equal(f.state.address.value,'https://example.test/');
  f.state.address.value='next';f.state.navigate();job=f.pending.at(-1);job.resolve(snapshot(7,'a',{url:'https://next.test/'}));await flush();assert.equal(f.state.address.value,'https://next.test/');
 }finally{f.close();}
});
