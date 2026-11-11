// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { EventEmitter } = require('node:events');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../electron/main.ts'), 'utf8');
const panels = ['chat', 'file', 'image', 'code1', 'code2', 'code3', 'code4', 'code5', 'code6'];

function fixture() {
  const windows = [], handlers = new Map();
  let quitCount = 0;
  const context = {
    PANEL_BOUNDS: Object.fromEntries(panels.map(role => [role, { width: 300, height: 200 }])),
    CORE_BOUNDS: {}, panelWindows: new Map(), panelStates: Object.fromEntries(panels.map(role => [role, false])),
    windowRoles: new Map(), coreWindow: null, loginWindow: null, isQuitting: false,
    notifyPanelStates() {}, applyPrimaryMode() {}, getPanelInitialPosition: () => ({ x: 0, y: 0 }),
    ウィンドウ非表示(window) { window.visible = false; },
    async ウィンドウ表示(window) { window.visible = true; return true; },
    currentControlWindow: event => event.window,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    app: { quit() { quitCount++; } },
    createBaseWindow(_bounds, role, visible) {
      const window = Object.assign(new EventEmitter(), {
        id: windows.length + 1, visible, dead: false, draft: '未送信の下書き',
        webContents: { send() {} }, setPosition() {}, isMinimized: () => false,
        isDestroyed() { return this.dead; }, isVisible() { return this.visible; },
        destroy() { this.dead = true; this.draft = null; this.emit('closed'); },
        close() { this.destroy(); },
      });
      windows.push(window); context.windowRoles.set(window.id, role); return window;
    },
  };
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
  const code = section('async function setPanelVisibility(', 'function applyPrimaryMode(')
    + section('function createPanelWindow(', 'function ensureAllPanelWindows(')
    + section('function createCoreWindow(', 'async function openCoreWindow(')
    + section("  ipcMain.handle('window:close-self'", "  ipcMain.handle('window:minimize-self'");
  vm.runInNewContext(stripTypeScriptTypes(code), context);
  return { ...context, close: window => handlers.get('window:close-self')({ window }), quitCount: () => quitCount };
}

for (const role of panels) test(`${role}: ×を繰り返しても同じ窓と下書きを保持し、再表示できる`, async () => {
  const f = fixture(), window = f.createPanelWindow(role);
  for (let i = 0; i < 2; i++) {
    await f.setPanelVisibility(role, true);
    assert.equal(window.visible, true);
    f.close(window);
    assert.equal(window.visible, false);
    assert.equal(window.isDestroyed(), false);
    assert.equal(window.draft, '未送信の下書き');
    assert.equal(f.panelStates[role], false);
    assert.equal(f.createPanelWindow(role), window);
  }
  await f.setPanelVisibility(role, true);
  assert.equal(window.visible, true);
});

test('メインの×は非表示の子パネルもすべて破棄し、アプリ終了へ進む', async () => {
  const f = fixture(), core = f.createCoreWindow();
  const children = panels.map(role => f.createPanelWindow(role));
  await f.setPanelVisibility('chat', true);
  f.close(children[0]);
  f.close(core);
  assert.equal(core.isDestroyed(), true);
  assert.ok(children.every(window => window.isDestroyed()));
  assert.equal(f.panelWindows.size, 0);
  assert.ok(Object.values(f.panelStates).every(value => value === false));
  assert.equal(f.quitCount(), 1);
});

test('ログイン・設定は通常の閉じる処理を維持し、不正な送信元は無視する', () => {
  const f = fixture();
  for (const role of ['login', 'settings']) {
    const window = f.createBaseWindow({}, role, true);
    f.close(window);
    assert.equal(window.isDestroyed(), true);
  }
  assert.doesNotThrow(() => f.close(null));
});
