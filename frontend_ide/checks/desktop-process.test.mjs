// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

for (const background of [true, false]) {
  test(`Electron出力: ${background ? '背景起動は起動元に改行・制御文字を出さない' : '待機起動はログを表示する'}、IPC終了も維持する`, { timeout: 10000 }, async t => {
    // 親プロセスの実stdout/stderrを観測し、inheritによる直接出力も検出する。
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { once } from 'node:events';
      import { spawnDesktop } from ${JSON.stringify(new URL('../デスクトップ/desktop-process.mjs', import.meta.url).href)};
      const desktop = spawnDesktop(process.execPath, [${JSON.stringify(fileURLToPath(new URL('./console-child.cjs', import.meta.url)))}], {background:${background}});
      const ended = once(desktop, 'exit');
      await once(desktop, 'message');
      const stdout=[],stderr=[];
      desktop.stdout.on('data',chunk=>stdout.push(chunk));
      desktop.stderr.on('data',chunk=>stderr.push(chunk));
      await new Promise(resolve=>setTimeout(resolve,200));
      if(!stdout.length||!stderr.length)throw Error('子の継続出力を確認できません');
      desktop.send('close');
      const [code]=await ended;
      if(code!==0)throw Error('終了失敗');
      console.log('CLOSED');
    `], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    assert.equal((await once(child, 'exit'))[0], 0, stderr);
    if (background) { assert.equal(stdout, 'CLOSED\n'); assert.equal(stderr, ''); }
    else { assert.match(stdout, /\r\n.*CLOSED/s); assert.match(stderr, /\x1b\[2B/); }
  });
}
