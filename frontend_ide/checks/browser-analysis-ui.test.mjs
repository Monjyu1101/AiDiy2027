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
const context={url:'https://example.test/page',title:'入力画面',baseName:'project',projectPath:'/tmp/project',canSelectSource:true,connected:true};
const saved={id:'result-1',createdAt:12345,summary:'# 概要\n入力フォーム\n<script>alert(1)</script>',files:[{role:'html',path:'server/src/html/xxx.html',summary:'入力フォーム'}]};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function channelFixture(){
 const channels=new Set(),sent=[];
 return{sent,channels,open:name=>{
  const channel={name,onmessage:null,postMessage:data=>{sent.push(data);for(const other of channels)if(other!==channel&&other.name===name)other.onmessage?.({data});},close:()=>channels.delete(channel)};
  channels.add(channel);return channel;
 }};
}
function fixture(type='dialog',props={context},options={}){
 const mounted=[],unmounted=[],emitted=[],requests=[],calls=[],timers=new Map(),listeners={};let next=1;
 const channels=options.channels||channelFixture(),setTimer=fn=>{const id=next++;timers.set(id,fn);return id;},clearTimer=id=>timers.delete(id);
 const statusTools={...analysisTools,createBrowserAnalysisStatus:options=>analysisTools.createBrowserAnalysisStatus({...options,channelFactory:channels.open,setTimer,clearTimer}),notifyBrowserAnalysisChanged:url=>analysisTools.notifyBrowserAnalysisChanged(url,channels.open)};
 const file=type==='dialog'?'../src/dialog/ブラウザ解析ダイアログ.vue':type==='window'?'../src/components/ブラウザ/ブラウザ解析ウィンドウ.vue':'../src/components/ブラウザ/ブラウザパネル.vue';
 const {descriptor}=parse(readFileSync(new URL(file,import.meta.url),'utf8'));
 const script=compileScript(descriptor,{id:'analysis-ui',genDefaultAs:'component'}),template=compileTemplate({source:descriptor.template.content,filename:file,id:'analysis-ui',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
 const api={browserAction:async(name,value)=>{calls.push({name,value});if(options.action)return options.action(name,value);return name==='analysis-context'||name==='analysis-window-context'?{ok:true,context}:{ok:true,url:context.url,available:true,connected:true};},onBrowserChanged:fn=>{listeners.changed=fn;return()=>delete listeners.changed;},onBrowserOpenAnalysis:fn=>{listeners.analysis=fn;return()=>delete listeners.analysis;}};
 const module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{module,console,URLSearchParams,AbortController,AbortSignal,Date,
  fetch:(url,init)=>{const pending=deferred();requests.push({url,init,...pending});return pending.promise;},setTimeout:fn=>{const id=next++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  window:{aidiyWindow:api},document:{documentElement:{classList:{add(){},remove(){}}}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},
  require:id=>id.endsWith('/ブラウザ解析状態.js')?statusTools:id==='./URL表示.js'?addresses:id==='vue'?{...vue,withDirectives:node=>node,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:{},
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
test('Browser panel: requests native analysis without hiding page; duplicate opens and header route are guarded',async()=>{
 const opened=deferred(),f=fixture('panel',{}, {action:async name=>name==='open-analysis'?opened.promise:{ok:true,available:true,connected:true}});await flush();
 const first=f.state.openAnalysis();await f.state.openAnalysis();assert.equal(f.calls.filter(c=>c.name==='open-analysis').length,1);opened.resolve({ok:true});await first;
 assert.equal(f.calls.some(c=>c.name==='analysis-dialog'),false);f.dispose();
 const header=fixture('panel',{headerOnly:true});await flush();await header.state.openAnalysis();assert.ok(header.calls.some(c=>c.name==='open-analysis'));header.dispose();
});
test('Browser panel: late native opening response after disposal does not alter state',async()=>{
 const opened=deferred(),f=fixture('panel',{}, {action:async name=>name==='open-analysis'?opened.promise:{ok:true,available:true,connected:true}});await flush();
 const opening=f.state.openAnalysis();f.dispose();opened.resolve({ok:false,error:'late'});await opening;assert.equal(f.state.error.value,'');assert.equal(f.calls.some(c=>c.name==='analysis-dialog'),false);
});
test('Browser analysis window: loads frozen native context and closes only analysis child',async()=>{
 const f=fixture('window',{});await flush();assert.equal(f.state.context.value.url,context.url);await f.state.close();assert.equal(f.calls.at(-1).name,'analysis-window-close');f.dispose();
 const pending=deferred(),late=fixture('window',{}, {action:()=>pending.promise});late.dispose();pending.resolve({ok:true,context});await flush();assert.equal(late.state.context.value,null);
});

test('Browser analysis dialog: IDE guidance is shown before results and never enables standalone source clicks',async()=>{
 for(const [running,ready] of [[false,false],[true,false],[true,true]]){
  const f=fixture('dialog',{context:{...context,canSelectSource:false,ideRunning:running,viewerAvailable:ready}});
  f.reply({result:null,job:null});await flush();
  const rendered=nodes(f.render()),hint=rendered.find(n=>n.props?.class==='browser-analysis-hint browser-analysis-viewer-available');
  assert.equal(!!hint,running);if(hint)assert.match(String(hint.children),ready?/IDEの「Browser」から/:/利用を開始/);
  assert.equal(rendered.filter(n=>n.props?.class==='browser-analysis-source').length,0);
  f.state.result.value=saved;await f.state.selectSource(saved.files[0]);assert.equal(f.calls.length,0);f.dispose();
 }
});

test('Browser analysis dialog: closing automatically continues analysis without a background button; reopening restores waiting/result',async t=>{
 const pending=fixture();t.after(()=>pending.dispose());pending.reply({url:context.url,result:null,job:{id:'background',url:context.url,status:'waiting'}});await flush();
 assert.ok(!nodes(pending.render()).some(n=>n.props?.class==='browser-analysis-background'));const button=nodes(pending.render()).find(n=>n.props?.['aria-label']==='Browser AI解析を閉じる');assert.ok(button);button.props.onClick();assert.equal(pending.emitted.at(-1)[0],'close');assert.equal(pending.timers.size,0);assert.ok(pending.requests.every(r=>r.init.method==='GET'));
 const other=fixture('dialog',{context:{...context,url:'https://example.test/other'}});t.after(()=>other.dispose());other.reply({url:'https://example.test/other',result:null,job:null});await flush();assert.equal(other.state.busy.value,false);assert.equal(other.state.result.value,null);
 const waiting=fixture();t.after(()=>waiting.dispose());waiting.reply({url:context.url,result:null,job:{id:'background',status:'waiting'}});await flush();assert.equal(waiting.state.busy.value,true);assert.equal(waiting.requests.length,1);
 const finished=fixture();t.after(()=>finished.dispose());finished.reply({url:context.url,result:saved,job:{id:'background',status:'complete'}});await flush();assert.equal(finished.state.result.value.id,saved.id);assert.equal(finished.state.busy.value,false);assert.equal(finished.requests.length,1);
});
test('Browser panel: native analysis stays independent while page changes restore matching status and ignore late responses',async t=>{
 const f=fixture('panel',{});t.after(()=>f.dispose());await flush();assert.ok(f.requests[0].url.includes('status=1'));
 f.reply({url:context.url,result:null,job:{url:context.url,status:'waiting'}});await flush();assert.equal(f.state.analysisStatus.value.status,'waiting');
 await f.state.openAnalysis();assert.ok(f.calls.some(c=>c.name==='open-analysis'));assert.equal(f.state.analysisStatus.value.status,'waiting','native child does not interrupt parent status polling');
 const other='https://example.test/other';f.listeners.changed({url:other,available:true,connected:true,session:'tab'});await flush();assert.equal(f.calls.some(c=>c.name==='analysis-window-close'||c.name==='analysis-dialog'),false);const old=f.requests.length-1;
 f.listeners.changed({url:context.url,available:true,connected:true,session:'tab'});await flush();const current=f.requests.length-1;assert.ok(current>old);assert.equal(f.requests[old].init.signal.aborted,true);
 f.reply({url:context.url,result:{id:saved.id,url:context.url},job:{status:'complete'}},current);await flush();f.reply({url:other,job:{status:'waiting'}},old);await flush();assert.equal(f.state.analysisStatus.value.status,'complete');assert.equal(f.state.analysisStatus.value.resultId,saved.id);assert.ok(f.requests.every(r=>!r.init.method||r.init.method==='GET'));
});
for(const headerOnly of [false,true])test(`Browser analysis button: ${headerOnly?'F11 header':'normal panel'} shows waiting/completion/failure for its current URL`,async t=>{
 const f=fixture('panel',{headerOnly});t.after(()=>f.dispose());await flush();
 const label=()=>{const bar=nodes(f.render()).find(n=>n.children?.['connection-tools']);return bar.children['connection-tools']().find(n=>n.props?.class==='browser-analysis').children;};
 f.reply({url:context.url,job:{status:'waiting'}});await flush();assert.equal(label(),'解析中…');
 // 統合回帰: 背景解析の状態表示と要素連携の操作を通常窓・F11ヘッダーの両方に残す。
 f.state.page.value={...f.state.page.value,elementPicking:true};
 const tools=nodes(f.render()).find(n=>n.children?.['connection-tools']).children['connection-tools']();
 assert.deepEqual(Array.from(nodes({children:tools}).filter(n=>n.type==='button'),n=>n.props.class),['browser-analysis','browser-capture','browser-handoff','browser-element-link'],'通常窓・F11で要素連携はCode / Liveへの直後');
 const element=tools.find(n=>n.props?.class==='browser-element-link');assert.ok(element);assert.equal(element.props['aria-pressed'],true);assert.equal(nodes({children:tools}).find(n=>n.props?.class==='browser-capture').children,'📷');assert.equal(nodes({children:tools}).find(n=>n.props?.class==='browser-handoff').children,'C/Lへ');assert.equal(element.children,'要素中');assert.match(element.props['aria-label'],/要素連携.*Esc/);assert.equal(label(),'解析中…');
 let pending=f.state.analysisMonitor.refresh();f.reply({url:context.url,result:{id:saved.id,url:context.url},job:{status:'complete'}});await pending;assert.equal(label(),'AI解析済');
 pending=f.state.analysisMonitor.refresh();f.reply({url:context.url,result:{id:saved.id,url:context.url},job:{status:'failed',message:'解析結果を確認してください。'}});await pending;assert.equal(label(),'AI解析 要確認');
});
test('Browser panel: navigation during native window preparation ignores the stale response without hiding or closing the page',async t=>{
 const opened=deferred(),f=fixture('panel',{}, {action:async name=>name==='open-analysis'?opened.promise:{ok:true,url:context.url,available:true,connected:true}});t.after(()=>f.dispose());await flush();
 const opening=f.state.openAnalysis();await flush();f.listeners.changed({url:'https://example.test/new',available:true,connected:true});f.state.error.value='現在のページの通知';
 opened.resolve({ok:false,error:'古い画面のエラー'});await opening;
 assert.equal(f.state.error.value,'現在のページの通知');assert.equal(f.state.openingAnalysis.value,false);
 assert.equal(f.calls.some(c=>c.name==='analysis-dialog'||c.name==='analysis-window-close'),false);
});
test('Browser panel: A to B to A while native opening does not apply an obsolete response',async t=>{
 const opened=deferred(),f=fixture('panel',{}, {action:async name=>name==='open-analysis'?opened.promise:{ok:true,url:context.url,available:true,connected:true}});t.after(()=>f.dispose());await flush();
 const opening=f.state.openAnalysis();await flush();f.listeners.changed({url:'https://example.test/new',available:true,connected:true});f.listeners.changed({url:context.url,available:true,connected:true});f.state.error.value='現在の通知';
 opened.resolve({ok:true});await opening;
 assert.equal(f.state.error.value,'現在の通知');assert.equal(f.state.openingAnalysis.value,false);assert.equal(f.calls.filter(c=>c.name==='open-analysis').length,1);
 assert.equal(f.calls.some(c=>c.name==='analysis-dialog'||c.name==='analysis-window-close'),false);
});

for(const headerOnly of [false,true])test(`Browser analysis request: ${headerOnly?'F11 header':'normal panel'} updates from idle/completed and restores waiting after A→B→A`,async t=>{
 const channels=channelFixture(),panel=fixture('panel',{headerOnly},{channels});t.after(()=>panel.dispose());await flush();
 const label=()=>nodes(panel.render()).find(n=>n.children?.['connection-tools']).children['connection-tools']().find(n=>n.props?.class==='browser-analysis').children;
 panel.reply({url:context.url,result:null,job:null});await flush();assert.equal(label(),'AI解析');assert.equal(panel.timers.size,0);
 const dialog=fixture('dialog',{context},{channels});t.after(()=>dialog.dispose());dialog.reply({result:null,job:null});await flush();
 let starting=dialog.state.analyze();dialog.reply({id:'job-a',url:context.url,status:'waiting'});await starting;
 assert.equal(panel.requests.length,2,'accepted POST immediately rechecks the already idle parent');
 panel.reply({url:context.url,job:{id:'job-a',status:'waiting'}});await flush();assert.equal(label(),'解析中…');
 dialog.state.close();assert.equal(panel.timers.size,1,'closing the child does not cancel server polling');
 panel.listeners.changed({url:'https://example.test/other',available:true,connected:true});panel.reply({url:'https://example.test/other',job:null});await flush();assert.equal(label(),'AI解析');
 panel.listeners.changed({url:context.url,available:true,connected:true});panel.reply({url:context.url,job:{id:'job-a',status:'waiting'}});await flush();assert.equal(label(),'解析中…');
 panel.tick();panel.reply({url:context.url,result:{id:'result-a',url:context.url},job:{status:'complete'}});await flush();assert.equal(label(),'AI解析済');assert.equal(panel.timers.size,0);
 const again=fixture('dialog',{context},{channels});t.after(()=>again.dispose());again.reply({result:saved,job:{status:'complete'}});await flush();starting=again.state.analyze();again.reply({id:'job-new',url:context.url,status:'waiting'});await starting;
 panel.reply({url:context.url,result:saved,job:{id:'job-new',status:'waiting'}});await flush();assert.equal(label(),'解析中…');
 assert.equal(channels.sent.length,2);assert.ok(channels.sent.every(data=>Object.keys(data).join(',')==='url'),'notifications never carry result contents');
 assert.ok(panel.requests.every(request=>!request.init.method||request.init.method==='GET'));
 panel.dispose();assert.equal(channels.channels.size,0);
});
test('Browser analysis request: late request failure still rechecks the server without marking another page busy',async t=>{
 const channels=channelFixture(),panel=fixture('panel',{}, {channels});t.after(()=>panel.dispose());await flush();panel.reply({url:context.url,job:null});await flush();
 const dialog=fixture('dialog',{context},{channels});t.after(()=>dialog.dispose());dialog.reply({result:null,job:null});await flush();
 let starting=dialog.state.analyze();dialog.requests.at(-1).reject(Error('response lost'));await starting;assert.equal(panel.requests.length,2);
 panel.reply({url:context.url,job:{id:'accepted',status:'waiting'}});await flush();assert.equal(panel.state.analysisStatus.value.status,'waiting');
 panel.listeners.changed({url:'https://example.test/other',available:true,connected:true});panel.reply({url:'https://example.test/other',job:null});await flush();const count=panel.requests.length;
 starting=dialog.state.analyze();dialog.reply({status:'waiting'});await starting;assert.equal(panel.requests.length,count);assert.equal(panel.state.analysisStatus.value.status,'idle');
});

test('Browser解析の表: ファイル名とフォルダを分けても選択先・全パス・表示専用モードを保つ',async()=>{
 const f=fixture();f.reply({result:saved,job:null});await flush();
 const rendered=nodes(f.render()),region=rendered.find(n=>n.props?.class==='browser-analysis-sources'),button=rendered.find(n=>n.props?.class==='browser-analysis-source');
 assert.equal(region.props.role,'region');assert.equal(region.props.tabindex,'0');assert.equal(button.props['aria-label'],saved.files[0].path+' をIDEで表示');assert.equal(f.state.sourceName(saved.files[0].path),'xxx.html');assert.equal(f.state.sourceFolder(saved.files[0].path),'server/src/html/');assert.equal(f.state.sourceName('index.html'),'index.html');assert.equal(f.state.sourceFolder('index.html'),'');
 assert.equal(rendered.filter(n=>n.type==='th').every(n=>n.props.scope==='col'),true);f.dispose();
});

for(const headerOnly of [false,true])test(`Browser offline: ${headerOnly?'header':'panel'} retains ordinary controls but disables AI`,async t=>{
 const f=fixture('panel',{headerOnly});t.after(()=>f.dispose());await flush();
 f.listeners.changed({url:context.url,available:true,connected:false,back:true,forward:true});
 const rendered=nodes(f.render()),bar=rendered.find(n=>n.children?.['connection-tools']);
 assert.equal(bar.props.connected,false);assert.equal(bar.props.mode,'online');assert.equal(bar.props['clock-pulse'],true);assert.equal(bar.props.status,'未接続');
 const buttons=nodes({children:bar.children['connection-tools']()}).filter(n=>n.type==='button');
 assert.equal(buttons.find(n=>n.props.class==='browser-analysis').props.disabled,true);
 for(const name of ['browser-capture','browser-handoff','browser-element-link'])assert.equal(!!buttons.find(n=>n.props.class===name).props.disabled,false);
 assert.equal(rendered.find(n=>n.type==='input').props.disabled,false);
 const before=f.calls.length;await f.state.openAnalysis();assert.equal(f.calls.length,before);
 f.listeners.changed({url:context.url,available:false,connected:false});
 assert.equal(nodes(f.render()).find(n=>n.type==='input').props.disabled,true);
 f.listeners.changed({url:context.url,available:true,connected:true});await f.state.openAnalysis();assert.equal(f.calls.at(-1).name,'open-analysis');
});
test('Browser analysis offline: preserves saved results and source navigation, rejects AI until reconnect',async t=>{
 const props={context:{...context,connected:false}},f=fixture('dialog',props);t.after(()=>f.dispose());
 f.reply({result:saved,job:null});await flush();await f.state.analyze();assert.equal(f.requests.length,1);
 assert.equal(f.state.result.value.id,saved.id);await f.state.selectSource(saved.files[0]);assert.equal(f.calls.at(-1).name,'analysis-select-source');
 const actions=nodes(f.render()).find(n=>n.props?.class==='browser-analysis-actions');assert.equal(nodes(actions).find(n=>n.type==='button').props.disabled,true);
 props.context={...props.context,connected:true};const request=f.state.analyze();assert.equal(f.requests.length,2);f.reply({status:'waiting'});await request;
 assert.equal(f.state.result.value.id,saved.id);
});
test('Browser analysis connection: stale initial reads cannot override notifications; polling recovers and disposal cancels',async()=>{
 const f=fixture('window',{});await flush();assert.equal(f.requests[0].url,'/api/connection');
 f.listeners.changed({available:true,connected:false});f.reply({active:true,mode:'online',connected:true},0);await flush();
 assert.equal(f.state.context.value.connected,false,'newer offline event wins over initial read');
 f.tick();f.reply({active:true,mode:'online',connected:true});await flush();assert.equal(f.state.context.value.connected,true);
 f.listeners.changed({available:false,connected:true});assert.equal(f.state.context.value.connected,false,'inactive session is never AI-ready');
 f.tick();f.listeners.changed({available:true,connected:true});f.reply({active:true,mode:'offline',connected:false});await flush();assert.equal(f.state.context.value.connected,true,'newer online event wins over stale poll');
 const target=f.state.context.value.url;f.listeners.changed({url:'https://example.test/new',available:true,connected:false});assert.equal(f.state.context.value.url,target,'analysis target stays frozen across navigation');
 f.tick();const pending=f.requests.at(-1);f.dispose();assert.equal(pending.init.signal.aborted,true);f.reply({active:true,mode:'online',connected:true});await flush();assert.equal(f.state.context.value.connected,false);assert.equal(f.timers.size,0);
});

for(const standalone of [false,true])for(const headerOnly of [false,true])test(`Browser制御バー: standalone=${standalone} header=${headerOnly} の未接続・接続・切断・復帰`,async t=>{
 const f=fixture('panel',{standalone,headerOnly});t.after(()=>f.dispose());await flush();
 // Tools未起動・喪失でも通常閲覧は可能。タイトルは接続状態だけを示し、操作の接続制約は維持する。
 for(const connected of [false,true,false,true,false]){
  f.listeners.changed({url:context.url,available:true,connected});
  const rendered=nodes(f.render()),bar=rendered.find(n=>n.children?.['connection-tools']);
  assert.equal(bar.props.mode,'online');
  assert.equal(bar.props.connected,connected);
  assert.equal(bar.props['clock-pulse'],true,'共通abs(sin)式・50ms更新・4.5秒脈動を使用する');
  assert.equal(bar.props.status,connected?'接続済':'未接続');
  assert.equal(nodes({children:bar.children['connection-tools']()}).some(n=>n.props?.class==='browser-isolated-label'),false,'一時切断はスタンドアロンと表示しない');
  assert.equal(rendered.find(n=>n.type==='input').props.disabled,false,'切断でも手動閲覧は維持する');
 }
});

for(const standalone of [false,true])for(const headerOnly of [false,true])test(`Browser孤立利用バー: standalone=${standalone} header=${headerOnly} は黒モード`,async t=>{
 const f=fixture('panel',{standalone,headerOnly});t.after(()=>f.dispose());await flush();
 for(const mode of ['offline','online','offline']){
  f.listeners.changed({url:context.url,available:true,connected:false,mode});
  const rendered=nodes(f.render()),bar=rendered.find(n=>n.children?.['connection-tools']);
  assert.equal(bar.props.mode,mode);assert.equal(bar.props.connected,false);
  assert.equal(bar.props.status,'未接続');
  const badge=nodes({children:bar.children['connection-tools']()}).find(n=>n.props?.class==='browser-isolated-label');
  assert.equal(!!badge,mode==='offline');if(badge)assert.equal(badge.children,'スタンドアロン');
  assert.equal(rendered.find(n=>n.type==='input').props.disabled,false);
 }
});

for(const standalone of [false,true])for(const headerOnly of [false,true])test(`Browser孤立UI: standalone=${standalone} header=${headerOnly} は連携操作・保存状態を隠し、公開対象IDはコピー可能`,async t=>{
 const f=fixture('panel',{standalone,headerOnly});t.after(()=>f.dispose());await flush();
 const integrations=['browser-analysis','browser-capture','browser-capture-tools','browser-capture-status','browser-handoff','browser-element-link'];
 for(const [mode,connected] of [['online',true],['offline',false],['online',false],['offline',false],['online',true]]){
  f.listeners.changed({url:context.url,title:'Example',available:true,connected,mode,session:'aidiy_browser test',activeTabId:'tab-test',homeURL:'https://start.test/page',tabs:[{id:'tab-test',title:'Example',url:context.url}],capturePath:'temp/input/test.png',elementPicking:true,back:true,forward:true});
  f.state.captureMessage.value='temp/input/test.png に保存しました。';
  const rendered=nodes(f.render()),bar=rendered.find(n=>n.children?.['connection-tools']);
  const tools=nodes({children:bar.children['connection-tools']()});
  for(const name of integrations)assert.equal(tools.some(n=>n.props?.class===name),mode!=='offline',name);
  const home=rendered.find(n=>n.props?.['aria-label']==='ホーム');assert.ok(home);assert.equal(home.props.disabled,false);assert.equal(home.props.title,'ホーム: https://start.test/page');
  f.state.infoTabId.value='tab-test';assert.equal(nodes(f.render()).find(n=>n.props?.class==='browser-connection-target').props.value,'session="aidiy_browser test" ,tab_id="tab-test", title="Example"');
  assert.equal(rendered.find(n=>n.type==='input').props.disabled,false);
  for(const label of ['戻る','進む'])assert.equal(rendered.find(n=>n.props?.['aria-label']===label).props.disabled,false);
  const windowTools=nodes({children:bar.children['window-tools']()});assert.equal(windowTools.filter(n=>n.type==='button').length,3,'通常の表示サイズ・全画面操作は維持');
 }
});
