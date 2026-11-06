// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readdir,readFile} from 'node:fs/promises';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createNavigation} from '../ファイル機能/navigation.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
const answer=prompt=>JSON.stringify(JSON.parse(prompt.split('\n').at(-1).replace(/^出力形式: /,'')));
async function fixture(t,options={}){
 const root=await mkdtemp(join(tmpdir(),'navigation-cancel-')),project=join(root,'project'),stateRoot=join(root,'state');await mkdir(project);
 const state={active:true,mode:'online',startedAt:1};
 const service=createNavigation(project,{state:()=>state,stateRoot,defaultModel:async()=>({provider:'aidiy_hermes',model:'auto'}),scan:async()=>({tree:{f:[],d:[]},truncated:false}),runAgent:async({prompt})=>answer(prompt),...options});
 t.after(async()=>{service.close();await rm(root,{recursive:true,force:true});});return {service,stateRoot};
}
async function finish(service){for(let i=0;i<200;i++){const value=await service.get();if(value.job?.status!=='running')return value;await pause();}throw Error('test timeout');}
// HTTP入力を実リクエストと同じPOSTとして渡す。
async function request(service,data){let status,body;const req=Readable.from([JSON.stringify(data)]);req.method='POST';await service.handle(req,{writeHead(code){status=code;return this;},end(value){body=JSON.parse(value);}},new URL('http://localhost/api/navigation'));return {status,body};}

test('開始前の中止を記憶し、別要求には影響しない（HTTP）',async t=>{
 let calls=0;const {service}=await fixture(t,{runAgent:async({prompt})=>{calls++;return answer(prompt);}});
 assert.equal((await request(service,{action:'cancel',clientRequestId:'first'})).status,200);
 const stopped=await request(service,{goal:'目標',clientRequestId:'first'});assert.equal(stopped.status,202);assert.equal(stopped.body.job.status,'cancelled');assert.equal(calls,0);
 await service.start('目標','navigate','second');assert.equal((await finish(service)).job.status,'complete');assert.equal(calls,1);
 assert.equal((await service.cancel({clientRequestId:'first'})).job.clientRequestId,'second');
});
for(const stage of ['availability','scan','model'])test('開始準備中の中止と新規開始: '+stage,async t=>{
 const entered=deferred(),gate=deferred();let blocked=false,calls=0,models=0;
 const block=async value=>{if(!blocked){blocked=true;entered.resolve();await gate.promise;}return value;};
 const options={runAgent:async({prompt})=>{calls++;return answer(prompt);}};
 if(stage==='availability')options.availability=()=>block({available:true});
 if(stage==='scan')options.scan=()=>block({tree:{f:[],d:[]},truncated:false});
 if(stage==='model')options.defaultModel=async()=>{models++;const model={provider:'aidiy_hermes',model:'auto'};return models===2?block(model):model;};
 const {service}=await fixture(t,options);const pending=service.start('旧目標','navigate','old');await entered.promise;
 const stopped=await service.cancel({clientRequestId:'old'});assert.equal(stopped.job.status,'cancelled');
 await service.start('新目標','navigate','new');gate.resolve();assert.equal((await pending).job.status,'cancelled');
 const result=await finish(service);assert.equal(result.job.clientRequestId,'new');assert.equal(result.result.goal,'新目標');assert.equal(calls,1);
});
for(const late of ['result','error'])test('評価中止は保存結果・履歴を維持し遅延応答を捨てる: '+late,async t=>{
 const gate=deferred();let calls=0,signal,latePrompt;const {service,stateRoot}=await fixture(t,{runAgent:async({prompt,signal:s})=>{if(++calls===2){signal=s;latePrompt=prompt;return gate.promise;}return answer(prompt);}});
 await service.start('保存目標');const saved=(await finish(service)).result;
 const base=join(stateRoot,(await readdir(stateRoot))[0]),latest=join(base,'default','latest.json'),history=join(base,'history',saved.navigationId+'.json');
 const before=[await readFile(latest,'utf8'),await readFile(history,'utf8')];
 const started=await service.start('','evaluate','evaluate-old');assert.equal(started.job.action,'evaluate');
 const stopped=await service.cancel({clientRequestId:'evaluate-old'});assert.equal(stopped.job.status,'cancelled');assert.equal(stopped.job.message,'処理を中止しました。');assert.equal(signal.aborted,true);
 if(late==='result')gate.resolve(answer(latePrompt));else gate.reject(Error('遅延失敗'));
 await pause();assert.deepEqual((await service.get()).result,saved);assert.equal((await service.get()).job.status,'cancelled');assert.deepEqual([await readFile(latest,'utf8'),await readFile(history,'utf8')],before);
 await service.start('次の目標','navigate','new');await service.cancel({clientRequestId:'evaluate-old'});assert.equal((await finish(service)).result.goal,'次の目標');
});
test('旧APIの実行をjobIdで中止し、古いjobIdは新規実行を中止しない',async t=>{
 const gate=deferred();let calls=0;const {service}=await fixture(t,{runAgent:async({prompt})=>++calls===1?gate.promise:answer(prompt)});
 const first=await service.start('旧目標');assert.equal(first.job.clientRequestId,null);
 assert.equal((await service.cancel({jobId:first.job.id})).job.status,'cancelled');
 await service.start('新目標');await service.cancel({jobId:first.job.id});assert.equal((await finish(service)).result.goal,'新目標');gate.resolve('遅延');
});
test('保存確定開始後の中止は完了まで待ち、新規開始を並行させない',async t=>{
 const entered=deferred(),gate=deferred(),original=fs.promises.rename;
 fs.promises.rename=async(source,target)=>{if(target.endsWith('latest.json')){entered.resolve();await gate.promise;}return original(source,target);};syncBuiltinESMExports();
 t.after(()=>{fs.promises.rename=original;syncBuiltinESMExports();gate.resolve();});
 const {service}=await fixture(t);await service.start('保存目標','navigate','committing');await entered.promise;
 let settled=false;const cancel=service.cancel({clientRequestId:'committing'}).then(value=>{settled=true;return value;});await pause();assert.equal(settled,false);
 await assert.rejects(service.start('別目標'),/作成中/);gate.resolve();assert.equal((await cancel).job.status,'complete');assert.equal((await service.get()).result.goal,'保存目標');
});
test('中止要求IDを必須検証し、HTTP経由でもjobIdで中止する',async t=>{
 const gate=deferred();const {service}=await fixture(t,{runAgent:()=>gate.promise});
 await assert.rejects(service.cancel(),/要求ID/);await assert.rejects(service.cancel({clientRequestId:''}),/要求ID/);await assert.rejects(service.start('目標','navigate','bad id'),/要求ID/);
 const started=await service.start('目標');assert.equal((await request(service,{action:'cancel',jobId:started.job.id})).body.job.status,'cancelled');gate.resolve('終了');
});

