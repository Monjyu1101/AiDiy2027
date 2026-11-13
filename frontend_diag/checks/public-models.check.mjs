// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createPublicModelCache as createCache} from '../diag/モデル情報/public_models.mjs';
const noBundle=async()=>{throw Error('no bundle');};
const createPublicModelCache=(options={})=>createCache({loadBundled:noBundle,...options});
const success={data:{状態:'OK',公開モデル:{'google/example':{model_id:'google/example',作成日:'2026/10/01',トークン数:'100',モダリティ:'text'}},確認日時:'2026-10-15T00:00:00Z'}};
test('public cache stays independent, uses anonymous-only action once and reuses snapshot',async()=>{
 const calls=[];const cache=createPublicModelCache({run:async(...args)=>{calls.push(args);return success;}});
 assert.equal(cache.snapshot().状態,'未取得');assert.deepEqual(cache.input(),{公開モデル:{},公開状態:'未取得',確認日時:null});
 await cache.refresh();assert.deepEqual(calls,[['public']]);assert.equal(cache.snapshot().状態,'取得済');assert.equal(cache.snapshot().件数,1);assert.equal(cache.input().確認日時,cache.snapshot().確認日時);assert.equal(cache.input().公開モデル['google/example'].作成日,'2026/10/01');
 for(let i=0;i<4;i++)cache.input();assert.equal(calls.length,1);
});
test('startup retrieval is nonblocking, single-flight and distinguishable while pending',async()=>{
 let release,calls=0;const cache=createPublicModelCache({run:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
 const first=cache.refresh();assert.equal(cache.snapshot().状態,'取得中');assert.equal(cache.refresh(),first);assert.equal(calls,1);assert.deepEqual(cache.input().公開モデル,{});
 release(success);await first;assert.equal(cache.snapshot().状態,'取得済');assert.equal(cache.snapshot().世代,2);
 const source=await readFile(new URL('../diag/diag_main.mjs',import.meta.url),'utf8');assert.equal((source.match(/void publicCache.refresh\(\)/g)||[]).length,1);
});
test('failure invalidates old success and explicit retry can recover',async()=>{
 let result=success;const cache=createPublicModelCache({run:async()=>result});await cache.refresh();result={error:'timeout'};await cache.refresh();assert.equal(cache.snapshot().状態,'失敗');assert.equal(cache.snapshot().件数,0);assert.deepEqual(cache.input().公開モデル,{});
 result=success;await cache.refresh();assert.equal(cache.snapshot().状態,'取得済');
});
test('malformed or failed data never shows successful acquisition',async()=>{
 for(const result of [{data:{状態:'NG',公開モデル:{}}},{data:{状態:'OK',公開モデル:[]}},{data:{状態:'OK'}}]){const cache=createPublicModelCache({run:async()=>result});await cache.refresh();assert.equal(cache.snapshot().状態,'失敗');}
});
test('public cache ignores arbitrary error details in output and diagnostic logs',async()=>{
 for(const result of [{error:'synthetic-secret'},{data:{状態:'NG',失敗理由:'synthetic-secret',説明:'synthetic-secret'}}]){
  const logs=[];const cache=createPublicModelCache({run:async()=>result,warn:message=>logs.push(message)});
  await cache.refresh();assert.equal(cache.snapshot().状態,'失敗');assert.ok(!JSON.stringify([cache.snapshot(),logs]).includes('synthetic-secret'));
 }
});
test('network failure falls back to the bundled list with the same filtering and marks the cache source',async()=>{
 const calls=[],logs=[];const body={data:[{id:'other/new'}]};
 const cache=createPublicModelCache({warn:m=>logs.push(m),loadBundled:async()=>body,run:async(action,id,options)=>{calls.push(options);if(!options)return {error:'network'};assert.equal(action,'public');assert.deepEqual(await options.fetch('openrouter',{}),body);return success;}});
 const snapshot=await cache.refresh();
 assert.equal(calls.length,2);assert.equal(snapshot.状態,'取得済');assert.equal(snapshot.取得元,'キャッシュ');assert.match(snapshot.説明,/同梱の公開モデル一覧（キャッシュ）/);
 assert.equal(cache.input().公開状態,'取得済');assert.ok(cache.input().公開モデル['google/example']);assert.ok(logs.some(m=>m.includes('同梱キャッシュ')));
});
test('network success never reads the bundle; stopped or broken bundle stays failed',async()=>{
 let bundled=0;const load=async()=>{bundled++;return {data:[]};};
 const ok=createPublicModelCache({loadBundled:load,run:async()=>success});assert.equal((await ok.refresh()).取得元,'ネットワーク');assert.equal(bundled,0);
 const stopped=createPublicModelCache({loadBundled:load,run:async()=>({error:'stopped'})});const s=await stopped.refresh();assert.equal(s.状態,'失敗');assert.equal(s.取得元,null);assert.equal(bundled,0);
 const broken=createPublicModelCache({run:async()=>({error:'network'})});const b=await broken.refresh();assert.equal(b.状態,'失敗');assert.equal(b.取得元,null);assert.deepEqual(broken.input().公開モデル,{});
});
