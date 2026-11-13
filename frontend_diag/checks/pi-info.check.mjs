// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Pi（aidiy_pi）用モデル一覧と Diag の Code 試行。一時フォルダと模擬 Tools だけで確認する。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {HERMES_CODE_PROVIDERS, hermesModelsInfo} from '../diag/モデル情報/hermes_info.mjs';
import {PI_MODELS_FILE, PI_CODE_PROVIDER, PI_PROVISIONAL_MODELS, piModelsInfo, piInstalled} from '../diag/モデル情報/pi_info.mjs';
import {writeModelsInfo} from '../diag/モデル情報/models_info.mjs';
import {createModelTrials} from '../diag/モデル試行/trials.mjs';

const label = id => `2026/10/15 - ${id}`;
const section = ids => ({models:Object.fromEntries(ids.map(id => [id, label(id)]))});
const success = ids => ({状態:'OK', モデル詳細:ids.map(model_id => ({model_id, 作成日:'2026/10/15'}))});
const provider = id => ({id, 名前:id, 設定済み:true});
const options = {configReader:() => '{}', naviHermesAvailable:false, now:() => new Date('2026-10-15T00:00:00Z')};
async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'diag-pi-'));
  const load = async name => JSON.parse(await readFile(path.join(directory, `${name}_models_info.json`), 'utf8'));
  try { await run(directory, load); } finally { await rm(directory, {recursive:true, force:true}); }
}

test('Pi list includes the same external CLI sections as Hermes (same keys, order and labels)', () => {
  const chat = Object.fromEntries(['gemini_chat', 'freeai_chat', 'openrt_chat', 'openrt_free', 'openai_chat', 'ollama_chat', 'local_chat'].map(key => [key, section([`${key}-model`])]));
  const code = Object.fromEntries(HERMES_CODE_PROVIDERS.map(key => [key, section([`${key}-model`])]));
  code.aidiy_hermes = section(['openai_oauth/gpt-6-luna']);
  const claude = {プロバイダ:'claude', 状態:'OK', chat:{モデル:[{model_id:'claude-sonnet-5-5', 作成日:'2026/10/15', モダリティ:'text->text'}]}};
  const input = {chatModels:chat, codeModels:code, providerInfos:[claude]};
  const hermes = hermesModelsInfo(input);
  const pi = piModelsInfo(input);
  assert.deepEqual(Object.keys(pi), Object.keys(hermes));
  assert.deepEqual(Object.keys(pi), ['gemini_chat', 'freeai_chat', 'openrt_chat', 'openrt_free', 'openai_chat', 'openai_oauth', 'claude_chat', 'ollama_chat', 'local_chat', ...HERMES_CODE_PROVIDERS]);
  for (const key of Object.keys(pi)) assert.deepEqual(pi[key], hermes[key], key);
  for (const key of HERMES_CODE_PROVIDERS) assert.ok(Object.hasOwn(pi[key].models, 'same'), key);
  assert.deepEqual(piModelsInfo(), {});
  // Hermes 専用の -900k 別名は Pi へ渡さない。別名だけの区分は残さない。
  const aliases = piModelsInfo({codeModels:{aidiy_hermes:section(['openai_oauth/gpt-6-luna', 'openai_oauth/gpt-6-luna-900k'])},
    chatModels:{openai_chat:section(['gpt-6-luna-900k'])}});
  assert.deepEqual(aliases, {openai_oauth:{models:{'gpt-6-luna':label('openai_oauth/gpt-6-luna')}}});
});

test('shared writer saves pi_models_info.json once and adds aidiy_pi to Code only when Pi is set up', async () => fixture(async (directory, load) => {
  const providers = ['gemini', 'openai', 'openai_oauth'].map(provider);
  const results = {gemini:success(['gemini-3-pro']), openai:success(['gpt-6.1-sol']), openai_oauth:success(['gpt-6-luna', 'gpt-6-luna-900k'])};
  const write = installedClis => writeModelsInfo(providers, results, {...options, directory, installedClis});

  const saved = await write({codex_cli:true, [PI_CODE_PROVIDER]:true});
  assert.equal(saved.filter(file => file === PI_MODELS_FILE).length, 1);
  const code = await load('code'), hermes = await load('hermes'), pi = await load('pi');
  // Pi も外部CLIの xx/same 経路を持ち、aidiy_hermes の直後に並ぶ。
  assert.deepEqual(code[PI_CODE_PROVIDER], {models:{'codex_cli/same':'yyyy/mm/dd - codex_cli/same','openai_oauth/gpt-6-luna':'2026/10/15 - openai_oauth/gpt-6-luna'}});
  assert.ok(Object.hasOwn(code.aidiy_hermes.models, 'codex_cli/same'));
  const keys = Object.keys(code);
  assert.equal(keys.indexOf(PI_CODE_PROVIDER), keys.indexOf('aidiy_hermes') + 1);
  assert.deepEqual(Object.keys(pi), Object.keys(hermes));
  assert.deepEqual(Object.keys(pi.openai_oauth.models), Object.keys(hermes.openai_oauth.models));
  assert.doesNotMatch(JSON.stringify(hermes), /-900k/);
  assert.doesNotMatch(JSON.stringify([pi, code[PI_CODE_PROVIDER]]), /-900k/);
  // Navi・予測はPiのAPI/OAuth候補を扱い、外部CLIへの委譲は含めない。
  for (const name of ['navi', 'prediction']) {
    assert.deepEqual(Object.keys((await load(name))[PI_CODE_PROVIDER].models), ['openai_oauth/gpt-6-luna']);
  }

  await write({codex_cli:true, [PI_CODE_PROVIDER]:false});
  assert.equal((await load('code'))[PI_CODE_PROVIDER], undefined);
  await write({codex_cli:true});
  assert.equal((await load('code'))[PI_CODE_PROVIDER], undefined);

  // OAuth 候補が無くても、setup 済みなら試行できるよう仮候補 auto を置く。
  await writeModelsInfo([provider('gemini')], {gemini:success(['gemini-3-pro'])}, {...options, directory: path.join(directory, 'empty'), installedClis:{[PI_CODE_PROVIDER]:true}});
  const empty = JSON.parse(await readFile(path.join(directory, 'empty', 'code_models_info.json'), 'utf8'));
  assert.deepEqual(empty[PI_CODE_PROVIDER], {models:{...PI_PROVISIONAL_MODELS}});
}));

