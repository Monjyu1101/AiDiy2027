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
import * as analysisTools from '../src/components/ブラウザ/ブラウザ解析状態.js';
import * as addresses from '../src/components/ブラウザ/URL表示.js';
const require=createRequire(import.meta.url),vue=require('vue');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const context={url:'https://example.test/page',title:'入力画面',baseName:'project',projectPath:'/tmp/project',canSelectSource:true};
const saved={id:'result-1',createdAt:12345,summary:'# 概要\n入力フォーム\n<script>alert(1)</script>',files:[{role:'html',path:'server/src/html/xxx.html',summary:'入力フォーム'}]};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(type='dialog',props={context},options={}){
 const mounted=[],unmounted=[],emitted=[],requests=[],calls=[],timers=new Map(),listeners={};let next=1;
 const file=type==='dialog'?'../src/dialog/ブラウザ解析ダイアログ.vue':'../src/components/ブラウザ/ブラウザパネル.vue';
 const {descriptor}=parse(readFileSync(new URL(file,import.meta.url),'utf8'));
 const script=compileScript(descriptor,{id:'analysis-ui',genDefaultAs:'component'}),template=compileTemplate({source:descriptor.template.content,filename:file,id:'analysis-ui',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
 const api={browserAction:async(name,value)=>{calls.push({name,value});if(options.action)return options.action(name,value);return name==='analysis-context'?{ok:true,context}:{ok:true,url:context.url,available:true};},onBrowserChanged:fn=>{listeners.changed=fn;return()=>delete listeners.changed;},onBrowserOpenAnalysis:fn=>{listeners.analysis=fn;return()=>delete listeners.analysis;}};
 const module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{module,console,URLSearchParams,AbortController,AbortSignal,Date,
  fetch:(url,init)=>{const pending=deferred();requests.push({url,init,...pending});return pending.promise;},setTimeout:fn=>{const id=next++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  window:{aidiyWindow:api},document:{documentElement:{classList:{add(){},remove(){}}}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},
  require:id=>id==='./ブラウザ解析状態.js'?analysisTools:id==='./URL表示.js'?addresses:id==='vue'?{...vue,withDirectives:node=>node,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:{},
 });
 const state=module.exports.setup(props,{expose(){},emit:(...args)=>emitted.push(args)});
 if(type==='dialog')state.dialog.value={showModal(){},close(){}};
 for(const fn of mounted)fn();
 return{state,requests,calls,emitted,timers,listeners,render:()=>module.exports.render({},[],props,vue.proxyRefs(state),{},{}),reply(value,index=requests.length-1,ok=true){requests[index].resolve({ok,json:async()=>value});},dispose:()=>unmounted.forEach(fn=>fn()),tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}};
}
function nodes(node,found=[]){if(!node||typeof node!=='object')return found;found.push(node);if(Array.isArray(node.children))for(const child of node.children)nodes(child,found);return found;}
test('Browser analysis dialog: displays only its URL and structured sources; source click sends precise result identity',async()=>{
 const f=fixture();f.reply({result:saved,job:null});await flush();
 assert.equal(f.state.loading.value,false);assert.equal(f.state.result.value.id,saved.id);assert.equal(f.state.result.value.summary,saved.summary,'legacy summary remains stored, not displayed');
 const rendered=nodes(f.render());assert.deepEqual(rendered.filter(n=>n.type==='h3').map(n=>n.children),['表示中のURL','関連ソース']);assert.equal(rendered.some(n=>n.props?.class==='analysis-result'||n.props?.innerHTML),false);assert.equal(rendered.filter(n=>n.type==='th').length,3);assert.equal(rendered.filter(n=>n.props?.class==='browser-analysis-source').length,1);
 await f.state.selectSource(saved.files[0]);assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))),{name:'analysis-select-source',value:{url:context.url,id:saved.id,path:saved.files[0].path}});f.dispose();
});
test('Browser analysis dialog: fresh request, duplicate suppression, poll completion and preserved result on failure',async()=>{
 const f=fixture();await f.state.analyze();assert.equal(f.requests.length,1,'cannot start while initial load pending');
 f.reply({result:null,job:null});await flush();const start=f.state.analyze();await f.state.analyze();assert.equal(f.requests.length,2);assert.equal(f.requests[1].init.method,'POST');assert.deepEqual(JSON.parse(f.requests[1].init.body),{url:context.url,title:context.title});
 f.reply({id:'job-1',status:'waiting'});await start;assert.equal(f.state.busy.value,true);await f.state.analyze();assert.equal(f.requests.length,2);
 f.tick();f.reply({result:saved,job:{id:'job-1',status:'complete'}});await flush();assert.equal(f.state.result.value.id,saved.id);assert.equal(f.timers.size,0);
 const retry=f.state.analyze();f.reply({error:'tools未接続'},undefined,false);await retry;assert.match(f.state.error.value,/tools未接続/);assert.equal(f.state.result.value.id,saved.id);f.dispose();
});
test('Browser analysis dialog: standalone has plain paths and cannot select sources',async()=>{
 const f=fixture('dialog',{context:{...context,canSelectSource:false}});f.reply({result:saved,job:null});await flush();assert.equal(nodes(f.render()).filter(n=>n.props?.class==='browser-analysis-source').length,0);await f.state.selectSource(saved.files[0]);assert.equal(f.calls.length,0);f.dispose();
});
test('Browser analysis dialog: close and unmount cancel polling and ignore late responses; reopen reloads',async()=>{
 const f=fixture();f.state.close();assert.equal(f.emitted[0][0],'close');assert.equal(f.requests[0].init.signal.aborted,true);f.reply({result:saved,job:{status:'waiting'}});await flush();assert.equal(f.state.result.value,null);assert.equal(f.timers.size,0);f.dispose();
 const reopened=fixture();reopened.reply({result:saved,job:{status:'waiting'}});await flush();assert.equal(reopened.timers.size,1);reopened.tick();reopened.dispose();reopened.reply({result:{...saved,id:'late'},job:{status:'complete'}});await flush();assert.equal(reopened.state.result.value.id,saved.id);assert.equal(reopened.timers.size,0);
});
test('Browser panel: modal hides native page, prevents duplicate opens, closes/restores, forwards header and unsubscribes',async()=>{
 const f=fixture('panel',{});await flush();await Promise.all([f.state.openAnalysis(),f.state.openAnalysis()]);assert.equal(f.calls.filter(c=>c.name==='analysis-context').length,1);assert.ok(f.state.analysisContext.value);assert.ok(f.calls.some(c=>c.name==='analysis-dialog'&&c.value===true));
 f.state.closeAnalysis();assert.equal(f.state.analysisContext.value,null);assert.ok(f.calls.some(c=>c.name==='analysis-dialog'&&c.value===false));await f.state.openAnalysis();f.dispose();assert.equal(f.calls.at(-1).name,'analysis-dialog');assert.equal(f.calls.at(-1).value,false);assert.equal(f.listeners.analysis,undefined);
 const header=fixture('panel',{headerOnly:true});await flush();await header.state.openAnalysis();assert.ok(header.calls.some(c=>c.name==='open-analysis'));assert.equal(header.state.analysisContext.value,null);header.dispose();
});
test('Browser panel: interrupted native modal opening restores page after delayed IPC completion',async()=>{
 const hidden=deferred();const f=fixture('panel',{}, {action:async(name,value)=>name==='analysis-context'?{ok:true,context}:name==='analysis-dialog'&&value===true?hidden.promise:{ok:true}});await flush();const opening=f.state.openAnalysis();await flush();f.dispose();hidden.resolve({ok:true});await opening;assert.equal(f.state.analysisContext.value,null);assert.ok(f.calls.some(c=>c.name==='analysis-dialog'&&c.value===false),'native modal hide must be released after disposal');
});

