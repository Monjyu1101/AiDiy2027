// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Hermes /model 専用。Chat / Code の既存候補・絞り込みを変更せず、用途に合う一覧を別に保存する。
export const HERMES_MODELS_FILE = 'hermes_models_info.json';

const CHAT_PROVIDERS = Object.freeze({gemini:'gemini_chat', freeai:'freeai_chat', openrt:'openrt_chat', openrt_free:'openrt_free', openai_chat:'openai_chat'});
export const HERMES_CODE_PROVIDERS = Object.freeze({
  'claude-code':'claude_cli', 'antigravity-cli':'antigravity_cli', 'codex-cli':'codex_cli',
  'copilot-cli':'copilot_cli', opencode:'opencode_cli', 'grok-cli':'grok_cli',
});
// command_hermes/cli_main.py の非対話モデル判定と同じ。画像入力・テキスト出力は許可する。
const NON_CHAT_MODEL = /image|imagen|nano-banana|realtime|audio|transcribe|tts|whisper|embed|moderation|search|translate|computer-use|dall-e|sora|veo|lyria|aqa|robotics|deep-research|antigravity|davinci|babbage|(?:^|[-/])live(?:-|$)|:batch$/i;
// 出力モダリティが text でも、専用の実行方式を必要とするモデルは対象外。
const UNSUPPORTED_MODE = /realtime|audio|transcribe|tts|whisper|embed|moderation|search|translate|computer-use|sora|veo|lyria|aqa|robotics|deep-research|antigravity|davinci|babbage|(?:^|[-/])live(?:-|$)|:batch$/i;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const modelEntries = entry => record(entry?.models) ? Object.entries(entry.models).filter(([id, label]) => id.trim() && typeof label === 'string') : [];

function outputModalities(detail) {
  const outputs = detail?.output_modalities ?? detail?.architecture?.output_modalities;
  if (Array.isArray(outputs) && outputs.length && outputs.every(value => typeof value === 'string' && value.trim())) {
    return outputs.map(value => value.trim().toLowerCase());
  }
  const modality = detail?.モダリティ ?? detail?.architecture?.modality;
  if (typeof modality !== 'string') return null;
  const parts = modality.toLowerCase().split(/->|→/);
  if (parts.length !== 2 || !parts[1].trim()) return null;
  return parts[1].split(/[+,/\s]+/).filter(Boolean);
}

export function hermesChatModel(id, detail) {
  if (UNSUPPORTED_MODE.test(id)) return false;
  const outputs = outputModalities(detail);
  if (outputs && !outputs.includes('unknown')) return outputs.every(value => value === 'text');
  return !NON_CHAT_MODEL.test(id);
}

// 入力は保存に使った合成結果のみ。API 呼出・設定読取・キー保存は行わない。
// CLI は既存 Code の導入判定、family 絞り込み、表示名、auto/same をそのまま維持する。
export function hermesModelsInfo({chatModels = {}, codeModels = {}, providerInfos = []} = {}) {
  const result = {};
  const infos = new Map(providerInfos.filter(record).map(info => [info.プロバイダ, info]));
  const details = info => new Map((Array.isArray(info?.chat?.モデル) ? info.chat.モデル : [])
    .filter(row => record(row) && typeof row.model_id === 'string').map(row => [row.model_id, row]));
  const add = (provider, entries) => { if (entries.length) result[provider] = {models:Object.fromEntries(entries)}; };
  for (const [provider, key] of Object.entries(CHAT_PROVIDERS)) {
    const metadata = details(infos.get(provider === 'openai_chat' ? 'openai' : provider === 'openrt_free' ? 'openrt' : provider));
    add(provider, modelEntries(chatModels[key]).filter(([id]) => hermesChatModel(id, metadata.get(id))));
  }
  // Claude の chat 区分は作らず、API 取得詳細から日付付きの完全なモデル ID を使う。
  const claude = infos.get('claude');
  if (claude?.状態 === 'OK') {
    add('claude_chat', [...details(claude)].filter(([id, detail]) => /^claude-/i.test(id) && hermesChatModel(id, detail))
      .map(([id, detail]) => [id, `${/^\d{4}\/\d{2}\/\d{2}$/.test(detail.作成日) ? detail.作成日 : 'yyyy/mm/dd'} - ${id}`]));
  }
  // OAuth は既存 Code の Hermes 経路を使用し、実行 ID の接頭辞だけを外す。仮設定ラベルも維持する。
  const oauthPrefix = 'openai_oauth/';
  add('openai_oauth', modelEntries(codeModels.aidiy_hermes)
    .filter(([id]) => id.startsWith(oauthPrefix) && id.length > oauthPrefix.length)
    .map(([id, label]) => [id.slice(oauthPrefix.length), label]));
  for (const [provider, key] of Object.entries(HERMES_CODE_PROVIDERS)) add(provider, modelEntries(codeModels[key]));
  return result;
}
