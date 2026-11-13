// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// DIAG_TEST_PYTHON must have backend_tools' MCP 2.x, FastAPI and uvicorn dependencies.
import test from 'node:test';
import {decisionQuestions} from '../diag/モデル試行/defaults.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {callMcp,createModelTrials as createActualModelTrials,localRequest} from '../diag/モデル試行/trials.mjs';

// Windows 初回 import と並行回帰の負荷を考慮。AI応答は従来どおり合成の短文だけ。
const createModelTrials=options=>createActualModelTrials({catalogReader:async()=>({}),credentialReader:async()=>null,installedClisFn:async()=>({}),...options});
test('actual MCP SDK and production Chat/Code/Decision registrations return valid results', {skip:!process.env.DIAG_TEST_PYTHON,timeout:90000},async()=>{
 const child=spawn(process.env.DIAG_TEST_PYTHON,[fileURLToPath(new URL('./fixtures/model_trials_tools.py',import.meta.url))],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let errors='';child.stderr.on('data',chunk=>errors+=chunk);
 const lines=createInterface({input:child.stdout});
 try{
  const port=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error(`fixture startup: ${errors}`)),60000);
   lines.once('line',line=>{clearTimeout(timer);resolve(JSON.parse(line).port);});
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('exit',()=>{clearTimeout(timer);reject(new Error(`fixture exit: ${errors}`));});
  });
  const config={CODE_BASE_PATH:'/fixture/project',PORT_TOOLS:port,CHAT_AI_NAME:'freeai_chat',CHAT_FREEAI_MODEL:'chat-test',CODE_AI1_NAME:'codex_cli',CODE_AI1_MODEL:'auto',LIVE_AI_NAME:'freeai_live',LIVE_FREEAI_MODEL:'live-test',LIVE_FREEAI_VOICE:'Zephyr'};
  const wire=[];
  const request=async options=>{const response=await localRequest(options);wire.push({options,response});return response;};
  for(const [区分,プロバイダ,モデル] of [['CHAT','freeai_chat','chat-test'],['CODE','codex_cli','auto']]){
   const result=await callMcp({区分,プロバイダ,モデル},config,{request});
   assert.equal(result.status,'OK',JSON.stringify(result));assert.equal(result.result,'おはようございます');
  }
  const calls=wire.filter(x=>x.options.body?.method==='tools/call');
  assert.equal(calls.length,2);
  for(const {options,response} of calls){
   assert.equal(typeof response.body.result.structuredContent.result,'string');
   assert.ok(options.headers['Mcp-Session-Id']);
   assert.equal(options.headers['MCP-Protocol-Version'],'2024-11-05');
  }
  assert.equal(wire.filter(x=>x.options.method==='DELETE').length,2);
  const trials=createModelTrials({reader:async()=>JSON.stringify(config),statusFn:async()=>({online:true})});
  try{const start=await trials.start();for(const row of start.項目){const result=await trials.next(start.実行ID,row.id);if(['CHAT','CODE1','LIVE','DECISION'].includes(row.id))assert.equal(result.状態,'OK',`${row.id}: ${result.説明}`);if(row.id==='DECISION'){assert.equal(result.判断結果,'medium');assert.equal(result.実行モデル,'freeai_chat/gemini-3.5-flash-lite');}}}
  finally{await trials.close();}
  const manualTrials=createModelTrials({reader:async()=>JSON.stringify(config),statusFn:async()=>({online:true})});
  try{
   const manuals=[['CHAT','freeai_chat','chat-test'],['LIVE','freeai_live','live-test'],['DECISION','freeai_chat','gemini-3.5-flash-lite'],['CODE','codex_cli','auto']].map(([family,provider,model])=>({family,provider,model,voice:family==='LIVE'?'Zephyr':'',prompt:'手動SDK入力',...(family==='DECISION'?{questions:decisionQuestions()}:{})}));
   manuals.splice(2,0,{family:'PREDICTION',provider:'openai_chat',model:'chosen-model'});
   const start=await manualTrials.start({manuals});let audio;
   for(const row of start.実行順){const result=await manualTrials.next(start.実行ID,row);assert.equal(result.状態,row==='PREDICTION'?'未実施':'OK',JSON.stringify(result));if(row==='LIVE'){audio=result.音声ファイル;assert.equal(audio.長さms,1000);}if(row==='DECISION'){assert.equal(JSON.parse(result.応答).data.answers[0].choice,'medium');assert.equal(result.実行プロバイダ,'freeai_chat');}}
   assert.ok(await manualTrials.audio(audio.id),'batch retains Live audio after Decision and Code');
  }finally{await manualTrials.close();}
 }finally{lines.close();child.kill();}
});