test('Browser analysis dialog: IDE guidance is shown before results and never enables standalone source clicks',async()=>{
 for(const [running,ready] of [[false,false],[true,false],[true,true]]){
  const f=fixture('dialog',{context:{...context,canSelectSource:false,ideRunning:running,viewerAvailable:ready}});
  f.reply({result:null,job:null});await flush();
  const rendered=nodes(f.render()),hint=rendered.find(n=>n.props?.class==='browser-analysis-hint browser-analysis-viewer-available');
  assert.equal(!!hint,running);if(hint)assert.match(String(hint.children),ready?/IDEの「Browser」から/:/tools接続後/);
  assert.equal(rendered.filter(n=>n.props?.class==='browser-analysis-source').length,0);
  f.state.result.value=saved;await f.state.selectSource(saved.files[0]);assert.equal(f.calls.length,0);f.dispose();
 }
});

test('Browser analysis dialog: background button closes only the view and reopening the original URL restores waiting/result',async t=>{
 const pending=fixture();t.after(()=>pending.dispose());pending.reply({url:context.url,result:null,job:{id:'background',url:context.url,status:'waiting'}});await flush();
 const button=nodes(pending.render()).find(n=>n.props?.class==='browser-analysis-background');assert.ok(button);button.props.onClick();assert.equal(pending.emitted.at(-1)[0],'close');assert.equal(pending.timers.size,0);assert.ok(pending.requests.every(r=>r.init.method==='GET'));
 const other=fixture('dialog',{context:{...context,url:'https://example.test/other'}});t.after(()=>other.dispose());other.reply({url:'https://example.test/other',result:null,job:null});await flush();assert.equal(other.state.busy.value,false);assert.equal(other.state.result.value,null);
 const waiting=fixture();t.after(()=>waiting.dispose());waiting.reply({url:context.url,result:null,job:{id:'background',status:'waiting'}});await flush();assert.equal(waiting.state.busy.value,true);assert.equal(waiting.requests.length,1);
 const finished=fixture();t.after(()=>finished.dispose());finished.reply({url:context.url,result:saved,job:{id:'background',status:'complete'}});await flush();assert.equal(finished.state.result.value.id,saved.id);assert.equal(finished.state.busy.value,false);assert.equal(finished.requests.length,1);
});
test('Browser panel: page changes close only the old analysis view; return restores the matching URL and ignores late status',async t=>{
 const f=fixture('panel',{});t.after(()=>f.dispose());await flush();assert.ok(f.requests[0].url.includes('status=1'));
 f.reply({url:context.url,result:null,job:{url:context.url,status:'waiting'}});await flush();assert.equal(f.state.analysisStatus.value.status,'waiting');
 await f.state.openAnalysis();assert.ok(f.state.analysisContext.value);assert.equal(f.state.analysisStatus.value.status,'idle','dialog owns foreground polling');
 const other='https://example.test/other';f.listeners.changed({url:other,available:true,session:'tab'});await flush();assert.equal(f.state.analysisContext.value,null);assert.ok(f.calls.some(c=>c.name==='analysis-dialog'&&c.value===false));const old=f.requests.length-1;
 f.listeners.changed({url:context.url,available:true,session:'tab'});await flush();const current=f.requests.length-1;assert.ok(current>old);assert.equal(f.requests[old].init.signal.aborted,true);
 f.reply({url:context.url,result:{id:saved.id,url:context.url},job:{status:'complete'}},current);await flush();f.reply({url:other,job:{status:'waiting'}},old);await flush();assert.equal(f.state.analysisStatus.value.status,'complete');assert.equal(f.state.analysisStatus.value.resultId,saved.id);assert.ok(f.requests.every(r=>!r.init.method||r.init.method==='GET'));
});
for(const headerOnly of [false,true])test(`Browser analysis button: ${headerOnly?'F11 header':'normal panel'} shows waiting/completion/failure for its current URL`,async t=>{
 const f=fixture('panel',{headerOnly});t.after(()=>f.dispose());await flush();
 const label=()=>{const bar=nodes(f.render()).find(n=>n.children?.['connection-tools']);return bar.children['connection-tools']().find(n=>n.props?.class==='browser-analysis').children;};
 f.reply({url:context.url,job:{status:'waiting'}});await flush();assert.equal(label(),'AI解析中…');
 // 統合回帰: 背景解析の状態表示と要素連携の操作を通常窓・F11ヘッダーの両方に残す。
 f.state.page.value={...f.state.page.value,elementPicking:true};
 const tools=nodes(f.render()).find(n=>n.children?.['connection-tools']).children['connection-tools']();
 const element=tools.find(n=>n.props?.class==='browser-element-link');assert.ok(element);assert.equal(element.props['aria-pressed'],true);assert.equal(element.children,'要素連携中（Esc）');assert.equal(label(),'AI解析中…');
 let pending=f.state.analysisMonitor.refresh();f.reply({url:context.url,result:{id:saved.id,url:context.url},job:{status:'complete'}});await pending;assert.equal(label(),'AI解析済');
 pending=f.state.analysisMonitor.refresh();f.reply({url:context.url,result:{id:saved.id,url:context.url},job:{status:'failed',message:'解析結果を確認してください。'}});await pending;assert.equal(label(),'AI解析 要確認');
});
test('Browser panel: a navigation during delayed modal preparation does not reopen the old page analysis',async t=>{
 const hidden=deferred();const f=fixture('panel',{}, {action:async(name,value)=>name==='analysis-context'?{ok:true,context}:name==='analysis-dialog'&&value===true?hidden.promise:{ok:true,url:context.url,available:true}});t.after(()=>f.dispose());await flush();const opening=f.state.openAnalysis();await flush();f.listeners.changed({url:'https://example.test/new',available:true});hidden.resolve({ok:true});await opening;assert.equal(f.state.analysisContext.value,null);assert.ok(f.calls.some(c=>c.name==='analysis-dialog'&&c.value===false));
});

test('Browser panel: A to B to A while opening does not revive an obsolete modal request',async t=>{
 const hidden=deferred();const f=fixture('panel',{}, {action:async(name,value)=>name==='analysis-context'?{ok:true,context}:name==='analysis-dialog'&&value===true?hidden.promise:{ok:true,url:context.url,available:true}});t.after(()=>f.dispose());await flush();const opening=f.state.openAnalysis();await flush();f.listeners.changed({url:'https://example.test/new',available:true});f.listeners.changed({url:context.url,available:true});hidden.resolve({ok:true});await opening;assert.equal(f.state.analysisContext.value,null);assert.equal(f.state.openingAnalysis.value,false);assert.ok(f.calls.some(c=>c.name==='analysis-dialog'&&c.value===false));
});
