// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 別Documentへ移されたDOMでも、入力欄・通常ボタンのキーを奪わない。
export function navigationKeyActive(event, element, hover = false) {
  if (event.defaultPrevented || event.isComposing) return false;
  const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
  if (target?.closest?.('input,textarea,select,button,a[href],summary,[role="textbox"],[contenteditable]:not([contenteditable="false"])')) return false;
  return hover || element.contains(element.ownerDocument.activeElement);
}

export function bindNavigationKeys(element, {keydown, keyup = () => {}, blur = () => {}, moved = () => {}}, clock = globalThis) {
  let doc, owner, disposed = false;
  const clear = () => {
    doc?.removeEventListener('keydown', keydown); doc?.removeEventListener('keyup', keyup);
    owner?.removeEventListener('blur', blur); blur();
  };
  const sync = () => {
    if (disposed || doc === element.ownerDocument) return;
    clear(); doc = element.ownerDocument; owner = doc.defaultView;
    doc.addEventListener('keydown', keydown); doc.addEventListener('keyup', keyup);
    owner?.addEventListener('blur', blur); moved(doc);
  };
  sync();
  // DOM移動直後の最初の操作にも間に合わせ、操作がない移動も追従する。
  element.addEventListener('pointerenter', sync); element.addEventListener('focusin', sync);
  const timer = clock.setInterval(sync, 100);
  return () => {
    disposed = true; clock.clearInterval(timer); clear();
    element.removeEventListener('pointerenter', sync); element.removeEventListener('focusin', sync);
  };
}
