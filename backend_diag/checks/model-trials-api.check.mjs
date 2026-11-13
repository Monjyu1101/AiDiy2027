// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実際の loopback HTTP と認証ルーターを通す。プロバイダ通信・資格情報は合成する。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAudioStore} from '../diag/モデル試行/audio_store.mjs';
import {createHandler} from '../diag/diag_main.mjs';
import {createModelTrials as createActualModelTrials} from '../diag/モデル試行/trials.mjs';

const createModelTrials=options=>createActualModelTrials({catalogReader:async()=>({}),credentialReader:async()=>null,installedClisFn:async()=>({}),...options});
test('authenticated HTTP trial contract: 16 ordered rows, deduplication, body rejection and cancellation',async()=>{
  const config={CODE_BASE_PATH:'/fixture/project',CHAT_AI_NAME:'freeai_chat',CHAT_FREEAI_MODEL:'chat-test',LIVE_AI_NAME:'freeai_live',LIVE_FREEAI_MODEL:'live-test',LIVE_FREEAI_VOICE:'Zephyr',CODE_AI1_NAME:'claude_cli',CODE_AI1_MODEL:'auto',TASK_AI_NAME:'claude_cli',TEAM_AI_NAME:'claude_cli'};
  for(let i=2;i<=6;i++)config[`CODE_AI${i}_NAME`]='auto';
  for(const family of ['TASK','TEAM'])for(const phase of ['plan','do','check'])config[`${family}_AI_MODEL_${phase}`]='auto';
  const temp=await mkdtemp(path.join(os.tmpdir(),'diag-http-audio-'));
  const audioStore=createAudioStore({base:temp});
  const wav=Buffer.alloc(48044);wav.write('RIFF');wav.writeUInt32LE(48036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);
  let calls=0,audioId;
  const trials=createModelTrials({audioStore,reader:async()=>JSON.stringify(config),statusFn:async()=>({online:true}),request:async request=>{
    if(request.method==='DELETE')return {body:null};
    if(request.path==='/internal/live_model_check'){calls++;return {body:{status:'OK',reply:'おはよう',model:'live-test',audio:{mime:'audio/wav',data_base64:wav.toString('base64')}}};}
    const {id,method}=request.body;let result;
    if(method==='initialize')result={protocolVersion:'2024-11-05'};
    else if(method==='notifications/initialized')return {body:null};
    else {assert.equal(method,'tools/call');assert.equal(request.body.params.name,request.path.includes('decisions_check')?'decisions_check':request.path.includes('chat_llms')?'chat_llms_run':'code_agents_run');assert.equal(Object.hasOwn(request.body.params.arguments,'diagnostic_mode'),false);assert.equal(request.body.params.arguments.prompt??request.body.params.arguments.input,'おはよう');calls++;result={structuredContent:request.path.includes('decisions_check')?{status:'OK',data:{model:'freeai_chat/gemini-flash-lite-latest',answers:[{type:'choice',name:'politeness',choice:'high',confidence:1,probabilities:[{value:'high',probability:1},{value:'medium',probability:0},{value:'low',probability:0}]}]}}:{status:'OK',history_saved:true,result:'おはよう',ai_model:'chat-test',selected_model:'resolved-code'}};}
    return {session:'synthetic-session',body:{jsonrpc:'2.0',id,result}};
  }});
  const server=http.createServer(createHandler({token:'synthetic-token',prefix:'/test/',modelTrials:trials}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/test/api/モデル試行`;
  async function call(suffix='',method='GET',authenticated=true,body){const response=await fetch(base+suffix,{method,headers:authenticated?{authorization:'Bearer synthetic-token'}:{},...(body===undefined?{}:{body})});return {status:response.status,data:await response.json()};}
  try{
    assert.equal((await call()).data.項目.length,16);
    for(const [suffix,method] of [['','GET'],['/開始','POST']])assert.equal((await call(suffix,method,false)).status,401);
    assert.equal((await call('/開始','POST',true,'{}')).status,400);assert.equal(calls,0);
    const start=await call('/開始','POST');assert.equal(start.status,200);const id=start.data.実行ID;
    assert.match(id,/^[a-f0-9]{32}$/);assert.equal((await call(`/${id}/arbitrary`,'POST')).status,404);
    assert.equal((await call(`/${id}/LIVE`,'POST')).status,409);
    for(const row of start.data.項目){const next=await call(`/${id}/${row.id}`,'POST');assert.equal(next.status,200);assert.equal(next.data.id,row.id);assert.equal(next.data.状態,row.id==='PREDICTION'?'未実施':'OK');if(row.id==='LIVE'){audioId=next.data.音声ファイル.id;assert.equal(next.data.音声ファイル.長さms,1000);}if(row.id==='TEAM_check')assert.equal(next.data.共有元,'CODE1');}
    const audioUrl=base+'/音声/'+audioId;assert.equal((await fetch(audioUrl)).status,401);const audio=await fetch(audioUrl,{headers:{authorization:'Bearer synthetic-token'}});assert.equal(audio.status,200);assert.equal(audio.headers.get('content-type'),'audio/wav');assert.deepEqual(Buffer.from(await audio.arrayBuffer()),wav);
    assert.equal(calls,4);assert.equal((await call(`/${id}`,'DELETE')).status,404);
    const again=await call('/開始','POST');assert.equal((await call(`/${again.data.実行ID}`,'DELETE')).data.状態,'中止');
    assert.equal((await call(`/${again.data.実行ID}/CHAT`,'POST')).status,404);
    assert.equal((await call('/開始/arbitrary','POST')).status,404);
    assert.equal((await call('/開始/CODE4','POST',false)).status,401);
    assert.equal((await call('/開始/CODE4','POST',true,'{}')).status,400);
    const single=await call('/開始/CODE4','POST');assert.equal(single.status,200);assert.deepEqual(single.data.実行順,['CODE4']);
    assert.equal((await call(`/${single.data.実行ID}/CHAT`,'POST')).status,409);
    assert.equal((await call(`/${single.data.実行ID}/CODE4`,'POST')).data.状態,'OK');assert.equal(calls,5);
    assert.equal((await call(`/${single.data.実行ID}/CODE4`,'POST')).status,404);
    const decision=await call('/開始/DECISION','POST');assert.equal(decision.status,200);assert.deepEqual(decision.data.実行順,['DECISION']);
    const judgment=await call(`/${decision.data.実行ID}/DECISION`,'POST');assert.equal(judgment.data.状態,'OK');assert.equal(judgment.data.判断結果,'high');assert.equal(calls,6);
  }finally{await trials.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
});

