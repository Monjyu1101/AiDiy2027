// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {起動状態を作成} from '../ui/src/components/起動/起動状態.mjs';
import {受信間隔を作成} from '../ui/src/components/起動/受信間隔.mjs';
const settle=async()=>{await turn();await turn();};

function fakeClock(){
 let now=0,serial=0;const timers=new Map();
 return {now:()=>now,timers,setTimer(fn,ms){assert.ok(ms>100,'非対話監視を100ms以下にしない');const id=++serial;timers.set(id,{fn,ms,due:now+ms});return id;},clearTimer(id){timers.delete(id);},
  async advance(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,v])=>v.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;now=next[1].due;timers.delete(next[0]);void next[1].fn();await settle();}now=end;await settle();}};
}
function fixture(t,{clock=fakeClock(),intercept=()=>{},text={core:'',tools:''}}={}){
 const calls=[];let failed=false;
 const state=起動状態を作成({...clock,api:async(route,method,signal,format,body)=>{
  calls.push({route,at:clock.now(),body,signal});const replacement=intercept(route,body,signal);if(replacement!==undefined)return replacement;
  if(route==='api/起動'){if(failed)throw Error('offline');return {対象:Object.keys(text).map(id=>({id,設定:{},状態:'稼働中'})),実行中:false};}
  if(route==='api/起動/ポート')return {対象:Object.keys(text).map(id=>({id,開放:true}))};
  if(route==='api/起動/ログ'){const log=text[body.対象],reset=body.位置>log.length;return {ログ:log.slice(reset?0:body.位置),位置:log.length,切替:reset};}
  return {受理:true};
 }});t.after(()=>state.終了());
 return {state,clock,calls,text,fail(value){failed=value;},async show(logs=true){state.表示(true,logs);await settle();},count(route){return calls.filter(x=>x.route===route).length;}};
}

test('30秒以内の境界・実受信のみの延長・対象とインスタンスの独立',()=>{
 let now=0;const first=受信間隔を作成({now:()=>now}),second=受信間隔を作成({now:()=>now});
 assert.equal(first.間隔('core'),800);assert.equal(first.間隔('tools'),800);assert.equal(second.間隔('core'),800);
 now=30000;assert.equal(first.間隔('core'),800);
 now=30001;assert.equal(first.間隔('core'),2000);first.受信('core');assert.equal(first.間隔('core'),800);
 assert.equal(first.間隔('tools'),2000);assert.equal(second.間隔('core'),2000);
 now=60001;assert.equal(first.間隔('core'),800);now++;assert.equal(first.間隔('core'),2000);
});

test('ログ無通信で800msから2000ms、管理監視は独立して1秒・無変更は再描画しない',async t=>{
 const f=fixture(t);await f.show();const items=f.state.項目.value,ports=f.state.ポート項目.value;
 await f.clock.advance(32000);assert.equal(f.state.項目.value,items);assert.equal(f.state.ポート項目.value,ports);
 const before=f.count('api/起動/ログ'),status=f.count('api/起動');await f.clock.advance(60000);
 assert.equal(f.count('api/起動/ログ')-before,30,'定常アイドル時は従来の75回/分から30回/分');
 assert.equal(f.count('api/起動')-status,60,'ログの周期に左右されない管理監視');
 const last=f.calls.filter(x=>x.route==='api/起動/ログ').at(-1);f.text.core='日本語の再受信\n';
 await f.clock.advance(2000);assert.equal(f.state.コンソール.value,f.text.core);
 const received=f.calls.find(x=>x.route==='api/起動/ログ'&&x.at>last.at);assert.ok(received.at-last.at<=2000);
 const count=f.count('api/起動/ログ');await f.clock.advance(800);assert.equal(f.count('api/起動/ログ'),count+1);
 assert.equal(f.calls.filter(x=>x.route==='api/起動/ログ').at(-1).body.位置,f.text.core.length);
});

