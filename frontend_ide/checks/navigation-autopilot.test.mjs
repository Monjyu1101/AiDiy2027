// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {runNavigationAutopilot,navigationWait} from '../src/components/開発スペース/Navigation自動運転.js';
const result=progress=>({navigationId:'nav',goal:'goal',items:[{id:'step',name:'work',progress}],overall:{progress},nextItemId:progress<100?'step':null,nextPrompt:progress<100?'Work on step':'',requestId:String(progress)});
function fixture(initial=result(0)){
 const controller=new AbortController(),calls=[];let current=true;
 return {controller,calls,setCurrent:value=>current=value,options:{initial,signal:controller.signal,isCurrent:()=>current,runCode:async text=>calls.push(['code',text]),evaluate:async()=>{calls.push(['evaluate']);return result(100);}}};
}
test('explicit invocation executes prompt then reevaluates and ends at100',async()=>{const f=fixture();assert.equal(f.calls.length,0);assert.match(await runNavigationAutopilot(f.options),/100%/);assert.deepEqual(f.calls,[['code','Work on step'],['evaluate']]);});
test('multiple successful rounds remain ordered and finish without another submit',async()=>{const f=fixture();let n=0;f.options.evaluate=async()=>{f.calls.push(['evaluate']);return result(++n*25);};await runNavigationAutopilot(f.options);assert.equal(n,4);assert.equal(f.calls.length,8);});
test('evaluated reports the overall progress after every evaluation, including reaching100 and the stalled third round',async()=>{
 for(const [scores,expected,stop] of [[[25,25,50,100],[25,25,50,100],false],[[0,0,0],[0,0,0],true]]){
  const f=fixture(),seen=[];let i=0;f.options.evaluate=async()=>result(scores[i++]);f.options.evaluated=({round,progress})=>seen.push([round,progress]);
  if(stop)await assert.rejects(runNavigationAutopilot(f.options),/3回/);else await runNavigationAutopilot(f.options);
  assert.deepEqual(seen,expected.map((progress,index)=>[index+1,progress]));
 }
});
test('evaluation failure or a changed record does not report an evaluation',async()=>{
 const f=fixture(),seen=[];f.options.evaluated=progress=>seen.push(progress);f.options.evaluate=async()=>{throw Error('evaluate failed');};
 await assert.rejects(runNavigationAutopilot(f.options),/evaluate failed/);
 const g=fixture();g.options.evaluated=progress=>seen.push(progress);g.options.evaluate=async()=>({...result(50),navigationId:'other'});
 await assert.rejects(runNavigationAutopilot(g.options),/変わったため停止/);assert.deepEqual(seen,[]);
});
test('100% never submits',async()=>{const f=fixture(result(100));await runNavigationAutopilot(f.options);assert.equal(f.calls.length,0);});
test('abort during Code completion prevents reevaluation and future sends',async()=>{const f=fixture();f.options.runCode=async()=>{f.calls.push(['code']);f.controller.abort();};await assert.rejects(runNavigationAutopilot(f.options),/停止/);assert.deepEqual(f.calls,[['code']]);});
test('scope change after evaluation prevents next Code',async()=>{const f=fixture();f.options.evaluate=async()=>{f.setCurrent(false);return result(50);};await assert.rejects(runNavigationAutopilot(f.options),/停止/);assert.equal(f.calls.length,1);});
test('Code failure does not reevaluate',async()=>{const f=fixture();f.options.runCode=async()=>{throw Error('code failed');};await assert.rejects(runNavigationAutopilot(f.options),/code failed/);assert.equal(f.calls.length,0);});
test('reevaluation failure never retries Code',async()=>{const f=fixture();f.options.evaluate=async()=>{throw Error('evaluate failed');};await assert.rejects(runNavigationAutopilot(f.options),/evaluate failed/);assert.equal(f.calls.length,1);});
test('three cycles without a new best item score stop (including score oscillation)',async()=>{for(const scores of [[0,0,0],[20,0,20,0]]){const f=fixture();let i=0;f.options.evaluate=async()=>result(scores[i++]);await assert.rejects(runNavigationAutopilot(f.options),/3回/);assert.equal(i,scores.length);}});
test('empty or mismatched proposed prompt stops without a send',async()=>{for(const patch of [{nextPrompt:''},{nextItemId:'other'}]){const f=fixture({...result(0),...patch});await assert.rejects(runNavigationAutopilot(f.options),/プロンプト/);assert.equal(f.calls.length,0);}});
test('different navigation record or items cannot continue',async()=>{for(const patch of [{navigationId:'other'},{goal:'other'},{items:[]}]){const f=fixture();f.options.evaluate=async()=>({...result(50),...patch});await assert.rejects(runNavigationAutopilot(f.options),/記録/);assert.equal(f.calls.length,1);}});
test('abortable wait rejects immediately and clears timer',async()=>{const controller=new AbortController();const promise=navigationWait(10000,controller.signal);controller.abort();await assert.rejects(promise,/停止/);});
