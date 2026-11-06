// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 左クリックは標準のbutton操作。候補は右クリック／メニューキーだけで開く。
export function bindNavigationButton(element, {run, choose}) {
  let disposed = false;
  const listeners = [];
  const listen = (type, handler) => { element.addEventListener(type, handler); listeners.push(() => element.removeEventListener(type, handler)); };
  const enabled = () => !disposed && !element.disabled && element.isConnected;
  const open = point => { if (enabled()) choose({anchor:element, point}); };
  listen('click', event => {
    if (event.button !== 0 || event.ctrlKey) return;
    event.preventDefault();
    if (enabled()) run();
  });
  listen('contextmenu', event => {
    event.preventDefault(); event.stopPropagation();
    // タッチの長押しから発生するcontextmenuでは、選択を開かない。
    if (event.pointerType === 'touch') return;
    const pointer = event.button === 2 || event.ctrlKey;
    open(pointer ? {x:event.clientX, y:event.clientY} : null);
  });
  listen('keydown', event => {
    if (!enabled() || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey) || event.key === 'ArrowDown') {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) open(null);
    } else if ((event.key === 'Enter' || event.key === ' ') && event.repeat) event.preventDefault();
  });
  return {dispose() { disposed = true; listeners.forEach(remove => remove()); }};
}
