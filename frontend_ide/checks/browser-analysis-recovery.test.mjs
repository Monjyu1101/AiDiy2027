// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,rm} from 'node:fs/promises';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,pbkdf2} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {createBrowserAnalysis} from '../ファイル機能/browser-analysis.mjs';
import {createBrowserAnalysisStatus} from '../src/components/ブラウザ/ブラウザ解析状態.js';
const a='http://localhost:8090/recovery-a',b='http://localhost:8090/recovery-b';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<1000;i++){if(await check())return;await sleep(5);}assert.fail('background recovery timeout');}
async function fixture(t,overrides={}){
 const root=await mkdtemp(join(tmpdir(),'aidiy-browser-recovery-'));await mkdir(join(root,'src'));await writeFile(join(root,'src/a.vue'),'<a/>');await writeFile(join(root,'src/b.vue'),'<b/>');
 const agents=new Map();const service=createBrowserAnalysis(root,{state:()=>({active:true,mode:'online',connected:true,startedAt:1}),pollMs:5,runAgent:({prompt,signal})=>new Promise(resolve=>{const spec=JSON.parse(prompt.split('\n形式: ')[1].split('\n')[0]);agents.set(spec.requestId,{resolve,signal});}),...overrides});
 t.after(async()=>{service.close();await rm(root,{recursive:true,force:true});});
 const saved=async()=>{const folder=join(root,'_AIDIY'),names=await readdir(folder,{recursive:true}).catch(()=>[]);return Promise.all(names.filter(name=>/(?:^|[\\/])browser_analyses[\\/][a-f0-9]{64}\.json$/.test(name)).map(async name=>JSON.parse(await readFile(join(folder,name),'utf8'))));};
 return{root,agents,service,saved,async write(job,path='src/a.vue'){const file=join(root,job.resultPath);await writeFile(file+'.tmp',JSON.stringify({requestId:job.id,url:job.url,summary:'対応する画面',files:[{role:'Vue画面',path,summary:'URLに登録された画面'}]}));await rename(file+'.tmp',file);}};
}
test('Browser解析回復: 不正JSONから正常化後、GETなしで内部pollが保存し表示を復元する',async t=>{
 const f=await fixture(t),job=await f.service.start(a);await until(()=>f.agents.has(job.id));await writeFile(join(f.root,job.resultPath),'{');
 await sleep(40);assert.equal((await f.service.get(a)).job.status,'waiting');await assert.rejects(f.service.start(a),/解析中/);
 await writeFile(join(f.root,job.resultPath),JSON.stringify({requestId:'wrong',url:a,summary:'途中',files:[]}));await sleep(30);assert.equal((await f.service.get(a)).job.status,'waiting');
 await f.write(job);await until(async()=> (await f.saved())[0]?.id===job.id);assert.equal((await f.service.get(a)).job.status,'complete');
});
test('Browser解析回復: 全期間不正でも期限にAbortし、前回正常結果を保ち遅い修正結果を保存しない',async t=>{
 let clock=0;const f=await fixture(t,{now:()=>clock,waitMs:100}),initial=await f.service.start(a);await f.write(initial);await until(async()=>!!(await f.saved()).length);
 const job=await f.service.start(a);await until(()=>f.agents.has(job.id));await writeFile(join(f.root,job.resultPath),'{');await sleep(30);clock=101;
 await until(()=>f.agents.get(job.id).signal.aborted);assert.equal((await f.service.get(a)).job.status,'timeout');assert.equal((await f.saved())[0].id,initial.id);
 await f.write(job,'src/b.vue');await sleep(30);assert.equal((await f.service.get(a)).job.status,'timeout');assert.equal((await f.saved())[0].id,initial.id);
 const retry=await f.service.start(a);await f.write(retry,'src/b.vue');await until(async()=> (await f.saved())[0]?.id===retry.id);
 await f.write(job);await sleep(30);assert.equal((await f.saved())[0].id,retry.id);
});
test('Browser解析回復: pollより短い期限で、未完了の実HTTP要求をGETなしで中断する',async t=>{
 let reached=false,disconnected=false,settled=false,signal;
 const server=createServer((_req,res)=>{reached=true;res.writeHead(200,{'content-type':'application/json'});res.write('{');res.on('close',()=>{disconnected=true;});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const f=await fixture(t,{waitMs:1500,pollMs:100000,runAgent:async args=>{signal=args.signal;try{return await fetch(`http://127.0.0.1:${server.address().port}/run`,{signal}).then(res=>res.json());}finally{settled=true;}}});
 const job=await f.service.start(a);await until(()=>reached);await writeFile(join(f.root,job.resultPath),'{');assert.equal((await f.service.get(a)).job.status,'waiting');
 await until(()=>settled&&disconnected);assert.equal(signal.aborted,true);assert.equal((await f.service.get(a)).job.status,'timeout');assert.deepEqual(await f.saved(),[]);
});
test('Browser解析回復: エージェント終了時の不正JSONはinvalidで確定し、再解析できる',async t=>{
 const f=await fixture(t),job=await f.service.start(a);await until(()=>f.agents.has(job.id));await writeFile(join(f.root,job.resultPath),'{');f.agents.get(job.id).resolve();
 await until(async()=> (await f.service.get(a)).job.status==='invalid');assert.match((await f.service.get(a)).job.message,/再解析/);assert.deepEqual(await f.saved(),[]);
 const retry=await f.service.start(a);await f.write(retry);await until(async()=> (await f.saved())[0]?.id===retry.id);
});
test('Browser解析回復: 不正結果のページを離れて複数URLを解析し、監視窓の破棄後も混同せず保存する',async t=>{
 const f=await fixture(t),first=await f.service.start(a),second=await f.service.start(b);await writeFile(join(f.root,first.resultPath),'{');await writeFile(join(f.root,second.resultPath),'{');
 const states=[],monitor=createBrowserAnalysisStatus({read:url=>f.service.get(url,{statusOnly:true}),changed:value=>states.push(value),pollMs:5});t.after(()=>monitor.dispose());
 monitor.setPage(a);await until(()=>states.at(-1)?.status==='waiting');monitor.setPage(b);await until(()=>states.at(-1)?.url===b&&states.at(-1)?.status==='waiting');monitor.dispose();
 await f.write(second,'src/b.vue');await f.write(first);await until(async()=> (await f.saved()).length===2);
 const values=await f.saved();assert.equal(values.find(row=>row.url===a).id,first.id);assert.equal(values.find(row=>row.url===b).files[0].path,'src/b.vue');
 const restored=createBrowserAnalysisStatus({read:url=>f.service.get(url,{statusOnly:true}),changed:value=>states.push(value)});t.after(()=>restored.dispose());restored.setPage(a);await until(()=>states.at(-1)?.resultId===first.id);assert.equal(states.at(-1).status,'complete');
});
test('Browser解析回復: 不正JSONを待機中も5件上限に含め、全ジョブを終了時にAbortする',async t=>{
 const f=await fixture(t),jobs=[];for(let i=0;i<5;i++){const job=await f.service.start(a+i);jobs.push(job);await writeFile(join(f.root,job.resultPath),'{');}
 await sleep(30);await assert.rejects(f.service.start(b),/5件/);f.service.close();for(const job of jobs)assert.equal(f.agents.get(job.id).signal.aborted,true);
});

test('Browser解析回復: 期限タイマーが早く発火しても再予約し、pollなしで期限のAbortを保証する',async t=>{
 let clock=0;const f=await fixture(t,{now:()=>clock,waitMs:20,pollMs:100000}),job=await f.service.start(a);await until(()=>f.agents.has(job.id));
 await sleep(60);assert.equal(f.agents.get(job.id).signal.aborted,false);clock=21;await until(()=>f.agents.get(job.id).signal.aborted);assert.equal((await f.service.get(a)).job.status,'timeout');
});

// fsをmockせず、実スレッドプールの待ちを作ってrenameと終了通知の競合を再現する。
function occupyFileWorkers(){
 return Promise.all(Array.from({length:Number(process.env.UV_THREADPOOL_SIZE)||4},()=>new Promise((resolve,reject)=>{
  pbkdf2('browser-analysis','commit-race',1500000,32,'sha256',error=>error?reject(error):resolve());
 })));
}
async function commitFixture(t,atCommit){
 let clock=0,armed=false,workers=Promise.resolve();
 const f=await fixture(t,{waitMs:30,pollMs:100000,now:()=>{
  const value=clock;
  // createdAtの取得時にはまだ存在しない、保存用tmpの書込完了を境界にする。
  if(armed&&readdirSync(folder).some(name=>name.endsWith('.tmp'))){armed=false;workers=occupyFileWorkers();atCommit({expire:()=>{clock=31;},f,record});}
  return value;
 }});
 const folder=join(f.root,'_AIDIY/aidiy_browser/browser_analyses'),record=join(folder,createHash('sha256').update(a).digest('hex')+'.json');
 const initial=await f.service.start(a);await f.write(initial);await f.service.get(a);
 const job=await f.service.start(a);await f.write(job,'src/b.vue');await until(()=>f.agents.has(job.id));
 t.after(async()=>{await workers;});
 return{...f,initial,job,record,run(){armed=true;return f.service.get(a);}};
}
test('Browser解析回復: 実FSの保存待ちと期限が競合してもtimeoutからcompleteへ復活しない',async t=>{
 const f=await commitFixture(t,({expire})=>expire()),signal=f.agents.get(f.job.id).signal;
 const value=await f.run();
 if(value.job.status==='timeout'){
  assert.equal(signal.aborted,true);assert.equal(value.result.id,f.initial.id);
 }else{
  assert.equal(value.job.status,'complete');assert.equal(signal.aborted,false,'期限Abortを確定した実行をcompleteへ戻してはいけない');assert.equal(value.result.id,f.job.id);
 }
 assert.equal(JSON.parse(await readFile(f.record,'utf8')).id,value.result.id);
});
test('Browser解析回復: 実FSの保存待ちとcloseが競合しても閉鎖後に保存結果を変更しない',async t=>{
 let savedAtClose;
 const f=await commitFixture(t,({f,record})=>queueMicrotask(()=>{f.service.close();savedAtClose=JSON.parse(readFileSync(record,'utf8')).id;}));
 await f.run();assert.ok(savedAtClose);assert.equal(JSON.parse(await readFile(f.record,'utf8')).id,savedAtClose);
});
