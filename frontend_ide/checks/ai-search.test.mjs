// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createAISearch, validateSearchResult } from '../ファイル機能/ai-search.mjs';
import { aiRouteTargets } from '../src/components/開発スペース/検索経路.js';
import { startDevelopment } from '../server.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'aidiy-ai-search-'));
  t.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));return rm(root,{recursive:true,force:true});});
  await mkdir(join(root,'src'));await writeFile(join(root,'src/login.ts'),'login');await writeFile(join(root,'main.ts'),'main');
  return root;
}
const result=job=>({requestId:job.id,query:job.query,files:[{path:'main.ts',reason:'入口'},{path:'src/login.ts',reason:'認証処理'}],route:['main.ts','src/login.ts']});

test('AiDiy検索: 依頼専用ファイル、未完成・5分期限・遅れて完成した結果・利用終了',async t=>{
  const root=await fixture(t);let clock=Date.now(),session=1;
  const calls=[];const service=createAISearch(root,{state:()=>({active:session!==null,startedAt:session}),now:()=>clock,runAgent:args=>{calls.push(args);return new Promise(()=>{});}});
  t.after(()=>service.close());
  const first=await service.start('認証機能'),second=await service.start('画面');
  assert.notEqual(first.path,second.path);assert.match(first.path,/^temp\/\d{8}_\d{6}_result\.json$/);assert.ok(calls[0].signal.aborted);
  assert.match(first.prompt,/\.tmp/);assert.match(first.prompt,/ソース・設定の変更/);assert.match(first.prompt,/"title"/);
  await writeFile(join(root,second.path+'.tmp'),'{');
  assert.equal((await service.check(second.id)).status,'waiting');
  clock+=300_000;assert.equal((await service.check(second.id)).status,'timeout');
  await writeFile(join(root,second.path+'.tmp'),JSON.stringify(result(second)));await rename(join(root,second.path+'.tmp'),join(root,second.path));
  assert.equal((await service.check(second.id)).status,'complete');
  assert.deepEqual((await service.check(second.id)).result.route,['main.ts','src/login.ts']);
  session=2;await assert.rejects(()=>service.check(second.id),/見つかりません/);
  session=null;await assert.rejects(()=>service.start('認証'),/利用/);
});

test('AiDiy検索: 不正JSON・古い依頼・不正パス・関連順・空結果を検証',async t=>{
  const root=await fixture(t),job={id:'abc',query:'認証'};
  for(const path of ['../outside','C:/Windows/file','/absolute','src/../main.ts','src\\login.ts','missing.ts','src']){
    await assert.rejects(()=>validateSearchResult(root,{...result(job),files:[{path,reason:'理由'}],route:[path]},job));
  }
  await assert.rejects(()=>validateSearchResult(root,{...result(job),requestId:'old'},job));
  await assert.rejects(()=>validateSearchResult(root,{...result(job),route:['main.ts','main.ts']},job));
  assert.deepEqual((await validateSearchResult(root,{...result(job),files:[],route:[]},job)).files,[]);
  const service=createAISearch(root,{state:()=>({active:true,startedAt:1}),runAgent:async()=>{throw Error('offline');}});t.after(()=>service.close());
  const request=await service.start('認証');await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal((await service.check(request.id)).status,'failed');
  await writeFile(join(root,request.path),'{');assert.equal((await service.check(request.id)).status,'invalid');
  await writeFile(join(root,request.path),JSON.stringify(result(request)));assert.equal((await service.check(request.id)).status,'complete');
});

test('AiDiy検索: プロジェクト外を指すtempと結果内のリンクを拒否',async t=>{
  const root=await fixture(t),outside=await fixture(t);
  await symlink(outside,join(root,'temp'),process.platform==='win32'?'junction':'dir');
  const service=createAISearch(root,{state:()=>({active:true,startedAt:1}),runAgent:async()=>{throw Error('呼ばれない');}});
  await assert.rejects(()=>service.start('認証'),/プロジェクト外/);
  await symlink(outside,join(root,'linked'),process.platform==='win32'?'junction':'dir');
  const job={id:'link',query:'認証'};
  await assert.rejects(()=>validateSearchResult(root,{...result(job),files:[{path:'linked/main.ts',reason:'理由'}],route:['linked/main.ts']},job),/確認できません/);
});

