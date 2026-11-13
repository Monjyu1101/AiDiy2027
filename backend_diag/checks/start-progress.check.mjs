// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {起動状態を作成} from '../diag/ui/components/起動/起動状態.mjs';
const progress=(id,kind='start',state='running',message='Tools を起動しています。')=>({実行ID:id,種別:kind,状態:state,通知:message});
function fixture(t){
 const data={対象:[{id:'tools',名前:'Tools',状態:'未起動',設定:{起動対象:true}}],実行中:false,一括停止中:false,一括進捗:null};
 const calls=[],timers=[];let handler=async()=>({受理:true}),portError=false,snapshotHandler;
 const state=起動状態を作成({setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimer:()=>{},api:async(route,method,signal)=>{
  calls.push(route);
  if(route==='api/起動')return snapshotHandler?snapshotHandler():structuredClone(data);
  if(route==='api/起動/ポート'){if(portError)throw Error('ポート確認失敗');return {対象:[{id:'tools',開放:false}]};}
  if(route==='api/起動/ログ')return {ログ:'',位置:0};
  return handler(route,signal);
 }});
 t.after(()=>state.終了());
 return {state,data,calls,timers,setHandler:fn=>handler=fn,setSnapshot:fn=>snapshotHandler=fn,failPorts:()=>portError=true,async refresh(logs=false){state.表示(true,logs);await flush();await flush();}};
}
test('auto progress is visible off-tab without log polling, and completion disappears immediately until next run',async t=>{
 const f=fixture(t);f.data.実行中=true;f.data.一括進捗=progress('auto');await f.refresh();
 assert.equal(f.state.進捗表示.value.実行ID,'auto');assert.equal(f.calls.includes('api/起動/ログ'),false);assert.equal(f.timers.at(-1).ms,1000);
 f.state.進捗を閉じる();assert.ok(f.state.進捗表示.value,'進行中は閉じない');
 f.data.実行中=false;f.data.一括進捗=progress('auto','start','done','起動処理が完了しました。');await f.refresh();
 assert.equal(f.state.進捗表示.value,null);await f.refresh();assert.equal(f.state.進捗表示.value,null);
 f.data.一括進捗=progress('next','stop');await f.refresh();assert.equal(f.state.進捗表示.value.種別,'stop');
});
test('manual batch shows acceptance immediately, rejects repeated clicks, survives tab changes and follows server result',async t=>{
 const f=fixture(t);await f.refresh(true);let release;
 f.setHandler(()=>new Promise(resolve=>{release=resolve;}));const first=f.state.一括操作();
 assert.equal(f.state.進捗表示.value.種別,'start');assert.equal(f.state.進捗表示.value.状態,'running');
 await f.state.一括操作();assert.equal(f.calls.filter(x=>x==='api/起動/再起動').length,1);
 await f.refresh(false);assert.match(f.state.進捗表示.value.通知,/受け付け/);
 f.data.一括進捗=progress('accepted');f.data.実行中=true;release({受理:true});assert.equal(await first,'start');await flush();
 assert.equal(f.state.進捗表示.value.実行ID,'accepted');
 f.data.実行中=false;f.data.一括進捗=progress('accepted','start','error','起動失敗');await f.refresh();
 assert.equal(f.state.進捗表示.value.状態,'error');
});
test('force stop progress replaces running start and request failure remains visible across polling',async t=>{
 const f=fixture(t);f.data.実行中=true;f.data.一括進捗=progress('start');await f.refresh();
 f.setHandler(async()=>{throw Error('停止を受理できません');});await f.state.一括操作();
 assert.equal(f.state.進捗表示.value.種別,'stop');assert.equal(f.state.進捗表示.value.状態,'error');
 await f.refresh();assert.match(f.state.進捗表示.value.通知,/受理できません/);
 f.data.一括進捗=progress('stop','stop');f.data.一括停止中=true;await f.refresh();assert.equal(f.state.進捗表示.value.実行ID,'stop');
 f.data.一括進捗=progress('stop','stop','done','すべて停止しました。');f.data.一括停止中=false;f.data.実行中=false;await f.refresh();assert.equal(f.state.進捗表示.value,null);
});
test('disconnect/unmount discards pending responses; progress is available even when port checks fail',async t=>{
 const f=fixture(t);await f.refresh();let release;f.setHandler(()=>new Promise(resolve=>{release=resolve;}));
 const work=f.state.一括操作();f.state.終了();release({受理:true});await work;
 assert.equal(f.state.進捗表示.value,null);assert.equal(f.state.処理中.value,false);
 f.data.一括進捗=progress('auto');f.failPorts();await f.refresh();
 assert.equal(f.state.進捗表示.value.実行ID,'auto');assert.equal(f.state.更新失敗.value,true);
});
test('dialog is a nonmodal in-flow region, shared outside tabs and compact views without navigation locks',async()=>{
 const text=await readFile(new URL('../diag/ui/components/起動/一括進捗表示.vue',import.meta.url),'utf8');
 const css=await readFile(new URL('../diag/ui/components/起動/一括進捗表示.css',import.meta.url),'utf8');
 const app=await readFile(new URL('../diag/ui/App.vue',import.meta.url),'utf8');
 assert.match(text,/role="status" aria-live="polite"/);assert.doesNotMatch(text,/aria-modal|showModal|autofocus|\.focus\(/);
 assert.doesNotMatch(css,/position\s*:\s*(fixed|absolute)|inset\s*:\s*0/);
 assert.match(app,/起動\.表示\(online,value==='start'&&!mini\)/);
 assert.match(app,/v-if="connected&&!ミニ表示" :is="一括進捗表示"/);
 const nav=app.match(/<nav[\s\S]*?<\/nav>/)[0];assert.doesNotMatch(nav,/<nav[^>]*(?:inert|disabled)/);
 assert.doesNotMatch(app,/changeTab\(value\)\{[^}]*進捗/);
});

test('progress component renders pending, stop, hidden completion and actionable error text',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {render}=require('./ui-components.cjs');
 const state={進捗表示:{value:progress('run')},更新失敗:{value:false},進捗を閉じる(){}};
 let html=await render('components/起動/一括進捗表示.vue',{state});
 assert.match(html,/一括起動中/);assert.match(html,/Tools を起動しています/);assert.doesNotMatch(html,/<button/);
 state.進捗表示.value=progress('stop','stop','running','Web を停止しています。');
 html=await render('components/起動/一括進捗表示.vue',{state,compact:true});assert.match(html,/強制停止中/);assert.match(html,/Web を停止/);
 state.進捗表示.value=progress('stop','stop','error','停止できませんでした。');
 html=await render('components/起動/一括進捗表示.vue',{state});assert.match(html,/停止できません/);assert.match(html,/進行状況を閉じる/);
 state.進捗表示.value=progress('done','start','done','起動処理が完了しました。');
 html=await render('components/起動/一括進捗表示.vue',{state});assert.doesNotMatch(html,/一括起動完了|閉じる|batch-progress/);
});

