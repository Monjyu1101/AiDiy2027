// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFileAnalysis} from '../ファイル機能/file-analysis.mjs';
import {startDevelopment} from '../server.mjs';
import {runSearchAgent} from '../ファイル機能/ai-search.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const until=async(fn)=>{for(let n=0;n<200;n++){if(await fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('監視結果の待機期限');};
async function fixture(t,{pollMs=5,now=Date.now,state=()=>({active:true,startedAt:1})}={}){
 const root=await mkdtemp(join(tmpdir(),'aidiy-parallel-'));const calls=[];
 for(const file of ['Screen.vue','Other.vue','crud.py','server.js','third.vue','fourth.vue','fifth.vue','sixth.vue'])await writeFile(join(root,file),'// fixture');
 const service=createFileAnalysis(root,{state,now,pollMs,runAgent:args=>{
  const pending=deferred(),spec=JSON.parse(args.prompt.split('形式: ')[1].split('\n')[0]),path=args.prompt.match(/結果は (temp\/[^ ]+)\.tmp に/)[1];
  const call={...args,...pending,spec,path};calls.push(call);args.onState?.('requested');
  args.signal.addEventListener('abort',()=>pending.reject(Error('Aborted')),{once:true});return pending.promise;
 }});
 t.after(async()=>{service.close();await new Promise(r=>setTimeout(r,20));await rm(root,{recursive:true,force:true});});
 const write=async(call,extra={})=>writeFile(join(root,call.path),JSON.stringify({...call.spec,relatedSourceScope:'page',content:'完了 '+call.spec.requestId,summary:'概要 '+call.spec.requestId,displayUrls:[{url:'http://localhost:3000/list'}],...extra}));
 return{root,calls,service,write};
}

test('3並列: 各実行は関連検索込みの独立依頼、2失敗でも残る1結果を保存し成否を復元する',async t=>{
 const f=await fixture(t),job=await f.service.start('Screen.vue','調べる');
 assert.equal(f.calls.length,3);assert.equal(new Set(f.calls.map(x=>x.spec.requestId)).size,3);assert.equal(new Set(f.calls.map(x=>x.path)).size,3);
 for(const call of f.calls){assert.match(call.prompt,/内容・関連ソース探索・画面URL調査の全体/);assert.match(call.prompt,/分担・合流を待ったりしない/);assert.equal(call.signal.aborted,false);}
 f.calls[0].reject(Error('HTTP 500'));await f.write(f.calls[1],{content:''});f.calls[1].resolve();
 await until(async()=>{const value=await f.service.get('Screen.vue');return value.job.attempts[0].status==='failed'&&value.job.attempts[1].status==='invalid';});
 assert.equal((await f.service.get('Screen.vue')).job.status,'waiting');
 await f.write(f.calls[2]);f.calls[2].reject(Error('HTTP error after valid file'));
 await until(async()=>(await f.service.get('Screen.vue')).job.status==='complete');
 const value=await f.service.get('Screen.vue');assert.equal(value.result.id,job.id);assert.equal(value.result.successCount,1);assert.equal(value.result.analyses[0].id,f.calls[2].spec.requestId);
 assert.deepEqual(value.job.attempts.map(x=>x.status),['failed','invalid','complete']);assert.ok(f.calls.every(x=>!x.signal.aborted));
 const restored=createFileAnalysis(f.root,{state:()=>({active:true,startedAt:2})});t.after(()=>restored.close());assert.deepEqual((await restored.get('Screen.vue')).result,value.result);assert.deepEqual((await restored.get('Screen.vue')).job.attempts.map(x=>x.status),['failed','invalid','complete']);
});

