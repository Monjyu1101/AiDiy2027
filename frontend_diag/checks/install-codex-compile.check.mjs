// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// aidiy_codex のコンパイル／再コンパイル（独立プロセス）。実際のコンパイル・ネットワークは行わない。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {CODEX_COMPILE_ID,COMPILE_SCRIPT,CODEX_DIR,codexBinaries,pidAlive,readCompileStatus,lastLogLine,inspectCodexCompile,executeCodexCompile} from '../diag/導入管理/codex_compile.mjs';
import {createInstallManager} from '../diag/導入管理/導入管理.mjs';

const entry={id:CODEX_COMPILE_ID,name:'AiDiy Codex',commands:['aidiy_codex']};
const env={USERPROFILE:'C:\\Users\\fixture',LOCALAPPDATA:'C:\\Users\\fixture\\AppData\\Local',PATH:''};
const found=map=>async program=>map[program.id]??null;
const ready={python:'C:\\py\\python.exe',cargo:'C:\\c\\cargo.exe','llvm-mingw':'C:\\l\\clang.exe'};
const idle=async()=>null,noLog=async()=>null;

test('the AiDiy object is ~/.aidiy/bin/aidiy_codex (outside the project, unaffected by clone or copy)',()=>{
  assert.deepEqual(codexBinaries('win32','C:\\Users\\fixture'),[path.join('C:\\Users\\fixture','.aidiy','bin','aidiy_codex.exe')]);
  assert.deepEqual(codexBinaries('linux','/home/fixture'),[path.join('/home/fixture','.aidiy','bin','aidiy_codex')]);
  for(const file of codexBinaries())assert.ok(path.relative(CODEX_DIR,file).startsWith('..'),'プロジェクト内に置かない');
});

