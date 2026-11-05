// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { ref, watch } = createRequire(path.join(__dirname, '../../../../package.json'))('vue');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const create=async api=>{const {キー設定状態を作成}=await import('../キー設定状態.mjs');const connected=ref(true),message=ref('');return {...キー設定状態を作成({api,connected,message}),connected,message};};
test('設定更新は結果を破棄し、重複取得・未接続・重複テストを抑止する',async()=>{
 const pending=deferred();const calls=[];const state=await create((...args)=>{calls.push(args);return pending.promise});
 state.keyResults.value={openai:{状態:'OK'}};const load=state.loadKeys();await state.loadKeys();await state.testKey('openai');assert.equal(calls.length,1);assert.deepEqual(state.keyResults.value,{});
 pending.resolve({項目:[],公開モデル:{状態:'取得済',世代:1}});await load;
 state.connected.value=false;await state.loadKeys();await state.testKey('openai');await state.refreshPublic();assert.equal(calls.length,1);state.終了();
});
test('認証失効後の古い応答が新しい設定・実行中フラグ・通知を上書きしない',async()=>{
 const old=deferred(),fresh=deferred();let count=0;const state=await create(()=>++count===1?old.promise:fresh.promise);
 const one=state.loadKeys();state.設定を破棄();const two=state.loadKeys();old.reject(new Error('古い失敗'));await one;assert.equal(state.keyBusy.value,true);assert.equal(state.message.value,'');
 fresh.resolve({項目:[{id:'openai'}],公開モデル:{状態:'取得済',世代:3}});await two;assert.equal(state.keyData.value.項目[0].id,'openai');assert.equal(state.publicModels.value.世代,3);state.終了();
});
test('キー試験は明示操作のみ、設定更新中は停止、失効後の結果を無視する',async()=>{
 const pending=deferred();let calls=0;const state=await create((url,method)=>{calls++;assert.equal(url,'api/キーテスト/openai');assert.equal(method,'POST');return pending.promise});
 assert.equal(calls,0);const one=state.testKey('openai');await state.testKey('openai');await state.loadKeys();assert.equal(calls,1);state.設定を破棄();pending.resolve({状態:'OK'});await one;assert.deepEqual(state.keyResults.value,{});state.終了();
});
test('公開キャッシュは古い世代で巻き戻らず、失効後の応答は破棄する',async()=>{
 const pending=deferred();let calls=0;const state=await create(()=>++calls===1?Promise.resolve({項目:[],公開モデル:{状態:'取得済',世代:5}}):pending.promise);
 await state.loadKeys();const refresh=state.refreshPublic();pending.resolve({状態:'取得済',世代:2});await refresh;assert.equal(state.publicModels.value.世代,5);state.終了();
});
test('公開再取得の連打を抑止し、認証失効前の応答は新しい再取得を解除しない',async()=>{
 const old=deferred(),fresh=deferred();let calls=0;const state=await create(()=>++calls===1?old.promise:fresh.promise);
 const one=state.refreshPublic();await state.refreshPublic();assert.equal(calls,1);
 state.設定を破棄();const two=state.refreshPublic();old.resolve({状態:'取得済',世代:99});await one;
 assert.equal(state.publicBusy.value,true);assert.equal(state.publicModels.value.状態,'未取得');
 fresh.resolve({状態:'取得済',世代:2});await two;assert.equal(state.publicBusy.value,false);assert.equal(state.publicModels.value.世代,2);state.終了();
});
test('一覧再取得は設定を読み直し、モデル一覧のテスト可能な行だけを上から順に取得する',async()=>{
 const calls=[];const items=[{id:'gemini',テスト可能:false},{id:'openai',テスト可能:true},{id:'openai_oauth',テスト可能:true},{id:'azure',テスト可能:true},{id:'grok',テスト可能:true},{id:'openrt_chat',テスト可能:true},{id:'discord',テスト可能:true}];
 const state=await create(async url=>{calls.push(url);if(url.startsWith('api/キー設定'))return {項目:items,公開モデル:{状態:'取得済',世代:1}};return {状態:'OK',モデル:[]};});
 const testing=[];const stop=watch(state.keyTesting,id=>{if(id)testing.push(id);},{flush:'sync'});
 const running=state.一覧再取得();assert.equal(state.latestBusy.value,true);await state.一覧再取得();await running;stop();
 assert.equal(state.latestBusy.value,false);
 assert.deepEqual(calls,['api/キー設定/モデル一覧','api/キーテスト/openai','api/キーテスト/openai_oauth','api/キーテスト/grok','api/キーテスト/openrt_chat']);
 assert.deepEqual(testing,['openai','openai_oauth','grok','openrt_chat']);
 assert.deepEqual(Object.keys(state.keyResults.value),['openai','openai_oauth','grok','openrt_chat']);state.終了();
});
test('モデル書込は取得結果があるときだけ送り、取得し直すと書込済を解除する',async()=>{
 const calls=[];const state=await create(async url=>{calls.push(url);if(url.startsWith('api/キー設定'))return {項目:[{id:'openai',テスト可能:true}],公開モデル:{状態:'取得済',世代:1}};if(url==='api/モデル書込')return {件数:1};return {状態:'OK',モデル:[]};});
 assert.equal(await state.モデル書込(),false);assert.deepEqual(calls,[]);
 await state.一覧再取得();assert.equal(await state.モデル書込(),true);assert.equal(state.modelWritten.value,true);
 assert.deepEqual(calls,['api/キー設定/モデル一覧','api/キーテスト/openai','api/モデル書込']);
 await state.testKey('openai');assert.equal(state.modelWritten.value,false);state.終了();
});

