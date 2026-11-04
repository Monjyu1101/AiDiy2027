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

import { build } from 'esbuild';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const extension = await build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['vscode'], metafile: true });
await import('../aidiy_code/build.mjs');
// 画面は frontend_ide の Vue bundle（dist/development）を使う。ここでは拡張本体に同梱したパッケージの通知を出力する。
const packages = new Set(Object.keys(extension.metafile.inputs).filter(path => path.startsWith('node_modules/')).map(path => path.split('/')[1]));
const notices = [];
for (const name of [...packages].sort()) {
  const root = `node_modules/${name}`;
  const metadata = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
  for (const file of (await readdir(root)).filter(file => /^licen[sc]e/i.test(file))) {
    notices.push(`${name} ${metadata.version}\n${'='.repeat(60)}\n${await readFile(`${root}/${file}`, 'utf8')}`);
  }
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n\n'));
await import('../aidiy_live/build.mjs');

await import('../../scripts/build.mjs');
