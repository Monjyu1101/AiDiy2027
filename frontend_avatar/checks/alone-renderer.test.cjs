// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Real Vue setup/render, synthetic Core only. No application services, credentials or audio devices.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
function load(filename, globals, imports, hooks) {
  const source = fs.readFileSync(path.join(__dirname, '../src', filename), 'utf8');
  const { descriptor } = parse(source);
  const script = compileScript(descriptor, { id: 'alone', genDefaultAs: 'component' });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'alone', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const output = ts.transpileModule(`${script.content}\n${template.code}\ncomponent.render = render;module.exports = component`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, console, URL, URLSearchParams, Event, ...globals,
    require: id => id === 'vue' ? { ...vue, withDirectives: node => node, ...hooks } : imports[id] || { default: { name: id } },
  });
  return module.exports;
}
const defaults = () => ({ CODE_BASE_PATH: '', LIVE_AI_NAME: 'fixture-live' });
function harness({ alone = true, role = 'core', authFailure = false, holdAuth = false } = {}) {
  const calls = [], sockets = [], timers = new Map(), mounts = [], dispose = [], broadcasts = [];
  let nextTimer = 0, rejectAuth = authFailure, resolveAuth, closed = 0, panelCalls = 0;
  const timer = (fn, delay) => { timers.set(++nextTimer, { fn, delay }); return nextTimer; };
  const storage = new Map();
  const authStorage = {
    getItem(key) { if (alone && ['token', 'user', 'avatar_session_id'].includes(key)) throw Error(`Read auth storage: ${key}`); return storage.get(key) || null; },
    setItem(key, value) { if (alone) throw Error(`Wrote auth storage: ${key}`); storage.set(key, value); },
    removeItem(key) { if (alone) throw Error(`Removed auth storage: ${key}`); storage.delete(key); },
  };
  const desktopApi = {
    avatarAlone: alone, projectPath: '/fixture/project A', getWindowRole: async () => role,
    getPanelStates: async () => ({}), onPanelStatesChanged() {}, onWindowShown() {}, onSettingsPrepare() {},
    closeCurrentWindow() { closed++; }, openLoginWindow() { throw Error('Unexpected login window'); },
    applyPanelStates() { panelCalls++;return Promise.resolve({}); }, togglePanel() { panelCalls++;return Promise.resolve({}); },
  };
  class Socket {
    handlers = new Map();connected = false;closed = false;sent = [];
    constructor(url, sessionId, channel, project) { Object.assign(this, { url, sessionId, channel, project });sockets.push(this); }
    on(name, fn) { this.handlers.set(name, fn); }
    onStateChange(fn) { this.state = fn; fn(false); }
    isConnected() { return this.connected; }
    async connect() {
      this.connected = true; this.state?.(true);
      this.handlers.get('init')?.({ メッセージ内容: { モデル設定: { CODE_BASE_PATH: '/wrong/default', LIVE_AI_NAME: 'fixture-live' }, ボタン: { チャットモード: 'code3', チャット: true, エージェント1: true, ファイル: true } } });
      return this.sessionId || 'new-session';
    }
    updateState(state) { this.sent.push(state); }
    disconnect() { this.closed = true;this.connected = false;this.state?.(false); }
  }
  const userResponse = { data: { status: 'OK', data: { 利用者ID: 'internal-fixture', 利用者名: '内部接続' } } };
  const api = { async post(url, body) {
    calls.push({ url, body });
    if (url.includes('現在利用者')) {
      if (holdAuth) return new Promise(done => { resolveAuth = () => done(userResponse); });
      if (rejectAuth) throw Error('secret diagnostic must not render');
      return userResponse;
    }
    return { data: { status: 'OK', data: { セッションID: body?.セッションID || 'new-session' } } };
  } };
  const globals = { window: { desktopApi, location: { search: '', pathname: '/', href: 'http://127.0.0.1:54321/' }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
    localStorage: authStorage, sessionStorage: authStorage, setTimeout: timer, clearTimeout: id => timers.delete(id), setInterval: timer, clearInterval: id => timers.delete(id),
    BroadcastChannel: class { constructor(name) { this.name = name; }addEventListener() {}removeEventListener() {}close() {}postMessage(data) { broadcasts.push(data); } },
  };
  const component = load('AiDiy.vue', globals, { '@/api/client': { default: api }, '@/api/config': { defaultModelSettings: defaults }, '@/api/websocket': { AIWebSocket: Socket, createWebSocketUrl: () => 'ws://fixture/core' } }, { onMounted: fn => mounts.push(fn), onBeforeUnmount: fn => dispose.push(fn) });
  const scope = vue.effectScope();
  const data = scope.run(() => component.setup({}, { expose() {} }));
  return { data, sockets, calls, timers, broadcasts, get closed() { return closed; }, get panelCalls() { return panelCalls; },
    mount: async () => { for (const fn of mounts) await fn(); await vue.nextTick(); },
    stop: () => { dispose.forEach(fn => fn());scope.stop(); }, recover: () => { rejectAuth = false; }, finishAuth: () => resolveAuth(),
    runRetry: async () => { const [id, pending] = [...timers].find(([, v]) => v.delay === 5000);timers.delete(id);pending.fn();for (let i = 0; i < 10; i++) await Promise.resolve();await vue.nextTick(); },
  };
}
test('単独Avatarはログイン保存に触れずCore/inputを指定プロジェクトで接続し子パネルを開かない', async () => {
  const f = harness();
  try {
    await f.mount();
    assert.equal(f.data.コアウィンドウ.value, true);
    assert.equal(f.data.認証済み.value, true);
    assert.deepEqual(f.sockets.map(s => s.channel), ['core', 'input']);
    assert.equal(f.sockets[0].sessionId, '', '選択プロジェクトの初回WSでセッションを生成する');
    assert.ok(f.calls.every(call => !call.url.includes('/初期化')), '共通プロジェクトのREST初期化を使わない');
    assert.ok(f.sockets.every(s => s.project === '/fixture/project A'));
    assert.equal(f.data.モデル設定.value.CODE_BASE_PATH, '/fixture/project A');
    assert.equal(f.data.チャットモード.value, 'live');
    assert.ok(Object.values(f.data.パネル表示状態.value).every(v => v === false));
    await f.data.パネル切替('code1');await f.data.パネル有効化('chat');
    assert.equal(f.panelCalls, 0);
    assert.equal(f.broadcasts.length, 0);
    f.data.デスクトップチャンネルメッセージ処理({ data: { type: 'set-chat-mode', mode: 'code2' } });
    assert.equal(f.data.チャットモード.value, 'live');
    f.data.デスクトップチャンネルメッセージ処理({ data: { type: 'settings-saved', waitSeconds: 1 } });
    assert.equal(f.data.再起動カウントダウン表示.value, true);
    await f.data.再起動後再接続();
    assert.equal(f.sockets[2].sessionId, 'new-session');
    assert.ok(f.sockets.slice(0, 2).every(s => s.closed));
    assert.ok(f.sockets.every(s => s.project === '/fixture/project A'));
    f.data.認証クリア();assert.equal(f.closed, 1);
    assert.ok(f.sockets.every(s => s.closed));
  } finally { f.stop(); }
});
test('内部認証失敗はコア窓内の安全なエラーで再試行し、復帰後に同じ画面を利用する', async () => {
  const f = harness({ authFailure: true });
  try {
    await f.mount();
    assert.equal(f.data.ウィンドウロール.value, 'core');assert.equal(f.sockets.length, 0);
    assert.match(f.data.コアエラー.value, /内部認証/);assert.doesNotMatch(f.data.コアエラー.value, /secret/);
    assert.equal(f.data.コア処理中.value, false);
    f.recover();await f.runRetry();
    assert.equal(f.sockets.length, 2);assert.equal(f.data.コアエラー.value, '');
  } finally { f.stop(); }
});
test('閉じる/破棄後の遅延認証応答は新たなソケットや再試行を生成しない', async () => {
  const f = harness({ holdAuth: true });
  const pending = f.mount();for (let i = 0; i < 5; i++) await Promise.resolve();
  f.stop();f.finishAuth();await pending;
  assert.equal(f.sockets.length, 0);assert.equal(f.timers.size, 0);
});
test('通常Avatarの未認証起動は従来通りログイン状態で、内部APIを自動実行しない', async () => {
  const f = harness({ alone: false, role: 'login' });
  try { await f.mount();assert.equal(f.data.認証済み.value, false);assert.equal(f.calls.length, 0);assert.equal(f.sockets.length, 0); }
  finally { f.stop(); }
});
function walk(node, result = []) {
  if (Array.isArray(node)) { node.forEach(child => walk(child, result));return result; }
  if (node && typeof node === 'object') { result.push(node);for (const child of Array.isArray(node.children) ? node.children : []) walk(child, result); }
  return result;
}
test('実Vue renderで単独版はマイク・スピーカー・設定だけ、通常版は0〜6等を保持', () => {
  class Audio { constructor() { return new Proxy(this, { get: () => () => {} }); } }
  const component = load('components/AIコア.vue', { window: { desktopApi: {} }, setTimeout, clearTimeout },
    { '@/components/AIコア_音声処理': { AudioController: Audio }, '@/api/websocket': { AIWebSocket: class {} } }, { onMounted() {}, onBeforeUnmount() {} });
  const props = vue.reactive({ standalone: true, inputConnected: false, sessionId: '', initialMicEnabled: false, initialSpeakerEnabled: true, panelVisibility: {}, liveModel: '', coreBusy: false, coreError: '' });
  const scope = vue.effectScope();
  const data = scope.run(() => component.setup(props, { expose() {}, emit() {} }));
  const renderTitles = () => {
    const root = component.render({}, [], props, vue.proxyRefs(data), {}, {});
    return walk(root.children.default()).filter(n => n.type === 'button').map(n => n.props?.title);
  };
  try {
    assert.deepEqual(renderTitles().filter(Boolean), ['マイク', 'スピーカー', 'モデル設定']);
    props.standalone = false;
    const titles = renderTitles();for (const title of ['チャット', 'ファイル', 'イメージ', 'コード1', 'コード6']) assert.ok(titles.includes(title), title);
    props.standalone = true;assert.deepEqual(renderTitles().filter(Boolean), ['マイク', 'スピーカー', 'モデル設定']);
  } finally { scope.stop(); }
});
test('単独設定はプロジェクトを固定し、リセット後だけ新しい会話で起動パスを再確定する', async () => {
  const calls = [], emitted = [];
  const api = { post: async (url, body) => {
    calls.push({ url, body });
    return { data: { status: 'OK', data: { available_models: {}, モデル設定: { CODE_BASE_PATH: '/old/default' } } } };
  } };
  const props = vue.reactive({ isOpen: false, sessionId: 'fixture-session', fixedProjectPath: '/selected/project' });
  const component = load('dialog/AI設定再起動.vue', {}, {
    '@/api/client': { default: api }, '@/utils/qAlert': { qAlert: async () => {}, qConfirm: async () => true },
  }, { onMounted() {}, withDirectives: node => node });
  const scope = vue.effectScope();
  const data = scope.run(() => component.setup(props, { expose() {}, emit: (...args) => emitted.push(args) }));
  try {
    await data.loadConfig();assert.equal(data.errorMessage.value, '');
    assert.equal(data.selections.codeBasePath, '/selected/project');
    const root = component.render({}, [], { ...props, isOpen: true }, vue.proxyRefs(data), {}, {});
    const field = walk(root).find(n => n.props?.id === 'config-code-base-path-input');
    assert.equal(field.props.readonly, true);
    assert.equal(walk(root).some(n => n.props?.id === 'config-code-base-path'), false);
    const browse = walk(root).find(n => n.type === 'button' && n.props?.class === 'config-panel-browse');
    assert.equal(browse.props.disabled, true);
    const before = calls.length;await data.handleBrowseCodeBasePath();assert.equal(calls.length, before);
    data.selections.codeBasePath = '/unexpected/edited/path';
    assert.equal(data.buildFormSettings().CODE_BASE_PATH, '/selected/project');
    await data.handleResetReboot();
    assert.ok(emitted.some(e => e[0] === 'saved' && e[1] === 60 && e[2] === true));
  } finally { scope.stop(); }
  const f = harness();
  try {
    await f.mount();
    f.data.デスクトップチャンネルメッセージ処理({ data: { type: 'settings-saved', waitSeconds: 60, resetSession: true } });
    assert.equal(f.data.セッションID.value, '');
    await f.data.再起動後再接続();
    assert.equal(f.sockets[2].sessionId, '');assert.equal(f.sockets[2].project, '/fixture/project A');
  } finally { f.stop(); }
});
