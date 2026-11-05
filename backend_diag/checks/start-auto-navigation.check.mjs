// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 合成の起動・ポート応答だけを使用し、実サービスや保存設定を変更しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {起動状態を作成} from '../ui/src/components/起動/起動状態.mjs';
import {自動起動表示を作成} from '../ui/src/components/起動/自動起動表示.mjs';
const {ref,watch}=createRequire(new URL('../ui/package.json',import.meta.url))('vue');
const progress=(extra={})=>({実行ID:'auto-1',自動起動:true,対象:['tools'],種別:'start',状態:'done',通知:'起動処理が完了しました。',...extra});
function fixture(t){
 const tab=ref('start'),connected=ref(true),navigation=自動起動表示を作成({tab,接続済み:connected});
 const data={対象:[{id:'tools',名前:'Tools',状態:'稼働中',設定:{起動対象:true}}],実行中:false,一括停止中:false,一括進捗:progress()};
 let failPorts=false,snapshot,post;const calls=[],ports={対象:[{id:'tools',開放:true}]};
 const state=起動状態を作成({setTimer:()=>1,clearTimer:()=>{},api:async(route,method)=>{
  calls.push([route,method]);
  if(route==='api/起動')return snapshot?snapshot():structuredClone(data);
  if(route==='api/起動/ポート'){if(failPorts)throw Error('合成ポート確認失敗');return structuredClone(ports);}
  if(route==='api/起動/ログ')return {ログ:'',位置:0};
  return post?post():{受理:true};
 }});
 const unwatch=watch(state.自動起動完了,value=>navigation.反映(value));
 t.after(()=>{unwatch();state.終了();});
 return {tab,connected,navigation,data,ports,state,calls,failPorts:value=>failPorts=value,setSnapshot:fn=>snapshot=fn,setPost:fn=>post=fn,async refresh(logs=false){state.表示(true,logs);await flush();await flush();}};
}

test('--auto の正常完了を最初の取得でも一度だけアプリ起動へ反映する',async t=>{
 const f=fixture(t);await f.refresh();assert.equal(f.tab.value,'apps');assert.equal(f.state.自動起動完了.value.実行ID,'auto-1');
 assert.equal(f.calls.some(([route])=>route==='api/起動/再起動'),false,'表示変更から起動APIを呼ばない');
 f.tab.value='start';await f.refresh();assert.equal(f.tab.value,'start','繰り返し取得で選択を戻さない');
 f.state.表示(false);assert.equal(f.state.自動起動完了.value,null);await f.refresh();assert.equal(f.tab.value,'start','再接続でも同じ結果を再反映しない');
});

test('準備・起動中は待ち、最後の正常完了でだけ切り替える',async t=>{
 const f=fixture(t);f.data.一括進捗.状態='running';f.data.実行中=true;
 await f.refresh(true);assert.equal(f.tab.value,'start');assert.equal(f.state.自動起動完了.value,null);
 f.data.一括進捗.状態='done';await f.refresh();assert.equal(f.tab.value,'start','実行中が残れば完了として扱わない');
 f.data.実行中=false;await f.refresh();assert.equal(f.tab.value,'apps');
});

test('通常起動・手動一括起動・失敗・取消・停止はアプリ起動へ移動しない',async t=>{
 for(const value of [null,progress({自動起動:false}),progress({自動起動:undefined}),progress({状態:'error'}),progress({状態:'cancelled'}),progress({種別:'stop'}),progress({実行ID:''})]){
  const f=fixture(t);f.data.一括進捗=value;await f.refresh();assert.equal(f.tab.value,'start',JSON.stringify(value));
 }
 const f=fixture(t);f.data.一括停止中=true;await f.refresh();assert.equal(f.tab.value,'start');
});

