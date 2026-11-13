// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Diag 画面テストの Vue を ui/ の 1 実体にそろえる。
//
// frontend_diag には Diag 本体用（frontend_diag/node_modules/vue）と、画面ビルド・検証用
// （frontend_diag/ui/node_modules/vue）の 2 つの Vue がある。テストは ui/ の Vue で画面を描くが、
// 画面モジュール（*.mjs）を Node の import() で読むと、その中の 'vue' は配置場所から辿って
// 上位の Vue（別実体）に解決される。実体が違うと ref の変化が画面や watch へ伝わらない。
//
// require('./ui-vue.cjs') を画面モジュールの import() より前に実行すると、以後の 'vue' の import を
// ui/ の Vue（require('vue') と同じ実体）へ向ける。ESM のテストは静的 import が先に解決されるため、
// 画面モジュールはこのファイルの読込後に動的 import() で読むこと。
'use strict';
const path = require('node:path');
const { createRequire, registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');

const uiRequire = createRequire(path.join(__dirname, '../ui/package.json'));
const vueEntry = uiRequire.resolve('vue');
// vue/index.mjs は './index.js'（require('vue') の本体）を再公開するので、同じ実体になる。
const vueUrl = pathToFileURL(path.join(path.dirname(vueEntry), 'index.mjs')).href;

if (!globalThis.__aidiyDiagUiVueHook) {
  globalThis.__aidiyDiagUiVueHook = true;
  registerHooks({
    resolve: (specifier, context, next) => (specifier === 'vue' ? { url: vueUrl, shortCircuit: true } : next(specifier, context)),
  });
}

module.exports = { uiRequire, vue: uiRequire('vue') };