test('Pi setup detection needs node_modules, generated model data and the CLI entry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diag-pi-root-'));
  try {
    const pi = path.join(root, 'command_pi');
    assert.equal(await piInstalled({root}), false);
    await mkdir(path.join(pi, 'node_modules'), {recursive:true});
    await mkdir(path.join(pi, 'packages', 'coding-agent', 'src'), {recursive:true});
    await writeFile(path.join(pi, 'packages', 'coding-agent', 'src', 'cli.ts'), '');
    assert.equal(await piInstalled({root}), false, 'model data missing');
    await mkdir(path.join(pi, 'packages', 'ai', 'src', 'providers', 'data'), {recursive:true});
    assert.equal(await piInstalled({root}), false, 'AiDiy entry missing');
    await mkdir(path.join(pi, 'aidiy'), {recursive:true});
    await writeFile(path.join(pi, 'aidiy', 'aidiy_pi.ts'), '');
    assert.equal(await piInstalled({root}), true);
  } finally {
    await rm(root, {recursive:true, force:true});
  }
});

// Code 試行: aidiy_pi は試行対象。Tools（code_agents_run）の結果をそのまま OK / NG として表示する。
const config = model => ({CODE_BASE_PATH:'/synthetic/project', CODE_AI1_NAME:'aidiy_pi', CODE_AI1_MODEL:model});
function trialFixture({installed, model = 'openai_oauth/gpt-6-luna', status = 'OK'}) {
  const calls = [];
  const trials = createModelTrials({
    reader:async () => JSON.stringify(config(model)), credentialReader:() => null, catalogReader:async () => ({}),
    statusFn:async () => ({online:true}), installedClisFn:async () => ({codex_cli:false, [PI_CODE_PROVIDER]:installed}),
    request:async request => {
      calls.push(request);
      const {id, method} = request.body || {};
      if (method === 'initialize') return {body:{jsonrpc:'2.0', id, result:{protocolVersion:'2024-11-05'}}};
      if (method === 'tools/call') return {body:{jsonrpc:'2.0', id, result:{structuredContent:{status, result:status === 'OK' ? 'hello' : '! 実行エラー: aidiy_pi No API key', history_saved:true}}}};
      return {body:null};
    },
  });
  return {trials, calls};
}

test('aidiy_pi Code trial is supported and sends provider/model to Tools code_agents_run', async () => {
  const {trials, calls} = trialFixture({installed:true});
  try {
    const start = await trials.start({rowId:'CODE1'});
    const row = start.項目.find(item => item.id === 'CODE1');
    assert.equal(row.プロバイダ, PI_CODE_PROVIDER);
    assert.equal(row.状態, '未実行');
    assert.equal((await trials.next(start.実行ID, 'CODE1')).状態, 'OK');
    const call = calls.find(item => item.body?.method === 'tools/call');
    assert.equal(call.path, '/aidiy_code_agents/mcp');
    assert.equal(call.body.params.name, 'code_agents_run');
    assert.match(JSON.stringify(call.body.params.arguments), /aidiy_pi/);
  } finally { await trials.close(); }
});

test('aidiy_pi Code trial reports NG when Tools returns an error (e.g. not logged in)', async () => {
  const {trials} = trialFixture({installed:true, status:'NG'});
  try {
    const start = await trials.start({rowId:'CODE1'});
    assert.equal((await trials.next(start.実行ID, 'CODE1')).状態, 'NG');
  } finally { await trials.close(); }
});

test('aidiy_pi Code trial is skipped without MCP when command_pi is not set up', async () => {
  const {trials, calls} = trialFixture({installed:false});
  try {
    const start = await trials.start({rowId:'CODE1'});
    const result = await trials.next(start.実行ID, 'CODE1');
    assert.equal(result.状態, '未実施');
    assert.match(result.説明, /aidiy_pi が未導入/);
    assert.equal(calls.length, 0);
  } finally { await trials.close(); }
});
