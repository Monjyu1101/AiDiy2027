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

import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockErrors, resolveLocked, verifyLock } from './verify-lock.mjs';

// npm 11 が更新対象外の optional peer を prune する場合だけ、更新前の
// 正規 lock のエントリを維持する。不正な入力 lock の修復や ci の代替はしない。
export function preserveOptionalPeers(before, after) {
  const restored = [];
  for (const error of lockErrors(after)) {
    const { owner, name, range } = error;
    if (!owner || name !== 'opusscript') continue;
    const previousOwner = before.packages[owner];
    const nextOwner = after.packages[owner];
    if (!previousOwner || JSON.stringify(previousOwner) !== JSON.stringify(nextOwner) || previousOwner.peerDependencies?.[name] !== range) continue;
    const old = resolveLocked(before.packages, owner, name);
    if (!old?.entry.optional || !old.entry.peer || after.packages[old.key]) continue;
    after.packages[old.key] = structuredClone(old.entry);
    restored.push(old.key);
  }
  after.packages = Object.fromEntries(Object.entries(after.packages).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return restored;
}

export async function updateElectron(root, npmCli = process.env.npm_execpath) {
  if (!npmCli) throw new Error('npm run update:electron から実行してください。');
  const before = await verifyLock(root);
  const lockPath = resolve(root, 'package-lock.json');
  const original = await readFile(lockPath, 'utf8');
  const result = spawnSync(process.execPath, [npmCli, 'update', 'electron', '--no-fund', '--no-audit'], { cwd: root, stdio: 'inherit', env: process.env });
  try {
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm update electron failed (${result.status ?? result.signal})`);
    const after = JSON.parse(await readFile(lockPath, 'utf8'));
    const restored = preserveOptionalPeers(before, after);
    const errors = lockErrors(after, JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')));
    if (errors.length) throw new Error(errors.map(error => error.message).join('\n'));
    if (restored.length) {
      await writeFile(lockPath, JSON.stringify(after, null, 2) + '\n');
      console.log(`npm 更新で省略された変更対象外の optional peer lock を維持しました: ${restored.join(', ')}`);
      // lock だけでなく node_modules も正規の clean install で一致させる。
      const installed = spawnSync(process.execPath, [npmCli, 'ci', '--no-fund', '--no-audit'], { cwd: root, stdio: 'inherit', env: process.env });
      if (installed.error) throw installed.error;
      if (installed.status !== 0) throw new Error(`npm ci after peer preservation failed (${installed.status ?? installed.signal})`);
    }
  } catch (error) {
    await writeFile(lockPath, original);
    throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await updateElectron(fileURLToPath(new URL('..', import.meta.url))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
