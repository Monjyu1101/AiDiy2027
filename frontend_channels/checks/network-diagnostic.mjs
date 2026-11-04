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

// 公開APIと認証前のGateway HELLOだけを確認する。Bot設定・トークンは読まない。
import { register } from 'tsx/esm/api';
import { request } from 'undici';
import { WebSocket } from 'ws';
register();
const { Discord通信 } = await import('../src/接続/ネットワーク接続.ts');

const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_USE_ENV_PROXY'];
console.log('プロキシ環境変数（値は表示しません）:', Object.fromEntries(keys.map(key => [key, Boolean(process.env[key])])));

for (const [label, env] of [['直接経路', {}], ['環境プロキシ経路', process.env]]) {
  let network;
  const startedAt = Date.now();
  try {
    network = new Discord通信(env);
    const response = await request('https://discord.com/api/v10/gateway', {
      dispatcher: network.rest, signal: AbortSignal.timeout(12_000), headersTimeout: 10_000, bodyTimeout: 10_000,
    });
    const data = await response.body.json();
    console.log(`${label} REST: HTTP ${response.statusCode} / ${Date.now() - startedAt}ms`);
    if (response.statusCode !== 200 || typeof data.url !== 'string') continue;
    const url = new URL(data.url);
    if (url.protocol !== 'wss:' || !(url.hostname === 'gateway.discord.gg' || url.hostname.endsWith('.discord.gg'))) {
      console.log(`${label} Gateway: 公開APIの接続先を確認できません。`); continue;
    }
    network.Gateway開始();
    await new Promise(resolve => {
      const socket = new WebSocket(`${url}?v=10&encoding=json`, { handshakeTimeout: 10_000 });
      const timer = setTimeout(() => finish('タイムアウト'), 12_000);
      let done = false;
      const finish = text => {
        if (done) return; done = true; clearTimeout(timer);
        console.log(`${label} Gateway: ${text}`); socket.terminate(); resolve();
      };
      socket.on('message', data => {
        try { finish(JSON.parse(data.toString()).op === 10 ? 'HELLO 受信（認証なし）' : '応答受信'); }
        catch { finish('応答の解析に失敗'); }
      });
      socket.on('error', error => finish(`失敗 (${error.code || 'WebSocketError'})`));
      socket.on('close', () => finish('切断'));
    });
  } catch (error) {
    // エラー本文にはプロキシURLが含まれ得るため、種類・コードだけを出す。
    console.log(`${label}: 失敗 (${error.code || error.cause?.code || error.name || 'Error'}) / ${Date.now() - startedAt}ms`);
  } finally { await network?.終了(); }
}
console.log('公開疎通のみの確認です。Bot認証・ClientReady・テキスト返信・音声UDPは実機で確認してください。');
