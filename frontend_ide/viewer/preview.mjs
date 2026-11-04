// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// HTML / SVG プレビュー用の静的サーバー。元ファイルのフォルダ構造をURLに保つ。
// - IDE のサーバーとは別ポート（別オリジン）で待ち受け、ページのスクリプトが IDE のファイル API に届かないようにする。
// - 最初のプレビュー要求で起動し、IDE のサーバーを閉じる時に一緒に止める。ファイルは一切書き出さない（ゴミを残さない）。
// - URL には起動ごとの合言葉（推測できない token）を入れ、IDE が渡した URL からだけ読めるようにする。
// - 鍵・設定・依存物・隠しファイルは配らない。HTML にはサンドボックスの CSP を付ける（iframe 側でも sandbox を付ける）。
import {viewerActivityScript} from '../src/components/ファイル閲覧/閲覧待機.js';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { open, realpath, stat, readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MAX_MARKDOWN_BYTES, markdownText, renderMarkdownDocument } from './markdown-preview.mjs';
import { forwardedOrigin } from './launch-options.mjs';
import { hasAlwaysExcludedDirectory } from '../ファイル機能/フォルダ除外規則.mjs';
import { isInternalCredentialPath } from '../ファイル機能/内部認証ファイル.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm',
  '.vrm': 'application/octet-stream', '.vrma': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};
// 配らないフォルダ・ファイル（設定・鍵・依存物・生成物・バックアップ）。隠しファイル・隠しフォルダ（. 始まり）も配らない。
const BLOCKED_DIRS = new Set(['node_modules', '.git', '.git_local', '.venv', 'venv', '__pycache__', '_config', '.aidiy_backup', '.backup_local', '.aidiy_cache', '_cache', '.pytest_cache', '.mypy_cache', '.ruff_cache']);
const BLOCKED_FILE = /(^|[_.-])(keys?|secrets?|tokens?|credentials?|passwords?)\.(json|txt|ya?ml|ini)$|\.(pem|key|pfx|p12|crt)$/i;
// プレビュー内の相対SVG参照などは同一オリジンで動かす。IDEのAPIは別ポートで隔離する。
const DOCUMENT_CSP = 'sandbox allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock';

/** 配ってよい相対パスか（/ 区切り）。 */
export function previewAllowed(rel) {
  if (isInternalCredentialPath(rel) || hasAlwaysExcludedDirectory(rel)) return false;
  const parts = rel.split('/');
  return parts.length > 0 && parts.every(part => part && part !== '.' && part !== '..' && !part.startsWith('.') && !BLOCKED_DIRS.has(part) && !part.includes('\0'))
    && !BLOCKED_FILE.test(parts.at(-1));
}

/** `/…` 始まりの絶対パスの根: ページのある場所から上へたどった最初の public フォルダ。無ければページのフォルダ。 */
export function siteRoot(documentRel) {
  const folders = documentRel.split('/').slice(0, -1);
  const index = folders.lastIndexOf('public');
  return (index >= 0 ? folders.slice(0, index + 1) : folders).join('/');
}

