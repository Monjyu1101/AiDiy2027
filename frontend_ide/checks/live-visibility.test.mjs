// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as draftHandoff from '../src/components/下書き連携/下書き受け渡し.js';

const require = createRequire(import.meta.url), vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc'), { transformSync } = require('esbuild');
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };

// 本物のAudioCloudを使い、Canvasの呼出しとブラウザのフレーム予約だけを計測する。
function graphics({ hidden = false, width = 640, height = 360 } = {}) {
  const frames = new Map(), observers = new Set(), listeners = new Set();
  const calls = { clear: 0, strokes: 0, lines: 0, bounds: 0 };
  let frameId = 0, clock = 0;
  const document = new EventTarget(); document.hidden = hidden;
  const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
  document.addEventListener = (type, callback) => { if (type === 'visibilitychange') listeners.add(callback); add(type, callback); };
  document.removeEventListener = (type, callback) => { if (type === 'visibilitychange') listeners.delete(callback); remove(type, callback); };
  const context = new Proxy({
    clearRect() { calls.clear++; }, stroke() { calls.strokes++; }, lineTo() { calls.lines++; },
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { getContext: () => context, getBoundingClientRect() { calls.bounds++; return { width, height }; } };
  const globals = {
    document, window: { devicePixelRatio: 1 },
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); observers.add(this); }
      observe(target) { this.targets.add(target); }
      disconnect() { this.targets.clear(); observers.delete(this); }
    },
  };
  const module = { exports: {} };
  const source = readFileSync(new URL('../host/aidiy_live/src/visualizer.ts', import.meta.url), 'utf8');
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { ...globals, module, exports: module.exports });
  return {
    ...globals, globals, canvas, frames, calls, observers, listeners, AudioCloud: module.exports.AudioCloud,
    advance(count = 1) {
      for (let n = 0; n < count; n++) {
        clock += 1000 / 60;
        const pending = [...frames.values()]; frames.clear();
        for (const callback of pending) callback(clock);
      }
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth; height = nextHeight;
      for (const observer of observers) if (observer.targets.has(canvas)) observer.callback();
    },
    hide(value) { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
  };
}

