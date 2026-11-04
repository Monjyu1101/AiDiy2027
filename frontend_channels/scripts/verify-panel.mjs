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

import { verifyLock } from './verify-lock.mjs';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function files(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(resolve(folder, entry.name)) : resolve(folder, entry.name)))).flat();
}
export async function 配布物一覧() {
  const paths = ['package.json', 'package-lock.json', 'scripts/build-panel.mjs', 'scripts/verify-panel.mjs', 'scripts/verify-lock.mjs', 'panel/main.js', 'panel/view.js', 'panel/index.html', 'panel/style.css', 'panel/titlebar.css', 'panel/visualizer.js', 'panel/THIRD_PARTY_NOTICES.txt'];
  paths.push('panel/AiDiy.png','discord/panel/AiDiy_discord.svg','discord/panel/AiDiy_discord.png','panel/AiDiy_discord.png');
  for (const folder of ['components']) paths.push(...(await files(resolve(root, 'panel', folder))).map(path => relative(root, path).replaceAll('\\', '/')));
  const entries = await Promise.all(paths.sort().map(async path => {
    const bytes = await readFile(resolve(root, path));
    const content = path.endsWith('.png') ? bytes : bytes.toString('utf8').replace(/\r\n/g, '\n');
    return [path, createHash('sha256').update(content).digest('hex')];
  }));
  return Object.fromEntries(entries);
}
export async function 配布物確認() {
  try {
    await verifyLock(root);
    const expected = JSON.parse(await readFile(resolve(root, 'panel/build-manifest.json'), 'utf8'));
    const actual = await 配布物一覧();
    return expected && Object.keys(expected).length === Object.keys(actual).length && Object.entries(actual).every(([name, hash]) => expected[name] === hash);
  } catch { return false; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!await 配布物確認()) { console.error('Discord Vue のソースと配布物が一致しません。frontend_channels で npm ci && npm run build:panel を実行してください。'); process.exitCode = 1; }
  else console.log('Discord Vue のソースと配布物は一致しています。');
}
