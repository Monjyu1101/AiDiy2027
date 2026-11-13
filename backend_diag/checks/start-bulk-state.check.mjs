// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {起動状態を作成} from '../diag/ui/components/起動/起動状態.mjs';

test('bulk action uses live ports and managed startup, disables unknown states, and sends one stop request',async t=>{
 let opened=false,unknown=false,active=false,stopping=false,release;
 const calls=[],state=起動状態を作成({api:async(route,_method,_signal,_format,body)=>{
  if(route==='api/起動')return {対象:[{id:'tools',名前:'Tools',設定:{},状態:'未起動'}],実行中:active,一括停止中:stopping};
  if(route==='api/起動/ポート')return {対象:[{id:'tools',開放:unknown?null:opened}]};
  if(route==='api/起動/ログ')return {ログ:'',位置:0};
  calls.push({route,body});
  if(route==='api/起動/強制停止')return new Promise(resolve=>{release=()=>{stopping=true;resolve({受理:true});};});
  return {受理:true};
 }});
 t.after(()=>state.終了());
 async function refresh(){state.表示(true);await flush();await flush();}
 await refresh();assert.equal(state.設定起動可能.value,true);assert.equal(state.稼働あり.value,false);
 unknown=true;await refresh();assert.equal(state.設定起動可能.value,false);await state.一括操作();assert.deepEqual(calls,[]);
 unknown=false;opened=true;await refresh();assert.equal(state.稼働あり.value,true);assert.equal(state.設定起動可能.value,false);
 const stop=state.一括操作();await state.一括操作();assert.deepEqual(calls,[{route:'api/起動/強制停止',body:{}}]);
 release();await stop;await flush();await state.一括操作();assert.equal(calls.length,1);
 stopping=false;opened=false;active=true;await refresh();assert.equal(state.稼働あり.value,true,'起動準備中も停止操作を使う');
 active=false;await refresh();assert.equal(await state.一括操作(),'start');assert.equal(calls.at(-1).route,'api/起動/再起動');
});

test('only checked closed ports pulse red while another service runs, and recovery restores normal status',async t=>{
 const ports={tools:false,web:false},settings={tools:true,web:true};let starting=false;
 const state=起動状態を作成({api:async route=>route==='api/起動'?{対象:Object.keys(ports).map(id=>({id,設定:{起動対象:settings[id]},状態:'再起動待ち'})),実行中:starting}:route==='api/起動/ポート'?{対象:Object.entries(ports).map(([id,開放])=>({id,開放}))}:{ログ:'',位置:0}});
 t.after(()=>state.終了());
 async function refresh(){state.表示(true);await flush();await flush();}
 await refresh();assert.deepEqual([...state.停止警告対象.value],[],'全停止では赤くしない');
 starting=true;await refresh();assert.deepEqual([...state.停止警告対象.value],['tools','web'],'設定起動直後は最初の起動を待つ間も赤く示す');
 starting=false;
 ports.tools=true;await refresh();assert.deepEqual([...state.停止警告対象.value],['web']);
 settings.web=false;await refresh();assert.deepEqual([...state.停止警告対象.value],[],'起動対象外は赤くしない');
 settings.web=true;ports.web=null;await refresh();assert.deepEqual([...state.停止警告対象.value],[],'未確認だけでは停止と判断しない');
 ports.web=true;await refresh();assert.deepEqual([...state.停止警告対象.value],[],'復帰したら赤を解除する');
 ports.tools=false;await refresh();assert.deepEqual([...state.停止警告対象.value],['tools'],'内部再起動のポート閉鎖も同じ判定');
});

test('設定再起動はCoreのポート確認成功時だけ有効、タブ変更で落とさず停止・失敗・切断で無効',async t=>{
 let opened=false,failed=false;let poll;const state=起動状態を作成({setTimer:(f,ms)=>{if(ms===1000||ms===5000)poll=f;return 1;},clearTimer(){},api:async route=>{
  if(route==='api/起動')return {対象:[{id:'core',設定:{},状態:'未起動'}],実行中:false};
  if(route==='api/起動/ポート'){if(failed)throw Error('offline');return {対象:[{id:'core',開放:opened}]};}
  return {ログ:'',位置:0};
 }});t.after(()=>state.終了());
 const settle=async()=>{await flush();await flush();};
 assert.equal(state.Core利用可能.value,false);state.表示(true);await settle();assert.equal(state.Core利用可能.value,false);
 opened=true;await poll();assert.equal(state.Core利用可能.value,true);
 state.表示(true,false);assert.equal(state.Core利用可能.value,true,'タブ変更では既知の接続状態を維持');await settle();
 opened=null;await poll();assert.equal(state.Core利用可能.value,false);
 opened=true;await poll();failed=true;await poll();assert.equal(state.Core利用可能.value,false);
 failed=false;await poll();assert.equal(state.Core利用可能.value,true);
 opened=false;await poll();assert.equal(state.Core利用可能.value,false);
 opened=true;await poll();state.表示(false);assert.equal(state.Core利用可能.value,false);
});
