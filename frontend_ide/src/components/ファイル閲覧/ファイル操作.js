// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

export function fullFilePath(root = '', path = '') {
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(root);
  const separator = windows ? '\\' : '/';
  const base = windows ? root.replaceAll('/', '\\') : root;
  return (base ? base.replace(windows ? /[\\/]+$/ : /\/+$/, '') + separator : '')
    + (windows ? path.replaceAll('/', '\\') : path);
}

// Webの非HTTPS環境や権限拒否でも、クリックからのコピーを試す。
// execCommandのfalse/例外を成功扱いにせず、元のフォーカスと選択範囲を戻す。
export async function copyBrowserText(text, { clipboard = globalThis.navigator?.clipboard, document = globalThis.document, isCurrent = () => true } = {}) {
  if (!isCurrent()) throw Error('copy cancelled');
  if (typeof clipboard?.writeText === 'function') {
    try { await clipboard.writeText(text); return; } catch { /* 旧方式を試し、失敗なら画面で手動コピーを案内する。 */ }
  }
  if (!isCurrent()) throw Error('copy cancelled');
  if (!document?.body || typeof document.execCommand !== 'function') throw Error('copy unavailable');
  const active = document.activeElement, selection = document.getSelection?.();
  const ranges = [];
  for (let index = 0; index < (selection?.rangeCount || 0); index++) ranges.push(selection.getRangeAt(index).cloneRange());
  const inputSelection = active && typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.tabIndex = -1;
  input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;';
  try {
    document.body.append(input);
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, text.length);
    if (!document.execCommand('copy')) throw Error('copy failed');
  } finally {
    input.remove();
    try {
      active?.focus?.({ preventScroll: true });
      if (inputSelection) active.setSelectionRange(...inputSelection);
      if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
    } catch { /* 選択元が破棄されても、コピー自体の結果を変えない。 */ }
  }
}
