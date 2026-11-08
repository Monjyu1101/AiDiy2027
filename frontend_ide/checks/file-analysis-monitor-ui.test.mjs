// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as displayUrls from '../viewer/表示URL.mjs';
import {composeFileAnalysis} from '../ファイル機能/ファイル解析結果.mjs';
const require=createRequire(import.meta.url),vue=require('vue'),MarkdownIt=require('markdown-it');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const flush=async()=>{for(let n=0;n<35;n++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const waiting={id:'job-a',status:'waiting',message:'3件を監視中',attempts:[1,2,3].map(index=>({id:'attempt-'+index,index,status:'waiting',processState:'requested'}))};
const complete={...waiting,status:'complete',winner:'attempt-2',attempts:waiting.attempts.map(x=>({...x,status:x.index===2?'complete':'waiting',processState:x.index===2?'returned':'cancel_requested'}))};
function fixture(t,fetcher){
 const filename=fileURLToPath(new URL('../src/dialog/ファイル解析ダイアログ.vue',import.meta.url)),{descriptor}=parse(readFileSync(filename,'utf8'),{filename});
 const script=compileScript(descriptor,{id:'analysis-monitor',genDefaultAs:'component'}),template=compileTemplate({source:descriptor.template.content,filename,id:'analysis-monitor',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
 const module={exports:{}},mounted=[],unmounted=[],timers=new Map(),calls=[],emitted=[];let sequence=0;
 const window={location:{origin:'http://localhost'},aidiyWindow:{openBrowser:async()=>({ok:true})}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{
  module,window,console,AbortController,AbortSignal,URLSearchParams,Date,
  fetch:async(url,options)=>{calls.push({url,...options});return{ok:true,json:async()=>fetcher(url,options)};},
  setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  require:id=>id==='vue'?{...vue,inject:(_key,fallback)=>fallback,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn),withDirectives:node=>node}:id==='markdown-it'?MarkdownIt:id.endsWith('/表示URL.mjs')?displayUrls:{openBrowser:async()=>({ok:true})},
 });
 const props={file:{name:'Screen.vue',path:'Screen.vue'},root:'/project'},scope=vue.effectScope();
 const state=scope.run(()=>module.exports.setup(props,{emit:name=>emitted.push(name),expose(){}}));state.dialog.value={showModal(){},close(){}};
 let disposed=false;const dispose=()=>{if(disposed)return;disposed=true;unmounted.forEach(fn=>fn());scope.stop();};t.after(dispose);
 const render=()=>module.exports.render({},[],props,vue.proxyRefs(state),{},{});
 return{state,calls,timers,emitted,dispose,render,async mount(){mounted.forEach(fn=>fn());await flush();},async tick(){const [id,timer]=timers.entries().next().value||[];assert.ok(timer);timers.delete(id);await timer.fn();await flush();}};
}
const nodes=(node,all=[])=>{if(!node||typeof node!=='object')return all;all.push(node);if(Array.isArray(node.children))node.children.forEach(x=>nodes(x,all));return all;};

test('監視UI: 閉じると画面の監視だけ解除、再表示で進行中の3本・保存済み結果を取得する',async t=>{
 let response={instruction:'保存指示',job:waiting,result:null};const f=fixture(t,()=>response);await f.mount();assert.equal(f.state.busy.value,true);assert.equal(f.state.instruction.value,'保存指示');assert.equal(f.timers.size,1);assert.ok(nodes(f.render()).some(x=>x.props?.class==='analysis-processes'));
 const signal=f.calls[0].signal;f.dispose();assert.equal(f.timers.size,0);assert.equal(signal.aborted,true);assert.ok(f.calls.every(x=>x.method==='GET'));
 const reopened=fixture(t,()=>response);await reopened.mount();assert.equal(reopened.state.job.value.id,'job-a');assert.equal(reopened.state.busy.value,true);
 response={instruction:'保存指示',job:complete,result:{content:'成功した解析本文',createdAt:1,relatedSourceScope:'page'}};await reopened.tick();assert.equal(reopened.state.record.value.content,'成功した解析本文');assert.equal(reopened.state.busy.value,false);assert.equal(reopened.timers.size,0);assert.equal(reopened.state.attemptLabel(reopened.state.job.value.attempts[1]),'結果保存済み');assert.match(reopened.state.attemptLabel(reopened.state.job.value.attempts[0]),/終了未確認/);
});

test('監視UI: 初回GET失敗から自動再試行し、保存指示を復元して既定文で上書きしない',async t=>{
 let count=0;const f=fixture(t,(_url,options)=>{if(options.method==='PUT')return{};if(++count===1)throw Error('temporary');return{instruction:'私の保存指示',job:waiting,result:null};});await f.mount();assert.match(f.state.error.value,/temporary/);assert.equal(f.timers.size,1);
 await f.tick();assert.equal(f.state.instruction.value,'私の保存指示');assert.equal(f.state.error.value,'');await f.state.close();assert.equal(JSON.parse(f.calls.find(x=>x.method==='PUT').body).instruction,'私の保存指示');assert.deepEqual(f.emitted,['close']);
});

test('監視UI: 再試行待ちの入力変更は保ち、通信断でも前回結果を消さず監視を再開する',async t=>{
 let count=0;const f=fixture(t,()=>{count++;if(count===1||count===3)throw Error('temporary');return{instruction:'保存指示',job:waiting,result:{content:'前回結果'}};});await f.mount();f.state.instruction.value='再試行中に入力した指示';await f.tick();assert.equal(f.state.instruction.value,'再試行中に入力した指示');assert.equal(f.state.record.value.content,'前回結果');await f.tick();assert.equal(f.state.record.value.content,'前回結果');assert.equal(f.timers.size,1);await f.tick();assert.equal(f.state.error.value,'');
});

test('監視UI: 再解析POST中の再確認・連打は二重送信や保存中の固定を起こさない',async t=>{
 const post=deferred();let phase='old';const f=fixture(t,(_url,options)=>options.method==='POST'?post.promise:{instruction:'保存指示',job:phase==='old'?{...waiting,status:'failed'}:waiting,result:null});await f.mount();
 const running=f.state.analyze();await flush();assert.equal(f.state.saving.value,true);const before=f.calls.length;await f.state.load();await f.state.analyze();assert.equal(f.calls.length,before);
 const recheck=nodes(f.render()).find(x=>x.type==='button'&&x.children==='結果を再確認');assert.equal(recheck.props.disabled,true);
 phase='new';post.resolve({...waiting,id:'new-job'});await running;await flush();assert.equal(f.state.saving.value,false);assert.equal(f.state.job.value.id,'new-job');assert.equal(f.timers.size,1);
});

test('監視UI: 古いGETや閉鎖後のPOST結果を新しいジョブ・破棄済み画面へ戻さない',async t=>{
 const pending=deferred(),post=deferred();let gets=0;const f=fixture(t,(_url,options)=>options.method==='POST'?post.promise:++gets===2?pending.promise:{instruction:'保存指示',job:{...waiting,status:'failed'},result:null});await f.mount();
 const old=f.state.load();await flush();const running=f.state.analyze();await flush();post.resolve({...waiting,id:'new-job'});await running;pending.resolve({instruction:'古い指示',job:{...waiting,id:'old-job',status:'failed'},result:{content:'古い応答'}});await old;await flush();assert.equal(f.state.job.value.id,'new-job');assert.equal(f.state.record.value,null);
 const last=deferred(),closed=fixture(t,(_url,options)=>options.method==='POST'?last.promise:{job:null,result:null,instruction:'概要'});await closed.mount();const request=closed.state.analyze();closed.dispose();last.resolve(waiting);await request;await flush();assert.equal(closed.state.job.value,null);assert.equal(closed.timers.size,0);
});


test('合成UI: 途中結果を再読込で追記し、URL→概要→関連ソースの順と全原本・根拠を表示する',async t=>{
 const attempt=index=>({id:'a'+index,index,result:{content:'独立本文'+index,summary:index<3?'共通概要':'別概要',relatedSourceScope:'page',displayUrls:[{url:'http://localhost/list',label:'一覧'+index,reason:'URL根拠'+index}],displayUrlReason:'未確認事項'+index,relatedSources:[{path:'shared.js',relation:'callee',line:index,reason:'参照根拠'+index}]}});
 const run={id:'compose',startedAt:1,instruction:'調べる',attempts:[attempt(1),{index:2},{index:3}]};let response={instruction:'調べる',job:{...waiting,successCount:1},result:composeFileAnalysis(run)};
 const f=fixture(t,()=>response);await f.mount();assert.equal(f.state.record.value.successCount,1);assert.equal(f.state.busy.value,true);
 run.attempts=[attempt(1),attempt(2),attempt(3)];response={...response,job:{...waiting,status:'complete',monitoring:true},result:composeFileAnalysis(run)};await f.tick();assert.equal(f.state.record.value.successCount,3);assert.equal(f.state.busy.value,true);assert.equal(f.timers.size,1);
 const tree=nodes(f.render()),sections=tree.filter(x=>['analysis-display-urls','analysis-summary','analysis-related-sources'].includes(x.props?.class));assert.deepEqual(sections.map(x=>x.props.class),['analysis-display-urls','analysis-summary','analysis-related-sources']);assert.equal(tree.filter(x=>x.props?.class==='analysis-display-url').length,1);assert.equal(f.state.record.value.relatedSources.length,1);assert.equal(f.state.record.value.relatedSources[0].evidence.length,3);assert.equal(tree.filter(x=>x.props?.class==='analysis-individual').length,3);assert.equal(f.state.summaries.value.length,2);
 const text=tree.map(x=>typeof x.children==='string'?x.children:'').join(' ');for(let index=1;index<=3;index++){assert.match(text,new RegExp('URL根拠'+index));assert.match(text,new RegExp('参照根拠'+index));}
 response={...response,job:{...response.job,monitoring:false}};await f.tick();assert.equal(f.state.busy.value,false);assert.equal(f.timers.size,0);
});

test('指示保護: 初回GET失敗後に未編集で閉じても既定文をPUTせず保存済み指示を残す',async t=>{
 let saved='保存してある固有の指示';const f=fixture(t,(_url,options)=>{if(options.method==='PUT'){saved=JSON.parse(options.body).instruction;return{};}throw Error('temporary');});
 await f.mount();assert.equal(f.state.loading.value,false);assert.equal(f.timers.size,1);await f.state.close();
 assert.equal(saved,'保存してある固有の指示');assert.equal(f.calls.filter(x=>x.method==='PUT').length,0);assert.deepEqual(f.emitted,['close']);assert.equal(f.timers.size,0);assert.equal(f.calls[0].signal.aborted,true);
});

test('指示保護: 初回取得の再試行中に未編集で閉じても保存せず、遅いGETを取り込まない',async t=>{
 const retry=deferred();let gets=0;const f=fixture(t,(_url,options)=>{if(options.method==='PUT')return{};if(++gets===1)throw Error('temporary');return retry.promise;});
 await f.mount();const original=f.state.instruction.value,request=f.tick();await flush();assert.equal(gets,2);await f.state.close();assert.equal(f.calls.filter(x=>x.method==='PUT').length,0);assert.deepEqual(f.emitted,['close']);
 retry.resolve({instruction:'遅れて取得した指示',job:waiting,result:null});await request;assert.equal(f.state.instruction.value,original);assert.equal(f.state.job.value,null);assert.equal(f.timers.size,0);
});

test('指示保護: 初回GET失敗後でも編集した入力は保存し、PUT失敗なら保持して再試行できる',async t=>{
 let puts=0,saved='保存指示';const f=fixture(t,(_url,options)=>{if(options.method==='PUT'){if(++puts===1)throw Error('save failed');saved=JSON.parse(options.body).instruction;return{};}throw Error('temporary');});
 await f.mount();f.state.instruction.value='取得失敗後に編集した指示';await f.state.close();assert.equal(f.emitted.length,0);assert.match(f.state.closeError.value,/save failed/);assert.equal(f.state.instruction.value,'取得失敗後に編集した指示');assert.equal(saved,'保存指示');
 await f.state.close();assert.equal(saved,'取得失敗後に編集した指示');assert.equal(puts,2);assert.deepEqual(f.emitted,['close']);assert.equal(f.timers.size,0);
});

test('監視UI: 閉じる保存待ちでpollが発火しても、保存失敗後は監視を再開して完了結果を表示する',async t=>{
 const save=deferred();let response={instruction:'保存指示',job:waiting,result:null};
 const f=fixture(t,(_url,options)=>options.method==='PUT'?save.promise:response);await f.mount();
 const closing=f.state.close();await flush();assert.equal(f.state.saving.value,true);
 await f.tick();assert.equal(f.timers.size,0);assert.equal(f.calls.filter(x=>x.method==='GET').length,1);
 save.reject(Error('temporary write failure'));await closing;await f.state.keepEditing();
 assert.equal(f.state.busy.value,true);assert.equal(f.timers.size,1);assert.deepEqual(f.emitted,[]);
 response={...response,job:complete,result:{content:'保存待ちの間に完成した解析結果'}};await f.tick();
 assert.equal(f.state.record.value.content,response.result.content);assert.equal(f.state.busy.value,false);assert.equal(f.timers.size,0);
});

test('指示保護: 初回読込の再試行も保存失敗後に再開し、編集中の指示を保持する',async t=>{
 const save=deferred();let gets=0;
 const f=fixture(t,(_url,options)=>{if(options.method==='PUT')return save.promise;if(++gets===1)throw Error('temporary read failure');return{instruction:'保存指示',job:waiting,result:{content:'前回結果'}};});
 await f.mount();f.state.instruction.value='編集中の指示';const closing=f.state.close();await flush();await f.tick();
 save.reject(Error('temporary write failure'));await closing;assert.equal(f.timers.size,1);await f.tick();
 assert.equal(f.state.instruction.value,'編集中の指示');assert.equal(f.state.record.value.content,'前回結果');assert.equal(f.state.error.value,'');assert.equal(f.timers.size,1);
});

test('監視UI: 保存待ち中に画面を破棄した場合は、遅い保存失敗でも監視を再開しない',async t=>{
 const save=deferred(),f=fixture(t,(_url,options)=>options.method==='PUT'?save.promise:{instruction:'保存指示',job:waiting,result:null});await f.mount();
 const closing=f.state.close();await flush();f.dispose();save.reject(Error('late write failure'));await closing;
 assert.equal(f.timers.size,0);assert.deepEqual(f.emitted,[]);
});
