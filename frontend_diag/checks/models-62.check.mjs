import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CODEX_MODELS, OAUTH_FALLBACK_MODELS, finalizeCodexModels} from '../runtime/model_catalog.mjs';
import {COPILOT_FALLBACK_MODELS} from '../diag/モデル情報/model_fallbacks.mjs';
test('latest fixed fallback IDs use 6.2 without fabricating release dates', () => {
 for (const ids of [DEFAULT_CODEX_MODELS,OAUTH_FALLBACK_MODELS,Object.keys(COPILOT_FALLBACK_MODELS)]) {
  assert.ok(ids.includes('gpt-6.2-astra')); assert.ok(ids.includes('gpt-6.2-sol'));
  assert.ok(!ids.includes('gpt-6-astra')); assert.ok(!ids.includes('gpt-6.1-sol'));
 }
 assert.equal(COPILOT_FALLBACK_MODELS['gpt-6.2-astra'],'yyyy/mm/dd - gpt-6.2-astra');
 assert.equal(COPILOT_FALLBACK_MODELS['gpt-6.2-sol'],'yyyy/mm/dd - gpt-6.2-sol');
});
test('discovered legacy IDs remain usable while new candidates are supplemented', () => {
 const ids=finalizeCodexModels(['gpt-6-astra','gpt-6.1-sol']);
 for(const id of ['gpt-6-astra','gpt-6.1-sol','gpt-6.2-astra','gpt-6.2-sol']) assert.ok(ids.includes(id));
});
