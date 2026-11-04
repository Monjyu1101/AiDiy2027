/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

// Discord 版の panel-vue.test.ts と同じ方法で、配布用 view.js を DOM 上で動かす。
const bundle = readFileSync(new URL('../panel/view.js', import.meta.url), 'utf8');
const initial = () => ({ code: { cli: 'aidiy_hermes', model: 'code-a' }, folder: { name: 'sample', path: '/sample' }, state: { phase: 'idle' } });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() { let resolve!: (value?: any) => void, reject!: (error: Error) => void; const promise = new Promise<any>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture(overrides: Record<string, any> = {}) {
  const window: any = new Window({ url: 'http://localhost/token/', settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const calls: any[][] = [], listeners = new Map<string, Set<Function>>();
  let timerId = 0, now = 0;
  const timers = new Map<number, { at: number; callback: Function }>();
  window.setTimeout = (callback: Function, ms: number) => { const id = ++timerId; timers.set(id, { at: now + ms, callback }); return id; };
  window.clearTimeout = (id: number) => timers.delete(id);
  const api: any = {};
  for (const action of ['selectCode', 'start', 'stop']) api[action] = async (value: any) => { calls.push([action, value]); return value; };
  api.initial = async () => initial();
  let pinned = false, maximized = false;
  api.getPinState = async () => ({ pinned, locked: false });
  api.togglePin = async () => { calls.push(['togglePin']); pinned = !pinned; return { pinned, locked: false }; };
  api.isMaximized = async () => maximized;
  api.window = async (value: string) => { calls.push(['window', value]); if (value === 'maximize') maximized = !maximized; };
  // aidiy_hermes のモデル候補（Discord 版の試験と同じ）。
  api.catalogCode = async () => ({ models: [{ id: 'auto', label: 'auto（自動判定）' }, { id: 'same', label: 'same（変更なし）' }, { id: 'code-a', label: 'code-a' }, { id: 'codex_cli/same', label: 'codex_cli/same' }] });
  for (const type of ['State', 'Activity', 'PinState']) api[`on${type}`] = (callback: Function) => { const set = listeners.get(type) || new Set(); set.add(callback); listeners.set(type, set); return () => set.delete(callback); };
  Object.assign(api, overrides); window.slackPanel = api;
  window.document.body.innerHTML = '<div id="app"></div>';
  window.eval(bundle);
  const get = (id: string) => window.document.getElementById(id);
  const emit = async (type: string, value: any) => { for (const fn of listeners.get(type) || []) fn(value); await flush(); };
  const change = async (id: string, value: string) => { get(id).value = value; get(id).dispatchEvent(new window.Event('change', { bubbles: true })); await flush(); };
  const click = async (id: string) => { get(id).click(); await flush(); };
  const tick = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
    }
    now = end;
  };
  const body = () => window.document.body.classList;
  const dispose = async () => { window.dispatchEvent(new window.Event('pagehide')); await flush(); await window.happyDOM.close(); };
  return { window, calls, listeners, get, emit, change, click, tick, dispose, timers, body };
}

test('Vue 配布画面は Discord 版と同じ項目を持ち、音声関連の項目を持たない', async () => {
  const f = fixture();
  try {
    await flush();
    for (const id of ['status', 'dot', 'status-text', 'minimize', 'maximize', 'pin', 'close', 'activity-bar', 'project-folder', 'toggle', 'features', 'feature-code', 'settings', 'code-toggle', 'code-cli', 'code-model', 'error-detail', 'note', 'stage', 'stage-log', 'stage-idle', 'stage-message', 'stage-who', 'stage-text', 'model-bar', 'choose-model', 'model-label']) assert.ok(f.get(id), id);
    for (const id of ['audio-cloud', 'monitor', 'provider', 'voice', 'model', 'live-toggle', 'feature-live']) assert.equal(f.get(id), null, id);
    assert.equal(f.get('status-text').textContent, '未接続'); assert.equal(f.get('project-folder').title, '/sample');
    assert.equal(f.get('code-toggle').disabled, true); assert.equal(f.get('code-toggle').getAttribute('aria-checked'), 'true');
    assert.equal(f.get('model-label').textContent, 'aidiy_hermes - code-a');
    assert.equal(f.get('code-cli').textContent, 'aidiy_hermes', 'コードは aidiy_hermes 固定表示');
    assert.deepEqual([...f.get('code-model').options].map((item: any) => item.value), ['auto', 'same', 'code-a', 'codex_cli/same']);
    await f.change('code-model', 'codex_cli/same');
    assert.equal(f.get('model-label').textContent, 'aidiy_hermes - codex_cli/same');
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls.filter(([name]) => name === 'selectCode').at(-1))), ['selectCode', { model: 'codex_cli/same' }]);
    await f.change('code-model', 'auto'); assert.equal(f.get('model-label').textContent, 'aidiy_hermes - auto');
    await f.click('minimize'); await f.click('close');
    assert.deepEqual(f.calls.filter(([name]) => name === 'window'), [['window', 'minimize'], ['window', 'close']]);
  } finally { await f.dispose(); }
});

