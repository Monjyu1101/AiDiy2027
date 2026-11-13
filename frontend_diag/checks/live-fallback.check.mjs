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
import {liveVoicesInfo} from '../diag/モデル情報/voices_info.mjs';

async function scenario(live, config, check) {
  const directory = await mkdtemp(path.join(os.tmpdir(),'live-fallback-'));
  try {
    const configPath = path.join(directory,'config-fixture.json');
    const contents = typeof config === 'string' ? config : JSON.stringify(config);
    await writeFile(configPath, contents);
    await writeFile(path.join(directory,'gemini_models_info.json'),JSON.stringify({live}));
    await writeModelsInfo([],{}, {directory,installedClis:{},configReader:()=>readFile(configPath,'utf8')});
    assert.equal(await readFile(configPath,'utf8'),contents,'configuration is never rewritten');
    assert.deepEqual(JSON.parse(await readFile(path.join(directory,'live_voices_info.json'),'utf8')),liveVoicesInfo());
    await check(JSON.parse(await readFile(path.join(directory,'live_models_info.json'),'utf8')));
  } finally { await rm(directory,{recursive:true,force:true}); }
}
test('empty Live uses the selected configured model for each supported provider', async()=>{
  for (const vendor of ['freeai','gemini','openai']) {
    const provider=vendor+'_live';
    await scenario({}, {LIVE_AI_NAME:provider,['LIVE_'+vendor.toUpperCase()+'_MODEL']:'configured-live'},result=>
      assert.deepEqual(result,{[provider]:{models:{'configured-live':'仮設定（未検証） - configured-live'}}}));
  }
});
test('acquired Live candidates and ordering are retained without config additions', async()=>{
  const live={gemini_live:{models:{first:'first',second:'second'}}};
  await scenario(live,{LIVE_AI_NAME:'freeai_live',LIVE_FREEAI_MODEL:'not-added'},result=>assert.deepEqual(result,live));
});
test('empty or invalid Live config leaves models empty but always writes all voices', async()=>{
  for(const config of [{},{LIVE_AI_NAME:'freeai_live'},{LIVE_AI_NAME:'freeai_live',LIVE_FREEAI_MODEL:' '},
    {LIVE_AI_NAME:'unknown',LIVE_FREEAI_MODEL:'model'},{LIVE_AI_NAME:'freeai_live',LIVE_FREEAI_MODEL:'< your model >'},'{']) {
    await scenario({},config,result=>assert.deepEqual(result,{}));
  }
});
test('missing configuration leaves Live empty and still writes all three voice catalogs',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'live-missing-'));
  try{
    await writeModelsInfo([],{}, {directory,installedClis:{},configReader:()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});}});
    assert.deepEqual(JSON.parse(await readFile(path.join(directory,'live_models_info.json'),'utf8')),{});
    assert.deepEqual(JSON.parse(await readFile(path.join(directory,'live_voices_info.json'),'utf8')),liveVoicesInfo());
  }finally{await rm(directory,{recursive:true,force:true});}
});
