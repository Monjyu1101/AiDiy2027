// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {probe} from '../runtime/model_probe.mjs';
import {testKey} from '../diag/モデル情報/key_status.mjs';
import {modelsInfo,writeModelsInfo} from '../diag/モデル情報/models_info.mjs';
import {COPILOT_FALLBACK_MODELS,oauthModelFallback} from '../diag/モデル情報/model_fallbacks.mjs';

const expected=['gpt-6-astra','gpt-6.1-sol','gpt-6.1-terra','gpt-6-luna'];
const provider={id:'openai_oauth',名前:'OpenAI OAuth',設定済み:true};
const oauthReader=()=>JSON.stringify({tokens:{access_token:'fixture-token'}});
const configReader=()=>JSON.stringify({CHAT_AI_NAME:'openai_oauth',CHAT_OPENAI_MODEL:'gpt-6.1-sol'});
const inspect=async fetch=>testKey('openai_oauth',{run:async()=>({data:await probe('openai_oauth',{
  oauthReader,reader:()=> '{}',codexLocalReader:()=>'',fetch})})});

test('OAuth fallback reuses exactly the existing four Copilot OpenAI defaults in order',()=>{
  assert.deepEqual(Object.keys(COPILOT_FALLBACK_MODELS).filter(id=>id.startsWith('gpt-')),expected);
  assert.equal(Object.keys(COPILOT_FALLBACK_MODELS).length,8);
});
test('empty API list, network failure and invalid authentication pass with unverified fallback candidates',async()=>{
  for(const fetch of [async()=>({models:[]}),async()=>{throw new Error('network');},
    async()=>{throw Object.assign(new Error('http'),{status:401});},async()=>{throw Object.assign(new Error('http'),{status:403});}]) {
    const result=await inspect(fetch);
    assert.equal(result.id,'openai_oauth');assert.equal(result.状態,'PASS');assert.equal(result.認証確認,false);
    assert.deepEqual(result.モデル,expected);assert.match(result.補完,/未検証/);
    const info=await modelsInfo(provider,result);
    assert.equal(info.状態,'PASS');assert.equal(info.認証確認,false);assert.equal(info.プロバイダ,'openai_oauth');
    assert.match(info.説明,/空|失敗/);assert.ok(info.警告.some(text=>text.includes('認証・生成可否は未検証')));
    assert.deepEqual(Object.keys(info.chat.openai_oauth.models),expected);
    for(const label of Object.values(info.chat.openai_oauth.models))assert.match(label,/仮設定（未検証）/);
    assert.deepEqual(Object.keys(info.code.aidiy_hermes.models),expected.map(id=>'openai_oauth/'+id));
    assert.deepEqual(info.code.copilot_cli.models,{});assert.deepEqual(info.code.codex_cli.models,{});
    assert.ok(!JSON.stringify(info).includes('fixture-token'));
    assert.deepEqual(oauthModelFallback(result),result,'fallback is idempotent');
  }
});
test('unattempted OAuth, runner failures and other providers are not promoted to PASS',async()=>{
  for(const result of [{id:'openai_oauth',状態:'未実施',モデル:[]},{id:'openai',状態:'NG',モデル:[]}]) {
    assert.deepEqual(oauthModelFallback(result),result);
  }
  const result=await testKey('openai_oauth',{run:async()=>({error:'timeout'})});
  assert.equal(result.状態,'未実施');assert.deepEqual(result.モデル,[]);
});
test('successful API acquisition remains unchanged and does not add fallback models',async()=>{
  const result=await inspect(async()=>({models:[{slug:'actual-api-model'}]}));
  assert.equal(result.状態,'OK');assert.deepEqual(result.モデル,['actual-api-model']);
  const info=await modelsInfo(provider,result);
  assert.deepEqual(Object.keys(info.chat.openai_oauth.models),['actual-api-model']);
  assert.ok(!info.chat.openai_oauth.models['actual-api-model'].includes('仮設定'));
});
test('missing or malformed login remains untested, makes no request and receives no OAuth defaults',async()=>{
  for(const credential of ['{}','not-json']) {
    const raw=await probe('openai_oauth',{oauthReader:()=>credential,fetch:()=>assert.fail('network')});
    const result=await testKey('openai_oauth',{run:async()=>({data:raw})});
    assert.equal(result.状態,'未実施');assert.deepEqual(result.モデル,[]);
    assert.deepEqual((await modelsInfo({...provider,設定済み:false},result)).chat.openai_oauth.models,{});
  }
});
test('saved OAuth fallback precedes local, suppresses duplicate config fallback and is replaced by success',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'oauth-fallback-'));
  const options={directory,installedClis:{},configReader};
  const load=async()=>JSON.parse(await readFile(path.join(directory,'chat_models_info.json'),'utf8'));
  try {
    const local={id:'local',名前:'Local'};
    const failure=await inspect(async()=>{throw new Error('network');});
    await writeModelsInfo([provider,local],{openai_oauth:failure,local:{状態:'PASS'}},options);
    const saved=JSON.parse(await readFile(path.join(directory,'openai_oauth_models_info.json'),'utf8'));
    assert.equal(saved.状態,'PASS');assert.equal(saved.認証確認,false);
    assert.deepEqual(Object.keys(saved.code.aidiy_hermes.models),expected.map(id=>'openai_oauth/'+id));
    let chat=await load();
    assert.deepEqual(Object.keys(chat),['openai_oauth','local_chat']);
    assert.deepEqual(Object.keys(chat.openai_oauth.models),expected);
    const localBefore=chat.local_chat;
    await writeModelsInfo([provider],{openai_oauth:failure},options);
    assert.deepEqual(await load(),chat);
    const success=await inspect(async()=>({models:[{slug:'actual-api-model'}]}));
    await writeModelsInfo([provider],{openai_oauth:success},options);
    chat=await load();assert.deepEqual(Object.keys(chat.openai_oauth.models),['actual-api-model']);assert.deepEqual(chat.local_chat,localBefore);
    // ログアウト後は保存済みOAuth候補を再利用しない。一般config補完は未検証の1候補だけ。
    await writeModelsInfo([{...provider,設定済み:false}],{},options);
    chat=await load();assert.deepEqual(Object.keys(chat),['openai_oauth','local_chat']);
    assert.deepEqual(chat.openai_oauth.models,{'gpt-6.1-sol':'仮設定（未検証） - gpt-6.1-sol'});
    await writeModelsInfo([{...provider,設定済み:false}],{},{...options,configReader:()=> '{}'});
    assert.deepEqual(await load(),{local_chat:localBefore});
  }finally{await rm(directory,{recursive:true,force:true});}
});
