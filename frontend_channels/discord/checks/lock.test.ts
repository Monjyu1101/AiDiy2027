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
import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error 検証用 JavaScript の共有
import { lockErrors, resolveLocked } from '../scripts/verify-lock.mjs';
// @ts-expect-error 検証用 JavaScript の共有
import { preserveOptionalPeers, updateElectron } from '../scripts/update-electron.mjs';

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const opus = 'node_modules/@discordjs/voice/node_modules/opusscript';
const prism = 'node_modules/@discordjs/voice/node_modules/prism-media';

test('配布 lock は optional peer を含めて整合する', () => {
  assert.deepEqual(lockErrors(lock, manifest), []);
  assert.equal(resolveLocked(lock.packages, prism, 'opusscript').entry.version, '0.0.8');
});
test('npm 11 が省略した optional peer は root の非互換版で代用できない', () => {
  const broken = structuredClone(lock);
  delete broken.packages[opus];
  assert.ok(lockErrors(broken, manifest).some((error: any) => error.name === 'opusscript'));
  assert.deepEqual(preserveOptionalPeers(lock, broken), [opus]);
  assert.deepEqual(broken, lock);
  assert.deepEqual(lockErrors(broken, manifest), []);
});
test('npm 10 の正常な更新は変更せず、不要な optional peer を要求しない', () => {
  const unchanged = structuredClone(lock);
  assert.deepEqual(preserveOptionalPeers(lock, unchanged), []);
  assert.deepEqual(unchanged, lock);
  delete unchanged.packages[prism].peerDependencies.opusscript;
  delete unchanged.packages[opus];
  assert.deepEqual(preserveOptionalPeers(lock, unchanged), []);
  assert.deepEqual(lockErrors(unchanged, manifest), []);
});
test('所有パッケージ・peer 宣言の変更時は古い entry を復元しない', () => {
  for (const change of [
    (entry: any) => { entry.version = '1.3.6'; },
    (entry: any) => { entry.peerDependencies.opusscript = '^0.0.7'; },
  ]) {
    const changed = structuredClone(lock);
    delete changed.packages[opus];
    change(changed.packages[prism]);
    assert.deepEqual(preserveOptionalPeers(lock, changed), []);
    assert.ok(lockErrors(changed, manifest).length > 0);
  }
});
test('root 宣言不一致を検出するが、未導入でよい optional 依存を要求しない', () => {
  const absent = structuredClone(lock);
  absent.packages[prism].optionalDependencies = { 'not-installed-optional-fixture': '^1.0.0' };
  absent.packages[prism].peerDependencies['not-installed-peer-fixture'] = '^1.0.0';
  absent.packages[prism].peerDependenciesMeta['not-installed-peer-fixture'] = { optional: true };
  assert.deepEqual(lockErrors(absent, manifest), []);
  const mismatch = structuredClone(manifest);
  mismatch.dependencies.vue = '0.0.0';
  assert.ok(lockErrors(lock, mismatch).some((error: any) => error.message.includes('package.json')));
});

test('入力 lock の欠落は npm 更新前に拒否し、更新失敗時は正常 lock を保持する', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'aidiy-opus-lock-'));
  try {
    await writeFile(join(folder, 'package.json'), JSON.stringify(manifest));
    const broken = structuredClone(lock);
    delete broken.packages[opus];
    const lockPath = join(folder, 'package-lock.json');
    await writeFile(lockPath, JSON.stringify(broken));
    const cli = join(folder, 'fake-npm.cjs');
    const marker = join(folder, 'called');
    await writeFile(cli, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called'); process.exit(1);`);
    await assert.rejects(updateElectron(folder, cli), /opusscript/);
    await assert.rejects(access(marker));
    const original = JSON.stringify(lock, null, 2) + '\n';
    await writeFile(lockPath, original);
    await writeFile(cli, `require('node:fs').writeFileSync(${JSON.stringify(lockPath)}, '{}'); process.exit(1);`);
    await assert.rejects(updateElectron(folder, cli), /npm update electron failed/);
    assert.equal(await readFile(lockPath, 'utf8'), original);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
