// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 本番の起動・実Electron・実Viteを使う。8092が空いているときに手動実行する。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runAvatar, portOpen } from '../launch.mjs';

assert.equal(await portOpen(), false, '8092の既存サービスを終了してから実行してください');
for (let round = 1; round <= 2; round++) {
  let ready = false, response;
  const children = [];
  const code = await runAvatar({
    launch(command, args, options) {
      if (options.env?.AIDIY_AVATAR_MANAGED === '1') args = ['--require', fileURLToPath(new URL('./lifecycle-probe.cjs', import.meta.url)), ...args];
      const child = spawn(command, args, options);
      children.push(child);
      return child;
    },
    ready(info) {
      ready = true;
      response = fetch(info.url).then(async result => ({ status: result.status, avatar: (await result.text()).includes('/src/main.ts') }));
    },
  });
  assert.equal(ready, true);
  assert.deepEqual(await response, { status: 200, avatar: true });
  assert.equal(code, 0);
  for (let i = 0; i < 50 && await portOpen(); i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await portOpen(), false, 'ログイン終了後は8092を解放');
  for (const child of children) assert.ok(child.exitCode !== null || child.signalCode, '所有プロセスは終了済み');
  console.log(`実機 ${round}: ログイン表示・Web 200・補助窓残存時の全終了・8092解放 OK`);
}
