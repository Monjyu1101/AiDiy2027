// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {configRows,createModelTrials,DECISION_CHOICES} from '../diag/モデル試行/trials.mjs';
const config={DECISION_AI_NAME:'freeai_chat',DECISION_FREEAI_MODEL:'gemini-flash-lite-latest',CHAT_AI_NAME:'freeai_chat',CHAT_FREEAI_MODEL:'gemini-flash-lite-latest'};
const answer=choice=>({status:'OK',data:{model:'freeai_chat/gemini-flash-lite-latest',answers:[{type:'choice',name:'politeness',choice,confidence:.9,probabilities:DECISION_CHOICES.map(value=>({value,probability:value===choice?1:0}))}]}});
function fixture(payload,{online=true,timeoutMs=1000,requestHook}={}){
 const calls=[];
 const trials=createModelTrials({reader:()=>JSON.stringify(config),statusFn:async()=>({online}),timeoutMs,request:async request=>{
  calls.push(request);if(requestHook)return requestHook(request);
  assert.equal(request.path,'/aidiy_decisions_check/mcp');
  if(request.method==='DELETE')return {body:null};
  const {id,method}=request.body;
  if(method==='initialize')return {session:'fixture',body:{jsonrpc:'2.0',id,result:{protocolVersion:'2024-11-05'}}};
  if(method==='notifications/initialized')return {body:null};
  assert.equal(request.body.params.name,'decisions_check');
  assert.deepEqual(request.body.params.arguments.questions[0].choices.map(item=>item.value),['high','medium','low']);
  assert.equal(request.body.params.arguments.input,'おはよう');
  assert.equal(request.body.params.arguments.ai_name,'freeai_chat');
  assert.equal(request.body.params.arguments.ai_model,'gemini-flash-lite-latest');
  return {body:{jsonrpc:'2.0',id,result:typeof payload==='string'?{content:[{type:'text',text:payload}]}:{structuredContent:payload}}};
 }});
 return {trials,calls,run:async()=>{const start=await trials.start({rowId:'DECISION'});return trials.next(start.実行ID,'DECISION');}};
}
test('decision row follows LIVE, uses defaults and never shares Chat or Code results',()=>{
 const rows=configRows(config),row=rows.find(row=>row.id==='DECISION');
 assert.equal(rows.length,16);assert.equal(rows[3].id,'DECISION');
 assert.deepEqual(row.共有対象,['DECISION']);assert.equal(row.モデル,'gemini-flash-lite-latest');
 assert.equal(configRows({}).find(row=>row.id==='DECISION').プロバイダ,'auto');assert.equal(configRows({}).find(row=>row.id==='DECISION').モデル,'auto');
 assert.equal(configRows({...config,DECISION_AI_NAME:'gemini_chat',DECISION_GEMINI_MODEL:'custom'}).find(row=>row.id==='DECISION').モデル,'custom');
 for(const [provider,key] of [['openai_oauth','DECISION_OAUTH_MODEL'],['openai_decisions','DECISION_OPENAI_MODEL'],['openai_jsonchat','DECISION_OAUTH_MODEL']])assert.equal(configRows({...config,DECISION_AI_NAME:provider,[key]:'expensive'}).find(row=>row.id==='DECISION').モデル,'expensive');
 assert.equal(configRows({...config,DECISION_AI_NAME:'auto',DECISION_FREEAI_MODEL:'expensive'}).find(row=>row.id==='DECISION').モデル,'auto');
});
test('all three choices are valid JSON results and use MCP lifecycle only',async()=>{
 for(const choice of DECISION_CHOICES){const payload=answer(choice);payload.data.answers[0].probabilities.find(item=>item.value===choice).probability=.99999;const f=fixture(payload);try{
  const result=await f.run();assert.equal(result.状態,'OK');assert.equal(result.判断結果,choice);assert.equal(JSON.parse(result.応答).choice,choice);assert.match(result.説明,new RegExp(choice));
  assert.equal(result.実行モデル,'freeai_chat/gemini-flash-lite-latest');
  assert.deepEqual(f.calls.map(call=>call.body?.method||call.method),['initialize','notifications/initialized','tools/call','DELETE']);
 }finally{await f.trials.close();}}
});
test('malformed JSON, unknown choice, missing fields and invalid distribution are NG',async()=>{
 const cases=['not json','[]',{status:'OK',data:{}},answer('midium')];
 for(const [key,value] of [['type','predicate'],['name','wrong'],['confidence',true],['probabilities',[]],['probabilities',[{value:'high',probability:1},{value:'medium',probability:1},{value:'low',probability:1}]]]){
  const payload=answer('high');payload.data.answers[0][key]=value;cases.push(payload);
 }
 for(const payload of cases){const f=fixture(payload);try{const result=await f.run();assert.equal(result.状態,'NG');assert.equal(result.応答,'');assert.equal(result.判断結果,undefined);}finally{await f.trials.close();}}
});
test('offline refuses start without request; connection failure and timeout cannot succeed',async()=>{
 const offline=fixture(answer('high'),{online:false});try{await assert.rejects(offline.run,/Tools/);assert.equal(offline.calls.length,0);}finally{await offline.trials.close();}
 const broken=fixture(null,{requestHook:async()=>{throw Error('secret fixture');}});try{const result=await broken.run();assert.equal(result.状態,'NG');assert.doesNotMatch(JSON.stringify(result),/secret/);}finally{await broken.trials.close();}
 const timeout=fixture(null,{timeoutMs:10,requestHook:async({signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('secret')),{once:true}))});
 try{const result=await timeout.run();assert.equal(result.状態,'NG');assert.equal(result.実行終了,true);assert.match(result.説明,/制限時間/);}finally{await timeout.trials.close();}
});

test('decision trial respects four provider settings and explicit auto',()=>{
 const fields={openai_decisions:'DECISION_OPENAI_MODEL',openai_oauth:'DECISION_OAUTH_MODEL',openai_jsonchat:'DECISION_OAUTH_MODEL',gemini_chat:'DECISION_GEMINI_MODEL',freeai_chat:'DECISION_FREEAI_MODEL'};
 for(const [provider,key] of Object.entries(fields)){
  for(const value of ['selected','auto'])assert.equal(configRows({DECISION_AI_NAME:provider,[key]:value}).find(row=>row.id==='DECISION').モデル,value);
 }
 const all={DECISION_AI_NAME:'auto',...Object.fromEntries(Object.values(fields).map(key=>[key,'selected']))};
 assert.equal(configRows(all).find(row=>row.id==='DECISION').モデル,'auto');
});
