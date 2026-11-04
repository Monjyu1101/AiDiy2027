// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAISearch,validateSearchResult} from '../ファイル機能/ai-search.mjs';
import {createSearchHistory,MAX_SEARCH_HISTORY_BYTES} from '../ファイル機能/ai-search-history.mjs';

const expected=[{from:null,to:'f:A'},{from:'f:A',to:'f:src/B'}];
const result=job=>({requestId:job.id,query:job.query,files:[{path:'A',reason:'入口'},{path:'src/B',reason:'実装'}],route:['A','src/B']});
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'aidiy-route-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'src'));await writeFile(join(root,'A'),'A');await writeFile(join(root,'src/B'),'B');
  return root;
}

test('検索API結果: 明細を返却・保存・再読込し、旧route APIも保持する',async t=>{
  const root=await fixture(t);
  const service=createAISearch(root,{state:()=>({active:true,startedAt:1}),runAgent:async()=>{}});
  t.after(()=>service.close());
  const job=await service.start('関連ファイル');
  await writeFile(join(root,job.path),JSON.stringify(result(job)));
  const response=await service.check(job.id);
  assert.equal(response.status,'complete');assert.deepEqual(response.result.routeRecords,expected);
  assert.deepEqual(response.result.route,['A','src/B']);
  let status,body;
  const res={writeHead(value){status=value;return this;},end(value){body=JSON.parse(value);}};
  await service.handle({method:'GET'},res,new URL(`http://localhost/api/ai-search?id=${job.id}`));
  assert.equal(status,200);assert.deepEqual(body.result.routeRecords,expected);
  await service.handle({method:'GET'},res,new URL(`http://localhost/api/ai-search/history?id=${job.id}`));
  assert.equal(status,200);assert.deepEqual(body.routeRecords,expected);
  const persisted=JSON.parse(await readFile(join(root,'_AIDIY/aidiy_ide/file_searches',job.id+'.json'),'utf8'));
  assert.deepEqual(persisted.routeRecords,expected);
  const reopened=createSearchHistory(root,validateSearchResult);
  assert.deepEqual((await reopened.get(job.id)).routeRecords,expected);
});

test('旧検索履歴: path配列から明細を補完し、外部の誤ったfromは採用しない',async t=>{
  const root=await fixture(t),history=createSearchHistory(root,validateSearchResult);
  const job={id:'00000000-0000-4000-8000-000000000000',query:'旧検索'};
  const old={...result(job),id:job.id,createdAt:1};delete old.requestId;
  await history.save(old);
  const reread=await history.get(job.id);
  assert.deepEqual(reread.routeRecords,expected);
  assert.deepEqual((await validateSearchResult(root,{...result(job),routeRecords:[{from:'f:wrong',to:'f:A'}]},job)).routeRecords,expected);
  await rm(join(root,'A'));
  assert.deepEqual((await history.get(job.id)).routeRecords,expected,'削除後も調査時の軌跡を保持する');
});


test('長い500件の検索: 1MiB以内の入力から増えた明細を保存・再読でき、履歴上限は維持する',async t=>{
  const root=await fixture(t),history=createSearchHistory(root,validateSearchResult);
  const job={id:'00000000-0000-4000-8000-000000000001',query:'test'};
  const files=Array.from({length:500},(_,i)=>({path:['a'.repeat(200),'b'.repeat(200),'c'.repeat(100)+i].join('/'),reason:'r'.repeat(500)}));
  const input={requestId:job.id,query:job.query,files,route:files.map(file=>file.path)};
  assert.ok(Buffer.byteLength(JSON.stringify(input))<1024*1024);
  const entry={...await validateSearchResult(root,input,job,{checkFiles:false}),id:job.id,createdAt:1};
  assert.ok(Buffer.byteLength(JSON.stringify(entry))>1100000,'旧履歴上限を超える回帰ケース');
  await history.save(entry);
  assert.deepEqual((await history.get(job.id)).routeRecords,entry.routeRecords);
  assert.equal((await history.list()).length,1);
  const tooLarge={...entry,query:'x'.repeat(MAX_SEARCH_HISTORY_BYTES)};
  await assert.rejects(()=>history.save(tooLarge,{replace:true}),/3MB/);
  assert.deepEqual((await history.get(job.id)).routeRecords,entry.routeRecords,'拒否した書込は既存履歴を壊さない');
  await writeFile(join(root,'_AIDIY/aidiy_ide/file_searches',job.id+'.json'),JSON.stringify(tooLarge));
  await assert.rejects(()=>history.get(job.id),/読み取れません/);
});
