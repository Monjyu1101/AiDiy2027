// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

for (const kind of ['cpu', 'console', 'code', 'live', 'ide', 'task', 'team']) {
  test(`${kind}: 配布用cmdは同じフォルダの入口へ全引数をそのまま渡す`, () => {
    const wrapper = readFileSync(new URL(`../aidiy_${kind}.cmd`, import.meta.url), 'utf8');
    // 最後のnodeを直接実行し、その終了コードを後続コマンドで上書きしない。
    assert.equal(wrapper.replace(/\r\n/g, '\n'),
      `@echo off\nnode "%~dp0aidiy_${kind}\\launch.mjs" %*\n`);

    // 実GUIは起動せず、ラッパーの転送先が呼出元cwdに依存しないことを確認する。
    const entry = fileURLToPath(new URL(`../aidiy_${kind}/launch.mjs`, import.meta.url));
    const result = spawnSync(process.execPath, [entry, '--help'], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 15_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.startsWith(`aidiy_${kind} `), result.stdout);
  });
}

test('ConsoleのWindowsラッパーはCRLF・BOMなしで配布する', () => {
  const wrapper = readFileSync(new URL('../aidiy_console.cmd', import.meta.url));
  assert.equal(wrapper[0], 0x40);
  assert.equal(wrapper.toString().replace(/\r\n/g, '').includes('\n'), false);
});