test('別対象・別画面の受信でアイドル監視を高速へ戻さず、選択は即時取得',async t=>{
 const clock=fakeClock(),a=fixture(t,{clock}),b=fixture(t,{clock});await a.show();await b.show();
 a.state.選択.value='tools';await settle();a.state.選択.value='core';await settle();
 await clock.advance(32000);a.text.core='受信';await clock.advance(2000);
 await clock.advance(800);const idleCalls=b.calls.filter(x=>x.route==='api/起動/ログ').slice(-2);assert.equal(idleCalls[1].at-idleCalls[0].at,2000);
 const calls=a.count('api/起動/ログ');a.state.選択.value='tools';await settle();assert.equal(a.count('api/起動/ログ'),calls+1);
 await clock.advance(800);assert.equal(a.count('api/起動/ログ'),calls+1,'別対象の受信でtoolsは高速に戻らない');
 await clock.advance(1200);assert.equal(a.count('api/起動/ログ'),calls+2);
});

test('遅いログ要求を重ねず管理監視を止めない・対象切替後の旧応答を無視',async t=>{
 let release,delay=true;const f=fixture(t,{text:{core:'現行',tools:'別対象'},intercept:(route,body)=>route==='api/起動/ログ'&&body.対象==='core'&&delay?new Promise(resolve=>{release=resolve;}):undefined});
 await f.show();assert.equal(f.count('api/起動/ログ'),1);const old=f.calls.find(x=>x.route==='api/起動/ログ');
 await f.clock.advance(5000);assert.equal(f.count('api/起動/ログ'),1);assert.equal(f.count('api/起動'),6);
 f.state.選択.value='tools';await settle();assert.ok(old.signal.aborted);assert.equal(f.state.コンソール.value,'別対象');
 delay=false;release({ログ:'古い応答',位置:999});await settle();f.state.選択.value='core';await settle();
 assert.equal(f.state.コンソール.value,'現行');assert.equal(f.calls.filter(x=>x.route==='api/起動/ログ').at(-1).body.位置,0);
});

test('非表示・切断・遅い応答・再表示で重複タイマーやログ位置の取りこぼしを作らない',async t=>{
 let pending=false,release;const f=fixture(t,{text:{core:'前',tools:''},intercept:route=>route==='api/起動/ログ'&&pending?new Promise(resolve=>{release=resolve;}):undefined});
 await f.show();await f.clock.advance(800);pending=true;await f.clock.advance(800);const old=f.calls.filter(x=>x.route==='api/起動/ログ').at(-1);
 f.state.表示(false);assert.equal(f.clock.timers.size,0);assert.ok(old.signal.aborted);
 release({ログ:'破棄',位置:99});await settle();assert.equal(f.clock.timers.size,0);assert.equal(f.state.コンソール.value,'前');
 pending=false;f.text.core+='後';await f.show();assert.equal(f.state.コンソール.value,'前後');
 const count=f.count('api/起動/ログ');await f.show(false);await f.clock.advance(10000);assert.equal(f.count('api/起動/ログ'),count);
 f.text.core+='復帰';await f.show();assert.equal(f.state.コンソール.value,'前後復帰');
 f.fail(true);await f.clock.advance(1000);assert.equal(f.state.更新失敗.value,true);
 const stopped=f.count('api/起動/ログ');await f.clock.advance(4000);assert.equal(f.count('api/起動/ログ'),stopped);
 f.fail(false);await f.clock.advance(1000);assert.equal(f.state.更新失敗.value,false);assert.ok(f.count('api/起動/ログ')>stopped);
});

test('空のログ切替でも表示をクリアし、新世代のカーソルから受信を継続',async t=>{
 const f=fixture(t,{text:{core:'古いログ',tools:''}});await f.show();f.text.core='';await f.clock.advance(800);
 assert.doesNotMatch(f.state.コンソール.value,/古いログ/);f.text.core='新しいログ';await f.clock.advance(800);
 assert.equal(f.state.コンソール.value,'新しいログ');assert.equal(f.calls.filter(x=>x.route==='api/起動/ログ').at(-1).body.位置,0);
});

test('表示末尾が同一でも新しい受信があれば活発な周期へ戻る',async t=>{
 const f=fixture(t,{text:{core:'x'.repeat(120000),tools:''}});await f.show();await f.clock.advance(32000);
 const displayed=f.state.コンソール.value;f.text.core+='x';await f.clock.advance(400);
 assert.equal(f.state.コンソール.value,displayed);const before=f.count('api/起動/ログ');await f.clock.advance(800);
 assert.equal(f.count('api/起動/ログ'),before+1);assert.equal(f.calls.filter(x=>x.route==='api/起動/ログ').at(-1).body.位置,120001);
});
