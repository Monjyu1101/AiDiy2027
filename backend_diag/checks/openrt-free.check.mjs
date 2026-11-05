// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openrouterCatalog, openrouterFreeModel, safeRouterMetadata, zeroOpenrouterPricing} from '../runtime/model_catalog.mjs';
import {probe, publicCatalog, safeDetails} from '../runtime/model_probe.mjs';
import {createPublicModelCache} from '../モデル情報/public_models.mjs';
import {testKey} from '../モデル情報/key_status.mjs';
import {writeModelsInfo} from '../モデル情報/models_info.mjs';
import {configRows} from '../モデル試行/trials.mjs';
const NOW = new Date(2026, 10, 5, 12);
const ago = days => {const d = new Date(NOW); d.setDate(d.getDate() - days); return d.getTime() / 1000;};
const zero = {prompt:'0', completion:'0'};
const row = (id, days = 1, pricing = zero, output = ['text']) => ({id, created:ago(days), context_length:1000,
  pricing, architecture:{modality:`text+image->${output.join('+')}`, output_modalities:output}, supported_parameters:['tools','temperature']});
const freeIds = catalog => Object.values(catalog).filter(openrouterFreeModel).map(model => model.model_id);

test('free pricing is explicit and exact across all supplied components, never inferred from suffix', () => {
  for (const price of ['0', '0.00', '-0', '+0.0e-99', '.0', 0]) assert.equal(zeroOpenrouterPricing({prompt:price, completion:price}), true);
  assert.equal(zeroOpenrouterPricing({...zero, request:0, image:'0', web_search:'0', internal_reasoning:'0', input_cache_read:'0', overrides:[]}), true);
  for (const pricing of [undefined, null, {}, {prompt:'0'}, {completion:'0'}, {prompt:'',completion:'0'}, {...zero, request:'0.01'}, {...zero, image:'0.01'}, {...zero, web_search:'0.01'}, {...zero, input_cache_read:'0.001'}, {...zero, future_component:'unknown'}, {...zero, overrides:[{min_prompt_tokens:100, completion:'0.1'}]}, {...zero, overrides:[{prompt:'0',completion:'0'}]}]) assert.equal(zeroOpenrouterPricing(pricing), false, JSON.stringify(pricing));
  for (const price of [null, false, true, [], {}, '', ' ', 'NaN', 'Infinity', Infinity, '1e-999', '-1e-999', '0x0', 0.0001, -0.1]) {
    assert.equal(zeroOpenrouterPricing({prompt:price, completion:'0'}), false, String(price));
  }
  const catalog = openrouterCatalog({data:[row('vendor/paid:free', 1, {prompt:'1',completion:'0'}), row('stealth/crouton-alpha'), row('vendor/no-price:free', 1, undefined)]}, NOW);
  delete catalog['vendor/no-price:free'].pricing;
  assert.deepEqual(freeIds(catalog), ['stealth/crouton-alpha']);
});

test('free selection reuses all existing provider date windows, exact IDs and known text-only output', () => {
  const data = [];
  for (const [provider, days] of [['perplexity',365],['google',240],['openai',240],['anthropic',240],['x-ai',240],['other',90]]) data.push(row(`${provider}/recent:free`, days), row(`${provider}/old:free`, days + 1));
  data.push(row('vendor/vision'), row('google/lyria-3-pro-preview', 1, zero, ['text','audio']), row('vendor/image-generator', 1, zero, ['image']), row('vendor/content-safety:free'), row('vendor/guard:free'));
  const catalog = openrouterCatalog({data}, NOW);
  assert.deepEqual(freeIds(catalog), ['perplexity/recent:free','google/recent:free','openai/recent:free','anthropic/recent:free','x-ai/recent:free','other/recent:free','vendor/vision']);
  assert.ok(Object.hasOwn(catalog,'google/lyria-3-pro-preview'), 'ordinary OpenRouter list remains intact');
  assert.equal(openrouterFreeModel({pricing:zero,モダリティ:'text->text'}), true);
  assert.equal(openrouterFreeModel({pricing:zero,モダリティ:'unknown'}), false);
  assert.equal(openrouterFreeModel({pricing:zero,モダリティ:'text->audio',output_modalities:['text']}), false);
  assert.equal(openrouterFreeModel({pricing:zero,モダリティ:'text->text',output_modalities:[]}), false);
});

test('safe metadata retains additional fee uncertainty and strips arbitrary or secret fields', () => {
  const metadata = safeRouterMetadata({pricing:{...zero, request:'untrusted-secret', overrides:[{price:1}]}, output_modalities:['text'], supported_parameters:['tools'], secret:'untrusted-secret'});
  assert.deepEqual(metadata, {pricing:{...zero,request:null,overrides:null},output_modalities:['text'],supported_parameters:['tools']});
  assert.equal(openrouterFreeModel(metadata), false);
  const details = safeDetails({'vendor/chat':{pricing:{prompt:'1234',completion:'0'},output_modalities:['text'],supported_parameters:['tools'],secret:'1234'}}, ['1234']);
  assert.equal(details[0].pricing.prompt, null);
  assert.doesNotMatch(JSON.stringify(details), /1234|secret/);
});

