// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {antigravityModels} from '../diag/モデル情報/antigravity_models.mjs';
import {writeModelsInfo} from '../diag/モデル情報/models_info.mjs';

test('Antigravity uses its CLI list, including non-Gemini and custom IDs', async () => {
  const models = await antigravityModels({
    loadEntries:async()=>[{id:'agy'}], resolve:async()=>'/fixture/agy',
    run:async(executable,args,options)=>{
      assert.equal(executable,'/fixture/agy');
      assert.deepEqual(args,['models']);
      assert.equal(options.shell,false);
      assert.equal(options.windowsHide,true);
      assert.equal(options.timeout,15000);
      return {stdout:'Fetching available models...\r\n\x1b[32mgemini-3.8-flash-high\x1b[0m\tGemini Flash (High)\r\nclaude-sonnet-4-6\tClaude Sonnet\ncustom/model\tCustom Model\nSign in first\n'};
    },
  });
  assert.deepEqual(models,{
    'gemini-3.8-flash-high':'yyyy/mm/dd - gemini-3.8-flash-high',
    'claude-sonnet-4-6':'yyyy/mm/dd - claude-sonnet-4-6',
    'custom/model':'yyyy/mm/dd - custom/model',
  });
});

test('Antigravity list failures and unavailable CLI yield no invented model', async () => {
  const base={loadEntries:async()=>[{id:'agy'}],resolve:async()=>'/fixture/agy'};
  assert.deepEqual(await antigravityModels({...base,run:async()=>{throw Error('timeout/auth/unsupported');}}),{});
  assert.deepEqual(await antigravityModels({...base,run:async()=>({stdout:'Please log in\n'})}),{});
  assert.deepEqual(await antigravityModels({...base,resolve:async()=>null,run:async()=>assert.fail('must not run')}),{});
});

test('merge replaces legacy Gemini candidates, falls back to auto/same and skips absent CLI', async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'diag-agy-'));
  const options={directory,installedClis:{antigravity_cli:true},configReader:()=>'{}'};
  const load=async()=>JSON.parse(await readFile(path.join(directory,'code_models_info.json'),'utf8'));
  try {
    await writeFile(path.join(directory,'gemini_models_info.json'),JSON.stringify({code:{antigravity_cli:{models:{'gemini-3.5-flash-lite':'old API model'}}}}));
    const models={'gemini-3.8-flash-high':'yyyy/mm/dd - gemini-3.8-flash-high'};
    await writeModelsInfo([],{}, {...options,antigravityModelsReader:async()=>models});
    assert.deepEqual((await load()).antigravity_cli.models,models);
    await writeModelsInfo([],{}, {...options,antigravityModelsReader:async()=>({})});
    assert.deepEqual(Object.keys((await load()).antigravity_cli.models),['auto','same']);
    await writeModelsInfo([],{}, {...options,installedClis:{},antigravityModelsReader:async()=>assert.fail('must not run')});
    assert.equal((await load()).antigravity_cli,undefined);
  } finally {await rm(directory,{recursive:true,force:true});}
});