test('接続・再接続・切断・エラー復旧と連打の保存/起動重複を防ぐ', async () => {
  const gate = deferred(); let starts = 0;
  const f = fixture({ start: async () => { starts++; await gate.promise; } });
  try {
    await flush(); await f.click('toggle'); await f.click('toggle');
    assert.equal(starts, 1);
    await f.emit('State', { phase: 'connecting' }); assert.equal(f.get('toggle').textContent, '接続中…');
    assert.equal(f.get('toggle').disabled, false, 'start 応答待ちでも connecting は停止できる');
    await f.click('toggle'); assert.ok(f.calls.some(([name]) => name === 'stop'));
    gate.resolve(); await flush();
    await f.emit('State', { phase: 'connected' });
    assert.equal(f.get('toggle').textContent, '切断'); assert.equal(f.get('code-model').disabled, true);
    assert.ok(f.body().contains('connected')); assert.ok(f.body().contains('live-view'));
    await f.emit('State', { phase: 'reconnecting' }); assert.equal(f.get('status-text').textContent, '再接続中');
    await f.emit('State', { phase: 'stopping' }); assert.equal(f.get('toggle').disabled, true); assert.equal(f.get('choose-model').disabled, true);
    await f.emit('State', { phase: 'error', message: '接続失敗', details: 'コピー可能な詳細' });
    assert.equal(f.get('error-detail').value, 'コピー可能な詳細'); assert.equal(f.get('error-detail').hidden, false);
    assert.equal(f.get('note').textContent, '接続失敗');
    await f.emit('State', { phase: 'idle' });
    assert.equal(f.get('error-detail').hidden, true); assert.equal(f.get('note').textContent, '');
    await f.emit('State', { phase: 'error', fatal: true, message: 'サーバー終了' });
    await f.emit('State', { phase: 'idle' }); assert.equal(f.get('toggle').disabled, true);
  } finally { gate.resolve(); await f.dispose(); }
});

test('やり取りは文字を順に表示し、60秒で消え、切断・終了でタイマーと購読を回収する', async () => {
  const f = fixture();
  try {
    await flush();
    await f.emit('Activity', { role: 'user', who: 'あなた', text: '接続前' }); assert.equal(f.get('stage-message').hidden, true, '未接続では表示しない');
    await f.emit('State', { phase: 'connected' });
    await f.emit('Activity', { role: 'user', who: 'あなた', text: '<script>hello</script>' });
    assert.equal(f.get('stage-message').hidden, false); assert.equal(f.get('stage-message').dataset.role, 'user');
    await f.tick(1100);
    assert.equal(f.get('stage-text').textContent, '<script>hello</script>'); assert.equal(f.get('stage-text').querySelector('script'), null);
    await f.emit('Activity', { role: 'ai', who: 'AiDiy', text: 'おはようございます' });
    assert.equal(f.get('stage-who').textContent, 'AiDiy'); assert.equal(f.get('stage-message').dataset.role, 'ai');
    await f.tick(60_700); assert.equal(f.get('stage-message').hidden, true);
    await f.emit('Activity', { who: 'AiDiy', text: 'typing' });
    await f.emit('State', { phase: 'idle' }); assert.equal(f.get('stage-message').hidden, true);
    await f.dispose();
    assert.equal(f.timers.size, 0);
    assert.ok([...f.listeners.values()].every(set => set.size === 0));
  } finally { await f.dispose(); }
});

