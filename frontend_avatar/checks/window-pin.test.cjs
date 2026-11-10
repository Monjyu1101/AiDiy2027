// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 本番のmain/preload/Vueをメモリ上で読み、合成Electronだけで検証する。実サービスは起動しない。
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const project = path.resolve(__dirname, '..');
const load = createRequire(path.join(project, 'package.json'));
const ts = load('typescript');
const copy = value => JSON.parse(JSON.stringify(value));
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));

function transportFixture() {
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(path.join(project, 'electron/alone-transport.ts'), 'utf8')), {
    exports, URL, require: id => id === 'node:fs' ? {
      readFileSync(file) {
        assert.ok(file.endsWith('/_config/AiDiy_key.json'), 'fixture must never read real credentials');
        return JSON.stringify({ PORT_CORE: 18091 });
      },
    } : load(id),
  });
  return exports;
}

function mainFixture(alone = false, initialPinned = false) {
  const windows = [], handlers = new Map(), syncHandlers = new Map(), networkHooks = {};
  let ready;
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.bounds = { x: 0, y: 0, ...options };
      this.id = windows.push(this);
      this.visible = false;
      this.topCalls = [];
      this.raised = 0;
      this.focusCalls = 0;
      const messages = [];
      this.webContents = Object.assign(new EventEmitter(), {
        id: this.id,
        mainFrame: {},
        getURL: () => this.url,
        setWindowOpenHandler: handler => { this.openHandler = handler; },
        isLoading: () => false,
        isDestroyed: () => this.isDestroyed(),
        messages,
        send: (...args) => messages.push(copy(args)),
      });
    }
    async loadURL(url) {
      this.url = url; this.webContents.mainFrame.url = url;
      this.role = new URL(url).searchParams.get('role');
      queueMicrotask(() => { this.emit('ready-to-show'); this.webContents.emit('did-finish-load'); });
    }
    setAlwaysOnTop(...args) { this.topCalls.push(args); this.pinned = args[0]; }
    moveTop() { this.raised++; }
    isFocused() { return this.focused === true; }
    focus() {
      this.focusCalls++;
      for (const window of windows) window.focused = false;
      this.focused = true;
      this.emit('focus');
    }
    setMinimumSize() {}
    setResizable(value) { this.resizable = value; }
    setPosition(x, y) { Object.assign(this.bounds, { x, y }); }
    setBounds(bounds) { Object.assign(this.bounds, bounds); }
    center() {}
    show() { this.visible = true; }
    hide() { this.visible = false; }
    isVisible() { return this.visible; }
    isDestroyed() { return this.dead === true; }
    isMinimized() { return this.minimized === true; }
    minimize() { this.minimized = true; }
    isMaximizable() { return true; }
    isMaximized() { return this.maximized === true; }
    maximize() { this.maximized = true; }
    unmaximize() { this.maximized = false; }
    destroy() { this.dead = true; this.visible = false; this.emit('closed'); }
    close() { this.destroy(); }
    static fromWebContents(contents) { return windows.find(window => window.webContents === contents) || null; }
    static getAllWindows() { return windows.filter(window => !window.dead); }
  }
  const app = new EventEmitter();
  Object.assign(app, {
    getAppPath: () => project,
    setPath() {},
    setAppUserModelId() {},
    requestSingleInstanceLock: () => true,
    quit() { this.quitCalls = (this.quitCalls || 0) + 1; },
    whenReady: () => ({ then(callback) { ready = callback; } }),
  });
  const electron = {
    app, BrowserWindow: Window,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: (channel, handler) => syncHandlers.set(channel, handler) },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    session: { defaultSession: { setDisplayMediaRequestHandler() {}, webRequest: Object.fromEntries(['onBeforeSendHeaders','onHeadersReceived','onCompleted','onErrorOccurred'].map(name => [name, fn => networkHooks[name] = fn])) } },
  };
  const context = {
    __dirname: path.join(project, 'dist-electron'), exports: {}, console, URL,
    process: { platform: 'win32', env: { AIDIY_AVATAR_INITIAL_PINNED: initialPinned ? '1' : undefined, ...(alone ? { AIDIY_AVATAR_ALONE: '1', AIDIY_AVATAR_PROJECT: '/fixture/selected', VITE_DEV_SERVER_URL: 'http://127.0.0.1:19092/' } : {}) } },
    require: id => id === 'node:fs' ? { ...fs, mkdirSync() {}, realpathSync: value => value, statSync: () => ({ isDirectory: () => true }) } : id === 'electron' ? electron
      : id === './alone-transport' ? transportFixture()
      : id.endsWith('project-storage.cjs') ? {...load(id),preparePrivateDirectory(){}} : id.endsWith('window-opening.cjs') ? { 拡大表示: async (_Constructor, window, options) => {
        if (window.isDestroyed() || !options.canShow()) return false;
        window.show(); return true;
      } }
        : id.endsWith('長押し窓移動.cjs') ? { attachNativeWindowMove() {} } : load(id),
  };
  const source = fs.readFileSync(path.join(project, 'electron/main.ts'), 'utf8');
  vm.runInNewContext(compile(source) + '\nglobalThis.probe = {createLoginWindow,createCoreWindow,createPanelWindow,setPanelVisibility,openSettingsWindow,openCoreWindow,openLoginWindow,ウィンドウ表示,windowPins};', context);
  ready();
  const event = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  return { ...context.probe, windows, Window, event, app, handlers, syncHandlers, networkHooks,
    invoke: (channel, window, ...args) => handlers.get(channel)(event(window), ...args),
    raw: (channel, event) => handlers.get(channel)(event),
  };
}

