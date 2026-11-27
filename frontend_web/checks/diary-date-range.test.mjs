// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { 日付値, 日付範囲を移動 } from '../src/components/Tトラン/T日誌/日誌画面.ts';

test('日誌の月範囲は月初から末日まで。31日やうるう年でも月を飛ばさない', () => {
  assert.deepEqual(日付範囲を移動('2026-11-27', '月', 0), { 開始: '2026-11-01', 終了: '2026-11-30' });
  assert.deepEqual(日付範囲を移動('2024-03-31', '月', -1), { 開始: '2024-02-01', 終了: '2024-02-29' });
  assert.deepEqual(日付範囲を移動('2026-01-01', '月', -1), { 開始: '2025-12-01', 終了: '2025-12-31' });
  assert.deepEqual(日付範囲を移動('2026-12-31', '月', 1), { 開始: '2027-01-01', 終了: '2027-01-31' });
});

test('日移動は一日だけ。不正な日付や年の範囲外には移動しない', () => {
  assert.deepEqual(日付範囲を移動('2026-01-01', '日', -1), { 開始: '2025-12-31', 終了: '2025-12-31' });
  assert.deepEqual(日付範囲を移動('2024-02-29', '日', 1), { 開始: '2024-03-01', 終了: '2024-03-01' });
  assert.equal(日付値('2026-02-29'), '');
  assert.equal(日付範囲を移動('', '日', 1), null);
  assert.equal(日付範囲を移動('0001-01-01', '月', -1), null);
  assert.deepEqual(日付範囲を移動('9999-12-31', '月', 0), { 開始: '9999-12-01', 終了: '9999-12-31' });
  assert.equal(日付範囲を移動('9999-12-31', '日', 1), null);
});