test('背景保存: GETなし・別ソース移動中も保存、再表示は途中結果、再起動は原本と中断状態を読む',async t=>{
 const f=await fixture(t);await f.service.start('Screen.vue','画面A');await f.service.start('Other.vue','画面B');assert.equal(f.calls.length,6);
 await f.write(f.calls[1]);f.calls[1].resolve();await f.write(f.calls[5]);f.calls[5].resolve();
 const records=async()=>{const dir=join(f.root,'_AIDIY/aidiy_ide/file_analyses');return Promise.all((await readdir(dir)).filter(x=>x.endsWith('.json')).map(async x=>JSON.parse(await readFile(join(dir,x),'utf8'))));};
 await until(async()=>(await records()).filter(x=>x.run?.attempts.some(a=>a.result)).length===2);
 assert.equal((await f.service.get('Screen.vue')).job.status,'waiting');assert.equal((await f.service.get('Other.vue')).job.status,'waiting');
 const restarted=createFileAnalysis(f.root,{state:()=>({active:true,startedAt:2})});t.after(()=>restarted.close());
 assert.equal((await restarted.get('Screen.vue')).result.analyses[0].id,f.calls[1].spec.requestId);assert.equal((await restarted.get('Other.vue')).result.analyses[0].id,f.calls[5].spec.requestId);assert.equal((await restarted.get('Screen.vue')).job.status,'interrupted');
 const record=(await records()).find(x=>x.path==='Screen.vue');assert.equal(record.result,null);assert.ok(record.run.attempts[1].result);assert.equal(record.run.attempts[0].result,null);assert.equal(record.run.attempts[1].result.displayUrls[0].evidence,undefined);
});

test('3原本と表示合成: 1成功後も残り継続、重複URL・関連先・概要は根拠付きで統合し原本不変',async t=>{
 const f=await fixture(t);await f.service.start('Screen.vue','初回');
 const source=(relation,line,reason)=>({path:'Other.vue',relation,line,reason});
 await f.write(f.calls[1],{content:'解析2の本文',summary:'共通の概要',displayUrls:[{url:'http://localhost:3000/list',label:'一覧',reason:'二番の根拠'}],relatedSources:[source('page',20,'画面へのimport')],displayUrlReason:'二番の注意'});f.calls[1].resolve();
 await until(async()=>(await f.service.get('Screen.vue')).result?.successCount===1);
 const first=await f.service.get('Screen.vue');assert.equal(first.job.status,'waiting');assert.ok(f.calls.every(x=>!x.signal.aborted));assert.equal(first.result.analyses[0].result.content,'解析2の本文');
 await f.write(f.calls[0],{content:'解析1の本文',summary:'共通の概要',displayUrls:[{url:'http://localhost:3000/list',label:'一覧画面',reason:'一番の根拠'},{url:'http://localhost:3000/detail',reason:'別画面'}],relatedSources:[source('caller',7,'直接import'),{path:'missing.vue',relation:'page',reason:'存在しない'},source('page',21,'別の根拠')],displayUrlReason:'一番の注意'});f.calls[0].resolve();
 await until(async()=>(await f.service.get('Screen.vue')).result?.successCount===2);assert.equal((await f.service.get('Screen.vue')).job.status,'waiting');assert.equal(f.calls[2].signal.aborted,false);
 await f.write(f.calls[2],{content:'解析3の本文',summary:'第三の概要',relatedSources:[{path:'third.vue',relation:'related',reason:'別の参照'}]});f.calls[2].resolve();
 await until(async()=>(await f.service.get('Screen.vue')).job.status==='complete');const completed=await f.service.get('Screen.vue');
 assert.equal(completed.result.successCount,3);assert.deepEqual(completed.result.analyses.map(x=>x.index),[1,2,3]);assert.equal(completed.result.displayUrls.length,2);assert.deepEqual(completed.result.displayUrls[0].evidence.map(x=>x.analysis),[1,2,3]);assert.equal(completed.result.relatedSources.length,2);assert.equal(completed.result.relatedSources[0].evidence.length,3);assert.deepEqual(completed.result.summaries.map(x=>x.analyses),[[1,2],[3]]);assert.equal(completed.result.displayUrlReasons.length,3);
 await f.write(f.calls[1],{content:'後から書き換えた別結果'});assert.deepEqual((await f.service.get('Screen.vue')).result,completed.result);
 const directory=join(f.root,'_AIDIY/aidiy_ide/file_analyses'),record=JSON.parse(await readFile(join(directory,(await readdir(directory)).find(x=>x.endsWith('.json'))),'utf8'));
 assert.deepEqual(record.run.attempts.map(x=>x.result.content),['解析1の本文','解析2の本文','解析3の本文']);assert.equal(record.result,null);assert.equal(record.run.attempts[0].result.displayUrls[0].evidence,undefined);
});