test('ログインとAvatarの切替では終了せず、設定窓を残してログインを閉じてもアプリ終了', async () => {
  const f = mainFixture();
  await flush();
  await f.openCoreWindow();
  f.openSettingsWindow('fixture');
  await flush();
  await f.openLoginWindow();
  assert.equal(f.app.quitCalls || 0, 0);
  const login = f.windows.find(window => window.role === 'login');
  login.close();
  assert.equal(f.app.quitCalls, 1);
});
test('AvatarのOS閉じるでも非表示のログイン窓だけを残さない', async () => {
  const f = mainFixture();
  await flush();
  await f.openCoreWindow();
  f.windows.find(window => window.role === 'core').close();
  assert.equal(f.app.quitCalls, 1);
});

test('ログイン窓だけON・他の11窓はOFF起動し、本人だけ切替・通知、同じ最前面層で選択された窓だけを前へ出す', async () => {
  // 共通の最前面ピンは、Windows では floating で最前面にならないため normal 層を使う。
  const pinLevel = process.platform === 'win32' ? 'normal' : 'floating';
  const f = mainFixture();
  f.createCoreWindow(false);
  for (const role of ['chat', 'file', 'image', 'code1', 'code2', 'code3', 'code4', 'code5', 'code6']) f.createPanelWindow(role);
  f.openSettingsWindow('fixture');
  await flush();
  assert.equal(f.windows.length, 12);
  for (const window of f.windows) {
    const initial = window.role === 'login';
    assert.deepEqual(window.topCalls, [initial ? [true, pinLevel] : [false]], window.role);
    assert.deepEqual(copy(f.invoke('window:get-pin', window)), { pinned: initial, locked: false });
    const otherMessages = f.windows.filter(other => other !== window).map(other => other.webContents.messages.length);
    assert.deepEqual(copy(f.invoke('window:toggle-pin', window, 'another-window')), { pinned: !initial, locked: false });
    assert.deepEqual(window.topCalls.at(-1), initial ? [false] : [true, pinLevel]);
    assert.deepEqual(f.windows.filter(other => other !== window).map(other => other.webContents.messages.length), otherMessages);
  }
  const [login, core, chat] = f.windows;
  const before = f.windows.map(window => window.raised);
  core.focus();
  assert.deepEqual(f.windows.map(window => window.raised), before.map((count, index) => count + (index === 1 ? 1 : 0)));
  assert.equal(chat.focusCalls, 0, '他の窓へフォーカスを奪い返さない');
  f.invoke('window:toggle-pin', core);
  const raised = core.raised, calls = core.topCalls.length;
  core.focus();
  await f.ウィンドウ表示(core);
  assert.equal(core.raised, raised);
  assert.equal(core.topCalls.length, calls, '表示の再要求でOFFを上書きしない');
  assert.equal(core.pinned, false);
  assert.equal(login.options.frame, false);
  for (const window of f.windows) {
    window.destroy();
    assert.equal(window.listenerCount('focus'), 0, '破棄時にピン購読を解除');
  }
});

