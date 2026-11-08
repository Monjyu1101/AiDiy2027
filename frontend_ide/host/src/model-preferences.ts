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

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { programDataDirectory } from '../scripts/project-storage.cjs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type CodeModel = { provider: string; model: string };
export type LiveModel = Record<string, string>;
import { LIVE_KEYS } from '../aidiy_live/src/model-catalog';
export { LIVE_KEYS };

export function モデル保存先(kind: 'code' | 'live', project: string, aidiyRoot?: string) {
  return join(programDataDirectory(project, `aidiy_${kind}`, aidiyRoot), `aidiy_${kind}_model.json`);
}
function コード設定(value: unknown): CodeModel {
  const data = value as CodeModel;
  if (!data || typeof data.provider !== 'string' || typeof data.model !== 'string'
      || data.provider.length > 200 || data.model.length > 300 || data.model === '__manual__')
    throw new Error('モデル指定が不正です。');
  return { provider: data.provider.trim(), model: data.provider.trim() ? data.model.trim() : '' };
}
function ライブ設定(value: unknown): LiveModel {
  const data = value as LiveModel, key = data && LIVE_KEYS[data.LIVE_AI_NAME];
  if (!key || Object.keys(data).some(name => !['LIVE_AI_NAME', key.model, key.voice].includes(name))
      || typeof data[key.model] !== 'string' || !data[key.model].trim() || data[key.model].length > 300
      || (data[key.voice] !== undefined && (typeof data[key.voice] !== 'string' || data[key.voice].length > 100)))
    throw new Error('ライブモデル指定が不正です。');
  return { LIVE_AI_NAME: data.LIVE_AI_NAME, [key.model]: data[key.model].trim(),
    ...(data[key.voice]?.trim() ? { [key.voice]: data[key.voice].trim() } : {}) };
}
function 読込<T>(file: string, validate: (value: unknown) => T): T | undefined {
  try { return validate(JSON.parse(readFileSync(file, 'utf8'))); }
  catch { return undefined; } // 未保存・破損時は既定設定を使う。
}
function 保存<T>(file: string, value: unknown, validate: (value: unknown) => T) {
  if (!file) throw new Error('作業フォルダを選択してください。');
  const settings = validate(value);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
  return settings;
}
export const コードモデル読込 = (file: string) => 読込(file, コード設定);
export const コードモデル保存 = (value: unknown, file: string) => 保存(file, value, コード設定);
export const ライブモデル読込 = (file: string) => 読込(file, ライブ設定);
export const ライブモデル保存 = (value: unknown, file: string) => 保存(file, value, ライブ設定);

// Code のオンラインの検証回数（0〜3回）。最後に選んだ回数を次回も使う。オフラインの0回固定は保存しない。
// 保存先はモデルの保存先から決め（aidiy_code_model.json → aidiy_code_options.json）、拡張と単独起動版で共用する。
export const コード設定保存先 = (modelFile: string) => modelFile.replace(/(_model)?\.json$/i, '_options.json');
function コード設定値(value: unknown): { 検証回数: number } {
  const count = (value as { 検証回数?: unknown } | null)?.検証回数;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 3) throw new Error('検証回数の指定が不正です。');
  return { 検証回数: count };
}
export const 検証回数読込 = (file: string) => 読込(file, コード設定値)?.検証回数;
export const 検証回数保存 = (count: unknown, file: string) => 保存(file, { 検証回数: count }, コード設定値).検証回数;
