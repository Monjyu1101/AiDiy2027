// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import type { Router } from 'vue-router';

function 暦日(日付: unknown): Date | null {
  if (typeof 日付 !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(日付)) return null;
  const date = new Date(`${日付}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.toISOString().slice(0, 10) === 日付 ? date : null;
}

export function 日付値(日付: unknown): string {
  return typeof 日付 === 'string' && 暦日(日付) ? 日付 : '';
}

export function 日付範囲を移動(日付: string, 単位: '日' | '月', 差分: -1 | 0 | 1) {
  // 日付入力は時刻を持たない。夏時間をまたいでもUTCの暦日として計算する。
  const date = 暦日(日付);
  if (!date) return null;
  if (単位 === '日') date.setUTCDate(date.getUTCDate() + 差分);
  else {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 差分);
  }
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
  const 開始 = date.toISOString().slice(0, 10);
  if (単位 === '月') date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return { 開始, 終了: date.toISOString().slice(0, 10) };
}

export function 画面遷移先(router: Router, value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return '';
  // 全角の区切りは呼出元 URL 自体にだけ適用し、クエリ内の値はそのまま保持する。
  const target = raw.startsWith('／') ? raw.replace(/／/g, '/').replace(/？/g, '?').replace(/＆/g, '&').replace(/＝/g, '=') : raw;
  if (!target.startsWith('/') || target.startsWith('//') || target.split(/[?#]/, 1)[0].includes('\\')) return '';
  const resolved = router.resolve(target);
  return resolved.name && resolved.matched.length ? resolved.fullPath : '';
}
