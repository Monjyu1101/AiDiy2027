// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../diag_main.mjs';
import {installReport} from '../診断/headless.mjs';

const entries=[{id:'node',name:'Node.js'},{id:'ollama',name:'Ollama'},{id:'ffmpeg',name:'ffmpeg'}];
const auth='Bearer synthetic-install';
async function request(handler,route,method='POST',headers={authorization:auth}) {
  const response={status:0,body:null,writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body.toString());}};
  await handler({url:`/proxy/8097/${route}`,method,headers},response);
  return response;
}
const create=options=>createHandler({token:'synthetic-install',prefix:'/proxy/8097/',entries,...options});

test('個別確認は認証済みの登録IDだけを許可し、クエリ・本文・任意のパスを拒否する',async()=>{
  const calls=[];
  const handler=create({scanFn:()=>assert.fail('全項目を実行しない'),probeFn:async entry=>{calls.push(entry);return {id:entry.id,状態:'OK'};}});
  assert.equal((await request(handler,'api/診断/node','POST',{})).status,401);
  for(const route of ['api/診断/not-installed','api/診断/node/extra','api/診断/node%2Fextra','api/診断/進捗'])assert.equal((await request(handler,route)).status,404);
  assert.equal((await request(handler,'api/診断/node?command=bad')).status,400);
  assert.equal((await request(handler,'api/診断/node','POST',{authorization:auth,'content-length':'2'})).status,400);
  assert.equal((await request(handler,'api/診断/node','POST',{authorization:auth,'transfer-encoding':'chunked'})).status,400);
  assert.equal((await request(handler,'api/診断/node','GET')).status,404);
  assert.equal(calls.length,0);
  const checked=await request(handler,'api/%E8%A8%BA%E6%96%AD/node');
  assert.equal(checked.status,200);assert.deepEqual(calls,[entries[0]]);
  assert.deepEqual(checked.body.結果,{id:'node',状態:'OK'});assert.equal(checked.body.確認済み,false);assert.ok(checked.body.前回実行日時);
});

test('保存済み表示を保持し、今回全項目を確認したときだけカタログ順で書き込める',async()=>{
  const previous=entries.map(entry=>({id:entry.id,状態:'NG',確認日時:'2026-10-17T00:00:00Z',前回結果:true}));
  let writes=0;
  const handler=create({previousResults:{snapshot:async()=>({導入状況:{結果:[...previous,{id:'removed',状態:'OK'}],前回実行日時:'2026-10-17T00:00:00Z'}})},
    probeFn:async entry=>({id:entry.id,状態:'OK',確認日時:'2026-10-19T00:00:00Z'}),
    installWriteFn:async(...args)=>{writes++;return installReport(...args);}});
  assert.equal((await request(handler,'api/書込')).status,409);
  assert.equal((await request(handler,'api/診断/ffmpeg')).body.確認済み,false);
  assert.equal(writes,0,'個別確認では自動保存しない');
  const listed=(await request(handler,'api/一覧','GET')).body;
  assert.deepEqual(listed.結果.map(row=>[row.id,row.状態,row.前回結果]),[['node','NG',true],['ollama','NG',true],['ffmpeg','OK',undefined]]);
  assert.equal((await request(handler,'api/書込')).status,409,'旧結果を今回の確認として保存しない');
  assert.equal((await request(handler,'api/診断/node')).body.確認済み,false);
  assert.equal((await request(handler,'api/診断/ollama')).body.確認済み,true);
  assert.equal((await request(handler,'api/書込')).status,200);assert.equal(writes,1);
});

test('一括後の個別確認は対象だけ差し替え、別タブの結果を破棄しない',async()=>{
  let saved,models,integrations,installInput;
  const handler=create({scanFn:async()=>entries.map(entry=>({id:entry.id,状態:'OK',バージョン:'old'})),probeFn:async entry=>({id:entry.id,状態:'未検出',確認日時:'2026-10-19T00:00:00Z'}),
    keyStatusFn:async()=>({項目:[]}),keyTestFn:async(id,options)=>{installInput=options.installResults;return {id,状態:'OK',モデル:['fixture']};},
    installWriteFn:async(...args)=>{saved=installReport(...args);return saved;},modelsWriteFn:async(_rows,results)=>{models=results;return [];},integrationWriteFn:async(_rows,results)=>{integrations=results;return {件数:1};}});
  await request(handler,'api/キーテスト/openai');await request(handler,'api/キーテスト/discord');
  await request(handler,'api/診断');
  assert.equal((await request(handler,'api/診断/ollama')).body.確認済み,true);
  await request(handler,'api/キーテスト/ollama');assert.equal(installInput.find(row=>row.id==='ollama').状態,'未検出');
  await request(handler,'api/書込');assert.deepEqual(saved.項目.map(row=>[row.id,row.状態,row.バージョン]),[['node','OK','old'],['ollama','未検出',null],['ffmpeg','OK','old']]);
  await request(handler,'api/モデル書込');await request(handler,'api/外部連携書込');
  assert.equal(models.openai.状態,'OK');assert.equal(integrations.discord.状態,'OK');
});

test('個別・一括・書込の重複を互いに拒否し、完了後は再確認できる',async()=>{
  let finish,mode='probe',calls=0;
  const handler=create({probeFn:async entry=>{calls++;await new Promise(resolve=>{finish=resolve;});return {id:entry.id,状態:'OK'};},
    scanFn:async()=>{if(mode==='scan')await new Promise(resolve=>{finish=resolve;});return entries.map(entry=>({id:entry.id,状態:'OK'}));},
    installWriteFn:async()=>{await new Promise(resolve=>{finish=resolve;});return {件数:3};}});
  const single=request(handler,'api/診断/node');
  for(const route of ['api/診断/node','api/診断','api/書込'])assert.equal((await request(handler,route)).status,409);
  assert.equal(calls,1);finish();assert.equal((await single).status,200);
  mode='scan';const bulk=request(handler,'api/診断');assert.equal((await request(handler,'api/診断/node')).status,409);finish();await bulk;
  const writing=request(handler,'api/書込');assert.equal((await request(handler,'api/診断/node')).status,409);finish();await writing;
  const retry=request(handler,'api/診断/node');finish();assert.equal((await retry).status,200);assert.equal(calls,2);
});

test('個別確認の例外は安全なエラーを返して結果を維持し、次回確認を妨げない',async()=>{
  let failed=true;
  const handler=create({scanFn:async()=>entries.map(entry=>({id:entry.id,状態:'OK'})),probeFn:async entry=>{if(failed)throw Error('private/path/secret');return {id:entry.id,状態:'ERR',説明:'タイムアウト'};}});
  await request(handler,'api/診断');
  const response=await request(handler,'api/診断/node');assert.equal(response.status,500);assert.doesNotMatch(JSON.stringify(response.body),/private|secret/);
  assert.deepEqual((await request(handler,'api/一覧','GET')).body.結果.map(row=>row.状態),['OK','OK','OK']);
  failed=false;const retry=await request(handler,'api/診断/node');assert.equal(retry.status,200);assert.equal(retry.body.結果.状態,'ERR');assert.equal(retry.body.確認済み,true);
});
