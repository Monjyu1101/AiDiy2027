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

import { readFile } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import semver from 'semver';

export function resolveLocked(packages, owner, name) {
  let folder = owner;
  while (true) {
    const key = posix.join(folder, 'node_modules', name);
    if (packages[key]) return { key, entry: packages[key] };
    if (!folder) return null;
    const marker = folder.lastIndexOf('node_modules/');
    folder = marker < 0 ? '' : folder.slice(0, marker).replace(/\/$/, '');
  }
}

// optional peer は未導入でもよいが、祖先に同名の非互換版がある場合は
// npm 10 の clean install が互換版を要求する。OS によらず lock だけで検出する。
export function lockErrors(lock, manifest) {
  const packages = lock.packages;
  if (!packages?.['']) return [{ message: 'packages を含む lockfile が必要です。' }];
  const errors = [];
  if (manifest) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      if (JSON.stringify(Object.entries(manifest[field] ?? {}).sort()) !== JSON.stringify(Object.entries(packages[''][field] ?? {}).sort())) {
        errors.push({ message: `package.json と lock の ${field} が一致しません。` });
      }
    }
  }
  for (const [owner, entry] of Object.entries(packages)) {
    // npm の完全な依存検証を再実装せず、今回問題となった Opus peer に限定する。
    const edges = entry.peerDependencies?.opusscript ? { opusscript: entry.peerDependencies.opusscript } : {};
    for (const [name, range] of Object.entries(edges)) {
      const target = resolveLocked(packages, owner, name);
      const optionalPeer = entry.peerDependenciesMeta?.[name]?.optional === true && !entry.dependencies?.[name] && !entry.optionalDependencies?.[name];
      if (!target && optionalPeer) continue;
      if (!target || (semver.validRange(range) && !semver.satisfies(target.entry.version, range))) {
        errors.push({ owner, name, range, message: `${owner || '(root)'}: ${name}@${range} に対応する lock がありません（${target?.entry.version ?? 'missing'}）。` });
      }
    }
  }
  return errors;
}
export async function verifyLock(root) {
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const errors = lockErrors(lock, manifest);
  if (errors.length) throw new Error(errors.map(error => error.message).join('\n'));
  return lock;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyLock(fileURLToPath(new URL('..', import.meta.url)));
    console.log('Discord の直接宣言と Opus peer lock は整合しています。');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
