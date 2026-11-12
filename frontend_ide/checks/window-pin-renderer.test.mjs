// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { compile } from '@vue/compiler-dom';
import * as Vue from 'vue';
import { createWindowPinController, createPanelWindowApi } from '../src/components/共通表示/窓操作.js';

function fixture(initial = { pinned: false, locked: false }) {
  let current = initial, notify, unsubscriptions = 0, toggles = 0;
  const updates = [], api = {
    pinState: async () => current,
    togglePin: async () => { toggles++; return current = { ...current, pinned: !current.pinned }; },
    onPinChanged: callback => { notify = callback; return () => { unsubscriptions++; }; },
  };
  const controller = createWindowPinController({ api, changed: value => updates.push(value) });
  return { controller, api, updates, emit(value) { current = value; notify(value); }, get toggles() { return toggles; }, get unsubscriptions() { return unsubscriptions; } };
}
test('窓ピン: 初期OFF・mainのONを反映し、操作結果だけで表示を更新する', async () => {
  const f = fixture();
  assert.deepEqual(f.controller.state, { pinned: false, locked: false, ready: false, busy: false, error: '' });
  await f.controller.toggle(); assert.equal(f.toggles, 0);
  await f.controller.start(); assert.equal(f.controller.state.ready, true);
  await f.controller.toggle(); assert.equal(f.controller.state.pinned, true);
  await f.controller.toggle(); assert.equal(f.controller.state.pinned, false);
  f.controller.dispose(); assert.equal(f.unsubscriptions, 1);
  const linked = fixture({ pinned: true, locked: false }); await linked.controller.start();
  assert.equal(linked.controller.state.pinned, true); linked.controller.dispose();
});
test('窓ピン: VRロック中は解除せず、解除通知後は再操作できる', async () => {
  const f = fixture({ pinned: true, locked: true }); await f.controller.start();
  await f.controller.toggle(); assert.equal(f.toggles, 0); assert.equal(f.controller.state.pinned, true);
  f.emit({ pinned: true, locked: false }); await f.controller.toggle();
  assert.equal(f.toggles, 1); assert.equal(f.controller.state.pinned, false); f.controller.dispose();
});
test('窓ピン: 遅い初期応答と別窓通知で自窓の状態を巻き戻さない', async () => {
  const f = fixture(); let resolve;
  f.api.pinState = () => new Promise(done => { resolve = done; });
  const opening = f.controller.start(); f.emit({ pinned: true, locked: true });
  resolve({ pinned: false, locked: false }); await opening;
  assert.equal(f.controller.state.pinned, true); assert.equal(f.controller.state.locked, true);
  f.emit({ panelName: 'other', pinned: false, locked: false });
  assert.equal(f.controller.state.pinned, true);
  f.emit({ pinned: false }); assert.equal(f.controller.state.locked, true); f.controller.dispose();
});
test('窓ピン: 連打は1要求・失敗は確定状態を保持・破棄後の応答を捨てる', async () => {
  const f = fixture(); await f.controller.start(); let reject, calls = 0;
  f.api.togglePin = () => { calls++; return new Promise((_, fail) => { reject = fail; }); };
  const toggling = f.controller.toggle(); await f.controller.toggle(); assert.equal(calls, 1);
  reject(Error('failed')); await toggling; assert.equal(f.controller.state.pinned, false); assert.equal(f.controller.state.busy, false);
  assert.match(f.controller.state.error, /切り替え/);
  let resolve; f.api.pinState = () => new Promise(done => { resolve = done; });
  const refreshing = f.controller.refresh(); f.controller.dispose(); const count = f.updates.length;
  resolve({ pinned: true, locked: true }); await refreshing; f.emit({ pinned: true, locked: true });
  assert.equal(f.updates.length, count); assert.equal(f.unsubscriptions, 1);
});
test('窓ピン: 読込失敗・不正値はOFFを保ち、次のfocus照会で復旧する', async () => {
  const f = fixture(); f.api.pinState = async () => ({ ok: false }); await f.controller.start();
  assert.equal(f.controller.state.ready, false); assert.equal(f.controller.state.pinned, false);
  f.api.pinState = async () => ({ pinned: true, locked: false }); await f.controller.refresh();
  assert.equal(f.controller.state.ready, true); assert.equal(f.controller.state.error, ''); f.controller.dispose();
});
test('別窓API: 窓名を限定して操作し、他パネルと所有元の通知を混同しない', async () => {
  const calls = [], states = []; let notify, stopped = false;
  const owner = { panelAction: async (...args) => { calls.push(args); return { pinned: true, locked: false }; }, onPinChanged: fn => { notify = fn; return () => { stopped = true; }; } };
  const api = createPanelWindowApi(owner, 'routes-1'), stop = api.onPinChanged(value => states.push(value));
  for (const action of ['minimize', 'maximize', 'isMaximized', 'pinState', 'togglePin', 'close']) await api[action]();
  assert.deepEqual(calls, ['minimize', 'maximize', 'isMaximized', 'pin-state', 'toggle-pin', 'close'].map(action => ['routes-1', action]));
  notify({ pinned: true, locked: true }); notify({ panelName: 'explorer-2', pinned: false, locked: false });
  notify({ panelName: 'routes-1', pinned: true, locked: true });
  assert.deepEqual(states, [{ pinned: true, locked: true }]); stop(); assert.equal(stopped, true);
});
test('共有Vue: 最小化→最大化→ピン→閉じるの順、ARIA・VR無効化・購読破棄', () => {
  const path = new URL('../src/components/共通表示/窓操作.vue', import.meta.url);
  const source = readFileSync(path, 'utf8'), { descriptor } = parse(source);
  assert.doesNotThrow(() => compileScript(descriptor, { id: 'window-actions-check', inlineTemplate: true }));
  const template = descriptor.template.content;
  assert.ok(template.indexOf("action('minimize')") < template.indexOf("action('maximize')"));
  assert.ok(template.indexOf("action('maximize')") < template.indexOf('class="window-pin"'));
  assert.ok(template.indexOf('class="window-pin"') < template.indexOf("action('close')"));
  assert.match(template, /:aria-pressed="pin.pinned"/); assert.match(template, /:disabled="!pin.ready \|\| pin.busy \|\| pin.locked"/);
  assert.match(template, /class="window-close" :disabled="hideClose"/); assert.doesNotMatch(template, /v-if="!hideClose"/);
  assert.match(source, /controller.dispose\(\)/);
  assert.match(readFileSync(new URL('../src/components/共通表示/状態バー.vue', import.meta.url), 'utf8'), /<WindowActions v-if="desktop"/);
  const panels = readFileSync(new URL('../src/components/ファイル閲覧/別窓タイトル.js', import.meta.url), 'utf8');
  assert.match(panels, /h\(WindowActions/);
  assert.match(panels, /kind === 'explorer' \|\| kind === 'panel-routes'/);
  assert.match(panels, /pinOnly: true/);
  assert.match(template, /v-if="!pinOnly" type="button" @click="action\('minimize'\)/);
  assert.match(template, /v-if="!pinOnly" type="button" @click="action\('maximize'\)/);
  assert.match(template, /v-if="!pinOnly" type="button" class="window-close"/);
});
test('ページ内Explorer: 別ウィンドウ操作はヘッダーの右端、最前面ピンとは分離する', () => {
  const source = readFileSync(new URL('../src/components/ファイル閲覧/ファイル一覧.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  assert.doesNotThrow(() => compileScript(descriptor, { id: 'explorer-header-check', inlineTemplate: true }));
  const header = descriptor.template.content.match(/<aside ref="panel"[^>]*>\s*(<header[^>]*>[\s\S]*?<\/header>)/)?.[1];
  assert.ok(header, 'エクスプローラーのヘッダーが存在する');
  assert.ok(!header.includes('title="全てを閉じる"'));
  assert.match(descriptor.template.content, /class="explorer-content-tools">[\s\S]*?title="全てを閉じる"[\s\S]*?explorer-refresh/);
  assert.match(header, /:aria-pressed="detached"/); assert.match(header, /<span aria-hidden="true">📌<\/span>/);
  assert.ok(header.includes('v-if="(!detached||!nativePanels)&&(!allDisplays||!detached)"'));
  assert.doesNotMatch(header, /togglePin|window-pin|↗/);
  assert.match(header, /class="explorer-detach panel-detach-pin"/);
  assert.match(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'), /\.explorer-panel header \.explorer-detach\{margin-left:auto\}/);
});

test('軌跡バー: 別窓の開閉マークはclick可能で、native切離し操作は重複しない', () => {
  const source = readFileSync(new URL('../src/components/ファイル閲覧/ファイル一覧.vue', import.meta.url), 'utf8');
  assert.match(source, /class="route-detach panel-detach-pin"/);
  assert.match(source, /v-if="\(!routeDetached\|\|!nativePanels\)\&\&\(!allDisplays\|\|!routeDetached\)"/);
  assert.match(source, /:aria-pressed="routeDetached"/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.native-route-window \.route-controls\{-webkit-app-region:no-drag/);
  assert.match(css, /\.native-route-window \.route-controls>\.route-burger\{[^}]*-webkit-app-region:no-drag/);
  assert.doesNotMatch(source, /route-drag-handle/);
  assert.doesNotMatch(css, /route-drag-handle|route-controls>\.route-burger[^}]*display:none|native-route-window \.route-choice:before\{display:none/);
});

test('軌跡バー: 別窓は展開状態を□▶/□▽へ反映、本体は縦バーガーを維持', () => {
  const source = readFileSync(new URL('../src/components/ファイル閲覧/ファイル一覧.vue', import.meta.url), 'utf8');
  const button = source.match(/<button[^>]*class="burger-button route-burger"[\s\S]*?<\/button>/)?.[0];
  assert.ok(button);
  const render = new Function('Vue', compile(button, { mode: 'function' }).code)(Vue);
  for (const allDisplays of [false, true]) for (const routeDetached of [false, true]) for (const routeListOpen of [false,true]) {
    let clicks=0;
    const node=render({allDisplays,routeDetached,routeListOpen,nativePanels:true,routeToggleDown(){},routeToggleDrag:null,routeToggleClick(){clicks++;}},[]);
    if(allDisplays&&!routeDetached){assert.notEqual(node.type,'button');continue;}
    assert.equal(node.props['aria-expanded'],routeDetached?routeListOpen:undefined);
    assert.equal(node.props['aria-label'],routeDetached?(routeListOpen?'軌跡内容を閉じる':'軌跡内容を開く'):'軌跡バーを閉じる');
    node.props.onClick();assert.equal(clicks,1);
    const mark=node.children.find(n=>n.type==='span');
    assert.equal(mark.props.class,routeDetached?'route-panel-mark':'burger burger-v');
    if(routeDetached){assert.equal(mark.children[0].children,routeListOpen?'▽':'▶︎');assert.equal(mark.children[1].children[0].props.fill,routeListOpen?'none':'currentColor');}
  }
});
