// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {probe} from '../runtime/model_probe.mjs';
import {createModelRunner} from '../runtime/model_runner.mjs';
import {testKey} from '../モデル情報/key_status.mjs';
import {decisionsModelsInfo,DECISIONS_MODELS_FILE,FREEAI_DECISION_MODEL,OPENAI_DECISION_MODEL,DECISION_MODEL_CANDIDATES} from '../モデル情報/decisions_info.mjs';
import {writeModelsInfo} from '../モデル情報/models_info.mjs';
import {modelsStep} from '../診断/headless.mjs';

const now=new Date('2026-10-18T00:00:00Z'),created=now.getTime()/1000;
const providers=['openai','openai_oauth','freeai','gemini'].map(id=>({id,名前:id,設定済み:true,テスト可能:true}));
const config={openai_key_id:'fixture-openai',freeai_key_id:'fixture-freeai',gemini_key_id:'fixture-gemini'};
const configReader=()=>JSON.stringify(config);
const oauthReader=()=>JSON.stringify({tokens:{access_token:'fixture-oauth',account_id:'fixture-account'}});
const options={configReader,oauthReader};
const cache={公開状態:'取得済',公開モデル:{'google/public-only':{作成日:'2026/10/17'},'openai/public-only':{トークン数:'100',モダリティ:'text'}}};
const fetch=async(provider,headers,token)=>{
 if(provider==='codex')return {models:[{slug:'gpt-6-luna',priority:0},{slug:'gpt-hidden',visibility:'hide'}]};
 if(provider==='openai')return {data:['gpt-6-luna','gpt-audio','text-embedding-3'].map(id=>({id,created}))};
 assert.equal(provider,'google');
 return {models:[{name:`models/gemini-${token?'second':'first'}`,supportedGenerationMethods:['generateContent']},
  ...(!token?[FREEAI_DECISION_MODEL,'gemini-image','gemini-live','lyria-3','gemma-4'].map(id=>({name:'models/'+id,supportedGenerationMethods:['generateContent']})):[])],...(!token?{nextPageToken:'page2'}:{})};
};
const acquire=async(id,extra={})=>probe(id,{reader:configReader,oauthReader,fetch,cache,now,...extra});
const allResults=async()=>Object.fromEntries(await Promise.all(providers.map(async({id})=>[id,await acquire(id)])));

test('Google decision auto default is the requested model',()=>{
 assert.equal(FREEAI_DECISION_MODEL,'gemini-3.5-flash-lite');
});

test('four methods use authenticated raw lists without public, synthetic or nontext candidates',async()=>{
 const results=await allResults();
 assert.deepEqual(results.gemini.モデル,['gemini-live'],'legacy public filtering is unchanged');
 const info=await decisionsModelsInfo(providers,results,options);
 assert.deepEqual(Object.keys(info),['openai_oauth','freeai_chat','openai_decisions','gemini_chat']);
 assert.deepEqual(Object.keys(info.openai_oauth.models),['gpt-6-luna'],'no forward compatibility or 900k additions');
 assert.deepEqual(Object.keys(info.openai_decisions.models),['gpt-6-luna']);
 assert.deepEqual(Object.keys(info.freeai_chat.models),[FREEAI_DECISION_MODEL]);
 assert.deepEqual(Object.keys(info.gemini_chat.models),[FREEAI_DECISION_MODEL]);
 assert.doesNotMatch(JSON.stringify(info),/fixture|public-only|gpt-hidden|gpt-audio|image|live|lyria|gemma/);
});

test('JSON/cache/fabricated success cannot replace current authentication proof',async()=>{
 const results=await allResults();
 assert.deepEqual(await decisionsModelsInfo(providers,JSON.parse(JSON.stringify(results)),options),{});
 assert.deepEqual(await decisionsModelsInfo(providers,results,{configReader:()=> '{}',oauthReader:()=> '{}'}),{});
 assert.deepEqual(await decisionsModelsInfo(providers.map(p=>({...p,設定済み:false})),results,options),{});
 assert.deepEqual(await decisionsModelsInfo(providers,results,{configReader:()=>JSON.stringify({...config,openai_key_id:'changed',freeai_key_id:'changed',gemini_key_id:'changed'}),oauthReader:()=>JSON.stringify({tokens:{access_token:'changed'}})}),{});
 const changedOrg=await decisionsModelsInfo(providers,results,{...options,configReader:()=>JSON.stringify({...config,openai_organization:'new-org'})});
 assert.equal(changedOrg.openai_decisions,undefined);
});

test('FreeAI/Gemini fallback follows configured key preference, never failed-auth fallback',async()=>{
 const fallbackReader=()=>JSON.stringify({freeai_key_id:'<unset>',gemini_key_id:config.gemini_key_id});
 const result=await acquire('gemini',{reader:fallbackReader});
 const info=await decisionsModelsInfo(providers,{gemini:result},{...options,configReader:fallbackReader});
 assert.deepEqual(Object.keys(info.freeai_chat.models),[FREEAI_DECISION_MODEL]);
 assert.equal(info.freeai_chat.models[FREEAI_DECISION_MODEL],info.gemini_chat.models[FREEAI_DECISION_MODEL]);
 assert.ok(info.freeai_chat);
 const preferred=await decisionsModelsInfo(providers,{gemini:result},options);
 assert.equal(preferred.freeai_chat,undefined);
 assert.ok(preferred.gemini_chat);
 const emptyQuoteReader=()=>JSON.stringify({freeai_key_id:'""',gemini_key_id:config.gemini_key_id});
 assert.ok((await decisionsModelsInfo(providers,{gemini:result},{...options,configReader:emptyQuoteReader})).freeai_chat);
});

