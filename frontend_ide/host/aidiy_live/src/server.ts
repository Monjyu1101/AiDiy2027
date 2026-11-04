/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

import { internalAuthorization, type InternalAuthorization } from '../../src/internal-auth';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Socket } from 'node:net';
import { ライブモデル読込, ライブモデル保存, モデル保存先 } from '../../src/model-preferences';
import { ローカル接続先 } from '../local-backend.cjs';
import { 接続エラー詳細 } from './connection-error';
import { 接続元許可 } from '../../src/forwarded-origin';
import { catppuccinAsset } from '../../../src/components/ファイル閲覧/ファイルアイコン.js';

// ホスト固有の接続をここに閉じ込める。会話・音声・UI はブラウザ側で共用する。
export async function ライブ起動(root: string, backend?: string, packaged = false, projectPath: string | null = process.cwd(), モデル設定: Record<string, string> = {}, modelFile = モデル保存先('live'), 自動接続 = false, authorization?: InternalAuthorization) {
  const 作業フォルダ = projectPath ? { 名前: basename(projectPath) || projectPath, パス: projectPath } : null;
  const target = new URL(backend || ローカル接続先(root, projectPath));
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('バックエンドには http(s)://ホスト:ポート を指定してください。');
  }
  const auth = authorization || internalAuthorization(target, [root, projectPath]);
  const prefix = `/${randomBytes(24).toString('hex')}/`;
  const sockets = new Set<Socket>();
  const viewers = new Set<import('node:http').ServerResponse>();
  // 画面を閉じて60秒で終了する。Codespaces では初回接続まで終了しない。
  let lastViewer = Date.now() + 60_000;
  let 画面接続済み = false;
  const upstreamSockets = new Set<Socket>();
  const upstreamRequests = new Set<ReturnType<typeof httpRequest>>();
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  let origin = '';
  let allowed: 接続元許可 | undefined;
  const apiPaths = new Set(['/core/AIコア/モデル情報/取得', '/core/AIコア/モデル情報/設定']);
  const assets: Record<string, [string, string]> = {
    'development/app.js': [join(root, 'dist/development/app.js'), 'text/javascript; charset=utf-8'],
    'development/app.css': [join(root, 'dist/development/app.css'), 'text/css; charset=utf-8'],
    'development/THIRD_PARTY_NOTICES.txt': [join(root, 'dist/development/THIRD_PARTY_NOTICES.txt'), 'text/plain; charset=utf-8'],
    'sending.png': [join(root, packaged ? 'dist/sending.png' : 'media/sending.png'), 'image/png'],
    'AiDiy.png': [join(root, packaged ? 'dist/AiDiy.png' : 'media/AiDiy.png'), 'image/png'],
    'microphone.png': [join(root, packaged ? 'media/microphone.png' : 'aidiy_live/media/microphone.png'), 'image/png'],
    'speaker.png': [join(root, packaged ? 'media/speaker.png' : 'aidiy_live/media/speaker.png'), 'image/png'],
    'capture.js': [join(root, packaged ? 'media/capture.js' : 'aidiy_live/media/capture.js'), 'text/javascript; charset=utf-8'],
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!allowed?.host(req.headers.host) || (req.headers.origin && !allowed.origin(req.headers.origin))) {
      res.writeHead(403).end(); return;
    }
    const path = req.url?.startsWith(prefix) ? req.url.slice(prefix.length) : null;
    if (path === 'presence' && req.method === 'GET') {
      画面接続済み = true;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive' });
      res.write('data: connected\n\n'); viewers.add(res);
      res.on('close', () => { viewers.delete(res); lastViewer = Date.now(); });
      return;
    }
    if (path === 'config' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ backend: target.origin, 作業フォルダ, 保存モデル設定: ライブモデル読込(modelFile),
        自動接続,
        ...(Object.keys(モデル設定).length ? { モデル設定 } : {}) })); return;
    }
    // 画面は拡張の単独起動・IDE とも Vue 画面だけを返す。
    if (path === '' && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");
      res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="development/app.css"><script id="development-config" type="application/json">{"kind":"live","host":false,"base":"./","icon":"AiDiy.png","iconAssets":"development/assets/catppuccin_icons/"}</script><div id="app"></div><script src="development/app.js" defer></script></html>');
      return;
    }
    const iconAsset = path?.startsWith('development/') ? catppuccinAsset(path.slice('development/'.length)) : undefined;
    const asset = path !== null && Object.hasOwn(assets, path) ? assets[path] : iconAsset ? [join(root, 'dist/development', iconAsset[0]), iconAsset[1]] : undefined;
    if (asset && req.method === 'GET') {
      try {
        res.setHeader('Content-Type', asset[1]);
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
        if (iconAsset) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.end(readFileSync(asset[0]));
      } catch { res.writeHead(500).end('画面ファイルを読み込めません。live:compile を実行してください。'); }
      return;
    }
    let api = '';
    try { api = path?.startsWith('api/') ? '/' + decodeURI(path.slice(4)) : ''; }
    catch { res.writeHead(400).end(); return; }
    const saveModel = path === 'model';
    if ((!saveModel && !apiPaths.has(api)) || req.method !== 'POST') { res.writeHead(404).end(); return; }
    if (!allowed?.origin(req.headers.origin) || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403).end(); return; }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      if (saveModel) {
        try {
          ライブモデル保存(JSON.parse(body.toString('utf8')), modelFile);
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: error instanceof Error ? error.message : String(error) }));
        }
        return;
      }
      const proxy = request(new URL(api, target), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, ...auth() }, timeout: 30000 }, upstream => {
        res.writeHead(upstream.statusCode || 502, { 'Content-Type': 'application/json' });
        upstream.on('error', () => res.destroy());
        upstream.pipe(res);
      });
      upstreamRequests.add(proxy);
      proxy.on('close', () => upstreamRequests.delete(proxy));
      proxy.on('timeout', () => proxy.destroy(new Error('接続タイムアウト')));
      proxy.on('error', error => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ status: 'NG', message: 接続エラー詳細(target, error) }));
        else res.destroy();
      });
      proxy.end(body);
    } catch { if (!res.headersSent) res.writeHead(400).end(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== prefix + 'socket' || !allowed?.host(req.headers.host) || !allowed.origin(req.headers.origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    let headers: Record<string, string>;
    try { headers = auth(); }
    catch { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    const proxy = request(new URL('/core/ws/AIコア', target), {
      headers: { ...headers, host: target.host, origin: target.origin, connection: 'Upgrade', upgrade: 'websocket',
        'sec-websocket-key': req.headers['sec-websocket-key'] || '', 'sec-websocket-version': '13' }, timeout: 30000,
    });
    upstreamRequests.add(proxy);
    proxy.on('close', () => upstreamRequests.delete(proxy));
    proxy.on('upgrade', (response, upstream, upstreamHead) => {
      proxy.setTimeout(0);
      upstream.setTimeout(0);
      upstreamSockets.add(upstream);
      upstream.on('close', () => upstreamSockets.delete(upstream));
      const headers = Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n\r\n`);
      if (head.length) upstream.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      upstream.pipe(socket); socket.pipe(upstream);
      socket.on('close', () => upstream.destroy());
      upstream.on('close', () => socket.destroy());
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    });
    proxy.on('response', response => { response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
    proxy.on('timeout', () => proxy.destroy());
    proxy.on('error', () => socket.destroy());
    socket.on('close', () => proxy.destroy());
    socket.on('error', () => proxy.destroy());
    proxy.end();
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('待受ポートを取得できません。');
  origin = `http://127.0.0.1:${address.port}`;
  allowed = new 接続元許可(address.port);
  return {
    url: origin + prefix,
    publicUrl: allowed.公開URL(prefix),
    idleMilliseconds: () => viewers.size || (!画面接続済み && allowed?.初回待機時間 === undefined) ? 0 : Date.now() - lastViewer,
    close: async () => {
      for (const proxy of upstreamRequests) proxy.destroy();
      for (const socket of upstreamSockets) socket.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
