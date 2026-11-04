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
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir } from 'node:fs/promises';
import buildState from './build-state.cjs';
const root = fileURLToPath(new URL('.', import.meta.url));
await build({ absWorkingDir: root, entryPoints: ['src/server.ts'], outfile: '../dist/aidiy_live/server.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
await build({ absWorkingDir: root, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['vscode'] });
await mkdir(new URL('dist/', import.meta.url), { recursive: true });
await Promise.all([
  copyFile(new URL('../media/AiDiy.png', import.meta.url), new URL('dist/AiDiy.png', import.meta.url)),
  copyFile(new URL('../media/sending.png', import.meta.url), new URL('dist/sending.png', import.meta.url)),
  copyFile(new URL('microphone.py', import.meta.url), new URL('dist/microphone.py', import.meta.url)),
  copyFile(new URL('../node_modules/undici/LICENSE', import.meta.url), new URL('dist/THIRD_PARTY_NOTICES.txt', import.meta.url)),
  copyFile(new URL('../LICENSE', import.meta.url), new URL('LICENSE', import.meta.url)),
]);
buildState.ビルド状態保存(fileURLToPath(new URL('..', import.meta.url)));

await import('../../scripts/build.mjs');
