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
import {modelsStep} from '../diag/診断/headless.mjs';
import {createHandler} from '../diag/diag_main.mjs';
import {createPreviousResults} from '../diag/診断/前回結果.mjs';
import {getKeyStatus,testKey,createModelRunner} from '../diag/モデル情報/key_status.mjs';
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
    const save=(opts,result)=>writeModelsInfo([],result?{gemini_agy:result}:{}, {directory,installedClis:{antigravity_cli:true,agy_cli:true},
      configReader:()=>JSON.stringify({CHAT_GEMINI_AGY_MODEL:'custom-chat',CODE_AGY_CLI_MODEL:'custom-code'}),
      antigravityModelsReader:async()=>({'legacy-only':'legacy'}),...opts});
    let calls=0;
    const suffix='gemini-4-hydrogen-medium', label=`yyyy/mm/dd - ${suffix}`;
    const runner=createModelRunner();
    let executable=null;
    const run=(action,id,options)=>runner.run(action,id,{...options,reader:async()=>{throw Error('config unavailable');},oauthReader:async()=>{throw Error('no auth file');},fetch:async()=>assert.fail('must not call an API')});
    const resolveAgy=async()=>executable;
    const readAgyModels=async options=>{calls++;assert.equal(options.oauthOnly,true);assert.equal(options.executable,executable);assert.ok(options.signal);return {[suffix]:'OAuth',auto:'not a real slug'};};
    const probe=opts=>testKey('gemini_agy',{resolveAgy,readAgyModels,run,...opts});
    const status=()=>getKeyStatus({resolveAgy,run});
    const unavailable=await status();
    assert.deepEqual(unavailable.項目.slice(0,3).map(row=>row.名前),['Gemini (API)','FreeAI (Gemini)','Gemini (Agy)']);
    assert.equal(unavailable.項目[2].テスト可能,false);
    assert.equal((await probe()).状態,'未実施');
    assert.equal(calls,0);
    executable='/fixture/vscode/agy.exe';
    const available=await status();
    assert.equal(available.項目[2].テスト可能,true);
    assert.equal(calls,0);
    let tested, saved;
    const handler=createHandler({
      token:'fixture',keyStatusFn:status,
      keyTestFn:(id,opts)=>{assert.equal(id,'gemini_agy');return probe(opts);},
      modelsWriteFn:async(items,results)=>{assert.ok(items.some(row=>row.id==='gemini_agy'));saved=await save({},results.gemini_agy);return saved;},
    });
    const request=async(route,method='POST',headers={authorization:'Bearer fixture'})=>{
      const res={status:0,body:null,writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
      await handler({url:'/api/'+route,method,headers},res);
      return res;
    };
    try {
      const rows=(await request('キー設定/モデル一覧','GET')).body.項目;
      assert.equal(rows[2].テスト可能,true);
      assert.equal((await request('キーテスト/gemini_agy','POST',{})).status,401);
      assert.equal((await request('キーテスト/gemini_agy','POST',{authorization:'Bearer fixture','content-length':'2'})).status,400);
      assert.equal((await request('モデル書込')).status,409);
      const response=await request('キーテスト/gemini_agy');
      assert.equal(response.status,200);
      tested=response.body;
      assert.equal(tested.状態,'OK');
      assert.deepEqual(tested.モデル,[suffix]);
      assert.equal((await request('モデル書込')).status,200);
    } finally {await handler.close();}
    assert.ok(saved.includes('gemini_agy_models_info.json'));
    assert.ok(saved.includes('antigravity_models_info.json'));
    assert.deepEqual(await read('antigravity_models_info.json'),{プロバイダ:'antigravity',取得元:'agy models',状態:'OK',models:{'legacy-only':'legacy'}});
    assert.equal(calls,1);
    const oauth=await read('gemini_agy_models_info.json');
    assert.deepEqual(oauth,{プロバイダ:'gemini_agy',認証方式:'Google OAuth',取得元:'agy models',状態:'OK',models:{[suffix]:label},確認日時:tested.確認日時,説明:tested.説明});
    const chat=await read('chat_models_info.json'),code=await read('code_models_info.json');
    assert.deepEqual(Object.keys(chat.gemini_agy.models),['auto',suffix,'custom-chat']);
    assert.deepEqual(Object.keys(code.agy_cli.models),['auto','same',suffix,'custom-code']);
    assert.deepEqual(code.antigravity_cli.models,{'legacy-only':'legacy'});
    const navi=await read('navi_models_info.json');
    assert.deepEqual(navi.agy_cli,code.agy_cli);
    assert.equal(navi.antigravity_cli,undefined);
    assert.deepEqual(Object.keys(code).slice(-2),['antigravity_cli','agy_cli']);
    assert.deepEqual(chat.gemini_chat.models,{'api-key-model':'Gemini API'});
    for (const file of ['hermes_models_info.json','pi_models_info.json','aidiy_codex_models_info.json']) {
      const list=await read(file), keys=Object.keys(list), legacy=keys.indexOf('antigravity_cli');
      assert.ok(legacy>=0,file);
      assert.equal(keys[legacy+1],'agy_cli',file);
      assert.equal(list.agy_cli.models[suffix],label,file);
      assert.equal(list.agy_cli.models['legacy-only'],undefined,file);
    }
    for (const file of ['prediction_models_info.json','decisions_models_info.json'])
      assert.equal((await read(file)).agy_cli,undefined,file);
    assert.match(code.aidiy_hermes.models[`agy_cli/${suffix}`], new RegExp(`agy_cli/${suffix}$`));
    for (const file of ['prediction_models_info.json','decisions_models_info.json'])
      assert.deepEqual((await read(file)).gemini_agy,{models:{[suffix]:label}},file);
    const snapshot=()=>createPreviousResults({directory}).snapshot();
    assert.deepEqual((await snapshot()).モデル一覧.結果.find(row=>row.id==='gemini_agy').モデル,[suffix]);
    assert.ok(!(await save({})).includes('gemini_agy_models_info.json'));
    assert.deepEqual(await read('gemini_agy_models_info.json'),oauth);
    const failed=await probe({readAgyModels:async()=>({})});
    assert.equal(failed.状態,'NG');
    await save({},failed);
    assert.equal((await snapshot()).モデル一覧.結果.find(row=>row.id==='gemini_agy').状態,'NG');
    assert.equal((await read('gemini_agy_models_info.json')).状態,'未取得');
    for (const file of ['prediction_models_info.json','decisions_models_info.json'])
      assert.equal((await read(file)).gemini_agy,undefined,file);
    assert.deepEqual(Object.keys((await read('chat_models_info.json')).gemini_agy.models),['auto','custom-chat']);
    assert.deepEqual(Object.keys((await read('code_models_info.json')).agy_cli.models),['auto','same','custom-code']);
    await save({installedClis:{antigravity_cli:true}});
    assert.equal((await read('gemini_agy_models_info.json')).状態,'未導入');
    assert.equal((await read('chat_models_info.json')).gemini_agy,undefined);
    assert.equal((await read('code_models_info.json')).agy_cli,undefined);
    assert.equal((await read('navi_models_info.json')).agy_cli,undefined);
    for (const file of ['hermes_models_info.json','pi_models_info.json','aidiy_codex_models_info.json'])
      assert.equal((await read(file)).agy_cli,undefined,file);
    await save({installedClis:{agy_cli:true},
      antigravityModelsReader:async()=>assert.fail('legacy CLI is not installed')},tested);
    const oauthOnly=await read('code_models_info.json');
    assert.equal(oauthOnly.antigravity_cli,undefined);
    assert.equal(Object.keys(oauthOnly).at(-1),'agy_cli');
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('headless uses the same Agy model test and writes the CLI result', {skip:process.platform==='win32'}, async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'diag-agy-headless-'));
  try {
    const executable=path.join(directory,'agy');
    await writeFile(executable, "#!/bin/sh\n[ \"$#\" = 1 ] && [ \"$1\" = models ] || exit 90\nprintf 'gemini-4-hydrogen-low\\tGemini Hydrogen\\n'\n", {mode:0o700});
    const runner=createModelRunner();
    const run=(action,id,opts)=>runner.run(action,id,{...opts,reader:async()=>'{}',oauthReader:async()=>'',fetch:async()=>assert.fail('must not call an API')});
    const resolveAgy=async()=>executable;
    const statusFn=async()=>({項目:(await getKeyStatus({resolveAgy,run})).項目.filter(item=>item.id==='gemini_agy')});
    const result=await modelsStep({directory,statusFn,testFn:(id,opts)=>testKey(id,{...opts,run,resolveAgy}),
      installedClisFn:async()=>({agy_cli:true}),configReader:()=> '{}',log:()=>{},
      publicCache:{refresh:async()=>{},input:()=>({})}});
    assert.deepEqual(result.集計,{OK:1});
    const saved=JSON.parse(await readFile(path.join(directory,'gemini_agy_models_info.json'),'utf8'));
    assert.deepEqual(Object.keys(saved.models),['gemini-4-hydrogen-low']);
  } finally {await rm(directory,{recursive:true,force:true});}
});