test('再解析の競合: 新旧原本を混ぜず、未完了と失敗時は前回結果を残し指示編集を保持',async t=>{
 const f=await fixture(t),first=await f.service.start('Screen.vue','初回');await f.write(f.calls[1],{summary:'初回の概要'});f.calls[1].resolve();f.calls[0].reject(Error('failed'));f.calls[2].reject(Error('failed'));
 await until(async()=>(await f.service.get('Screen.vue')).job.status==='complete');const second=await f.service.start('Screen.vue','次回');assert.notEqual(first.id,second.id);
 await f.write(f.calls[2],{summary:'前回の遅い結果'});assert.equal((await f.service.get('Screen.vue')).result.id,first.id);
 await Promise.all([f.service.save('Screen.vue','編集中の次回指示'),f.write(f.calls[4],{summary:'今回の概要'})]);f.calls[4].resolve();await until(async()=>(await f.service.get('Screen.vue')).result.id===second.id);
 const value=await f.service.get('Screen.vue');assert.equal(value.result.content,'今回の概要');assert.equal(value.result.instruction,'次回');assert.equal(value.instruction,'編集中の次回指示');assert.equal(value.result.analyses.length,1);
});

test('不正JSONでも実行中は自動監視し、修正後は再表示なしで個別原本を保存する',async t=>{
 const f=await fixture(t);await f.service.start('Screen.vue','概要');await writeFile(join(f.root,f.calls[0].path),'{');await until(async()=>(await f.service.get('Screen.vue')).job.attempts[0].status==='invalid');await f.write(f.calls[0]);
 await until(async()=>{const dir=join(f.root,'_AIDIY/aidiy_ide/file_analyses'),file=(await readdir(dir)).find(x=>x.endsWith('.json'));return !!JSON.parse(await readFile(join(dir,file),'utf8')).run?.attempts[0].result;});
 assert.equal((await f.service.get('Screen.vue')).job.status,'waiting');assert.equal((await f.service.get('Screen.vue')).result.successCount,1);
});

