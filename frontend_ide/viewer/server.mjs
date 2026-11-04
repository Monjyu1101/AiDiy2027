// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// AiDiy IDE の単独サーバー。作業フォルダを走査して星図用のツリーを返し、ファイルの中身と web/ の画面を配信する。
// 依存パッケージなし（Node 標準のみ）。待受は 127.0.0.1 だけ。
import { createServer } from 'node:http';
import { open, readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forwardedOrigin } from './launch-options.mjs';
import { createCoreConnection } from './core-connection.mjs';
import { createPanels } from './panels.mjs';
import { createPreview } from './preview.mjs';
import { vuePreview } from './vue-preview.mjs';
import { publicMediaURL } from './登録HTMLルート.mjs';
import { MEDIA_PATTERN } from './media-types.mjs';
import { latestFile, latestFiles } from '../src/components/ファイル閲覧/最新ファイル.js';
import { scanTree, createScanPool, scanMetadata, createBudget } from './file-scan.mjs';
import { createExplorerFiles } from '../ファイル機能/explorer-files.mjs';
import { hasAlwaysExcludedDirectory } from '../ファイル機能/フォルダ除外規則.mjs';
import { isInternalCredentialPath } from '../ファイル機能/内部認証ファイル.mjs';
export { scanTree, createScanPool } from './file-scan.mjs';

const webRoot = fileURLToPath(new URL('./web/', import.meta.url));
// ファイルビューア用の Monaco Editor（`python frontend_ide/viewer/_setup.py` で導入。無ければ画面側が簡易表示にする）
const monacoRoot = fileURLToPath(new URL('./node_modules/monaco-editor/min/', import.meta.url));
const modulesRoot = fileURLToPath(new URL('./node_modules/', import.meta.url));
const ASSET_TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.wasm': 'application/wasm',
};
// Office Viewer と同系統の表示ライブラリを、自前の依存から配信する。
// node_modules 全体は公開せず、表示に必要な資産だけを許可する。
const OFFICE_ASSETS = {
  '/office-vendor/jszip.js': 'jszip/dist/jszip.min.js',
  '/office-vendor/docx.js': 'docx-preview/dist/docx-preview.min.js',
  '/office-vendor/xlsx.js': 'xlsx/dist/xlsx.full.min.js',
  '/office-vendor/chart.js': 'chart.js/dist/chart.umd.js',
  '/office-vendor/pptx.js': 'pptxviewjs/dist/PptxViewJS.min.js',
  '/office-vendor/pdf.mjs': 'pdfjs-dist/build/pdf.mjs',
  '/office-vendor/pdf.worker.mjs': 'pdfjs-dist/build/pdf.worker.mjs',
};
const OFFICE_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

const MAX_TEXT = 1024 * 1024;          // ビューアに送るテキストの上限（先頭のみ）
const MAX_IMAGE = 20 * 1024 * 1024;    // ビューアに送る画像の上限
const MAX_DOCUMENT = 50 * 1024 * 1024; // Office / PDF の表示上限
const DOCUMENTS = {
  '.docx': 'word', '.dotx': 'word',
  '.xlsx': 'excel', '.xls': 'excel', '.xlsm': 'excel', '.ods': 'excel', '.csv': 'excel', '.tsv': 'excel',
  '.pptx': 'powerpoint', '.pptm': 'powerpoint', '.pdf': 'pdf',
};

// 画面本体（/）は frontend_ide/server.mjs が Vue 画面を返す。ここは文書表示とライセンス表示だけを配信する。
const STATIC = {
  '/office.html': ['office.html', 'text/html; charset=utf-8'],
  '/office.js': ['office.js', 'text/javascript; charset=utf-8'],
  '/office.css': ['office.css', 'text/css; charset=utf-8'],
  '/licenses.html': ['licenses.html', 'text/html; charset=utf-8'],
  '/licenses.css': ['licenses.css', 'text/css; charset=utf-8'],
  '/LICENSE.txt': ['LICENSE.txt', 'text/plain; charset=utf-8'],
  '/THIRD_PARTY_NOTICES.txt': ['THIRD_PARTY_NOTICES.txt', 'text/plain; charset=utf-8'],
};
const IMAGES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

