// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {ref} from '../ui/node_modules/vue/index.mjs';
import {CLI状態を作成} from '../diag/ui/components/アプリ起動/CLI状態.mjs';
function fixture(overrides={}){
 const requests=[],confirmations=[],アプリ={フォルダ:ref('/日本語 path & ;'),処理中:ref(''),選択中:ref(false)};
 const state=CLI状態を作成({アプリ,確認:async text=>{confirmations.push(text);return true;},api:async(route,_method,_signal,_format,body)=>{requests.push({route,body});return route==='api/CLI起動'?{対象:[{id:'copilot',名前:'GitHub Copilot CLI',モード:'YOLO',利用可能:true},{id:'grok',名前:'Grok',利用可能:false}]}:{通知:'Console を開きました'};},...overrides});
 return {state,アプリ,requests,confirmations};
}
test('only available CLI entries appear and idle loading cannot launch anything',async()=>{const f=fixture();await f.state.読込();assert.deepEqual(f.state.項目.value.map(x=>x.id),['copilot']);assert.equal(f.requests.length,1);assert.equal(f.confirmations.length,0);});
test('未導入CLIは内部の全項目に保持するが表示一覧から除外し、起動要求と確認は送らない',async()=>{
 const f=fixture();await f.state.読込();
 assert.deepEqual(f.state.全項目.value.map(x=>[x.id,x.利用可能]),[['copilot',true],['grok',false]]);
 await f.state.起動('grok');await f.state.起動('grok',{確認省略:true});
 assert.equal(f.requests.length,1);assert.equal(f.confirmations.length,0);
 f.state.切断();assert.deepEqual(f.state.全項目.value,[]);assert.deepEqual(f.state.項目.value,[]);
});
test('explicit risk confirmation includes chosen project/mode/model default; payload has no model/command',async()=>{
 const f=fixture();await f.state.読込();await f.state.起動('copilot');assert.equal(f.confirmations.length,1);for(const value of ['YOLO','指定なし','ファイルの変更','コマンド実行','サンドボックス','/日本語 path & ;'])assert.ok(f.confirmations[0].includes(value));
 assert.deepEqual(f.requests.at(-1).body,{対象:'copilot',フォルダ:f.アプリ.フォルダ.value,自動承認確認:true});assert.equal(f.state.通知.value,'');assert.equal(f.アプリ.処理中.value,'');
});
test('mini launch skips confirmation and sends an independent request per click for CLI and Hermes',async()=>{
 for(const id of ['copilot','aidiy_hermes']){
  const requests=[],confirmations=[],pending=[];
  const f=fixture({確認:()=>{confirmations.push('unexpected confirmation');return false;},api:(route,method,_signal,format,body)=>{
   requests.push({route,method,format,body});return new Promise((resolve,reject)=>pending.push({resolve,reject}));
  }});
  f.state.項目.value=[{id,名前:id,モード:'YOLO',利用可能:true}];
  const first=f.state.起動(id,{確認省略:true});
  assert.equal(confirmations.length,0);assert.deepEqual(requests,[{route:'api/CLI起動/開始',method:'POST',format:'json',body:{対象:id,フォルダ:'/日本語 path & ;',自動承認確認:true}}]);
  assert.equal(f.state.処理中.value,id);assert.equal(f.アプリ.処理中.value,'cli:'+id);
  const second=f.state.起動(id,{確認省略:true});assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
  pending[1].resolve({通知:'Console を開きました'});await second;
  assert.equal(f.state.処理中.value,id);assert.equal(f.アプリ.処理中.value,'cli:'+id,'one completion must not clear another pending launch');
  pending[0].resolve({通知:'古い結果'});await first;assert.equal(f.state.処理中.value,'');assert.equal(f.アプリ.処理中.value,'');assert.equal(f.state.失敗.value,false);
  assert.equal(f.state.通知.value,'');assert.equal(confirmations.length,0);
 }
});
test('mini confirmation bypass preserves project, connectivity, target and busy guards',async()=>{
 const options={確認省略:true};
 const f=fixture({確認:()=>{assert.fail('mini launch must not ask for confirmation');}});await f.state.読込();
 await f.state.起動('unknown',options);f.アプリ.フォルダ.value='';await f.state.起動('copilot',options);
 f.アプリ.フォルダ.value='/project';f.アプリ.選択中.value=true;await f.state.起動('copilot',options);f.アプリ.選択中.value=false;
 f.アプリ.処理中.value='code';await f.state.起動('copilot',options);f.アプリ.処理中.value='';
 assert.equal(f.requests.length,1);
 const offline=fixture({接続可能:()=>false,確認:()=>{assert.fail('offline must not ask for confirmation');}});offline.state.項目.value=[{id:'copilot',名前:'Copilot'}];await offline.state.起動('copilot',options);assert.equal(offline.requests.length,0);
});
test('mini launch failure remains available to the UI and retry clears the failure without confirming',async()=>{
 let calls=0,prompts=0;const f=fixture({確認:()=>{prompts++;return false;},api:async()=>{if(++calls===1)throw Error('実行ファイルなし');return {通知:'再試行を受け付けました'};}});
 f.state.項目.value=[{id:'copilot',名前:'Copilot',モード:'YOLO'}];await f.state.起動('copilot',{確認省略:true});
 assert.equal(f.state.失敗.value,true);assert.equal(f.state.通知.value,'実行ファイルなし');assert.equal(f.state.処理中.value,'');assert.equal(f.アプリ.処理中.value,'');
 await f.state.起動('copilot',{確認省略:true});assert.equal(calls,2);assert.equal(prompts,0);assert.equal(f.state.失敗.value,false);assert.equal(f.state.通知.value,'');
});
test('explicit non-mini confirmation option still honors cancellation',async()=>{
 let prompts=0;const f=fixture({確認:()=>{prompts++;return false;}});await f.state.読込();await f.state.起動('copilot',{確認省略:false});
 assert.equal(prompts,1);assert.equal(f.requests.length,1);assert.equal(f.state.処理中.value,'');assert.equal(f.アプリ.処理中.value,'');
});
test('cancel/no project/offline/unknown/picker busy do not launch',async()=>{
 const f=fixture({確認:async()=>false});await f.state.読込();await f.state.起動('copilot');await f.state.起動('bad');f.アプリ.フォルダ.value='';await f.state.起動('copilot');assert.equal(f.requests.length,1);
 const offline=fixture({接続可能:()=>false});await offline.state.読込();await offline.state.起動('copilot');assert.equal(offline.requests.length,0);
 const busy=fixture();await busy.state.読込();busy.アプリ.選択中.value=true;await busy.state.起動('copilot');assert.equal(busy.requests.length,1);
});
test('repeated clicks lock while confirmation pending; changed project invalidates approval',async()=>{
 let release;const f=fixture({確認:()=>new Promise(resolve=>release=resolve)});await f.state.読込();const one=f.state.起動('copilot');await f.state.起動('copilot');assert.equal(f.アプリ.処理中.value,'cli:copilot');f.アプリ.フォルダ.value='/changed';release(true);await one;assert.equal(f.requests.length,1);assert.equal(f.アプリ.処理中.value,'');
});
test('normal confirmed launch permits another instance while startup is pending and preserves latest result',async()=>{
 const pending=[],confirmations=[];
 const f=fixture({確認:async value=>{confirmations.push(value);return true;},api:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
 f.state.項目.value=[{id:'copilot',名前:'Copilot',モード:'YOLO'},{id:'aidiy_hermes',名前:'Hermes',モード:'YOLO'}];
 const first=f.state.起動('copilot');await Promise.resolve();
 const second=f.state.起動('aidiy_hermes');await Promise.resolve();
 assert.equal(pending.length,2);assert.equal(confirmations.length,2);assert.equal(f.state.処理中.value,'aidiy_hermes');
 pending[1].reject(Error('最新の失敗'));await second;
 assert.equal(f.state.処理中.value,'copilot');assert.equal(f.アプリ.処理中.value,'cli:copilot');assert.equal(f.state.失敗.value,true);
 pending[0].resolve({通知:'古い成功'});await first;
 assert.equal(f.state.通知.value,'最新の失敗');assert.equal(f.state.失敗.value,true);assert.equal(f.アプリ.処理中.value,'');
});
test('disconnect invalidates pending confirmation and late launch results without losing pending accounting',async()=>{
 let release;const f=fixture({確認:()=>new Promise(resolve=>release=resolve)});await f.state.読込();
 const confirmed=f.state.起動('copilot');f.state.切断();release(true);await confirmed;assert.equal(f.requests.length,1);assert.equal(f.アプリ.処理中.value,'');
 const pending=[];const launch=fixture({api:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
 launch.state.項目.value=[{id:'copilot',名前:'Copilot',モード:'YOLO'}];
 const one=launch.state.起動('copilot',{確認省略:true});launch.state.切断();
 pending[0].reject(Error('古い接続の失敗'));await one;
 assert.equal(launch.state.通知.value,'');assert.equal(launch.state.失敗.value,false);assert.equal(launch.state.処理中.value,'');assert.equal(launch.アプリ.処理中.value,'');
});
test('failed launch is visible and retry remains possible; disconnect discards late catalog',async()=>{
 let calls=0;const f=fixture({api:async()=>{calls++;throw Error('実行ファイルなし');}});f.state.項目.value=[{id:'copilot',名前:'Copilot',モード:'YOLO'}];await f.state.起動('copilot');assert.equal(f.state.失敗.value,true);assert.equal(f.state.通知.value,'実行ファイルなし');await f.state.起動('copilot');assert.equal(calls,2);
 let release;const slow=fixture({api:()=>new Promise(resolve=>release=resolve)});const pending=slow.state.読込();slow.state.切断();release({対象:[{id:'old',利用可能:true}]});await pending;assert.equal(slow.state.項目.value.length,0);
});
test('VS Code shares selected folder but uses editor endpoint without automatic approval or confirmation',async()=>{
 const f=fixture({確認:()=>assert.fail('editor does not request CLI approval')});
 f.state.項目.value=[{id:'vscode',名前:'VS Code',種類:'editor',利用可能:true}];
 await f.state.起動('vscode');
 assert.deepEqual(f.requests,[{route:'api/VSCode起動/開始',body:{フォルダ:f.アプリ.フォルダ.value}}]);
});

test('configured relative display uses shared resolved path for CLI and VS Code payloads',async()=>{
 const {アプリ状態を作成}=await import('../diag/ui/components/アプリ起動/アプリ状態.mjs');
 const requests=[];let selected='/manual';
 const アプリ=アプリ状態を作成({picker:()=>selected,api:async route=>route==='api/アプリ起動'?{対象:[],フォルダ:'../',起動フォルダ:'/repo'}:{フォルダ:selected}});
 const state=CLI状態を作成({アプリ,api:async(route,_method,_signal,_format,body)=>{requests.push({route,body});return {};}});
 state.項目.value=[{id:'copilot',利用可能:true},{id:'vscode',種類:'editor',利用可能:true}];await アプリ.読込();
 for(const id of ['copilot','vscode']){await state.起動(id,{確認省略:true});assert.equal(requests.at(-1).body.フォルダ,'/repo');}
 assert.equal(requests[0].route,'api/CLI起動/開始');assert.equal(requests[1].route,'api/VSCode起動/開始');assert.equal(アプリ.フォルダ.value,'../');
 await アプリ.選択();await アプリ.読込();
 for(const id of ['copilot','vscode']){await state.起動(id,{確認省略:true});assert.equal(requests.at(-1).body.フォルダ,'/manual');}
 アプリ.解除();await アプリ.読込();await state.起動('vscode');assert.equal(requests.length,4);
});