test('一時ファイル書込中の中止は確定保存を防ぎ、一時ファイルも片付ける',async t=>{
 const entered=deferred(),gate=deferred(),original=fs.promises.writeFile;
 fs.promises.writeFile=async(file,...args)=>{const result=await original(file,...args);if(String(file).endsWith('.tmp')){entered.resolve();await gate.promise;}return result;};syncBuiltinESMExports();
 t.after(()=>{fs.promises.writeFile=original;syncBuiltinESMExports();gate.resolve();});
 const {service,stateRoot}=await fixture(t);await service.start('目標','navigate','before-commit');await entered.promise;
 assert.equal((await service.cancel({clientRequestId:'before-commit'})).job.status,'cancelled');gate.resolve();
 const dir=join(stateRoot,(await readdir(stateRoot))[0],'default');for(let i=0;i<100&&(await readdir(dir)).length;i++)await pause();
 assert.deepEqual(await readdir(dir),[]);assert.equal((await service.get()).result,null);
});
test('中止記録はサービスごとに分離し、最新256要求に制限する',async t=>{
 const {service}=await fixture(t),other=(await fixture(t)).service;
 for(let i=0;i<257;i++)await service.cancel({clientRequestId:'request-'+i});
 assert.equal((await service.start('目標','navigate','request-256')).job.status,'cancelled');
 await other.start('別サービス','navigate','request-256');assert.equal((await finish(other)).job.status,'complete');
 await service.start('期限外','navigate','request-0');assert.equal((await finish(service)).job.status,'complete');
});
