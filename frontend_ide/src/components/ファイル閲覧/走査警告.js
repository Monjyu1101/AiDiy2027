// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

const reasons = {
  files: 'ファイル数', directories: 'フォルダ数', entries: '項目数', depth: '階層数',
  time: '処理時間', cancelled: '中断', matches: '一致件数', bytes: '読み取り量',
};

export function scanWarning(scan, label = '一覧') {
  if (!scan?.truncated) return '';
  const reason = reasons[scan.truncationReason];
  return `${label}は一部のみ表示しています${reason ? `（${reason}の上限・制限）` : ''}。表示されないファイルや一致箇所があります。`;
}
