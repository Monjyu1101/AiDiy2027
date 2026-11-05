// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 通常クリックはブラウザーの release 後の click を使い、長押し・中断後の click は消費する。
export function bindNavigationButton(element, {run, choose}, clock = globalThis) {
  let press = null, suppressed = false, disposed = false;
  const listeners = [];
  const now = () => clock.performance?.now?.() ?? Date.now();
  const listen = (target, type, handler, options, bag = listeners) => {
    target?.addEventListener(type, handler, options);
    bag.push(() => target?.removeEventListener(type, handler, options));
  };
  const enabled = () => !disposed && !element.disabled && element.isConnected;
  const finish = (cancelled = false) => {
    const previous = press;
    if (!previous) return;
    press = null;
    if (cancelled) suppressed = true;
    clock.clearTimeout(previous.timer);
    previous.remove.forEach(remove => remove());
    try { if (element.hasPointerCapture?.(previous.id)) element.releasePointerCapture(previous.id); } catch {}
  };
  const cancel = () => finish(true);
  listen(element, 'pointerdown', event => {
    if (press) cancel();
    if (!enabled() || event.button !== 0 || event.isPrimary === false) return;
    suppressed = false;
    const doc = element.ownerDocument, owner = doc.defaultView;
    const current = {id:event.pointerId, x:event.clientX, y:event.clientY, started:now(), held:false, doc, remove:[]};
    press = current;
    const valid = () => enabled() && element.ownerDocument === doc && !doc.hidden && element.getClientRects().length > 0;
    const inside = event => {
      const r = element.getBoundingClientRect();
      return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    };
    const hold = () => {
      if (current.held || press !== current) return;
      if (!valid()) { cancel(); return; }
      current.held = true; suppressed = true; choose();
    };
    try { element.setPointerCapture?.(event.pointerId); } catch {}
    listen(doc, 'pointermove', event => {
      if (event.pointerId !== current.id) return;
      if (!valid() || !inside(event) || Math.hypot(event.clientX-current.x,event.clientY-current.y) > 10) cancel();
    }, true, current.remove);
    listen(doc, 'pointerup', event => {
      if (event.pointerId !== current.id) return;
      if (!valid() || !inside(event)) { cancel(); return; }
      // 負荷でタイマーが遅れても、0.5秒以上の押下を通常実行にしない。
      if (now()-current.started >= 500) hold();
      finish();
    }, true, current.remove);
    for (const type of ['pointercancel', 'lostpointercapture']) listen(doc, type, event => {
      if (event.pointerId === current.id) cancel();
    }, true, current.remove);
    listen(doc, 'pointerdown', event => { if (event.pointerId !== current.id) cancel(); }, true, current.remove);
    listen(doc, 'keydown', event => { if (event.key === 'Escape' || event.key === 'Tab') cancel(); }, true, current.remove);
    listen(doc, 'visibilitychange', () => { if (doc.hidden) cancel(); }, false, current.remove);
    listen(owner, 'blur', cancel, false, current.remove);
    listen(owner, 'pagehide', cancel, false, current.remove);
    current.timer = clock.setTimeout(hold, 500);
  });
  listen(element, 'click', event => {
    event.preventDefault();
    if (!enabled() || (suppressed && (press || event.detail !== 0))) return;
    finish();
    run();
  });
  listen(element, 'keydown', event => {
    if (!enabled() || event.isComposing) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (event.repeat) return;
      cancel(); suppressed = true; choose();
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (event.repeat) { event.preventDefault(); return; }
      cancel(); suppressed = false;
    }
  });
  listen(element, 'contextmenu', event => { if (press || suppressed) event.preventDefault(); });
  return {cancel, dispose() { disposed = true; cancel(); listeners.forEach(remove => remove()); }};
}
