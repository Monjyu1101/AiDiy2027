// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelTrials} from '../モデル試行/trials.mjs';

const catalogs={prediction_models:{gemini_chat:{models:{'gemini-flash-lite-latest':'2026/10/01 - gemini-flash-lite-latest'}},codex_cli:{models:{'gpt-6-luna':'2026/09/15 - gpt-6-luna'}}}};
const baseConfig={CODE_BASE_PATH:'../',PORT_TOOLS:'8095',CHAT_AI_NAME:'openrt_chat',CHAT_OPENRT_MODEL:'chat-model',PREDICTION_AI_NAME:'gemini_chat',PREDICTION_GEMINI_MODEL:'gemini-flash-lite-latest',PREDICTION_CODEX_CLI_MODEL:'gpt-6-luna'};

function fixture({config=baseConfig,answer='おばあさんが住んでいました',historySaved=prompt=>true}={}){
 const calls=[];
 const trials=createModelTrials({reader:()=>JSON.stringify(config),statusFn:async()=>({online:true}),timeoutMs:2000,catalogReader:async name=>catalogs[name]??{},credentialReader:()=>null,request:async request=>{
  calls.push(request);
  if(request.path==='/internal/prediction_llms')return {body:{status:'OK',result:answer,ai_name:request.body.ai_name,ai_model:request.body.ai_model}};
  if(request.method==='DELETE')return {body:null};
  const {id,method}=request.body;
  if(method==='initialize')return {session:'fixture',body:{jsonrpc:'2.0',id,result:{protocolVersion:'2024-11-05'}}};
  if(method==='notifications/initialized')return {body:null};
  const args=request.body.params.arguments;
  return {body:{jsonrpc:'2.0',id,result:{structuredContent:{status:'OK',result:'はい',ai_name:args.ai_name,ai_model:args.ai_model,history_saved:historySaved(args.prompt)}}}};
 }});
 const tools=()=>calls.filter(call=>call.body?.method==='tools/call');
 const row=async id=>{const start=await trials.start({rowId:id});return trials.next(start.実行ID,id);};
 return {trials,calls,tools,row,close:()=>trials.close()};
}

test('prediction waits for a Chat success first',async()=>{
 const f=fixture();
 try{assert.equal((await f.trials.snapshot()).予測条件.テスト可能,false);await assert.rejects(()=>f.trials.start({rowId:'PREDICTION'}),/Chatテスト/);}
 finally{await f.close();}
});

test('story turns use the Chat-OK model, not the prediction model, then the classic continuation is perfect',async()=>{
 const f=fixture();
 try{
  assert.equal((await f.row('CHAT')).状態,'OK');
  const before=f.tools().length;const result=await f.row('PREDICTION');
  assert.deepEqual(f.tools().slice(before).map(call=>[call.path,call.body.params.name,call.body.params.arguments.prompt,call.body.params.arguments.ai_name,call.body.params.arguments.ai_model]),[
   ['/aidiy_chat_llms/mcp','chat_llms_run','昔々、あるところに','openrt_chat','chat-model'],
   ['/aidiy_chat_llms/mcp','chat_llms_run','おじいさんと','openrt_chat','chat-model'],
  ]);
  const prediction=f.calls.filter(call=>call.path==='/internal/prediction_llms');
  assert.equal(prediction.length,1);assert.equal(prediction[0].body.ai_name,'gemini_chat');assert.equal(prediction[0].body.timeout_sec,60);
  assert.equal(result.状態,'OK');assert.equal(result.予測評価,'完璧');assert.match(result.説明,/完璧/);
  assert.deepEqual(result.経過.map(step=>[step.内容,step.状態]),[['「昔々、あるところに」を送信（openrt_chat / chat-model）','OK'],['「おじいさんと」を送信（openrt_chat / chat-model）','OK'],['予測を実行（gemini_chat / gemini-flash-lite-latest）','OK']]);
  assert.ok(result.経過.every(step=>Number.isInteger(step.秒)));
 }finally{await f.close();}
});

test('CLI prediction also sends the story through Chat and uses a longer prediction timeout',async()=>{
 const f=fixture({config:{...baseConfig,PREDICTION_AI_NAME:'codex_cli'},answer:'次の展開を書いて'});
 try{
  await f.row('CHAT');const before=f.tools().length;const result=await f.row('PREDICTION');
  assert.deepEqual(f.tools().slice(before).map(call=>call.body.params.name),['chat_llms_run','chat_llms_run']);
  assert.equal(f.calls.find(call=>call.path==='/internal/prediction_llms').body.timeout_sec,120);
  assert.equal(result.状態,'OK');assert.equal(result.予測評価,'OK');
 }finally{await f.close();}
});

test('prediction is NG without calling the predictor when a story turn is not saved to history',async()=>{
 const f=fixture({historySaved:prompt=>prompt!=='昔々、あるところに'});
 try{
  await f.row('CHAT');const result=await f.row('PREDICTION');
  assert.equal(f.calls.some(call=>call.path==='/internal/prediction_llms'),false);
  assert.equal(result.状態,'NG');assert.match(result.説明,/昔々/);
  assert.deepEqual(result.経過.map(step=>step.状態),['NG']);
 }finally{await f.close();}
});
