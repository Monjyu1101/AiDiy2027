// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBrowserAnalysis} from '../ファイル機能/browser-analysis.mjs';
import {createBrowserAnalysisStatus} from '../src/components/ブラウザ/ブラウザ解析状態.js';
import {startDevelopment} from '../server.mjs';
const a='http://localhost:8090/a?view=one',b='http://localhost:8090/b#/main';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<100;i++){if(await check())return;await sleep(5);}assert.fail('background result timeout');}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'aidiy-browser-background-'));await mkdir(join(root,'src'));await writeFile(join(root,'src/a.vue'),'<a/>');await writeFile(join(root,'src/b.vue'),'<b/>');
 const agents=new Map();let state={active:true,connected:true,mode:'online',startedAt:1},clock=100;
 const options={state:()=>({...state}),pollMs:5,waitMs:300000,now:()=>clock,runAgent:({prompt,signal})=>new Promise(resolve=>{const data=JSON.parse(prompt.split('\n形式: ')[1].split('\n')[0]);agents.set(data.requestId,{signal,resolve});})};
 const service=createBrowserAnalysis(root,options);t.after(async()=>{service.close();await rm(root,{recursive:true,force:true});});
 const saved=async()=>{const folder=join(root,'_AIDIY/aidiy_browser/browser_analyses');return Promise.all((await readdir(folder).catch(()=>[])).filter(name=>name.endsWith('.json')).map(async name=>JSON.parse(await readFile(join(folder,name),'utf8'))));};
 return{root,options,service,agents,saved,setState:value=>state={...state,...value},setClock:value=>clock=value,async write(job,path){const file=join(root,job.resultPath);await writeFile(file+'.tmp',JSON.stringify({requestId:job.id,url:job.url,summary:'概要 '+job.url,files:[{role:'Vue画面',path,summary:'対応画面'}]}));await rename(file+'.tmp',file);}};
}
test('Browser解析背景処理: Aを離れてBも解析、購読窓を閉じてもそれぞれ元URLへ保存し再表示できる',async t=>{
 const f=await fixture(t),first=await f.service.start(a),second=await f.service.start(b);await until(()=>f.agents.size===2);
 const states=[];const monitor=createBrowserAnalysisStatus({read:url=>f.service.get(url,{statusOnly:true}),changed:value=>states.push(value)});
 monitor.setPage(a);await until(()=>states.at(-1)?.status==='waiting');monitor.setPage(b);await until(()=>states.at(-1)?.url===b&&states.at(-1)?.status==='waiting');monitor.dispose();
 assert.equal(f.agents.get(first.id).signal.aborted,false);assert.equal(f.agents.get(second.id).signal.aborted,false);
 await f.write(second,'src/b.vue');await f.write(first,'src/a.vue');await until(async()=> (await f.saved()).length===2);
 const values=await f.saved();assert.equal(values.find(value=>value.url===a).files[0].path,'src/a.vue');assert.equal(values.find(value=>value.url===b).files[0].path,'src/b.vue');
 const reopened=createBrowserAnalysisStatus({read:url=>f.service.get(url,{statusOnly:true}),changed:value=>states.push(value)});reopened.setPage(a);await until(()=>states.at(-1)?.resultId===first.id);assert.equal(states.at(-1).status,'complete');reopened.dispose();
});
test('Browser解析背景処理: 同じURLの重複依頼を抑止し、別プロジェクトの同URLへ結果を漏らさない',async t=>{
 const f=await fixture(t),other=await fixture(t),job=await f.service.start(a);await assert.rejects(f.service.start(a),/解析中/);
 assert.equal((await other.service.get(a)).job,null);assert.equal((await other.service.get(a)).result,null);
 await f.write(job,'src/a.vue');await until(async()=>!!(await f.saved()).length);assert.equal((await other.service.get(a)).result,null);
 const otherJob=await other.service.start(a);await other.write(otherJob,'src/b.vue');await until(async()=>!!(await other.saved()).length);
 assert.equal((await f.service.get(a)).result.files[0].path,'src/a.vue');assert.equal((await other.service.get(a)).result.files[0].path,'src/b.vue');
});
test('Browser解析背景処理: 失敗・期限切れは前回結果を保持し、再解析できる',async t=>{
 const f=await fixture(t),initial=await f.service.start(a);await f.write(initial,'src/a.vue');await until(async()=>!!(await f.saved()).length);
 const failed=await f.service.start(a);await until(()=>f.agents.has(failed.id));f.agents.get(failed.id).resolve();await until(async()=> (await f.service.get(a)).job.status==='failed');assert.equal((await f.service.get(a)).result.id,initial.id);
 const timed=await f.service.start(a);await until(()=>f.agents.has(timed.id));f.setClock(timed.deadline+1);await until(()=>f.agents.get(timed.id).signal.aborted);assert.equal((await f.service.get(a)).job.status,'timeout');assert.equal((await f.service.get(a)).result.id,initial.id);
 const retry=await f.service.start(a);await f.write(retry,'src/b.vue');await until(async()=> (await f.saved())[0]?.id===retry.id);assert.equal((await f.service.get(a)).result.files[0].path,'src/b.vue');
});
test('Browser解析背景処理: 利用終了・再開とサーバー終了は遅延結果を保存せず、完了済み結果だけを再起動時に復元',async t=>{
 const f=await fixture(t),initial=await f.service.start(a);await f.write(initial,'src/a.vue');await until(async()=>!!(await f.saved()).length);
 const stale=await f.service.start(a);await until(()=>f.agents.has(stale.id));f.setState({active:false});await until(()=>f.agents.get(stale.id).signal.aborted);await f.write(stale,'src/b.vue');f.setState({active:true,startedAt:2});assert.equal((await f.service.get(a)).job,null);assert.equal((await f.service.get(a)).result.id,initial.id);
 const closing=await f.service.start(b);await until(()=>f.agents.has(closing.id));f.service.close();assert.equal(f.agents.get(closing.id).signal.aborted,true);await f.write(closing,'src/b.vue');
 const restarted=createBrowserAnalysis(f.root,f.options);t.after(()=>restarted.close());assert.equal((await restarted.get(a)).result.id,initial.id);assert.equal((await restarted.get(b)).result,null);assert.equal((await restarted.get(b)).job,null);
});
test('Browser解析状態API: GETのみの軽量状態はURL・状態・結果IDだけを返し、本文や依頼文を定期転送しない',async t=>{
 const f=await fixture(t),connection={state:f.options.state,check:async()=>f.options.state(),connect:async()=>f.options.state(),close(){}};
 const app=await startDevelopment(f.root,{kind:'browser',connection,browserAnalysisOptions:f.options});t.after(()=>app.close());
 const endpoint=app.url+'api/browser-analysis',job=await fetch(endpoint,{method:'POST',body:JSON.stringify({url:a,title:'A'})}).then(res=>res.json());
 const statusURL=endpoint+'?'+new URLSearchParams({url:a,status:'1'});
 const running=await fetch(statusURL).then(res=>res.json());assert.equal(running.url,a);assert.equal(running.job.id,job.id);assert.equal(running.job.status,'waiting');assert.equal(running.job.prompt,undefined);assert.equal(running.job.resultPath,undefined);
 await f.write(job,'src/a.vue');await until(async()=>!!(await f.saved()).length);
 const completed=await fetch(statusURL).then(res=>res.json());assert.deepEqual(Object.keys(completed.result).sort(),['createdAt','id','url']);
 const full=await fetch(endpoint+'?'+new URLSearchParams({url:a})).then(res=>res.json());assert.equal(full.result.files[0].path,'src/a.vue');assert.ok(full.result.summary);
 assert.equal((await fetch(statusURL,{headers:{origin:'https://foreign.test'}})).status,403);
});

