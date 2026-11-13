// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Hermes /model 専用。Chat / Code の既存候補・絞り込みを変更せず、用途に合う一覧を別に保存する。
export const HERMES_MODELS_FILE = 'hermes_models_info.json';

// 出力のキーは Chat / Code 一覧と同じ区分名（chat_models_info.json / code_models_info.json）。
const CHAT_PROVIDERS = Object.freeze(['gemini_chat', 'freeai_chat', 'openrt_chat', 'openrt_free', 'openai_chat']);
// Claude の次に置く、API キー不要・ローカルの Chat。Chat 一覧の同名区分をそのまま使う。
const LOCAL_CHAT_PROVIDERS = Object.freeze(['ollama_chat', 'local_chat']);
// CLI は same（モデル指定なし）を先頭に置く。--model を付けず、各 CLI が最後に使ったモデルで動く。
export const HERMES_SAME_LABEL = 'same (変更なし)';
export const HERMES_CODE_PROVIDERS = Object.freeze(['claude_cli', 'antigravity_cli', 'codex_cli', 'copilot_cli', 'opencode_cli', 'grok_cli']);
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
  for (const provider of CHAT_PROVIDERS) {
    // 詳細は Diag のプロバイダ ID（gemini / freeai / openai / openrt_chat）の取得結果から引く。OpenRouter の無料は有料と同じ詳細を使う。
    const metadata = details(infos.get({gemini_chat:'gemini', freeai_chat:'freeai', openai_chat:'openai', openrt_free:'openrt_chat'}[provider] ?? provider));
    add(provider, modelEntries(chatModels[provider]).filter(([id]) => hermesChatModel(id, metadata.get(id))));
  }
  // OAuth は既存 Code の Hermes 経路を使用し、実行 ID の接頭辞だけを外す。仮設定ラベルも維持する。
  const oauthPrefix = 'openai_oauth/';
  add('openai_oauth', modelEntries(codeModels.aidiy_hermes)
    .filter(([id]) => id.startsWith(oauthPrefix) && id.length > oauthPrefix.length)
    .map(([id, label]) => [id.slice(oauthPrefix.length), label]));
  // xAI OAuth（SuperGrok）は Grok の固定候補を使う。上流 Hermes の固定リストは使わない。
  // OAuth の取得に成功した（grok プロバイダが OK / PASS の）ときだけ出す。Grok CLI の導入有無には左右されない。CLI ではないので same は付けない。
  const grok = infos.get('grok');
  if (['OK', 'PASS'].includes(grok?.状態)) {
    add('xai_oauth', modelEntries(grok.code?.grok_cli).filter(([id]) => id !== 'same' && id !== 'auto'));
  }
  // Claude の chat 区分は作らず、API 取得詳細から日付付きの完全なモデル ID を使う。
  const claude = infos.get('claude');
  if (claude?.状態 === 'OK') {
    add('claude_chat', [...details(claude)].filter(([id, detail]) => /^claude-/i.test(id) && hermesChatModel(id, detail))
      .map(([id, detail]) => [id, `${/^\d{4}\/\d{2}\/\d{2}$/.test(detail.作成日) ? detail.作成日 : 'yyyy/mm/dd'} - ${id}`]));
  }
  for (const provider of LOCAL_CHAT_PROVIDERS) {
    const metadata = details(infos.get({ollama_chat:'ollama', local_chat:'local'}[provider]));
    add(provider, modelEntries(chatModels[provider]).filter(([id]) => hermesChatModel(id, metadata.get(id))));
  }
  for (const provider of HERMES_CODE_PROVIDERS) {
    if (!record(codeModels[provider]?.models)) continue;
    const entries = modelEntries(codeModels[provider]);
    const same = entries.find(([id]) => id === 'same') ?? ['same', HERMES_SAME_LABEL];
    add(provider, [same, ...entries.filter(([id]) => id !== 'same')]);
  }
  return result;
}
