// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// API と排他の回帰。導入コマンド・診断・保存はすべて合成し、実環境を変更しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHandler,createServer} from '../diag_main.mjs';
import {createInstallManager} from '../導入管理/導入管理.mjs';

const entries=[{id:'codex',name:'Codex'},{id:'claude',name:'Claude'},{id:'python',name:'Python'}];
const token='synthetic-install-manager-api';
const prefix='/proxy/8097/';
const authorization=`Bearer ${token}`;
const npm={executable:'/fixture/node',cli:'/fixture/npm-cli.js',prefix:'/fixture/global',root:'/fixture/global/lib/node_modules'};
const success={code:0,error:false,cancelled:false,timedOut:false,overflow:false};
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function until(predicate){const deadline=Date.now()+3000;while(!await predicate()){if(Date.now()>deadline)assert.fail('合成処理の完了を待機できませんでした。');await new Promise(resolve=>setTimeout(resolve,2));}}
async function request(handler,route,{method='POST',headers={authorization},url}={}){
  const response=new EventEmitter();Object.assign(response,{status:0,body:null,writableEnded:false,writeHead(status){this.status=status;},end(bytes){this.body=JSON.parse(bytes.toString());this.writableEnded=true;}});
  await handler({url:url??prefix+route,method,headers},response);return response;
}
function fixture(t,{managerOptions={},...options}={}){
  let manager;const commands=[],probes=[],writes=[];
  const configuration={token,prefix,entries,publicCache:{snapshot:()=>({})},modelTrials:{close:async()=>{}},startManager:{close:async()=>{}},appLauncher:{},
    probeFn:async entry=>{probes.push(entry.id);return {id:entry.id,状態:'OK',バージョン:'new'};},
    scanFn:async()=>entries.map(entry=>({id:entry.id,状態:'OK',バージョン:'bulk'})),
    installWriteFn:async(_entries,results)=>{writes.push(results);return {件数:results.length};},
    installManagerFactory:parameters=>{manager=createInstallManager({...parameters,env:{},acquireLock:async()=>async()=>{},findNpmFn:async()=>npm,capabilityFn:async entry=>({id:entry.id,操作:['導入','再導入','削除']}),run:async command=>{commands.push(command);return success;},...managerOptions});return manager;},...options};
  const handler=createHandler(configuration);t.after(()=>handler.close());
  return {handler,configuration,get manager(){return manager;},commands,probes,writes};
}
async function settled(manager){await until(()=>!manager.busy());return (await manager.snapshot()).実行;}

test('導入 API は認証・本文・クエリ・固定 ID/操作/経路を検証し、不正入力で実行しない',async t=>{
  const {handler,commands,probes}=fixture(t);
  for(const [route,method] of [['api/導入管理','GET'],['api/導入管理/codex/導入','POST'],['api/導入管理/unknown','DELETE']]){
    assert.equal((await request(handler,route,{method,headers:{}})).status,401);
    assert.equal((await request(handler,route,{method,headers:{authorization:'Bearer wrong'}})).status,401);
  }
  for(const headers of [{authorization,'content-length':'2'},{authorization,'transfer-encoding':'chunked'}]){
    assert.equal((await request(handler,'api/導入管理/codex/導入',{headers})).status,400);
    assert.equal((await request(handler,'api/導入管理/unknown',{method:'DELETE',headers})).status,400);
  }
  for(const route of ['api/導入管理?command=bad','api/導入管理/codex/導入?args=bad','api/導入管理/codex/導入?registry=https://invalid.example'])assert.equal((await request(handler,route,{method:route==='api/導入管理?command=bad'?'GET':'POST'})).status,400);
  for(const route of ['api/導入管理/node/導入','api/導入管理/npm/導入','api/導入管理/constructor/導入','api/導入管理/toString/導入','api/導入管理/codex/install','api/導入管理/codex/導入/extra','api/導入管理/codex%2Fextra/導入','api/導入管理/codex','api/導入管理//導入','api/導入管理/codex/','api/導入管理/codex%00/導入'])assert.equal((await request(handler,route)).status,404,route);
  for(const method of ['GET','PUT','PATCH'])assert.equal((await request(handler,'api/導入管理/codex/導入',{method})).status,404);
  assert.equal((await request(handler,'api/導入管理/codex/導入',{method:'DELETE'})).status,404);
  assert.equal((await request(handler,'api/導入管理/unknown',{method:'DELETE'})).status,404);
  assert.equal((await request(handler,'unused',{url:'/outside/api/導入管理/codex/導入'})).status,404);
  assert.equal((await request(handler,'unused',{url:prefix+'api/%E0%A4%A'})).status,400);
  assert.equal(commands.length,0);assert.equal(probes.length,0);
  const snapshot=await request(handler,'api/%E5%B0%8E%E5%85%A5%E7%AE%A1%E7%90%86',{method:'GET'});assert.equal(snapshot.status,200);assert.equal(snapshot.body.実行,null);assert.equal(snapshot.body.項目.length,3);assert.deepEqual(snapshot.body.項目[2].操作,[]);
});

