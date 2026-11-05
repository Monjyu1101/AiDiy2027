// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// scripts/cli_bat と同じ起動オプション。モデルは利用者の設定を使う。
export const cliCompletions = Object.freeze({
  codex: { options: '--dangerously-bypass-approvals-and-sandbox', description: '承認・サンドボックスなし' },
  claude: { options: '--dangerously-skip-permissions --chrome', description: '権限確認なし・Chrome連携' },
  copilot: { options: '--allow-all-tools', description: '全ツールを許可' },
  agy: { options: '--dangerously-skip-permissions', description: '権限確認なし' },
  grok: { options: '--yolo', description: '自動承認' },
  aidiy_hermes: { options: '--yolo', description: '自動承認' },
});

// 候補の表示だけを担当する。Tab確定はPSReadLineが実際の入力バッファで判定する。
export function consoleCompletion(buffer) {
  if (!buffer || buffer.type !== 'normal') return '';
  let row = buffer.baseY + buffer.cursorY;
  const current = buffer.getLine(row);
  if (!current) return '';
  // PSReadLineの履歴予測（斜体）は未確定なので、入力済みの引数と区別する。
  for (let y = row, start = buffer.cursorX; ; y++, start = 0) {
    const line = buffer.getLine(y);
    for (let x = start; x < line.length; x++) {
      const cell = line.getCell(x);
      if (cell?.getChars().trim() && !cell.isItalic()) return '';
    }
    if (!buffer.getLine(y + 1)?.isWrapped) break;
  }
  let text = current.translateToString(false, 0, buffer.cursorX);
  for (let count = 0; buffer.getLine(row)?.isWrapped && row > 0 && count < 16; count++) {
    text = buffer.getLine(--row).translateToString(false) + text;
  }
  const command = /^PS [\s\S]*> ([a-z_]+) *$/.exec(text)?.[1];
  return Object.hasOwn(cliCompletions, command) ? `${command} ${cliCompletions[command].options}` : '';
}
