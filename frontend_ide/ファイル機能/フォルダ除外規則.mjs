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
  return (directory ? parts : parts.slice(0, -1)).some(alwaysExcludedDirectory);
}
