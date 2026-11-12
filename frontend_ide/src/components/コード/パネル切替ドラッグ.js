// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// ボタンはネイティブdrag領域にしない。短押し・キー操作を残し、移動後のclickだけ抑止する。
export function createPanelToggleDrag({ api, win, toggle }) {
  let current = null, suppressClick = false, disposed = false;
  const endToken = token => { if (token) void Promise.resolve(api?.endWindowMove(token)).catch(() => {}); };
  function finish() {
    const drag = current; current = null;
    if (!drag) return;
    win.clearInterval(drag.timer);
    try { if (drag.target.hasPointerCapture?.(drag.id)) drag.target.releasePointerCapture(drag.id); } catch {}
    endToken(drag.token);
  }
  async function move(drag) {
    if (current !== drag || !drag.token || !drag.moved || drag.sending) return;
    drag.sending = true;
    try { if (!await api.moveWindow(drag.token) && current === drag) finish(); }
    catch { if (current === drag) finish(); }
    finally { drag.sending = false; }
  }
  function down(event) {
    if (disposed || event.button !== 0 || event.isPrimary === false || event.pointerType !== 'mouse') return;
    finish(); suppressClick = false;
    const drag = { id: event.pointerId, target: event.currentTarget, x: event.screenX, y: event.screenY, moved: false };
    current = drag;
    try { drag.target.setPointerCapture?.(drag.id); } catch {}
  }
  async function begin(drag) {
    if (!api?.beginWindowMove || !api?.moveWindow || !api?.endWindowMove) return;
    try {
      const token = await api.beginWindowMove();
      if (current !== drag || disposed) { endToken(token); return; }
      if (!token) return;
      drag.token = token;
      drag.timer = win.setInterval(() => { if (drag.moved) void move(drag); }, 100);
      void move(drag);
    } catch { /* 移動不可でもクリックによる表示切替は維持する。 */ }
  }
  function pointerMove(event) {
    const drag = current;
    if (!drag || event.pointerId !== drag.id) return;
    if (!(event.buttons & 1)) { finish(); return; }
    if (Math.hypot(event.screenX - drag.x, event.screenY - drag.y) < 4 && !drag.moved) return;
    if (!drag.moved) { drag.moved = true; void begin(drag); }
    suppressClick = true;
    event.preventDefault();
    void move(drag);
  }
  function up(event) { if (current?.id === event.pointerId) finish(); }
  function cancel(event) { if (current?.id === event.pointerId) { suppressClick = true; finish(); } }
  function click(event) {
    if (event.detail !== 0 && suppressClick) { suppressClick = false; event.preventDefault(); event.stopPropagation(); return; }
    suppressClick = false; toggle();
  }
  const blur = () => { if (current) suppressClick = true; finish(); };
  const keydown = event => { if (event.key === 'Escape') blur(); };
  win.addEventListener('blur', blur);
  win.addEventListener('keydown', keydown);
  return { down, move: pointerMove, up, cancel, click, dispose() { disposed = true; finish(); win.removeEventListener('blur', blur); win.removeEventListener('keydown', keydown); } };
}
