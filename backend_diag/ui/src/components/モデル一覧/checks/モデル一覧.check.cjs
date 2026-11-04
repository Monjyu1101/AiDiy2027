// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { reactive } = createRequire(path.join(__dirname, '../../../../package.json'))('vue');
const { render } = require('../../../../../checks/ui-components.cjs');
test('確認不要（Azure・GitHub Copilot）以外の登録キーを重複なく2画面へ分類し、各群の設定順を保持する', async () => {
 const { KEY_PROVIDERS } = await import('../../../../../モデル情報/key_status.mjs');
 const { モデル一覧表示を作成 } = await import('../モデル一覧表示.mjs');
 const { 外部連携表示を作成 } = await import('../../外部連携/外部連携表示.mjs');
 const props = reactive({ data: { 項目: KEY_PROVIDERS }, results: {} });
 const model = モデル一覧表示を作成(props), external = 外部連携表示を作成(props);
 assert.deepEqual(model.items.value.map(x=>x.id),['gemini','freeai','claude','openai','openai_oauth','grok','openrt','ollama','local']);
 assert.deepEqual(external.items.value.map(x=>x.id),['huggingface_read','huggingface_write','discord','slack']);
 assert.equal(new Set([...model.items.value,...external.items.value].map(x=>x.id)).size,KEY_PROVIDERS.length-2);
 // 秘匿対象とサーバーの登録には残す。
 assert.ok(KEY_PROVIDERS.some(x=>x.id==='azure')&&KEY_PROVIDERS.some(x=>x.id==='copilot'));
 model.selected.value='openai';external.selected.value='discord';props.data=null;
 assert.equal(model.row.value,undefined); assert.equal(model.selected.value,'openai');
 props.data={項目:KEY_PROVIDERS};props.results={openai:{状態:'OK',モデル:['example']}};
 assert.equal(model.row.value.id,'openai');assert.equal(model.result.value.状態,'OK');assert.equal(external.row.value.id,'discord');
 const html=await render('components/モデル一覧/モデル一覧パネル.vue',{...props,connected:true});
 assert.match(html,/OpenAI/);assert.doesNotMatch(html,/Discord|Slack|Hugging Face|Azure|GitHub Copilot/);
});
test('テスト後は確認内容の「接続は未確認」を接続確認済みの表現へ置き換える', async () => {
 const { モデル一覧表示を作成 } = await import('../モデル一覧表示.mjs');
 const props = reactive({ data: { 項目: [{ id: 'gemini', 名前: 'Gemini', 説明: '設定有無のみ。接続は未確認です。' }] }, results: {} });
 const model = モデル一覧表示を作成(props); model.selected.value = 'gemini';
 assert.equal(model.確認内容.value, '設定有無のみ。接続は未確認です。');
 props.results = { gemini: { 状態: 'OK' } }; assert.equal(model.確認内容.value, '設定有無のみ。接続はテストで確認しました（結果は「テスト」欄）。');
 props.results = { gemini: { 状態: 'NG' } }; assert.match(model.確認内容.value, /接続はテストで確認しました/);
 props.results = { gemini: { 状態: '未実施' } }; assert.equal(model.確認内容.value, '設定有無のみ。接続は未確認です。');
});
test('一覧再取得の完了後は1項目目を表示する', async () => {
 const { モデル一覧表示を作成 } = await import('../モデル一覧表示.mjs');
 const { nextTick } = createRequire(path.join(__dirname, '../../../../package.json'))('vue');
 const props = reactive({ data: { 項目: [{ id: 'gemini' }, { id: 'claude' }] }, results: {}, testing: '', latestBusy: false });
 const model = モデル一覧表示を作成(props);
 props.latestBusy = true; props.testing = 'claude'; await nextTick(); assert.equal(model.selected.value, 'claude');
 props.testing = ''; props.latestBusy = false; await nextTick(); assert.equal(model.selected.value, 'gemini'); assert.equal(model.row.value.id, 'gemini');
});
