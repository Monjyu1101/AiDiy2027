// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelTrials} from '../モデル試行/trials.mjs';
import {installedCodeClis} from '../モデル情報/models_info.mjs';
const providers=['claude_cli','copilot_cli','codex_cli','antigravity_cli','grok_cli','opencode_cli','claude_ollama','codex_ollama'];
const installed=Object.fromEntries(providers.map(id=>[id,false]));
const config=provider=>({CODE_BASE_PATH:'/synthetic/project',CODE_AI1_NAME:provider,CODE_AI1_MODEL:'same',CODE_AI2_NAME:'auto',CODE_AI2_MODEL:'same',TASK_AI_NAME:provider,TASK_AI_MODEL_plan:'same',TASK_AI_MODEL_do:'same',TASK_AI_MODEL_check:'same',TEAM_AI_NAME:provider,TEAM_AI_MODEL_plan:'same',TEAM_AI_MODEL_do:'same',TEAM_AI_MODEL_check:'same'});
function fixture(provider,options={}){
 const calls=[];
 const trials=createModelTrials({reader:async()=>JSON.stringify(config(provider)),credentialReader:()=>null,catalogReader:async()=>({}),statusFn:async()=>({online:true}),installedClisFn:async()=>installed,request:async request=>{calls.push(request);const {id,method}=request.body||{};if(method==='initialize')return {body:{jsonrpc:'2.0',id,result:{protocolVersion:'2024-11-05'}}};if(method==='tools/call')return {body:{jsonrpc:'2.0',id,result:{structuredContent:{status:'OK',result:'hello',history_saved:true}}}};return {body:null};},...options});
 return {trials,calls};
}
test('all missing CLI providers and Ollama aliases skip individual Code/Task/Team without MCP',async()=>{
 for(const provider of providers){const {trials,calls}=fixture(provider);try{
  for(const rowId of ['CODE1','CODE2','TASK_plan','TASK_do','TASK_check','TEAM_plan','TEAM_do','TEAM_check']){
   const start=await trials.start({rowId});assert.equal(start.項目.find(row=>row.id===rowId).状態,'未実施');
   const result=await trials.next(start.実行ID,rowId);assert.equal(result.状態,'未実施');assert.match(result.説明,/未導入/);assert.equal(result.応答,'');assert.equal(result.所要ms,0);
  }assert.equal(calls.length,0);
 }finally{await trials.close();}}
});
test('bulk executes no missing CLI and completes the queue',async()=>{
 const {trials,calls}=fixture('codex_cli');try{const start=await trials.start();for(const rowId of start.実行順){const result=await trials.next(start.実行ID,rowId);if(/^(CODE[12]|TASK_|TEAM_)/.test(rowId))assert.equal(result.状態,'未実施');}assert.equal(calls.filter(call=>call.path==='/aidiy_code_agents/mcp').length,0);}finally{await trials.close();}
});
test('fresh installation overrides old models and cached success; later install permits retry',async()=>{
 let present=true;const {trials,calls}=fixture('codex_cli',{installedClisFn:async()=>({...installed,codex_cli:present}),catalogReader:async()=>({codex_cli:{models:{same:'stale'}}})});
 try{let start=await trials.start();for(const id of start.実行順.slice(0,start.実行順.indexOf('CODE1')))await trials.next(start.実行ID,id);
 assert.equal((await trials.next(start.実行ID,'CODE1')).状態,'OK');const count=calls.length;present=false;
 assert.equal((await trials.next(start.実行ID,'CODE2')).状態,'未実施');assert.equal(calls.length,count);trials.cancel(start.実行ID);
 start=await trials.start({rowId:'TASK_do'});assert.equal((await trials.next(start.実行ID,'TASK_do')).状態,'未実施');
 present=true;start=await trials.start({rowId:'TASK_do'});assert.equal((await trials.next(start.実行ID,'TASK_do')).状態,'OK');
 }finally{await trials.close();}
});
test('installed but unauthenticated CLI is tested and fails normally, not treated as missing',async()=>{
 const {trials,calls}=fixture('codex_cli',{installedClisFn:async()=>({...installed,codex_cli:true}),request:async()=>{throw Error('authentication failed');}});
 try{const start=await trials.start({rowId:'CODE1'});assert.equal((await trials.next(start.実行ID,'CODE1')).状態,'NG');}finally{await trials.close();}
});
test('SDK and automatic Hermes remain eligible, explicit Hermes CLI routes skip',async()=>{
 for(const provider of ['claude_sdk','aidiy_hermes','auto','same']){const {trials,calls}=fixture(provider);try{const start=await trials.start({rowId:'CODE1'});assert.equal((await trials.next(start.実行ID,'CODE1')).状態,'OK');assert.ok(calls.length);}finally{await trials.close();}}
 const {trials,calls}=fixture('aidiy_hermes',{reader:async()=>JSON.stringify({...config('aidiy_hermes'),CODE_AI1_MODEL:'codex_cli/same'})});try{const start=await trials.start({rowId:'CODE1'});assert.equal((await trials.next(start.実行ID,'CODE1')).状態,'未実施');assert.equal(calls.length,0);}finally{await trials.close();}
});
test('manual Code path also skips missing CLI before MCP',async()=>{
 const {trials,calls}=fixture('codex_cli');try{const start=await trials.start({manual:{family:'CODE',provider:'codex_cli',model:'same',prompt:'hello'}});assert.equal((await trials.next(start.実行ID,'CODE1')).状態,'未実施');assert.equal(calls.length,0);}finally{await trials.close();}
});
test('presence detector uses fixed catalog executable resolution only',async()=>{
 const ids=[];const result=await installedCodeClis({loadEntries:async()=>['claude','copilot','codex','agy','grok','opencode'].map(id=>({id})),resolve:async entry=>{ids.push(entry.id);return entry.id==='codex'?'/synthetic/codex':null;}});assert.equal(ids.length,6);assert.equal(result.codex_cli,true);assert.equal(result.claude_cli,false);
});
