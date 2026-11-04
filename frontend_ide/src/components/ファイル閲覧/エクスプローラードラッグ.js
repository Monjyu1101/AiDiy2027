// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 一覧の通常ドラッグだけをスクロールにする。静止長押しの窓移動は変更しない。
export function createExplorerDrag({ activity = () => {} } = {}) {
  let gesture, suppressClick = false;
  const controls = 'input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[draggable="true"],[role="button"]';
  function finish(event) {
    if (!gesture || (event?.pointerId !== undefined && event.pointerId !== gesture.id)) return;
    if (event?.type === 'lostpointercapture' && event.target !== gesture.element) return;
    const previous = gesture; gesture = undefined;
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'pagehide']) previous.win.removeEventListener(type, finish);
    previous.win.removeEventListener('pointermove', move);
    previous.win.removeEventListener('keydown', key, true);
    previous.element.classList.remove('explorer-dragging');
    try { if (previous.element.hasPointerCapture?.(previous.id)) previous.element.releasePointerCapture(previous.id); } catch {}
  }
  function key(event) { if (event.key === 'Escape') finish(); }
  function down(event) {
    finish(); suppressClick = false;
    if (event.button !== 0 || event.isPrimary === false || event.pointerType === 'touch' || event.target.closest?.(controls)) return;
    const element = event.currentTarget, win = element.ownerDocument.defaultView;
    if (!win || element.scrollHeight <= element.clientHeight + 1) return;
    const rect = element.getBoundingClientRect();
    // 左右と下端のネイティブスクロールバーはブラウザーに任せる。
    if (event.clientX < rect.left + element.clientLeft || event.clientX >= rect.left + element.clientLeft + element.clientWidth || event.clientY >= rect.top + element.clientTop + element.clientHeight) return;
    gesture = { element, win, id: event.pointerId, x: event.clientX, y: event.clientY, start: element.scrollTop, moved: false };
    win.addEventListener('pointermove', move, { passive: false });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'pagehide']) win.addEventListener(type, finish);
    win.addEventListener('keydown', key, true);
  }
  function move(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!(event.buttons & 1)) { finish(); return; }
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.moved) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) { finish(); return; }
      gesture.moved = true; suppressClick = true;
      gesture.element.classList.add('explorer-dragging');
      try { gesture.element.setPointerCapture(event.pointerId); } catch {}
    }
    event.preventDefault(); activity();
    gesture.element.scrollTop = Math.max(0, Math.min(gesture.element.scrollHeight - gesture.element.clientHeight, gesture.start - dy));
  }
  function click(event) {
    if (!suppressClick || event.detail === 0) return;
    event.preventDefault(); event.stopPropagation();
  }
  function dragstart(event) { if (gesture) event.preventDefault(); }
  return { down, click, dragstart, finish, dispose: finish };
}
