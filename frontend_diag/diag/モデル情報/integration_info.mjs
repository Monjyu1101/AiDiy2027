// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 外部連携（Hugging Face / Discord / Slack）の認証確認結果を _AIDIY/aidiy_diag/ へ保存する。キー値・応答本文は含めない。
import path from 'node:path';
import { OUTPUT_DIRECTORY, writeResult } from '../診断/headless.mjs';
import { KEY_PROVIDERS, INTEGRATION_PROBES } from '../../runtime/model_probe.mjs';

export const INTEGRATION_FILE = 'integration_info.json';
export const INTEGRATION_IDS = Object.freeze(KEY_PROVIDERS.filter(provider => INTEGRATION_PROBES.includes(provider.probe)).map(provider => provider.id));
const STATES = ['OK', 'PASS', 'NG', '未実施'];
const text = (value, limit = 1000) => typeof value === 'string' ? value.slice(0, limit) : '';

// 設定状況の全行を登録順に保存する。確認していない行は未実施と理由を残す。
export function integrationReport(rows, results, now = new Date()) {
  const items = INTEGRATION_IDS.map(id => {
    const row = rows.find(item => item?.id === id) || {}, result = results[id];
    const tested = result && STATES.includes(result.状態);
    return {id, 名前:text(row.名前, 100), キー名:text(row.キー名, 100), 設定済み:typeof row.設定済み === 'boolean' ? row.設定済み : null,
      状態:tested ? result.状態 : '未実施', 説明:tested ? text(result.説明) : text(row.理由) || '未実施です。',
      確認日時:tested && typeof result.確認日時 === 'string' && Number.isFinite(Date.parse(result.確認日時)) ? result.確認日時 : null};
  });
  const 集計 = Object.fromEntries(STATES.map(state => [state, items.filter(item => item.状態 === state).length]).filter(([, count]) => count));
  return {形式:1, 種類:'外部連携', 保存日時:now.toISOString(), 件数:items.length, 集計, 項目:items};
}

export async function writeIntegrationInfo(rows, results, directory = OUTPUT_DIRECTORY) {
  const report = integrationReport(rows, results);
  await writeResult(path.join(directory, INTEGRATION_FILE), report);
  return report;
}
