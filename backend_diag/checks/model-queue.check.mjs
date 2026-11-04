// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createModelRunner,testKey} from '../モデル情報/key_status.mjs';
import {createHandler} from '../diag_main.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(){
 const runner=createModelRunner(),started=[],gates=new Map(),states=[];
 const run=(action,id,options={})=>runner.run(action,id,{...options,reader:async()=>{started.push(id||action);const gate=deferred();gates.set(id||action,gate);return gate.promise;},fetch:async provider=>{assert.equal(provider,'discord');return {id:'fixture-bot',bot:true,username:'fixture'};}});
 const check=(id,extra={})=>testKey(id,{...extra,run:(a,i,o)=>run(a,i,{...o,...extra}),onState:state=>states.push([id,state])});
 return {runner,run,check,started,gates,states};
}
test('real testKey and runner: FIFO shares two slots across keys/status, third Discord waits instead of busy',async()=>{
 const f=fixture();const a=f.check('openai'),b=f.check('gemini'),c=f.check('discord'),d=f.run('status');
 await flush();assert.deepEqual(f.started,['openai','gemini']);assert.deepEqual(f.states.filter(([id])=>id==='discord'),[['discord','待機中']]);
 f.gates.get('gemini').resolve('{}');await b;await flush();assert.deepEqual(f.started,['openai','gemini','discord']);
 assert.deepEqual(f.states.filter(([id])=>id==='discord'),[['discord','待機中'],['discord','確認中']]);
 f.gates.get('openai').resolve('{}');await a;await flush();assert.deepEqual(f.started,['openai','gemini','discord','status']);
 f.gates.get('discord').resolve('{}');const result=await c;assert.doesNotMatch(result.説明,/別のキー確認/);
 f.gates.get('status').resolve('{}');assert.ok((await d).data);f.runner.cancel();
});
test('queued time is excluded from per-operation timeout; timed-out slots release',async()=>{
 const f=fixture();const a=f.check('openai',{timeout:500}),b=f.check('gemini',{timeout:500});
 const c=f.check('discord',{timeout:30});await delay(65);assert.deepEqual(f.started,['openai','gemini']);
 f.gates.get('openai').resolve('{}');await a;await flush();assert.equal(f.started.at(-1),'discord');
 f.gates.get('discord').resolve('{}');assert.doesNotMatch((await c).説明,/タイムアウト/);
 const timeout=f.check('claude',{timeout:10});await timeout;const next=f.check('freeai');await flush();assert.equal(f.started.at(-1),'freeai');
 f.gates.get('freeai').resolve('{}');await next;f.runner.cancel();await b;
});
test('queue abort removes work; duplicate shares a job; shutdown settles all without starting queued readers',async()=>{
 const f=fixture(),abort=new AbortController();const a=f.check('openai'),duplicate=f.check('openai'),b=f.check('gemini');
 const c=f.check('discord',{signal:abort.signal}),d=f.check('claude');await flush();assert.deepEqual(f.started,['openai','gemini']);
 abort.abort();assert.match((await c).説明,/終了/);f.runner.cancel();await Promise.all([a,duplicate,b,d]);assert.deepEqual(f.started,['openai','gemini']);
 assert.equal((await f.run('status')).error,'stopped');
});
function request(handler,path,method='POST'){
 const res=new EventEmitter();res.writeHead=status=>{res.status=status;};res.end=bytes=>{res.writableEnded=true;res.body=JSON.parse(bytes);};
 return {res,promise:handler({url:'/api/'+path,method,headers:{authorization:'Bearer fixture'}},res).then(()=>res)};
}
test('HTTP with real testKey/runner: progress, same-key rejection, disconnect cancellation and no saved busy Discord',async()=>{
 const f=fixture();let saved;
 const handler=createHandler({token:'fixture',keyTestFn:(id,options)=>testKey(id,{...options,run:f.run}),keyStatusFn:async()=>({項目:[{id:'discord'}]}),integrationWriteFn:async (_items,results)=>{saved=results;return {};}});
 const a=request(handler,'キーテスト/openai'),b=request(handler,'キーテスト/gemini'),c=request(handler,'キーテスト/discord');await flush();
 assert.equal((await request(handler,'キーテスト/discord').promise).status,409);
 const progress=(await request(handler,'キーテスト/進捗','GET').promise).body.項目;
 assert.deepEqual(progress,[{id:'openai',状態:'確認中'},{id:'gemini',状態:'確認中'},{id:'discord',状態:'待機中'}]);
 a.res.emit('close');await a.promise;await flush();assert.equal(f.started.at(-1),'discord');
 f.gates.get('gemini').resolve('{}');f.gates.get('discord').resolve(JSON.stringify({discord_bot_token:'fixture-token'}));await Promise.all([b.promise,c.promise]);
 assert.doesNotMatch(c.res.body.説明,/別のキー確認/);
 assert.deepEqual((await request(handler,'キーテスト/進捗','GET').promise).body.項目,[]);
 await request(handler,'外部連携書込').promise;assert.equal(saved.discord.状態,'OK');assert.doesNotMatch(JSON.stringify(saved),/別のキー確認/);
 f.runner.cancel();
});
test('queued HTTP disconnect never executes or persists that operation',async()=>{
 const f=fixture();const handler=createHandler({token:'fixture',keyTestFn:(id,options)=>testKey(id,{...options,run:f.run})});
 const a=request(handler,'キーテスト/openai'),b=request(handler,'キーテスト/gemini'),c=request(handler,'キーテスト/discord');await flush();c.res.emit('close');await c.promise;
 f.gates.get('openai').resolve('{}');f.gates.get('gemini').resolve('{}');await Promise.all([a.promise,b.promise]);assert.deepEqual(f.started,['openai','gemini']);assert.equal(c.res.body,undefined);f.runner.cancel();
});
test('provider failure and a throwing progress observer release the slot for the next key',async()=>{
 const runner=createModelRunner(),gates=[deferred(),deferred()],started=[];
 const run=(action,id,options)=>runner.run(action,id,{...options,reader:async()=>JSON.stringify({openai_key_id:'fixture-token',gemini_key_id:'fixture-token',discord_bot_token:'fixture-token'}),fetch:async provider=>{started.push(provider);if(provider==='openai'){await gates[0].promise;throw Error('fixture failure');}if(provider==='google'){await gates[1].promise;return {models:[]};}return {bot:true,username:'fixture'};}});
 const a=testKey('openai',{run,onState:()=>{throw Error('display failure');}}),b=testKey('gemini',{run}),c=testKey('discord',{run});
 await flush();assert.deepEqual(started,['openai','google']);gates[0].resolve();assert.equal((await a).状態,'NG');assert.equal((await c).状態,'OK');assert.deepEqual(started,['openai','google','discord']);gates[1].resolve();await b;runner.cancel();
});
test('two HTTP clients share the runner capacity instead of each starting two operations',async()=>{
 const f=fixture(),options={token:'fixture',keyTestFn:(id,opts)=>testKey(id,{...opts,run:f.run})};
 const one=createHandler(options),two=createHandler(options);
 const a=request(one,'キーテスト/openai'),b=request(one,'キーテスト/gemini'),c=request(two,'キーテスト/discord');await flush();
 assert.deepEqual(f.started,['openai','gemini']);assert.deepEqual((await request(two,'キーテスト/進捗','GET').promise).body.項目,[{id:'discord',状態:'待機中'}]);
 f.gates.get('openai').resolve('{}');await a.promise;await flush();assert.equal(f.started.at(-1),'discord');
 f.gates.get('gemini').resolve('{}');f.gates.get('discord').resolve('{}');await Promise.all([b.promise,c.promise]);f.runner.cancel();
});
