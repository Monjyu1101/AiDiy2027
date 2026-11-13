// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// --headless: 画面を開かず全診断をコマンドラインで最速実行し、結果を _AIDIY/aidiy_diag/ へ保存する。
// 画面の「書込」も同じ形式・同じ保存処理を使う。
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { catalog, probe, scan, cancelProbes } from './probes.mjs';
import { getKeyStatus, testKey, cancelKeyProbes } from '../モデル情報/key_status.mjs';
import { createPublicModelCache } from '../モデル情報/public_models.mjs';
import { MODEL_PROVIDER_IDS, writeModelsInfo } from '../モデル情報/models_info.mjs';

export const OUTPUT_DIRECTORY = fileURLToPath(new URL('../../../_AIDIY/aidiy_diag/', import.meta.url));
export const INSTALL_FILE = 'install_info.json';
const STATES = ['OK', '注意', '未確認', '未検出', 'NG', 'ERR'];

function cancelled() { return Object.assign(new Error('Headless diagnostics cancelled'), {diagCode:'CANCELLED'}); }

// 一時ファイルへ書いてから置き換える。途中で失敗しても既存の結果ファイルは壊さない。
export async function writeResult(file, value) {
  await mkdir(path.dirname(file), {recursive:true});
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await rename(temporary, file);
  } catch (error) { await rm(temporary, {force:true}).catch(() => {}); throw error; }
}

// 全項目の確認結果がカタログ順にそろっている場合だけ、保存用の形式へ変換する。
export function installReport(entries, results, started, finished) {
  if (!Array.isArray(results) || results.length !== entries.length) throw new Error('Incomplete results');
  const items = entries.map((entry, index) => {
    const result = results[index];
    if (!result || result.id !== entry.id || !STATES.includes(result.状態)) throw new Error('Unexpected probe result');
    return {id:entry.id, 名前:entry.name, 分類:entry.menuGroup || 'その他拡張', 状態:result.状態, パス:result.パス ?? null, バージョン:result.バージョン ?? null, 説明:result.説明 ?? '', 確認日時:result.確認日時 ?? null};
  });
  const 集計 = Object.fromEntries(STATES.map(state => [state, items.filter(item => item.状態 === state).length]).filter(([, count]) => count));
  return {形式:1, 種類:'インストール状況', 開始日時:started.toISOString(), 完了日時:finished.toISOString(),
    実行環境:{OS:process.platform, CPU:process.arch, Node:process.version}, 件数:items.length, 集計, 項目:items};
}

export async function writeInstallReport(entries, results, started, finished, directory = OUTPUT_DIRECTORY) {
  const report = installReport(entries, results, started, finished);
  await writeResult(path.join(directory, INSTALL_FILE), report);
  return report;
}

// インストール状況。最速化のため全項目を同時に確認し、表示はカタログ順にそろえる。
export async function installStep({entries, probeFn = probe, log = console.log, signal, now = () => new Date()}) {
  if (signal?.aborted) throw cancelled();
  const started = now();
  const results = await scan(entries, probeFn, Math.max(1, entries.length));
  if (signal?.aborted) throw cancelled();
  const report = installReport(entries, results, started, now());
  const width = String(entries.length).length;
  report.項目.forEach((item, index) => log(`  [${String(index + 1).padStart(width)}/${entries.length}] ${item.状態.padEnd(3)} ${item.名前}${item.バージョン ? ' ' + item.バージョン : ''}`));
  return report;
}

// モデル情報: 公開一覧を取得し、テストできるプロバイダのモデル一覧を取得して、プロバイダ別ファイルへ保存する。
// モデル処理は同時 2 件までのため、その上限で並行実行する。
export async function modelsStep({installResults = [], log = console.log, signal, directory = OUTPUT_DIRECTORY, statusFn = getKeyStatus, testFn = testKey, configReader, publicCache = createPublicModelCache({warn:() => {}})} = {}) {
  if (signal?.aborted) throw cancelled();
  const [status] = await Promise.all([statusFn(), publicCache.refresh()]);
  if (signal?.aborted) throw cancelled();
  const rows = status.項目.filter(row => MODEL_PROVIDER_IDS.includes(row.id) && row.テスト可能), input = publicCache.input();
  const results = await scan(rows, row => testFn(row.id, {publicCache:input, installResults}), 2);
  if (signal?.aborted) throw cancelled();
  const byId = {};
  rows.forEach((row, index) => { const result = results[index]; byId[row.id] = result; log(`  ${String(result?.状態 ?? 'ERR').padEnd(3)} ${row.名前}（${result?.モデル?.length ?? 0} 件）`); });
  const 保存先 = await writeModelsInfo(status.項目, byId, {directory, configReader});
  const 集計 = {};for (const result of Object.values(byId)) 集計[result?.状態 ?? 'ERR'] = (集計[result?.状態 ?? 'ERR'] ?? 0) + 1;
  return {集計, 保存先};
}

export const STEPS = Object.freeze([
  {id:'install', 名前:'インストール状況', file:INSTALL_FILE, run:installStep},
  {id:'models', 名前:'モデル情報（プロバイダ別）', file:null, run:modelsStep},
]);

export async function runHeadless({steps = STEPS, directory = OUTPUT_DIRECTORY, loadEntries = catalog, probeFn = probe, log = console.log, error = console.error, signal} = {}) {
  let entries;
  try { entries = await loadEntries(); }
  catch { error('診断を実行できません。catalog.json を読み込めません。同じ版の frontend_diag を取得し直してください。'); return 1; }
  log(`AiDiy 診断（ヘッドレス）: 全診断 ${steps.length} 件を実行します。`);
  let failed = 0, installResults = [];
  for (const [index, step] of steps.entries()) {
    const started = Date.now();
    log(`[${index + 1}/${steps.length}] ${step.名前}`);
    try {
      // file を持つ手順は結果を 1 ファイルへ保存し、持たない手順は自身で保存して保存先を返す。
      const value = await step.run({entries, probeFn, log, signal, directory, installResults});
      if (step.id === 'install') installResults = value.項目 ?? [];
      const saved = step.file ? [path.join(directory, step.file)] : (value.保存先 ?? []).map(file => path.join(directory, file));
      if (step.file) await writeResult(saved[0], value);
      const where = saved.length === 1 ? saved[0] : saved.length ? `${directory}（${saved.map(file => path.basename(file)).join(', ')}）` : '保存対象なし';
      log(`  → ${where} に保存しました。${Object.entries(value.集計 ?? {}).map(([state, count]) => `${state} ${count}`).join(' / ')}（${Date.now() - started}ms）`);
    } catch (reason) {
      if (reason?.diagCode === 'CANCELLED') { error('  → 中断しました。結果ファイルは更新していません。'); return 130; }
      failed++;
      error(`  → ${step.名前}の実行に失敗しました。結果ファイルは更新していません。`);
    }
  }
  log(failed ? `完了（失敗 ${failed} 件）。` : '完了しました。');
  return failed ? 1 : 0;
}

// Ctrl+C で実行中の確認を止め、保存せずに終了する。
export async function headlessMain(options = {}) {
  const controller = new AbortController();
  const stop = () => { controller.abort(); cancelProbes(); cancelKeyProbes(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { return await runHeadless({...options, signal:controller.signal}); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
