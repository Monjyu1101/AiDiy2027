// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// aidiy_codex の専用一覧は Pi と同じ区分・候補を保存し、Code へ区分付きのモデル名を渡す。
import test from 'node:test';
import assert from 'node:assert/strict';
import {CODEX_MODELS_FILE,CODEX_CODE_PROVIDER,CODEX_SUPPORTED_SECTION,codexModelsInfo,codexCodeModels,codexInstalled,isCliSection} from '../diag/モデル情報/codex_info.mjs';
import {HERMES_CODE_PROVIDERS} from '../diag/モデル情報/hermes_info.mjs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PI_MODELS_FILE,piModelsInfo} from '../diag/モデル情報/pi_info.mjs';

test('aidiy_codex list file is distinct from code_models_info.json and the npm codex section',()=>{
  assert.equal(CODEX_MODELS_FILE,'aidiy_codex_models_info.json');
  assert.notEqual(CODEX_MODELS_FILE,PI_MODELS_FILE);
  assert.equal(CODEX_CODE_PROVIDER,'aidiy_codex');
  assert.ok(isCliSection('codex_cli'));assert.ok(!isCliSection('openai_oauth'));assert.ok(!isCliSection('local_chat'));
});

test('aidiy_codex preserves all Pi sections, model order, labels and CLI same entries',()=>{
  const input={
    chatModels:{openai_oauth:{models:{'gpt-6.2-sol':'GPT-6.1 Sol'}},gemini_chat:{models:{'gemini-4-carbon':'Gemini 4 Carbon'}}},
    codeModels:Object.fromEntries(HERMES_CODE_PROVIDERS.map(section=>[section,{models:{same:'前回モデル',
      [section==='opencode_cli'?'openai/gpt-6-luna':'gpt-6-luna']:'Luna', 'gpt-6-luna-900k':'旧別名'}}])),
    providerInfos:[],
  };
  const pi=piModelsInfo(input),codex=codexModelsInfo(input);
  assert.ok(Object.keys(pi).some(isCliSection),'Pi は CLI 区分を持つ');
  assert.deepEqual(Object.keys(codex),Object.keys(pi));
  assert.deepEqual(codex,pi);
  for(const section of HERMES_CODE_PROVIDERS){
    assert.equal(Object.keys(codex[section].models)[0],'same');
    assert.deepEqual(Object.keys(codex[section].models),Object.keys(pi[section].models));
  }
  assert.doesNotMatch(JSON.stringify(codex),/-900k/);
  assert.deepEqual(codexModelsInfo({}),piModelsInfo({}));
  const routes=codexCodeModels(codex);
  for(const section of HERMES_CODE_PROVIDERS) assert.equal(routes[`${section}/same`],'前回モデル');
  assert.equal(routes['codex_cli/gpt-6-luna'],'Luna');
  assert.equal(routes['opencode_cli/openai/gpt-6-luna'],'Luna');
  assert.deepEqual(codexCodeModels({codex_cli:{models:{auto:'自動',same:'前回'}},openai_oauth:{models:{auto:'自動',same:'前回','gpt-6-luna':'Luna'}}}),
    {'openai_oauth/gpt-6-luna':'Luna','codex_cli/same':'前回'});
});

test('aidiy_codex is enabled only when the compiled binary exists (CLI is not executed)',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'diag-codex-installed-'));
  try{
    const binary=path.join(directory,'aidiy_codex.exe');
    assert.equal(await codexInstalled({binaries:()=>[binary]}),false);
    await writeFile(binary,'');
    assert.equal(await codexInstalled({binaries:()=>[binary]}),true);
    assert.equal(CODEX_SUPPORTED_SECTION,'openai_oauth');
  }finally{await rm(directory,{recursive:true,force:true});}
});
