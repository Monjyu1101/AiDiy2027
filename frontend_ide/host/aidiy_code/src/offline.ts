/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { 起動解決, 会話引数, type 起動設定 } from '../../src/runner';
import { コード要求実行, type コードパケット } from '../../src/protocol';

export const オフラインモデル保存先 = (onlineFile: string) => onlineFile.replace(/\.json$/i, '') + '_offline.json';

// IDE内の配置階層や拡張配置先に依存せず、共通ランチャーを親方向へ探す。
function 共通ファイル(root: string, ...parts: string[]) {
  let current = resolve(root);
  while (true) {
    const file = join(current, ...parts);
    if (existsSync(file)) return file;
    const parent = dirname(current);
    if (parent === current) throw new Error(`共通ファイルがありません: ${parts.join('/')}`);
    current = parent;
  }
}

export function Hermes既定モデル(...folders: string[]): string {
  const visited = new Set<string>();
  for (const folder of folders) {
    let current = resolve(folder);
    while (!visited.has(current)) {
      visited.add(current);
      const file = join(current, '_config', 'AiDiy_key.json');
      if (existsSync(file)) {
        let settings;
        try { settings = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
        catch { throw new Error('共通設定 AiDiy_key.json を読み込めません。'); }
        const model = settings.CODE_AIDIY_HERMES_MODEL;
        return typeof model === 'string' && model.trim() ? model.trim() : 'auto';
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return 'auto';
}

// AIコアを使わず、aidiy_diag の Hermes 候補だけを読む。
export function オフラインモデル候補(...folders: string[]) {
  for (const folder of folders) {
    let file: string;
    try { file = 共通ファイル(folder, '_AIDIY', 'aidiy_diag', 'code_models_info.json'); }
    catch { continue; }
    let models: unknown;
    try { models = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).aidiy_hermes?.models; }
    catch { throw new Error('aidiy_diag のコードモデル情報を読み込めません。aidiy_diag で再保存してください。'); }
    if (!models || typeof models !== 'object' || Array.isArray(models)
        || Object.values(models).some(label => typeof label !== 'string'))
      throw new Error('aidiy_diag の Hermes モデル情報が不正です。aidiy_diag で再保存してください。');
    return [{id:'same', label:'same (変更なし)'}, ...Object.entries(models)
      .filter(([id]) => !['same', 'auto'].includes(id)).map(([id, label]) => ({id, label:label as string}))];
  }
  return [{id:'same', label:'same (変更なし)'}];
}

export function オフライン実行(root: string, project: string, model: string, text: string,
  session: string | undefined, receive: (packet: コードパケット) => void,
  launch?: 起動設定) {
  // 設定済みのaidiy_hermesを優先し、未配置なら同梱のcommand_hermesを使う。
  if (!launch) {
    try { launch = 起動解決('aidiy_hermes', '', project); }
    catch { launch = 起動解決(共通ファイル(root, 'command_hermes', 'cli_main.py')); }
  }
  const cli = /^(claude_cli|codex_cli|copilot_cli|antigravity_cli|grok_cli|opencode_cli)\/(.+)$/.exec(model);
  const args = cli ? 会話引数(cli[1] === 'claude_cli' ? 'claude-code' : cli[1] === 'opencode_cli' ? 'opencode' : cli[1].replace('_', '-'), cli[2], 999, session) : 会話引数('', model, 999, session);
  return コード要求実行({ セッションID: session || '', チャンネル: 'code1',
    メッセージ識別: 'input_text', メッセージ内容: text }, {
    起動: launch, 作業フォルダ: project, 引数: args, 制限時間: 1800000,
  }, receive, session);
}
