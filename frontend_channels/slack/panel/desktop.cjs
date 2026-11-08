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

const { app, BrowserWindow, ipcMain, screen, Menu, dialog } = require('electron');
const { fork, spawn } = require('node:child_process');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { writeFileSync } = require('node:fs');
const { programDataDirectory, preparePrivateDirectory } = require('../../../frontend_ide/host/scripts/project-storage.cjs');
const size = require('../../../frontend_ide/host/scripts/window-size.cjs');
const { 拡大表示 } = require('../../../frontend_ide/host/scripts/window-opening.cjs');
const { attachNativeWindowMove } = require('../../../frontend_ide/デスクトップ/長押し窓移動.cjs');
const { createWindowPins } = require('../../../frontend_ide/デスクトップ/最前面ピン.cjs');
const { 起動ロック } = require('../../../frontend_ide/host/scripts/single-instance.cjs');

const root = join(__dirname, '..');
const page = pathToFileURL(join(__dirname, 'index.html')).href;
app.setName(process.platform === 'darwin' ? 'AiDiy Slack' : 'aidiy_slack');
const userData = programDataDirectory(process.env.AIDIY_SLACK_PROJECT ?? '', 'aidiy_slack', join(root, '../..'), ['electron']);
preparePrivateDirectory(userData);
app.setPath('userData', userData);
app.setPath('sessionData', userData);
if (process.platform === 'win32') app.setAppUserModelId('AiDiy.aidiy_slack');
let window, worker, quitting = false, shutdownComplete = false, shutdown;
// 接続中の終了だけ確認する（Slack / Discord 共通）。phase は worker から届く最新の接続状態。
let phase = 'idle', closeAsking = false;
const pins = createWindowPins({ onChanged: (target, state) => {
  if (!target.isDestroyed() && !target.webContents.isDestroyed()) target.webContents.send('slack:pin-state', state);
} });
let sequence = 0;
const pending = new Map();
const readyFile = process.env.AIDIY_SLACK_READY;
const autoConnect = process.env.AIDIY_SLACK_CONNECT === '1';
let instance;
app.on('will-quit', () => { void instance?.close(); });
function ready(file = readyFile) { if (file) writeFileSync(file, JSON.stringify({ windowShown: true })); }
function request(action, value) {
  return new Promise((resolve, reject) => {
    if (!worker?.connected || quitting) { reject(new Error('接続処理を開始できません。パネルを開き直してください。')); return; }
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('処理が完了しません。パネルを閉じて開き直してください。')); }, 60_000);
    pending.set(id, { resolve, reject, timer });
    worker.send({ id, action, value }, error => {
      if (error && pending.has(id)) { pending.delete(id); clearTimeout(timer); reject(new Error('接続処理との通信が切れました。')); }
    });
  });
}
function stopWorker() {
  if (shutdown) return shutdown;
  shutdown = new Promise(resolve => {
    if (!worker || !worker.pid || worker.exitCode !== null || worker.signalCode !== null) { resolve(); return; }
    let deadline;
    const done = () => { clearTimeout(timer); clearTimeout(deadline); resolve(); };
    const killWorker = () => { try { worker.kill('SIGKILL'); } catch {} };
    const timer = setTimeout(() => {
      // 通常は IPC で CLI を回収。応答しない場合だけ、この worker の子孫を停止する。
      console.error('Slack の終了応答がないため、接続処理プロセスを停止します。');
      if (process.platform === 'win32') {
        const kill = spawn('taskkill', ['/PID', String(worker.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        kill.on('error', killWorker);
        kill.on('exit', code => { if (code !== 0) killWorker(); });
        // taskkill 自身が応答しなくても Electron の終了を無期限に止めない。
        deadline = setTimeout(() => { kill.kill(); killWorker(); done(); }, 3000);
      }
      else {
        try { process.kill(-worker.pid, 'SIGKILL'); } catch { killWorker(); }
        deadline = setTimeout(done, 3000);
      }
    }, 15_000);
    worker.once('exit', done);
    try {
      if (worker.connected) worker.send({ action: 'shutdown' }, () => {});
      else worker.kill();
    } catch { killWorker(); }
  });
  return shutdown;
}
if (!app.requestSingleInstanceLock({ readyFile, autoConnect })) {
  app.quit();
} else {
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    // 起動側はこのプロセスの終了後に再試行する。消える画面を起動成功と通知しない。
    if (quitting) {
      if (data.readyFile) writeFileSync(data.readyFile, JSON.stringify({ closing: true, pid: process.pid }));
      return;
    }
    if (!window || window.isDestroyed()) {
      if (data.readyFile) writeFileSync(data.readyFile, JSON.stringify({ alreadyRunning: true }));
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show(); window.focus(); ready(data.readyFile);
    if (data.autoConnect) void request('auto-start').catch(() => {});
  });
  app.on('before-quit', event => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('パネルを終了しています。')); }
    pending.clear();
    if (window && !window.isDestroyed()) window.webContents.send('slack:state', { phase: 'stopping', message: '接続を終了しています…', fatal: true });
    void stopWorker().finally(() => { shutdownComplete = true; app.quit(); });
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    instance = await 起動ロック('aidiy_slack', () => {
      if (quitting || !window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
    });
    if (!instance) {
      if (readyFile) writeFileSync(readyFile, JSON.stringify({ alreadyRunning: true }));
      app.quit();
      return;
    }
    worker = fork(join(root, 'src/panel-worker.ts'), [], {
      cwd: root, execPath: process.env.AIDIY_SLACK_NODE,
      execArgv: ['--import', pathToFileURL(join(root, 'node_modules/tsx/dist/loader.mjs')).href],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true, detached: process.platform !== 'win32',
    });
    worker.on('message', message => {
      if (message.type === 'state') { phase = message.state?.phase || 'idle'; if (!quitting && !window?.isDestroyed()) window?.webContents.send('slack:state', message.state); return; }
      if (message.type === 'activity') { if (!quitting && !window?.isDestroyed()) window?.webContents.send('slack:activity', message.activity); return; }
      const job = pending.get(message.id); if (!job) return;
      clearTimeout(job.timer); pending.delete(message.id);
      if (message.error) job.reject(new Error(message.error)); else job.resolve(message.result);
    });
    const failed = () => {
      for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('接続処理が終了しました。パネルを開き直してください。')); }
      pending.clear();
      if (!quitting && window && !window.isDestroyed()) window.webContents.send('slack:state', { phase: 'error', message: '接続処理が終了しました。パネルを開き直してください。', fatal: true });
    };
    worker.on('exit', failed); worker.on('error', failed);
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    // 幅は aidiy_code / aidiy_live と共通、高さは設定パネル用（frontend_ide/host/scripts/window-size.cjs）。
    const width = Math.min(size.幅, area.width), height = Math.min(size.パネル高さ, area.height);
    window = new BrowserWindow({
      title: 'AiDiy Slack', width, height, minWidth: size.最小幅, minHeight: size.パネル高さ,
      x: area.x + Math.round((area.width - width) / 2), y: area.y + 8,
      frame: false, roundedCorners: false, show: false, backgroundColor: '#101217', autoHideMenuBar: true,
      icon: join(__dirname, 'AiDiy_slack.png'),
      webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    window.setMenu(null);
    pins.register(window);
    attachNativeWindowMove(window, screen, 'slack');
    window.on('close', event => {
      if (shutdownComplete) return;
      event.preventDefault();
      if (quitting || closeAsking) return;
      // 切断中はそのまま終了する。接続中（接続処理中・再接続待ちを含む）は終了してよいか確認する。
      if (!['connecting', 'connected', 'reconnecting'].includes(phase)) { app.quit(); return; }
      closeAsking = true;
      void dialog.showMessageBox(window, {
        type: 'question', buttons: ['終了', 'キャンセル'], defaultId: 0, cancelId: 1, noLink: true,
        title: 'AiDiy Slack', message: 'Slack に接続中です。終了しますか？', detail: '終了すると Slack から切断し、実行中のコード要求も止まります。',
      }).then(({ response }) => { closeAsking = false; if (response === 0) app.quit(); }, () => { closeAsking = false; });
    });
    if (process.platform === 'darwin') require('../../../frontend_ide/host/scripts/MacOS-Menu.cjs').Macメニューを設定({ app, Menu, 名前: 'AiDiy Slack', 閉じる: () => window.close(), icon: join(__dirname, 'AiDiy_slack.png'), platform: process.platform });
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const trusted = event => window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === page;
    ipcMain.handle('slack:request', (event, action, value) => {
      if (!trusted(event) || !['initial', 'select-code', 'catalog-code', 'start', 'stop'].includes(action)) throw new Error('許可されていない操作です。');
      return request(action, value);
    });
    ipcMain.handle('slack:window', (event, action) => {
      if (!trusted(event)) return false;
      if (action === 'getPinState') return pins.state(window);
      if (action === 'togglePin') return pins.toggle(window);
      if (action === 'isMaximized') return window.isMaximized();
      if (action === 'minimize') window.minimize();
      else if (action === 'maximize') { if (window.isMaximized()) window.unmaximize(); else window.maximize(); }
      else if (action === 'close') window.close();
      return false;
    });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-redirect', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await window.loadURL(page);
    // Windows の画面拡大率による丸め後の幅で中央を合わせてから表示する。
    window.setPosition(area.x + Math.round((area.width - window.getBounds().width) / 2), area.y + 8);
    // aidiy_code / aidiy_live と同じ初回演出（scripts/window-opening.cjs）。拡大が終わってから内容をフェード表示する。
    const hidden = await window.webContents.insertCSS('body{opacity:0}');
    if (!(await 拡大表示(BrowserWindow, window, { background: '#101217' }))) return;
    if (!window.isVisible()) throw new Error();
    await window.webContents.removeInsertedCSS(hidden);
    ready();
    if (autoConnect) void request('auto-start').catch(() => {});
  }).catch(error => { console.error(`Slack パネルを開けませんでした: ${error.message}`); app.quit(); process.exitCode = 1; });
}