test('導入後の自動確認は対象だけ差し替え、完了後の書込に最新結果を使う',async t=>{
  const {handler,manager,commands,probes,writes}=fixture(t);
  await request(handler,'api/診断');
  const started=await request(handler,'api/導入管理/codex/導入');assert.equal(started.status,200);assert.equal(started.body.実行.対象,'codex');
  const job=await settled(manager);assert.equal(job.状態,'完了');assert.equal(job.確認済み,true);assert.ok(job.前回実行日時);assert.deepEqual(probes,['codex']);assert.equal(commands.length,1);assert.equal(writes.length,0,'操作後も自動保存しない');
  const list=(await request(handler,'api/一覧',{method:'GET'})).body;
  assert.deepEqual(list.結果.map(row=>[row.id,row.バージョン]),[['codex','new'],['claude','bulk'],['python','bulk']]);
  assert.equal((await request(handler,'api/書込')).status,200);assert.equal(writes.length,1);assert.equal(writes[0][0].バージョン,'new');
});

test('前回保存済み行を今回の確認済みに混ぜず、残りの個別確認後に書込を許す',async t=>{
  const previous=entries.map(entry=>({id:entry.id,状態:'OK',バージョン:'previous',前回結果:true}));
  const {handler,manager,writes}=fixture(t,{previousResults:{snapshot:async()=>({導入状況:{結果:previous,前回実行日時:'2026-10-18T00:00:00.000Z'}})}});
  await request(handler,'api/導入管理/codex/導入');assert.equal((await settled(manager)).確認済み,false);assert.equal((await request(handler,'api/書込')).status,409);assert.equal(writes.length,0);
  const list=(await request(handler,'api/一覧',{method:'GET'})).body;assert.deepEqual(list.結果.map(row=>row.バージョン),['new','previous','previous']);
  await request(handler,'api/診断/claude');await request(handler,'api/診断/python');assert.equal((await request(handler,'api/書込')).status,200);assert.equal(writes.length,1);
});

test('導入失敗後も確認結果を一覧へ反映し、エラーの秘密情報を返さない',async t=>{
  for(const result of [{...success,code:17},null]){
    let checked=0;
    const {handler,manager}=fixture(t,{probeFn:async entry=>{checked++;return {id:entry.id,状態:'未検出',説明:'合成の未導入'};},managerOptions:{run:async()=>{if(!result)throw Error('synthetic-private-install-path');return result;}}});
    await request(handler,'api/導入管理/codex/導入');const job=await settled(manager);assert.equal(job.状態,'失敗');assert.equal(checked,1);assert.doesNotMatch(JSON.stringify(job),/synthetic-private-install-path/);
    const list=(await request(handler,'api/一覧',{method:'GET'})).body;assert.deepEqual(list.結果,[{id:'codex',状態:'未検出',説明:'合成の未導入'}]);
  }
});

