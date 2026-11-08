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
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as url from 'node:url';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';

async function desktop(platform = 'win32', owned = true, project: string | undefined = undefined) {
  const file = fileURLToPath(new URL('../panel/desktop.cjs', import.meta.url));
  const timers = new Map<number, { at: number; callback: () => void }>();
  const files = new Map<string, any>(), requests: any[] = [], kills: any[] = [], states: any[] = [], moves: any[] = [], dialogs: any[] = [];
  let dialogAnswer = 1;
  const handlers = new Map<string, (...args: any[]) => any>();
  let clock = 0, sequence = 0, window: any, exited = false, locked = false;
  const worker = Object.assign(new EventEmitter(), {
    pid: 1234 as number | undefined, connected: true, exitCode: null as number | null, signalCode: null as string | null,
    send(message: any, callback: (error?: Error) => void) { requests.push(message); callback(); },
    kill(signal?: string) { kills.push(['worker', signal]); },
  });
  const app = Object.assign(new EventEmitter(), {
    name: '', menu: [] as any[], dock: {menu: [] as any[], icon: '', setMenu(value: any[]) {this.menu = value;}, setIcon(value: string) {this.icon = value;}},
    paths: new Map<string, string>(), setName(name: string) {this.name = name;}, setPath(name: string, value: string) { this.paths.set(name, value); }, setAppUserModelId() {}, getPath: () => { throw new Error('ユーザーホームは参照しない'); }, whenReady: async () => {},
    requestSingleInstanceLock() { locked = true; return true; },
    quit() {
      let prevented = false;
      app.emit('before-quit', { preventDefault() { prevented = true; } });
      if (!prevented) { exited = true; locked = false; if (window) window.destroyed = true; }
    },
  });
  class Window extends EventEmitter {
    destroyed = false; top = false; maximized = false; minimized = false; raised = 0;
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: url.pathToFileURL(path.join(dirname(file), 'index.html')).href },
      send(_name: string, state: any) { states.push(state); }, isDestroyed: () => false,
      session: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} }, setWindowOpenHandler() {},
      async insertCSS() { return 'css'; }, async removeInsertedCSS() {}, async executeJavaScript() {},
    });
    constructor(options: any) { super(); if (!options.transparent) window = this; }
    setMenu() {} setPosition() {} setBounds() {} setMinimumSize() {} show() {} focus() {} restore() {} minimize() { this.minimized = true; }
    isMaximized() { return this.maximized; } maximize() { this.maximized = true; } unmaximize() { this.maximized = false; }
    setAlwaysOnTop(value: boolean) { this.top = value; } moveTop() { this.raised++; }
    // 初回演出（frontend_ide/host/scripts/window-opening.cjs）の透明キャンバスと透明度。
    showInactive() {} setOpacity() {} destroy() { this.destroyed = true; }
    getBounds() { return { x: 722, y: 8, width: 476, height: 414 }; }
    isDestroyed() { return this.destroyed; } isMinimized() { return false; } isVisible() { return !this.destroyed; }
    async loadURL() {}
    close() {
      let prevented = false;
      this.emit('close', { preventDefault() { prevented = true; } });
      if (!prevented) { this.destroyed = true; app.emit('window-all-closed'); }
    }
  }
  runInNewContext(readFileSync(file, 'utf8'), {
    __dirname: dirname(file), console, Date: { now: () => clock },
    process: { platform, pid: 999, env: { AIDIY_SLACK_READY: '/first-ready', AIDIY_SLACK_PROJECT: project }, kill: (...args: any[]) => { kills.push(args); } },
    setTimeout(callback: () => void, ms: number) { const id = ++sequence; timers.set(id, { at: clock + ms, callback }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
    require(name: string) {
      if (name === 'node:path') return path;
      if (name === '../../../frontend_ide/デスクトップ/長押し窓移動.cjs') return {attachNativeWindowMove: (window: any, screen: any, kind: string) => moves.push({window, screen, kind})};
      if (name === '../../../frontend_ide/デスクトップ/最前面ピン.cjs') return createRequire(import.meta.url)(name);
      if (name === '../../../frontend_ide/host/scripts/single-instance.cjs') return { 起動ロック: async () => owned ? { close: async () => {} } : null };
      // 3本共通のウィンドウ大きさ・初回演出は実物を使う。
      if (name.startsWith('../../../frontend_ide/host/scripts/')) return createRequire(import.meta.url)(name);
      if (name === 'node:url') return url;
      if (name === 'node:fs') return { mkdirSync() {}, writeFileSync(file: string, value: string) { files.set(file, JSON.parse(value)); } };
      if (name === 'node:child_process') return { fork: () => worker, spawn: (...args: any[]) => {
        kills.push(args); return Object.assign(new EventEmitter(), { kill() {} });
      } };
      if (name === 'electron') return { app, BrowserWindow: Window, dialog: { showMessageBox: async (_window: any, options: any) => { dialogs.push(options); return { response: dialogAnswer }; } }, Menu: {buildFromTemplate: (value: any[]) => value, setApplicationMenu(value: any[]) {app.menu = value;}}, ipcMain: { handle(name: string, callback: (...args: any[]) => any) { handlers.set(name, callback); } },
        screen: { getCursorScreenPoint: () => ({}), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) } };
      throw new Error(name);
    },
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  // 登場時の拡大演出（750ms）を模擬時刻で完了させる。
  for (let entry; (entry = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]) && entry[1].at <= 1000;) {
    clock = entry[1].at; timers.delete(entry[0]); entry[1].callback(); await flush();
  }
  return { app, worker, window, files, requests, kills, states, timers, flush, moves, handlers, dialogs, answer(value: number) { dialogAnswer = value; },
    exited: () => exited, locked: () => locked,
    exitWorker(code: number | null, signal: string | null = null) {
      worker.exitCode = code; worker.signalCode = signal; worker.connected = false; worker.emit('exit', code, signal);
    },
    async advance(ms: number) {
      const end = clock + ms;
      while (true) {
        const entry = [...timers.entries()].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        clock = entry[1].at; timers.delete(entry[0]); entry[1].callback(); await flush();
      }
      clock = end;
    },
  };
}

test('Slack の主窓にも共通の0.5秒長押しを一度取り付ける', async () => {
  const f = await desktop();assert.equal(f.moves.length,1);assert.equal(f.moves[0].window,f.window);assert.equal(f.moves[0].kind,'slack');
});

test('ブラウザ版が起動中なら Electron の画面・worker を増やさない', async () => {
  const f = await desktop('win32', false);
  assert.equal(f.window, undefined);
  assert.equal(f.requests.length, 0);
  assert.equal(f.files.get('/first-ready').alreadyRunning, true);
  assert.equal(f.exited(), true);
});

test('閉じる連打でも接続回収は1回、完了までは画面を保持し、終了後に起動ロックを解放する', async () => {
  const f = await desktop();
  f.window.close(); f.window.close(); f.app.quit();
  assert.equal(f.window.destroyed, false); assert.equal(f.exited(), false);
  assert.equal(f.requests.filter(item => item.action === 'shutdown').length, 1);
  assert.equal(f.states.at(-1).phase, 'stopping');
  f.app.emit('second-instance', {}, [], '', { readyFile: '/reopen-ready', autoConnect: true });
  assert.deepEqual(f.files.get('/reopen-ready'), { closing: true, pid: 999 });
  f.exitWorker(0); await f.flush();
  assert.equal(f.exited(), true); assert.equal(f.locked(), false); assert.equal(f.timers.size, 0);
});
test('Mac のSlack最小メニュー・Dock終了は接続回収を待つ', async () => {
  const f = await desktop('darwin');
  assert.equal(f.app.name, 'AiDiy Slack');assert.equal(f.app.menu[0].label, 'AiDiy Slack');assert.match(f.app.dock.icon, /AiDiy_slack\.png$/);
  f.app.menu[0].submenu[0].click();f.app.dock.menu[0].click();
  assert.equal(f.exited(), false);assert.equal(f.requests.filter(item => item.action === 'shutdown').length, 1);
  f.exitWorker(0);await f.flush();assert.equal(f.exited(), true);assert.equal(f.locked(), false);
});

test('workerが先にシグナル終了・起動失敗していても存在しないexitイベントを待たない', async () => {
  for (const failedToSpawn of [false, true]) {
    const f = await desktop();
    if (failedToSpawn) { f.worker.pid = undefined; f.worker.emit('error', new Error('spawn failed')); }
    else f.exitWorker(null, 'SIGTERM');
    f.window.close(); await f.flush();
    assert.equal(f.exited(), true); assert.equal(f.locked(), false); assert.equal(f.timers.size, 0);
  }
});

test('workerが応答しない場合は対象だけを強制終了し、exit通知が来なくても無期限に待たない', async () => {
  for (const platform of ['win32', 'linux']) {
    const f = await desktop(platform);
    f.window.close(); await f.advance(15000);
    assert.equal(f.exited(), false);
    if (platform === 'win32') {
      assert.equal(f.kills[0][0], 'taskkill'); assert.deepEqual(Array.from(f.kills[0][1]), ['/PID', '1234', '/T', '/F']);
    } else assert.deepEqual(f.kills[0], [-1234, 'SIGKILL']);
    await f.advance(3000);
    assert.equal(f.exited(), true); assert.equal(f.locked(), false);
  }
});

test('Slack の4操作は主frame専用で、ピンは OFF から切り替え・選択時だけ前面化する', async () => {
  const f = await desktop(), control = f.handlers.get('slack:window')!;
  const event = { sender: f.window.webContents, senderFrame: f.window.webContents.mainFrame };
  assert.deepEqual(control(event, 'getPinState'), { pinned: false, locked: false }); assert.equal(f.window.top, false);
  for (const denied of [{ ...event, senderFrame: {} }, { ...event, sender: {} }, { ...event, senderFrame: { url: event.senderFrame.url } }]) {
    for (const action of ['togglePin', 'getPinState', 'maximize', 'minimize', 'close']) assert.equal(control(denied, action), false);
  }
  assert.equal(f.window.top, false); assert.equal(f.window.maximized, false); assert.equal(f.window.minimized, false);
  assert.deepEqual(control(event, 'togglePin'), { pinned: true, locked: false }); assert.equal(f.window.top, true);
  f.window.emit('focus'); assert.equal(f.window.raised, 1);
  control(event, 'maximize'); assert.equal(control(event, 'isMaximized'), true); control(event, 'maximize'); assert.equal(control(event, 'isMaximized'), false);
  control(event, 'minimize'); assert.equal(f.window.minimized, true);
  control(event, 'togglePin'); f.window.emit('focus'); assert.equal(f.window.raised, 1); assert.equal(f.window.top, false);
  control(event, 'setLocked'); assert.equal(control(event, 'getPinState').locked, false);
  f.window.destroyed = true; assert.equal(control(event, 'togglePin'), false);
});

test('Slack preload は固定の窓操作と検証済みピン通知のみを公開する', async () => {
  const ipc = Object.assign(new EventEmitter(), { invoke: (...args: any[]) => args });
  let api: any;
  runInNewContext(readFileSync(new URL('../panel/preload.cjs', import.meta.url), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld(_name: string, value: any) { api = value; } }, ipcRenderer: ipc }) });
  for (const action of ['minimize', 'maximize', 'close']) assert.deepEqual(Array.from(api.window(action)), ['slack:window', action]);
  assert.equal(await api.window('setLocked'), false); assert.equal(await api.window({ action: 'close' }), false);
  assert.deepEqual(Array.from(api.getPinState()), ['slack:window', 'getPinState']); assert.deepEqual(Array.from(api.togglePin()), ['slack:window', 'togglePin']);
  const values: any[] = [], cancel = api.onPinState((value: any) => values.push(value));
  for (const value of [null, {}, { pinned: 1, locked: false }, { pinned: true }]) ipc.emit('slack:pin-state', {}, value);
  assert.equal(values.length, 0); ipc.emit('slack:pin-state', {}, { pinned: true, locked: false, extra: 'ignored' });
  assert.equal(JSON.stringify(values), JSON.stringify([{ pinned: true, locked: false }])); cancel(); assert.equal(ipc.listenerCount('slack:pin-state'), 0);
  api.onPinState(null)();
});