test('前回結果を復元し、モデルと連携の実行日時・書込権限を分ける',async()=>{
 const old='2026-10-17T01:02:03Z',now='2026-10-18T04:05:06Z',calls=[];
 const state=await create(async url=>{calls.push(url);return url==='api/キー設定'?{項目:[{id:'openai'},{id:'discord'}],前回結果:{モデル一覧:{結果:[{id:'openai',状態:'OK',モデル:['example']}],前回実行日時:old},外部連携:{結果:[{id:'discord',状態:'NG'}],前回実行日時:old}}}:{状態:'OK',前回実行日時:now};});
 await state.loadKeys();assert.equal(state.keyResults.value.openai.モデル[0],'example');assert.equal(state.modelLastRun.value,old);assert.equal(state.integrationLastRun.value,old);
 assert.equal(await state.モデル書込(),false);assert.equal(await state.外部連携書込(),false);assert.deepEqual(calls,['api/キー設定']);
 await state.testKey('openai');assert.equal(state.modelLastRun.value,now);assert.equal(state.integrationLastRun.value,old);assert.equal(await state.モデル書込(),true);assert.equal(await state.外部連携書込(),false);
 await state.testKey('discord');assert.equal(state.integrationLastRun.value,now);assert.equal(await state.外部連携書込(),true);
 state.終了();assert.equal(state.modelLastRun.value,null);assert.equal(state.integrationLastRun.value,null);
});

test('別タブの再確認で結果・日時・書込済みを消さず、対象側だけ未保存へ戻す',async()=>{
 const state=await create(async url=>url.startsWith('api/キー設定')?{項目:[{id:'openai',テスト可能:true},{id:'discord',テスト可能:true}]}:url.startsWith('api/キーテスト/')?{状態:'OK',確認日時:'2026-10-18T00:00:00Z',モデル:['fresh-model']}:{件数:1});
 await state.一覧再取得();await state.モデル書込();
 const modelResult=state.keyResults.value.openai,modelDate=state.modelLastRun.value;
 await state.外部連携確認();
 assert.equal(state.modelWritten.value,true);assert.deepEqual(state.keyResults.value.openai,modelResult);assert.equal(state.modelLastRun.value,modelDate);
 await state.外部連携書込();const integrationResult=state.keyResults.value.discord,integrationDate=state.integrationLastRun.value;
 await state.一覧再取得();
 assert.equal(state.modelWritten.value,false);assert.equal(state.integrationWritten.value,true);assert.deepEqual(state.keyResults.value.discord,integrationResult);assert.equal(state.integrationLastRun.value,integrationDate);
 // 未保存の取得結果も別タブの再確認では失わず、そのまま書込可能。
 await state.外部連携確認();assert.equal(state.integrationWritten.value,false);assert.equal(state.keyResults.value.openai.モデル[0],'fresh-model');assert.equal(await state.モデル書込(),true);
 state.終了();assert.equal(state.modelWritten.value,false);assert.equal(state.integrationWritten.value,false);
});
