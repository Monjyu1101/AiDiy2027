// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Pi（command_pi / aidiy_pi）専用のモデル一覧。基本は Hermes 一覧（hermes_info.mjs）と同じ。
// 外部 Code CLI は AiDiy 共通実行基盤へ委譲するため、Hermes と同じ区分を使う。
import {access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hermesModelsInfo} from './hermes_info.mjs';

export const PI_MODELS_FILE = 'pi_models_info.json';
// code_models_info.json の区分名。Diag の Code 試行・AIコアの CODE 選択で使う。
export const PI_CODE_PROVIDER = 'aidiy_pi';
// Pi の OAuth（/login）で使える候補が無いときの仮候補。
export const PI_PROVISIONAL_MODELS = Object.freeze({auto:'仮設定（未検証） - auto'});

// 旧一覧に残る廃止済みの別名は候補へ戻さない。Hermesも標準モデル名を使う。
export const piModels = models => Object.fromEntries(Object.entries(models).filter(([id]) => !/-900k$/i.test(id)));

// 入力は Hermes と同じ合成結果のみ。API 呼出・設定読取・キー保存は行わない。
export function piModelsInfo(input = {}) {
  const info = hermesModelsInfo(input);
  for (const [provider, entry] of Object.entries(info)) {
    const models = piModels(entry.models);
    if (Object.keys(models).length) info[provider] = {models};
    else delete info[provider];
  }
  return info;
}

// command_pi の setup 済み（依存・生成モデルデータ・起動入口がある）かを確認する。CLI は実行しない。
export async function piInstalled({root = fileURLToPath(new URL('../../../', import.meta.url))} = {}) {
  const pi = path.join(root, 'command_pi');
  try {
    await Promise.all([
      path.join(pi, 'node_modules'),
      path.join(pi, 'packages', 'ai', 'src', 'providers', 'data'),
      path.join(pi, 'packages', 'coding-agent', 'src', 'cli.ts'),
      path.join(pi, 'aidiy', 'aidiy_pi.ts'),
    ].map(file => access(file)));
    return true;
  } catch {
    return false;
  }
}