test('AiDiy検索タイトル: 生成タイトルの保存・再読込と旧結果の互換',async t=>{
  const root=await fixture(t),options={state:()=>({active:true,startedAt:1}),runAgent:()=>new Promise(()=>{})};
  const service=createAISearch(root,options);t.after(()=>service.close());
  const job=await service.start('バックエンドの認証に関係するプログラムを検索して');
  await writeFile(join(root,job.path),JSON.stringify({...result(job),title:'  バックエンドの認証処理  '}));
  assert.equal((await service.check(job.id)).result.title,'バックエンドの認証処理');
  const restarted=createAISearch(root,options);t.after(()=>restarted.close());
  assert.equal((await restarted.history.list())[0].title,'バックエンドの認証処理');
  assert.equal((await restarted.history.get(job.id)).title,'バックエンドの認証処理');
  assert.equal((await validateSearchResult(root,result(job),job)).title,job.query);
  for(const title of [null,42,'   ','あ'.repeat(81)])await assert.rejects(()=>validateSearchResult(root,{...result(job),title},job),/title/);
});

test('AI軌跡: 各階層の入口から関連ファイル・親フォルダへ順に繋ぐ',()=>{
  const src={path:'src'},main={path:'main.ts'},login={path:'src/login.ts'};
  const route=['main.ts','src/login.ts','src/session.ts'];
  const world={galaxies:[src],byPath:new Map([['main.ts',main],['src/login.ts',login]])};
  assert.deepEqual(aiRouteTargets(route,[],world),[{x:0,y:0,z:0},main,src]);
  assert.deepEqual(aiRouteTargets(route,['src'],world),[{x:0,y:0,z:0},login]);
  assert.deepEqual(aiRouteTargets(route,['other'],world),[]);
});

test('AiDiy検索API: 利用開始・同一オリジン・エージェント起動・結果受取',async t=>{
  const root=await fixture(t);let prompt;
  const app=await startDevelopment(root,{aiSearchOptions:{runAgent:async args=>{prompt=args.prompt;}}});t.after(()=>app.close());
  const post=body=>fetch(app.url+'api/ai-search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({query:'認証'})).status,503);
  await fetch(app.url+'api/connection/offline',{method:'POST'});
  assert.equal((await fetch(app.url+'api/ai-search',{method:'POST',headers:{origin:'https://foreign.invalid'},body:'{}'})).status,403);
  const job=await (await post({query:'認証'})).json();assert.ok(prompt.includes(job.path));
  await writeFile(join(root,job.path),JSON.stringify(result(job)));
  assert.equal((await fetch(app.url+'api/ai-search?id='+job.id).then(r=>r.json())).status,'complete');
  const historyURL=app.url+'api/ai-search/history';
  assert.equal((await fetch(historyURL).then(r=>r.json())).entries.length,1);
  assert.equal((await fetch(historyURL+'?id='+job.id,{method:'DELETE',headers:{origin:'https://foreign.invalid'}})).status,403);
  assert.equal((await fetch(historyURL+'?id='+job.id,{method:'DELETE'})).status,200);
  assert.deepEqual((await fetch(historyURL).then(r=>r.json())).entries,[]);
});

test('AiDiy検索履歴: 複数保存・再起動・別プロジェクト分離・削除後の再取込防止',async t=>{
  const root=await fixture(t),other=await fixture(t);
  const options={state:()=>({active:true,startedAt:1}),runAgent:()=>new Promise(()=>{})};
  let service=createAISearch(root,options);t.after(()=>service.close());
  const first=await service.start('認証'),second=await service.start('データ');
  for(const job of [first,second]){await writeFile(join(root,job.path),JSON.stringify(result(job)));await service.check(job.id);}
  assert.equal((await service.history.list()).length,2);
  service.close();service=createAISearch(root,options);
  assert.equal((await service.history.list()).length,2);
  assert.equal((await service.history.get(first.id)).query,'認証');
  const isolated=createAISearch(other,options);t.after(()=>isolated.close());
  assert.deepEqual(await isolated.history.list(),[]);
  await assert.rejects(()=>isolated.history.get(first.id));
  await rm(join(root,'src/login.ts'));
  assert.equal((await service.history.get(first.id)).files.length,2,'ファイル削除後も調査時の理由と軌跡を保持');
  await service.history.remove(first.id);
  service.close();service=createAISearch(root,options);
  assert.deepEqual((await service.history.list()).map(entry=>entry.id),[second.id]);
  await assert.rejects(()=>service.history.get(first.id),/削除/);
  await assert.rejects(()=>service.history.remove('../outside'));
});

test('AiDiy検索履歴: 旧版のtemp結果を依頼文と照合して移行',async t=>{
  const root=await fixture(t),options={state:()=>({active:true,startedAt:1}),runAgent:()=>new Promise(()=>{})};
  const old=createAISearch(root,options),job=await old.start('既存の認証検索');
  await writeFile(join(root,job.path),JSON.stringify(result(job)));old.close();
  const service=createAISearch(root,options);t.after(()=>service.close());
  assert.equal((await service.history.list())[0].id,job.id);
  await service.history.remove(job.id);service.close();
  const restarted=createAISearch(root,options);t.after(()=>restarted.close());
  assert.deepEqual(await restarted.history.list(),[],'tempに元JSONが残っていても削除済み履歴は復活させない');
});
