// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
export function diffRows(lines) {
  // 通常の差分は先頭1列、マージ差分は親ごとに1列が変更記号になる。
  let markerWidth = 0;
  return lines.map(text => {
    const hunk = text.match(/^(@{2,}) /);
    let kind = '';
    if (hunk) {
      markerWidth = hunk[1].length - 1;
      kind = 'chunk';
    } else if (text.startsWith('diff --')) {
      markerWidth = 0;
    } else if (markerWidth) {
      const markers = text.slice(0, markerWidth);
      if (markers.includes('+')) kind = 'added';
      else if (markers.includes('-')) kind = 'removed';
    }
    return {text, kind};
  });
}
