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
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('他moduleのassetsが無い隔離環境でもビルド/manifest照合と改変検出を保つ', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'aidiy-discord-manifest-'));
  const folder = join(repository, 'frontend_channels');
  try {
    await mkdir(folder);
    for (const entry of ['package.json', 'package-lock.json', 'scripts', 'panel', 'discord']) {
      await cp(join(root, entry), join(folder, entry), { recursive: true });
    }
    await symlink(join(root, 'node_modules'), join(folder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const run = (script: string) => spawnSync(process.execPath, [join(folder, 'scripts', script)], { cwd: folder, encoding: 'utf8' });
    assert.equal(run('verify-panel.mjs').status, 0);
    const lockPath = join(folder, 'package-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.packages['node_modules/electron'].license += '-setup-fixture';
    await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
    assert.equal(run('verify-panel.mjs').status, 1, 'lock の更新だけでは古い manifest を承認しない');
    const built = run('build-panel.mjs');
    assert.equal(built.status, 0, built.stderr);
    assert.equal(run('verify-panel.mjs').status, 0);
    // 配布物と元ソースのどちらの変更も、再ビルド前には拒否する。
    for (const entry of ['panel/view.js', 'panel/components/接続/接続パネル.vue', 'panel/titlebar.css']) {
      const path = join(folder, entry);
      const original = await readFile(path, 'utf8');
      await writeFile(path, original + '\n// changed fixture\n');
      assert.equal(run('verify-panel.mjs').status, 1, entry);
      await writeFile(path, original);
      assert.equal(run('verify-panel.mjs').status, 0);
    }
    // manifest のハッシュだけが一致しても、欠けた optional peer は承認しない。
    delete lock.packages['node_modules/@discordjs/voice/node_modules/opusscript'];
    await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
    assert.equal(run('build-panel.mjs').status, 1, '不正 lock から配布物を再生成しない');
    const rehash = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { 配布物一覧 } from ${JSON.stringify(pathToFileURL(join(folder, 'scripts/verify-panel.mjs')).href)}; ` +
      `import { writeFile } from 'node:fs/promises'; await writeFile(${JSON.stringify(join(folder, 'panel/build-manifest.json'))}, JSON.stringify(await 配布物一覧()));`
    ], { encoding: 'utf8' });
    assert.equal(rehash.status, 0, rehash.stderr);
    assert.equal(run('verify-panel.mjs').status, 1, 'hash の再承認で依存欠落を隠せない');
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});
