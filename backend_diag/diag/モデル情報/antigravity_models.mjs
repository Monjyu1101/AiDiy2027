// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// AntigravityはGemini APIとは別のモデルIDを使う。会話を生成せずCLIの一覧だけを読む。
import {execFile} from 'node:child_process';
import {promisify, stripVTControlCharacters} from 'node:util';
import {catalog, resolveProgram} from '../診断/probes.mjs';

export async function antigravityModels({loadEntries = catalog, resolve = resolveProgram, run = promisify(execFile)} = {}) {
  try {
    const entry = (await loadEntries()).find(item => item.id === 'agy');
    const executable = entry && await resolve(entry);
    if (!executable) return {};
    const {stdout} = await run(executable, ['models'], {
      encoding:'utf8', timeout:15000, maxBuffer:256 * 1024, windowsHide:true, shell:false,
    });
    const models = {};
    for (const line of stripVTControlCharacters(stdout).split(/\r?\n/)) {
      // CLIのID<TAB>表示名のみ受け付け、進捗・認証案内は候補にしない。
      const match = /^([a-zA-Z0-9][a-zA-Z0-9._:/-]*)\t[^\t]+$/.exec(line.trim());
      if (match) models[match[1]] = `yyyy/mm/dd - ${match[1]}`;
    }
    return models;
  } catch {
    // 未認証・未対応版・タイムアウト時は呼出元でauto/sameだけを残す。
    return {};
  }
}
