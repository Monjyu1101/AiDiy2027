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
    await writeFile(path.join(directory,'gemini_models_info.json'),JSON.stringify({code:{antigravity_cli:{models:{'gemini-fixture-legacy':'old API model'}}}}));
    const models={'gemini-3.8-flash-high':'yyyy/mm/dd - gemini-3.8-flash-high'};
    await writeModelsInfo([],{}, {...options,antigravityModelsReader:async()=>models});
    assert.deepEqual((await load()).antigravity_cli.models,models);
    await writeModelsInfo([],{}, {...options,antigravityModelsReader:async()=>({})});
    assert.deepEqual(Object.keys((await load()).antigravity_cli.models),['auto','same']);
    await writeModelsInfo([],{}, {...options,installedClis:{},antigravityModelsReader:async()=>assert.fail('must not run')});
    assert.equal((await load()).antigravity_cli,undefined);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('OAuth-only discovery finds a VS Code agy outside PATH and strips alternate auth without affecting the old path', async () => {
  const {catalog,resolveProgram}=await import('../diag/診断/probes.mjs');
  const directory=await mkdtemp(path.join(os.tmpdir(),'diag-agy-vscode-'));
  try {
    const {mkdir}=await import('node:fs/promises');
    const bin=path.join(directory,'.gemini','bin');await mkdir(bin,{recursive:true});
    const binary=path.join(bin,'agy.exe');await writeFile(binary,'fixture');
    const env={PATH:'',USERPROFILE:directory,GEMINI_API_KEY:'fixture',google_api_key:'fixture',AGY_ADC_AUTH:'true',GOOGLE_APPLICATION_CREDENTIALS:'fixture',GOOGLE_GEMINI_BASE_URL:'fixture'};
    const entry=(await catalog()).find(item=>item.id==='agy');
    const resolve=entry=>resolveProgram(entry,{env,platform:'win32'});
    assert.equal(await resolve(entry),null);
    const opts={resolve,env,platform:'win32',run:async(executable,args,options)=>{
      assert.equal(executable,binary);assert.deepEqual(args,['models']);
      assert.deepEqual(options.env,{PATH:'',USERPROFILE:directory});
      return {stdout:'gemini-4-hydrogen-medium   Gemini 4 Hydrogen\n'};
    }};
    assert.deepEqual(await antigravityModels({...opts,oauthOnly:true}),{'gemini-4-hydrogen-medium':'yyyy/mm/dd - gemini-4-hydrogen-medium'});
    assert.equal(env.GEMINI_API_KEY,'fixture');
    assert.deepEqual(await antigravityModels({...opts,run:async()=>assert.fail('legacy must not launch the extension copy')}),{});
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('writes one isolated OAuth catalog and derives both Chat and Code lists while leaving legacy candidates unchanged', async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'diag-agy-oauth-'));
  try {
    await writeFile(path.join(directory,'gemini_models_info.json'),JSON.stringify({
      chat:{gemini_chat:{models:{'api-key-model':'Gemini API'}},gemini_agy:{models:{'stale-chat':'stale'}}},
      code:{agy_cli:{models:{'stale-code':'stale'}},antigravity_cli:{models:{'stale-legacy':'stale'}}},
    }));
    const read=async name=>JSON.parse(await readFile(path.join(directory,name), 'utf8'));
    const save=opts=>writeModelsInfo([],{}, {directory,installedClis:{antigravity_cli:true,agy_cli:true},
      configReader:()=>JSON.stringify({CHAT_GEMINI_AGY_MODEL:'custom-chat',CODE_AGY_CLI_MODEL:'custom-code'}),
      antigravityModelsReader:async()=>({'legacy-only':'legacy'}),...opts});
    let calls=0;
    const suffix='gemini-4-hydrogen-medium';
    const saved=await save({agyModelsReader:async options=>{calls++;assert.deepEqual(options,{oauthOnly:true});return {[suffix]:'OAuth',auto:'not a real slug'};}});
    assert.ok(saved.includes('gemini_agy_models_info.json'));
    assert.ok(saved.includes('antigravity_models_info.json'));
    assert.deepEqual(await read('antigravity_models_info.json'),{プロバイダ:'antigravity',取得元:'agy models',状態:'OK',models:{'legacy-only':'legacy'}});
    assert.equal(calls,1);
    const oauth=await read('gemini_agy_models_info.json');
    assert.deepEqual(oauth,{プロバイダ:'gemini_agy',認証方式:'Google OAuth',取得元:'agy models',状態:'OK',models:{[suffix]:'OAuth'}});
    const chat=await read('chat_models_info.json'),code=await read('code_models_info.json');
    assert.deepEqual(Object.keys(chat.gemini_agy.models),['auto',suffix,'custom-chat']);
    assert.deepEqual(Object.keys(code.agy_cli.models),['auto','same',suffix,'custom-code']);
    assert.deepEqual(code.antigravity_cli.models,{'legacy-only':'legacy'});
    assert.deepEqual(chat.gemini_chat.models,{'api-key-model':'Gemini API'});
    for (const file of ['prediction_models_info.json','navi_models_info.json','hermes_models_info.json','pi_models_info.json','aidiy_codex_models_info.json'])
      assert.equal((await read(file)).agy_cli,undefined,file);
    await save({agyModelsReader:async()=>({})});
    assert.equal((await read('gemini_agy_models_info.json')).状態,'未取得');
    assert.deepEqual(Object.keys((await read('chat_models_info.json')).gemini_agy.models),['auto','custom-chat']);
    assert.deepEqual(Object.keys((await read('code_models_info.json')).agy_cli.models),['auto','same','custom-code']);
    await save({installedClis:{antigravity_cli:true},agyModelsReader:async()=>assert.fail('must not run')});
    assert.equal((await read('gemini_agy_models_info.json')).状態,'未導入');
    assert.equal((await read('chat_models_info.json')).gemini_agy,undefined);
    assert.equal((await read('code_models_info.json')).agy_cli,undefined);
  } finally {await rm(directory,{recursive:true,force:true});}
});
