// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelTrials as createActualModelTrials} from '../diag/モデル試行/trials.mjs';
// 実設定・OAuth・CLI検出へ依存しない隔離試行。必要な候補は各試験から渡す。
const createModelTrials=options=>createActualModelTrials({catalogReader:async()=>({}),credentialReader:()=>null,installedClisFn:async()=>({}),...options});
import {manualDecisionAnswer} from '../diag/モデル試行/manual.mjs';
import {createServer} from '../diag/diag_main.mjs';
import {TRIAL_PROMPT,decisionQuestions} from '../diag/モデル試行/defaults.mjs';
import {DIAG_TRANSPORT_BYTE_LIMIT} from '../runtime/transport_limit.mjs';
const config={CODE_BASE_PATH:'/fixture/project',CHAT_AI_NAME:'freeai_chat',CHAT_FREEAI_MODEL:'saved-chat',LIVE_AI_NAME:'freeai_live',LIVE_FREEAI_MODEL:'saved-live',LIVE_FREEAI_VOICE:'Zephyr',DECISION_AI_NAME:'freeai_chat',DECISION_FREEAI_MODEL:'saved-decision',CODE_AI1_NAME:'codex_cli',CODE_AI1_MODEL:'saved-code',freeai_key_id:'synthetic-secret'};
const input=(family='CHAT')=>family==='PREDICTION'?{family,provider:'openai_chat',model:'chosen-model'}:({family,provider:{CHAT:'freeai_chat',LIVE:'freeai_live',DECISION:'freeai_chat',CODE:'codex_cli'}[family],model:'chosen-model',voice:family==='LIVE'?'Puck':'',prompt:'自由な入力\n2行目',...(family==='DECISION'?{questions:[{type:'choice',name:'route',instructions:'行先を選ぶ',choices:[{value:'left'},{value:'right'}]}]}:{})});
const answer={type:'choice',name:'route',choice:'left',confidence:1,probabilities:[{value:'left',probability:1},{value:'right',probability:0}]};
function wire(calls){return async options=>{calls.push(options);if(options.method==='DELETE')return {body:null};if(options.path==='/internal/live_model_check')return {body:{status:'OK',reply:'音声なしの応答',provider:'freeai_live',model:'actual-live'}};const {method,id}=options.body;if(method==='initialize')return {session:'fixture',body:{jsonrpc:'2.0',id,result:{protocolVersion:'2024-11-05'}}};if(method==='notifications/initialized')return {body:null};return {body:{jsonrpc:'2.0',id,result:{structuredContent:{result:JSON.stringify(options.body.params.name==='decisions_check'?{status:'OK',data:{answers:[answer],model:'actual-decision',ai_name:'freeai_chat'}}:{status:'OK',result:'応答',ai_name:'freeai_chat',ai_model:'actual-chat',selected_model:'actual-code',history_saved:true})}}}};};}
test('four manual families use shared transports, exact input, effective metadata and preserve config',async()=>{
 const calls=[],before=JSON.stringify(config),trials=createModelTrials({reader:()=>before,statusFn:async()=>({online:true}),request:wire(calls)});
 try{for(const family of ['CHAT','LIVE','DECISION','CODE']){const manual=input(family),start=await trials.start({manual});assert.equal(start.実行順.length,1);await assert.rejects(()=>trials.start(),/前の試行/);const result=await trials.next(start.実行ID,start.実行順[0]);assert.equal(result.状態,'OK');assert.match(result.実行モデル,/^actual-/);assert.ok(result.実行プロバイダ);if(family==='LIVE')assert.match(result.説明,/1秒以上/);}
 const mcp=calls.filter(c=>c.body?.method==='tools/call');assert.deepEqual(mcp.map(c=>c.body.params.name),['chat_llms_run','decisions_check','code_agents_run']);for(const call of mcp){const args=call.body.params.arguments;assert.equal(args.prompt??args.input,input().prompt);assert.equal(args.ai_model,'chosen-model');}
 assert.deepEqual(mcp[1].body.params.arguments.questions,[{type:'choice',name:'route',instructions:'行先を選ぶ',choices:[{value:'left',description:''},{value:'right',description:''}]}]);
 assert.deepEqual(calls.find(c=>c.path==='/internal/live_model_check').body,{ai_name:'freeai_live',ai_model:'chosen-model',voice:'Puck',prompt:input().prompt});assert.equal(JSON.stringify(config),before);
 }finally{await trials.close();}
});
test('saved catalogs only, preserve outside values and auto, redact secrets, no model request',async()=>{
 const reads=[],trials=createModelTrials({reader:()=>JSON.stringify(config),request:()=>assert.fail('network'),catalogReader:async name=>{reads.push(name);if(name==='chat_models')return {freeai_chat:{models:{catalog:'一覧', 'synthetic-secret':'bad'}}};throw Error('missing');}});
 try{const data=await trials.catalogs();assert.deepEqual(reads,['prediction_models','chat_models','chat_models','live_models','prediction_models','decisions_models','code_models','live_voices']);assert.equal(data.区分.CHAT.プロバイダ[0].現在モデル,'saved-chat');assert.equal(data.区分.LIVE.状態,'未取得');assert.equal(data.区分.LIVE.プロバイダ[0].現在音声,'Zephyr');assert.ok(data.区分.DECISION.プロバイダ.find(p=>p.id==='auto').モデル.some(m=>m.id==='auto'));assert.ok(!JSON.stringify(data).includes('synthetic-secret'));}finally{await trials.close();}
});
test('Code controls lead every provider once, including saved controls and missing catalogs',async()=>{
 for(const saved of ['auto','same','saved-code'])for(const missing of [false,true]){
  const source={codex_cli:{models:{model:'Model',same:'old same',auto:'old auto'}},aidiy_hermes:{models:{'codex_cli/auto':'Codex'}}};
  const before=JSON.stringify(source),settings={...config,CODE_AI1_MODEL:saved};
  const trials=createModelTrials({reader:()=>JSON.stringify(settings),request:()=>assert.fail('network'),catalogReader:async name=>{if(missing)throw Error('missing');return name==='code_models'?source:{};}});
  try{
   const data=await trials.catalogs();
   for(const provider of data.区分.CODE.プロバイダ){
    const ids=provider.モデル.map(m=>m.id);
    assert.deepEqual(ids.slice(0,2),['auto','same']);
    assert.equal(ids.filter(id=>id==='auto').length,1);assert.equal(ids.filter(id=>id==='same').length,1);
    assert.ok(provider.モデル.slice(0,2).every(m=>m.保存値===false));
   }
   assert.equal(data.初期値.CODE.model,saved);
   assert.equal(data.区分.CODE.プロバイダ.find(p=>p.id==='codex_cli').現在モデル,saved);
   if(!missing)assert.deepEqual(data.区分.CODE.プロバイダ.find(p=>p.id==='aidiy_hermes').モデル.map(m=>m.id),['auto','same','codex_cli/auto']);
   assert.equal(JSON.stringify(source),before);
  }finally{await trials.close();}
 }
});
test('Code auto and same reach the existing MCP without replacement',async()=>{
 const calls=[],trials=createModelTrials({reader:()=>JSON.stringify(config),statusFn:async()=>({online:true}),request:wire(calls)});
 try{
  for(const model of ['auto','same']){const start=await trials.start({manual:{...input('CODE'),model}});assert.equal((await trials.next(start.実行ID,'CODE1')).状態,'OK');}
  assert.deepEqual(calls.filter(c=>c.body?.params?.name==='code_agents_run').map(c=>c.body.params.arguments.ai_model),['auto','same']);
 }finally{await trials.close();}
});
test('invalid manual requests and offline fail before any transport call',async()=>{
 let online=true;const trials=createModelTrials({reader:()=>JSON.stringify(config),statusFn:async()=>({online}),request:()=>assert.fail('request')});
 try{for(const manual of [{...input(),provider:'unknown'},{...input(),prompt:''},{...input(),family:'TASK'},{...input(),extra:'bad'},{...input('LIVE'),voice:''},{...input('DECISION'),questions:[]}])await assert.rejects(()=>trials.start({manual}));online=false;await assert.rejects(()=>trials.start({manual:input()}),/Tools/);}finally{await trials.close();}
});
test('manual timeout and edits invalidate pending results without sharing stale responses',async()=>{
 let ready;const entered=new Promise(r=>ready=r);const trials=createModelTrials({reader:()=>JSON.stringify(config),statusFn:async()=>({online:true}),timeoutMs:15,request:async({signal})=>{ready();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('raw secret')),{once:true}));}});
 try{let start=await trials.start({manual:input()}),pending=trials.next(start.実行ID,'CHAT');await entered;await assert.rejects(()=>trials.next(start.実行ID,'CHAT'),/順番/);const result=await pending;assert.equal(result.状態,'NG');assert.match(result.説明,/制限時間/);start=await trials.start({manual:input()});trials.cancel(start.実行ID);await assert.rejects(()=>trials.next(start.実行ID,'CHAT'));}finally{await trials.close();}
});
test('manual Decision validates choice/predicate/score/refusal rather than fixed greeting choices',()=>{
 const wrap=a=>({status:'OK',data:{answers:[a]}});
 assert.equal(manualDecisionAnswer(wrap(answer),input('DECISION').questions).choice,'left');
 assert.equal(manualDecisionAnswer(wrap({type:'predicate',name:'x',probability:.4}),[{type:'predicate',name:'x'}]).probability,.4);
 const score={type:'score',name:'s',score:.75,confidence:.8,probabilities:[{value:0,label:'低',probability:.25},{value:1,label:'高',probability:.75}]},q=[{type:'score',name:'s',levels:[{label:'低'},{label:'高'}]}];assert.equal(manualDecisionAnswer(wrap(score),q).score,.75);assert.throws(()=>manualDecisionAnswer(wrap({...score,score:.5}),q));
 assert.equal(manualDecisionAnswer(wrap({type:'refusal',name:'s',refusal:'回答不可'}),q).type,'refusal');assert.throws(()=>manualDecisionAnswer(wrap({...answer,choice:'else'}),input('DECISION').questions));
});
test('batch executes CHAT LIVE PREDICTION DECISION CODE once, continues NG, uses independent snapshots and shared default inputs',async()=>{
 const calls=[],request=wire(calls),trials=createModelTrials({reader:()=>JSON.stringify(config),statusFn:async()=>({online:true}),request:async options=>{const r=await request(options);if(options.body?.params?.name==='chat_llms_run')r.body.result={structuredContent:{status:'NG',result:'mock failure'}};return r;}});
 try{const manuals=['CHAT','LIVE','PREDICTION','DECISION','CODE'].map(input),start=await trials.start({manuals});manuals[4].prompt='mutated';assert.deepEqual(start.実行順,['CHAT','LIVE','PREDICTION','DECISION','CODE1']);const results=[];for(const id of start.実行順)results.push(await trials.next(start.実行ID,id));assert.deepEqual(results.map(r=>r.状態),['NG','OK','未実施','OK','OK']);assert.equal(calls.find(c=>c.body?.params?.name==='code_agents_run').body.params.arguments.prompt,input().prompt);const defaults=await trials.start({rowId:'DECISION'});await trials.next(defaults.実行ID,'DECISION');const args=calls.at(-2).body.params.arguments;assert.equal(args.input,TRIAL_PROMPT);assert.deepEqual(args.questions,decisionQuestions());}finally{await trials.close();}
});
test('Decision shows complete pretty JSON or original non-JSON text safely while validation stays NG',async()=>{
 for(const raw of ['<script>bad()</script>\n元文字列',JSON.stringify({status:'NG',message:'日本語',details:{large:'長い'.repeat(1000)}})]){
  const base=wire([]),trials=createModelTrials({reader:()=>JSON.stringify(config),statusFn:async()=>({online:true}),request:async o=>o.body?.method==='tools/call'?{body:{jsonrpc:'2.0',id:o.id,result:{structuredContent:{result:raw}}}}:base(o)});
  try{const start=await trials.start({manual:input('DECISION')}),result=await trials.next(start.実行ID,'DECISION');assert.equal(result.状態,'NG');assert.equal(result.応答,raw.startsWith('{')?JSON.stringify(JSON.parse(raw),null,2):raw);}finally{await trials.close();}
 }
});
test('batch row timeout continues to next row, but explicit cancellation ends the batch',async()=>{
 const base=wire([]);const trials=createModelTrials({reader:()=>JSON.stringify(config),statusFn:async()=>({online:true}),timeoutMs:15,request:async o=>o.body?.params?.name==='chat_llms_run'?new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true})):base(o)});
 try{const start=await trials.start({manuals:['CHAT','LIVE','PREDICTION','DECISION','CODE'].map(input)});const first=await trials.next(start.実行ID,'CHAT');assert.equal(first.状態,'NG');assert.match(first.説明,/制限時間/);assert.equal(first.実行終了,undefined);assert.equal((await trials.next(start.実行ID,'LIVE')).状態,'OK');trials.cancel(start.実行ID);await assert.rejects(()=>trials.next(start.実行ID,'DECISION'));}finally{await trials.close();}
});
test('manual HTTP requires auth/JSON/bounds and calls shared run endpoints',async()=>{
 const calls=[],trials=createModelTrials({reader:()=>JSON.stringify(config),statusFn:async()=>({online:true}),request:wire(calls),catalogReader:async()=>({})}),server=createServer({token:'fixture',modelTrials:trials});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`,headers={Authorization:'Bearer fixture','Content-Type':'application/json'};
 try{assert.equal((await fetch(url+'api/AIモデル')).status,401);assert.equal((await fetch(url+'api/AIモデル',{headers})).status,200);for(const body of ['null','[]','{','"x"'])assert.equal((await fetch(url+'api/AIモデル/開始',{method:'POST',headers,body})).status,400);assert.equal((await fetch(url+'api/AIモデル/開始',{method:'POST',headers,body:' '.repeat(DIAG_TRANSPORT_BYTE_LIMIT+1)})).status,413);const start=await(await fetch(url+'api/AIモデル/開始',{method:'POST',headers,body:JSON.stringify(input())})).json();const result=await(await fetch(url+`api/モデル試行/${start.実行ID}/CHAT`,{method:'POST',headers})).json();assert.equal(result.状態,'OK');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await trials.close();}
});