test('導入実行中・中止待機・確認中は同じ項目の連打、個別/一括診断、書込を拒否する',async t=>{
  const commandGate=defer(),probeGate=defer();let command,checking=false;t.after(()=>{commandGate.resolve();probeGate.resolve();});
  const {handler,manager}=fixture(t,{managerOptions:{run:async value=>{command=value;await commandGate.promise;return {...success,cancelled:value.signal.aborted};}},probeFn:async entry=>{checking=true;await probeGate.promise;return {id:entry.id,状態:'未検出'};}});
  const started=await request(handler,'api/導入管理/codex/導入');await until(()=>command);
  const blocked=['api/導入管理/codex/導入','api/診断/codex','api/診断/claude','api/診断','api/書込'];
  for(const route of blocked)assert.equal((await request(handler,route)).status,409,route);
  const id=started.body.実行.実行ID;
  assert.equal((await request(handler,'api/導入管理/not-the-owned-job',{method:'DELETE'})).status,404);assert.equal(command.signal.aborted,false);
  assert.equal((await request(handler,`api/導入管理/${id}`,{method:'DELETE'})).status,200);assert.equal(command.signal.aborted,true);
  for(const route of blocked)assert.equal((await request(handler,route)).status,409,route);
  commandGate.resolve();await until(()=>checking);assert.equal((await request(handler,'api/導入管理',{method:'GET'})).body.実行.状態,'確認中');
  for(const route of blocked)assert.equal((await request(handler,route)).status,409,route);
  probeGate.resolve();assert.equal((await settled(manager)).状態,'中止');
  assert.equal((await request(handler,'api/診断/claude')).status,200);
});

test('個別診断・一括診断・書込から導入への逆方向排他も維持する',async t=>{
  let probeGate=null,scanGate=null,writeGate=null,probeCalls=0,scanCalls=0,writeCalls=0;
  t.after(()=>{probeGate?.resolve();scanGate?.resolve();writeGate?.resolve();});
  const {handler,commands}=fixture(t,{
    probeFn:async entry=>{probeCalls++;if(probeGate)await probeGate.promise;return {id:entry.id,状態:'OK'};},
    scanFn:async()=>{scanCalls++;if(scanGate)await scanGate.promise;return entries.map(entry=>({id:entry.id,状態:'OK'}));},
    installWriteFn:async()=>{writeCalls++;if(writeGate)await writeGate.promise;return {件数:3};}
  });
  const blocked=['api/導入管理/codex/導入','api/導入管理/claude/削除'];
  probeGate=defer();const single=request(handler,'api/診断/codex');await until(()=>probeCalls===1);for(const route of blocked)assert.equal((await request(handler,route)).status,409);probeGate.resolve();await single;probeGate=null;
  scanGate=defer();const bulk=request(handler,'api/診断');await until(()=>scanCalls===1);for(const route of blocked)assert.equal((await request(handler,route)).status,409);scanGate.resolve();await bulk;scanGate=null;
  writeGate=defer();const writing=request(handler,'api/書込');await until(()=>writeCalls===1);for(const route of blocked)assert.equal((await request(handler,route)).status,409);writeGate.resolve();await writing;writeGate=null;
  assert.equal(commands.length,0);
});

test('API の npm 再導入は固定 install 1回だけで更新し、個別確認結果を一覧へ反映する',async t=>{
  const {handler,manager,commands,probes,writes}=fixture(t);
  await request(handler,'api/診断');
  assert.equal((await request(handler,'api/導入管理/codex/再導入')).status,200);
  const job=await settled(manager);assert.equal(job.状態,'完了');assert.equal(job.確認済み,true);
  assert.deepEqual(commands.map(command=>[command.args[1],command.args.at(-1)]),[['install','@openai/codex']]);assert.deepEqual(probes,['codex']);assert.doesNotMatch(job.ログ,/uninstall/);assert.equal(writes.length,0);
  const list=(await request(handler,'api/一覧',{method:'GET'})).body;
  assert.deepEqual(list.結果.map(row=>[row.id,row.バージョン]),[['codex','new'],['claude','bulk'],['python','bulk']]);
});