test('Browser解析背景処理: 受付後にページを閉じてPOST応答の購読を中断しても、解析ジョブは継続する',async t=>{
 const f=await fixture(t),client=new AbortController();let accepted;
 const connection={state:f.options.state,check:async()=>f.options.state(),connect:async()=>f.options.state(),close(){}};
 const app=await startDevelopment(f.root,{kind:'browser',connection,browserAnalysisOptions:{...f.options,runAgent:args=>{
  const pending=f.options.runAgent(args),spec=JSON.parse(args.prompt.split('\n形式: ')[1].split('\n')[0]);accepted={id:spec.requestId,url:spec.url,resultPath:args.prompt.match(/結果は (temp\/[^ ]+)\.tmp に/)[1]};client.abort();return pending;
 }}});t.after(()=>app.close());
 await fetch(app.url+'api/browser-analysis',{method:'POST',body:JSON.stringify({url:a}),signal:client.signal}).catch(()=>null);await until(()=>!!accepted);assert.equal(f.agents.get(accepted.id).signal.aborted,false);
 await f.write(accepted,'src/a.vue');await until(async()=>!!(await f.saved()).length);
 const restored=await fetch(app.url+'api/browser-analysis?'+new URLSearchParams({url:a})).then(res=>res.json());assert.equal(restored.result.id,accepted.id);assert.equal(restored.job.status,'complete');
});