for(const kind of ['start','stop'])test(`${kind}: success and cancellation disappear, failure remains dismissible, next run appears`,async t=>{
 const f=fixture(t);
 for(const terminal of ['done','cancelled']){
  f.data.一括進捗=progress('run-'+terminal,kind);await f.refresh();assert.ok(f.state.進捗表示.value);
  f.data.一括進捗.状態=terminal;f.data.通知=f.data.一括進捗.通知;await f.refresh();assert.equal(f.state.進捗表示.value,null);assert.equal(f.state.通知.value,'','システム起動タブにも完了通知を残さない');
 }
 f.data.一括進捗=progress('failed',kind,'error','コンソールを確認してください。');await f.refresh();assert.equal(f.state.進捗表示.value.状態,'error');
 f.state.進捗を閉じる();await f.refresh();assert.equal(f.state.進捗表示.value,null);
 f.data.一括進捗=progress('new',kind);await f.refresh();assert.equal(f.state.進捗表示.value.実行ID,'new');
});
test('a delayed pre-operation snapshot cannot replace a newer acceptance or error',async t=>{
 const f=fixture(t);f.data.一括進捗=progress('previous','start','done');await f.refresh();
 let releaseSnapshot,releasePost;
 f.setSnapshot(()=>new Promise(resolve=>{releaseSnapshot=resolve;}));f.state.表示(true,false);
 f.setHandler(()=>new Promise((resolve,reject)=>{releasePost=reject;}));const work=f.state.一括操作();
 // 読込済みの画面なので、遅い定期更新と明示操作は重なり得る。
 assert.match(f.state.進捗表示.value.実行ID,/request-/);
 releasePost(Error('受付できませんでした'));await work;
 releaseSnapshot({...structuredClone(f.data),一括進捗:progress('previous','start','done')});await flush();
 assert.equal(f.state.進捗表示.value.状態,'error');assert.match(f.state.進捗表示.value.通知,/受付できません/);
});
test('accepted next request ignores previous terminal result until its own server run arrives',async t=>{
 const f=fixture(t);f.data.一括進捗=progress('old','start','done');await f.refresh();
 await f.state.一括操作();await flush();
 assert.match(f.state.進捗表示.value.実行ID,/request-/);
 f.data.一括進捗=progress('new','start');await f.refresh();assert.equal(f.state.進捗表示.value.実行ID,'new');
 f.data.一括進捗.状態='done';await f.refresh();assert.equal(f.state.進捗表示.value,null);
});
test('disconnect then new operation ignores an older POST completion',async t=>{
 const f=fixture(t);await f.refresh();let release;
 f.setHandler(()=>new Promise(resolve=>{release=resolve;}));const old=f.state.一括操作();f.state.終了();await f.refresh();
 f.setHandler(async()=>{throw Error('new failure');});await f.state.一括操作();const newer=f.state.進捗表示.value.実行ID;
 release({受理:true});await old;
 assert.equal(f.state.進捗表示.value.実行ID,newer);assert.equal(f.state.進捗表示.value.通知,'new failure');assert.equal(f.state.処理中.value,false);
});

