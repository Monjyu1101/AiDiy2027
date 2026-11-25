// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// AntigravityはGemini APIとは別のモデルIDを使う。会話を生成せずCLIの一覧だけを読む。
import {execFile} from 'node:child_process';
import {promisify, stripVTControlCharacters} from 'node:util';
import {catalog, resolveProgram} from '../診断/probes.mjs';

// OAuth経路はプラットフォームの公式実行名だけを使い、旧CLIの探索候補とは分ける。
export function agyOAuthEntry(entry, platform = process.platform) {
  return platform === 'win32' ? {...entry, commands:['agy.exe']}
    : {...entry, commands:['agy'],paths:{...entry.paths,[platform]:[...(entry.paths?.[platform]??[]),'$HOME/.local/bin/agy']}};
}

export async function resolveAgyOAuth({entries, loadEntries = catalog, resolve = resolveProgram, env = process.env, platform = process.platform} = {}) {
  const programs = entries ?? await loadEntries();
  const managed = programs.find(item => item.id === 'agy');
  const entry = (platform === 'win32' ? programs.find(item => item.id === 'agy-exe') : null) ?? managed;
  return entry ? await resolve(agyOAuthEntry(entry,platform),{env,platform}) : null;
}

const ALTERNATIVE_AUTH = new Set(['GEMINI_API_KEY','GOOGLE_API_KEY','AGY_ADC_AUTH','GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_GEMINI_BASE_URL']);
export async function antigravityModels({loadEntries = catalog, resolve = resolveProgram, run = promisify(execFile), oauthOnly = false, env = process.env, platform = process.platform} = {}) {
  try {
    const entry = oauthOnly ? null : (await loadEntries()).find(item => item.id === 'agy');
    const executable = oauthOnly ? await resolveAgyOAuth({loadEntries,resolve,env,platform}) : entry && await resolve(entry);
    if (!executable) return {};
    const {stdout} = await run(executable, ['models'], {
      encoding:'utf8', timeout:15000, maxBuffer:256 * 1024, windowsHide:true, shell:false,
      ...(oauthOnly ? {env:Object.fromEntries(Object.entries(env).filter(([key])=>!ALTERNATIVE_AUTH.has(key.toUpperCase())))} : {}),
    });
    const models = {};
    for (const line of stripVTControlCharacters(stdout).split(/\r?\n/)) {
      // CLIのID<TAB>表示名のみ受け付け、進捗・認証案内は候補にしない。
      const match = (oauthOnly ? /^([a-zA-Z0-9][a-zA-Z0-9._:/-]*)(?:\t| {2,})[^\t]+$/ : /^([a-zA-Z0-9][a-zA-Z0-9._:/-]*)\t[^\t]+$/).exec(line.trim());
      if (match) models[match[1]] = `yyyy/mm/dd - ${match[1]}`;
    }
    return models;
  } catch {
    // 未認証・未対応版・タイムアウト時は呼出元でauto/sameだけを残す。
    return {};
  }
}
