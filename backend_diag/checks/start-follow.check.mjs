// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {起動状態を作成} from '../ui/src/components/起動/起動状態.mjs';

function fixture(t){
 let snapshot={対象:['local','tools','core','web'].map(id=>({id,名前:id,設定:{起動対象:true},状態:'未起動'})),実行中:false,起動表示:null};
 const calls=[];
 const state=起動状態を作成({api:async(route,_method,_signal,_format,body)=>{
  calls.push({route,body});if(route==='api/起動')return structuredClone(snapshot);
  if(route==='api/起動/再起動'){snapshot={...snapshot,実行中:true,起動表示:{対象:body.対象||'tools',実行ID:'requested'}};return {受理:true};}
  return {ログ:'',位置:0};
 }});
 t.after(()=>state.終了());
 async function show(focus,active=true,logs=true){snapshot={...snapshot,実行中:active,起動表示:focus};state.表示(true,logs);await flush();await flush();}
 return {state,calls,show};
}

test('each new startup shows its console while manual selection survives repeated polling',async t=>{
 const {state,calls,show}=fixture(t);await show(null,false);assert.equal(state.選択.value,'local');
 await show({対象:'tools',実行ID:'first'});assert.equal(state.選択.value,'tools');
 state.選択.value='web';await flush();await show({対象:'tools',実行ID:'first'});assert.equal(state.選択.value,'web');
 await show({対象:'core',実行ID:'second'});assert.equal(state.選択.value,'core');
 await show({対象:'web',実行ID:'third'},false);assert.equal(state.選択.value,'web','短い起動も最後の対象を表示する');
 assert.equal(calls.some(call=>call.route.endsWith('/再起動')||call.route.endsWith('/停止')),false,'表示の追従はプロセス操作を行わない');
});

test('restart of the same target refocuses once and refreshes immediately after request',async t=>{
 const {state,show}=fixture(t);await show({対象:'tools',実行ID:'first'},false);
 state.選択.value='core';await flush();await show({対象:'tools',実行ID:'new-run'});assert.equal(state.選択.value,'tools');
 await show({対象:'tools',実行ID:'new-run'},false);state.選択.value='core';await flush();
 await state.再起動('tools');await flush();await flush();assert.equal(state.選択.value,'tools');
});

test('invalid focus is ignored and mini mode continues to fetch status without logs',async t=>{
 const {state,calls,show}=fixture(t);await show(null,false,false);assert.equal(state.選択.value,'local');
 await show({対象:'unknown',実行ID:'bad'},true,false);assert.equal(state.選択.value,'local');
 await show({対象:'core'},true,false);assert.equal(state.選択.value,'local');
 await show({対象:'core',実行ID:'valid'},true,false);assert.equal(state.選択.value,'core');
 assert.equal(calls.some(call=>call.route==='api/起動/ログ'),false);
});

test('individual restart clears cached logs and ignores an older in-flight log response',async t=>{
 let restarted=false,delay=false,release;
 const state=起動状態を作成({api:async(route,_method,_signal,_format,body)=>{
  if(route==='api/起動')return {対象:['local','tools'].map(id=>({id,設定:{},状態:'稼働中'})),実行中:false};
  if(route==='api/起動/ポート')return {対象:[]};
  if(route==='api/起動/再起動'){restarted=true;delay=false;return {受理:true};}
  if(delay)return new Promise(resolve=>{release=()=>resolve({ログ:'遅れて届いた古いログ\n',位置:99});});
  const text=body.対象==='tools'?'他の機能のログ\n':restarted?'新しい起動ログ\n':'前回のログ\n';
  return {ログ:body.位置?'':text,位置:text.length};
 }});
 t.after(()=>state.終了());
 state.表示(true);await flush();await flush();assert.equal(state.コンソール.value,'前回のログ\n');
 state.選択.value='tools';await flush();state.選択.value='local';await flush();
 delay=true;state.表示(true);await flush();assert.equal(typeof release,'function');
 await state.再起動('local');await flush();release();await flush();
 assert.equal(state.コンソール.value,'新しい起動ログ\n');
 state.選択.value='tools';await flush();assert.equal(state.コンソール.value,'他の機能のログ\n');
});

test('a rejected individual restart preserves its console',async t=>{
 const state=起動状態を作成({api:async(route,_method,_signal,_format,body)=>{
  if(route==='api/起動')return {対象:[{id:'local',設定:{},状態:'稼働中'}],実行中:false};
  if(route==='api/起動/ポート')return {対象:[]};
  if(route==='api/起動/再起動')throw new Error('起動要求を受け付けられませんでした。');
  return {ログ:body.位置?'':'既存のログ\n',位置:7};
 }});
 t.after(()=>state.終了());state.表示(true);await flush();await flush();
 await state.再起動('local');assert.equal(state.コンソール.value,'既存のログ\n');
});
