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

const { createHash } = require('node:crypto');
const { existsSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const outputs = ['dist/aidiy_live/server.cjs', 'aidiy_live/dist/extension.js'];
const record = 'dist/aidiy_live/build-state.json';
function sourceHash(root) {
  const files = ['aidiy_live/build.mjs', 'aidiy_live/build-state.cjs', 'aidiy_live/local-backend.cjs',
    'aidiy_live/microphone.py', 'aidiy_live/tsconfig.json', 'tsconfig.json', 'package.json', 'package-lock.json',
    'media/AiDiy.png', 'media/sending.png'];
  const walk = directory => {
    if (!existsSync(join(root, directory))) return;
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  for (const directory of ['aidiy_live/src', 'aidiy_live/media', 'src']) walk(directory);
  const hash = createHash('sha256');
  for (const path of files.sort()) {
    hash.update(path).update('\0');
    hash.update(existsSync(join(root, path)) ? readFileSync(join(root, path)) : '<missing>');
    hash.update('\0');
  }
  return hash.digest('hex');
}
function outputHashes(root) {
  return Object.fromEntries(outputs.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
}
function ビルド更新が必要(root) {
  try {
    const state = JSON.parse(readFileSync(join(root, record), 'utf8'));
    if (state.source !== sourceHash(root)) return true;
    const current = outputHashes(root);
    return outputs.some(path => current[path] !== state.outputs?.[path]);
  } catch { return true; }
}
function ビルド状態保存(root) {
  writeFileSync(join(root, record), JSON.stringify({ source: sourceHash(root), outputs: outputHashes(root) }));
}
module.exports = { ビルド更新が必要, ビルド状態保存 };
