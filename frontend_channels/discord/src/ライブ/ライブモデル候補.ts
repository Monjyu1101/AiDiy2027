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
import { join } from 'node:path';
import type { LiveCatalog } from '../../../../frontend_ide/host/aidiy_live/src/model-catalog';
import { プロジェクトルート, 設定エラー } from '../接続/接続設定';

export function ライブ候補読込(directory = join(プロジェクトルート, '_config')): LiveCatalog {
  const read = (field: 'models' | 'voices') => {
    const name = `live_${field}_info.json`;
    const file = join(directory, '..', '_AIDIY', 'aidiy_diag', name);
    if (!existsSync(file)) return {};
    try {
      const data = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      return Object.fromEntries(Object.entries(data).map(([key, value]) => {
        const values = (value as Record<string, unknown> | null)?.[field];
        if (!values || typeof values !== 'object' || Array.isArray(values)
            || Object.entries(values).some(([id, label]) => !id.trim() || typeof label !== 'string')) throw new Error();
        return [key, values as Record<string, string>];
      }));
    } catch { throw new 設定エラー(`${name} を読み込めません。aidiy_diag --headless で再生成してください。`); }
  };
  return { models: read('models'), voices: read('voices') };
}

// 共通設定だけを候補へ合わせる。手動保存した選択は呼出側で後から重ねて検証する。
export function ライブ初期値(settings: Record<string, string>, catalog: LiveCatalog) {
  const result = {...settings};
  const providers = Object.keys(catalog.models).filter(key => Object.keys(catalog.models[key]).length);
  if (providers.length && !providers.includes(result.LIVE_AI_NAME)) result.LIVE_AI_NAME = providers[0];
  for (const provider of providers) {
    const vendor = provider.replace(/_live$/, '').toUpperCase();
    const modelKey = `LIVE_${vendor}_MODEL`, voiceKey = `LIVE_${vendor}_VOICE`;
    if (!Object.hasOwn(catalog.models[provider], result[modelKey] || '')) result[modelKey] = Object.keys(catalog.models[provider])[0];
    const voices = catalog.voices[provider] || {};
    if (Object.keys(voices).length && !Object.hasOwn(voices, result[voiceKey] || '')) result[voiceKey] = Object.keys(voices)[0];
  }
  return result;
}
