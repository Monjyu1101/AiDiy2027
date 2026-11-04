// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// .vue のプレビュー。.vue はブラウザで直接動かず、単体では props・API・認証の前提も欠けるため、
// frontend_web の Vite 開発サーバーが動いている時だけ「その部品を使っている画面（ルート）」を開く。
// HTTP で見に行くだけで、frontend_web の node_modules やコンパイラは借りない。
import { readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

const WEB = 'frontend_web';
const SOURCE = `${WEB}/src`;
const SKIP = new Set(['node_modules', 'dist', '.git', '.git_local', '.aidiy_backup', '.backup_local', '.aidiy_cache', '__pycache__']);

async function listSources(root) {
  const files = [];
  async function walk(rel) {
    let entries;
    try { entries = await readdir(join(root, ...rel.split('/')), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) { if (!SKIP.has(entry.name)) await walk(path); }
      else if (/\.(vue|ts|js)$/.test(entry.name)) files.push(path);
    }
  }
  await walk(SOURCE);
  return files;
}

/** import 指定子（相対 / @/ 別名）をプロジェクト相対パスへ。.vue 以外・パッケージは null。 */
function resolveImport(from, spec) {
  if (!spec.endsWith('.vue')) return null;
  if (spec.startsWith('@/')) return posix.normalize(`${SOURCE}/${spec.slice(2)}`);
  if (spec.startsWith('.')) return posix.normalize(posix.join(posix.dirname(from), spec));
  return null;
}

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+\.vue)['"]/g;
// 識別子は日本語も使う（例: import AIコア画面 from '…/AiDiy.vue'）ので Unicode の文字で受ける
const IDENT = '[\\p{L}_$][\\p{L}\\p{N}_$]*';
const STATIC_IMPORT = new RegExp(`\\bimport\\s+(${IDENT})\\s+from\\s+['"]([^'"]+\\.vue)['"]`, 'gu');

/** 各ルート定義（path と、その直後の component）を読む。:param やワイルドカードのルートは開けないので除く。 */
export function readRoutes(file, text) {
  const named = new Map([...text.matchAll(STATIC_IMPORT)].map(m => [m[1], resolveImport(file, m[2])]));
  const marks = [...text.matchAll(/\bpath\s*:\s*['"]([^'"]*)['"]/g)];
  const routes = [];
  marks.forEach((mark, i) => {
    const chunk = text.slice(mark.index, marks[i + 1]?.index ?? text.length);
    const lazy = /component\s*:\s*\(\s*\)\s*=>\s*import\(\s*['"]([^'"]+\.vue)['"]\s*\)/.exec(chunk);
    const direct = new RegExp(`component\\s*:\\s*(${IDENT})`, 'u').exec(chunk);
    const component = lazy ? resolveImport(file, lazy[1]) : direct ? named.get(direct[1]) : null;
    const path = mark[1];
    if (component && path.startsWith('/') && !/[:*]/.test(path)) routes.push({ path, component });
  });
  return routes;
}

export async function webPort(root) {
  try {
    const config = await readFile(join(root, WEB, 'vite.config.ts'), 'utf8');
    const port = /PORT_WEB\s*=\s*(\d+)/.exec(config)?.[1];
    if (port) return Number(port);
  } catch { /* 既定値 */ }
  return 8090;
}

/** 指定の .vue を表示できる画面を探す。部品なら import をたどって、その部品を使う画面まで上がる。 */
export async function routesFor(root, rel) {
  const files = await listSources(root);
  const importers = new Map();
  const routes = [];
  for (const file of files) {
    let text;
    try { text = await readFile(join(root, ...file.split('/')), 'utf8'); } catch { continue; }
    if (file.startsWith(`${SOURCE}/router/`)) routes.push(...readRoutes(file, text));
    for (const match of text.matchAll(IMPORT)) {
      const target = resolveImport(file, match[1]);
      if (!target) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(file);
    }
  }
  const byComponent = new Map();
  for (const route of routes) {
    if (!byComponent.has(route.component)) byComponent.set(route.component, []);
    byComponent.get(route.component).push(route.path);
  }
  // 近い画面から順に（自分自身がルートなら最優先）。たどるのは最大6段・200ファイルまで。
  const found = [], seen = new Set([rel]);
  let level = [rel];
  for (let depth = 0; depth < 6 && level.length && seen.size < 200; depth++) {
    const next = [];
    for (const file of level) {
      for (const path of byComponent.get(file) || []) if (!found.includes(path)) found.push(path);
      for (const parent of importers.get(file) || []) if (!seen.has(parent)) { seen.add(parent); next.push(parent); }
    }
    if (found.length) break;
    level = next;
  }
  return found.slice(0, 20);
}

export async function vuePreview(root, rel) {
  if (!rel.startsWith(`${SOURCE}/`)) return { kind: 'vue', error: '表示できるのは frontend_web/src の画面・部品だけです。' };
  const port = await webPort(root);
  const alive = await fetch(`http://127.0.0.1:${port}/@vite/client`, { signal: AbortSignal.timeout(1500) }).then(r => r.ok).catch(() => false);
  if (!alive) return { kind: 'vue', error: `frontend_web の開発サーバー（ポート ${port}）が動いていません。全体起動（python _start.py）でフロントエンド(Web)を起動すると、この部品を使う画面を表示できます。` };
  const paths = await routesFor(root, rel);
  if (!paths.length) return { kind: 'vue', error: 'この部品を使っている画面（ルート）が見つかりません。' };
  const base = `http://127.0.0.1:${port}`;
  return { kind: 'vue', routes: paths.map(path => ({ path, url: base + encodeURI(path) })) };
}