test('接続中の終了は確認し、キャンセルなら続ける。切断中はそのまま終了する（Discord と同じ動き）', async () => {
  const connected = await desktop();
  connected.worker.emit('message', { type: 'state', state: { phase: 'connected', message: '' } });
  connected.window.close(); await connected.flush();
  assert.equal(connected.dialogs.length, 1); assert.match(connected.dialogs[0].message, /Slack に接続中です。終了しますか/);
  assert.equal(connected.exited(), false); assert.equal(connected.requests.filter(item => item.action === 'shutdown').length, 0, 'キャンセルでは切断しない');
  connected.answer(0); connected.window.close(); await connected.flush();
  assert.equal(connected.dialogs.length, 2); assert.equal(connected.requests.filter(item => item.action === 'shutdown').length, 1);
  connected.exitWorker(0); await connected.flush(); assert.equal(connected.exited(), true);
  const idle = await desktop();
  idle.worker.emit('message', { type: 'state', state: { phase: 'idle', message: '' } });
  idle.window.close(); await idle.flush();
  assert.equal(idle.dialogs.length, 0); assert.equal(idle.requests.filter(item => item.action === 'shutdown').length, 1);
  idle.exitWorker(0); await idle.flush(); assert.equal(idle.exited(), true);
});

 test('Electronの保存先は起動プロジェクト内で、空・未指定はAiDiyルートになる', async () => {
  const aidiyRoot = fileURLToPath(new URL('../../../', import.meta.url));
  for (const project of [undefined, '', '/tmp/channel-project-A', '/tmp/channel-project-B']) {
    const f = await desktop('linux', true, project);
    const expected = path.join(project || aidiyRoot, '_AIDIY', 'aidiy_slack', 'electron');
    assert.equal(f.app.paths.get('userData'), expected);
    assert.equal(f.app.paths.get('sessionData'), expected);
  }
});
