// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 接続時の状態ハンドラが送信しても、サーバーの初回受信は connect になる。
// node --test frontend_avatar/checks/websocket-handshake.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');

for (const project of ['frontend_avatar', 'frontend_web']) {
  test(`${project}: 状態同期より先に接続通知を送り、initでセッションを確定する`, async () => {
    const { Client, sockets } = require('./browser-auth-harness.cjs').harness(project);
    const client = new Client('ws://test', 'existing', 'input', '/project');
    client.onStateChange((connected) => {
      if (connected) client.updateState({ マイク: true });
    });
    // 初回接続と同じクライアントの再接続を検証する。
    for (let attempt = 0; attempt < 2; attempt++) {
      const connected = client.connect();
      const socket = sockets.at(-1);
      socket.open();
      assert.equal(socket.sent[0].type, 'connect', '接続通知が最初のパケットになる');
      assert.equal(socket.sent[0].ソケット番号, 'input');
      assert.equal(socket.sent[0].CODE_BASE_PATH, '/project');
      assert.equal(socket.sent[1].メッセージ識別, 'operations');
      socket.receive({ メッセージ識別: 'init', セッションID: 'existing', ソケット番号: 'input' });
      assert.equal(await connected, 'existing');
      client.disconnect();
    }
  });
}
