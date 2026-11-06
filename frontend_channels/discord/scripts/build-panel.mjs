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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import { verifyLock } from './verify-lock.mjs';
import { 配布物一覧 } from './verify-panel.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await verifyLock(root);
// file:// の Electron と token 配下の Web の両方で同じ URL を使用する。
// SFC を事前コンパイルし、unsafe-eval と CDN を必要としない配布用成果物を作る。
await build({
  entryPoints: [resolve(root, 'panel/main.js')], outfile: resolve(root, 'panel/view.js'),
  tsconfigRaw: { compilerOptions: { alwaysStrict: true } },
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true,
  define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  plugins: [{ name: 'vue-sfc', setup(build) {
    build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
      const { descriptor, errors } = parse(await readFile(path, 'utf8'), { filename: path });
      if (errors.length) throw errors[0];
      const compiled = compileScript(descriptor, { id: path.slice(root.length), inlineTemplate: true, templateOptions: { transformAssetUrls: false, compilerOptions: { hoistStatic: true } } });
      return { contents: compiled.content, loader: 'js', resolveDir: dirname(path) };
    });
  } }],
});
// 配色は module 内の titlebar.css コピーだけを使う。
// Discord の正本アイコンは panel/ に置き、そのまま配布する。
await writeFile(resolve(root, 'panel/build-manifest.json'), JSON.stringify(await 配布物一覧(), null, 2) + '\n');
console.log('Discord 接続パネルの配布用 Vue バンドルを更新しました。');
