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
import { 起動解決, コード起動解決, Pi会話引数, 単独コード名, 会話引数, type 起動設定 } from '../../src/runner';
import { extensionSourceRoot } from '../../src/extension-installation';
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

export const オフラインエンジン = 単独コード名.map(id => ({ id, label: id }));

export function コード既定モデル(provider: string, ...folders: string[]): string {
  const visited = new Set<string>();
  for (const folder of folders) {
    let current = resolve(extensionSourceRoot(folder));
    while (!visited.has(current)) {
      visited.add(current);
      const file = join(current, '_config', 'AiDiy_key.json');
      if (existsSync(file)) {
        let settings;
        try { settings = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
        catch { throw new Error('共通設定 AiDiy_key.json を読み込めません。'); }
        const model = settings[`CODE_${provider.toUpperCase()}_MODEL`];
        return typeof model === 'string' && model.trim() ? model.trim() : 'auto';
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return 'auto';
}

export const Hermes既定モデル = (...folders: string[]) => コード既定モデル('aidiy_hermes', ...folders);
export const オフラインモデル候補 = (...folders: string[]) => 単独モデル候補('aidiy_hermes', ...folders);

// AIコアを使わず、選択したエンジンの aidiy_diag 候補を読む。
export function 単独モデル候補(provider: string, ...folders: string[]) {
  if (!単独コード名.includes(provider)) throw new Error('Hermes または Pi を選択してください。');
  for (const folder of folders) {
    let file: string;
    const root = extensionSourceRoot(folder);
    try { file = 共通ファイル(root, '_AIDIY', 'aidiy_diag', 'code_models_info.json'); }
    catch { continue; }
    let models: unknown;
    try { models = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))[provider]?.models; }
    catch { throw new Error('aidiy_diag のコードモデル情報を読み込めません。aidiy_diag で再保存してください。'); }
    if (models === undefined) return [{id:'same', label:'same (変更なし)'}];
    if (!models || typeof models !== 'object' || Array.isArray(models)
        || Object.values(models).some(label => typeof label !== 'string'))
      throw new Error(`aidiy_diag の ${provider} モデル情報が不正です。aidiy_diag で再保存してください。`);
    return [{id:'same', label:'same (変更なし)'}, ...Object.entries(models)
      .filter(([id]) => !['same', 'auto'].includes(id)).map(([id, label]) => ({id, label:label as string}))];
  }
  return [{id:'same', label:'same (変更なし)'}];
}

export function オフライン選択(saved: { provider: string; model: string } | undefined, ...folders: string[]) {
  const provider = saved && 単独コード名.includes(saved.provider) ? saved.provider : 'aidiy_hermes';
  const models = 単独モデル候補(provider, ...folders);
  const fallback = コード既定モデル(provider, ...folders);
  return { provider, model: saved?.provider === provider && models.some(item => item.id === saved.model)
    ? saved.model : models.some(item => item.id === fallback) ? fallback : 'same' };
}

export function オフライン実行(root: string, project: string, model: string, text: string,
  session: string | undefined, receive: (packet: コードパケット) => void,
  launch?: 起動設定, provider = 'aidiy_hermes') {
  if (!単独コード名.includes(provider)) throw new Error('Hermes または Pi を選択してください。');
  root = extensionSourceRoot(root);
  // 設定済みのaidiy_hermesを優先し、未配置なら同梱のcommand_hermesを使う。
  if (!launch && provider === 'aidiy_pi') launch = コード起動解決(provider, '', project, root);
  if (!launch) {
    try { launch = 起動解決('aidiy_hermes', '', project); }
    catch { launch = 起動解決(共通ファイル(root, 'command_hermes', 'cli_main.py')); }
  }
  const cli = /^(claude_cli|codex_cli|copilot_cli|antigravity_cli|grok_cli|opencode_cli)\/(.+)$/.exec(model);
  const args = cli ? 会話引数(cli[1] === 'claude_cli' ? 'claude-code' : cli[1] === 'opencode_cli' ? 'opencode' : cli[1].replace('_', '-'), cli[2], 999, session) : 会話引数('', model, 999, session);
  return コード要求実行({ セッションID: session || '', チャンネル: 'code1',
    メッセージ識別: 'input_text', メッセージ内容: text }, {
    起動: launch, 作業フォルダ: project, 引数: provider === 'aidiy_pi' ? Pi会話引数(model, session) : args, 制限時間: 1800000,
    出力形式: provider === 'aidiy_pi' ? 'pi-json' : 'text',
  }, receive, session);
}
