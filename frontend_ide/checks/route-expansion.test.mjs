// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouteExpansion} from '../src/components/ファイル閲覧/軌跡パネル展開.js';
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function fixture(){
 let now=0,id=0,reduced=false,available=300,hold=false;const tasks=new Map(),changes=[],reserved=[],pending=[],errors=[];
 const motion=createRouteExpansion({measure:()=>({bar:68,target:300,available}),reserve:height=>{reserved.push(height);return hold?new Promise(resolve=>pending.push(resolve)):Promise.resolve({height:Math.min(height,available+68)});},changed:value=>changes.push(value),report:value=>errors.push(value),reduced:()=>reduced,schedule:(fn,delay)=>{tasks.set(++id,{fn,at:now+delay});return id;},cancel:id=>tasks.delete(id)});
 return{motion,tasks,changes,reserved,pending,errors,hold:value=>hold=value,reduced:value=>reduced=value,available:value=>available=value,async advance(ms){now+=ms;for(const [key,task]of [...tasks])if(task.at<=now){tasks.delete(key);task.fn();}await flush();}};
}
test('透明領域確保→高さ展開→本文表示。閉じる時は本文を隠し、展開完了後に窓を縮小',async()=>{
 const f=fixture();f.hold(true);const opening=f.motion.set(true);assert.equal(f.motion.state.phase,'preparing');assert.equal(f.motion.state.height,0);assert.deepEqual(f.reserved,[368]);
 f.pending.shift()({height:368});await opening;await f.advance(32);assert.deepEqual(f.motion.state,{height:300,visible:false,phase:'opening'});
 await f.advance(260);assert.equal(f.motion.state.visible,false);await f.advance(34);assert.equal(f.motion.state.visible,true);
 f.hold(false);void f.motion.set(false);assert.equal(f.motion.state.height,0);assert.equal(f.motion.state.visible,false);assert.equal(f.reserved.length,1);await f.advance(294);assert.equal(f.reserved.at(-1),68);assert.equal(f.motion.state.phase,'closed');
});
test('連打・途中反転・古い領域確保応答は最後の状態だけ表示し、分類だけの変更で再展開しない',async()=>{
 const f=fixture();f.hold(true);const old=f.motion.set(true);await f.motion.set(true);assert.equal(f.pending.length,1);
 void f.motion.set(false);const closing=f.pending.pop();closing({height:68});await flush();f.pending.shift()({height:368});await old;await f.advance(1000);assert.equal(f.motion.state.visible,false);
 f.hold(false);await f.motion.set(true);await f.advance(32);const late=[...f.tasks.values()][0].fn;void f.motion.set(false);await f.advance(100);await f.motion.set(true);late();assert.equal(f.motion.state.visible,false);await f.advance(32);await f.advance(294);assert.equal(f.motion.state.visible,true);
 const count=f.reserved.length;await f.motion.set(true);assert.equal(f.reserved.length,count);assert.equal(f.tasks.size,0);
});
test('画面下端・旧省略指定でも展開し、reload再接続・X/破棄は遅延応答を残さない',async()=>{
 const f=fixture();f.available(42);f.reduced(true);await f.motion.set(true);assert.equal(f.motion.state.phase,'preparing');await f.advance(32);assert.equal(f.motion.state.phase,'opening');await f.advance(294);assert.deepEqual(f.motion.state,{height:42,visible:true,phase:'open'});assert.equal(f.tasks.size,0);
 f.available(20);f.motion.refresh();assert.equal(f.motion.state.height,20);
 f.reduced(false);await f.motion.set(true,{restart:true});assert.equal(f.motion.state.height,0);assert.equal(f.motion.state.visible,false);
 f.motion.dispose();await f.advance(2000);assert.equal(f.tasks.size,0);assert.equal(f.motion.state.visible,false);await f.motion.set(true);assert.equal(f.tasks.size,0);
});
