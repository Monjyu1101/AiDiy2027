// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {HERMES_MODELS_FILE, HERMES_CODE_PROVIDERS, HERMES_SAME_LABEL, hermesChatModel, hermesModelsInfo} from '../モデル情報/hermes_info.mjs';
import {writeModelsInfo} from '../モデル情報/models_info.mjs';
import {probe} from '../runtime/model_probe.mjs';

const label = id => `2026/10/15 - ${id}`;
const section = ids => ({models:Object.fromEntries(ids.map(id => [id, label(id)]))});
const success = ids => ({状態:'OK', モデル詳細:ids.map(model_id => ({model_id, 作成日:'2026/10/15'}))});
const provider = id => ({id, 名前:id, 設定済み:true});
const options = {installedClis:{}, configReader:() => '{}', naviHermesAvailable:false, now:() => new Date('2026-10-15T00:00:00Z')};
async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'diag-hermes-'));
  const load = async name => JSON.parse(await readFile(path.join(directory, `${name}_models_info.json`), 'utf8'));
  try { await run(directory, load); } finally { await rm(directory, {recursive:true, force:true}); }
}

test('Hermes API catalog keeps all Chat candidates across generations and more than 50 models', () => {
  const ids = ['gemini-2.5-flash', 'gemini-3-flash', 'gemma-3-it', 'gemma-4-it', ...Array.from({length:70}, (_, i) => `dialog-${i}`)];
  const chatModels = Object.fromEntries(['gemini_chat', 'freeai_chat', 'openrt_chat', 'openai_chat'].map(key => [key, section(ids)]));
  chatModels.local_chat = section(['local-only']);
  chatModels.ollama_chat = section(['ollama-only']);
  const original = JSON.stringify(chatModels);
  const info = hermesModelsInfo({chatModels});
  assert.deepEqual(Object.keys(info), ['gemini_chat', 'freeai_chat', 'openrt_chat', 'openai_chat', 'ollama_chat', 'local_chat']);
  assert.deepEqual(info.ollama_chat, section(['ollama-only']));
  assert.deepEqual(info.local_chat, section(['local-only']));
  for (const key of ['gemini_chat', 'freeai_chat', 'openrt_chat', 'openai_chat']) {
    assert.deepEqual(info[key], chatModels[key]);
    assert.equal(Object.keys(info[key].models).length, 74);
  }
  assert.equal(JSON.stringify(chatModels), original);
});

test('Hermes output keys follow Chat/Code section names and openai_oauth sits right after openai_chat', () => {
  const code = Object.fromEntries(HERMES_CODE_PROVIDERS.map(key => [key, section([`${key}-model`])]));
  code.aidiy_hermes = section(['openai_oauth/gpt-6-luna']);
  code.grok_cli = {models:{same:'same (変更なし)', 'grok-4.7':'yyyy/mm/dd - grok-4.7', 'grok-4.6':'yyyy/mm/dd - grok-4.6'}};
  const grokOk = {プロバイダ:'grok', 状態:'OK', code:{grok_cli:{models:{'grok-4.7':'yyyy/mm/dd - grok-4.7'}}}};
  const chat = Object.fromEntries(['gemini_chat', 'freeai_chat', 'openrt_chat', 'openrt_free', 'openai_chat', 'ollama_chat', 'local_chat'].map(key => [key, section([`${key}-model`])]));
  const claude = {プロバイダ:'claude', 状態:'OK', chat:{モデル:[{model_id:'claude-sonnet-5-5', モダリティ:'text->text'}]}};
  assert.deepEqual(Object.keys(hermesModelsInfo({chatModels:chat, codeModels:code, providerInfos:[claude, grokOk]})), [
    'gemini_chat', 'freeai_chat', 'openrt_chat', 'openrt_free', 'openai_chat', 'openai_oauth', 'xai_oauth', 'claude_chat',
    'ollama_chat', 'local_chat', 'claude_cli', 'antigravity_cli', 'codex_cli', 'copilot_cli', 'opencode_cli', 'grok_cli',
  ]);
});

test('CLI lists start with one same entry (no --model, each CLI keeps its last model) and only for sources that exist', () => {
  const info = hermesModelsInfo({codeModels:{
    claude_cli:section(['sonnet']),
    antigravity_cli:{models:{auto:'auto (自動判定)', same:'独自のsame', 'agy-only':'yyyy/mm/dd - agy-only'}},
    grok_cli:{models:{}},
  }});
  assert.deepEqual(info.claude_cli, {models:{same:HERMES_SAME_LABEL, sonnet:label('sonnet')}});
  assert.deepEqual(Object.keys(info.antigravity_cli.models), ['same', 'auto', 'agy-only']);
  assert.equal(info.antigravity_cli.models.same, '独自のsame');
  assert.deepEqual(info.grok_cli, {models:{same:HERMES_SAME_LABEL}});
  assert.equal(info.codex_cli, undefined);
  assert.equal(info.openai_chat, undefined);
});