test('ピンとタイトル操作は所有main frameだけを許可し、ロック中の切替を拒否する', () => {
  const f = mainFixture(), window = f.windows[0];
  const unknown = new f.Window({ show: false });
  for (const event of [
    { sender: {}, senderFrame: {} },
    f.event(unknown),
    { sender: window.webContents, senderFrame: {} },
    { sender: window.webContents, senderFrame: null },
  ]) {
    assert.equal(f.raw('window:get-pin', event), null);
    assert.equal(f.raw('window:toggle-pin', event), null);
    assert.equal(f.raw('window:toggle-maximize', event), false);
    f.raw('window:minimize-self', event);
    f.raw('window:close-self', event);
    assert.equal(window.isDestroyed(), false);
    assert.equal(window.isMinimized(), false);
  }
  f.windowPins.setLocked(window, true);
  assert.deepEqual(copy(f.invoke('window:toggle-pin', window)), { pinned: true, locked: true });
  f.windowPins.setLocked(window, false);
  // 先頭はログイン窓。ロック解除後は起動時の希望（ON）へ戻る。
  assert.deepEqual(copy(f.invoke('window:get-pin', window)), { pinned: true, locked: false });
  assert.equal(f.invoke('window:toggle-maximize', window), true);
  assert.equal(f.invoke('window:toggle-maximize', window), false);
  f.invoke('window:minimize-self', window);
  assert.equal(window.isMinimized(), true);
  window.destroy();
  assert.equal(f.invoke('window:toggle-pin', window), null);
});

test('preloadは引数なしの本人用ピンAPIと解除可能な状態購読だけを公開する', async () => {
  const ipcRenderer = new EventEmitter(), calls = [];
  ipcRenderer.sendSync = channel => { assert.equal(channel, 'avatar:metadata'); return { avatarAlone: false, projectPath: '', coreBaseUrl: '' }; };
  ipcRenderer.invoke = async (...args) => { calls.push(args); return { pinned: false, locked: false }; };
  let api;
  vm.runInNewContext(compile(fs.readFileSync(path.join(project, 'electron/preload.ts'), 'utf8')), {
    exports: {}, process: { versions: {} },
    require: id => { assert.equal(id, 'electron'); return { ipcRenderer, contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'desktopApi'); api = value; } } }; },
  });
  await api.getWindowPinState('other');
  await api.toggleWindowPin('other');
  await api.toggleMaximizeCurrentWindow('other');
  assert.deepEqual(calls, [['window:get-pin'], ['window:toggle-pin'], ['window:toggle-maximize']]);
  const values = [], stop = api.onWindowPinChanged(value => values.push(value));
  const state = { pinned: true, locked: false };
  ipcRenderer.emit('window:pin-changed', { sender: 'not exposed' }, state);
  assert.deepEqual(values, [state]);
  stop();
  assert.equal(ipcRenderer.listenerCount('window:pin-changed'), 0);
});

