// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPreviousResults} from '../診断/前回結果.mjs';
import {createServer} from '../diag_main.mjs';
const old='2026-10-17T01:02:03Z',now='2026-10-18T04:05:06Z';
async function setup(t){const directory=await mkdtemp(path.join(tmpdir(),'diag-previous-'));t.after(()=>rm(directory,{recursive:true,force:true}));return {directory,store:createPreviousResults({directory}),save:(name,data)=>writeFile(path.join(directory,name),JSON.stringify(data),'utf8')};}

test('既存の3種類の保存結果を復元し、認証の証跡・任意フィールドを除く',async t=>{
 const {store,save}=await setup(t);
 await save('install_info.json',{完了日時:old,項目:[{id:'node',状態:'OK',パス:'node.exe',確認日時:old}]});
 await save('openai_models_info.json',{状態:'OK',確認日時:old,認証確認:true,secret:'secret',chat:{モデル:[{model_id:'example',トークン数:100}]}});
 await save('integration_info.json',{保存日時:now,項目:[{id:'discord',状態:'NG',確認日時:old,説明:'認証失敗'}]});
 const data=await store.snapshot();assert.equal(data.導入状況.結果[0].パス,'node.exe');assert.equal(data.外部連携.前回実行日時,old);
 assert.deepEqual(data.モデル一覧.結果[0].モデル,['example']);assert.equal(data.モデル一覧.結果[0].モデル詳細[0].トークン数,100);
 assert.equal(data.モデル一覧.結果[0].前回結果,true);assert.doesNotMatch(JSON.stringify(data),/認証確認|secret/);
});
test('headlessや書込で更新した保存ファイルを、次回読込で反映する',async t=>{
 const {directory,store,save}=await setup(t);
 await save('install_info.json',{完了日時:old,項目:[{id:'node',状態:'OK',確認日時:old}]});
 assert.equal((await store.snapshot()).導入状況.結果[0].状態,'OK');
 await save('install_info.json',{完了日時:now,項目:[{id:'node',状態:'NG',確認日時:now}]});
 const data=await createPreviousResults({directory}).snapshot();assert.equal(data.導入状況.結果[0].状態,'NG');assert.equal(data.導入状況.前回実行日時,now);
});
test('保存なし・壊れたJSON・不正な配列でも初期表示を妨げない',async t=>{
 const {store,save,directory}=await setup(t);assert.equal((await store.snapshot()).導入状況.結果.length,0);
 await writeFile(path.join(directory,'install_info.json'),'{broken');await save('claude_models_info.json',null);
 await save('openai_models_info.json',{chat:{モデル:'invalid'}});await save('integration_info.json',{項目:'invalid'});
 assert.equal((await store.snapshot()).モデル一覧.結果.length,0);
});
test('認証後だけ前回結果を表示し、通常の確認では保存せず書込ボタンだけで保存する',async t=>{
 const {store,save,directory}=await setup(t);await save('install_info.json',{完了日時:old,項目:[{id:'node',状態:'OK'},{id:'removed',状態:'OK'}]});
 await save('openai_models_info.json',{状態:'OK',確認日時:old,chat:{モデル:[{model_id:'old-model'}]}});
 await save('integration_info.json',{保存日時:old,項目:[{id:'discord',状態:'OK'}]});
 const before=await Promise.all((await readdir(directory)).map(async file=>[file,await readFile(path.join(directory,file),'utf8')]));
 let calls=0;const server=createServer({token:'synthetic',entries:[{id:'node'}],installWriteFn:async(_entries,results,_started,finished)=>{await save('install_info.json',{完了日時:finished.toISOString(),項目:results});return {件数:results.length};},previousResults:store,publicCache:{snapshot:()=>({}),input:()=>({})},keyStatusFn:async()=>({項目:[{id:'openai'},{id:'discord'}]}),scanFn:async()=>[{id:'node',状態:'NG'}],keyTestFn:async id=>{calls++;return {id,状態:'NG',モデル:[],確認日時:now};}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.close();server.closeAllConnections();});
 const request=(route,method='GET',auth=true)=>fetch(`http://127.0.0.1:${server.address().port}/api/${encodeURI(route)}`,{method,headers:auth?{authorization:'Bearer synthetic'}:{}});
 assert.equal((await request('一覧','GET',false)).status,401);
 const install=await (await request('一覧')).json();assert.equal(install.結果.length,1);assert.equal(install.前回実行日時,old);
 const keys=await (await request('キー設定')).json();assert.equal(keys.前回結果.モデル一覧.結果[0].モデル[0],'old-model');assert.equal(calls,0);
 for(const route of ['書込','モデル書込','外部連携書込'])assert.equal((await request(route,'POST')).status,409);
 const run=await (await request('診断','POST')).json();assert.ok(run.前回実行日時);assert.equal((await store.snapshot()).導入状況.結果[0].状態,'OK');
 await request('キーテスト/openai','POST');await request('キーテスト/discord','POST');assert.equal(calls,2);
 assert.equal((await store.snapshot()).モデル一覧.結果[0].状態,'OK');assert.equal((await store.snapshot()).外部連携.結果[0].状態,'OK');
 assert.deepEqual(await Promise.all((await readdir(directory)).map(async file=>[file,await readFile(path.join(directory,file),'utf8')])),before);
 assert.equal((await request('書込','POST')).status,200);assert.equal((await store.snapshot()).導入状況.結果[0].状態,'NG');
});
