// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFolderMonitor } from '../src/components/ファイル閲覧/フォルダ監視.js';
const flush = async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function harness() {
  let now=0, id=0; const tasks=new Map(), calls=[], applied=[], messages=[];
  const monitor=createFolderMonitor({schedule:(fn,delay)=>{tasks.set(++id,{fn,at:now+delay});return id;},cancel:key=>tasks.delete(key),
    fetch:(url,options)=>new Promise(resolve=>calls.push({url,options,resolve})),
    apply:(context,result)=>{applied.push([context,result]);return true;},report:message=>messages.push(message)});
  const advance=async ms=>{now+=ms;for(const [key,item] of [...tasks])if(item.at<=now){tasks.delete(key);item.fn();}await flush();};
  const respond=async(index,result)=>{calls[index].resolve({ok:true,json:async()=>result});await flush();};
  return {monitor,calls,applied,messages,tasks,advance,respond};
}
const context={enabled:true,path:'src',filter:'backup',session:1};
const result={revision:'a',files:1,latest:10,tree:{n:'src',f:[],d:[]}};
test('監視: 同じ条件は共有し、応答完了から30秒後だけ次回を予約、変更なしは再適用しない',async()=>{
 const h=harness();h.monitor.configure(context);h.monitor.configure(context);await h.advance(9000);assert.equal(h.calls.length,1);
 await h.respond(0,result);assert.equal(h.applied.length,1);await h.advance(29999);assert.equal(h.calls.length,1);await h.advance(1);assert.equal(h.calls.length,2);assert.match(h.calls[1].url,/since=a/);
 await h.respond(1,{revision:'a',files:1});assert.equal(h.applied.length,1);h.monitor.close();assert.equal(h.tasks.size,0);
});
test('監視: 切替・OFF・終了後の遅延応答を破棄し、復帰は新しい基準から始める',async()=>{
 const h=harness();h.monitor.configure(context);h.monitor.configure({...context,path:'other'});
 assert.equal(h.calls[0].options.signal.aborted,true);await h.respond(0,result);assert.equal(h.applied.length,0);
 h.monitor.configure({...context,enabled:false});assert.equal(h.calls[1].options.signal.aborted,true);await h.respond(1,result);await h.advance(30000);assert.equal(h.calls.length,2);
 h.monitor.configure(context);assert.doesNotMatch(h.calls[2].url,/since=/);h.monitor.close();await h.respond(2,result);assert.equal(h.applied.length,0);assert.equal(h.tasks.size,0);
});
test('監視: 大規模走査も30秒待ち、不完全結果と削除済みフォルダで一覧を壊さない',async()=>{
 const h=harness();h.monitor.configure(context);await h.respond(0,{...result,elapsedMs:4000});await h.advance(29999);assert.equal(h.calls.length,1);await h.advance(1);assert.equal(h.calls.length,2);
 await h.respond(1,{...result,revision:'b',truncated:true});assert.equal(h.applied.length,1);await h.advance(3000);assert.equal(h.calls.length,2);await h.advance(27000);assert.equal(h.calls.length,3);
 await h.respond(2,{missing:true});assert.equal(h.applied.length,1);assert.ok(h.messages.at(-1).includes('見つかりません'));await h.advance(9999);assert.equal(h.calls.length,3);await h.advance(1);assert.equal(h.calls.length,4);h.monitor.close();
});
test('監視: HTTP失敗の再試行も上限の30秒待ち、正常復帰でメッセージを消す',async()=>{
 const h=harness();h.monitor.configure(context);h.calls[0].resolve({ok:false});await flush();await h.advance(29999);assert.equal(h.calls.length,1);await h.advance(1);assert.equal(h.calls.length,2);
 await h.respond(1,result);assert.equal(h.messages.at(-1),'');h.monitor.close();
});


test('監視: フィルター切替で基準を消し、古いフィルターの遅い応答を適用しない',async()=>{
 const h=harness();h.monitor.configure(context);await h.respond(0,result);await h.advance(30000);
 h.monitor.configure({...context,filter:''});assert.equal(h.calls[1].options.signal.aborted,true);assert.doesNotMatch(h.calls[2].url,/since=/);assert.match(h.calls[2].url,/filter=(?:&|$)/);
 await h.respond(1,{...result,revision:'old-filter'});assert.equal(h.applied.length,1);
 await h.respond(2,{...result,revision:'unfiltered'});assert.equal(h.applied.length,2);assert.equal(h.applied.at(-1)[0].filter,'');h.monitor.close();
});