function controlsFixture({ delayed = false, web = false } = {}) {
  const vue = load('vue'), { parse, compileScript, compileTemplate } = load('@vue/compiler-sfc');
  const filename = path.join(project, 'src/components/_WindowControls.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: 'pin-test', genDefaultAs: 'component' });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'pin-test', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  let mounted, unmounted, changed, resolveRead;
  const emitted = [], calls = [], module = { exports: {} };
  const api = {
    getWindowPinState: () => delayed ? new Promise(resolve => { resolveRead = resolve; }) : Promise.resolve({ pinned: false, locked: false }),
    toggleWindowPin: async () => { calls.push('pin'); return { pinned: true, locked: false }; },
    minimizeCurrentWindow: () => calls.push('minimize'),
    toggleMaximizeCurrentWindow: () => calls.push('maximize'),
    onWindowPinChanged(callback) { changed = callback; return () => { changed = undefined; calls.push('unsubscribe'); }; },
  };
  vm.runInNewContext(compile(`${script.content}\n${template.code}\ncomponent.render = render; module.exports = component;`), {
    module, exports: module.exports, console, window: web ? {} : { desktopApi: api },
    require: id => {
      assert.equal(id, 'vue');
      return { ...vue, onMounted(callback) { mounted = callback; }, onBeforeUnmount(callback) { unmounted = callback; } };
    },
  });
  const component = module.exports, props = { closable: true };
  const scope = vue.effectScope();
  const data = scope.run(() => component.setup(props, { expose() {}, emit: (...args) => emitted.push(args) }));
  const walk = node => [node, ...(Array.isArray(node?.children) ? node.children.flatMap(walk) : [])];
  const buttons = () => walk(component.render({}, [], props, vue.proxyRefs(data), {}, {})).filter(node => node?.type === 'button');
  return { data, calls, emitted, buttons, mount: () => mounted(), notify: state => changed?.(state),
    resolveRead: state => resolveRead(state), close() { unmounted(); scope.stop(); },
  };
}

test('実Vueのボタン順は− □ 📌 ×で、OFF表示・ON・ロック・購読解除を反映する', async () => {
  const f = controlsFixture();
  try {
    assert.deepEqual(f.buttons().map(button => button.children), ['−', '□', '📌', '×']);
    assert.equal(f.buttons()[2].props['aria-pressed'], false);
    await f.mount();
    assert.equal(f.buttons()[2].props.disabled, false);
    await f.buttons()[2].props.onClick();
    assert.equal(f.buttons()[2].props['aria-pressed'], true);
    assert.match(f.buttons()[2].props.class, /pinned/);
    f.notify({ pinned: true, locked: true });
    assert.equal(f.buttons()[2].props.disabled, true);
    assert.match(f.buttons()[2].props.title, /VR/);
    await f.buttons()[2].props.onClick();
    assert.deepEqual(f.calls, ['pin'], 'disabled状態では処理側でも解除を拒否');
    f.buttons()[0].props.onClick();
    f.buttons()[1].props.onClick();
    f.buttons()[3].props.onClick();
    assert.deepEqual(f.calls, ['pin', 'minimize', 'maximize']);
    assert.deepEqual(f.emitted, [['close']]);
  } finally { f.close(); }
  assert.equal(f.calls.at(-1), 'unsubscribe');
});

test('読込中の新しい通知を古い取得結果で上書きせず、WebでもIPC不在で落ちない', async () => {
  const f = controlsFixture({ delayed: true });
  const mounting = f.mount();
  f.notify({ pinned: true, locked: true });
  f.resolveRead({ pinned: false, locked: false });
  await mounting;
  assert.equal(f.buttons()[2].props['aria-pressed'], true);
  assert.equal(f.buttons()[2].props.disabled, true);
  f.close();
  const web = controlsFixture({ web: true });
  await web.mount();
  assert.equal(web.buttons()[2].props.disabled, true);
  web.buttons()[0].props.onClick();
  web.buttons()[1].props.onClick();
  web.close();
});


test('独立アプリへ移したTask/TeamのIPCは登録せず、残ったAvatar IPCを維持する', () => {
  const f = mainFixture();
  for (const channel of ['task:toggle-all', 'team:toggle-window', 'team:close-window', 'task-dialog:open', 'task-dialog:get-payload']) {
    assert.equal(f.handlers.has(channel), false, channel);
  }
  for (const channel of ['panel:toggle', 'panel:apply-states', 'window:open-core', 'settings:open']) assert.equal(f.handlers.has(channel), true, channel);
  const preload = fs.readFileSync(path.join(project, 'electron/preload.ts'), 'utf8');
  const declarations = fs.readFileSync(path.join(project, 'src/env.d.ts'), 'utf8');
  for (const source of [preload, declarations]) assert.doesNotMatch(source, /toggleTaskWindows|toggleTeamWindow|closeTeamWindow|openTaskDialogWindow|getTaskDialogPayload|onTaskDialogPayload/);
});


test('Alone main/preload: all panels and settings, safe synchronous metadata and secured lifecycle', async () => {
  const f = mainFixture(true);
  await flush();
  assert.deepEqual(f.windows.map(window => window.role), ['core']);
  const core = f.windows[0];
  const ipcRenderer = new EventEmitter();
  ipcRenderer.sendSync = channel => {
    const event = f.event(core);
    f.syncHandlers.get(channel)(event);
    return event.returnValue;
  };
  ipcRenderer.invoke = (channel, ...args) => f.invoke(channel, core, ...args);
  let api;
  vm.runInNewContext(compile(fs.readFileSync(path.join(project, 'electron/preload.ts'), 'utf8')), {
    exports: {}, process: { versions: {} },
    require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld(_name, value) { api = value; } } }),
  });
  assert.equal(api.avatarAlone, true);
  assert.equal(api.projectPath, '/fixture/selected');
  assert.equal(api.coreBaseUrl, 'http://127.0.0.1:18091');
  assert.doesNotMatch(JSON.stringify(api), /access_token|Authorization|Bearer/);
  await assert.rejects(api.togglePanel('unknown'));
  await assert.rejects(api.applyPanelStates({ invalid: true }));
  await api.openLoginWindow();
  assert.deepEqual(f.windows.map(window => window.role), ['core']);
  await api.openSettingsWindow('fixture-session');
  await flush();
  assert.deepEqual(f.windows.map(window => window.role), ['core', 'settings']);
  const settings = f.windows[1];
  assert.ok(settings.webContents.messages.some(message => message[0] === 'settings:session-id' && message[1] === 'fixture-session'));
  await api.togglePanel('file');await api.togglePanel('image');await flush();
  assert.deepEqual(f.windows.map(window => window.role), ['core', 'settings', 'file', 'image']);
  assert.equal(f.windows[2].isVisible(), true);assert.equal(f.windows[3].isVisible(), true);
  await api.togglePanel('file');assert.equal(f.windows[2].isVisible(), false);
  await api.togglePanel('file');assert.equal(f.windows.length, 4);
  for (let n = 1; n <= 6; n++) await api.togglePanel('code' + n);
  await api.togglePanel('chat');await flush();
  assert.equal(f.windows.length, 11);
  for (const role of ['chat', 'file', 'image', 'code1', 'code2', 'code3', 'code4', 'code5', 'code6']) {
    const panel = f.windows.find(window => window.role === role);assert.equal(panel.isVisible(), true);
    await api.applyPanelStates({ [role]: false });assert.equal(panel.isVisible(), false);
    await api.applyPanelStates({ [role]: true });assert.equal(panel.isVisible(), true);
  }
  await assert.rejects(api.togglePanel('toString'));
  await assert.rejects(f.raw('panel:toggle', { sender: core.webContents, senderFrame: {} }, 'file'));

  for (const window of f.windows) {
    assert.equal(window.options.webPreferences.webSecurity, true);
    assert.equal(window.openHandler().action, 'deny');
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
      let prevented = false;
      window.webContents.emit(name, { preventDefault() { prevented = true; } });
      assert.equal(prevented, true, name);
    }
    const event = f.event(window); f.syncHandlers.get('avatar:metadata')(event);
    assert.equal(event.returnValue.avatarAlone, true);
  }
  const invalid = { sender: core.webContents, senderFrame: {} };
  f.syncHandlers.get('avatar:metadata')(invalid);
  assert.equal(invalid.returnValue.avatarAlone, false);
  const before = f.windows.length;
  await assert.rejects(f.raw('panel:apply-states', invalid, { code1: true }));
  f.raw('settings:open', invalid); assert.equal(f.windows.length, before);
  core.close(); assert.equal(f.app.quitCalls, 1, 'core close quits even with settings open');
});


test('IDE起動の初回コアだけピンON、単独はOFF、解除後の再表示・再生成では戻さない', async () => {
  for (const initialPinned of [false, true]) {
    const f = mainFixture(true, initialPinned);
    await flush();
    const core = f.windows[0];
    assert.equal(core.pinned, initialPinned);
    if (initialPinned) f.invoke('window:toggle-pin', core);
    assert.equal(core.pinned, false);
    f.createCoreWindow();
    await f.openCoreWindow();
    await f.openLoginWindow();
    await f.ウィンドウ表示(core);
    assert.equal(core.pinned, false);
    f.app.emit('second-instance');
    assert.equal(core.pinned, false, '再起動要求でピンを上書きしない');
    f.openSettingsWindow('fixture');
    await flush();
    assert.equal(f.windows[1].pinned, false);
    core.close();
    assert.equal(f.createCoreWindow(false).pinned, false);
  }
});
