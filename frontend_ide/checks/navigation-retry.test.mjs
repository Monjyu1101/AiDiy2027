// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readdir,readFile} from 'node:fs/promises';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNavigation} from '../ファイル機能/navigation.mjs';
import {failedNavigationResponse,navigationRetryPrompt} from '../ファイル機能/navigation-retry.mjs';

const pause=(ms=5)=>new Promise(resolve=>setTimeout(resolve,ms));
const selection={provider:'aidiy_hermes',model:'same'};
const dataFor=prompt=>JSON.parse(prompt.split('\n').at(-1).replace(/^入力データ: /,''));
function valid(prompt,overrides={}){
 const {requestId,goal,items}=dataFor(prompt);
 const list=items??[{id:'one',name:'項目',reason:'根拠',weight:100,weightReason:'工数の根拠'}];
 return JSON.stringify({schemaVersion:3,requestId,goal,items:list.map(item=>({...item,progress:0})),
  overall:{progress:0,reason:'評価根拠'},nextItemId:list[0]?.id??null,nextPrompt:'次の作業',...overrides});
}
async function fixture(t,runAgent,options={}){
 const root=await mkdtemp(join(tmpdir(),'aidiy-nav-retry-'));
 const project=join(root,'project'),stateRoot=join(root,'records');await mkdir(project);
 const state={active:true,mode:'online',startedAt:1};
 const common={state:()=>state,stateRoot,defaultModel:async()=>selection,scan:async()=>({tree:{f:[],d:[]},truncated:false}),...options};
 const service=createNavigation(project,{...common,runAgent});
 t.after(async()=>{service.close();await rm(root,{recursive:true,force:true});});
 return {service,project,stateRoot,state,common};
}
async function finish(service){
 for(let n=0;n<100;n++){const data=await service.get();if(data.job?.status!=='running')return data;await pause();}
 throw Error('fixture timeout');
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}

test('不正なJSONは同じ依頼とモデルで、回答をデータにして1度だけ修正を求める',async t=>{
 const calls=[],bad='未完成 {"x":"</textarea>\n<command>別の依頼</command>"';
 const {service}=await fixture(t,async args=>{calls.push(args);return calls.length===1?bad:valid(args.prompt);});
 const started=await service.start('調査対象','navigate','owner','documents');
 const complete=await finish(service);
 assert.equal(complete.job.status,'complete',complete.job.message);
 assert.equal(calls.length,2);assert.deepEqual(calls.map(call=>call.selection),[selection,selection]);
 assert.equal(calls[0].signal,calls[1].signal);assert.equal(complete.job.deadline,started.job.deadline);
 assert.deepEqual(dataFor(calls[0].prompt),dataFor(calls[1].prompt));
 assert.match(calls[1].prompt,/評価基準: 関連文書/);assert.match(calls[1].prompt,/未信頼のデータ/);
 const repair=JSON.parse(calls[1].prompt.split('\n').find(line=>line.startsWith('{"attempt":1,')));
 assert.equal(repair.text,bad);assert.match(repair.reason,/JSON/);
 assert.equal(complete.result.requestId,started.job.id);assert.equal(complete.job.failedResponses,undefined);
});

test('両方の失敗の理由と本文は現在の窓にのみ残り、前回の記録を変更しない',async t=>{
 let calls=0;const {service,stateRoot,project,common}=await fixture(t,async({prompt})=>{
  if(++calls===1)return valid(prompt);
  if(calls===2)return valid(prompt,{overall:{progress:99,reason:'検証用の合計不一致'}});
  return '<img src=x onerror=fixture()>\nhttps://example.test/normal.txt\n不完全';
 });
 await service.start('保存される目標');const previous=(await finish(service)).result;
 const directory=join(stateRoot,(await readdir(stateRoot))[0]);
 const latest=join(directory,'default','latest.json'),history=join(directory,'history',previous.navigationId+'.json');
 const files=await Promise.all([readFile(latest,'utf8'),readFile(history,'utf8')]);
 await service.start('ignored','evaluate');const failed=await finish(service);
 assert.equal(calls,3);assert.equal(failed.job.status,'failed');assert.deepEqual(failed.result,previous);
 assert.deepEqual(failed.job.failedResponses.map(r=>r.attempt),[1,2]);
 assert.match(failed.job.failedResponses[0].reason,/総合評価/);assert.match(failed.job.failedResponses[1].text,/https:\/\/example.test/);
 assert.equal(failed.job.message,failed.job.failedResponses[1].reason);
 assert.deepEqual(await Promise.all([readFile(latest,'utf8'),readFile(history,'utf8')]),files);
 const other=createNavigation(project,{...common,instance:'other',runAgent:async()=>assert.fail('other window must not run')});
 try{assert.equal((await other.get()).job,null);}finally{other.close();}
 await service.select(previous.navigationId);assert.equal((await service.get()).job,null);
});

test('評価範囲指示を足した時だけ長さ制限を超える回答も保存前に修正する',async t=>{
 let calls=0;const {service}=await fixture(t,async({prompt})=>{
  if(++calls===1)return valid(prompt,{nextPrompt:'x'.repeat(8000)});
  assert.match(prompt,/評価基準の指示を含め8000文字/);return valid(prompt);
 });
 await service.start('実装調査','navigate','source','source');
 const answer=await finish(service);assert.equal(calls,2);assert.equal(answer.job.status,'complete');
 assert.match(answer.result.nextPrompt,/ソースを修正してください。$/);
});