export function createPreview(root, isActive = () => true, { env = process.env } = {}) {
  const token = randomBytes(16).toString('hex');
  let server, origin, publicOrigin, starting, allowedHosts = new Set();
  const realRoot = realpath(root);

  async function resolveFile(rel) {
    if (!previewAllowed(rel)) return null;
    const base = await realRoot;
    let full;
    try { full = await realpath(resolve(base, ...rel.split('/'))); } catch { return null; }
    const back = relative(base, full);
    if (!back || back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) return null;
    // リンクで配らない場所を指していないか、解決後の実パスでも確かめる
    if (!previewAllowed(back.split(sep).join('/'))) return null;
    let info = await stat(full).catch(() => null);
    if (info?.isDirectory()) {
      const index = await resolveFile(`${rel}/index.html`);
      return index ? { ...index, directory: true } : null;
    }
    return info?.isFile() ? { full, info } : null;
  }

  async function handle(req, res) {
    const fail = (status, message) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(message); };
    // DNS リバインディング対策: ローカルと、このポートの確認済みCodespaces転送先だけを許可する。
    if (!allowedHosts.has(req.headers.host)) return fail(403, 'forbidden host');
    if (!isActive()) return fail(503, 'IDE の利用が終了しています。');
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'GET only');
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { return fail(400, 'bad path'); }
    const prefix = `/p/${token}/`;
    let rel;
    if (path.startsWith(prefix)) rel = path.slice(prefix.length);
    else {
      // ページ内の `/…` 始まりの参照: 参照元ページ（Referer）の public フォルダを根として解決する
      let referer;
      try {
        const source = new URL(req.headers.referer || '');
        if (![origin, origin.replace('127.0.0.1', 'localhost'), publicOrigin].includes(source.origin)) return fail(404, 'not found');
        referer = decodeURIComponent(source.pathname);
      } catch { return fail(404, 'not found'); }
      if (!referer.startsWith(prefix)) return fail(404, 'not found');
      const base = siteRoot(referer.slice(prefix.length));
      rel = [base, path.replace(/^\/+/, '')].filter(Boolean).join('/');
    }
    rel = rel.replace(/\/+$/, '');
    const file = rel ? await resolveFile(rel) : null;
    if (!file) return fail(404, 'not found');
    if (file.directory && !path.endsWith('/')) {
      const canonical = new URL(req.url, 'http://127.0.0.1'); canonical.pathname += '/';
      res.writeHead(302, { location: canonical.pathname + canonical.search, 'cache-control': 'no-store' }); return res.end();
    }
    if (/\.(md|markdown)$/i.test(file.full)) {
      if (file.info.size > MAX_MARKDOWN_BYTES) return fail(413, 'Markdownの表示は1MBまでです。');
      const handle = await open(file.full, 'r');
      let bytes;
      try {
        const buffer = Buffer.alloc(MAX_MARKDOWN_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        bytes = buffer.subarray(0, bytesRead);
      } finally { await handle.close(); }
      if (bytes.length > MAX_MARKDOWN_BYTES) return fail(413, 'Markdownの表示は1MBまでです。');
      if (bytes.includes(0)) return fail(415, 'このMarkdownはテキストとして表示できません。');
      const nonce = randomBytes(16).toString('base64');
      const body = Buffer.from(renderMarkdownDocument(markdownText(bytes), rel.split('/').at(-1), nonce));
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin',
        'content-security-policy': `default-src 'none'; img-src 'self' data: https: http:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox`,
      });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    const type = TYPES[extname(file.full).toLowerCase()] || 'application/octet-stream';
    const document = type.startsWith('text/html') || type === 'image/svg+xml';
    const headers = {
      'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes',
      // 同じプレビュー内のルート相対参照は保ち、外部画像・CSS等へtokenやファイル名を渡さない。
      'referrer-policy': 'same-origin',
      // モジュール・フォントなども配信する（URLはtokenを知るIDEから渡す）。
      'access-control-allow-origin': '*',
      ...(document ? { 'content-security-policy': DOCUMENT_CSP } : {}),
    };
    // 動画・音声の途中からの再生（Range）
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    const size = file.info.size;
    if (range && size > 0) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start); end = Math.min(size - 1, end);
      if (start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return createReadStream(file.full, { start, end }).on('error', () => res.destroy()).pipe(res);
    }
    // iframe内の操作だけを親へ通知する。文書の内容や入力値は送らず、隔離オリジンを維持する。
    if (document && ['iframe','document'].includes(req.headers['sec-fetch-dest']) && size <= 1024*1024) {
      const source = (await readFile(file.full)).toString('latin1');
      const activity = viewerActivityScript;
      const content = type === 'image/svg+xml'
        ? source.replace(/<\/svg\s*>\s*$/i,`<script><![CDATA[${activity}]]></script></svg>`)
        : source + `<script>${activity}</script>`;
      const body = Buffer.from(content,'latin1');
      res.writeHead(200, { ...headers, 'content-length': body.length });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    res.writeHead(200, { ...headers, 'content-length': size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file.full).on('error', () => res.destroy()).pipe(res);
  }

  async function start() {
    if (origin) return;
    starting ??= new Promise((done, failed) => {
      server = createServer((req, res) => { handle(req, res).catch(error => { if (!res.headersSent) { res.writeHead(500); res.end(String(error?.message || error)); } else res.destroy(); }); });
      server.once('error', failed);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
        origin = `http://127.0.0.1:${port}`;
        publicOrigin = forwardedOrigin(port, env);
        if (publicOrigin) {
          allowedHosts.add(new URL(publicOrigin).host);
          // Codespacesのポート自動検出へ通知する。token付きURLはログに残さない。
          console.log(`AiDiy preview: ${origin}/`);
        }
        done();
      });
    });
    try { await starting; } finally { starting = undefined; }
  }

  return {
    /** プロジェクト相対パスの文書をプレビューする URL。配らない場所なら null。 */
    async url(rel, { forwarded = false } = {}) {
      if (!previewAllowed(rel) || !(await resolveFile(rel))) return null;
      await start();
      return `${forwarded && publicOrigin ? publicOrigin : origin}/p/${token}/${rel.split('/').map(encodeURIComponent).join('/')}`;
    },
    async close() {
      if (!server) return;
      const closing = server;
      server = undefined; origin = undefined; publicOrigin = undefined;
      closing.closeAllConnections();
      await new Promise(done => closing.close(() => done()));
    },
  };
}
