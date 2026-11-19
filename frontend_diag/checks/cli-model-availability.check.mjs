// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {writeModelsInfo, installedCodeClis} from '../diag/モデル情報/models_info.mjs';
import {resolveProgram} from '../diag/診断/probes.mjs';
import {modelsStep} from '../diag/診断/headless.mjs';
import {hermesModelsInfo, HERMES_CODE_PROVIDERS} from '../diag/モデル情報/hermes_info.mjs';
import {piModelsInfo} from '../diag/モデル情報/pi_info.mjs';
import {codexModelsInfo} from '../diag/モデル情報/codex_info.mjs';
const section = (...ids) => ({models:Object.fromEntries(ids.map(id=>[id,`2026/11/19 - ${id}`]))});
const providers=[{id:'gemini',名前:'Gemini',設定済み:true,テスト可能:true}];
const result={状態:'OK',モデル詳細:[{model_id:'gemini-current'}]};
const options={configReader:()=> '{}',naviHermesAvailable:false};
const load=async(directory,name)=>JSON.parse(await readFile(path.join(directory,`${name}_models_info.json`),'utf8'));
async function fixture(run){const directory=await mkdtemp(path.join(os.tmpdir(),'diag-cli-models-'));try{await run(directory);}finally{await rm(directory,{recursive:true,force:true});}}
async function seed(directory){
 const cli=Object.fromEntries(HERMES_CODE_PROVIDERS.map(key=>[key,section('saved-model')]));
 const routes=HERMES_CODE_PROVIDERS.flatMap(key=>[`${key}/saved-model`,`${key}/same`]);
 await writeFile(path.join(directory,'openai_oauth_models_info.json'),JSON.stringify({プロバイダ:'openai_oauth',状態:'OK',code:{...cli,
  aidiy_hermes:section('openai_oauth/oauth-kept','openai_chat/api-kept',...routes),
  aidiy_pi:section(...routes),aidiy_codex:section(...routes)}}));
}
async function verify(directory,installed){
 const code=await load(directory,'code');
 for(const key of HERMES_CODE_PROVIDERS){
  assert.equal(Object.hasOwn(code,key),installed[key]===true,`Code ${key}`);
  for(const name of ['aidiy_hermes','aidiy_pi','aidiy_codex']){
   const routes=Object.keys(code[name]?.models??{}).filter(id=>id.startsWith(`${key}/`));
   assert.equal(routes.length>0,installed[key]===true,`${name}: ${key}`);
  }
 }
 assert.ok(code.aidiy_hermes.models['openai_oauth/oauth-kept']);
 assert.ok(code.aidiy_hermes.models['openai_chat/api-kept']);
 for(const name of ['hermes','pi','aidiy_codex']){
  const info=await load(directory,name);
  for(const key of HERMES_CODE_PROVIDERS)assert.equal(Object.hasOwn(info,key),installed[key]===true,`${name}: ${key}`);
  assert.ok(info.openai_oauth.models['oauth-kept']);
  assert.ok(info.gemini_chat.models['gemini-current']);
 }
}
test('各専用一覧は導入判定でCLIを除外し、API/OAuthは維持する',()=>{
 const codeModels={...Object.fromEntries(HERMES_CODE_PROVIDERS.map(key=>[key,section('saved')])),aidiy_hermes:section('openai_oauth/oauth-kept')};
 for(const build of [hermesModelsInfo,piModelsInfo,codexModelsInfo]){
  const info=build({codeModels,chatModels:{gemini_chat:section('gemini-current')},installedClis:{codex_cli:true}});
  assert.deepEqual(Object.keys(info).filter(key=>key.endsWith('_cli')),['codex_cli']);
  assert.ok(info.codex_cli.models.same);
  assert.ok(info.openai_oauth.models['oauth-kept']);assert.ok(info.gemini_chat.models['gemini-current']);
 }
});
test('画面共通writerは個別更新とアンインストール後の再書込でも旧CLI委譲経路を復活させない',async()=>fixture(async directory=>{
 await seed(directory);
 const all={...Object.fromEntries(HERMES_CODE_PROVIDERS.map(key=>[key,true])),aidiy_pi:true,aidiy_codex:true};
 for(const installedClis of [all,{...all,claude_cli:false,copilot_cli:false,grok_cli:false},{aidiy_pi:true,aidiy_codex:true}]){
  await writeModelsInfo(providers,{gemini:result},{...options,directory,installedClis,antigravityModelsReader:async()=>({'agy-current':'agy-current'})});
  await verify(directory,installedClis);
 }
}));
test('headlessも実行ファイル確認で除外する。古い診断OKと保存済みモデルは導入の根拠にならない',async()=>fixture(async directory=>{
 await seed(directory);
 const bin=path.join(directory,'bin');await mkdir(bin);
 // 実行はしない。PATH上の実在ファイルだけでcopilotを検出する。
 await writeFile(path.join(bin,'copilot'),'fixture - must not execute',{mode:0o755});
 let checks=0;
 const installedClisFn=async()=>{checks++;return installedCodeClis({
  loadEntries:async()=>HERMES_CODE_PROVIDERS.map(key=>({id:{antigravity_cli:'agy'}[key]??key.replace(/_cli$/,''),commands:[key.replace(/_cli$/,'')]})),
  resolve:entry=>resolveProgram(entry,{platform:'linux',env:{PATH:bin}}),piCheck:async()=>true,codexCheck:async()=>true,
 });};
 const installed=await installedClisFn();checks=0;
 await modelsStep({directory,log:()=>{},configReader:options.configReader,installedClisFn,
  installResults:HERMES_CODE_PROVIDERS.map(id=>({id,状態:'OK'})),
  statusFn:async()=>({項目:providers}),testFn:async()=>result,publicCache:{refresh:async()=>{},input:()=>({})}});
 assert.equal(checks,1);await verify(directory,installed);
}));
test('未取得・取得失敗でも導入済みCopilot/OpenCodeの補完候補を維持し、未導入には補わない',async()=>fixture(async directory=>{
 for(const installedClis of [{copilot_cli:true,opencode_cli:true},{}]){
  await writeModelsInfo([{id:'openai',名前:'OpenAI'}],{openai:{状態:'NG'}},{...options,directory,installedClis});
  for(const name of ['code','hermes','pi','aidiy_codex']){
   const info=await load(directory,name);
   for(const key of ['copilot_cli','opencode_cli'])assert.equal(Object.keys(info[key]?.models??{}).length>0,installedClis[key]===true,`${name}: ${key}`);
  }
 }
}));
