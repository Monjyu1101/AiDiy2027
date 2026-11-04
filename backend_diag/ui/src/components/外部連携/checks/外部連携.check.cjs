// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const { render, source } = require('../../../../../checks/ui-components.cjs');
test('外部連携は行ごとの「テスト」で認証を確認し、キー未設定・読込不可は未実施のまま押せない', async () => {
 const data={設定状態:'読込済み',項目:[{id:'openai',名前:'OpenAI'},{id:'huggingface_read',名前:'Hugging Face 読取',設定済み:true,テスト可能:true},{id:'huggingface_write',名前:'Hugging Face 書込',設定済み:null,テスト可能:false,理由:'設定を読み取れません。'},{id:'discord',名前:'Discord Bot',設定済み:false,テスト可能:false,理由:'キーが未設定です。'}]};
 const html=await render('components/外部連携/外部連携パネル.vue',{data,results:{huggingface_read:{状態:'OK'}},connected:true});
 assert.equal((html.match(/class="integration-row"/g)||[]).length,3);
 assert.equal((html.match(/>テスト<\/button>/g)||[]).length,3);
 assert.equal((html.match(/<button\b[^>]*\sdisabled[^>]*>テスト<\/button>/g)||[]).length,2,'キー未設定・読込不可の行は押せない');
 assert.equal((html.match(/data-state="未実施"/g)||[]).length,2);assert.equal((html.match(/data-state="OK"/g)||[]).length,1);
 assert.match(html,/>外部連携確認<\/h2>/);assert.match(html,/id="integration-run"[^>]*>状況確認<\/button>/);assert.match(html,/id="integration-write"[^>]*>書込<\/button>/);assert.doesNotMatch(html,/<button[^>]*disabled[^>]*id="integration-write"|id="integration-write"[^>]*disabled/,'確認結果があれば書込できる');
 assert.match(html,/キーが未設定です/);assert.match(html,/確認不可/);assert.match(html,/未設定/);
 assert.doesNotMatch(html,/OpenAI|class="models"/);
 const panel=source('components/外部連携/外部連携パネル.vue');assert.match(panel,/\$emit\('test',item\.id\)/);assert.doesNotMatch(panel,/v-html|innerHTML/);
});
test('状況確認中は確認中の行へ選択を追従し、終わったら1項目目を表示する', async () => {
 const { createRequire } = require('node:module');
 const { reactive, nextTick } = createRequire(require('node:path').join(__dirname, '../../../../package.json'))('vue');
 const { 外部連携表示を作成 } = await import('../外部連携表示.mjs');
 const props = reactive({ data: { 項目: [{ id: 'huggingface_read' }, { id: 'discord' }] }, results: {}, loading: false, testing: '', busy: false });
 const view = 外部連携表示を作成(props);
 props.testing = 'discord'; await nextTick(); assert.equal(view.selected.value, '', '個別テストはクリックした行の選択に任せる');
 view.selected.value = 'huggingface_read'; props.busy = true; props.loading = true; await nextTick(); props.loading = false; await nextTick(); assert.equal(view.selected.value, 'huggingface_read', '確認中の設定読み直しでは戻らない');
 props.testing = ''; await nextTick(); props.testing = 'discord'; await nextTick(); assert.equal(view.selected.value, 'discord');
 props.testing = ''; props.busy = false; await nextTick(); assert.equal(view.selected.value, 'huggingface_read'); assert.equal(view.row.value.id, 'huggingface_read');
});
test('外部連携の状況確認は設定を読み直してテストできる行だけ確認し、全テストでは読み直さずモデル一覧の結果を残す', async () => {
 const { createRequire } = require('node:module');
 const { ref } = createRequire(require('node:path').join(__dirname, '../../../../package.json'))('vue');
 const { キー設定状態を作成 } = await import('../../キー設定共通/キー設定状態.mjs');
 const 項目 = [{ id: 'openai', テスト可能: true }, { id: 'huggingface_read', テスト可能: true }, { id: 'huggingface_write', テスト可能: false }, { id: 'discord', テスト可能: true }];
 const calls = [];
 const api = async (url, method) => { calls.push(decodeURIComponent(url)); if (url.startsWith('api/キー設定')) return { 設定状態: '読込済み', 項目, 公開モデル: { 状態: '取得済', 件数: 0, 世代: 0 } }; if (url.startsWith('api/キーテスト/')) return { 状態: 'OK' }; return { 件数: 3 }; };
 const state = キー設定状態を作成({ api, connected: ref(true), message: ref('') });
 await state.外部連携確認();
 assert.deepEqual(calls, ['api/キー設定/外部連携', 'api/キーテスト/huggingface_read', 'api/キーテスト/discord']);
 assert.equal(await state.外部連携書込(), true); assert.equal(state.integrationWritten.value, true); assert.equal(calls.at(-1), 'api/外部連携書込');
 calls.length = 0; state.keyResults.value = { ...state.keyResults.value, openai: { 状態: 'OK' } };
 await state.外部連携確認({ 再読込: false });
 assert.deepEqual(calls, ['api/キーテスト/huggingface_read', 'api/キーテスト/discord']); assert.equal(state.keyResults.value.openai.状態, 'OK', 'モデル一覧の結果を残す');
 assert.equal(state.integrationWritten.value, false, '再確認で書込済みを解除');
});
