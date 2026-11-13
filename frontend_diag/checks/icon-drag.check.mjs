// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {アイコン移動} from '../diag/ui/components/アプリ起動/アイコン移動.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function setup(begin=async()=> 'owned'){
 const calls=[],target={setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){}};
 const api={beginMicroMove:begin,moveMicro:async token=>{calls.push(['move',token]);return true;},endMicroMove:async token=>calls.push(['end',token])};
 const drag=アイコン移動(api,{開始:()=>calls.push(['start']),終了:()=>calls.push(['stop'])});
 const event=(x=0)=>({button:0,buttons:1,pointerId:1,currentTarget:target,screenX:x,screenY:0,preventDefault(){}});
 return {calls,drag,event};
}
test('短いクリックと微小な揺れでは窓移動もクリック抑止もしない',async()=>{
 const {drag,event,calls}=setup();drag.down(event());await drag.move(event(2));drag.finish(event(2));
 assert.ok(!calls.some(c=>c[0]==='move'||c[0]==='start'));assert.equal(drag.click(),false);assert.equal(drag.double(),false);
});
test('4pxのドラッグで直ちに移動し、解放後の展開・ダブルクリックを抑止',async()=>{
 const {drag,event,calls}=setup();drag.down(event());await drag.move(event(5));await sleep(30);drag.finish(event(30));
 assert.equal(calls[0][0],'start');assert.ok(calls.some(c=>c[0]==='move'));assert.deepEqual(calls.at(-1),['end','owned']);
 assert.equal(drag.click(),true);assert.equal(drag.click(),false);assert.equal(drag.double(),true);
 const count=calls.length;await sleep(30);assert.equal(calls.length,count);
});
test('押下を解放した後に遅れて届く移動トークンを終了し、窓を動かさない',async()=>{
 let resolve;const {drag,event,calls}=setup(()=>new Promise(r=>resolve=r));
 drag.down(event());const pending=drag.move(event(5));drag.finish(event());resolve('late');await pending;
 assert.ok(!calls.some(c=>c[0]==='move'));assert.deepEqual(calls.at(-1),['end','late']);
});
test('速いドラッグのpointerupは、開始IPC待ちでも最後の移動を反映して終了する',async()=>{
 let resolve;const {drag,event,calls}=setup(()=>new Promise(r=>resolve=r));
 drag.down(event());const pending=drag.move(event(36));drag.finish({...event(36),type:'pointerup'});resolve('fast');await pending;
 assert.deepEqual(calls.slice(-2),[['move','fast'],['end','fast']]);assert.equal(drag.click(),true);
});
