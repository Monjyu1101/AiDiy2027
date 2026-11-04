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

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { パネルサービス, type パネル通知 } from './接続パネル/パネル中継';
import { 接続元許可 } from './共通連携/IDE連携';
import instanceLock from '../../frontend_ide/host/scripts/single-instance.cjs';

// ブラウザ版パネル（GitHub Codespaces・画面のない Linux 用）。画面は Electron 版と同じ panel/ のファイルを使い、
// IPC の代わりに WebSocket で panel-service.ts へ中継する。接続元の確認は aidiy_code / aidiy_live と共通。
const panelRoot = fileURLToPath(new URL('../panel', import.meta.url));
const assets: Record<string, string> = {
  'AiDiy.png': 'image/png', 'AiDiy_discord.png': 'image/png', 'style.css': 'text/css', 'titlebar.css': 'text/css', 'view.js': 'text/javascript', 'visualizer.js': 'text/javascript', 'web-bridge.js': 'text/javascript',
};

export function ブラウザ用HTML(html: string) {
  const script = '<script src="visualizer.js" defer></script>';
  if (!html.includes(script) || !html.includes("connect-src 'none'")) throw new Error('panel/index.html の構成が想定と異なります。');
  return html.replace("connect-src 'none'", "connect-src 'self'").replace(script, `<script src="web-bridge.js"></script>\n  ${script}`);
}

export async function パネルWeb起動(options: { idleMs?: number; firstIdleMs?: number; service?: typeof パネルサービス } = {}) {
  // 画面を閉じて60秒で終了する。Codespaces では初回接続まで終了しない。
  const { idleMs = 60_000 } = options;
  const prefix = `/${randomBytes(24).toString('hex')}/`;
  const clients = new Set<WebSocket>();
  const broadcast = (data: パネル通知) => {
    const text = JSON.stringify(data);
    for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(text);
  };
  const service = (options.service ?? パネルサービス)(broadcast);
  const sockets = new Set<Socket>();
  let allowed: InstanceType<typeof 接続元許可> | undefined;
  let idle: NodeJS.Timeout | undefined;
  let closing: Promise<void> | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // ローカル（Codespaces ではポート転送先も）専用。別サイトからの操作や DNS rebinding を受け付けない。
    if (!allowed?.host(req.headers.host) || (req.headers.origin && !allowed.origin(req.headers.origin)) || req.method !== 'GET') {
      res.writeHead(403).end(); return;
    }
    const url = req.url ?? '';
    try {
      const path = url.startsWith(prefix) ? url.slice(prefix.length) : null;
      if (path === '') {
        res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(ブラウザ用HTML(readFileSync(join(panelRoot, 'index.html'), 'utf8')));
        return;
      }
      if (path !== null && Object.hasOwn(assets, path)) {
        res.writeHead(200, { 'Content-Type': assets[path].startsWith('image/') ? assets[path] : `${assets[path]}; charset=utf-8` }).end(readFileSync(join(panelRoot, path)));
        return;
      }
      res.writeHead(404).end();
    } catch { if (!res.headersSent) res.writeHead(500).end(); else res.end(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 20 * 1024 * 1024 });
  const 待機開始 = (ms: number) => {
    clearTimeout(idle);
    // Electron 版でパネルを閉じた時と同じく、画面を閉じたら（再読込の猶予の後）Bot も終了する。
    if (!clients.size) idle = setTimeout(() => { void close(); }, ms);
  };
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== `${prefix}ws` || !allowed?.host(req.headers.host) || !allowed.origin(req.headers.origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      clients.add(ws); clearTimeout(idle);
      ws.on('message', async data => {
        let message: { id?: unknown; action?: unknown; value?: unknown };
        try { message = JSON.parse(String(data)); } catch { return; }
        if (typeof message?.id !== 'number') return;
        const reply = await service.要求(message.action, message.value);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: message.id, ...reply }));
      });
      ws.on('close', () => { clients.delete(ws); 待機開始(idleMs); });
      ws.on('error', () => ws.terminate());
    });
  });
  function close() {
    closing ??= (async () => {
      clearTimeout(idle);
      for (const client of clients) client.terminate();
      try { await service.終了(); }
      finally {
        wss.close();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
        resolveClosed();
      }
    })();
    return closing;
  }
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('待受ポートを取得できません。');
  allowed = new 接続元許可(address.port);
  const firstIdleMs = options.firstIdleMs ?? allowed.初回待機時間;
  if (firstIdleMs !== undefined) 待機開始(firstIdleMs);
  return { url: allowed.ローカル + prefix, publicUrl: allowed.公開URL(prefix), service, close, closed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let instance: Awaited<ReturnType<typeof instanceLock.起動ロック>> | undefined;
  try {
    instance = await instanceLock.起動ロック('aidiy_discord');
    if (!instance) {
      if (process.env.AIDIY_DISCORD_READY) writeFileSync(process.env.AIDIY_DISCORD_READY, JSON.stringify({ alreadyRunning: true }));
      console.log('aidiy_discord は起動済みです。');
      process.exit(0);
    }
    const app = await パネルWeb起動();
    const shutdown = () => { void app.close().then(() => process.exit(0), () => process.exit(1)); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    void app.closed.then(() => process.exit(0));
    if (process.env.AIDIY_DISCORD_READY) writeFileSync(process.env.AIDIY_DISCORD_READY, JSON.stringify({ url: app.url, publicUrl: app.publicUrl, pid: process.pid, windowShown: true }));
    console.log(`AiDiy Discord ブラウザ版: ${app.publicUrl}`);
    // 自動接続は保存済みの設定があるときだけ。初回はモデル設定画面から始める。
    if (process.env.AIDIY_DISCORD_CONNECT === '1') void app.service.要求('auto-start', undefined);
  } catch (error) {
    await instance?.close();
    console.error(`Discord パネル（ブラウザ版）を起動できません: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