// 実際のLivePanelのsetup/watch/破棄を通し、通信と音声デバイスのみを置き換える。
async function livePanel(t, { visible = true, host = true, ...options } = {}) {
  const graphic = graphics(options), mounted = [], unmounted = [], module = { exports: {} };
  const intervals = new Map(); let intervalId = 0;
  const timers = { setInterval: (callback, ms) => { intervals.set(++intervalId, { callback, ms }); return intervalId; }, clearInterval: id => intervals.delete(id) };
  const resources = { connections: 0, connects: 0, disconnects: 0, audioCloses: 0, environmentCloses: 0 };
  const packets = [], settings = { LIVE_AI_NAME: 'freeai_live', LIVE_FREEAI_MODEL: 'test', LIVE_FREEAI_VOICE: 'Zephyr' };
  class Environment {
    host = host; socketUrl = ''; captureUrl = '';
    async context() { return { 作業フォルダ: { 名前: 'fixture', パス: '/fixture' }, 保存モデル設定: settings }; }
    async api() { return { status: 'OK', data: { モデル設定: settings, available_models: { live_models: { freeai_live: { test: 'test' } }, live_voices: { freeai_live: { Zephyr: 'Zephyr' } } } } }; }
    onStop() {} onMicrophoneStop() {} onFolder() {} ready() {}
    dispose() { resources.environmentCloses++; }
  }
  class Connection {
    session = '';
    constructor() { resources.connections++; }
    async connect() { resources.connects++; this.session = 'same-session'; }
    disconnect() { resources.disconnects++; this.session = ''; }
    send(...args) { packets.push(args); return true; }
  }
  const modules = {
    '../../../host/src/file-attachments': { fileAttachment: () => undefined },
    '../添付ファイル/ファイル送信.js': { readDroppedFiles: async () => 0 },
    '../添付ファイル/チャット添付.vue': {},
    '../ライブ/ライブ通信': { LiveEnvironment: Environment },
    '../../../host/aidiy_live/src/protocol': { LiveConnection: Connection, 入力レート: () => 16000, 音声入力: value => value, 音声操作: (mic, speaker) => ({ mic, speaker }) },
    '../../../host/aidiy_live/src/audio': { LiveAudio: class { async unlock() {} mute() {} stop() {} close() { resources.audioCloses++; } } },
    '../../../host/aidiy_live/src/visualizer': { AudioCloud: graphic.AudioCloud },
    '../../../host/aidiy_live/src/model-catalog': { ライブ選択エラー: () => '' },
    '../../../host/aidiy_live/src/microphone-error': { microphoneError: error => error.message },
    '../下書き連携/下書き受け渡し.js': draftHandoff,
    '../コード/会話到着演出': { chatArrival: () => ({ reset() {}, dispose() {}, show() {} }) },
    '../共通表示/状態バー.vue': {}, '../ターミナル/開始表示.vue': {}, '../../dialog/共通ダイアログ.vue': {},
  };
  const { descriptor } = parse(readFileSync(new URL('../src/components/ライブ/ライブパネル.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id: 'LivePanel', genDefaultAs: 'component' });
  vm.runInNewContext(transformSync(script.content + '\nmodule.exports=component;', { format: 'cjs' }).code, {
    ...graphic.globals, module, URL, location: { href: 'http://localhost/' },
    ...timers,
    require(id) {
      if (id === 'vue') return { ...vue, onMounted: callback => mounted.push(callback), onBeforeUnmount: callback => unmounted.push(callback) };
      if (Object.hasOwn(modules, id)) return modules[id];
      throw Error(`予期しない依存: ${id}`);
    },
  });
  const props = vue.reactive({ config: {}, visible }), scope = vue.effectScope();
  const state = scope.run(() => module.exports.setup(props, { expose() {} }));
  state.canvas.value = vue.markRaw(graphic.canvas);
  state.conversation.value = { scrollTop: 0, scrollHeight: 500 };
  let disposed = false;
  const fixture = { ...graphic, state, props, resources, packets, intervals, timers, statusProps() {
    const template = compileTemplate({ source: descriptor.template.content, filename: 'LivePanel.vue', id: 'LivePanel', compilerOptions: { bindingMetadata: script.bindings } });
    assert.deepEqual(template.errors, []);
    const output = { exports: {} };
    vm.runInNewContext(transformSync(template.code, { format: 'cjs' }).code, { module: output, exports: output.exports, require: () => ({ ...vue, withDirectives: vnode => vnode }) });
    const vnode = output.exports.render({}, [], props, vue.proxyRefs(state), {}, {});
    const status = { ...vnode.children[0].props };
    status.clockPulse = status['clock-pulse'] === '' || status['clock-pulse'];
    delete status['clock-pulse'];
    return status;
  }, dispose() {
    if (disposed) return; disposed = true;
    for (const callback of unmounted) callback(); scope.stop();
  } };
  t.after(() => fixture.dispose());
  for (const callback of mounted) await callback();
  await flush();
  return fixture;
}

test('Live: 実テンプレートの可視状態で接続バーの50ms更新だけを止め、20秒の接続pingを保つ', async t => {
  const fixture = await livePanel(t, { host: false });
  await fixture.state.connect();
  const { descriptor } = parse(readFileSync(new URL('../src/components/共通表示/状態バー.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id: 'StatusBar', genDefaultAs: 'component' });
  const module = { exports: {} }, mounted = [], unmounted = [], props = vue.reactive(fixture.statusProps());
  vm.runInNewContext(transformSync(script.content + '\nmodule.exports=component;', { format: 'cjs' }).code, {
    module, document: fixture.document, window: new EventTarget(), ...fixture.timers,
    require: () => ({ ...vue, onMounted: callback => mounted.push(callback), onBeforeUnmount: callback => unmounted.push(callback) }),
  });
  const scope = vue.effectScope(); scope.run(() => module.exports.setup(props, { expose() {} }));
  try {
    for (const callback of mounted) callback();
    const delays = () => [...fixture.intervals.values()].map(value => value.ms).sort((a, b) => a - b);
    assert.deepEqual(delays(), [50, 20000]);
    for (let n = 0; n < 3; n++) {
      fixture.props.visible = false; Object.assign(props, fixture.statusProps()); await vue.nextTick();
      assert.deepEqual(delays(), [20000]); assert.equal(fixture.state.connected.value, true);
      [...fixture.intervals.values()][0].callback(); assert.equal(fixture.packets.at(-1)[1].type, 'ping');
      fixture.props.visible = true; Object.assign(props, fixture.statusProps()); await vue.nextTick();
      assert.deepEqual(delays(), [50, 20000]);
    }
  } finally { for (const callback of unmounted) callback(); scope.stop(); fixture.dispose(); }
  assert.equal(fixture.intervals.size, 0);
});

test('Live: パネル非表示は実AudioCloudの描画を止め、接続・会話・下書きを保って1本だけ再開する', async t => {
  const fixture = await livePanel(t), { state, props, calls, resources } = fixture;
  await state.connect();
  state.messages.value = [{ id: 'one', role: 'user', type: 'input_text', text: '保持する会話' }];
  state.prompt.value = '保持する下書き'; state.mic.value = true;
  await flush(); fixture.advance();
  const baseline = { ...calls };
  fixture.advance(60);
  assert.equal(calls.strokes - baseline.strokes, 1080);
  assert.equal(calls.lines - baseline.lines, 259200);
  assert.equal(fixture.frames.size, 1);
  const history = JSON.stringify(state.messages.value), visibleCalls = { ...calls };
  props.visible = false;
  // ResizeObserverがまだ配送されず寸法が残っていても、propsだけで即時に停止する。
  fixture.advance(60);
  t.diagnostic(`非表示60フレーム相当: stroke ${calls.strokes - visibleCalls.strokes}回、lineTo ${calls.lines - visibleCalls.lines}回`);
  assert.deepEqual(calls, visibleCalls);
  assert.equal(fixture.frames.size, 0);
  assert.equal(state.connected.value, true); assert.equal(state.mic.value, false);
  assert.equal(state.prompt.value, '保持する下書き'); assert.equal(JSON.stringify(state.messages.value), history);
  assert.deepEqual(resources, { connections: 1, connects: 1, disconnects: 0, audioCloses: 0, environmentCloses: 0 });
  for (let n = 0; n < 4; n++) {
    fixture.hide(true); fixture.hide(false); assert.equal(fixture.frames.size, 0, 'ページの復帰だけで隠れたパネルを描かない');
    props.visible = true; fixture.hide(false); fixture.hide(false);
    assert.equal(fixture.frames.size, 1); fixture.advance(); assert.equal(fixture.frames.size, 1);
    props.visible = false; assert.equal(fixture.frames.size, 0);
  }
  assert.equal(state.connected.value, true); assert.equal(resources.connects, 1); assert.equal(resources.disconnects, 0);
  props.visible = true; const pending = [...fixture.frames.values()];
  fixture.dispose(); assert.equal(fixture.frames.size, 0); assert.equal(fixture.listeners.size, 0); assert.equal(fixture.observers.size, 0);
  const disposedCalls = { ...calls };
  for (const callback of pending) callback(5000);
  fixture.hide(false); fixture.resize(800, 400); props.visible = false; props.visible = true;
  assert.equal(fixture.frames.size, 0); assert.deepEqual(calls, disposedCalls);
  assert.equal(resources.disconnects, 1); assert.equal(resources.audioCloses, 1); assert.equal(resources.environmentCloses, 1);
});

test('AudioCloud: ゼロ寸法では描画/再予約を止め、寸法復帰だけで1本再開する', () => {
  const fixture = graphics(), cloud = new fixture.AudioCloud(fixture.canvas);
  try {
    fixture.advance(60); assert.equal(fixture.calls.strokes, 1080); assert.equal(fixture.calls.lines, 259200);
    fixture.resize(0, 0); const hiddenCalls = { ...fixture.calls };
    fixture.advance(60); assert.deepEqual(fixture.calls, hiddenCalls); assert.equal(fixture.frames.size, 0);
    fixture.hide(true); fixture.hide(false); assert.equal(fixture.frames.size, 0);
    fixture.resize(640, 0); assert.equal(fixture.frames.size, 0);
    fixture.resize(0, 360); assert.equal(fixture.frames.size, 0);
    fixture.resize(640, 360); fixture.resize(640, 360); fixture.hide(false);
    assert.equal(fixture.frames.size, 1); fixture.advance(60);
    assert.equal(fixture.calls.strokes, 2160); assert.equal(fixture.calls.lines, 518400);
    assert.equal(fixture.frames.size, 1);
  } finally { cloud.dispose(); }
  assert.equal(fixture.frames.size, 0); assert.equal(fixture.observers.size, 0); assert.equal(fixture.listeners.size, 0);
});

for (const options of [{ visible: false }, { hidden: true }, { width: 0, height: 0 }]) {
  test(`Live: 初期非表示${JSON.stringify(options)}では描画を予約せず、復帰・破棄を繰り返せる`, async t => {
    for (let n = 0; n < 3; n++) {
      const fixture = await livePanel(t, options);
      assert.equal(fixture.frames.size, 0); fixture.advance(60); assert.equal(fixture.calls.strokes, 0);
      fixture.props.visible = true; fixture.resize(640, 360); fixture.hide(false); fixture.hide(false);
      assert.equal(fixture.frames.size, 1); fixture.advance(); assert.equal(fixture.calls.strokes, 18);
      fixture.dispose(); fixture.hide(false); fixture.resize(640, 360);
      assert.equal(fixture.frames.size, 0); assert.equal(fixture.listeners.size, 0); assert.equal(fixture.observers.size, 0);
    }
  });
}
