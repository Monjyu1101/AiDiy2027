// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 固定プロバイダーの統合試験。実際の winget / インストーラー / 導入先は使わない。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInstallManager} from '../導入管理/導入管理.mjs';
import {catalog} from '../診断/probes.mjs';
const ids=['ffmpeg','ffprobe','ffplay','uv','ollama','obs','code','agy','node','grok','chrome','python','electron'];
const entries=ids.map(id=>({id,name:id,commands:[id]}));
const success={code:0,error:false,cancelled:false,timedOut:false,overflow:false};
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function until(predicate){const end=Date.now()+3000;while(!await predicate()){if(Date.now()>end)assert.fail('合成処理の待機上限');await new Promise(resolve=>setTimeout(resolve,2));}}
async function settled(manager){await until(()=>!manager.busy());return (await manager.snapshot()).実行;}
function fixture(t,overrides={}){
  const probes=[],results=[],calls=[],locks=[];
  const inspectWingetFn=async({entries})=>({items:entries.map(entry=>({id:entry.id,操作:entry.id==='ollama'?['導入']:['導入','再導入','削除']})),context:{lockKey:'C:\\Windows\\aidiy-winget'}});
  const inspectAntigravityFn=async()=>({item:{id:'agy',操作:['導入','再導入','削除']},context:{prefix:'C:\\fixture\\agy\\bin'}});
  const inspectGrokFn=async()=>({item:{id:'grok',操作:['導入','再導入','削除']},context:{prefix:'C:\\fixture\\.grok\\bin',lockKey:'C:\\fixture\\.grok\\bin'}});
  const execute=async(entry,action,context,options)=>{calls.push({id:entry.id,action,context,options});options.onData('固定プロバイダーの合成ログ\n');return success;};
  const manager=createInstallManager({entries,env:{PATH:'C:\\fixture',OPENAI_API_KEY:'fixture-private-key'},platform:'win32',findNpmFn:()=>assert.fail('npm 非対象'),inspectWingetFn,inspectAntigravityFn,inspectGrokFn,executeWingetFn:execute,executeAntigravityFn:execute,executeGrokFn:execute,acquireLock:async key=>{locks.push(key);return async()=>{};},run:()=>assert.fail('実コマンド禁止'),probeFn:async entry=>{probes.push(entry.id);return {id:entry.id,状態:'OK',説明:'共通 probe の合成結果',確認日時:'2026-10-19T23:00:00Z'};},onResult:result=>{results.push(result.id);return {確認済み:results.length===3};},...overrides});
  t.after(()=>manager.close());return {manager,probes,results,calls,locks};
}
test('FFmpeg は各行から単一パッケージ操作を行い、終了後3行を共通 probe / 結果反映へ1回ずつ渡す',async t=>{
  for(const id of ['ffmpeg','ffprobe','ffplay']){
    const f=fixture(t);await f.manager.start(id,'再導入');const job=await settled(f.manager);
    assert.equal(job.状態,'完了');assert.equal(f.calls.length,1);assert.equal(f.calls[0].id,id);
    assert.deepEqual(f.probes,['ffmpeg','ffprobe','ffplay']);assert.deepEqual(f.results,f.probes);
    assert.deepEqual(job.結果一覧.map(row=>row.id),f.probes);assert.equal(job.結果.id,id);assert.equal(job.確認済み,true);
    assert.deepEqual(job.関連項目,f.probes);assert.equal(f.locks.length,1);
    assert.equal(f.calls[0].options.env.OPENAI_API_KEY,undefined);
  }
});
test('FFmpeg の削除失敗・中止でも3項目を確認し、1項目の probe 例外で後続を飛ばさない',async t=>{
  for(const action of ['失敗','中止','probe例外']){
    const gate=defer();let executing=false;const probes=[];
    const f=fixture(t,{executeWingetFn:async(_entry,_action,_context,options)=>{executing=true;if(action==='中止'){await gate.promise;assert.equal(options.signal.aborted,true);}if(action==='失敗')throw Object.assign(Error('合成の失敗'),{status:409});},probeFn:async entry=>{probes.push(entry.id);if(action==='probe例外'&&entry.id==='ffprobe')throw Error('private detail');return {id:entry.id,状態:'未検出',パス:null};}});
    const state=await f.manager.start('ffmpeg','削除');await until(()=>executing);
    if(action==='中止'){await f.manager.cancel(state.実行.実行ID);gate.resolve();}
    const job=await settled(f.manager);assert.deepEqual(probes,['ffmpeg','ffprobe','ffplay']);assert.doesNotMatch(job.ログ,/private detail/);
    assert.equal(job.状態,action==='中止'?'中止':'失敗');
  }
});
test('追加対象は同じコンソール・排他を使い、未承認対象と Ollama 削除は実行しない',async t=>{
  for(const id of ['ollama','obs','agy','grok','chrome']){
    const f=fixture(t);await f.manager.start(id,'導入');const job=await settled(f.manager);
    assert.equal(job.状態,'完了');assert.deepEqual(f.probes,[id]);assert.equal(f.calls.length,1);assert.match(job.ログ,/固定プロバイダー/);
  }
  const f=fixture(t);
  for(const id of ['node','python','uv','code','electron','constructor','toString','__proto__'])await assert.rejects(()=>f.manager.start(id,'導入'),{status:404});
  await f.manager.start('ollama','削除');assert.equal((await settled(f.manager)).状態,'失敗');assert.equal(f.calls.length,0);
});
test('Ollama 更新はモデル保存先だけを確認・更新環境へ渡し、他のCLIや秘密設定には広げない',async t=>{
  for(const id of ['ollama','obs']){
    const models='D:\\shared models',inspections=[];
    const f=fixture(t,{env:{OLLAMA_MODELS:models,OLLAMA_API_KEY:'fixture-private-key',OLLAMA_HOST:'http://other.invalid',OPENAI_API_KEY:'fixture-private-key'},inspectWingetFn:async({entries,env})=>{
      inspections.push(env);return {items:entries.map(entry=>({id:entry.id,操作:['再導入']})),context:{lockKey:'C:\\Windows\\aidiy-winget'}};
    }});
    await f.manager.start(id,'再導入');assert.equal((await settled(f.manager)).状態,'完了');assert.equal(f.calls.length,1);
    assert.ok(inspections.length>0);assert.ok(inspections.every(env=>env.OLLAMA_MODELS===models));
    assert.equal(f.calls[0].options.env.OLLAMA_MODELS,id==='ollama'?models:undefined);
    for(const env of [...inspections,f.calls[0].options.env])for(const key of ['OLLAMA_API_KEY','OLLAMA_HOST','OPENAI_API_KEY'])assert.equal(env[key],undefined);
  }
});
test('WinGet 所有元とロックキーをロック下で再照合し、変更時は操作しない',async t=>{
  for(const change of ['ownership','lock']){
    let locked=false,released=false;const f=fixture(t,{acquireLock:async()=>{locked=true;return async()=>{released=true;};},inspectWingetFn:async({entries})=>({items:entries.map(entry=>({id:entry.id,操作:locked&&change==='ownership'?[]:['導入']})),context:{lockKey:locked&&change==='lock'?'changed':'original'}})});
    await f.manager.start('obs','導入');assert.equal((await settled(f.manager)).状態,'失敗');assert.equal(f.calls.length,0);assert.equal(released,true);
  }
});
test('追加プロバイダーの停止未確認は同一項目だけ拒否し、別項目は並行でき、最終確認までロックを保持する',async t=>{
  const gate=defer(),releases=[];let options;
  const f=fixture(t,{acquireLock:async(_key,lock)=>async()=>{releases.push(lock.scope);},executeAntigravityFn:async(_e,_a,_c,value)=>{options=value;await gate.promise;throw Object.assign(Error('操作を中止しました。'),{status:409});}});
  t.after(()=>gate.resolve());const initial=await f.manager.start('agy','再導入');await until(()=>options);await f.manager.cancel(initial.実行.実行ID);options.onUncertain();
  assert.equal((await f.manager.snapshot()).実行.状態,'停止未確認');assert.deepEqual(releases,[]);assert.equal(f.probes.length,0);
  await assert.rejects(()=>f.manager.start('agy','導入'),{status:409});
  // 別項目は停止未確認の項目を待たずに実行できる。
  await f.manager.start('obs','導入');await until(()=>releases.includes('obs'));assert.deepEqual(releases,['obs'],'停止未確認の agy のロックは保持する');
  gate.resolve();await settled(f.manager);const jobs=(await f.manager.snapshot()).実行一覧;
  assert.equal(jobs.find(job=>job.対象==='agy').状態,'中止');assert.equal(jobs.find(job=>job.対象==='obs').状態,'完了');assert.deepEqual(releases,['obs','agy']);assert.deepEqual(f.probes,['obs','agy']);
});
test('WinGet 既定配置を共通カタログに登録し、操作直後と手動確認で同じ探索先を使う',async()=>{
  const all=await catalog();
  for(const id of ['ffmpeg','ffprobe','ffplay','uv']){
    const entry=all.find(row=>row.id===id);assert.ok(entry.paths.win32.includes(`$LOCALAPPDATA/Microsoft/WinGet/Links/${id}.exe`));assert.ok(entry.paths.win32.includes(`$PROGRAMFILES/WinGet/Links/${id}.exe`));
  }
  assert.ok(all.find(row=>row.id==='ollama').paths.win32.includes('$LOCALAPPDATA/Programs/Ollama/ollama.exe'));
  assert.ok(all.find(row=>row.id==='code').paths.win32.includes('$PROGRAMFILES/Microsoft VS Code/bin/code.cmd'));
});

test('実操作成功後の未導入照会コードを、操作の終了コードとして表示しない',async t=>{
  const f=fixture(t,{run:async command=>({...success,code:command.表示?0:0x8a150014}),executeWingetFn:async(_entry,_action,_context,options)=>{
    const result=await options.run({executable:'fixture-winget',args:['uninstall'],表示:'固定の削除',onData:options.onData});
    await options.run({executable:'fixture-winget',args:['list'],onData:()=>{}});return result;
  },probeFn:async entry=>({id:entry.id,状態:'未検出',パス:null})});
  await f.manager.start('obs','削除');const job=await settled(f.manager);assert.equal(job.状態,'完了');assert.equal(job.終了コード,0);
});
