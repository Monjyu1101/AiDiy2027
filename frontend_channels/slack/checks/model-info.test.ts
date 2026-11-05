/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

import { authFixture } from './internal-auth-fixture';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { モデル情報取得, APIコード候補, APIコード初期値 } from '../src/モデル情報/モデル情報';

test('AIコアのモデル情報APIからコード候補を取得し、通信・形式エラーはファイル参照へ戻す', async (t) => {
  const fixture = authFixture(); t.after(fixture.cleanup);
  const data = { モデル設定: { CODE_AIDIY_HERMES_MODEL: 'openai_oauth/gpt-x', other: 1 }, available_models: { chat_models: { openai_oauth: { 'gpt-x': 'GPT X', auto: '自動' } }, code_models: { claude_cli: { sonnet: 'Sonnet', same: '同じ' } } } };
  const request: typeof fetch = async (input, options) => {
    assert.equal(String(input), encodeURI('http://127.0.0.1:8091/core/AIコア/モデル情報/取得'));
    assert.deepEqual(JSON.parse(String(options?.body)), { セッションID: '' }); assert.equal(options?.method, 'POST');
    return Response.json({ status: 'OK', data });
  };
  const info = (await モデル情報取得('http://127.0.0.1:8091/', request, fixture.root, {wait: async () => {}}))!;
  assert.deepEqual(info.settings, { CODE_AIDIY_HERMES_MODEL: 'openai_oauth/gpt-x' });
  assert.deepEqual(APIコード候補(info, ''), { providers: [{ id: 'openai_oauth', label: 'OpenAI OAuth' }, { id: 'claude-code', label: 'Claude Code (CLI)' }] });
  assert.deepEqual(APIコード候補(info, 'claude-code'), { models: [{ id: 'same', label: 'same (変更なし)' }, { id: 'sonnet', label: 'Sonnet' }] });
  assert.deepEqual(APIコード候補(info, 'openai_oauth'), { models: [{ id: 'gpt-x', label: 'GPT X' }] });
  assert.deepEqual(APIコード候補(info, 'unknown'), { models: [] });
  assert.deepEqual(APIコード初期値(info, { provider: 'p', model: 'm' }), { provider: 'openai_oauth', model: 'gpt-x' });
  assert.deepEqual(APIコード初期値(undefined, { provider: 'p', model: 'm' }), { provider: 'p', model: 'm' });
  for (const response of [Response.json({ status: 'NG' }), Response.json({ status: 'OK', data: {} }), new Response('', { status: 503 }), Response.json({ status: 'OK', data: { ...data, available_models: {} } })]) {
    assert.equal(await モデル情報取得('http://127.0.0.1:8091/', async () => response, fixture.root, {wait: async () => {}}), undefined);
  }
  assert.equal(await モデル情報取得('http://127.0.0.1:8091/', async () => { throw Error('offline'); }, fixture.root, {wait: async () => {}}), undefined);
});

test('OpenRouterは有料(openrt_chat)と無料(openrt_free)を別のプロバイダとして扱う',()=>{
 const info={settings:{},catalog:{models:{},voices:{}},chat:{openrt_chat:{'vendor/paid':'Paid'},openrt_free:{'vendor/new:free':'Free'}},code:{}} as Parameters<typeof APIコード候補>[0];
 assert.deepEqual(APIコード候補(info,''),{providers:[{id:'openrt_chat',label:'OpenRouter'},{id:'openrt_free',label:'OpenRouter Free'}]});
 assert.deepEqual(APIコード候補(info,'openrt_chat'),{models:[{id:'vendor/paid',label:'Paid'}]});
 assert.deepEqual(APIコード候補(info,'openrt_free'),{models:[{id:'vendor/new:free',label:'Free'}]});
 assert.deepEqual(APIコード候補(info,'openrt'),{models:[]});
});

test('Ollamaも本体と同じ ollama_chat で扱い、旧名 ollama は受け付けない',()=>{
 const info={settings:{},catalog:{models:{},voices:{}},chat:{ollama_chat:{'gpt-oss:20b':'Small'}},code:{}} as Parameters<typeof APIコード候補>[0];
 assert.deepEqual(APIコード候補(info,''),{providers:[{id:'ollama_chat',label:'Ollama'}]});
 assert.deepEqual(APIコード候補(info,'ollama_chat'),{models:[{id:'gpt-oss:20b',label:'Small'}]});
 assert.deepEqual(APIコード候補(info,'ollama'),{models:[]});
});
