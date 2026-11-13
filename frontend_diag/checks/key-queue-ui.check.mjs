// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {dependency,render}=require('./ui-components.cjs');
const {ref}=createRequire(new URL('../ui/package.json',import.meta.url))('vue');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
 const requests=[],timers=new Map();let timerId=0;
 const {キー設定状態を作成}=dependency('components/キー設定共通/キー設定状態.mjs');
 const state=キー設定状態を作成({connected:ref(true),message:ref(''),setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id),api:(url,method,signal)=>{const d=deferred();requests.push({url,method,signal,...d});return d.promise;}});
 return {state,requests,timers,async poll(){const [id,fn]=timers.entries().next().value;timers.delete(id);const done=fn();return {request:requests.at(-1),done};}};
}
test('キー確認: 待機表示からサーバーの実行状態へ移り、完了を遅い進捗で上書きしない',async()=>{
 const f=fixture(),s=f.state;
 const a=s.testKey('openai'),b=s.testKey('gemini'),c=s.testKey('discord');
 assert.equal(s.keyResults.value.discord.状態,'待機中');assert.equal(f.timers.size,1);
 await s.testKey('discord');assert.equal(f.requests.length,3);
 const p=await f.poll();p.request.resolve({項目:[{id:'openai',状態:'確認中'},{id:'gemini',状態:'確認中'},{id:'discord',状態:'待機中'}]});await p.done;
 assert.equal(s.keyResults.value.openai.状態,'確認中');assert.equal(s.keyResults.value.discord.状態,'待機中');
 const late=await f.poll();f.requests[0].resolve({id:'openai',状態:'OK'});await a;
 late.request.resolve({項目:[{id:'openai',状態:'確認中'},{id:'discord',状態:'確認中'}]});await late.done;
 assert.equal(s.keyResults.value.openai.状態,'OK');assert.equal(s.keyResults.value.discord.状態,'確認中');
 f.requests[1].resolve({id:'gemini',状態:'OK'});f.requests[2].resolve({id:'discord',状態:'OK'});await Promise.all([b,c]);assert.equal(f.timers.size,0);s.終了();
});
test('キー確認: reset は待機・実行・進捗リクエストをabortし、旧応答は新世代に混ぜない',async()=>{
 const f=fixture(),s=f.state;
 const a=s.testKey('openai'),b=s.testKey('discord');const poll=await f.poll();
 s.設定を破棄();assert.ok(f.requests.every(r=>r.signal.aborted));assert.equal(s.keyTestingIds.value.size,0);assert.equal(f.timers.size,0);
 const next=s.testKey('openai');poll.request.resolve({項目:[{id:'openai',状態:'確認中'}]});await poll.done;
 f.requests[0].resolve({id:'openai',状態:'NG'});f.requests[1].resolve({id:'discord',状態:'NG'});await Promise.all([a,b]);
 assert.equal(s.keyResults.value.openai.状態,'待機中');assert.equal(s.keyTestingIds.value.size,1);
 f.requests[3].resolve({id:'openai',状態:'OK'});await next;assert.equal(s.keyResults.value.openai.状態,'OK');s.終了();
});
test('キー確認: 失敗時は待機表示とロックを解除し、別行は維持する',async()=>{
 const f=fixture(),s=f.state,a=s.testKey('discord'),b=s.testKey('openai');
 f.requests[0].reject(Error('通信失敗'));await a;assert.equal(s.keyResults.value.discord,undefined);assert.equal(s.keyTestingIds.value.has('discord'),false);assert.equal(s.keyTestingIds.value.has('openai'),true);
 f.requests[1].resolve({id:'openai',状態:'OK'});await b;assert.equal(f.timers.size,0);s.終了();
});
test('キー確認: 進捗取得失敗後も再取得しPOSTの成功結果を採用する',async()=>{
 const f=fixture(),s=f.state,a=s.testKey('discord');const p=await f.poll();p.request.reject(Error('poll unavailable'));await p.done;
 assert.equal(f.timers.size,1);f.requests[0].resolve({id:'discord',状態:'OK'});await a;assert.equal(s.keyResults.value.discord.状態,'OK');assert.equal(f.timers.size,0);s.終了();
});
test('モデル・外部連携: 待機中のボタン・バッジは確認中と区別する',async()=>{
 for(const [panel,id] of [['モデル一覧','openai'],['外部連携','discord']]){
  const html=await render(`components/${panel}/${panel}パネル.vue`,{connected:true,data:{設定状態:'読込済み',項目:[{id,名前:id,テスト可能:true}]},results:{[id]:{id,状態:'待機中'}},testing:id,testingIds:new Set([id])});
  assert.match(html,/<button[^>]*class="single-test-button"[^>]*disabled[^>]*>待機中…<\/button>/);assert.match(html,/data-state="待機中" data-tone="pending"/);
 }
});
test('一括確認: reset後の新実行を旧finallyで解除せず、設定読込を開始できない場合はロックを残さない',async()=>{
 const f=fixture(),s=f.state;
 const data={項目:[{id:'discord',テスト可能:true}]};s.keyData.value=data;
 const old=s.外部連携確認({再読込:false});assert.equal(s.integrationBusy.value,true);
 s.設定を破棄();s.keyData.value=data;const next=s.外部連携確認({再読込:false});
 f.requests[0].resolve({id:'discord',状態:'OK'});await old;assert.equal(s.integrationBusy.value,true);
 f.requests[1].resolve({id:'discord',状態:'OK'});await next;assert.equal(s.integrationBusy.value,false);
 s.modelWriteBusy.value=true;await s.一覧再取得();assert.equal(s.latestBusy.value,false);s.終了();
});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('モデル一括20行: 設定読込1回・POST最大2件と進捗1件、FIFO・失敗後続行',async()=>{
 const f=fixture(),s=f.state,ids=Array.from({length:20},(_,i)=>`model${i}`);
 const batch=s.一覧再取得();assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].url,'api/キー設定/モデル一覧');
 f.requests[0].resolve({項目:ids.map(id=>({id,テスト可能:true}))});await flush();
 const posts=()=>f.requests.filter(r=>r.method==='POST');
 assert.equal(posts().length,2);assert.equal(s.keyTestingIds.value.size,20);assert.equal(s.keyResults.value.model19.状態,'待機中');
 const poll=await f.poll();assert.equal(f.requests.filter(r=>r.url==='api/キーテスト/進捗').length,1);assert.equal(f.timers.size,0);
 for(let i=0;i<ids.length;i++){
  assert.equal(posts()[i].url,`api/キーテスト/${ids[i]}`);
  assert.equal(posts().length-i,Math.min(2,ids.length-i),'未完了POSTは常に最大2件');
  if(i===5)posts()[i].reject(Error('合成通信失敗'));else posts()[i].resolve({id:ids[i],状態:'OK'});
  await flush();
 }
 await batch;assert.equal(s.latestBusy.value,false);assert.equal(s.keyTestingIds.value.size,0);assert.equal(s.keyResults.value.model19.状態,'OK');assert.equal(s.keyResults.value.model5,undefined);
 assert.ok(poll.request.signal.aborted);poll.request.resolve({項目:[{id:'model19',状態:'確認中'}]});await poll.done;assert.equal(s.keyResults.value.model19.状態,'OK');
 assert.equal(f.requests.filter(r=>r.url==='api/キー設定/モデル一覧').length,1);s.終了();
});
test('一括reset: 未送信18行は送信せず、旧世代の残りを新結果へ混ぜない',async()=>{
 const f=fixture(),s=f.state,batch=s.一覧再取得();
 f.requests[0].resolve({項目:Array.from({length:20},(_,i)=>({id:`model${i}`,テスト可能:true}))});await flush();
 assert.equal(f.requests.filter(r=>r.method==='POST').length,2);s.設定を破棄();
 assert.ok(f.requests[1].signal.aborted && f.requests[2].signal.aborted);
 f.requests[1].resolve({id:'model0',状態:'OK'});f.requests[2].resolve({id:'model1',状態:'OK'});await batch;
 assert.equal(f.requests.filter(r=>r.method==='POST').length,2);assert.equal(s.keyTestingIds.value.size,0);assert.equal(Object.keys(s.keyResults.value).length,0);assert.equal(s.latestBusy.value,false);assert.equal(f.timers.size,0);
});
test('外部連携一括も同じ2件FIFOで送信し、全件完了まで一括ロックを維持する',async()=>{
 const f=fixture(),s=f.state,ids=['huggingface_read','huggingface_write','discord'];
 const batch=s.外部連携確認();assert.equal(f.requests[0].url,'api/キー設定/外部連携');f.requests[0].resolve({項目:ids.map(id=>({id,テスト可能:true}))});await flush();
 assert.equal(f.requests.length,3);assert.equal(s.keyResults.value.discord.状態,'待機中');
 f.requests[1].resolve({id:ids[0],状態:'OK'});await flush();assert.equal(f.requests[3].url,'api/キーテスト/discord');assert.equal(s.integrationBusy.value,true);
 f.requests[2].resolve({id:ids[1],状態:'OK'});f.requests[3].resolve({id:ids[2],状態:'OK'});await batch;assert.equal(s.integrationBusy.value,false);assert.equal(s.keyResults.value.discord.状態,'OK');s.終了();
});
