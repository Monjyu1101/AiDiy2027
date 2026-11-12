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

test('＋は最終タブ直後、溢れる場合はタブ列だけスクロールする',()=>{
 for(const header of [false,true]){
  const f=fixture(header);try{f.notify(snapshot(2));const row=nodes(f.render()).find(v=>v.props?.class==='browser-tabs-row');
   const children=row.children.filter(v=>typeof v.type==='string');assert.equal(children.length,2);assert.equal(children[0].props.role,'tablist');assert.equal(children[1].props['aria-label'],'新しいタブ');
  }finally{f.close();}
 }
 assert.match(source,/\.browser-tabs\{[^}]*flex:0 1 auto;[^}]*width:max-content;[^}]*min-width:0;[^}]*overflow-x:auto/);
 assert.match(source,/\.browser-tab\{[^}]*flex:none;[^}]*width:180px/);
 assert.match(source,/\.browser-tab-close,\.browser-tab-new\{[^}]*flex:none/);
});

test('タブ・＋を従来の約70%の22px高に揃え、×の横ヒット領域を保つ',()=>{
 assert.match(source,/\.browser-tab\{[^}]*height:22px;[^}]*box-sizing:border-box/);
 assert.match(source,/\.browser-tab-select\{[^}]*padding:0 8px;line-height:20px/);
 assert.match(source,/\.browser-tab-close,\.browser-tab-new\{[^}]*min-width:26px/);
 assert.match(source,/\.browser-tab-new\{height:22px\}/);
});

test('Browser接続マークは共通状態バーと同じ寸法・配色を使い、操作不可の説明は表示しない',()=>{
 const common=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 assert.ok(!source.includes(':deep(.connection-label>i)'));assert.ok(!source.includes(':deep(.connection-label>i.online)'));
 assert.match(common,/\.connection-label i\{[^}]*width:5px;height:5px;[^}]*background:#667080/);
 assert.ok(!source.includes('MCP制御不可'));assert.ok(!source.includes('AI解析不可'));
});


for(const header of [false,true])test(`tab hover/focus provides copyable metadata overlay only: header=${header}`,()=>{
 const f=fixture(header);try{
  f.notify(snapshot(2));assert.equal(f.state.connectionTarget.value,'');
  f.state.infoTabId.value='b';let input=nodes(f.render()).find(v=>v.props?.class==='browser-connection-target');
  assert.equal(input.props.value,'session="test" ,tab_id="b", title="ページB"');assert.equal(input.props.readonly,'');
  let selected=false;input.props.onFocus({target:{select(){selected=true;}}});assert.equal(selected,true);
  f.state.navigationLeave();assert.equal(f.state.connectionTarget.value,'','mouse departure closes even with input focus');
  f.state.navigationKeydown({key:'Tab'});f.state.tabInfoFocus('a');assert.ok(f.state.connectionTarget.value);
  f.state.navigationLeave();assert.ok(f.state.connectionTarget.value,'keyboard focus survives mouse absence');
  f.state.navigationKeydown({key:'Escape'});assert.equal(f.state.connectionTarget.value,'');
  f.state.tabInfoFocus('a');f.notify(snapshot(3,'b'));assert.equal(f.state.connectionTarget.value,'','tab switch closes');
  f.state.tabInfoFocus('b');f.state.navigationBlur({currentTarget:{contains:()=>true},relatedTarget:{}});assert.ok(f.state.connectionTarget.value,'movement to overlay retains');
  f.state.navigationBlur({currentTarget:{contains:()=>false},relatedTarget:{}});assert.equal(f.state.connectionTarget.value,'');
  f.state.infoTabId.value='b';f.notify(snapshot(4,'b',{tabs:[tabs[0]]}));assert.equal(f.state.connectionTarget.value,'','closed tab clears');
  f.notify(snapshot(5,'b',{pageLoadFailed:true,error:'page failed'}));assert.ok(!nodes(f.render()).some(v=>v.props?.class==='browser-operation-error'));
  f.state.error.value='operation failed';assert.ok(nodes(f.render()).some(v=>v.props?.class==='browser-operation-error'));
 }finally{f.close();}
 assert.ok(!source.includes('browser-page-title'));assert.ok(!source.includes('browser-connection-reveal'));assert.ok(!source.includes('focus-within'));
 assert.match(source,/\.browser-tab-info,\.browser-operation-error\{position:absolute;bottom:0/);
});

for(const header of [false,true])test(`hidden and fullscreen transitions discard metadata overlay: header=${header}`,()=>{
 const f=fixture(header);try{
  f.notify(snapshot(2));f.state.navigationKeydown({key:'Tab'});f.state.tabInfoFocus('a');
  f.state.setPanelHidden(true);assert.equal(f.state.connectionTarget.value,'');
  f.state.setPanelHidden(false);assert.equal(f.state.connectionTarget.value,'','expand does not restore old overlay');
  f.state.tabInfoFocus('a');assert.ok(f.state.connectionTarget.value,'fresh keyboard focus still opens');
  f.notify(snapshot(3,'a',{fullscreen:true}));assert.equal(f.state.connectionTarget.value,'');
  f.state.tabInfoFocus('a');f.notify(snapshot(4,'a',{fullscreen:false}));assert.equal(f.state.connectionTarget.value,'','both fullscreen transitions close');
  if(header){
   f.state.tabInfoFocus('a');f.notify(snapshot(5,'a',{headerVisible:false}));assert.equal(f.state.connectionTarget.value,'');
   f.notify(snapshot(6,'a',{headerVisible:true}));assert.equal(f.state.connectionTarget.value,'','header reappearance does not restore old overlay');
   f.state.tabInfoFocus('a');assert.ok(f.state.connectionTarget.value);
  }
 }finally{f.close();}
});