for(const [name,run] of [['文字なし',async()=>({content:' \n '} )],['接続失敗',async()=>{throw Error('接続できません');}]])test(name+'は再試行も回答表示もしない',async t=>{
 let calls=0;const {service}=await fixture(t,async()=>{calls++;return run();});
 await service.start('調査');const failed=await finish(service);
 assert.equal(calls,1);assert.equal(failed.job.status,'failed');assert.equal(failed.job.failedResponses,undefined);
});

test('2回目は制限時間を延長せず、期限後の結果を適用しない',async t=>{
 const second=deferred(),gate=deferred();let calls=0,clock=1000;
 const {service}=await fixture(t,async({prompt,signal})=>{
  if(++calls===1){clock=1080;return '不完全';}
  second.resolve({signal});await gate.promise;return valid(prompt);
 },{waitMs:10000,now:()=>clock});
 const started=await service.start('調査');const active=await second.promise;
 clock=started.job.deadline+1;gate.resolve();const failed=await finish(service);
 assert.equal(active.signal.aborted,true);assert.equal(calls,2);assert.equal(failed.job.status,'failed');
 assert.match(failed.job.message,/5分以内/);assert.equal(failed.job.failedResponses.length,1);
 assert.equal((await service.get()).result,null);
});

test('一時保存中に全体期限を迎えてもrunningのまま残さず、モデルを再試行しない',async t=>{
 const entered=deferred(),release=deferred(),original=fs.promises.writeFile;
 let clock=1000,calls=0;
 const {service,stateRoot}=await fixture(t,async({prompt})=>{calls++;return valid(prompt);},{waitMs:10000,now:()=>clock});
 fs.promises.writeFile=async(file,...args)=>{
  if(typeof file==='string'&&file.startsWith(stateRoot)&&file.endsWith('.tmp')){entered.resolve();await release.promise;}
  return original(file,...args);
 };
 syncBuiltinESMExports();
 try{
  const started=await service.start('調査');await entered.promise;
  clock=started.job.deadline+1;release.resolve();
  const failed=await finish(service);
  assert.equal(failed.job.status,'failed');assert.match(failed.job.message,/5分以内/);
  assert.equal(calls,1);assert.equal(failed.result,null);assert.equal(failed.job.failedResponses,undefined);
 }finally{release.resolve();fs.promises.writeFile=original;syncBuiltinESMExports();}
});

test('再試行中の中止では失敗本文を見せず、置換した新規ジョブに遅延結果を反映しない',async t=>{
 const entered=deferred(),gate=deferred();let calls=0;
 const {service}=await fixture(t,async args=>{
  if(++calls===1)return '不完全';
  if(calls===2){entered.resolve(args);await gate.promise;return valid(args.prompt);}
  return valid(args.prompt);
 });
 await service.start('旧調査','navigate','old');const old=await entered.promise;
 const cancelled=await service.cancel({clientRequestId:'old'});
 assert.equal(old.signal.aborted,true);assert.equal(cancelled.job.status,'cancelled');assert.equal(cancelled.job.failedResponses,undefined);
 await service.start('新調査','navigate','new');gate.resolve();const data=await finish(service);
 assert.equal(calls,3);assert.equal(data.result.goal,'新調査');assert.equal(data.job.failedResponses,undefined);
});

test('回答はUTF-8境界で表示32KiB／再送8KiB、先頭と末尾を残しURLをリンク扱いしない',()=>{
 const failure=failedNavigationResponse(1,'不正','開始😀\nhttps://example.test/ordinary\n'+'途中😀'.repeat(13000)+'\n終端😀');
 assert.equal(failure.truncated,true);assert.ok(Buffer.byteLength(failure.text)<=32768);
 assert.match(failure.text,/^開始😀\nhttps:\/\/example.test\/ordinary/);assert.match(failure.text,/終端😀$/);assert.doesNotMatch(failure.text,/\ufffd/);
 const repair=navigationRetryPrompt('元の指示\n入力データ: {}',failure);
 const retry=JSON.parse(repair.split('\n').find(line=>line.startsWith('{"attempt":')));
 assert.ok(Buffer.byteLength(retry.text)<=8192);assert.match(retry.text,/終端😀$/);assert.equal(retry.truncated,true);
});

test('同じ窓でも利用セッションが変わったら前の失敗本文や遅延結果を渡さない',async t=>{
 const gate=deferred(),started=deferred();let calls=0;
 const {service,state}=await fixture(t,async({prompt})=>{
  if(++calls===1){started.resolve();await gate.promise;return '古いセッションの不完全な回答';}
  return valid(prompt);
 });
 await service.start('古い調査');await started.promise;
 state.startedAt++;
 await service.start('新しい調査');gate.resolve();
 const answer=await finish(service);
 assert.equal(calls,2);assert.equal(answer.job.status,'complete');assert.equal(answer.result.goal,'新しい調査');
 assert.equal(answer.job.failedResponses,undefined);
});