/** 作業フォルダからの相対パス（/ 区切り）を実ファイルへ解決する。作業フォルダの外（.. やリンク先）は null。 */
async function insideRoot(root, rel) {
  if (!rel || rel.includes('\0') || isInternalCredentialPath(rel) || hasAlwaysExcludedDirectory(rel)) return null;
  const realRoot = await realpath(root);
  let full;
  try { full = await realpath(resolve(realRoot, ...rel.split('/'))); } catch { return null; }
  if (isInternalCredentialPath(full)) return null;
  const back = relative(realRoot, full);
  if (hasAlwaysExcludedDirectory(back)) return null;
  // 空（ルート自身）、親への脱出、別ドライブ（絶対パスが返る）を拒否する
  if (!back || back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) return null;
  return full;
}

/** 先頭 max バイトを読む。 */
async function readHead(full, max) {
  const handle = await open(full, 'r');
  try {
    const buffer = Buffer.alloc(max);
    const { bytesRead } = await handle.read(buffer, 0, max, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

/** UTF-8 として読めなければ Shift_JIS（Windows の .bat など）で読む。 */
function decodeText(bytes) {
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }; } catch { /* 次へ */ }
  try { return { text: new TextDecoder('shift_jis', { fatal: true }).decode(bytes), encoding: 'Shift_JIS' }; } catch { /* 次へ */ }
  return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8（一部読めない文字あり）' };
}

/** ビューア用: テキストは中身、画像は種類、それ以外はバイナリとして返す。 */
async function describeFile(root, rel) {
  const full = await insideRoot(root, rel);
  if (!full) return null;
  const info = await stat(full);
  if (!info.isFile()) return null;
  const image = IMAGES[extname(full).toLowerCase()];
  // SVGは画像埋込では外部画像を参照できないため、コードと文書プレビューを提供する。
  if (image && extname(full).toLowerCase() !== '.svg') return { kind: 'image', size: info.size, tooLarge: info.size > MAX_IMAGE };
  const format = DOCUMENTS[extname(full).toLowerCase()];
  if (format) return { kind: 'office', format, size: info.size, tooLarge: info.size > MAX_DOCUMENT };
  const head = await readHead(full, Math.min(info.size, MAX_TEXT));
  // 先頭 8KB に NUL があればバイナリとみなす（UTF-16 のテキストもここではバイナリ扱い）
  if (head.subarray(0, 8192).includes(0)) return { kind: 'binary', size: info.size };
  // 上限で切った場合、末尾の文字が途中で切れていることがあるので最後の改行までにそろえる
  let bytes = head;
  const truncated = info.size > head.length;
  if (truncated) { const lastNewline = bytes.lastIndexOf(0x0a); if (lastNewline > 0) bytes = bytes.subarray(0, lastNewline + 1); }
  return { kind: 'text', size: info.size, truncated, ...decodeText(bytes) };
}

/** テキスト内容の部分一致検索。外部コマンドや正規表現は実行しない。 */
export async function grepFiles(root, query, { caseSensitive = false, signal, pool, fresh = false, limits = {}, now } = {}) {
  if (typeof query !== 'string' || !query || query.length > 256) throw new Error('検索語は1〜256文字で指定してください。');
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const caps = { maxFiles: 30000, maxFileBytes: MAX_TEXT, maxBytes: 256 * MAX_TEXT, maxMatches: 1000, timeMs: 30000, ...limits };
  const budget = createBudget({ signal, timeMs: caps.timeMs, now });
  const paths = new Set(), matches = [], files = [];
  let checked = 0, skipped = 0, bytes = 0, reservedBytes = 0, scannedFiles = 0, cursor = 0, scan;
  const reasons = new Set();
  function collect(node, prefix = '') {
    if (budget.check()) return;
    for (const [name] of node.f) files.push(prefix + name);
    for (const child of node.d) collect(child, `${prefix}${child.n}/`);
  }
  function findMatches(text, path, info) {
    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    let offset = haystack.indexOf(needle);
    if (offset < 0) return;
    // 大文字小文字の変換で長さが変わる文字（İなど）も元のUTF-16位置へ戻す。
    let originalOffsets;
    if (haystack.length !== text.length) {
      originalOffsets = [];
      let original = 0;
      for (const character of text) {
        for (let n = 0; n < character.toLocaleLowerCase().length; n++) originalOffsets.push(original);
        original += character.length;
      }
    }
    const originalStart = index => originalOffsets ? originalOffsets[index] : index;
    let line = 1, lineStart = 0, position = 0;
    while (offset >= 0 && !budget.check()) {
      if (matches.length >= caps.maxMatches) { budget.stop('matches'); break; }
      const start = originalStart(offset), last = originalStart(offset + needle.length - 1);
      const end = originalOffsets ? last + (text.codePointAt(last) > 0xffff ? 2 : 1) : offset + needle.length;
      while (position < start) {
        const char = text[position++];
        if (char === '\r') { if (text[position] === '\n' && position < start) position++; line++; lineStart = position; }
        else if (char === '\n') { line++; lineStart = position; }
      }
      let lineEnd = text.indexOf('\n', start);
      if (lineEnd < 0) lineEnd = text.length;
      const carriage = text.indexOf('\r', start);
      if (carriage >= 0) lineEnd = Math.min(lineEnd, carriage);
      const snippetStart = Math.max(lineStart, start - 80), snippetEnd = Math.min(lineEnd, snippetStart + 240);
      matches.push({ path, line, column: start - lineStart + 1, length: end - start,
        snippet: text.slice(snippetStart, snippetEnd), snippetColumn: snippetStart - lineStart + 1,
        snippetTruncated: snippetStart > lineStart || snippetEnd < lineEnd,
        mtime: Math.round(info.mtimeMs), size: info.size });
      paths.add(path);
      offset = haystack.indexOf(needle, offset + needle.length);
    }
  }
  async function worker() {
    while (cursor < files.length && !budget.check()) {
      if (scannedFiles >= caps.maxFiles) { reasons.add('files'); break; }
      const path = files[cursor++];
      scannedFiles++;
      let handle;
      try {
        const full = await budget.run(() => insideRoot(root, path));
        if (!full) { skipped++; continue; }
        const info = await budget.run(() => stat(full));
        const ext = extname(full).toLowerCase();
        if (!info.isFile() || info.size > caps.maxFileBytes || IMAGES[ext] || (DOCUMENTS[ext] && !['.csv', '.tsv'].includes(ext))) { skipped++; continue; }
        if (reservedBytes + info.size > caps.maxBytes) { reasons.add('bytes'); cursor = files.length; break; }
        reservedBytes += info.size;
        handle = await budget.run(() => open(full, 'r'), late => late.close());
        const buffer = Buffer.alloc(info.size);
        const { bytesRead } = await budget.run(() => handle.read(buffer, 0, buffer.length, 0));
        if (budget.check()) break;
        bytes += bytesRead;
        const current = await budget.run(() => handle.stat());
        if (current.size !== info.size || current.mtimeMs !== info.mtimeMs || bytesRead !== info.size) { skipped++; continue; }
        const head = buffer.subarray(0, bytesRead);
        if (head.includes(0)) { skipped++; continue; }
        const { text, encoding } = decodeText(head);
        if (encoding.includes('一部')) { skipped++; continue; }
        checked++;
        findMatches(text, path, info);
      } catch { if (!budget.check()) skipped++; }
      finally { if (handle) await budget.run(() => handle.close()).catch(() => { void handle.close().catch(() => {}); }); }
    }
  }
  try {
    scan = pool ? await pool.get({ scope: 'grep', signal: budget.signal, fresh })
      : await scanTree(root, { scope: 'grep', signal: budget.signal, limits: limits.scan });
    if (scan.truncated) reasons.add(scan.truncationReason);
    collect(scan.tree);
    await Promise.all(Array.from({ length: 8 }, worker));
  } catch (error) { if (!budget.check()) throw error; }
  finally { budget.close(); }
  if (budget.reason) reasons.add(budget.reason);
  matches.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
  return { paths: [...paths].sort(), matches, checked, skipped, bytes, scannedFiles,
    matchedFiles: paths.size, matchCount: matches.length, truncated: reasons.size > 0,
    truncationReason: budget.reason || [...reasons][0] || null, truncationReasons: [...reasons],
    elapsedMs: budget.elapsedMs, scan: scan ? scanMetadata(scan) : null };
}

/** 既定は OS による空きポート割り当て。明示ポートが使用中なら再割り当て（strict なら失敗）。 */
export async function startServer(root, port = 0, { strict = false, env = process.env, connection = createCoreConnection(root), requestHandler, panelsFactory = createPanels, scanPoolOptions, explorerOptions } = {}) {
  let allowedHosts = new Set();
  let allowedOrigins = new Set();
  const panels = panelsFactory(root, connection.state);
  const scans = createScanPool(root, scanPoolOptions);
  const explorer = createExplorerFiles(root, { ...explorerOptions, state: connection.state, onChange: () => scans.invalidate() });
  const reads = new Set();
  const cancelReads = () => { for (const controller of reads) controller.abort(); };
  const closeScans = () => { cancelReads(); scans.close(); explorer.close(); };
  // HTML プレビュー用の別オリジン静的サーバー。最初のプレビュー要求で起動し、このサーバーを閉じる時に止める。
  const preview = createPreview(root, () => connection.state().active, { env });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const fail = (status, message) => { if (res.destroyed || res.writableEnded) return; res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(message); };
    // DNS リバインディング対策: 127.0.0.1 / localhost 以外の Host 名で来た要求は受けない
    if (!allowedHosts.has(req.headers.host)) return fail(403, 'forbidden host');
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return fail(403, 'forbidden origin');
    if (req.headers['sec-fetch-site'] === 'cross-site') return fail(403, 'cross-site request');
    try {
      if (requestHandler && await requestHandler(req, res, url)) return;
      const json = value => {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(value));
      };
      // 消えた画面の待機だけを解除する。共有走査は最後の利用者が離れるまで続ける。
      const fileWork = async work => {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        reads.add(controller);
        res.once('close', cancel); req.once('aborted', cancel);
        try {
          const result = await work(controller.signal);
          if (res.destroyed) return;
          if (controller.signal.aborted) return fail(503, '利用が終了しました。');
          if (!connection.state().active) return fail(503, '利用が終了しました。');
          return json(result);
        } catch (error) {
          if (!controller.signal.aborted && error?.name !== 'AbortError') throw error;
          if (!res.destroyed) return fail(503, '利用が終了しました。');
        }
        finally { reads.delete(controller); res.off('close', cancel); req.off('aborted', cancel); }
      };
      if (url.pathname === '/api/connection' && req.method === 'GET') return json(connection.state());
      if (['/api/connection/connect', '/api/connection/disconnect', '/api/connection/offline'].includes(url.pathname)) {
        if (req.method !== 'POST') return fail(405, 'POST required');
        req.resume();
        if (!url.pathname.endsWith('/connect') || connection.state().mode !== 'online') { cancelReads(); scans.invalidate(); explorer.invalidate(); }
        return json(url.pathname.endsWith('/disconnect') ? connection.disconnect() : url.pathname.endsWith('/offline') ? connection.offline() : await connection.connect());
      }
      // 画面を隠すだけでなく、未接続時はファイル取得も停止する。
      if (url.pathname.startsWith('/api/') && !connection.state().active) return fail(503, 'AiDiy接続利用またはオフライン利用を選択してください。');
      if (await explorer.handle(req, res, url)) return;
      if (url.pathname === '/api/panels/code' || url.pathname === '/api/panels/live' || url.pathname === '/api/panels/console') {
        if (req.method !== 'POST') return fail(405, 'POST required');
        if (url.pathname.endsWith('/live') && connection.state().mode !== 'online') return fail(403, 'LiveはAiDiy接続利用で開けます。');
        req.resume();
        return json({ url: await panels.open(url.pathname.split('/').at(-1)) });
      }
      if (url.pathname.startsWith('/panels/')) return await panels.http(req, res);
      const desktopLegal = {
        '/electron-license.txt': ['electron/LICENSE', 'text/plain; charset=utf-8'],
        '/chromium-licenses.html': ['electron/dist/LICENSES.chromium.html', 'text/html; charset=utf-8'],
      }[url.pathname];
      if (desktopLegal) {
        const body = await readFile(join(modulesRoot, desktopLegal[0])).catch(() => null);
        if (!body) return fail(404, 'Electron 版のセットアップ後に参照できます。');
        res.writeHead(200, { 'content-type': desktopLegal[1], 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'x-content-type-options': 'nosniff' });
        res.end(body); return;
      }
      if (url.pathname === '/api/grep') {
        if (req.method !== 'GET') return fail(405, 'GET required');
        const query = url.searchParams.get('q') || '';
        if (!query || query.length > 256) return fail(400, '検索語は1〜256文字で指定してください。');
        return await fileWork(signal => grepFiles(root, query, {
          caseSensitive: url.searchParams.get('case') === '1', signal, pool: scans, fresh: url.searchParams.get('fresh') === '1',
        }));
      }
      // HTML/SVG/Markdownは別オリジンのプレビュー、Vueはfrontend_webの開発サーバーの画面
      if (url.pathname === '/api/preview') {
        const path = url.searchParams.get('path') || '';
        if (/\.(html?|svg|md|markdown)$/i.test(path)) {
          const kind = /\.(md|markdown)$/i.test(path) ? 'markdown' : /\.svg$/i.test(path) ? 'svg' : 'html';
          const full = await insideRoot(root, path);
          if (kind === 'markdown' && full && (await stat(full)).size > MAX_TEXT) return json({ kind, error: 'Markdownの表示は1MBまでです。コード表示で先頭の内容を確認できます。' });
          // APIを開いた公開元に合わせる。Hostを書き換える転送もOrigin / Refererで判定する。
          const publicOrigin = forwardedOrigin(server.address().port, env);
          let refererOrigin;
          try { refererOrigin = new URL(req.headers.referer || '').origin; } catch {}
          const forwarded = !!publicOrigin && (req.headers.host === new URL(publicOrigin).host || req.headers.origin === publicOrigin || refererOrigin === publicOrigin);
          const address = full ? await preview.url(path, { forwarded }) : null;
          return address ? json({ kind, url: address }) : json({ kind, error: 'このファイルは表示できません（設定・鍵・依存物などは配信しません）。' });
        }
        // 音声・動画は「ブラウザ」で開く。AiDiy 保守中の public は正式なリンク、それ以外は Range 対応のプレビューサーバー。
        if (MEDIA_PATTERN.test(path)) {
          const full = await insideRoot(root, path);
          const publicOrigin = forwardedOrigin(server.address().port, env);
          let refererOrigin;
          try { refererOrigin = new URL(req.headers.referer || '').origin; } catch {}
          const forwarded = !!publicOrigin && (req.headers.host === new URL(publicOrigin).host || req.headers.origin === publicOrigin || refererOrigin === publicOrigin);
          // 転送経由の画面からは 127.0.0.1 の正式なリンクへ届かないため、プレビューサーバーを使う。
          const address = full ? (!forwarded && await publicMediaURL(root, path)) || await preview.url(path, { forwarded }) : null;
          return address ? json({ kind: 'media', url: address }) : json({ kind: 'media', error: 'このファイルは表示できません（設定・鍵・依存物などは配信しません）。' });
        }
        if (/\.vue$/i.test(path)) return await insideRoot(root, path) ? json(await vuePreview(root, path)) : fail(404, 'not found');
        return fail(404, 'not found');
      }
      // 最終更新欄。前回の更新日時から、同じ秒も含めて更新候補を返す。
      if (url.pathname === '/api/latest') {
        const filter = url.searchParams.get('filter');
        if (filter && filter !== 'backup') return fail(400, 'filter は backup だけ指定できます。');
        const value = url.searchParams.get('since'), since = value === null ? null : Number(value);
        if (value !== null && (!value.trim() || !Number.isFinite(since) || since < 0)) return fail(400, 'since は更新日時のミリ秒を指定してください。');
        return await fileWork(async signal => {
          const result = await scans.get({ filter, signal, fresh: url.searchParams.get('fresh') === '1' });
          return { latest: latestFile(result.tree), files: latestFiles(result.tree, since), scan: scanMetadata(result),
            truncated: result.truncated, truncationReason: result.truncationReason };
        });
      }
      if (url.pathname === '/api/folder-state') {
        if (req.method !== 'GET') return fail(405, 'GET required');
        const filter = url.searchParams.get('filter') || '', folder = url.searchParams.get('path') || '';
        if (filter && filter !== 'backup') return fail(400, 'filter は backup だけ指定できます。');
        return await fileWork(async signal => {
          const result = await scans.get({ filter, folder, signal });
          if (result.missing) return { missing: true, path: folder };
          return { path: folder, scope: 'recursive', files: result.files, latest: result.latest, revision: result.revision,
            truncated: result.truncated, truncationReason: result.truncationReason, elapsedMs: result.elapsedMs, unchanged: url.searchParams.get('since') === result.revision,
            ...(url.searchParams.get('since') !== result.revision ? { fileList: result.fileList } : {}),
            ...(url.searchParams.get('since') !== result.revision && !result.truncated ? { tree: result.tree } : {}) };
        });
      }
      if (url.pathname === '/api/galaxy') {
        const filter = url.searchParams.get('filter');
        if (filter && filter !== 'backup') return fail(400, 'filter は backup だけ指定できます。');
        return await fileWork(async signal => { const {fileList, ...result} = await scans.get({ filter, signal, fresh: url.searchParams.get('fresh') === '1' }); return result; });
      }
      if (url.pathname === '/api/file') {
        const result = await describeFile(root, url.searchParams.get('path'));
        if (!result) return fail(404, 'not found');
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(result));
        return;
      }
      if (url.pathname === '/api/raw') {
        // 画像だけを生で返す（SVG はスクリプトを動かさないよう CSP を付ける）
        const full = await insideRoot(root, url.searchParams.get('path'));
        const type = full && IMAGES[extname(full).toLowerCase()];
        if (!type) return fail(404, 'not found');
        const info = await stat(full);
        if (!info.isFile() || info.size > MAX_IMAGE) return fail(413, 'too large');
        res.writeHead(200, {
          'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        });
        res.end(await readFile(full));
        return;
      }
      if (url.pathname === '/api/document') {
        const full = await insideRoot(root, url.searchParams.get('path'));
        if (!full || !DOCUMENTS[extname(full).toLowerCase()]) return fail(404, 'not found');
        const info = await stat(full);
        if (!info.isFile()) return fail(404, 'not found');
        if (info.size > MAX_DOCUMENT) return fail(413, '文書が大きすぎます（上限 50MB）。');
        res.writeHead(200, {
          'content-type': 'application/octet-stream', 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'content-disposition': 'attachment',
        });
        res.end(await readFile(full));
        return;
      }
      if (url.pathname.startsWith('/office-vendor/')) {
        let asset = OFFICE_ASSETS[url.pathname];
        // PDF の日本語 CMap・標準フォント・画像デコーダー。
        const pdfAsset = /^\/office-vendor\/(cmaps|standard_fonts|wasm)\/([a-zA-Z0-9_.-]+)$/.exec(url.pathname);
        if (pdfAsset && !pdfAsset[2].startsWith('.')) asset = `pdfjs-dist/${pdfAsset[1]}/${pdfAsset[2]}`;
        if (!asset) return fail(404, 'not found');
        let body;
        try { body = await readFile(join(modulesRoot, asset)); } catch { return fail(404, '表示ライブラリがありません。frontend_ide/viewer のセットアップを実行してください。'); }
        res.writeHead(200, { 'content-type': ASSET_TYPES[extname(asset)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
        res.end(body);
        return;
      }
      if (url.pathname.startsWith('/monaco/')) {
        const full = resolve(monacoRoot, ...decodeURIComponent(url.pathname.slice('/monaco/'.length)).split('/'));
        const back = relative(monacoRoot, full);
        const type = ASSET_TYPES[extname(full).toLowerCase()];
        if (!type || !back || back.startsWith('..') || isAbsolute(back)) return fail(404, 'not found');
        let body;
        try { body = await readFile(full); } catch { return fail(404, 'not found'); }
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
        res.end(body);
        return;
      }
      const file = STATIC[url.pathname];
      if (!file) return fail(404, 'not found');
      res.writeHead(200, {
        'content-type': file[1], 'cache-control': 'no-store',
        ...(url.pathname === '/office.html' ? { 'content-security-policy': OFFICE_CSP } : {}),
      });
      res.end(await readFile(join(webRoot, file[0])));
    } catch (error) {
      fail(500, String(error?.message || error));
    }
  });
  server.on('upgrade', (req, socket, head) => {
    if (!allowedHosts.has(req.headers.host) || !allowedOrigins.has(req.headers.origin)
        || req.headers['sec-fetch-site'] === 'cross-site') { socket.destroy(); return; }
    void panels.upgrade(req, socket, head).catch(() => socket.destroy());
  });
  server.once('close', () => { closeScans(); connection.close(); void panels.close(); void preview.close(); });
  const listen = p => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(p, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  try { await listen(port); } catch (error) {
    if (error.code !== 'EADDRINUSE' || strict) { closeScans(); await panels.close(); await preview.close(); connection.close(); throw error; }
    await listen(0);
  }
  const actual = server.address().port;
  allowedHosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
  const forwarded = forwardedOrigin(actual, env);
  if (forwarded) allowedHosts.add(new URL(forwarded).host);
  allowedOrigins = new Set([`http://127.0.0.1:${actual}`, `http://localhost:${actual}`, ...(forwarded ? [forwarded] : [])]);
  async function close() {
    closeScans();
    connection.close();
    // upgrade済みの音声ソケットはcloseAllConnectionsでは閉じないため先に破棄する。
    await panels.close();
    await preview.close();
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
  return { server, close, url: `http://127.0.0.1:${actual}/`, publicUrl: `${forwarded || `http://127.0.0.1:${actual}`}/` };
}