test('同時POST: 同一ソースの二重起動を防ぎ、5ファイルの上限を各3本でも維持する',async t=>{
 const f=await fixture(t,{pollMs:100000});const results=await Promise.allSettled([f.service.start('Screen.vue','概要'),f.service.start('Screen.vue','概要')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.calls.length,3);
 for(const file of ['Other.vue','third.vue','fourth.vue','fifth.vue'])await f.service.start(file,'概要');assert.equal(f.calls.length,15);await assert.rejects(()=>f.service.start('sixth.vue','概要'),/5件/);
});

test('失敗・期限: 前回成功保持、部分成功なら完了、期限で未終了へ停止要求、遅い原本を再確認',async t=>{
 let clock=Date.now();const f=await fixture(t,{now:()=>clock});await f.service.start('Screen.vue','初回');await f.write(f.calls[0]);f.calls.forEach(x=>x.resolve());await until(async()=>(await f.service.get('Screen.vue')).job.status==='complete');const saved=(await f.service.get('Screen.vue')).result;
 await f.service.start('Screen.vue','失敗');for(const call of f.calls.slice(3))call.reject(Error('unavailable'));await until(async()=>(await f.service.get('Screen.vue')).job.status==='failed');assert.deepEqual((await f.service.get('Screen.vue')).result,saved);
 await f.service.start('Screen.vue','期限');clock+=300001;assert.equal((await f.service.get('Screen.vue')).job.status,'timeout');for(const call of f.calls.slice(6))assert.ok(call.signal.aborted);
 await f.write(f.calls[8]);await until(async()=>(await f.service.get('Screen.vue')).job.status==='complete');assert.equal((await f.service.get('Screen.vue')).result.successCount,1);
 await f.service.start('Screen.vue','部分成功');await f.write(f.calls[9]);f.calls[9].resolve();await until(async()=>(await f.service.get('Screen.vue')).result.instruction==='部分成功');clock+=300001;const value=await f.service.get('Screen.vue');assert.equal(value.job.status,'complete');assert.equal(value.result.successCount,1);assert.ok(f.calls[10].signal.aborted);assert.ok(f.calls[11].signal.aborted);
});

test('実行IDとセッション: 別実行JSONを拒否、利用終了で中断し旧結果を新セッションへ採用しない',async t=>{
 let session=1;const f=await fixture(t,{state:()=>({active:true,startedAt:session})});await f.service.start('Screen.vue','概要');await f.write(f.calls[1],{requestId:f.calls[0].spec.requestId});const value=await f.service.get('Screen.vue');assert.equal(value.job.status,'waiting');assert.equal(value.job.attempts[1].status,'invalid');assert.equal(value.result,null);
 session=2;await until(()=>f.calls.every(x=>x.signal.aborted));await f.write(f.calls[2]);assert.equal((await f.service.get('Screen.vue')).result,null);assert.equal((await f.service.get('Screen.vue')).job.status,'interrupted');
});

test('非ページ: Pythonは1本・直接関係のみ、JSは古い非ページ判定だけで本数を減らさない',async t=>{
 const f=await fixture(t);const python=await f.service.start('crud.py','概要');assert.equal(python.attempts.length,1);assert.match(f.calls[0].prompt,/1次レベルに限定/);
 await f.write(f.calls[0],{relatedSourceScope:'direct',relatedSources:[{path:'server.js',relation:'caller',line:3,reason:'直接呼び出す'},{path:'Other.vue',relation:'page',reason:'祖父の画面'},{path:'../outside.py',relation:'callee',reason:'外部'},{path:'missing.py',relation:'callee',reason:'実在しない'}]});f.calls[0].resolve();const direct=await f.service.get('crud.py');assert.deepEqual(direct.result.displayUrls,[]);assert.deepEqual(direct.result.relatedSources.map(x=>x.path),['server.js']);
 await f.service.start('server.js','概要');assert.equal(f.calls.length,4);await f.write(f.calls[1],{relatedSourceScope:'direct'});f.calls.slice(1).forEach(x=>x.resolve());await until(async()=>(await f.service.get('server.js')).job.status==='complete');assert.equal((await f.service.start('server.js','再解析')).attempts.length,3);
});

test('実行基盤: 設定/要求状態を通知し、3 HTTP実行を同時に待ち、HTTP200のNG・利用不可を識別する',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidiy-runner-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const original=globalThis.fetch,calls=[],states=[],pending=[];t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});if(url.endsWith('/config'))return{ok:true,json:async()=>({available:true})};const hold=deferred();hold.index=Number(JSON.parse(options.body).prompt.slice(2));pending.push(hold);return hold.promise;};
 const runners=Array.from({length:3},(_,i)=>runSearchAgent({project:root,prompt:'独立'+i,signal:new AbortController().signal,onState:value=>states.push([i,value])}));
 await until(()=>pending.length===3);assert.equal(calls.filter(x=>x.url.endsWith('/run')).length,3);for(const run of calls.filter(x=>x.url.endsWith('/run')))assert.equal(run.body.resume,false);for(let i=0;i<3;i++)assert.deepEqual(states.filter(x=>x[0]===i).map(x=>x[1]),['configuring','requested']);
 pending.find(x=>x.index===0).resolve({ok:true,json:async()=>({status:'NG'})});pending.find(x=>x.index===1).resolve({ok:true,json:async()=>({status:'OK'})});pending.find(x=>x.index===2).resolve({ok:true,json:async()=>({status:'NG',execution_status:'OK',history_error:'private details'})});
 const results=await Promise.allSettled(runners);assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');assert.equal(results[2].status,'fulfilled');assert.ok(states.some(x=>x[0]===2&&x[1]==='history_warning'));
 let runs=0;globalThis.fetch=async url=>{if(url.endsWith('/run'))runs++;return{ok:true,json:async()=>({available:false})};};await assert.rejects(()=>runSearchAgent({project:root,prompt:'blocked',signal:new AbortController().signal}));assert.equal(runs,0);
});