test('画面下部のモデル: 未接続は設定欄へ移り、接続中は設定を開いて適用時に切断・保存・再接続する', async () => {
  const order: string[] = [];
  const f = fixture({
    stop: async () => { order.push('stop'); await f.emit('State', { phase: 'idle' }); },
    selectCode: async (value: any) => { order.push(`save:${value.model}`); return value; },
    start: async () => { order.push('start'); },
  });
  try {
    await flush();
    await f.click('choose-model');
    assert.equal(f.window.document.activeElement, f.get('code-model')); assert.equal(f.get('settings-actions'), null);
    await f.emit('State', { phase: 'connected' });
    assert.equal(f.get('choose-model').disabled, false);
    await f.click('choose-model');
    assert.ok(f.body().contains('settings-open')); assert.ok(f.get('settings-actions'));
    assert.equal(f.get('code-model').disabled, false, '接続中でも設定を編集できる');
    assert.equal(f.get('toggle').disabled, true); assert.equal(f.get('choose-model').disabled, true);
    await f.change('code-model', 'codex_cli/same');
    assert.deepEqual(order, [], '適用まで保存も切断もしない');
    assert.equal(f.get('model-label').textContent, 'aidiy_hermes - codex_cli/same');
    await f.click('settings-apply'); for (let i = 0; i < 5; i++) await flush();
    assert.deepEqual(order, ['stop', 'save:codex_cli/same', 'start']);
    assert.ok(!f.body().contains('settings-open')); assert.equal(f.get('settings-actions'), null);
  } finally { await f.dispose(); }
});

test('接続中に開いたモデル設定は取消で元に戻し、切断も保存もしない', async () => {
  const f = fixture();
  try {
    await flush(); await f.emit('State', { phase: 'connected' });
    await f.click('choose-model'); await f.change('code-model', 'codex_cli/same');
    await f.click('settings-cancel');
    assert.equal(f.get('code-model').value, 'code-a'); assert.equal(f.get('model-label').textContent, 'aidiy_hermes - code-a');
    assert.ok(!f.calls.some(([name]) => ['stop', 'selectCode', 'start'].includes(name)));
    assert.ok(!f.body().contains('settings-open')); assert.equal(f.get('toggle').textContent, '切断');
  } finally { await f.dispose(); }
});

test('遅い初期読込は新しい状態通知を上書きせず、終了後の候補応答も無視する', async () => {
  const load = deferred(), catalog = deferred();
  const f = fixture({ initial: () => load.promise, catalogCode: () => catalog.promise });
  try {
    await f.emit('State', { phase: 'error', fatal: true, message: '切断しました' });
    load.resolve(initial()); await flush();
    assert.equal(f.get('status-text').textContent, 'エラー'); assert.equal(f.get('toggle').disabled, true);
    await f.dispose(); catalog.resolve({ models: [], providers: [] }); await flush();
    assert.equal(f.window.document.getElementById('toggle'), null);
  } finally { load.resolve(initial()); catalog.resolve({}); await f.dispose(); }
});

test('選択保存の拒否では起動せず、再試行できる', async () => {
  let reject = true, starts = 0;
  const f = fixture({ selectCode: async () => { if (reject) throw new Error('保存先がありません'); }, start: async () => { starts++; } });
  try {
    await flush(); await f.click('toggle'); assert.equal(starts, 0);
    assert.equal(f.get('note').textContent, '保存先がありません'); assert.equal(f.get('toggle').disabled, false);
    reject = false; await f.click('toggle'); assert.equal(starts, 1);
  } finally { await f.dispose(); }
});

test('ブラウザの戻る/進む復元では再マウントし、購読を重複させない', async () => {
  const f = fixture();
  try {
    await flush(); await f.emit('State', { phase: 'connected' });
    f.window.dispatchEvent(new f.window.Event('pagehide')); await flush();
    const restore = new f.window.Event('pageshow'); Object.defineProperty(restore, 'persisted', { value: true });
    f.window.dispatchEvent(restore); await flush();
    assert.equal(f.get('status-text').textContent, '未接続');
    assert.ok([...f.listeners.values()].every(set => set.size === 1));
    f.window.dispatchEvent(restore); await flush();
    assert.ok([...f.listeners.values()].every(set => set.size === 1));
  } finally { await f.dispose(); }
});

test('初回起動は自動接続せず、モデル設定画面に案内を出す', async () => {
  const f = fixture({ initial: async () => ({ ...initial(), firstRun: true }) });
  try {
    await flush();
    assert.match(f.get('note').textContent, /初回起動です/);
    assert.equal(f.get('status-text').textContent, '未接続'); assert.equal(f.get('toggle').textContent, '接続');
    assert.ok(f.get('toggle').classList.contains('awaiting'), '「接続」を押すよう促す');
    assert.ok(!f.calls.some(([name]) => name === 'start'));
  } finally { await f.dispose(); }
  const saved = fixture();
  try {
    await flush();
    assert.doesNotMatch(saved.get('note').textContent, /初回起動です/);
  } finally { await saved.dispose(); }
});