test('途中のタブ選択・同じシステム起動の再選択・表示モード・ログ操作を優先する',async t=>{
 for(const selected of ['install','keys','start','apps']){
  const f=fixture(t);f.data.一括進捗.状態='running';f.data.実行中=true;await f.refresh();
  f.navigation.利用者操作();f.tab.value=selected;
  f.data.一括進捗.状態='done';f.data.実行中=false;await f.refresh();assert.equal(f.tab.value,selected);
 }
 const f=fixture(t);f.tab.value='tools';await f.refresh();assert.equal(f.tab.value,'tools','他画面の表示を奪わない');
});

test('ポート取得失敗では切り替えず、取得が復旧した正常完了でだけ反映する',async t=>{
 const f=fixture(t);f.failPorts(true);await f.refresh();assert.equal(f.tab.value,'start');assert.equal(f.state.自動起動完了.value,null);
 f.failPorts(false);await f.refresh();assert.equal(f.tab.value,'apps');
});

test('完了直後の異常終了・再起動待ち・ポート未開放や未確認では移動しない',async t=>{
 for(const value of ['エラー','停止済み','再起動待ち']){
  const f=fixture(t);f.data.対象[0].状態=value;await f.refresh();assert.equal(f.tab.value,'start');assert.equal(f.state.自動起動完了.value,null);
 }
 for(const value of [false,null]){
  const f=fixture(t);f.ports.対象[0].開放=value;await f.refresh();assert.equal(f.tab.value,'start');
 }
 for(const value of [undefined,[],['missing']]){
  const f=fixture(t);f.data.一括進捗.対象=value;await f.refresh();assert.equal(f.tab.value,'start');
 }
 const f=fixture(t);f.data.対象[0].設定.起動対象=false;f.data.対象[0].状態='停止済み';await f.refresh();assert.equal(f.tab.value,'start','現在の設定ではなく実際に起動した対象を確認する');
 f.data.対象[0].状態='稼働中';await f.refresh();assert.equal(f.tab.value,'apps');
});

test('切断後の遅い完了応答を捨て、接続前の結果でタブを変えない',async t=>{
 const f=fixture(t);let release;f.setSnapshot(()=>new Promise(resolve=>{release=resolve;}));
 f.state.表示(true,false);await flush();f.connected.value=false;f.state.表示(false);
 release(structuredClone(f.data));await flush();await flush();assert.equal(f.tab.value,'start');assert.equal(f.state.自動起動完了.value,null);
 assert.equal(f.navigation.反映(progress()),false);f.connected.value=true;assert.equal(f.navigation.反映(progress()),true,'接続前の結果を消費しない');
});

test('手動停止の受付中・受付失敗後は古いauto完了を採用しない',async t=>{
 const f=fixture(t);f.data.一括進捗.状態='running';f.data.実行中=true;await f.refresh();
 let reject;f.setPost(()=>new Promise((_resolve,fail)=>{reject=fail;}));const work=f.state.一括操作();
 f.data.実行中=false;f.data.一括進捗.状態='done';await f.refresh();assert.equal(f.tab.value,'start');
 reject(Error('合成受付失敗'));await work;await f.refresh();assert.equal(f.tab.value,'start');assert.equal(f.state.自動起動完了.value,null);
});

test('App は完了と明示操作を配線し、初期ミニを強制的に通常表示へ戻さない',async()=>{
 const app=await readFile(new URL('../ui/src/App.vue',import.meta.url),'utf8');
 assert.match(app,/watch\(起動\.自動起動完了,progress=>自動起動表示\.反映\(progress\)\)/);
 assert.match(app,/changeTab\(value\)\{[^\n]*自動起動表示\.利用者操作\(\);tab.value=value/);
 assert.match(app,/async function 表示切替\(mode\)\{\s*自動起動表示\.利用者操作\(\)/);
 for(const opening of [app.match(/<nav class="tabs"[^>]*>/)?.[0],app.match(/<component :is="起動パネル"[^>]*>/)?.[0]]){
  assert.match(opening,/@pointerdown.capture="自動起動表示\.利用者操作"/);assert.match(opening,/@keydown.capture="自動起動表示\.利用者操作"/);
 }
 const navigation=await readFile(new URL('../ui/src/components/起動/自動起動表示.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(navigation,/表示切替|startMini|startMicro|api\(/);
});
