// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import { inTimeRange } from './ファイル日時.js';

const join = (parent, name) => parent ? `${parent}/${name}` : name;
const byName = (left, right) => left.name.localeCompare(right.name, 'ja', { numeric: true });

// 親・祖先のページへ戻る時だけ逆方向。同名の接頭辞や別の枝は祖先とみなさない。
export function folderPageDirection(previous, next) {
  if (previous === next) return '';
  return !next || previous.startsWith(`${next}/`) ? 'back' : 'forward';
}

// ワープと同じく共通の親まで戻ってから目的の枝へ進む。深い移動も最大5枚・全体約800msにまとめる。
export function folderPageTurnPlan(previous, next, limit = 5) {
  const from = previous.split('/').filter(Boolean), to = next.split('/').filter(Boolean);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  const steps = [];
  for (let length = from.length - 1; length >= common; length--) steps.push({ path: from.slice(0, length).join('/'), direction: 'back' });
  const returning = steps.length;
  for (let length = common + 1; length <= to.length; length++) steps.push({ path: to.slice(0, length).join('/'), direction: 'forward' });
  if (steps.length <= limit) return steps.map(step => ({ ...step, skipped: 0 }));
  const keep = new Set([0, steps.length - 1]);
  if (returning && returning < steps.length) keep.add(returning - 1);
  for (let i = 1; keep.size < limit && i < limit; i++) keep.add(Math.round(i * (steps.length - 1) / (limit - 1)));
  for (let i = 0; keep.size < limit; i++) keep.add(i);
  let last = -1;
  return [...keep].sort((a, b) => a - b).map(index => {
    const step = { ...steps[index], skipped: index - last - 1 }; last = index; return step;
  });
}

// 走査・検索条件が変わった時だけ集計する。2Dの待機中に描画ループや再走査は持たない。
export function indexFolderPages(tree, marks = {}) {
  const pages = new Map(), matches = new Set(marks.paths || []);
  const marked = (path, mtime) => ['grep', 'ai'].includes(marks.mode)
    ? matches.has(path) : inTimeRange(mtime, marks.since, marks.until);
  function visit(node, path) {
    const folders = (node.d || []).map(child => {
      const childPath = join(path, child.n), totals = visit(child, childPath);
      return { type: 'dir', name: child.n, path: childPath, ...totals };
    }).sort(byName);
    const files = (node.f || []).map(([name, size, mtime]) => {
      const filePath = join(path, name);
      return { type: 'file', name, path: filePath, size, mtime, marked: marked(filePath, mtime) };
    }).sort(byName);
    // フォルダの件数に左右されず、表示するファイルだけを自然順で交互に塗る。
    files.forEach((file, index) => { file.striped = index % 2 === 1; });
    const totals = {
      count: files.length + folders.reduce((sum, child) => sum + child.count, 0),
      marked: files.filter(file => file.marked).length + folders.reduce((sum, child) => sum + child.marked, 0),
    };
    pages.set(path, { name: node.n, path, folders, files, entries: [...folders, ...files], ...totals });
    return totals;
  }
  if (tree) visit(tree, '');
  return pages;
}

// フォルダごとにページ位置と選択行を保持する。本文・認証情報は保存しない。
export function createFolderPageMemory() {
  const pages = new Map();
  return {
    save(path, state) {
      const previous = pages.get(path) || { scrollTop: 0, cursor: '' };
      pages.set(path, { ...previous, ...state, scrollTop: Math.max(0, Number(state.scrollTop ?? previous.scrollTop) || 0),
        ...('scrollLeft' in state || 'scrollLeft' in previous ? { scrollLeft: Math.max(0, Number(state.scrollLeft ?? previous.scrollLeft) || 0) } : {}) });
    },
    restore(path, entries, selected = '') {
      const state = pages.get(path) || { scrollTop: 0, cursor: '' };
      const paths = new Set(entries.map(entry => entry.path));
      return { scrollTop: state.scrollTop, ...('scrollLeft' in state ? { scrollLeft: state.scrollLeft } : {}), cursor: paths.has(selected) ? selected : paths.has(state.cursor) ? state.cursor : entries[0]?.path || '' };
    },
    clear() { pages.clear(); },
  };
}
