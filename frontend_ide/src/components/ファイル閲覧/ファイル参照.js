// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 検索時の座標を現在の本文と照合し、変化した内容の別の行を誤って強調しない。
export function searchReference(text, file) {
  if (!Number.isInteger(file?.line) || file.line < 1) return null;
  const lines = String(text).split(/(\r\n|\r|\n)/);
  const index = (file.line - 1) * 2;
  const line = file.line, column = Number.isInteger(file.column) && file.column > 0 ? file.column : 1;
  const query = String(file.query || ''), content = lines[index];
  const length = Number.isInteger(file.matchLength) && file.matchLength > 0 ? file.matchLength : query.length;
  if (content === undefined || column > content.length + 1) return { stale: true };
  if (query) {
    const actual = content.slice(column - 1, column - 1 + length);
    const normalize = value => file.caseSensitive ? value : value.toLocaleLowerCase();
    if (!normalize(actual).includes(normalize(query))) return { stale: true };
  }
  return { stale: false, line, column, endColumn: Math.min(content.length + 1, column + length),
    start: lines.slice(0, index).reduce((sum, value) => sum + value.length, 0) + column - 1, length };
}

export function fileDraftReference(file, selection) {
  if (!file || typeof file.path !== 'string' || !file.path || file.path.length > 4096) throw Error('参照するファイルを確認できません。');
  const heading = `参照ファイル: ${file.path}`;
  if (!selection?.text) return heading;
  if (selection.text.length > 80000) throw Error('選択範囲は80,000文字以内にしてください。');
  const runs = selection.text.match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(value => value.length + 1)));
  const lines = Number.isInteger(selection.startLine) && Number.isInteger(selection.endLine)
    ? `\n選択範囲: ${selection.startLine}〜${selection.endLine}行` : '';
  return `${heading}${lines}\n${fence}\n${selection.text}\n${fence}`;
}