test('API の削除は固定 npm uninstall の後に存在を確認する',async t=>{
  const {handler,manager,commands}=fixture(t,{probeFn:async entry=>({id:entry.id,状態:'未検出',パス:null})});
  assert.equal((await request(handler,'api/導入管理/claude/削除')).status,200);const job=await settled(manager);assert.equal(job.状態,'完了');assert.equal(job.結果.状態,'未検出');assert.equal(commands.length,1);assert.equal(commands[0].args[1],'uninstall');assert.equal(commands[0].args.at(-1),'@anthropic-ai/claude-code');
});

test('サーバー終了は所有する導入処理だけを中止して最後の確認まで進める',async t=>{
  let manager,active,closedTrials=0,closedStarts=0,checks=0;const gate=defer();
  const server=createServer({token,entries,modelTrials:{close:async()=>{closedTrials++;}},startManager:{close:async()=>{closedStarts++;}},appLauncher:{},publicCache:{snapshot:()=>({})},
    probeFn:async entry=>{checks++;return {id:entry.id,状態:'未検出'};},
    installManagerFactory:parameters=>{manager=createInstallManager({...parameters,env:{},acquireLock:async()=>async()=>{},findNpmFn:async()=>npm,capabilityFn:async entry=>({id:entry.id,操作:['導入']}),run:async command=>{active=command;await gate.promise;return {...success,cancelled:command.signal.aborted};}});return manager;}});
  t.after(async()=>{gate.resolve();server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));await manager.close();});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/導入管理/codex/導入`,{method:'POST',headers:{authorization}});assert.equal(response.status,200);await response.json();await until(()=>active);
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  assert.equal(closedTrials,1);assert.equal(closedStarts,1);assert.equal(active.signal.aborted,true);assert.equal(manager.busy(),true);
  gate.resolve();const job=await settled(manager);assert.equal(job.状態,'中止');assert.equal(checks,1);await assert.rejects(()=>manager.start('codex','導入'),{status:409});
});

test('FFmpeg 一式は1操作・3個別確認を共有一覧へ反映し、他行と書込内容を保持する',async t=>{
  const all=['ffmpeg','ffprobe','ffplay','uv'].map(id=>({id,name:id})),checked=[],operations=[];
  const {handler,manager,writes}=fixture(t,{entries:all,scanFn:async()=>all.map(entry=>({id:entry.id,状態:'OK',バージョン:'before'})),
    probeFn:async entry=>{checked.push(entry.id);return {id:entry.id,状態:'OK',バージョン:'after'};},managerOptions:{platform:'win32',
      inspectWingetFn:async({entries})=>({items:entries.map(entry=>({id:entry.id,操作:['再導入']})),context:{lockKey:'fixture-winget'}}),
      executeWingetFn:async(entry,action)=>{operations.push([entry.id,action]);return success;}}});
  await request(handler,'api/診断');assert.equal((await request(handler,'api/導入管理/ffprobe/再導入')).status,200);
  const job=await settled(manager);assert.equal(job.状態,'完了');assert.equal(job.確認済み,true);assert.deepEqual(operations,[['ffprobe','再導入']]);
  assert.deepEqual(checked,['ffmpeg','ffprobe','ffplay']);assert.deepEqual(job.結果一覧.map(row=>row.id),checked);assert.equal(job.結果.id,'ffprobe');
  const list=(await request(handler,'api/一覧',{method:'GET'})).body;
  assert.deepEqual(list.結果.map(row=>row.バージョン),['after','after','after','before']);assert.equal(writes.length,0);
  assert.equal((await request(handler,'api/書込')).status,200);assert.deepEqual(writes[0].map(row=>row.バージョン),['after','after','after','before']);
});
