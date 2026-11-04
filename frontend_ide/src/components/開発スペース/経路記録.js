// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// null は出発点のない最初の記録（始点）。配列順によらず各明細が出発点と到着点を持つ。
// 同一路は向きを区別しない。最初に記録した明細の向き・順序は変更しない。
export function sameRoute(a, b) {
  return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
}
export function uniqueRouteRecords(records) {
  const seen = new Map();
  return records.filter(({from,to}) => {
    if (seen.get(from)?.has(to) || seen.get(to)?.has(from)) return false;
    if (!seen.has(from)) seen.set(from,new Set());
    seen.get(from).add(to);
    return true;
  });
}
export function linearRoute(points) {
  return uniqueRouteRecords(points.map((to, index) => ({ from: index ? points[index - 1] : null, to })));
}

// 検索結果のファイルパスを閲覧と同じ点識別子へ揃える。
export const searchRouteRecords = paths => linearRoute(paths.map(path => `f:${path}`));

const validPoint = value => typeof value === 'string' && /^[gf]:.+/.test(value);
export function restoreRoute(value, current) {
  const records = [], seen = new Set();
  let cursor = null;
  for (const entry of Array.isArray(value) ? value : []) {
    const legacy = typeof entry === 'string';
    const to = legacy ? entry : entry?.to;
    const from = legacy ? cursor : entry?.from;
    if (!validPoint(to) || (from !== null && !validPoint(from))) continue;
    const record = { from, to };
    if (!seen.has(to) && !records.some(previous => sameRoute(previous,record))) records.push(record);
    if (from !== null) seen.add(from);
    seen.add(to);
    cursor = to;
  }
  return { records, current: current === null || seen.has(current) ? current : cursor };
}

export function visitPoint(records, current, to) {
  const record = { from: current ?? null, to };
  if (records.some(previous => previous.to === to || previous.from === to || sameRoute(previous,record))) return { current: to, record: null };
  records.push(record);
  return { current: to, record };
}