test('status file: a dead compile process is shown as 中断, and the log tail is the last meaningful line',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'aidiy-codex-status-'));
  try{
    const file=path.join(directory,'status.json'),log=path.join(directory,'compile.log');
    await writeFile(file,JSON.stringify({状態:'コンパイル中',pid:424242,開始日時:'2026-11-14T00:00:00+00:00',ログ:log}));
    assert.equal((await readCompileStatus({file,alive:()=>true})).状態,'コンパイル中');
    assert.equal((await readCompileStatus({file,alive:()=>false})).状態,'中断');
    assert.equal(await readCompileStatus({file:path.join(directory,'none.json')}),null);
    await writeFile(log,'   Compiling serde v1.0.0\r\n\u001b[32m   Compiling tokio v1.40.0\u001b[0m\r\n\r\n');
    assert.equal(await lastLogLine(log),'Compiling tokio v1.40.0');
    assert.equal(pidAlive(process.pid),true);assert.equal(pidAlive(-1),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('missing prerequisites disable the compile button with a reason',async()=>{
  for(const [map,reason] of [[{},/Python/],[{python:'C:\\py\\python.exe'},/Rust/],[{python:'C:\\py\\python.exe',cargo:'C:\\c\\cargo.exe'},/llvm-mingw/]]){
    const {item}=await inspectCodexCompile(entry,{env,platform:'win32',arch:'x64',resolve:found(map),statusReader:idle,logReader:noLog});
    assert.deepEqual(item.操作,[]);assert.match(item.理由,reason);
  }
});

test('labels are コンパイル / 再コンパイル; a running compile shows its progress and blocks a second start',async()=>{
  const {item}=await inspectCodexCompile(entry,{env,platform:'win32',arch:'x64',resolve:found(ready),statusReader:idle,logReader:noLog});
  assert.equal(item.表示名.導入,'コンパイル');assert.equal(item.表示名.再導入,'再コンパイル');
  assert.equal(item.操作.length,1);assert.ok(['導入','再導入'].includes(item.操作[0]));assert.equal(item.外部実行中,undefined);
  const running=await inspectCodexCompile(entry,{env,platform:'win32',arch:'x64',resolve:found(ready),
    statusReader:async()=>({状態:'コンパイル中',pid:1,開始日時:'2026-11-14T00:00:00+00:00',ログ:'x'}),logReader:async()=>'Compiling v8 v152.2.0'});
  assert.deepEqual(running.item.操作,[]);assert.equal(running.item.外部実行中,true);
  assert.match(running.item.状況,/コンパイル中/);assert.match(running.item.状況,/Diag を閉じても続行/);assert.match(running.item.状況,/Compiling v8/);
  const failed=await inspectCodexCompile(entry,{env,platform:'win32',arch:'x64',resolve:found(ready),statusReader:async()=>({状態:'失敗',終了日時:'2026-11-14T00:00:00+00:00'}),logReader:noLog});
  assert.match(failed.item.状況,/失敗/);assert.equal(failed.item.操作.length,1);
});

test('the button only starts the fixed _compile.py --yes --detach and returns without waiting',async()=>{
  const calls=[];
  const run=async command=>{calls.push(command);return {code:0};};
  const result=await executeCodexCompile(entry,(await inspectCodexCompile(entry,{env,platform:'win32',arch:'x64',resolve:found(ready),statusReader:idle,logReader:noLog})).item.操作[0],{},
    {env,platform:'win32',arch:'x64',resolve:found(ready),run,statusReader:idle,logReader:noLog});
  assert.equal(result.非同期,true);assert.match(result.メッセージ,/独立プロセス/);
  assert.equal(calls.length,1);assert.equal(calls[0].executable,'C:\\py\\python.exe');
  assert.deepEqual(calls[0].args,['-X','utf8',COMPILE_SCRIPT,'--yes','--detach']);assert.equal(calls[0].cwd,CODEX_DIR);
  assert.ok(calls[0].timeout<=60*1000);
  const action=(await inspectCodexCompile(entry,{env,platform:'win32',arch:'x64',resolve:found(ready),statusReader:idle,logReader:noLog})).item.操作[0];
  await assert.rejects(executeCodexCompile(entry,action,{},{env,platform:'win32',arch:'x64',resolve:found(ready),run:async()=>({code:2}),statusReader:idle,logReader:noLog}),/すでにコンパイル中/);
  await assert.rejects(executeCodexCompile(entry,'削除',{},{env,platform:'win32',run}),/未対応/);
});

test('install manager: a detached start completes the job without failing the post-check, and re-checks when the compile ends',async()=>{
  let running=false,probes=0;const recorded=[];
  const manager=createInstallManager({entries:[entry],platform:'win32',
    probeFn:async()=>{probes++;return {id:CODEX_COMPILE_ID,状態:running?'未検出':'OK'};},onResult:result=>{recorded.push(result.状態);return {};},
    inspectCodexCompileFn:async()=>running?{item:{id:CODEX_COMPILE_ID,操作:[],外部実行中:true,状況:'コンパイル中'},context:{lockKey:'C:\\fixture\\target'}}
      :{item:{id:CODEX_COMPILE_ID,操作:['導入'],表示名:{導入:'コンパイル',再導入:'再コンパイル'}},context:{lockKey:'C:\\fixture\\target'}},
    executeCodexCompileFn:async()=>{running=true;return {code:0,非同期:true,メッセージ:'開始しました'};},acquireLock:async()=>async()=>{}});
  try{
    const started=await manager.start(CODEX_COMPILE_ID,'導入');assert.equal(started.実行.状態,'実行中');
    let job;for(let i=0;i<50;i++){job=(await manager.snapshot()).実行;if(!job.実行中)break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(job.状態,'完了');assert.match(job.説明,/開始しました/);
    assert.equal((await manager.snapshot()).項目[0].外部実行中,true);
    running=false;const before=probes;
    const done=(await manager.snapshot()).項目[0];
    assert.equal(done.外部実行中,undefined);assert.equal(done.最終確認.状態,'OK');assert.ok(probes>before);assert.equal(recorded.at(-1),'OK');
  }finally{await manager.close();}
});

test('while compiling, a new compile is refused at request time with 409 and nothing is executed',async()=>{
  let executed=0;
  const manager=createInstallManager({entries:[entry],platform:'win32',probeFn:async()=>({id:CODEX_COMPILE_ID,状態:'未検出'}),
    inspectCodexCompileFn:async()=>({item:{id:CODEX_COMPILE_ID,操作:[],外部実行中:true,状況:'コンパイル中',理由:'コンパイル中です。完了すると自動で確認します。'},context:{lockKey:'C:\fixture\target'}}),
    executeCodexCompileFn:async()=>{executed++;return {code:0,非同期:true};},acquireLock:async()=>async()=>{}});
  try{
    for(const action of ['導入','再導入']){
      await assert.rejects(manager.start(CODEX_COMPILE_ID,action),error=>error.status===409&&/コンパイル中/.test(error.message));
    }
    assert.equal(executed,0);assert.equal((await manager.snapshot()).実行一覧.length,0);
  }finally{await manager.close();}
});
