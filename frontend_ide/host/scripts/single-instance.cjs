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

'use strict';

const { createServer, createConnection } = require('node:net');
const ports = { aidiy_live: 18094, aidiy_discord: 18095, aidiy_slack: 18096 };

// GUI / ブラウザで共通の排他。プロセス終了時に OS が解放する。
async function 起動ロック(name, repeated = () => {}, port = ports[name]) {
  if (!Number.isInteger(port)) throw new Error('起動ロックの対象が不明です。');
  const server = createServer(socket => {
    socket.on('error', () => {});
    socket.end(name + '\n');
    try { repeated(); } catch { /* 終了中の画面は再表示しない */ }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve);
    });
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    await new Promise((resolve, reject) => {
      const socket = createConnection({ port, host: '127.0.0.1' });
      let reply = '';
      socket.setTimeout(2000, () => socket.destroy(new Error('起動状態を確認できませんでした。')));
      socket.on('error', reject);
      socket.on('data', data => {
        reply += data.toString('utf8');
        if (reply.length > 100) socket.destroy(new Error('起動状態の応答が不正です。'));
      });
      socket.on('end', () => {
        socket.destroy();
        if (reply.trim() === name) resolve();
        else reject(new Error('起動ロックのポートが別のプログラムに使われています。'));
      });
    });
    return null;
  }
  return {
    port: server.address().port,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

module.exports = { 起動ロック };
