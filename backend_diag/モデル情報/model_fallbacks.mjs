// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Copilot の既存定義を共有し、OAuth の仮候補を別のモデル名で複製しない。
export const COPILOT_FALLBACK_MODELS = Object.freeze({
  'claude-fable-5.2':'2026/08/28 - claude-fable-5.2',
  'claude-opus-5.5':'2026/09/21 - claude-opus-5.5',
  'claude-sonnet-5.5':'2026/09/28 - claude-sonnet-5.5',
  'claude-haiku-5.5':'2026/10/07 - claude-haiku-5.5',
  'gpt-6-astra':'2026/08/28 - gpt-6-astra',
  'gpt-6.1-sol':'2026/09/28 - gpt-6.1-sol',
  'gpt-6.1-terra':'yyyy/mm/dd - gpt-6.1-terra',
  'gpt-6-luna':'2026/09/15 - gpt-6-luna',
});
export const OAUTH_FALLBACK_SOURCE = 'Copilot既定OpenAIモデル（未検証）';
export function oauthModelFallback(result) {
  if (result?.id !== 'openai_oauth' || !(result.状態 === 'NG' || (result.状態 === 'OK' && !result.モデル?.length && !result.モデル詳細?.length))) return result;
  const models = Object.keys(COPILOT_FALLBACK_MODELS).filter(id => id.startsWith('gpt-'));
  const warning = '一覧取得失敗のため Copilot 既定の OpenAI 4モデルを仮補完しました。認証・生成可否は未検証です。';
  return {...result, 状態:'PASS', 認証確認:false,
    説明:result.状態 === 'OK' ? 'OAuth の取得モデル一覧が空でした。' : result.説明,
    モデル:models, モデル詳細:models.map(model_id => ({model_id,作成日:null,トークン数:null,モダリティ:null})),
    補完:OAUTH_FALLBACK_SOURCE, 一覧範囲:OAUTH_FALLBACK_SOURCE,
    警告:[warning,...(result.警告 ?? []).filter(value => value !== warning)].slice(0,5)};
}
