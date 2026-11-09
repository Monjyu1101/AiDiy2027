// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {browserAnalysisPageKey,createBrowserAnalysisStatus,notifyBrowserAnalysisChanged} from '../src/components/ブラウザ/ブラウザ解析状態.js';
const a='http://localhost:8090/form?mode=one#/page',b='http://localhost:8090/form?mode=two#/page';
const flush=async()=>{for(let n=0;n<15;n++)await Promise.resolve();};
function fixture(){
 const requests=[],updates=[],timers=new Map();let id=0;
 const monitor=createBrowserAnalysisStatus({read:(url,signal)=>new Promise((resolve,reject)=>requests.push({url,signal,resolve,reject})),changed:value=>updates.push(value),setTimer:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimer:id=>timers.delete(id)});
 return{monitor,requests,updates,timers,get last(){return updates.at(-1);},reply(data,index=requests.length-1){requests[index].resolve(data);},tick(){const [id,{fn}]=timers.entries().next().value;timers.delete(id);fn();}};
}
test('Browser解析状態: 別URLへ移動でGET購読だけ解除し、元URLへ戻ると待機・完了を再取得する',async()=>{
 const f=fixture();f.monitor.setPage(a,true,'tab-1');f.reply({url:a,result:null,job:{id:'a',url:a,status:'waiting'}});await flush();assert.equal(f.last.status,'waiting');assert.equal(f.timers.size,1);
 f.monitor.setPage(b,true,'tab-1');assert.equal(f.requests[0].signal.aborted,true);assert.equal(f.timers.size,0);f.reply({url:b,result:null,job:null});await flush();assert.equal(f.last.status,'idle');
 f.monitor.setPage(a,true,'tab-1');f.reply({url:a,result:{id:'done-a',url:a},job:{status:'complete'}});await flush();assert.equal(f.last.status,'complete');assert.equal(f.last.resultId,'done-a');assert.equal(f.timers.size,0);f.monitor.dispose();
});
test('Browser解析状態: A→B→A・同じURLのセッション変更・別窓の遅い応答を取り違えない',async()=>{
 const f=fixture(),other=fixture();f.monitor.setPage(a,true,'old');f.monitor.setPage(b,true,'old');f.monitor.setPage(a,true,'new');other.monitor.setPage(b,true,'other');
 f.reply({url:a,result:{id:'old-a',url:a}},0);f.reply({url:b,job:{status:'waiting'}},1);await flush();assert.equal(f.last.status,'idle');assert.equal(f.last.url,a);
 other.reply({url:b,result:{id:'done-b',url:b}});f.reply({url:a,job:{id:'new-a',status:'waiting'}});await flush();assert.equal(f.last.jobId,'new-a');assert.equal(other.last.resultId,'done-b');
 f.monitor.dispose();other.monitor.dispose();assert.equal(f.timers.size,0);assert.equal(other.timers.size,0);
});
test('Browser解析状態: 実行中の通信失敗は再確認し、失敗・期限切れと前回の保存結果を区別する',async()=>{
 const f=fixture();f.monitor.setPage(a);f.reply({url:a,job:{status:'waiting'}});await flush();f.tick();f.requests.at(-1).reject(Error('network'));await flush();assert.equal(f.last.status,'unavailable');assert.equal([...f.timers.values()][0].delay,10000);
 f.tick();f.reply({url:a,result:{id:'previous',url:a},job:{id:'failed',status:'timeout',message:'期限切れ'}});await flush();assert.equal(f.last.status,'failed');assert.equal(f.last.resultId,'previous');assert.equal(f.last.message,'期限切れ');assert.equal(f.timers.size,0);f.monitor.dispose();
});
test('Browser解析状態: 切断・破棄で購読停止し、再表示時は復元。異なるURLの結果を受け付けない',async()=>{
 const f=fixture();f.monitor.setPage(a);f.monitor.setPage(a,false);f.reply({url:a,result:{id:'late'}});await flush();assert.equal(f.last.status,'idle');assert.equal(f.last.url,'');
 f.monitor.setPage(a,true);f.reply({url:b,result:{id:'wrong',url:b}});await flush();assert.equal(f.last.status,'unavailable');assert.equal(f.last.resultId,undefined);
 const reading=f.monitor.refresh();f.monitor.dispose();f.reply({url:a,job:{status:'waiting'}});await reading;assert.equal(f.timers.size,0);assert.equal(f.last.status,'unavailable');const count=f.requests.length;f.monitor.setPage(b);await f.monitor.refresh();assert.equal(f.requests.length,count);
});
test('Browser解析状態: URLのquery/hashを別対象として保持し、秘密URL・未対応ページを照会しない',()=>{
 assert.notEqual(browserAnalysisPageKey(a),browserAnalysisPageKey(b));assert.notEqual(browserAnalysisPageKey(a),browserAnalysisPageKey(a.replace('#/page','#/other')));
 assert.equal(browserAnalysisPageKey('HTTP://LOCALHOST:8090/%e6%bc%a2'),'http://localhost:8090/%E6%BC%A2');
 assert.equal(browserAnalysisPageKey('file:///tmp/%e6%bc%a2%20%25.html'),'file:///tmp/%E6%BC%A2%20%25.html');
 for(const url of ['about:blank','javascript:alert(1)','https://example.test/?token=secret','https://u:p@example.test/','file://foreign/tmp/a.html','file:///tmp/a.html?token=secret'])assert.equal(browserAnalysisPageKey(url),'');
 const f=fixture();f.monitor.setPage('about:blank');assert.equal(f.requests.length,0);f.monitor.dispose();
});

test('Browser解析状態: 元ページへ戻った最初の取得失敗も再試行して処理中を復元する',async()=>{
 const f=fixture();f.monitor.setPage(a);f.reply({url:a,job:{status:'waiting'}});await flush();
 f.monitor.setPage(b);f.reply({url:b,job:null});await flush();f.monitor.setPage(a);f.requests.at(-1).reject(Error('network'));await flush();
 assert.equal(f.last.status,'unavailable');assert.equal([...f.timers.values()][0].delay,10000);
 f.tick();f.reply({url:a,job:{id:'still-running',status:'waiting'}});await flush();assert.equal(f.last.status,'waiting');assert.equal(f.last.jobId,'still-running');f.monitor.dispose();
});

test('Browser解析状態: URL通知は非同期でも届き、別ページ・非表示・破棄後には照会しない',async t=>{
 const name='browser-analysis-'+crypto.randomUUID(),factory=()=>new BroadcastChannel(name),updates=[],requests=[];
 let status='idle';const monitor=createBrowserAnalysisStatus({channelFactory:factory,read:async url=>{requests.push(url);return{url,job:status==='waiting'?{status}:null};},changed:value=>updates.push(value)});t.after(()=>monitor.dispose());
 const until=async check=>{for(let n=0;n<100;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('解析状態通知が届きません。');};
 monitor.setPage(a);await flush();assert.equal(requests.length,1);
 status='waiting';notifyBrowserAnalysisChanged(a,factory);await until(()=>updates.at(-1)?.status==='waiting');assert.equal(requests.length,2);
 notifyBrowserAnalysisChanged(b,factory);notifyBrowserAnalysisChanged('https://example.test/?token=secret',factory);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(requests.length,2);
 monitor.setPage(a,false);notifyBrowserAnalysisChanged(a,factory);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(requests.length,2);
 monitor.dispose();notifyBrowserAnalysisChanged(a,factory);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(requests.length,2);
});
