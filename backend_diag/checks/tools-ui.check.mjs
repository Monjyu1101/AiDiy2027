// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {Tools接続を作成} from '../diag/ui/components/ウィンドウ/Tools接続.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Tools UI polls only when connected and enabled; off/disconnect abort stale result',async()=>{
 const calls=[],states=[],timers=[];let cleared=0;
 const tools=Tools接続を作成({api:(...args)=>new Promise(resolve=>calls.push({args,resolve})),反映:s=>states.push(s),setTimer:fn=>{timers.push(fn);return timers.length;},clearTimer:()=>cleared++});
 await tools.refresh();assert.equal(calls.length,0);
 tools.接続(true);assert.equal(calls.length,1);assert.deepEqual(calls[0].args.slice(0,2),['api/tools-status','GET']);
 calls[0].resolve({online:true});await tick();assert.equal(states.at(-1).online,true);assert.equal(timers.length,1);
 timers[0]();tools.有効(false);assert.equal(calls[1].args[2].aborted,true);calls[1].resolve({online:true});await tick();assert.equal(states.at(-1).online,false);
 tools.有効(true);tools.接続(false);assert.equal(calls[2].args[2].aborted,true);calls[2].resolve({online:true});await tick();assert.equal(states.at(-1).online,false);
 tools.接続(true);tools.終了();calls[3].resolve({online:true});await tick();assert.equal(states.at(-1).online,false);assert.ok(cleared>0);
});
test('manual refresh replaces old request; failure clears cyan readiness and retries',async()=>{
 const calls=[],states=[],timers=[];
 const tools=Tools接続を作成({api:()=>new Promise((resolve,reject)=>calls.push({resolve,reject})),反映:s=>states.push(s),setTimer:fn=>timers.push(fn),clearTimer(){}});
 tools.接続(true);const refresh=tools.refresh();calls[0].resolve({online:true});calls[1].reject(Error('offline'));await refresh;assert.equal(states.at(-1).online,false);assert.equal(timers.length,1);
 const poll=timers[0]();calls[2].resolve({online:true});await poll;assert.equal(states.at(-1).online,true);tools.終了();
});
