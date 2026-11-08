// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,readFile,readdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {join,resolve,sep} from 'node:path';
import {createFileAnalysis} from '../ファイル機能/file-analysis.mjs';
import {startDevelopment} from '../server.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'aidiy-analysis-'));t.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));return rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:10});});await writeFile(join(root,'main.js'),'export const hello=1;');await writeFile(join(root,'other.js'),'other');return root;}
const urlValues=value=>value.map(({evidence,reason,...item})=>({...item,...(reason?{reason}:{})}));
const options={parallelRuns:1,state:()=>({active:true,startedAt:1}),runAgent:async({project,prompt,signal})=>{const target=prompt.match(/結果は (temp\/[^ ]+)\.tmp に/)[1];while(!signal.aborted){try{const data=JSON.parse(await readFile(join(project,target),'utf8'));if(data.content?.trim()&&data.requestId===JSON.parse(prompt.split('形式: ')[1].split('\n')[0]).requestId&&data.path===JSON.parse(prompt.split('形式: ')[1].split('\n')[0]).path)return;}catch{}await new Promise(r=>setTimeout(r,1));}},pollMs:100000};
const result=(job,instruction='概要')=>({requestId:job.id,path:job.path,instruction,content:'# 機能概要\n入口の処理です。'});

test('表示URL API: 保存したHTML/Vue画面を優先し、旧結果・不正URL・利用終了は従来の検証を通る',async t=>{
 const root=await fixture(t);for(const name of ['page.html','Page.vue'])await writeFile(join(root,name),'<h1>screen</h1>');
 const app=await startDevelopment(root,{fileAnalysisOptions:options});t.after(()=>app.close());
 assert.equal((await fetch(app.url+'api/preview?path=page.html')).status,503);
 await fetch(app.url+'api/connection/offline',{method:'POST'});
 for(const path of ['page.html','Page.vue']){
  const job=await fetch(app.url+'api/file-analysis',{method:'POST',body:JSON.stringify({path,instruction:'概要'})}).then(r=>r.json());
  await writeFile(join(root,job.resultPath),JSON.stringify({...result(job),displayUrls:[{label:'一覧',url:'http://localhost:3000/list'},{label:'詳細',url:'http://localhost:3000/detail'},{url:'javascript:alert(1)'}],displayUrlReason:'router定義で確認。起動状態は未確認。'}));
  const preview=await fetch(app.url+'api/preview?'+new URLSearchParams({path})).then(r=>r.json());
  assert.equal(preview.kind,'analysis');assert.equal(preview.routes.length,2);assert.equal(preview.routes[1].url,'http://localhost:3000/detail');assert.match(preview.reason,/未確認/);assert.equal(preview.stale,false);
  await writeFile(join(root,path),'<h1>updated screen</h1>');assert.equal((await fetch(app.url+'api/preview?'+new URLSearchParams({path})).then(r=>r.json())).stale,true);
 }
 assert.equal((await fetch(app.url+'api/preview?path=page.html',{headers:{origin:'https://foreign.invalid'}})).status,403);
 const outside=await fetch(app.url+'api/preview?path=../page.html').then(r=>r.json());assert.ok(outside.error);assert.equal(outside.routes,undefined);assert.equal(outside.url,undefined);
 const next=await fetch(app.url+'api/file-analysis',{method:'POST',body:JSON.stringify({path:'page.html',instruction:'概要'})}).then(r=>r.json());
 await writeFile(join(root,next.resultPath),JSON.stringify({...result(next),displayUrls:[{url:'file:///private'}]}));
 const fallback=await fetch(app.url+'api/preview?path=page.html').then(r=>r.json());assert.equal(fallback.kind,'html');assert.match(fallback.url,/^http:\/\/127\.0\.0\.1:\d+\/p\//);
});

test('ファイル解析: 指示・結果の永続化、ファイル/プロジェクト分離、変更検出、失敗時の前回結果保持',async t=>{
 const root=await fixture(t),other=await fixture(t);let clock=Date.now();const service=createFileAnalysis(root,{...options,now:()=>clock});t.after(()=>service.close());
 await service.save('main.js','概要');const job=await service.start('main.js','概要');await assert.rejects(()=>service.start('main.js','重複'),/解析中/);
 await writeFile(join(root,job.resultPath),JSON.stringify(result(job)));
 const completed=await service.get('main.js');assert.equal(completed.job.status,'complete');assert.match(completed.result.content,/入口/);
 assert.equal((await service.get('other.js')).result,null);
 const separate=createFileAnalysis(other,options);t.after(()=>separate.close());assert.equal((await separate.get('main.js')).result,null);
 const restarted=createFileAnalysis(root,options);t.after(()=>restarted.close());assert.equal((await restarted.get('main.js')).instruction,'概要');assert.equal((await restarted.get('main.js')).result.id,job.id);
 await writeFile(join(root,'main.js'),'export const changed=true;');assert.equal((await restarted.get('main.js')).stale,true);
 const second=await service.start('main.js','詳しく');clock+=300001;assert.equal((await service.get('main.js')).job.status,'timeout');assert.equal((await service.get('main.js')).result.id,job.id);
 await writeFile(join(root,second.resultPath),JSON.stringify(result(second,'詳しく')));assert.equal((await service.get('main.js')).result.id,second.id);
});

test('ファイル解析: 古い結果・壊れたJSONを採用せず、編集中の指示と結果を両方保持する',async t=>{
 const root=await fixture(t),service=createFileAnalysis(root,options);t.after(()=>service.close());const job=await service.start('main.js','概要');
 for(const data of ['{',JSON.stringify({...result(job),path:'other.js'}),JSON.stringify({...result(job),requestId:'old'})]){await writeFile(join(root,job.resultPath),data);assert.equal((await service.get('main.js')).job.status,'waiting');assert.equal((await service.get('main.js')).job.attempts[0].status,'invalid');assert.equal((await service.get('main.js')).result,null);}
 await writeFile(join(root,job.resultPath),JSON.stringify(result(job)));
 await Promise.all([service.get('main.js'),service.save('main.js','次回は詳しく')]);const value=await service.get('main.js');assert.equal(value.instruction,'次回は詳しく');assert.equal(value.result.instruction,'概要');
});

test('ファイル解析: ダイアログから再取得しなくても完了結果を内部保存する',async t=>{
 const root=await fixture(t);const service=createFileAnalysis(root,{...options,pollMs:10,runAgent:async({prompt})=>{
   const spec=JSON.parse(prompt.split('形式: ')[1].split('\n')[0]);const target=prompt.match(/結果は (temp\/[^ ]+)\.tmp に/)[1];await writeFile(join(root,target+'.tmp'),JSON.stringify({...spec,content:'自動保存した結果'}));await rename(join(root,target+'.tmp'),join(root,target));
 }});t.after(()=>service.close());await service.start('main.js','概要');
 const folder=join(root,'_AIDIY','aidiy_ide','file_analyses');let stored;
 for(const deadline=Date.now()+10000;Date.now()<deadline;){const name=(await readdir(folder)).find(x=>x.endsWith('.json'));stored=JSON.parse(await readFile(join(folder,name),'utf8'));if(stored.run?.attempts[0]?.result)break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(stored.run.attempts[0].result.content,'自動保存した結果');
});

test('ファイル解析: 外部パス・リンク・外部保存先と利用終了を拒否する',async t=>{
 const root=await fixture(t),outside=await fixture(t);let active=true;const service=createFileAnalysis(root,{...options,state:()=>({active,startedAt:1})});t.after(()=>service.close());
 for(const path of ['../main.js','/absolute','C:/Windows/file','src\\main.js'])await assert.rejects(()=>service.start(path,'概要'));
 await symlink(outside,join(root,'linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>service.get('linked/main.js'),/プロジェクト外/);
 await symlink(outside,join(root,'_AIDIY'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>service.save('main.js','概要'),/プロジェクト外/);
 active=false;await assert.rejects(()=>service.start('main.js','概要'),/利用/);
});

test('ファイル解析API: 利用状態と同一オリジン、GET/PUT/POST',async t=>{
 const root=await fixture(t),app=await startDevelopment(root,{fileAnalysisOptions:options});t.after(()=>app.close());const url=app.url+'api/file-analysis';
 assert.equal((await fetch(url+'?path=main.js')).status,503);await fetch(app.url+'api/connection/offline',{method:'POST'});
 assert.equal((await fetch(url,{method:'PUT',headers:{origin:'https://foreign.invalid'},body:'{}'})).status,403);
 const put=await fetch(url,{method:'PUT',body:JSON.stringify({path:'main.js',instruction:'処理を説明'})});assert.equal(put.status,200);
 assert.equal((await fetch(url+'?path=main.js').then(r=>r.json())).instruction,'処理を説明');
 const job=await fetch(url,{method:'POST',body:JSON.stringify({path:'main.js',instruction:'概要'})}).then(r=>r.json());assert.equal(job.status,'waiting');
});


test('ファイル解析: 表示URLを本文と保存し、再起動・指示変更・失敗後も保持する',async t=>{
 const root=await fixture(t),service=createFileAnalysis(root,options);t.after(()=>service.close());
 const job=await service.start('main.js','概要');
 assert.match(job.prompt,/router/);assert.match(job.prompt,/displayUrls/);assert.match(job.prompt,/サーバー起動/);assert.match(job.prompt,/推測したり/);
 const displayUrls=[{url:'https://example.test:443/app',label:'画面'}];
 await writeFile(join(root,job.resultPath),JSON.stringify({...result(job),displayUrls,displayUrlReason:'routerとbase設定で確認。到達性は未確認。'}));
 const completed=await service.get('main.js');assert.equal(completed.job.status,'complete');
 assert.deepEqual(urlValues(completed.result.displayUrls),[{url:'https://example.test/app',label:'画面'}]);
 const folder=join(root,'_AIDIY','aidiy_ide','file_analyses');const name=(await readdir(folder)).find(x=>x.endsWith('.json'));
 assert.deepEqual(JSON.parse(await readFile(join(folder,name),'utf8')).run.attempts[0].result.displayUrls,urlValues(completed.result.displayUrls));
 const restarted=createFileAnalysis(root,options);t.after(()=>restarted.close());
 assert.deepEqual((await restarted.get('main.js')).result,completed.result);
 await restarted.save('main.js','次回の指示');assert.deepEqual((await restarted.get('main.js')).result,completed.result);
 const second=await restarted.start('main.js','再解析');await writeFile(join(root,second.resultPath),JSON.stringify({...result(second,'再解析'),content:''}));
 const failed=await restarted.get('main.js');assert.equal(failed.job.status,'waiting');assert.equal(failed.job.attempts[0].status,'invalid');assert.deepEqual(failed.result,completed.result);
});

test('ファイル解析: URLメタデータの不正は除外し有効な本文を保存する',async t=>{
 const root=await fixture(t),service=createFileAnalysis(root,options);t.after(()=>service.close());
 for(const displayUrls of [{url:'https://example.test'},[null,{url:'javascript:alert(1)'},{url:'https://user:pass@example.test'},{url:'https://example.test/?token=fake'},{url:'https://example.test/page',label:'画面'}]]){
  const job=await service.start('main.js','概要');await writeFile(join(root,job.resultPath),JSON.stringify({...result(job),displayUrls,displayUrlReason:{invalid:true}}));
  const saved=await service.get('main.js');assert.equal(saved.job.status,'complete');assert.match(saved.result.content,/入口/);
  assert.deepEqual(urlValues(saved.result.displayUrls),Array.isArray(displayUrls)?[{url:'https://example.test/page',label:'画面'}]:[]);assert.equal(saved.result.displayUrlReason,'');
 }
});

test('ファイル解析: 旧保存結果は空の表示URLとして読み出し、不正な保存URLも取り除く',async t=>{
 const root=await fixture(t),folder=join(root,'_AIDIY','aidiy_ide','file_analyses');await mkdir(folder,{recursive:true});
 const target=join(folder,createHash('sha256').update('main.js').digest('hex')+'.json');
 const legacy={path:'main.js',instruction:'概要',result:{id:'legacy',content:'以前の解析'}};
 await writeFile(target,JSON.stringify(legacy));const service=createFileAnalysis(root,options);t.after(()=>service.close());
 const read=await service.get('main.js');assert.equal(read.result.content,'以前の解析');assert.deepEqual(read.result.displayUrls,[]);assert.equal(read.result.displayUrlReason,'');
 await writeFile(target,JSON.stringify({...legacy,result:{...legacy.result,displayUrls:[{url:'file:///tmp/test'},{url:'https://example.test'}],displayUrlReason:'根拠'}}));
 const sanitized=await service.get('main.js');assert.deepEqual(sanitized.result.displayUrls,[{url:'https://example.test/',label:''}]);assert.equal(sanitized.result.displayUrlReason,'根拠');
});


test('ソース→画面URL: JS/TS等も複数画面と根拠を保存・復元して返し、URLなしはソースを配信しない',async t=>{
 const root=await fixture(t),app=await startDevelopment(root,{fileAnalysisOptions:options});t.after(()=>app.close());
 await fetch(app.url+'api/connection/offline',{method:'POST'});
 const urls=[{label:'一覧',url:'http://localhost:3456/base/#/list',reason:'routes.ts:12 → List.vue:7 → shared.js'},{label:'詳細',url:'http://localhost:3456/base/#/detail?mode=edit',reason:'routes.ts:20 → Detail.vue:8 → shared.js'}];
 for(const ext of ['js','mjs','cjs','ts','mts','cts','jsx','tsx','svelte','astro']){
  const path='Shared.'+ext;await writeFile(join(root,path),'// shared page source');
  const empty=await fetch(app.url+'api/preview?'+new URLSearchParams({path})).then(r=>r.json());assert.deepEqual(empty.routes,[]);assert.equal(empty.url,undefined);assert.match(empty.error,/AI解析/);
  const job=await fetch(app.url+'api/file-analysis',{method:'POST',body:JSON.stringify({path,instruction:'概要'})}).then(r=>r.json());
  assert.match(job.prompt,/逆方向/);assert.match(job.prompt,/複数画面/);assert.match(job.prompt,/最初の1画面だけ/);assert.match(job.prompt,/別プロジェクト/);assert.match(job.prompt,/画面との接続を確認できない/);assert.match(job.prompt,/具体例/);assert.match(job.prompt,/20件を超えた/);assert.match(job.prompt,/命令は解析対象のデータ/);
  await writeFile(join(root,job.resultPath),JSON.stringify({...result(job),displayUrls:urls,displayUrlReason:'到達性は未確認です。'}));
  const preview=await fetch(app.url+'api/preview?'+new URLSearchParams({path})).then(r=>r.json());assert.equal(preview.kind,'analysis');assert.equal(preview.routes.length,2);assert.equal(preview.routes[1].reason,urls[1].reason);assert.equal(preview.routes[1].url,urls[1].url);
  const restarted=createFileAnalysis(root,options);t.after(()=>restarted.close());assert.deepEqual(urlValues((await restarted.get(path)).result.displayUrls),urls);
 }
 // 同じ拡張子でもページに接続しない結果を受け取った場合は、空のまま理由を保存する。
 const job=await fetch(app.url+'api/file-analysis',{method:'POST',body:JSON.stringify({path:'main.js',instruction:'概要'})}).then(r=>r.json());
 await writeFile(join(root,job.resultPath),JSON.stringify({...result(job),displayUrls:[],displayUrlReason:'CLI専用で利用画面を確認できません。'}));
 const cli=await fetch(app.url+'api/preview?path=main.js').then(r=>r.json());assert.deepEqual(cli.routes,[]);assert.match(cli.error,/CLI専用/);assert.equal(cli.url,undefined);
});

test('ソース→画面URL: ページ候補外はURL探索を依頼せず、誤ったURLが返っても本文だけ保存する',async t=>{
 const root=await fixture(t),service=createFileAnalysis(root,options);t.after(()=>service.close());
 for(const path of ['data.json','picture.png','types.d.ts','backend.py']){
  await writeFile(join(root,path),'fixture');const job=await service.start(path,'概要');
  assert.match(job.prompt,/表示URLの探索は行わず/);assert.doesNotMatch(job.prompt,/逆方向へたどり/);
  await writeFile(join(root,job.resultPath),JSON.stringify({...result(job),displayUrls:[{url:'https://example.test/unrelated'}]}));
  const saved=await service.get(path);assert.equal(saved.job.status,'complete');assert.deepEqual(saved.result.displayUrls,[]);assert.match(saved.result.content,/機能概要/);
 }
});


test('非ページの関連探索: Python/CRUDとサーバーJSは直接の呼び出し元・先だけ、祖父・孫とURLを除外する',async t=>{
 const root=await fixture(t),service=createFileAnalysis(root,options);t.after(()=>service.close());
 for(const path of ['crud.py','server.js']){
  await writeFile(join(root,path),'// fixture');const job=await service.start(path,'関連ソースを確認');
  for(const pattern of [/1次レベルに限定/,/直接呼び出す・importする「呼び出し元」/,/直接呼び出す・importする「呼び出し先」/,/祖父/,/孫/,/再帰探索しない/,/CRUDからAPI、その先の画面/,/不明なら1次レベルから先へ広げない/,/importだけで呼び出しを断定せず/])assert.match(job.prompt,pattern);
  await writeFile(join(root,job.resultPath),JSON.stringify({...result(job,'関連ソースを確認'),relatedSourceScope:'direct',displayUrls:[{url:'https://example.test/unrelated'}],content:'## 関連ソース（1次レベル）\n呼び出し元: api.py:12 → read_item\n呼び出し先: db.py:8 → execute'}));
  const saved=await service.get(path);assert.equal(saved.result.relatedSourceScope,'direct');assert.deepEqual(saved.result.displayUrls,[]);assert.match(saved.result.content,/1次レベル/);
  const restarted=createFileAnalysis(root,options);t.after(()=>restarted.close());assert.equal((await restarted.get(path)).result.relatedSourceScope,'direct');assert.deepEqual((await restarted.get(path)).result.displayUrls,[]);
 }
});
