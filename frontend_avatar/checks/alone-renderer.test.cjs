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
    send(message) { this.sent.push(message); }
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
test('単独Avatarはログイン保存に触れずCore/inputを指定プロジェクトで接続し全パネルを開く', async () => {
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
    await f.data.パネル切替('code1');await f.data.パネル有効化('code2');
    assert.equal(f.panelCalls, 2);
    assert.ok(f.broadcasts.some(message => message.type === 'snapshot'));
    await f.data.パネル切替('file');await f.data.パネル切替('image');
    assert.equal(f.panelCalls, 4);
    f.data.デスクトップチャンネルメッセージ処理({ data: { type: 'set-chat-mode', mode: 'code2' } });
    assert.equal(f.data.チャットモード.value, 'code2');
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
test('実Vue renderで単独版はマイク・スピーカー・全パネルと設定、通常版は0〜6等を保持', () => {
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
    assert.deepEqual(renderTitles().filter(Boolean), ['マイク', 'スピーカー', 'ファイル', 'チャット', 'コード1', 'イメージ', 'コード2', 'コード3', 'コード4', 'コード5', 'コード6', 'モデル設定']);
    props.standalone = false;
    const titles = renderTitles();for (const title of ['チャット', 'ファイル', 'イメージ', 'コード1', 'コード6']) assert.ok(titles.includes(title), title);
    props.standalone = true;assert.deepEqual(renderTitles().filter(Boolean), ['マイク', 'スピーカー', 'ファイル', 'チャット', 'コード1', 'イメージ', 'コード2', 'コード3', 'コード4', 'コード5', 'コード6', 'モデル設定']);
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

test('単独File窓はコアを再生成せずsnapshotから同じセッションとプロジェクトを受け取る', async () => {
  const f = harness({ role: 'file' });
  try {
    await f.mount();assert.equal(f.sockets.length, 0);
    assert.ok(f.broadcasts.some(message => message.type === 'request-snapshot'));
    f.data.デスクトップチャンネルメッセージ処理({ data: { type: 'snapshot', snapshot: { セッションID: 'selected-session', モデル設定: { CODE_BASE_PATH: '/fixture/project A' }, 入力接続済み: true } } });
    assert.equal(f.data.表示セッションID.value, 'selected-session');
    assert.equal(f.data.表示モデル設定.value.CODE_BASE_PATH, '/fixture/project A');
    f.data.パネル状態更新({ file: true, image: true, chat: true, code1: true });
    assert.equal(f.data.パネル表示状態.value.file, true);assert.equal(f.data.パネル表示状態.value.image, true);
    assert.equal(f.data.パネル表示状態.value.chat, true);assert.equal(f.data.パネル表示状態.value.code1, true);
    f.data.デスクトップチャンネルメッセージ処理({ data: { type: 'reboot-reconnect' } });
    assert.equal(f.data.パネル再接続キー.value, 1);
  } finally { f.stop(); }
});

test('Captureは同じCore/inputへ画像を中継し、別のChat/Codeを起動しない', async () => {
  const panel = harness({ role: 'image' }), core = harness();
  try {
    await core.mount();await panel.mount();
    panel.data.デスクトップチャンネルメッセージ処理({ data: { type: 'snapshot', snapshot: {
      セッションID: 'new-session', モデル設定: { CODE_BASE_PATH: '/fixture/project A' }, 入力接続済み: true,
    } } });
    panel.data.イメージ送信処理({ text: '', mimeType: 'image/png', base64: 'fixture-image' });
    const relay = panel.broadcasts.find(message => message.type === 'send-input-payload');
    assert.equal(relay.message.プロジェクトパス, '/fixture/project A');
    core.data.デスクトップチャンネルメッセージ処理({ data: relay });
    const image = core.sockets[1].sent.find(message => message.メッセージ識別 === 'input_image');
    assert.equal(image.セッションID, 'new-session');assert.equal(image.ファイル名, 'fixture-image');
    assert.equal(image.プロジェクトパス, '/fixture/project A');
    assert.equal(panel.sockets.length, 0);assert.equal(core.sockets.length, 2);
  } finally { panel.stop();core.stop(); }
});

test('単独Chatは0番を選択プロジェクトで接続し、送信・プレビュー・再接続を維持する', async () => {
  const sockets = [], emitted = [], calls = [], dispose = [];
  class ChatSocket {
    constructor(url, sessionId, channel, project) { Object.assign(this, { url, sessionId, channel, project });sockets.push(this); }
    on() {}off() {}onStateChange(fn) { this.state = fn; }
    async connect() { this.state(true);return this.sessionId; }
    disconnect() { this.closed = true;this.state?.(false); }
  }
  const props = vue.reactive({ セッションID: 'selected-session', chatMode: 'live', active: true, 入力接続済み: true });
  const component = load('components/AIチャット.vue', {
    window: { desktopApi: { avatarAlone: true, projectPath: '/fixture/project A' }, addEventListener() {}, removeEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
  }, { '@/api/websocket': { AIWebSocket: ChatSocket }, '@/api/config': { AI_WS_ENDPOINT: 'ws://fixture/core' },
    '@/api/client': { default: { post: async (url, body) => { calls.push({ url, body });return { data: { status: 'OK', data: { base64_data: 'fixture' } } }; } } },
  }, { onMounted() {}, onBeforeUnmount: fn => dispose.push(fn) });
  const scope = vue.effectScope();
  const data = scope.run(() => component.setup(props, { expose() {}, emit: (...args) => emitted.push(args) }));
  try {
    await data.出力ソケット接続();
    assert.equal(sockets[0].channel, '0');assert.equal(sockets[0].project, '/fixture/project A');
    assert.equal(sockets[0].sessionId, 'selected-session');
    data.入力テキスト.value = 'こんにちは';data.メッセージ送信();
    const message = emitted.find(e => e[0] === 'send-input-payload')[1];
    assert.equal(message.チャンネル, '0');assert.equal(message.送信モード, 'Live');
    await data.ファイル内容表示を開く('temp/input/fixture.png');
    assert.equal(calls[0].body.セッションID, 'selected-session');
    props.セッションID = 'reconnected-session';await vue.nextTick();await Promise.resolve();
    assert.equal(sockets[0].closed, true);assert.equal(sockets[1].sessionId, 'reconnected-session');
    assert.equal(sockets[1].project, '/fixture/project A');
  } finally { dispose.forEach(fn => fn());scope.stop(); }
  assert.equal(sockets[1].closed, true);
});

test('単独Chatのモード・接続状態・0番送信をCoreへ中継し再接続後も維持する', async () => {
  const panel = harness({ role: 'chat' }), core = harness();
  try {
    await core.mount();await panel.mount();
    await core.data.パネル切替('chat');assert.equal(core.panelCalls, 1);
    panel.data.デスクトップチャンネルメッセージ処理({ data: { type: 'snapshot', snapshot: {
      セッションID: 'new-session', モデル設定: { CODE_BASE_PATH: '/fixture/project A' }, 入力接続済み: true,
    } } });
    panel.data.チャットモード更新('chat');panel.data.チャット状態中継(true);
    panel.data.ウィンドウから入力ペイロード送信({ チャンネル: '0', 送信モード: 'Chat', メッセージ識別: 'input_text', メッセージ内容: 'fixture' });
    for (const relay of panel.broadcasts) core.data.デスクトップチャンネルメッセージ処理({ data: relay });
    assert.equal(core.data.チャットモード.value, 'chat');assert.equal(core.data.チャット接続済み.value, true);
    const message = core.sockets[1].sent.find(m => m.メッセージ識別 === 'input_text');
    assert.equal(message.セッションID, 'new-session');assert.equal(message.プロジェクトパス, '/fixture/project A');
    assert.equal(panel.sockets.length, 0);
    await core.data.再起動後再接続();assert.equal(core.data.チャットモード.value, 'chat');
  } finally { panel.stop();core.stop(); }
});

for (const channel of ['1', '2', '3', '4', '5', '6']) test(`単独Code${channel}: プロジェクト・セッション付き接続/送信/添付表示/破棄`, async () => {
  const sockets = [], emitted = [], calls = [], dispose = [];
  class Socket {
    constructor(url, sessionId, number, project) { Object.assign(this, { sessionId, number, project });sockets.push(this); }
    on() {}off() {}onStateChange(fn) { this.state = fn;return () => {}; }
    async connect() { this.state(true);return this.sessionId; }
    disconnect() { this.closed = true;this.state?.(false); }
  }
  const props = vue.reactive({ セッションID: 'selected-session', チャンネル: channel, active: true, codeAi: 'fixture', 入力接続済み: true });
  const component = load('components/AIコード.vue', {
    window: { desktopApi: { avatarAlone: true, projectPath: '/fixture/project A' }, addEventListener() {}, removeEventListener() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
  }, { '@/api/websocket': { AIWebSocket: Socket }, '@/api/config': { AI_WS_ENDPOINT: 'ws://fixture/core' },
    '@/api/client': { default: { post: async (url, body) => { calls.push({ url, body });return { data: { status: 'OK', data: { base64_data: 'fixture' } } }; } } },
  }, { onMounted() {}, onBeforeUnmount: fn => dispose.push(fn) });
  const scope = vue.effectScope();
  const data = scope.run(() => component.setup(props, { expose() {}, emit: (...args) => emitted.push(args) }));
  try {
    await data.出力ソケット接続();
    assert.equal(sockets[0].number, channel);assert.equal(sockets[0].project, '/fixture/project A');
    assert.equal(sockets[0].sessionId, 'selected-session');
    data.入力テキスト.value = 'fixture';data.メッセージ送信();
    assert.equal(emitted.find(e => e[0] === 'submit')[2], channel);
    await data.ファイル内容表示を開く('hello.txt');assert.equal(calls[0].body.セッションID, 'selected-session');
    props.セッションID = 'reconnected-session';await vue.nextTick();await Promise.resolve();
    assert.equal(sockets[0].closed, true);assert.equal(sockets[1].sessionId, 'reconnected-session');
    assert.equal(sockets[1].project, '/fixture/project A');
  } finally { dispose.forEach(fn => fn());scope.stop(); }
  assert.equal(sockets[1].closed, true);
});

test('全Code窓は送信と取消を同じCoreへ中継し、新規セッションを勝手に作らない', async () => {
  const core = harness();await core.mount();
  try {
    for (const channel of ['1', '2', '3', '4', '5', '6']) {
      const panel = harness({ role: 'code' + channel });
      try {
        await panel.mount();await core.data.パネル切替('code' + channel);
        panel.data.デスクトップチャンネルメッセージ処理({ data: { type: 'snapshot', snapshot: {
          セッションID: 'new-session', モデル設定: { CODE_BASE_PATH: '/fixture/project A' }, 入力接続済み: true,
        } } });
        panel.data.コード送信処理('fixture', channel, 2);panel.data.コードキャンセル処理(channel);
        for (const relay of panel.broadcasts) core.data.デスクトップチャンネルメッセージ処理({ data: relay });
        const message = core.sockets[1].sent.find(m => m.チャンネル === channel && m.メッセージ識別 === 'input_text');
        assert.equal(message.セッションID, 'new-session');assert.equal(message.プロジェクトパス, '/fixture/project A');
        assert.equal(message.self_check_loop, 2);
        assert.ok(core.sockets[1].sent.some(m => m.チャンネル === channel && m.メッセージ識別 === 'cancel_run'));
        assert.equal(panel.sockets.length, 0);
      } finally { panel.stop(); }
    }
  } finally { core.stop(); }
});