test('not installed or unreachable providers are left out; local (fixed candidates) stays', () => {
  // Ollama は応答がなく 0 件なら出さない。backend_local の固定候補は常に出す。
  const info = hermesModelsInfo({chatModels:{ollama_chat:{models:{}}, local_chat:section(['google/gemma-4-E2B-it'])}, codeModels:{claude_cli:section(['sonnet'])}});
  assert.equal(info.ollama_chat, undefined);
  assert.deepEqual(info.local_chat, section(['google/gemma-4-E2B-it']));
  // 未導入の CLI（code に区分なし）は出さない。導入済みの区分だけ出す。
  assert.equal(info.grok_cli, undefined);
  assert.equal(info.codex_cli, undefined);
  assert.ok(info.claude_cli);
  assert.equal(hermesModelsInfo({chatModels:{ollama_chat:section(['m'])}}).ollama_chat.models.m !== undefined, true);
});

test('xai_oauth uses the fixed Grok candidates without same, only when the OAuth fetch succeeded', () => {
  const grok = status => ({プロバイダ:'grok', 状態:status, code:{grok_cli:{models:{same:'same (変更なし)', 'grok-4.7':'yyyy/mm/dd - grok-4.7', 'grok-4.6':'yyyy/mm/dd - grok-4.6'}}}});
  const info = hermesModelsInfo({providerInfos:[grok('OK')], codeModels:{grok_cli:grok('OK').code.grok_cli}});
  assert.deepEqual(info.xai_oauth, {models:{'grok-4.7':'yyyy/mm/dd - grok-4.7', 'grok-4.6':'yyyy/mm/dd - grok-4.6'}});
  assert.deepEqual(Object.keys(info.grok_cli.models), ['same', 'grok-4.7', 'grok-4.6']);
  assert.equal(hermesModelsInfo({providerInfos:[grok('PASS')]}).xai_oauth.models['grok-4.7'] !== undefined, true);
  // 取得できていない（NG・未実施・grok 情報なし）なら出さない。CLI 一覧だけあっても出さない。
  for (const state of ['NG', '未実施']) assert.equal(hermesModelsInfo({providerInfos:[grok(state)]}).xai_oauth, undefined, state);
  assert.equal(hermesModelsInfo({codeModels:{grok_cli:grok('OK').code.grok_cli}}).xai_oauth, undefined);
  assert.equal(hermesModelsInfo({codeModels:{claude_cli:section(['sonnet'])}}).xai_oauth, undefined);
  // Grok CLI が未導入（code に grok_cli なし）でも、grok プロバイダの固定候補から出す。
  const fixed = {プロバイダ:'grok', 状態:'OK', code:{grok_cli:{models:{'grok-4.7':'yyyy/mm/dd - grok-4.7'}}}};
  const withoutCli = hermesModelsInfo({providerInfos:[fixed], codeModels:{}});
  assert.deepEqual(withoutCli.xai_oauth, {models:{'grok-4.7':'yyyy/mm/dd - grok-4.7'}});
  assert.equal(withoutCli.grok_cli, undefined);
});

test('Hermes excludes unsupported outputs and modes but retains image input and text output', () => {
  for (const id of ['gemini-image', 'imagen-4', 'nano-banana', 'gpt-audio', 'gpt-realtime', 'gemini-live', 'text-embedding-3', 'tts-1', 'whisper-1', 'gpt-transcribe', 'gpt-search', 'gpt-moderation', 'gpt-computer-use', 'sora-2', 'veo-3', 'lyria-3', 'dialog:batch']) {
    assert.equal(hermesChatModel(id), false, id);
  }
  assert.equal(hermesChatModel('gpt-vision', {モダリティ:'text+image+file->text'}), true);
  assert.equal(hermesChatModel('image-understanding', {モダリティ:'text+image->text'}), true);
  assert.equal(hermesChatModel('multimodal', {モダリティ:'text+image->text+image'}), false);
  assert.equal(hermesChatModel('multimodal', {architecture:{output_modalities:['audio']}}), false);
  assert.equal(hermesChatModel('image-understanding', {output_modalities:['text']}), true);
  assert.equal(hermesChatModel('dialog:batch', {モダリティ:'text->text'}), false);
  assert.equal(hermesChatModel('gemini-image', {モダリティ:'generateContent,countTokens'}), false);
  assert.equal(hermesChatModel('gemini-2.5-pro', {モダリティ:'generateContent,countTokens'}), true);
  assert.equal(hermesChatModel('new-dialog', {モダリティ:'unknown'}), true);
  const info = hermesModelsInfo({chatModels:{openai_chat:section(['image-understanding','multimodal'])}, providerInfos:[{
    プロバイダ:'openai', chat:{モデル:[{model_id:'image-understanding', モダリティ:'text+image->text'}, {model_id:'multimodal', モダリティ:'text->text+image'}]},
  }]});
  assert.deepEqual(info.openai_chat, section(['image-understanding']));
});

