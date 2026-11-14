// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// aidiy_codex（command_codex をコンパイルした ~/.aidiy/bin/aidiy_codex）用のモデル一覧。
// Pi 一覧（pi_info.mjs）と同じ入力・同じ区分名で作り、chat モデルの区分だけを残す。
// Hermes / Pi と違い、外部 Code CLI（*_cli）への委譲区分は使わない。
// この一覧が aidiy_codex の候補の正本（Code / 入力予測 / Navi の aidiy_codex 区分もここから作る）。
// 区分ごとの接続は aidiy_codex 本体（codex-rs/core/src/config/aidiy_model.rs）が Hermes / Pi に合わせて行う。
import {access} from 'node:fs/promises';
import {piModelsInfo} from './pi_info.mjs';
import {codexBinaries} from '../導入管理/codex_compile.mjs';

// npm 版 codex（codex_cli）・code_models_info.json と区別するため、AiDiy の名前で保存する。
export const CODEX_MODELS_FILE = 'aidiy_codex_models_info.json';
// code_models_info.json の区分名。コンパイル済み（~/.aidiy/bin/aidiy_codex がある）のときだけ Code 選択に加える。
export const CODEX_CODE_PROVIDER = 'aidiy_codex';
// 候補の先頭に置く区分（aidiy_codex の既定の接続先）。
export const CODEX_SUPPORTED_SECTION = 'openai_oauth';
// OAuth の候補が無いときの仮候補。
export const CODEX_PROVISIONAL_MODELS = Object.freeze({auto:'仮設定（未検証） - auto'});

// 外部 Code CLI への委譲区分（claude_cli / codex_cli / copilot_cli 等）。
export const isCliSection = section => /_cli$/.test(section);

// 入力は Hermes / Pi と同じ合成結果のみ。API 呼出・設定読取・キー保存は行わない。
export function codexModelsInfo(input = {}) {
  return Object.fromEntries(Object.entries(piModelsInfo(input)).filter(([section]) => !isCliSection(section)));
}

// aidiy_codex_models_info.json（codexModelsInfo の結果）を Code の候補 `<区分>/<モデル名>` にする。
// これが aidiy_codex の候補の正本。既定の接続先 openai_oauth を先頭に置く。
export function codexCodeModels(info = {}) {
  const sections = Object.keys(info).sort((a, b) => (b === CODEX_SUPPORTED_SECTION) - (a === CODEX_SUPPORTED_SECTION));
  const models = {};
  for (const section of sections) {
    for (const [id, label] of Object.entries(info[section]?.models ?? {})) {
      if (!id || ['auto', 'same'].includes(id) || typeof label !== 'string') continue;
      models[`${section}/${id}`] = label;
    }
  }
  return Object.keys(models).length ? models : {...CODEX_PROVISIONAL_MODELS};
}

// command_codex/_compile.py が配置した aidiy_codex(.exe) があるか。CLI は実行しない（未コンパイルなら無効）。
export async function codexInstalled({binaries = codexBinaries} = {}) {
  for (const file of binaries()) {
    try { await access(file); return true; } catch { /* 次の候補 */ }
  }
  return false;
}
