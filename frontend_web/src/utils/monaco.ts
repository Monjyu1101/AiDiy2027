// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -*- coding: utf-8 -*-
// Monaco Editor ユーティリティ: Worker設定 + 拡張子→言語マッピング

import * as monaco from 'monaco-editor';

// ---- Web Worker 設定 (Vite ESM 対応) ----
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// ---- 拡張子 → Monaco 言語ID マッピング ----
const 拡張子と言語: Record<string, string> = {
  py: 'python',
  vue: 'html',          // vue は html モードで十分な構文ハイライトが得られる
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  json: 'json',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  bat: 'bat',
  cmd: 'bat',
  ps1: 'powershell',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  ini: 'ini',
  env: 'ini',
  toml: 'ini',          // Monaco は toml 標準未対応 → ini で代替
  cfg: 'ini',
  conf: 'ini',
  txt: 'plaintext',
  log: 'plaintext',
  csv: 'plaintext',
  dockerfile: 'dockerfile',
  makefile: 'plaintext',
  gitignore: 'plaintext',
};

/** ファイル名から Monaco 用言語IDを推定する */
export const モナコ言語推定 = (ファイル名: string): string => {
  const ドット位置 = (ファイル名 ?? '').lastIndexOf('.');
  if (ドット位置 < 0) {
    // 拡張子なし: Dockerfile, Makefile 等
    const ベース名 = ファイル名.split('/').pop()?.split('\\').pop()?.toLowerCase() ?? '';
    if (ベース名 === 'dockerfile') return 'dockerfile';
    return 'plaintext';
  }
  const 拡張子 = ファイル名.slice(ドット位置 + 1).toLowerCase();
  return 拡張子と言語[拡張子] ?? 'plaintext';
};

export { monaco };
