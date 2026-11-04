// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const {render} = require('../../../../../checks/ui-components.cjs');

test('AI model test explains auto provider priorities only in Prediction and Decision', async () => {
  const {AIモデル状態を作成} = await import('../AIモデル状態.mjs');
  const state = AIモデル状態を作成({接続可能: () => false, api: async () => {throw new Error('Rendering must not make requests');}});
  const orders = {
    PREDICTION: 'codex_cli → copilot_cli → aidiy_hermes → openai_oauth → freeai_chat → openai_chat → gemini_chat',
    DECISION: 'openai_oauth → freeai_chat → openai_decisions → gemini_chat',
  };
  try {
    for (const family of ['CHAT', 'LIVE', 'PREDICTION', 'DECISION', 'CODE']) {
      state.区分変更(family);
      const html = await render('components/AIモデル/AIモデルパネル.vue', {state, online: false, visible: true});
      assert.ok(html.includes(`<h3>${family} / ${family === 'PREDICTION' ? '入力予測' : '入力'}</h3>`));
      if (orders[family]) {
        assert.ok(html.includes(`プロバイダ選択優先順（auto）: ${orders[family]}`));
        assert.ok(html.includes('使えるプロバイダ'));
        assert.ok(html.includes(`${family}_AI_NAMEの設定を優先し、設定もautoの場合`));
        assert.ok(html.indexOf('aria-label="プロバイダ"') < html.indexOf('プロバイダ選択優先順'));
        assert.ok(html.indexOf('プロバイダ選択優先順') < html.indexOf('aria-label="モデル"'));
      } else {
        assert.ok(!html.includes('プロバイダ選択優先順'));
      }
    }
  } finally {state.終了();}
});