test('errors, empty results and OAuth local fallback never become judgment candidates',async()=>{
 for(const fail of [true,false]){
  const results=Object.fromEntries(await Promise.all(providers.map(async({id})=>[id,await acquire(id,{fetch:async provider=>{
   if(fail)throw Error('fixture-secret');return provider==='google'?{models:[]}:provider==='codex'?{models:[]}:{data:[]};
  },codexLocalReader:()=>{throw Error('no local cache');}})])));
  assert.deepEqual(await decisionsModelsInfo(providers,results,options),{});
 }
});

test('testKey sanitization retains private proof without exposing credentials',async()=>{
 const runner=createModelRunner();
 const result=await testKey('gemini',{run:(action,id)=>runner.run(action,id,{reader:configReader,fetch,input:cache,now})});
 const info=await decisionsModelsInfo(providers,{gemini:result},options);
 assert.ok(info.gemini_chat);
 assert.doesNotMatch(JSON.stringify(result),/fixture/);
 assert.equal((await decisionsModelsInfo(providers,{gemini:JSON.parse(JSON.stringify(result))},options)).gemini_chat,undefined);
});

test('writer creates exact schema, invalidates old cache and reports headless output',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-decisions-'));
 const load=async()=>JSON.parse(await readFile(path.join(directory,DECISIONS_MODELS_FILE),'utf8'));
 try{
  const results=await allResults();
  const saved=await writeModelsInfo(providers,results,{...options,directory,installedClis:{}});
  assert.equal(saved.filter(file=>file===DECISIONS_MODELS_FILE).length,1);
  assert.equal(Object.keys(await load()).length,4);
  await writeModelsInfo(providers,{}, {...options,directory,installedClis:{}});
  assert.deepEqual(await load(),{},'old persisted provider files are not authentication');
  await writeFile(path.join(directory,DECISIONS_MODELS_FILE),'{"public_fake":{"models":{"fake":"fake"}}}');
  const report=await modelsStep({directory,log:()=>{},configReader,statusFn:async()=>({項目:providers.filter(row=>row.id!=='openai_oauth')}),testFn:async id=>results[id],publicCache:{refresh:async()=>{},input:()=>cache}});
  assert.ok(report.保存先.includes(DECISIONS_MODELS_FILE));
  assert.equal((await load()).public_fake,undefined);
  assert.ok((await load()).freeai_chat);
 }finally{await rm(directory,{recursive:true,force:true});}
});


test('FreeAI never invents the configured candidate from another, public or unavailable model',async()=>{
 for(const ids of [['gemini-flash-lite-latest'],['gemini-3.8-flash-lite-tts'],[]]){
  const result=await acquire('freeai',{fetch:async()=>({models:ids.map(id=>({name:'models/'+id,supportedGenerationMethods:['generateContent']}))}),cache:{公開状態:'取得済',公開モデル:{['google/'+FREEAI_DECISION_MODEL]:{作成日:'2026/10/18'}}}});
  assert.equal((await decisionsModelsInfo(providers,{freeai:result},options)).freeai_chat,undefined);
 }
 const python=await readFile(new URL('../../backend_server/AIコア/AI判断共通.py',import.meta.url),'utf8');
 assert.equal(/FREEAI_DECISION_MODEL = "([^"]+)"/.exec(python)?.[1],FREEAI_DECISION_MODEL);
 assert.equal(/OPENAI_DECISION_MODEL = "([^"]+)"/.exec(python)?.[1],OPENAI_DECISION_MODEL);
});

test('all four methods omit providers when authenticated lists lack the fixed model',async()=>{
 const results=Object.fromEntries(await Promise.all(providers.map(async({id})=>[id,await acquire(id,{fetch:async provider=>provider==='google'?{models:[{name:'models/gemini-expensive',supportedGenerationMethods:['generateContent']}]}:provider==='codex'?{models:[{slug:'gpt-expensive'}]}:{data:[{id:'gpt-expensive',created}]}})])));
 assert.deepEqual(await decisionsModelsInfo(providers,results,options),{});
});

test('changing writer candidates exposes an authenticated new model without changing runtime or UI',async()=>{
 const result=await acquire('openai',{fetch:async()=>({data:[{id:'gpt-next-candidate',created}]})});
 assert.equal((await decisionsModelsInfo(providers,{openai:result},options)).openai_decisions,undefined);
 DECISION_MODEL_CANDIDATES.openai_decisions.push('gpt-next-candidate');
 try {assert.deepEqual(Object.keys((await decisionsModelsInfo(providers,{openai:result},options)).openai_decisions.models),['gpt-next-candidate']);}
 finally {DECISION_MODEL_CANDIDATES.openai_decisions.pop();}
});
