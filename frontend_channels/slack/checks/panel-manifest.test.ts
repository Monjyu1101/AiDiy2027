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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('Discord 側が無い隔離環境でもビルド/manifest照合と改変検出を保つ', { timeout: 120_000 }, async () => {
  const repository = await mkdtemp(join(tmpdir(), 'aidiy-slack-manifest-'));
  const folder = join(repository, 'frontend_channels', 'slack');
  try {
    await mkdir(folder, { recursive: true });
    for (const entry of ['package.json', 'package-lock.json', 'scripts', 'panel']) await cp(join(root, entry), join(folder, entry), { recursive: true });
    await symlink(join(root, 'node_modules'), join(folder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const run = (script: string) => spawnSync(process.execPath, [join(folder, 'scripts', script)], { cwd: folder, encoding: 'utf8' });
    assert.equal(run('verify-panel.mjs').status, 0);
    for (const entry of ['panel/view.js', 'panel/components/接続/接続パネル.vue', 'panel/components/接続/パネル状態.js', 'panel/titlebar.css', 'package-lock.json']) {
      const path = join(folder, entry);
      const original = await readFile(path, 'utf8');
      await writeFile(path, original + '\n// changed fixture\n');
      assert.equal(run('verify-panel.mjs').status, 1, entry);
      await writeFile(path, original);
      assert.equal(run('verify-panel.mjs').status, 0);
    }
    const built = run('build-panel.mjs');
    assert.equal(built.status, 0, built.stderr);
    assert.equal(run('verify-panel.mjs').status, 0);
  } finally { await rm(repository, { recursive: true, force: true }); }
});
