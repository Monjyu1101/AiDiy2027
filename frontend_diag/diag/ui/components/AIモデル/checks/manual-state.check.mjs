// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {watch} from 'vue';
import {AIモデル状態を作成} from '../AIモデル状態.mjs';
import {TRIAL_PROMPT,decisionQuestions} from '../../../../モデル試行/defaults.mjs';
import {createModelTrials} from '../../../../モデル試行/trials.mjs';
const catalog={区分:Object.fromEntries(['CHAT','LIVE','PREDICTION','DECISION','CODE'].map(f=>[f,{プロバイダ:[{id:'first',モデル:[{id:'one',名前:'One'},{id:'two',名前:'Two'}],音声:[{id:'voice'}]},{id:'second',モデル:[{id:'three'}],音声:[{id:'other'}]}]}]))};
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
const settle=()=>new Promise(r=>setImmediate(r));

test('Code provider switch uses configured default, while CODE1 initial value and manual choices are preserved',async()=>{
 const config={CODE_AI1_NAME:'codex_cli',CODE_AI1_MODEL:'panel-model',CODE_CODEX_CLI_MODEL:'auto',CODE_GROK_CLI_MODEL:'same',CODE_OPENCODE_CLI_MODEL:'openai/custom'};
 const before=JSON.stringify(config),trials=createModelTrials({reader:()=>JSON.stringify(config),request:()=>assert.fail('network'),catalogReader:async name=>name==='code_models'?{codex_cli:{models:{'panel-model':'Panel'}},grok_cli:{models:{'grok-test':'Grok'}},opencode_cli:{models:{'openai/listed':'Listed'}}}:{}});
 const s=AIモデル状態を作成({接続可能:()=>true,api:()=>trials.catalogs()});
 try{
  await s.読込();s.区分変更('CODE');assert.equal(s.入力.model,'panel-model');
  s.変更('provider','grok_cli');assert.equal(s.入力.model,'same');
  assert.deepEqual(s.モデル.value.slice(0,2).map(m=>m.id),['auto','same']);
  s.変更('model','grok-test');s.変更('provider','opencode_cli');assert.equal(s.入力.model,'openai/custom');
  assert.ok(s.モデル.value.find(m=>m.id==='openai/custom').保存値);
  s.変更('provider','grok_cli');assert.equal(s.入力.model,'grok-test');
  await s.読込();s.変更('provider','grok_cli');assert.equal(s.入力.model,'same');
  assert.equal(JSON.stringify(config),before);
 }finally{s.終了();await trials.close();}
});
test('provider/model/voice/family changes are local, linked, retain per-provider choice and do not mutate catalogs',async()=>{
 const calls=[],before=JSON.stringify(catalog),s=AIモデル状態を作成({接続可能:()=>true,api:async(...args)=>{calls.push(args);return catalog;}});await s.読込();assert.equal(calls.length,1);s.変更('model','two');s.変更('provider','second');assert.equal(s.入力.model,'three');s.変更('provider','first');assert.equal(s.入力.model,'two');s.区分変更('LIVE');s.変更('voice','voice');s.変更('prompt','自由');assert.equal(calls.length,1);assert.equal(JSON.stringify(catalog),before);s.終了();
});
test('double start suppressed, input edit cancels, late response never repopulates result',async()=>{
 const wait=deferred(),calls=[];const s=AIモデル状態を作成({接続可能:()=>true,api:async(path,method)=>{calls.push([path,method]);if(path==='api/AIモデル')return catalog;if(path.endsWith('/開始'))return {実行ID:'run',実行順:['CHAT']};if(method==='DELETE')return {};return wait.promise;}});await s.読込();const pending=s.開始();await settle();await s.開始();assert.equal(calls.filter(c=>c[0].endsWith('/開始')).length,1);s.変更('prompt','新しい入力');wait.resolve({状態:'OK',応答:'古い応答'});await pending;assert.equal(s.結果.value,null);assert.equal(s.実行中.value,false);assert.ok(calls.some(c=>c[1]==='DELETE'));s.終了();
});
test('Live auto-load uses shared audio, retry disposes old audio while navigation retains the loaded URL',async()=>{
 let next=0;const revoked=[],calls=[],id='a'.repeat(32),result={状態:'OK',応答:'字幕',音声ファイル:{id,MIME:'audio/wav',長さms:1200}};
 const s=AIモデル状態を作成({接続可能:()=>true,createURL:()=>`blob:${++next}`,revokeURL:v=>revoked.push(v),api:async(path,method)=>{calls.push([path,method]);if(path==='api/AIモデル')return catalog;if(path.endsWith('/開始'))return {実行ID:'run',実行順:['LIVE']};if(path.includes('/音声/'))return new Blob([new Uint8Array(100)],{type:'audio/wav'});return result;}});await s.読込();s.区分変更('LIVE');await s.開始();assert.equal(s.結果.value.応答,'字幕');assert.equal(s.音声状態.value[id].url,'blob:1');await s.開始();assert.deepEqual(revoked,['blob:1']);s.区分変更('CHAT');s.表示を離れる();assert.deepEqual(revoked,['blob:1']);assert.equal(s.結果.value,null);s.区分変更('LIVE');assert.equal(s.音声状態.value[id].url,'blob:2');assert.equal(s.結果.value.応答,'字幕');assert.equal(calls.filter(([path])=>path.includes('/音声/')).length,2);s.終了();assert.deepEqual(revoked,['blob:1','blob:2']);
});
test('Decision inputs map directly to all three schemas; invalid choices never send',async()=>{
 const sent=[],s=AIモデル状態を作成({接続可能:()=>true,api:async(path,_method,_signal,_format,body)=>{if(path==='api/AIモデル')return catalog;if(path.endsWith('/開始')){sent.push(body);return {実行ID:'r',実行順:['DECISION']};}return {状態:'OK'};}});await s.読込();s.区分変更('DECISION');s.変更('choices','同じ\n同じ');await s.開始();assert.equal(sent.length,0);s.変更('choices','左\n右');for(const type of ['choice','predicate','score']){s.変更('type',type);await s.開始();}assert.deepEqual(sent.map(x=>x.questions[0].type),['choice','predicate','score']);assert.equal(sent[0].questions[0].choices[0].value,'左');assert.equal(sent[2].questions[0].levels[1].label,'右');s.終了();
});
test('empty candidates/offline block start and errors can retry',async()=>{
 let online=false,count=0;const s=AIモデル状態を作成({接続可能:()=>online,api:async()=>{count++;return {区分:{}};}});await s.読込();await s.開始();assert.equal(count,0);online=true;await s.読込();await s.開始();assert.equal(count,1);assert.match(s.通知.value,/確認/);s.終了();
});
test('config initial selection, CODE1 and greeting defaults are used without auto-running; batch snapshots five inputs',async()=>{
 const calls=[],data=structuredClone(catalog);data.初期値=Object.fromEntries(['CHAT','LIVE','PREDICTION','DECISION','CODE'].map(f=>[f,{provider:'second',model:'three',voice:'other'}]));
 const s=AIモデル状態を作成({接続可能:()=>true,api:async(path,method,_signal,_format,body)=>{calls.push({path,method,body});if(path==='api/AIモデル')return data;if(path.endsWith('/開始'))return {実行ID:'batch',実行順:['CHAT','LIVE','PREDICTION','DECISION','CODE1']};return {状態:path.endsWith('/CHAT')?'NG':'OK'};}});
 await s.読込();for(const f of ['CHAT','LIVE','PREDICTION','DECISION','CODE']){s.区分変更(f);assert.equal(s.入力.provider,'second');assert.equal(s.入力.model,'three');if(f!=='PREDICTION')assert.equal(s.入力.prompt,TRIAL_PROMPT);}assert.equal(calls.length,1);
 s.区分変更('DECISION');assert.equal(s.入力.name,decisionQuestions()[0].name);assert.equal(s.入力.instructions,decisionQuestions()[0].instructions);assert.equal(s.入力.choices,decisionQuestions()[0].choices.map(c=>c.value).join('\n'));
 const shown=[];const stop=watch(s.区分,value=>shown.push(value),{flush:'sync'});
 await s.開始(true);stop();assert.deepEqual(shown,['CHAT','LIVE','PREDICTION','DECISION','CODE','CHAT']);assert.equal(s.区分.value,'CHAT');assert.equal(s.入力.model,'three');assert.equal(s.結果.value.状態,'NG');assert.deepEqual(calls.filter(c=>c.path.endsWith('/開始'))[0].body.items.map(i=>i.family),['CHAT','LIVE','PREDICTION','DECISION','CODE']);assert.deepEqual(calls.filter(c=>c.path.startsWith('api/モデル試行/batch/')).map(c=>c.path.split('/').at(-1)),['CHAT','LIVE','PREDICTION','DECISION','CODE1']);assert.deepEqual(Object.keys(s.結果一覧.value),['CHAT','LIVE','PREDICTION','DECISION','CODE']);s.終了();
});
test('batch edit or disconnect prevents all later requests and stale results',async()=>{
 for(const mode of ['edit','disconnect']){let online=true;const wait=deferred(),calls=[],s=AIモデル状態を作成({接続可能:()=>online,api:async(path,method)=>{calls.push([path,method]);if(path==='api/AIモデル')return catalog;if(path.endsWith('/開始'))return {実行ID:'batch',実行順:['CHAT','LIVE','PREDICTION','DECISION','CODE1']};if(method==='DELETE')return {};return wait.promise;}});await s.読込();const pending=s.開始(true);await settle();if(mode==='edit')s.変更('model','two');else{online=false;s.中止();}wait.resolve({状態:'OK',応答:'old'});await pending;assert.equal(calls.some(c=>c[0].endsWith('/LIVE')),false);assert.deepEqual(s.結果一覧.value,{});s.終了();}
});