test('結果取得と終了監視: 全3原本が届いても未終了HTTPの期限監視と警告保持を続ける',async t=>{
 let clock=Date.now();const f=await fixture(t,{now:()=>clock});await f.service.start('Screen.vue','概要');await Promise.all(f.calls.map(call=>f.write(call)));await until(async()=>(await f.service.get('Screen.vue')).result?.successCount===3);
 let value=await f.service.get('Screen.vue');assert.equal(value.job.status,'complete');assert.equal(value.job.monitoring,true);await assert.rejects(()=>f.service.start('Screen.vue','重複'),/解析中/);assert.ok(f.calls.every(x=>!x.signal.aborted));
 f.calls[0].onState('history_warning');value=await f.service.get('Screen.vue');assert.match(value.job.attempts[0].warning,/履歴/);
 clock+=300001;await until(()=>f.calls.every(x=>x.signal.aborted));value=await f.service.get('Screen.vue');assert.equal(value.result.successCount,3);assert.equal(value.job.monitoring,false);assert.ok(value.job.attempts.every(x=>x.processState==='cancel_requested'));
});


test('合成URL API: 3原本それぞれ20件を保管し、表示側で60件まで選択できる',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidiy-composed-url-'));await writeFile(join(root,'Shared.js'),'export const shared=1');const calls=[];
 const app=await startDevelopment(root,{fileAnalysisOptions:{pollMs:5,runAgent:async({prompt})=>{const spec=JSON.parse(prompt.split('形式: ')[1].split('\n')[0]),target=prompt.match(/結果は (temp\/[^ ]+)\.tmp に/)[1],index=calls.push(spec);await writeFile(join(root,target),JSON.stringify({...spec,content:'本文'+index,summary:'概要'+index,relatedSourceScope:'page',displayUrls:Array.from({length:25},(_,n)=>({url:`http://localhost:3000/run${index}/screen${n}`,reason:'実在ルート'}))}));}}});
 t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});await fetch(app.url+'api/connection/offline',{method:'POST'});await fetch(app.url+'api/file-analysis',{method:'POST',body:JSON.stringify({path:'Shared.js',instruction:'概要'})});
 await until(async()=>{const result=await fetch(app.url+'api/file-analysis?path=Shared.js').then(r=>r.json());return result.result?.successCount===3;});const preview=await fetch(app.url+'api/preview?path=Shared.js').then(r=>r.json());assert.equal(preview.kind,'analysis');assert.equal(preview.routes.length,60);assert.ok(preview.routes.some(x=>x.url==='http://localhost:3000/run3/screen19'));assert.ok(preview.routes.every(x=>!x.url.endsWith('screen20')));
});


test('完了後の再表示: 時間が経っても終了済みの成功・失敗をタイムアウトへ変えない',async t=>{
 let clock=Date.now();const f=await fixture(t,{now:()=>clock});await f.service.start('Screen.vue','概要');await Promise.all(f.calls.map(call=>f.write(call)));f.calls.forEach(call=>call.resolve());await until(async()=>!(await f.service.get('Screen.vue')).job.monitoring);clock+=300001;
 const completed=await f.service.get('Screen.vue');assert.equal(completed.job.status,'complete');assert.doesNotMatch(completed.job.message,/監視期限/);
 await f.service.start('Other.vue','失敗');f.calls.slice(3).forEach(call=>call.reject(Error('failed')));await until(async()=>(await f.service.get('Other.vue')).job.status==='failed');clock+=300001;assert.equal((await f.service.get('Other.vue')).job.status,'failed');
});
