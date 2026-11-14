// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// aidiy_codex 用のモデル一覧は Pi 一覧と同じ入力・区分名で作り、chat モデルの区分だけを残す（実行できるのは今は openai_oauth のみ）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {CODEX_MODELS_FILE,CODEX_CODE_PROVIDER,CODEX_SUPPORTED_SECTION,codexModelsInfo,codexInstalled,isCliSection} from '../diag/モデル情報/codex_info.mjs';
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

test('aidiy_codex keeps only chat model sections of the Pi list (no external CLI sections)',()=>{
  const input={
    chatModels:{openai_oauth:{models:{'gpt-6.1-sol':'GPT-6.1 Sol'}},gemini_chat:{models:{'gemini-4-carbon':'Gemini 4 Carbon'}}},
    codeModels:{codex_cli:{models:{same:'前回モデル','gpt-6.1-sol':'GPT-6.1 Sol'}},claude_cli:{models:{same:'前回モデル'}}},
    providerInfos:[],
  };
  const pi=piModelsInfo(input),codex=codexModelsInfo(input);
  assert.ok(Object.keys(pi).some(isCliSection),'Pi は CLI 区分を持つ');
  assert.deepEqual(Object.keys(codex),Object.keys(pi).filter(section=>!isCliSection(section)));
  for(const section of Object.keys(codex))assert.deepEqual(codex[section],pi[section]);
  assert.deepEqual(codexModelsInfo({}),Object.fromEntries(Object.entries(piModelsInfo({})).filter(([section])=>!isCliSection(section))));
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