test('public cache, authenticated key result and merged Chat/Hermes retain pricing without changing ordinary lists', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'diag-openrt-free-'));
  const load = async name => JSON.parse(await readFile(path.join(directory, `${name}_models_info.json`), 'utf8'));
  const configReader = () => JSON.stringify({openrt_key_id:'fixture-key'});
  const provider = {id:'openrt_chat',名前:'OpenRouter',設定済み:true};
  const options = {directory,configReader,installedClis:{},naviHermesAvailable:false,now:() => NOW};
  const rows = [row('vendor/new:free'),row('stealth/crouton-alpha',2),row('vendor/paid',1,{...zero,request:'0.1'}),row('google/lyria-3-pro-preview',1,zero,['text','audio']),row('vendor/unknown',1,null)];
  const publicResult = await publicCatalog({now:NOW,fetch:async () => ({data:rows})});
  const cache = createPublicModelCache({run:async () => ({data:publicResult}),loadBundled:async () => {throw Error('unused');}});
  await cache.refresh();
  const calls = [];
  const result = await testKey('openrt_chat',{publicCache:cache.input(),run:async (action,id,args) => {
    assert.equal(action,'test');
    return {data:await probe(id,{reader:configReader,now:NOW,cache:args.input,fetch:async (endpoint,headers) => {
      calls.push(endpoint); assert.deepEqual(headers,{Authorization:'Bearer fixture-key'}); return {data:{is_free_tier:false}};
    }})};
  }});
  try {
    assert.deepEqual(calls,['openrouter-key']);
    assert.deepEqual(result.モデル詳細[0].pricing,zero);
    assert.deepEqual(result.モデル詳細[0].output_modalities,['text']);
    await writeModelsInfo([provider],{openrt_chat:result},options);
    const chat = await load('chat'), info = await load('openrt_chat'), freeInfo = await load('openrt_free'), hermes = await load('hermes');
    const expected = ['vendor/new:free','stealth/crouton-alpha'];
    assert.deepEqual(Object.keys(chat.openrt_free.models),expected);
    assert.deepEqual(Object.keys(hermes.openrt_free.models),expected);
    assert.deepEqual(chat.openrt_free,freeInfo.chat.openrt_free);
    assert.equal(info.chat.openrt_free,undefined);
    assert.deepEqual(Object.keys(freeInfo.chat.openrt_free.models),expected);
    assert.deepEqual(freeInfo.chat.モデル.map(row => row.model_id),expected);
    assert.equal(freeInfo.プロバイダ,'openrt_free');
    assert.equal(freeInfo.認証確認,true);
    assert.equal(Object.keys(chat.openrt_chat.models).length,rows.length);
    assert.deepEqual(Object.keys(chat.openrt_free),['models']);
    assert.deepEqual(info.chat.モデル.find(row => row.model_id==='vendor/paid').pricing,{...zero,request:'0.1'});
    assert.doesNotMatch(JSON.stringify([chat,info,hermes]),/fixture-key/);
    // Saved candidates cannot override known paid metadata when a later partial write merges them.
    freeInfo.chat.openrt_free.models['vendor/paid']='tampered';
    await writeFile(path.join(directory,'openrt_free_models_info.json'),JSON.stringify(freeInfo));
    await writeModelsInfo([provider],{openrt_chat:result},options);
    assert.deepEqual(Object.keys((await load('chat')).openrt_free.models),expected);
    await writeModelsInfo([provider],{openrt_chat:result},{...options,configReader:() => JSON.stringify({openrt_key_id:'different-key'})});
    assert.equal((await load('chat')).openrt_free,undefined);
    assert.equal((await load('hermes')).openrt_free,undefined);
    await writeModelsInfo([provider],{openrt_chat:JSON.parse(JSON.stringify(result))},options);
    assert.equal((await load('chat')).openrt_free,undefined);
    await writeModelsInfo([provider],{openrt_chat:{状態:'NG'}},options);
    assert.deepEqual((await load('openrt_free')).chat.openrt_free.models,{});
    assert.equal((await load('openrt_chat')).chat.openrt_free,undefined);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('config trial treats free and ordinary providers identically with their dedicated model setting', () => {
  for (const [provider, key] of [['openrt_free','CHAT_OPENRT_FREE_MODEL'],['openrt_chat','CHAT_OPENRT_MODEL'],['freeai_chat','CHAT_FREEAI_MODEL']]) {
    const config = {CHAT_AI_NAME:provider,[key]:'vendor/ordinary-model'};
    assert.equal(configRows(config)[0].モデル,'vendor/ordinary-model');
    assert.equal(configRows(config)[0].状態,'未実行');
    delete config[key];
    assert.equal(configRows(config)[0].モデル,'');
    assert.equal(configRows(config)[0].状態,'未設定');
  }
});
