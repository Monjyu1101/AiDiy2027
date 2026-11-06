// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { consoleInputFocus } from '../src/components/コンソール/入力フォーカス.js';

class Events {
  listeners = new Map();
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, values = {}) { for (const fn of this.listeners.get(name) || []) fn(values); }
  count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
function fixture() {
  const doc = new Events(), win = new Events(), panel = new Events(), timers = new Map();
  let serial = 0, calls = 0;
  const state = { visible: true, connected: true, focused: true, drawn: true, selected: false, terminalSelected: false };
  const node = (options = {}) => ({ within: true, control: false, xterm: false, closest(selector) { return (selector === '.xterm' ? this.xterm : this.control) ? this : null; }, ...options });
  const body = node({ within: false }), background = node(), control = node({ control: true }), textarea = node({ control: true, xterm: true });
  doc.defaultView = win; doc.visibilityState = 'visible'; doc.activeElement = body; doc.hasFocus = () => state.focused;
  doc.getSelection = () => ({ isCollapsed: !state.selected });
  panel.ownerDocument = doc; panel.isConnected = true; panel.getClientRects = () => state.drawn ? [{}] : [];
  panel.contains = element => !!element?.within;
  win.setTimeout = fn => { timers.set(++serial, fn); return serial; }; win.clearTimeout = id => timers.delete(id);
  const terminal = { textarea, hasSelection: () => state.terminalSelected, focus() { calls++; doc.activeElement = textarea; } };
  const focus = consoleInputFocus({ panel, terminal, available: () => state.visible && state.connected });
  const down = (target = background, extra = {}) => doc.emit('pointerdown', { target, button: 0, clientX: 10, clientY: 10, ...extra });
  const click = (target = background, extra = {}) => {
    const event = { target, button: 0, detail: 1, clientX: 10, clientY: 10, ...extra };
    doc.emit('click', event); if (panel.contains(target)) panel.emit('click', event);
  };
  return { doc, win, panel, state, focus, terminal, body, background, control, textarea, node, down, click, timers, calls: () => calls,
    flush() { const tasks = [...timers.values()]; timers.clear(); for (const fn of tasks) fn(); } };
}

test('Console focus: window/visibility return restores the actual terminal input once, without changing shell state', () => {
  const f = fixture();
  f.win.emit('focus'); f.win.emit('focus'); assert.equal(f.calls(), 0); assert.equal(f.timers.size, 1);
  f.flush(); assert.equal(f.calls(), 1); assert.equal(f.doc.activeElement, f.textarea);
  f.doc.activeElement = f.body; f.doc.emit('visibilitychange'); f.flush(); assert.equal(f.calls(), 2);
  f.focus.dispose();
});

test('Console focus: window return yields to the activating control, external input and pointer selection', () => {
  for (const outside of [false, true]) {
    const f = fixture(), target = f.node({ control: true, within: !outside });
    f.win.emit('focus'); f.down(target); f.doc.activeElement = target; f.flush(); f.click(target);
    assert.equal(f.calls(), 0); assert.equal(f.doc.activeElement, target);
    f.win.emit('focus'); f.flush(); assert.equal(f.calls(), 0, 'existing keyboard focus is preserved'); f.focus.dispose();
  }
  const f = fixture(); f.win.emit('focus'); f.down(); f.flush(); assert.equal(f.calls(), 0, 'no focus during a held pointer');
  f.doc.emit('pointermove', { clientX: 30, clientY: 10 }); f.click(); assert.equal(f.calls(), 0); f.focus.dispose();
});

test('Console focus: ordinary background click restores input, without redirecting controls/xterm/modified or cancelled clicks', () => {
  const f = fixture(); f.doc.activeElement = f.control; f.down(); f.click(); assert.equal(f.calls(), 1);
  for (const target of [f.control, f.node({ xterm: true }), f.node({ isContentEditable: true })]) { f.down(target); f.click(target); }
  for (const extra of [{ button: 2 }, { detail: 2 }, { detail: 0 }, { defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) { f.down(); f.click(f.background, extra); }
  f.down(); f.doc.emit('pointercancel'); f.click();
  f.down(f.control); f.click(); // A release over background must not redirect a control gesture.
  f.down(f.node({ within: false })); f.click();
  assert.equal(f.calls(), 1); f.focus.dispose();
});

test('Console focus: text selections, hidden/disconnected/unfocused panels and hidden documents are never focused', () => {
  for (const [key, value] of [['visible', false], ['connected', false], ['focused', false], ['drawn', false], ['selected', true], ['terminalSelected', true]]) {
    const f = fixture(); f.state[key] = value; f.win.emit('focus'); f.flush(); f.down(); f.click(); assert.equal(f.calls(), 0, key); f.focus.dispose();
  }
  const f = fixture(); f.doc.visibilityState = 'hidden'; f.focus.request(); f.flush(); assert.equal(f.calls(), 0);
  f.doc.visibilityState = 'visible'; f.panel.isConnected = false; f.focus.request(); f.flush(); assert.equal(f.calls(), 0); f.focus.dispose();
});

test('Console focus: explicit tab return may leave its tab button, but a newer pointer choice wins', () => {
  const f = fixture(); f.doc.activeElement = f.node({ within: false, control: true });
  f.focus.request({ explicit: true }); f.flush(); assert.equal(f.calls(), 1);
  f.focus.request({ explicit: true }); f.down(f.control); f.doc.activeElement = f.control; f.click(f.control); f.flush(); assert.equal(f.calls(), 1);
  f.focus.request({ explicit: true }); f.doc.emit('focusin', { target: f.control }); f.flush(); assert.equal(f.calls(), 1, 'a newer keyboard focus choice wins too');
  f.focus.dispose();
});

test('Console focus: blur, hide, cancel and unmount cancel delayed focus and unsubscribe', () => {
  const f = fixture();
  for (const cancel of [() => f.win.emit('blur'), () => f.focus.cancel(), () => { f.doc.visibilityState = 'hidden'; f.doc.emit('visibilitychange'); }]) {
    f.focus.request(); cancel(); f.flush(); assert.equal(f.calls(), 0);
  }
  f.doc.visibilityState = 'visible'; f.focus.request(); f.focus.dispose(); f.flush();
  assert.equal(f.calls(), 0); assert.equal(f.doc.count() + f.win.count() + f.panel.count(), 0);
  f.focus.request(); f.down(); f.click(); f.flush(); assert.equal(f.calls(), 0);
});
