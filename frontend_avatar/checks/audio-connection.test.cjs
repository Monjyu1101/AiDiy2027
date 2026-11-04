// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実際の Vue watcher と接続関数を使い、init が遅れる場合の音声接続を検証する。
// node --test frontend_avatar/checks/audio-connection.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const vue = require('../node_modules/vue');
const { parse } = require('../node_modules/@vue/compiler-sfc');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const transpile = (text) => ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function script(file) {
  return parse(read(file)).descriptor.scriptSetup.content;
}

function bindConnection(file, client, connected) {
  const source = ts.createSourceFile(file, script(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const binding = source.statements.find((node) => ts.isFunctionDeclaration(node)
    && node.name.text === 'ソケット状態バインド');
  vm.runInNewContext(transpile(binding.getText(source)) + '\nソケット状態バインド(client, connected);', {
    client, connected,
  });
}

function setupAudio(file, props) {
  const sockets = [];
  const dispose = [];
  class Socket {
    constructor(url, sessionId, channel, project) {
      Object.assign(this, { sessionId, channel, project, closed: false });
      sockets.push(this);
    }
    on() {}
    onStateChange(handler) { this.state = handler; handler(false); }
    isConnected() { return !this.closed; }
    connect() {
      this.state(true);
      return new Promise((resolve) => { this.initialize = () => resolve(this.sessionId); });
    }
    disconnect() { this.closed = true; this.state?.(false); }
  }
  // 音声デバイスと UI だけを置き換える。接続処理、世代管理、watch は実装を実行する。
  class Audio {
    constructor() { return new Proxy(this, { get: () => () => undefined }); }
  }
  const source = ts.createSourceFile(file, script(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const body = source.statements.filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(source)).join('\n');
  const setup = vm.runInNewContext(transpile('(function () {\n' + body + '\n})'), {
    ...vue, defineProps: () => props, defineEmits: () => () => {}, defineExpose: () => {},
    onMounted: () => {}, onBeforeUnmount: (handler) => dispose.push(handler),
    AIWebSocket: Socket, AI_WS_ENDPOINT: 'ws://test', createWebSocketUrl: () => 'ws://test',
    AudioController: Audio, setTimeout, clearTimeout, console,
  });
  const scope = vue.effectScope();
  scope.run(setup);
  return { sockets, stop: () => { dispose.forEach((handler) => handler()); scope.stop(); } };
}

for (const [name, parent, audio] of [
  ['Avatar', 'frontend_avatar/src/AiDiy.vue', 'frontend_avatar/src/components/AIコア.vue'],
  ['Web', 'frontend_web/src/components/AiDiy/AiDiy.vue', 'frontend_web/src/components/AiDiy/compornents/AIコア.vue'],
]) {
  test(`${name}: 既存セッションの open と遅延 init で音声接続を重複させない`, async () => {
    const props = vue.reactive({ sessionId: 'existing', inputConnected: false, codeBasePath: '',
      liveModel: '', initialMicEnabled: false, initialSpeakerEnabled: true, audioStateSeed: 0 });
    const connected = vue.ref(false);
    const scope = vue.effectScope();
    scope.run(() => vue.watch(connected, (value) => { props.inputConnected = value; }));
    const events = new Map();
    let state;
    let opened = false;
    const client = { onStateChange: (handler) => { state = handler; handler(false); },
      on: (name, handler) => events.set(name, handler), isConnected: () => opened };
    bindConnection(parent, client, connected);
    const harness = setupAudio(audio, props);
    try {
      opened = true;
      state(true);
      await vue.nextTick();
      assert.equal(harness.sockets.length, 0, 'モデル情報受信前は音声を接続しない');
      events.get('init')?.();
      props.codeBasePath = '/project';
      props.liveModel = 'freeai_live';
      await vue.nextTick();
      assert.equal(harness.sockets.length, 1);
      assert.equal(harness.sockets[0].project, '/project');
      harness.sockets[0].initialize();
      await vue.nextTick();
      // 同一セッションの再接続でも新しい init まで待つ。
      opened = false;
      state(false);
      await vue.nextTick();
      assert.equal(harness.sockets[0].closed, true);
      opened = true;
      state(true);
      await vue.nextTick();
      assert.equal(harness.sockets.length, 1);
      events.get('init')?.();
      await vue.nextTick();
      assert.equal(harness.sockets.length, 2);
      harness.sockets[1].initialize();
    } finally { harness.stop(); scope.stop(); }
  });

  test(`${name}: 接続待ちの音声ソケットをフォルダ変更・切断時に閉じる`, async () => {
    const props = vue.reactive({ sessionId: 'existing', inputConnected: true, codeBasePath: '/first',
      liveModel: 'freeai_live', initialMicEnabled: false, initialSpeakerEnabled: true, audioStateSeed: 0 });
    const harness = setupAudio(audio, props);
    try {
      assert.equal(harness.sockets.length, 1);
      props.codeBasePath = '/second';
      await vue.nextTick();
      assert.equal(harness.sockets[0].closed, true);
      assert.equal(harness.sockets.length, 2);
      harness.sockets[0].initialize();
      await vue.nextTick();
      assert.equal(harness.sockets[1].closed, false, '旧 init が新しい接続を切断しない');
      props.inputConnected = false;
      await vue.nextTick();
      assert.equal(harness.sockets[1].closed, true);
      harness.sockets[1].initialize();
      await vue.nextTick();
    } finally { harness.stop(); }
  });
}

const websocketHarness = require('./browser-auth-harness.cjs').harness;

test('Avatar: WebSocket open 前の切断で初期接続要求を送らない', async () => {
  const { Client, sockets } = websocketHarness();
  const client = new Client('ws://test', 'session', 'audio', '/project');
  const result = client.connect().catch((error) => error.message);
  client.disconnect();
  assert.equal(sockets[0].closed, true);
  sockets[0].open();
  assert.equal(sockets[0].sent.length, 0);
  sockets[0].end();
  assert.match(await result, /cancelled|closed/);
});

test('Avatar: 旧ソケットの遅延 close が再接続したソケットを消さない', async () => {
  const { Client, sockets } = websocketHarness();
  const client = new Client('ws://test', 'session', 'audio');
  const first = client.connect().catch(() => {});
  client.disconnect();
  const second = client.connect();
  sockets[1].open();
  sockets[1].init();
  await second;
  sockets[0].end();
  await first;
  assert.equal(client.isConnected(), true);
  assert.equal(client.セッションID取得(), 'session');
  client.disconnect();
  sockets[1].end();
});
