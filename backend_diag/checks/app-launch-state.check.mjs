// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {アプリ状態を作成} from '../ui/src/components/アプリ起動/アプリ状態.mjs';

test('native folder cancel never selects cwd, chosen real folder feeds launch and clear disables it',async()=>{
 const calls=[];let selected=null;
 const state=アプリ状態を作成({picker:async()=>selected,api:async(route,_method,_signal,_format,body)=>{
  calls.push({route,body});return route.endsWith('/フォルダ')?{フォルダ:'/resolved/project'}:{通知:'Code の起動を要求しました。',受付:true};
 }});
 await state.起動('code');assert.equal(calls.length,0);await state.選択();assert.equal(state.フォルダ.value,'');assert.equal(calls.length,0);
 selected='/alias/project';await state.選択();assert.equal(state.フォルダ.value,'/resolved/project');assert.equal(state.選択中.value,false);
 await state.起動('code');assert.deepEqual(calls.at(-1).body,{対象:'code',フォルダ:'/resolved/project'});
 assert.equal(state.結果.value.code.種別,'accepted');state.解除();await state.起動('code');assert.equal(calls.length,2);
});
test('browser folder cancel discards late navigation and never reopens the picker',async()=>{
 let release;const state=アプリ状態を作成({picker:()=>undefined,api:()=>new Promise(resolve=>release=resolve)});
 const selected=state.選択();await Promise.resolve();assert.equal(state.参照中.value,true);
 state.取消();release({フォルダ:'/late',親:'/',子フォルダ:[]});await selected;
 assert.equal(state.一覧.value,null);assert.equal(state.フォルダ.value,'');assert.equal(state.参照中.value,false);assert.equal(state.選択中.value,false);
});
test('pending launch locks repeats and failures allow retry without reporting success',async()=>{
 let release,calls=0;const state=アプリ状態を作成({api:()=>{calls++;return new Promise((resolve,reject)=>release={resolve,reject});}});state.フォルダ.value='/project';
 const one=state.起動('live');await state.起動('live');assert.equal(calls,1);
 release.reject(Error('起動中のタスクを確認できませんでした。'));await one;assert.equal(state.結果.value.live.種別,'error');assert.equal(state.処理中.value,'');
 const two=state.起動('live');release.resolve({起動済み:true,通知:'Live は起動済みです。'});await two;assert.equal(state.結果.value.live.種別,'existing');assert.equal(calls,2);
});

test('configured project seeds once; launch uses exact value and clear survives polling and reconnect',async()=>{
 let path='C:\\日本語 空白\\project',body;
 const state=アプリ状態を作成({api:async(route,_method,_signal,_format,data)=>{
  if(route.endsWith('/開始')){body=data;return {受付:true};}return {対象:[],フォルダ:path};
 },schedule:()=>1,unschedule:()=>{}});
 await state.読込();assert.equal(state.フォルダ.value,path);
 await state.起動('code');assert.deepEqual(body,{対象:'code',フォルダ:path});
 path='/changed-config';await state.読込();assert.equal(state.フォルダ.value,'C:\\日本語 空白\\project');
 state.解除();await state.読込();assert.equal(state.フォルダ.value,'');
 state.接続(true);await state.読込();state.接続(false);state.接続(true);await state.読込();assert.equal(state.フォルダ.value,'');state.終了();
});
test('all configured strings copy unchanged; missing stays empty and failed initial read can retry',async()=>{
 for(const path of [undefined,null,'','  ','../',' ../ ']){
  const state=アプリ状態を作成({api:async()=>({対象:[],フォルダ:path})});await state.読込();assert.equal(state.フォルダ.value,typeof path==='string'?path:'');
 }
 let fail=true;const state=アプリ状態を作成({api:async()=>{if(fail)throw Error('offline');return {対象:[],フォルダ:'/configured'};}});
 await state.読込();fail=false;await state.読込();assert.equal(state.フォルダ.value,'/configured');
});
test('manual native selection or clear while catalog is pending wins over late config',async()=>{
 for(const action of ['select','cancel','clear']){
  let release;const state=アプリ状態を作成({picker:async()=>action==='cancel'?null:'/manual',api:async(route)=>{
   if(route.endsWith('/フォルダ'))return {フォルダ:'/manual'};return new Promise(resolve=>release=resolve);
  }});
  const load=state.読込();if(action==='clear')state.解除();else await state.選択();
  release({対象:[],フォルダ:'/configured'});await load;assert.equal(state.フォルダ.value,action==='select'?'/manual':'');
 }
});
test('stale catalog on disconnect cannot seed folder; reconnect takes fresh config',async()=>{
 let release;const state=アプリ状態を作成({api:()=>new Promise(resolve=>release=resolve),schedule:()=>1,unschedule:()=>{}});
 state.接続(true);const first=state.読込();state.接続(false);release({対象:[],フォルダ:'/stale'});await first;assert.equal(state.フォルダ.value,'');
 state.接続(true);const next=state.読込();release({対象:[],フォルダ:'/fresh'});await next;assert.equal(state.フォルダ.value,'/fresh');state.終了();
});

test('literal ../ display uses resolved path for launch and browser browse; manual choice and clear discard mapping',async()=>{
 const requests=[];const state=アプリ状態を作成({picker:()=>undefined,api:async(route,_method,_signal,_format,body)=>{
  requests.push({route,body});
  if(route==='api/アプリ起動')return {対象:[],フォルダ:'../',起動フォルダ:'/repo'};
  if(route.endsWith('/フォルダ'))return {フォルダ:'/manual',親:'/',子フォルダ:[]};
  return {受付:true};
 }});
 await state.読込();assert.equal(state.フォルダ.value,'../');assert.equal(state.起動フォルダ(),'/repo');
 await state.起動('code');assert.equal(requests.at(-1).body.フォルダ,'/repo');
 await state.選択();assert.equal(requests.at(-1).body.フォルダ,'/repo');state.取消();assert.equal(state.起動フォルダ(),'/repo');
 await state.選択();state.決定();assert.equal(state.起動フォルダ(),'/manual');
 await state.読込();await state.起動('code');assert.equal(requests.at(-1).body.フォルダ,'/manual');
 state.解除();await state.読込();assert.equal(state.フォルダ.value,'');assert.equal(state.起動フォルダ(),'');
});
