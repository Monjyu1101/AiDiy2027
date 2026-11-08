// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import rules from '../../backend_server/core_router/フォルダ除外規則.json' with { type: 'json' };

// フィルターOFFでも依存物・VCS・キャッシュは列挙しない。ONはこの基準へbackup条件を追加する。
const ignored = new Set(rules.ignored.map(name => name.toLowerCase()));
export const alwaysExcludedDirectory = name => typeof name === 'string'
  && ignored.has(name.replace(/[. ]+$/, '').toLowerCase());

/** serving/project rootからの相対パスだけを検査する。ファイル名自体はディレクトリ名と混同しない。 */
export function hasAlwaysExcludedDirectory(path, directory = false) {
  if (typeof path !== 'string') return false;
  const parts = path.split(/[\\/]/);
  const folders = (directory ? parts : parts.slice(0, -1)).map(part=>part.replace(/[. ]+$/, '').toLowerCase());
  // profileのcookieやConsole履歴の入力済み秘密を汎用ファイルAPI・AI解析から隠す。
  const profile = folders.some((part,index)=>part==='_aidiy' && /^aidiy_[a-z][a-z0-9_]*$/.test(folders[index+1]||'')
    && ['electron','browser-profile'].includes(folders[index+2]));
  const consoleHistory = folders.some((part,index)=>part==='_aidiy' && folders[index+1]==='aidiy_console');
  return profile || consoleHistory || folders.some(alwaysExcludedDirectory);
}
