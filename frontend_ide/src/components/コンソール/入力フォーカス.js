// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// xtermの入力先だけを戻す。OS窓の前面化、キー転送、カーソル移動はしない。
const controls = 'button,a[href],input,textarea,select,option,label,summary,iframe,[contenteditable]:not([contenteditable="false"]),[tabindex],[role="button"],[role="link"],[role="switch"],[role="checkbox"],[role="radio"],[role="textbox"],[role="combobox"],[role="menuitem"],[draggable="true"]';
const controlled = element => !!(element?.isContentEditable || element?.closest?.(controls));

export function consoleInputFocus({ panel, terminal, available }) {
  const doc = panel?.ownerDocument, win = doc?.defaultView;
  let timer = null, pointer = null, disposed = false;
  const listeners = [];
  const listen = (target, name, handler, capture = false) => {
    target.addEventListener(name, handler, capture);
    listeners.push(() => target.removeEventListener(name, handler, capture));
  };
  function cancel() {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  }
  function selected() {
    const selection = doc.getSelection();
    return terminal.hasSelection() || !!(selection && !selection.isCollapsed);
  }
  function ready() {
    return !disposed && available() && panel.isConnected && panel.getClientRects().length > 0 &&
      doc.visibilityState !== 'hidden' && doc.hasFocus();
  }
  function focus(explicit = false) {
    if (!ready() || selected()) return;
    const active = doc.activeElement;
    // 復帰と同時に押したボタンや、IDE側で編集している入力欄を奪わない。
    if (!explicit && active !== terminal.textarea && controlled(active)) return;
    terminal.focus();
  }
  function request({ explicit = false } = {}) {
    cancel();
    if (!win || disposed) return;
    // 窓を選んだクリックの標準フォーカス処理を先に通す。
    timer = win.setTimeout(() => { timer = null; if (!pointer) focus(explicit); }, 0);
  }
  function pointerDown(event) {
    cancel();
    pointer = event.button === 0 ? { target: event.target, x: event.clientX, y: event.clientY, moved: false } : null;
  }
  function pointerMove(event) {
    if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 4) pointer.moved = true;
  }
  function click(event) {
    const gesture = pointer;
    pointer = null;
    if (!gesture || gesture.moved || event.defaultPrevented || event.button !== 0 || event.detail !== 1 ||
      event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || !panel.contains(gesture.target)) return;
    // xterm内部の選択・スクロール・Altクリック等はxterm自身に任せる。
    if (controlled(event.target) || controlled(gesture.target) ||
      event.target.closest?.('.xterm') || gesture.target.closest?.('.xterm')) return;
    focus(true);
  }
  function reset() { cancel(); pointer = null; }
  function visibility() { if (doc.visibilityState === 'hidden') reset(); else request(); }
  if (win) {
    listen(win, 'focus', request);
    listen(win, 'blur', reset);
    listen(doc, 'visibilitychange', visibility);
    listen(doc, 'focusin', event => { if (event.target !== terminal.textarea) cancel(); });
    listen(doc, 'pointerdown', pointerDown, true);
    listen(doc, 'pointermove', pointerMove, true);
    listen(doc, 'pointercancel', reset, true);
    listen(doc, 'click', event => { if (!panel.contains(event.target)) pointer = null; }, true);
    listen(panel, 'click', click);
  }
  return { request, cancel: reset, dispose() { reset(); disposed = true; for (const remove of listeners) remove(); } };
}
