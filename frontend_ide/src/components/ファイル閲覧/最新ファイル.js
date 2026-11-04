// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 最終更新表示・自動追跡だけに適用する。ツリー表示・バックアップ・Gitの対象は変えない。
const EXCLUDED_DIRS = new Set(['_AIDIY', '_data', '_datas']);

// 最終更新候補とは別に、現在のフィルターを適用した一覧全体の増減を調べる。
// 不完全な走査や古い応答の件数では、表示済みの一覧を更新しない。
export function fileCountChanged(previous, next) {
  const complete = value => value && !value.truncated && !value.missing
    && Number.isSafeInteger(value.files) && value.files >= 0 && Number.isFinite(value.scannedAt);
  return !!(complete(previous) && complete(next)
    && next.scannedAt >= previous.scannedAt && previous.files !== next.files);
}

export function latestFile(tree) {
  let latest = null;
  function walk(node, prefix) {
    if (!node) return;
    for (const [name, , mtime] of node.f) {
      if (!latest || mtime > latest.mtime) latest = { name, path: prefix ? `${prefix}/${name}` : name, mtime };
    }
    for (const dir of node.d) {
      if (!EXCLUDED_DIRS.has(dir.n)) walk(dir, prefix ? `${prefix}/${dir.n}` : dir.n);
    }
  }
  walk(tree, '');
  return latest;
}

// 秒の境界を含めて返し、前回と同じファイルかどうかは利用側で判定する。
export function latestFiles(tree, since = null) {
  const latest = latestFile(tree);
  if (!latest) return [];
  const boundary = Math.floor((since ?? latest.mtime) / 1000) * 1000, files = [];
  function walk(node, prefix = '') {
    if (!node) return;
    for (const [name, , mtime] of node.f) if (mtime >= boundary) files.push({ name, path: prefix + name, mtime });
    for (const dir of node.d) if (!EXCLUDED_DIRS.has(dir.n)) walk(dir, prefix + dir.n + '/');
  }
  walk(tree);
  return files.sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path, 'ja', { numeric: true }));
}

export function createLatestUpdates() {
  let since = null, seen = new Map();
  return {
    get since() { return since; },
    accept(files) {
      if (!files.length) return [];
      const initial = since === null, boundary = Math.floor((since ?? 0) / 1000) * 1000;
      const updates = files.filter(file => file.mtime >= boundary && (!seen.has(file.path) || file.mtime > seen.get(file.path)))
        .sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path, 'ja', { numeric: true }));
      if (!updates.length) return [];
      since = updates.reduce((latest, file) => Math.max(latest, file.mtime), since ?? 0);
      for (const file of updates) seen.set(file.path, file.mtime);
      const nextBoundary = Math.floor(since / 1000) * 1000;
      seen = new Map([...seen].filter(([, mtime]) => mtime >= nextBoundary));
      // 初回は直近の1ファイルを表示し、同じ秒の既存ファイルは取得済みとして覚える。
      return initial ? updates.slice(-1) : updates;
    },
  };
}
