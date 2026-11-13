// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {writeModelsInfo} from '../diag/モデル情報/models_info.mjs';

const configured = {CHAT_AI_NAME:'freeai_chat', CHAT_FREEAI_MODEL:'configured-model'};
const local = {models:{'local-first':'existing first', 'local-second':'existing second'}};
async function scenario(chat, config, check) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chat-fallback-'));
  try {
    await writeFile(path.join(directory,'local_models_info.json'), JSON.stringify({状態:'NG', chat}));
    const before = await readFile(path.join(directory,'local_models_info.json'),'utf8');
    await writeModelsInfo([], {}, {directory, installedClis:{}, configReader: typeof config === 'function' ? config : () => JSON.stringify(config)});
    const result = JSON.parse(await readFile(path.join(directory,'chat_models_info.json'),'utf8'));
    assert.equal(await readFile(path.join(directory,'local_models_info.json'),'utf8'), before, 'provider diagnosis stays unchanged');
    await check(result);
  } finally { await rm(directory,{recursive:true,force:true}); }
}
test('empty Chat uses only the selected configured provider/model with an unverified label', async()=>{
  await scenario({}, {...configured,CHAT_OPENAI_MODEL:'not-selected'}, result=>assert.deepEqual(result,
    {freeai_chat:{models:{'configured-model':'仮設定（未検証） - configured-model'}}}));
});
test('config candidate precedes local while preserving local candidates and order', async()=>{
  await scenario({local_chat:local}, configured, result=>{
    assert.deepEqual(Object.keys(result), ['freeai_chat','local_chat']);
    assert.deepEqual(result.local_chat,local);
    assert.deepEqual(Object.keys(result.local_chat.models),['local-first','local-second']);
  });
});
test('any non-local candidate suppresses fallback without reading configuration', async()=>{
  const chat={local_chat:local,openai_chat:{models:{existing:'verified'}}};
  await scenario(chat,()=>assert.fail('config is unnecessary'),result=>assert.deepEqual(result,chat));
});
test('same configured local candidate is not duplicated or relabeled', async()=>{
  await scenario({local_chat:local},{CHAT_AI_NAME:'local_chat',CHAT_LOCAL_MODEL:'local-first'},result=>assert.deepEqual(result,{local_chat:local}));
});
test('different configured local model preserves the existing local order', async()=>{
  await scenario({local_chat:local},{CHAT_AI_NAME:'local_chat',CHAT_LOCAL_MODEL:'local-new'},result=>{
    assert.deepEqual(Object.keys(result.local_chat.models),['local-first','local-second','local-new']);
  });
});
test('missing, empty, malformed or unsupported config leaves existing Chat untouched', async()=>{
  for (const config of [{},{CHAT_AI_NAME:'freeai_chat'},{...configured,CHAT_FREEAI_MODEL:'  '},
    {...configured,CHAT_FREEAI_MODEL:null},{...configured,CHAT_FREEAI_MODEL:'< your model >'},
    {...configured,CHAT_AI_NAME:'unknown'},()=>'{',()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});}]) {
    for(const chat of [{},{local_chat:local}]) await scenario(chat,config,result=>assert.deepEqual(result,chat));
  }
});
test('OAuth reads the shared OpenAI model setting and trims configured values', async()=>{
  await scenario({}, {CHAT_AI_NAME:' openai_oauth ',CHAT_OPENAI_MODEL:' model-id '}, result=>
    assert.deepEqual(result,{openai_oauth:{models:{'model-id':'仮設定（未検証） - model-id'}}}));
});