test('hiding batch success does not hide a later individual operation error',async t=>{
 const f=fixture(t);f.data.一括進捗=progress('done','start','done','起動処理が完了しました。');f.data.通知='個別の停止に失敗しました。';await f.refresh();
 assert.equal(f.state.進捗表示.value,null);assert.equal(f.state.通知.value,'個別の停止に失敗しました。');
});

test('batch stop labels distinguish force stop from ordinary individual stop',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {render,source}=require('./ui-components.cjs');
 const state={進捗表示:{value:progress('stop','stop')},更新失敗:{value:false},進捗を閉じる(){}};
 for(const compact of [false,true])for(const kind of ['start','stop']){
  state.進捗表示.value=progress('run',kind);
  const html=await render('components/起動/一括進捗表示.vue',{state,compact});assert.ok(html.includes('<strong>'+(kind==='stop'?'強制停止中…':'一括起動中…')+'</strong>'));
 }
 assert.ok(source('App.vue').includes("起動.一括停止中.value?'強制停止中…'"));
 assert.ok(source('components/起動/起動パネル.vue').includes('停止（Ctrl+C）'));
 assert.ok(source('components/起動/起動状態.mjs').includes("if(item)item.状態='停止中'"));
});

test('pending acceptance names the batch operation while accepted startup retains the force-stop action',async()=>{
 const app=await readFile(new URL('../diag/ui/App.vue',import.meta.url),'utf8');
 const expression=app.match(/\{\{tab==='start'\?\((.*?)\):tab==='manual'/)[1];
 const label=new Function('起動','return '+expression);
 const state={一括停止中:{value:false},処理中:{value:true},進捗表示:{value:progress('request','start')},稼働あり:{value:false}};
 assert.equal(label(state),'一括起動中…');
 state.進捗表示.value=progress('request','stop');assert.equal(label(state),'強制停止中…');
 state.処理中.value=false;state.稼働あり.value=true;state.進捗表示.value=progress('accepted','start');assert.equal(label(state),'強制停止');
 state.一括停止中.value=true;assert.equal(label(state),'強制停止中…');
});
