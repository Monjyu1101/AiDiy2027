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

const { existsSync, readFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

// 接続先ホストはローカル固定。AiDiy配置先を優先し、共通設定のポートだけ読む。
function ローカルポート接続先(key, defaultPort, folders) {
  const visited = new Set();
  for (const folder of folders) {
    if (!folder) continue;
    let current = resolve(folder);
    while (!visited.has(current)) {
      visited.add(current);
      const file = join(current, '_config', 'AiDiy_key.json');
      if (existsSync(file)) {
        let settings;
        try { settings = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
        catch { throw new Error('共通設定 AiDiy_key.json を読み込めません。'); }
        const port = Number(settings[key] ?? defaultPort);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`共通設定 ${key} は1〜65535の整数で指定してください。`);
        return `http://127.0.0.1:${port}`;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  // 配布済みVS Code拡張など、AiDiyの配置先を参照できない場合の既定値。
  return `http://127.0.0.1:${defaultPort}`;
}
function ローカル接続先(...folders) { return ローカルポート接続先('PORT_CORE', 8091, folders); }
function ローカルTools接続先(...folders) { return ローカルポート接続先('PORT_TOOLS', 8095, folders); }
module.exports = { ローカル接続先, ローカルTools接続先 };
