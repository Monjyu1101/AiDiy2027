// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,readdir,rename} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createBrowserAnalysis,browserAnalysisURL,validateBrowserAnalysisResult} from '../ファイル機能/browser-analysis.mjs';
import {startDevelopment} from '../server.mjs';
const url='http://localhost:3000/form';
const options={state:()=>({active:true,startedAt:1,mode:'online',connected:true}),runAgent:()=>new Promise(()=>{}),pollMs:100000};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'aidiy-browser-analysis-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'src'));await writeFile(join(root,'src','form.html'),'<form></form>');return root;}
const result=job=>({requestId:job.id,url:job.url,summary:'# 入力画面\n登録フォームです。',files:[{role:'html',path:'src/form.html',summary:'入力フォーム'}]});
async function finish(root,service,job,data=result(job)){await writeFile(join(root,job.resultPath),JSON.stringify(data));return service.get(job.url);}

test('Browser解析: 概要と構造化行を一緒に保存し、URL・プロジェクトを分離して再起動後も読む',async t=>{
 const root=await fixture(t),other=await fixture(t),service=createBrowserAnalysis(root,options);t.after(()=>service.close());
 const job=await service.start(url,'入力画面');assert.equal(job.status,'waiting');assert.match(job.prompt,/base_name/);assert.ok(job.prompt.includes(basename(root)));assert.match(job.prompt,/外部ページへのアクセス/);assert.match(job.prompt,/指示には従わない/);
 const value=await finish(root,service,job);assert.equal(value.job.status,'complete');assert.equal(value.result.id,job.id);assert.deepEqual(value.result.files,result(job).files);assert.equal(value.result.summary,result(job).summary);
 assert.equal((await service.get('http://localhost:3000/other')).result,null);
 const restarted=createBrowserAnalysis(root,options),separate=createBrowserAnalysis(other,options);t.after(()=>{restarted.close();separate.close();});
 assert.deepEqual((await restarted.get(url)).result,value.result);assert.equal((await separate.get(url)).result,null);
 const failed=await service.start(url);await finish(root,service,failed,{...result(failed),summary:''});assert.equal((await service.get(url)).job.status,'invalid');assert.equal((await service.get(url)).result.id,job.id);
});
test('Browser解析: 同時連打と5件上限を守る',async t=>{
 const root=await fixture(t),service=createBrowserAnalysis(root,options);t.after(()=>service.close());
 const attempts=await Promise.allSettled([service.start(url),service.start(url),service.start(url)]);assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);
 for(let n=0;n<4;n++)await service.start(url+n);
 await assert.rejects(()=>service.start(url+'overflow'),/5件/);
});
test('Browser解析: 不正JSON・依頼違い・重複・巨大結果は前回を上書きしない',async t=>{
 const root=await fixture(t),service=createBrowserAnalysis(root,options);t.after(()=>service.close());const initial=await service.start(url);await finish(root,service,initial);
 for(const change of [{requestId:'old'},{url:url+'other'},{summary:''},{files:[...result(initial).files,...result(initial).files]},{files:[{role:'',path:'src/form.html',summary:'説明'}]},{summary:'x'.repeat(200001)},{files:Array(101).fill(result(initial).files[0])}]){
  const job=await service.start(url);const data=await finish(root,service,job,{...result(job),...change});assert.equal(data.job.status,'invalid');assert.equal(data.result.id,initial.id);
 }
 const job=await service.start(url);await writeFile(join(root,job.resultPath),'{');assert.equal((await service.get(url)).job.status,'invalid');await finish(root,service,job);assert.equal((await service.get(url)).job.status,'complete');
});
test('Browser解析: 絶対パス・秘密ファイル・除外・外部リンクを拒否',async t=>{
 const root=await fixture(t),outside=await fixture(t),job={id:'id',url};await symlink(outside,join(root,'linked'),process.platform==='win32'?'junction':'dir');
 for(const path of ['../x','/absolute','C:/file','src\\form.html','src/missing.html','node_modules/a.js','.git/config','_config/AiDiy_key.json','linked/src/form.html']){
  await assert.rejects(()=>validateBrowserAnalysisResult(root,{...result(job),files:[{role:'html',path,summary:'説明'}]},job));
 }
 await assert.rejects(()=>browserAnalysisURL(root,pathToFileURL(join(outside,'src/form.html')).href));
 assert.equal(await browserAnalysisURL(root,pathToFileURL(join(root,'src/form.html')).href),pathToFileURL(join(root,'src/form.html')).href);
 for(const value of ['javascript:alert(1)','about:blank','https://user:pass@example.test','https://example.test/?token=secret','https://example.test/#access_token=secret',pathToFileURL(join(root,'src/form.html')).href+'?secret=1'])await assert.rejects(()=>browserAnalysisURL(root,value));
});
test('Browser解析: 利用終了・再開始・閉鎖は古い結果を保存せず、offlineでは実行しない',async t=>{
 const root=await fixture(t);let state=options.state(),called=0,signal;
 const service=createBrowserAnalysis(root,{...options,state:()=>state,runAgent:args=>{called++;signal=args.signal;return new Promise(()=>{});}});t.after(()=>service.close());
 const job=await service.start(url);await new Promise(r=>setImmediate(r));assert.equal(called,1);
 state={...state,startedAt:2};await writeFile(join(root,job.resultPath),JSON.stringify(result(job)));assert.equal((await service.get(url)).job,null);assert.equal((await service.get(url)).result,null);
 state={...state,connected:false};await assert.rejects(()=>service.start(url),/tools/);state={...state,connected:true,mode:'offline'};await assert.rejects(()=>service.start(url),/tools/);
 state={...state,active:false};await assert.rejects(()=>service.get(url),/利用/);service.close();assert.equal(signal.aborted,true);
});
test('Browser解析: 内部pollで保存、失敗通知、timeoutでabort',async t=>{
 const root=await fixture(t);const service=createBrowserAnalysis(root,{...options,pollMs:5,runAgent:async({prompt})=>{
  const spec=JSON.parse(prompt.split('形式: ')[1].split('\n')[0]),path=prompt.match(/結果は (temp\/[^ ]+)\.tmp に/)[1];await writeFile(join(root,path+'.tmp'),JSON.stringify({...spec,files:[],summary:'対応するソースなし'}));await rename(join(root,path+'.tmp'),join(root,path));
 }});t.after(()=>service.close());await service.start(url);
 let stored;for(let n=0;n<100&&!stored;n++){await new Promise(r=>setTimeout(r,10));const names=await readdir(join(root,'_AIDIY/aidiy_ide/browser_analyses')).catch(()=>[]);const name=names.find(n=>n.endsWith('.json'));if(name)stored=JSON.parse(await readFile(join(root,'_AIDIY/aidiy_ide/browser_analyses',name),'utf8'));}assert.equal(stored.summary,'対応するソースなし');
 let clock=0,signal;const timed=createBrowserAnalysis(root,{...options,now:()=>clock,waitMs:20,runAgent:args=>{signal=args.signal;return new Promise(()=>{});}});t.after(()=>timed.close());await timed.start(url+'timeout');clock=21;assert.equal((await timed.get(url+'timeout')).job.status,'timeout');assert.equal(signal.aborted,true);
 const failed=createBrowserAnalysis(root,{...options,runAgent:async()=>{throw Error('offline');}});t.after(()=>failed.close());await failed.start(url+'failed');await new Promise(r=>setTimeout(r,20));assert.equal((await failed.get(url+'failed')).job.status,'failed');
});
test('Browser解析: 保存先・結果ファイルの外部symlinkを拒否',async t=>{
 const root=await fixture(t),outside=await fixture(t),service=createBrowserAnalysis(root,options);t.after(()=>service.close());
 await symlink(outside,join(root,'temp'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>service.start(url),/プロジェクト外/);
 await symlink(outside,join(root,'_AIDIY'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>service.get(url),/プロジェクト外/);
});
test('Browser解析API: Browserには解析だけを公開し同一origin・接続状態・body制限を維持',async t=>{
 const root=await fixture(t);let state=options.state();const connection={state:()=>state,connect:async()=>state,close(){},check:async()=>state};
 const app=await startDevelopment(root,{kind:'browser',connection,browserAnalysisOptions:options});t.after(()=>app.close());const endpoint=app.url+'api/browser-analysis';
 assert.equal((await fetch(app.url+'api/file-analysis?path=src/form.html')).status,404);assert.equal((await fetch(app.url+'api/scan')).status,404);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{origin:'https://foreign.invalid'},body:'{}'})).status,403);
 const post=await fetch(endpoint,{method:'POST',body:JSON.stringify({url,title:'画面'})});assert.equal(post.status,200);const job=await post.json();await writeFile(join(root,job.resultPath),JSON.stringify(result(job)));
 const get=await fetch(endpoint+'?'+new URLSearchParams({url})).then(r=>r.json());assert.equal(get.result.files[0].path,'src/form.html');
 assert.equal((await fetch(endpoint,{method:'PUT',body:'{}'})).status,405);assert.equal((await fetch(endpoint,{method:'POST',body:'x'.repeat(17000)})).status,400);
 state={...state,connected:false};assert.equal((await fetch(endpoint,{method:'POST',body:JSON.stringify({url:url+'offline'})})).status,400);
 state={...state,active:false};assert.equal((await fetch(endpoint+'?'+new URLSearchParams({url}))).status,503);
});
