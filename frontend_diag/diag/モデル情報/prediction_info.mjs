// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 予測用は判断用と同じ候補・認証条件で生成する。実行・設定変更は行わない。
import {decisionsModelsInfo} from './decisions_info.mjs';
import {PREDICTION_CLI_PROVIDERS} from '../モデル試行/defaults.mjs';

// Hermes の固定読取専用アダプターが拒否する外部プロセス経路。
// cli_main の CLI slug と providers/runtime_provider の ACP・AppServer 名に合わせる。
// モデル名だけでは分からない設定由来の transport は、実行時の制約検査を維持する。
export const HERMES_UNSUPPORTED_PREDICTION_ROUTES = Object.freeze([
  'claude_cli', 'claude-code', 'codex_cli', 'codex-cli', 'copilot_cli', 'copilot-cli',
  'antigravity_cli', 'antigravity-cli', 'grok_cli', 'grok-cli', 'opencode_cli', 'opencode',
  'copilot-acp', 'github-copilot-acp', 'codex_app_server',
]);
export function predictionModelSupported(provider, model) {
  return provider !== 'aidiy_hermes' || !HERMES_UNSUPPORTED_PREDICTION_ROUTES.includes(model.split(/[/:]/, 1)[0].trim().toLowerCase());
}

export const PREDICTION_MODELS_FILE = 'prediction_models_info.json';
// 候補の絞り込みは共用し、OpenAI APIの区分だけ実行先のChatAI名に合わせる。
// CLI方式は合成済みのCode候補（導入済みCLIのみ）から auto / same を除いて載せる。
export async function predictionModelsInfo(providers, results, {codeModels = {}, ...options} = {}) {
  const info = await decisionsModelsInfo(providers, results, options);
  const output = Object.fromEntries(Object.entries(info).map(([name, entry]) =>
    [name === 'openai_decisions' ? 'openai_chat' : name, entry]));
  for (const name of PREDICTION_CLI_PROVIDERS) {
    const models = Object.fromEntries(Object.entries(codeModels?.[name]?.models ?? {})
      .filter(([model, label]) => !['auto', 'same'].includes(model) && typeof label === 'string' && predictionModelSupported(name, model)));
    if (Object.keys(models).length) output[name] = {models};
  }
  return output;
}