test('Claude uses every full API model ID, never SDK/CLI aliases, and stores no provider metadata', () => {
  const ids = ['claude-sonnet-5-5', 'claude-sonnet-4-5-20250929', 'claude-opus-5-5'];
  const claude = {プロバイダ:'claude', 状態:'OK', api_key:'fixture-secret', chat:{モデル:[
    ...ids.map(model_id => ({model_id, 作成日:'2026/10/15', モダリティ:'text+image->text', secret:'fixture-secret'})),
    {model_id:'sonnet'}, {model_id:'claude-image', モダリティ:'text->image'},
  ]}, code:{claude_cli:section(['sonnet','opus'])}};
  const info = hermesModelsInfo({providerInfos:[claude], codeModels:claude.code});
  assert.deepEqual(info.claude_chat, section(ids));
  assert.deepEqual(info.claude_cli, {models:{same:HERMES_SAME_LABEL, ...claude.code.claude_cli.models}});
  assert.deepEqual(Object.keys(info.claude_cli.models), ['same', 'sonnet', 'opus']);
  assert.doesNotMatch(JSON.stringify(info), /fixture-secret|api_key|モダリティ/);
  assert.equal(hermesModelsInfo({providerInfos:[{...claude, 状態:'NG'}]}).claude_chat, undefined);
});

test('CLI sources retain their exact IDs, order, labels and same behavior; OAuth uses only its Code routes', () => {
  assert.deepEqual([...HERMES_CODE_PROVIDERS], ['claude_cli', 'antigravity_cli', 'codex_cli', 'copilot_cli', 'opencode_cli', 'grok_cli']);
  const codeModels = Object.fromEntries(HERMES_CODE_PROVIDERS.map((key, i) => [key, section(['same','auto',`${i}-image`,`openai/custom-${i}`])]));
  codeModels.aidiy_hermes = section(['copilot_cli/same', 'openai_oauth/gpt-6-luna', 'openai_oauth/gpt-realtime']);
  codeModels.aidiy_hermes.models['openai_oauth/gpt-6-luna'] = '仮設定（未検証） - openai_oauth/gpt-6-luna';
  const before = JSON.stringify(codeModels);
  const info = hermesModelsInfo({codeModels, chatModels:{openai_oauth:section(['must-not-be-used'])}});
  for (const key of HERMES_CODE_PROVIDERS) assert.deepEqual(info[key], codeModels[key]);
  assert.deepEqual(info.openai_oauth.models, {
    'gpt-6-luna':'仮設定（未検証） - openai_oauth/gpt-6-luna',
    'gpt-realtime':label('openai_oauth/gpt-realtime'),
  });
  assert.equal(JSON.stringify(codeModels), before);
  assert.deepEqual(hermesModelsInfo(), {});
  assert.deepEqual(hermesModelsInfo({chatModels:{gemini_chat:{models:{bad:42}}}, codeModels:{claude_cli:{models:[]}}}), {});
});

