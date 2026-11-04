// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../diag_main.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {dependency}=require('./ui-components.cjs');
const {ref}=createRequire(new URL('../ui/package.json',import.meta.url))('vue');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const request=async(h,url,method='POST')=>{const res={writeHead(status){this.status=status;},end(bytes){this.body=JSON.parse(bytes);}};await h({url:'/api/'+url,method,headers:{authorization:'Bearer fixture'}},res);return res;};

test('API: 別項目の確認を並行し、同じ項目・一括・保存・再読込の競合を防ぐ',async()=>{
 const pending=new Map();const run=id=>{const d=deferred();pending.set(id,d);return d.promise;};
 const h=createHandler({token:'fixture',entries:[{id:'python'},{id:'node'}],probeFn:e=>run(e.id),keyTestFn:run,keyStatusFn:async()=>({項目:[]})});
 const a=request(h,'診断/python'),b=request(h,'診断/node');
 assert.equal(pending.size,2);
 for(const path of ['診断/python','診断','書込'])assert.equal((await request(h,path)).status,409);
 pending.get('node').resolve({id:'node',状態:'OK'});assert.equal((await b).status,200);
 pending.get('python').reject(Error('failure'));assert.equal((await a).status,500);
 assert.equal((await request(h,'一覧','GET')).body.結果[0].id,'node');
 const c=request(h,'キーテスト/openai'),d=request(h,'キーテスト/gemini'),e=request(h,'キーテスト/discord');
 assert.ok(pending.has('openai')&&pending.has('gemini')&&pending.has('discord'));
 for(const path of ['キーテスト/openai','モデル書込','外部連携書込'])assert.equal((await request(h,path)).status,409);
 assert.equal((await request(h,'キー設定','GET')).status,409);
 pending.get('gemini').resolve({id:'gemini',状態:'OK'});await d;
 pending.get('openai').reject(Error('failure'));await c;
 pending.get('discord').resolve({id:'discord',状態:'OK'});await e;
 const retry=request(h,'キーテスト/openai');pending.get('openai').resolve({id:'openai',状態:'OK'});assert.equal((await retry).status,200);
});

test('導入状況: 逆順完了・一方の失敗で他行を巻き戻さず、能力読込を待たず解除',async()=>{
 const pending=new Map(),background=deferred();
 const {導入状況状態を作成}=dependency('components/導入状況/導入状況状態.mjs');
 const s=導入状況状態を作成({api:url=>{const d=deferred();pending.set(url,d);return d.promise;},接続済み:ref(true),通知:ref(''),確認後:()=>background.promise});
 s.一覧を反映({項目:[{id:'python'},{id:'node'}],結果:[{id:'python',状態:'OK'},{id:'node',状態:'OK'}]});
 const a=s.個別確認('python'),b=s.個別確認('node');assert.equal(s.個別確認IDs.value.size,2);assert.equal(await s.個別確認('node'),false);
 pending.get('api/診断/node').resolve({結果:{id:'node',状態:'注意'}});await b;
 assert.equal(s.個別確認IDs.value.has('node'),false);assert.equal(s.個別確認IDs.value.has('python'),true);
 pending.get('api/診断/python').reject(Error('failed'));await a;
 assert.equal(s.結果.value.find(x=>x.id==='node').状態,'注意');assert.equal(s.結果.value.find(x=>x.id==='python').状態,'OK');assert.equal(s.個別確認中.value,'');background.resolve();
});

test('モデル・外部連携: 個別並行、重複防止、認証世代破棄後の遅い応答を無視',async()=>{
 const pending=new Map();const {キー設定状態を作成}=dependency('components/キー設定共通/キー設定状態.mjs');
 const s=キー設定状態を作成({api:url=>{const d=deferred();pending.set(url,d);return d.promise;},connected:ref(true),message:ref('')});
 const a=s.testKey('openai'),b=s.testKey('gemini'),c=s.testKey('discord');assert.equal(s.keyTestingIds.value.size,3);
 await s.testKey('openai');assert.equal(pending.size,3);
 pending.get('api/キーテスト/gemini').resolve({状態:'OK'});await b;
 assert.equal(s.keyResults.value.gemini.状態,'OK');assert.equal(s.keyTestingIds.value.size,2);
 pending.get('api/キーテスト/discord').reject(Error('failed'));await c;assert.equal(s.keyResults.value.gemini.状態,'OK');
 s.設定を破棄();pending.get('api/キーテスト/openai').resolve({状態:'OK'});await a;
 assert.equal(Object.keys(s.keyResults.value).length,0);assert.equal(s.keyTestingIds.value.size,0);
});

test('モデル一覧・外部連携の描画: 複数の実行行だけ無効になり、他の行は押せる',async()=>{
 const {render}=require('./ui-components.cjs');
 for(const [panel,ids] of [['モデル一覧',['gemini','openai','claude']],['外部連携',['huggingface_read','huggingface_write','discord']]]){
  const props={connected:true,data:{設定状態:'読込済み',項目:ids.map(id=>({id,名前:id,テスト可能:true}))},results:{},testing:ids[0],testingIds:new Set(ids.slice(0,2))};
  const html=await render(`components/${panel}/${panel}パネル.vue`,props);
  const buttons=[...html.matchAll(/<button[^>]*class="single-test-button"[^>]*>.*?<\/button>/g)].map(m=>m[0]);
  assert.equal(buttons.length,3);assert.match(buttons[0],/disabled/);assert.match(buttons[1],/disabled/);assert.doesNotMatch(buttons[2],/disabled/);
  assert.match(buttons[0],/確認中/);assert.match(buttons[1],/確認中/);
 }
});