test('shared writer generates Hermes separately while preserving Chat/Code filters, installed state and partial updates', async () => fixture(async (directory, load) => {
  const ids = ['gemini-2.5-flash', 'gemini-3-pro', ...Array.from({length:60}, (_, i) => `chat-${i}`), 'gemini-image', 'gemini-live'];
  const providers = ['gemini','freeai','claude','openai','openai_oauth','grok'].map(provider);
  const results = {
    gemini:success(ids), freeai:success(['gemini-2.5-flash','gemini-3-flash']),
    claude:success(['claude-sonnet-5-5','claude-sonnet-4-5','claude-opus-5-5']),
    openai:success(['gpt-5.6-sol','gpt-6.1-sol','gpt-6-luna','gpt-realtime']),
    openai_oauth:success(['gpt-6-luna']), grok:{状態:'PASS'},
  };
  const installedClis = Object.fromEntries(HERMES_CODE_PROVIDERS.map(key => [key,true]));
  const writeOptions = {...options, directory, installedClis, antigravityModelsReader:async () => ({auto:'auto (自動判定)', same:'same (変更なし)', 'agy-only':'yyyy/mm/dd - agy-only'})};
  const saved = await writeModelsInfo(providers, results, writeOptions);
  assert.equal(saved.filter(file => file === HERMES_MODELS_FILE).length, 1);
  let info = await load('hermes');
  const chat = await load('chat'), code = await load('code');
  assert.equal(chat.claude_chat, undefined);
  assert.deepEqual(Object.keys(chat.gemini_chat.models), ids);
  assert.deepEqual(Object.keys(info.gemini_chat.models), ids.slice(0,-2));
  assert.deepEqual(Object.keys(info.freeai_chat.models), ['gemini-2.5-flash','gemini-3-flash']);
  assert.deepEqual(Object.keys(info.claude_chat.models), ['claude-sonnet-5-5','claude-sonnet-4-5','claude-opus-5-5']);
  assert.deepEqual(Object.keys(code.claude_cli.models), ['sonnet','opus']);
  assert.deepEqual(Object.keys(code.codex_cli.models), ['gpt-6.1-sol','gpt-6-luna']);
  assert.deepEqual(Object.keys(info.openai_chat.models), ['gpt-5.6-sol','gpt-6.1-sol','gpt-6-luna']);
  for (const key of HERMES_CODE_PROVIDERS) {
    assert.deepEqual(info[key], {models:{same:HERMES_SAME_LABEL, ...code[key].models}}, key);
    assert.equal(Object.keys(info[key].models)[0], 'same', key);
  }
  const firstClaude = info.claude_chat;
  await writeModelsInfo([provider('gemini')], {gemini:success(['gemini-updated'])}, {...writeOptions, installedClis:{}});
  info = await load('hermes');
  assert.deepEqual(info.gemini_chat, section(['gemini-updated']));
  assert.deepEqual(info.claude_chat, firstClaude, 'untested saved providers remain available');
  for (const key of HERMES_CODE_PROVIDERS) assert.equal(info[key], undefined, key);
  await writeModelsInfo([provider('claude')], {claude:{状態:'NG'}}, {...writeOptions, installedClis:{}});
  assert.equal((await load('hermes')).claude_chat, undefined);
}));

test('Hermes respects the existing OpenRouter current-key proof and excludes unsupported outputs', async () => fixture(async (directory, load) => {
  const configReader = () => JSON.stringify({openrt_key_id:'fixture-key'});
  const result = await probe('openrt_chat', {reader:configReader, fetch:async () => ({data:{is_free_tier:false}}), cache:{公開状態:'取得済', 公開モデル:{
    'vendor/vision':{作成日:'2026/10/15', モダリティ:'text+image->text'},
    'vendor/image-generator':{作成日:'2026/10/15', モダリティ:'text->text+image'},
  }}});
  await writeModelsInfo([provider('openrt_chat')], {openrt_chat:result}, {...options, directory, configReader});
  assert.deepEqual((await load('hermes')).openrt_chat, section(['vendor/vision']));
  assert.deepEqual(Object.keys((await load('chat')).openrt_chat.models), ['vendor/vision','vendor/image-generator']);
  await writeModelsInfo([provider('openrt_chat')], {openrt_chat:result}, {...options, directory, configReader:() => JSON.stringify({openrt_key_id:'changed-key'})});
  assert.equal((await load('hermes')).openrt_chat, undefined);
}));

test('xai_oauth follows the saved Grok OAuth state like openai_oauth: dropped when not configured or not fetched', async () => fixture(async (directory, load) => {
  const write = (grok, result) => writeModelsInfo([grok], {grok:result}, {...options, directory});
  await write(provider('grok'), {状態:'PASS'});
  assert.deepEqual(Object.keys((await load('hermes')).xai_oauth.models), ['grok-4.7', 'grok-4.6']);
  // ログインなし（設定済みでない）なら出さない。
  await write({...provider('grok'), 設定済み:false}, {状態:'PASS'});
  assert.equal((await load('hermes')).xai_oauth, undefined);
  // 取得に失敗した状態も出さない。ただし Code / CLI 側の固定候補は従来どおり。
  await write(provider('grok'), {状態:'NG'});
  const info = await load('hermes');
  assert.equal(info.xai_oauth, undefined);
  assert.equal((await load('chat')).xai_oauth, undefined);
}));
