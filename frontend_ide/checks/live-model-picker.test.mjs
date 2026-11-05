// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const require = createRequire(import.meta.url), vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const { transformSync } = require('esbuild');
const clone = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const initialSettings = { LIVE_AI_NAME: 'freeai_live', LIVE_FREEAI_MODEL: 'free-first', LIVE_FREEAI_VOICE: 'Zephyr' };
test('Live拡張: 未選択はモデル取得・接続を行わず入力上に案内、フォルダ案内のみ有効', async t => {
  const f = await fixture(t, { host: true, folder: null });
  assert.equal(f.calls.api.length, 0);
  assert.equal(f.data.blocked.value, true);
  assert.equal(f.button('接続').props.disabled, true);
  assert.ok(!f.button('接続').props.class.includes('awaiting'));
  assert.equal(walk(f.render(), n => n?.type === 'textarea').props.disabled, true);
  const notice = walk(f.render(), n => n?.props?.class === 'workspace-required');
  assert.ok(contents(notice).includes('先にプロジェクトフォルダを開いてください'));
  walk(notice, n => n?.type === 'button').props.onClick();
  assert.equal(f.calls.openFolder, 1);
  await f.data.connect(); await f.data.openModels();
  assert.equal(f.calls.connects.length, 0); assert.equal(f.calls.api.length, 0);
});
const catalog = {
  live_models: {
    freeai_live: { 'free-first': 'Free 最初', 'free-second': 'Free 次のモデル' },
    gemini_live: { 'gemini-first': 'Gemini 最初', 'gemini-second': 'Gemini 次のモデル' },
    openai_live: { 'openai-first': 'OpenAI 最初', 'openai-second': 'OpenAI 次のモデル' },
  },
  live_voices: {
    freeai_live: { Zephyr: 'Zephyr 音声', Puck: 'Puck 音声' },
    gemini_live: { Kore: 'Kore 音声', Aoede: 'Aoede 音声' },
    openai_live: { alloy: 'alloy 音声', shimmer: 'shimmer 音声' },
  },
};

const { descriptor } = parse(readFileSync(new URL('../src/components/ライブ/ライブパネル.vue', import.meta.url), 'utf8'));
const script = compileScript(descriptor, { id: 'LiveModelPicker', genDefaultAs: 'component' });
const template = compileTemplate({ source: descriptor.template.content, filename: 'LivePanel.vue', id: 'LiveModelPicker', compilerOptions: { bindingMetadata: script.bindings } });
assert.deepEqual(template.errors, []);
const componentCode = transformSync(`${script.content}\n${template.code}\ncomponent.render=render;module.exports=component;`, { format: 'cjs' }).code;
const catalogModule = { exports: {} };
vm.runInNewContext(transformSync(readFileSync(new URL('../host/aidiy_live/src/model-catalog.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: catalogModule });

function walk(node, predicate) {
  if (predicate(node)) return node;
  const children = Array.isArray(node?.children) ? node.children : node?.children?.default?.() || [];
  for (const child of children) { const found = walk(child, predicate); if (found) return found; }
}
function all(node, predicate) {
  const found = [];
  walk(node, child => { if (predicate(child)) found.push(child); return false; });
  return found;
}
function contents(node) {
  if (typeof node === 'string') return node;
  if (typeof node?.children === 'string') return node.children;
  return (Array.isArray(node?.children) ? node.children : []).map(contents).join('');
}

// 実SFCと実カタログ検証を通す。通信・保存・音声デバイス・描画だけを隔離する。
async function fixture(t, { host = false, settings = initialSettings, folder = { 名前: 'fixture', パス: '/fixture' } } = {}) {
  const noop = () => {}, mounted = [], unmounted = [], module = { exports: {} };
  const calls = { api: [], saves: [], connects: [], packets: [], disconnects: 0, audioStarts: 0, audioCloses: 0 };
  const controls = { catalog: clone(catalog), apiError: '', saveError: '', saveGate: null, connectGate: null };
  const intervals = new Map(), frames = new Map(); let timerId = 0, frameId = 0;
  let saved = clone(settings), sessionSettings = clone(settings);
  class Environment {
    host = host; socketUrl = ''; captureUrl = '';
    async context() { return { 作業フォルダ: folder, 保存モデル設定: clone(saved) }; }
    openFolder() { calls.openFolder = (calls.openFolder || 0) + 1; }
    async api(path, body) {
      calls.api.push({ path, body: clone(body) });
      if (controls.apiError) throw Error(controls.apiError);
      return { status: 'OK', data: { モデル設定: clone(body.セッションID ? sessionSettings : initialSettings), available_models: clone(controls.catalog) } };
    }
    async saveModel(selected) {
      calls.saves.push(clone(selected));
      if (controls.saveGate) await controls.saveGate;
      if (controls.saveError) throw Error(controls.saveError);
      saved = clone(selected);
    }
    onStop() {} onMicrophoneStop() {} onFolder() {} ready() {} dispose() {}
  }
  class Connection {
    session = '';
    async connect(options) {
      calls.connects.push(clone(options));
      if (controls.connectGate) await controls.connectGate;
      sessionSettings = { ...initialSettings, ...clone(options.modelSettings) };
      this.session = `session-${calls.connects.length}`;
    }
    disconnect() { calls.disconnects++; this.session = ''; }
    send(...packet) { calls.packets.push(clone(packet)); return true; }
  }
  const modules = {
    '../../../host/src/file-attachments': { fileAttachment: () => undefined },
    '../添付ファイル/ファイル送信.js': { readDroppedFiles: async () => 0 },
    '../添付ファイル/チャット添付.vue': {},
    '../ライブ/ライブ通信': { LiveEnvironment: Environment },
    '../../../host/aidiy_live/src/protocol': { LiveConnection: Connection, 入力レート: () => 16000, 音声入力: value => value, 音声操作: (mic, speaker) => ({ mic, speaker }) },
    '../../../host/aidiy_live/src/audio': { LiveAudio: class {
      async unlock() {} async start() { calls.audioStarts++; return true; }
      mute() {} stop() {} close() { calls.audioCloses++; }
    } },
    '../../../host/aidiy_live/src/visualizer': { AudioCloud: class { setVisible() {} level() {} spectrum() {} dispose() {} } },
    '../../../host/aidiy_live/src/model-catalog': catalogModule.exports,
    '../../../host/aidiy_live/src/microphone-error': { microphoneError: error => error.message },
    '../下書き連携/下書き受け渡し.js': { createDraftReceiver: () => ({ mount: noop, publish: noop, dispose: noop }) },
    '../コード/会話到着演出': { chatArrival: () => ({ reset: noop, dispose: noop, show: noop }) },
    '../共通表示/状態バー.vue': {}, '../コンソール/開始表示.vue': {}, '../../dialog/共通ダイアログ.vue': {},
  };
  vm.runInNewContext(componentCode, {
    module, URL, console, crypto: { randomUUID }, location: { href: 'http://localhost/live/' }, window: {},
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    setInterval: (callback, ms) => { intervals.set(++timerId, { callback, ms }); return timerId; },
    clearInterval: id => intervals.delete(id),
    require(id) {
      if (id === 'vue') return { ...vue, onMounted: callback => mounted.push(callback), onBeforeUnmount: callback => unmounted.push(callback),
        withDirectives: (node, directives) => { node.testDirectives = directives; return node; } };
      if (Object.hasOwn(modules, id)) return modules[id];
      throw Error(`予期しない依存: ${id}`);
    },
  });
  const props = vue.reactive({ config: {}, visible: true }), scope = vue.effectScope(), component = module.exports;
  const data = scope.run(() => component.setup(props, { expose: noop }));
  data.canvas.value = {};
  data.conversation.value = { scrollTop: 0, scrollHeight: 500 };
  const render = () => component.render({}, [], props, vue.proxyRefs(data), {}, {});
  const dialog = () => walk(render(), node => node?.props?.label === '音声モデル選択');
  const selectNodes = () => all(dialog(), node => node?.type === 'select');
  const button = label => walk(render(), node => node?.type === 'button' && contents(node) === label);
  const apply = () => walk(dialog(), node => node?.type === 'button' && node.props?.class === 'apply-model primary');
  let disposed = false;
  t.after(() => { if (!disposed) { disposed = true; for (const callback of unmounted) callback(); scope.stop(); } });
  for (const callback of mounted) await callback();
  await flush();
  return { data, calls, controls, dialog, selectNodes, button, apply, intervals, render,
    async open() {
      const trigger = walk(render(), node => node?.type === 'button' && node.props?.onClick === data.openModels);
      assert.ok(trigger); assert.equal(Boolean(trigger.props.disabled), false);
      await trigger.props.onClick(); await flush(); assert.ok(dialog());
    },
    async choose(index, value) {
      const node = selectNodes()[index];
      assert.ok(node); assert.equal(Boolean(node.props.disabled), false);
      const binding = node.testDirectives.find(([directive]) => directive === vue.vModelSelect);
      assert.ok(binding, '実テンプレートのnative selectにv-modelが付いている');
      const options = all(node, child => child?.type === 'option').map(child => ({ _value: child.props.value, selected: false, disabled: child.props.disabled === '' || Boolean(child.props.disabled) }));
      const element = new EventTarget(); Object.assign(element, { options, multiple: false });
      Object.defineProperty(element, 'selectedIndex', { get: () => options.findIndex(option => option.selected),
        set: index => options.forEach((option, i) => { option.selected = i === index; }) });
      // ブラウザと同じ順序でVueのchange代入、テンプレートの@changeを実行する。
      vue.vModelSelect.created(element, { value: binding[1], modifiers: {} }, node);
      vue.vModelSelect.mounted(element, { value: binding[1] });
      element.addEventListener('change', event => node.props.onChange?.(event));
      element.selectedIndex = options.findIndex(option => option._value === value && !option.disabled);
      assert.notEqual(element.selectedIndex, -1, `${value}が選択可能な候補に存在する`);
      element.dispatchEvent(new Event('change')); await flush();
    },
  };
}

for (const host of [false, true]) {
  const mode = host ? 'VS Code拡張' : '単独/IDE';
  test(`Live: provider/model/voiceの実select変更を保存し、再表示する (${mode})`, async t => {
    const f = await fixture(t, { host });
    await f.open();
    assert.equal(f.selectNodes().length, 3);
    assert.equal(f.apply().props.disabled, true, '未変更なら保存不可');
    for (const [provider, vendor] of [['freeai_live', 'FREEAI'], ['gemini_live', 'GEMINI'], ['openai_live', 'OPENAI']]) {
      await f.choose(0, provider);
      assert.equal(f.data.provider.value, provider);
      const models = Object.entries(catalog.live_models[provider]), voices = Object.entries(catalog.live_voices[provider]);
      assert.equal(f.data.model.value, models[0][0]); assert.equal(f.data.voice.value, voices[0][0]);
      for (const [value, label] of models) { assert.ok(contents(f.selectNodes()[1]).includes(label)); await f.choose(1, value); assert.equal(f.data.model.value, value); }
      for (const [value, label] of voices) { assert.ok(contents(f.selectNodes()[2]).includes(label)); await f.choose(2, value); assert.equal(f.data.voice.value, value); }
      const selected = { LIVE_AI_NAME: provider, [`LIVE_${vendor}_MODEL`]: models.at(-1)[0], [`LIVE_${vendor}_VOICE`]: voices.at(-1)[0] };
      assert.equal(f.data.selectionError.value, ''); assert.equal(f.apply().props.disabled, false);
      await f.apply().props.onClick(); await flush();
      assert.deepEqual(f.calls.saves.at(-1), selected); assert.equal(f.data.picker.value, false);
      assert.equal(f.calls.connects.length, 0, '未接続時の選択だけでは接続しない');
      await f.open();
      assert.deepEqual(clone(f.data.selectedModel.value), selected);
      assert.equal(f.apply().props.disabled, true);
    }
    assert.equal(f.calls.saves.length, 3);
  });

  test(`Live: キャンセル・閉じる・ダイアログcloseは変更を保存しない (${mode})`, async t => {
    const f = await fixture(t, { host });
    for (const close of [() => f.button('キャンセル').props.onClick(),
      () => walk(f.dialog(), node => node?.props?.['aria-label'] === '閉じる').props.onClick(),
      () => f.dialog().props.onClose()]) {
      await f.open(); await f.choose(0, 'openai_live'); await f.choose(1, 'openai-second'); await f.choose(2, 'shimmer');
      close(); await flush();
      assert.equal(f.data.picker.value, false); assert.deepEqual(f.calls.saves, []);
      assert.deepEqual(clone(f.data.preferred.value), initialSettings);
      await f.open(); assert.deepEqual(clone(f.data.selectedModel.value), initialSettings);
      f.dialog().props.onClose(); await flush();
    }
    assert.equal(f.calls.connects.length, 0);
  });

  test(`Live: 接続中の選択は同じ設定で再接続し、マイクOFF・会話と下書き保持 (${mode})`, async t => {
    const f = await fixture(t, { host });
    await f.data.connect(); await f.data.microphone();
    assert.equal(f.data.connected.value, true); assert.equal(f.data.mic.value, true);
    const messages = [{ id: 'one', role: 'user', type: 'input_text', text: '保持する会話' }];
    f.data.messages.value = clone(messages); f.data.prompt.value = '保持する下書き';
    await f.data.sound(); assert.equal(f.data.speaker.value, false);
    await f.open(); await f.choose(0, 'openai_live'); await f.choose(1, 'openai-second'); await f.choose(2, 'shimmer');
    let reconnect;
    f.controls.connectGate = new Promise(resolve => { reconnect = resolve; });
    const pending = f.apply().props.onClick(); await flush();
    const selected = { LIVE_AI_NAME: 'openai_live', LIVE_OPENAI_MODEL: 'openai-second', LIVE_OPENAI_VOICE: 'shimmer' };
    assert.deepEqual(f.calls.saves, [selected]); assert.equal(f.calls.connects.length, 2);
    assert.deepEqual(f.calls.connects.at(-1), { codeBasePath: '/fixture', modelSettings: selected });
    assert.equal(f.calls.disconnects, 1); assert.equal(f.data.mic.value, false); assert.equal(f.data.changing.value, true);
    assert.equal(f.apply().props.disabled, true); assert.equal(f.dialog().props.locked, true);
    assert.ok(f.selectNodes().every(node => node.props.disabled));
    assert.deepEqual(clone(f.data.messages.value), messages);
    reconnect(); await pending; await flush();
    assert.equal(f.data.connected.value, true); assert.equal(f.data.picker.value, false);
    assert.equal(f.data.mic.value, false); assert.equal(f.calls.audioStarts, 1, '再接続時にマイクを自動開始しない');
    assert.equal(f.data.speaker.value, false); assert.equal(f.data.prompt.value, '保持する下書き');
    assert.deepEqual(clone(f.data.messages.value.slice(0, messages.length)), messages);
    assert.match(f.data.messages.value.at(-1).text, /選択したモデルで接続しました/);
    for (const [key, value] of Object.entries(selected)) assert.equal(f.data.settings.value[key], value);
    assert.deepEqual(f.calls.packets.at(-1), ['input', { mic: false, speaker: false }]);
    assert.equal(f.intervals.size, host ? 0 : 1, '再接続後のpingを重複させない');
  });
}

for (const [label, mutate, expected] of [
  ['AI候補なし', f => { f.controls.catalog.live_models = {}; }, /ライブAI/],
  ['保存済みモデルが候補外', f => { delete f.controls.catalog.live_models.freeai_live['free-first']; }, /ライブモデル/],
  ['保存済み音声が候補外', f => { delete f.controls.catalog.live_voices.freeai_live.Zephyr; }, /音声/],
]) {
  test(`Live: ${label}なら実カタログ検証で適用を止める`, async t => {
    const f = await fixture(t); mutate(f); await f.open();
    assert.match(f.data.selectionError.value, expected); assert.equal(f.apply().props.disabled, true);
    await f.data.applyModel(); assert.deepEqual(f.calls.saves, []); assert.deepEqual(f.calls.connects, []);
    assert.equal(f.data.picker.value, true);
  });
}

test('Live: カタログ取得失敗は表示し、候補未選択のまま保存しない', async t => {
  const f = await fixture(t); f.controls.apiError = 'カタログを取得できません'; await f.open();
  assert.equal(f.data.error.value, 'カタログを取得できません'); assert.equal(f.data.modelLoading.value, false);
  assert.equal(f.apply().props.disabled, true); await f.data.applyModel(); assert.deepEqual(f.calls.saves, []);
});

for (const host of [false, true]) for (const connected of [false, true]) {
  test(`Live: キャンセル後の取得失敗は設定と接続を保持し、再取得後だけ新しい選択を保存 (${host ? '拡張' : '単独/IDE'}, ${connected ? '接続中' : '未接続'})`, async t => {
    const f = await fixture(t, { host });
    if (connected) { await f.data.connect(); await f.data.microphone(); }
    const before = { settings: clone(f.data.settings.value), preferred: clone(f.data.preferred.value), connects: f.calls.connects.length };
    await f.open(); await f.choose(1, 'free-second');
    f.button('キャンセル').props.onClick(); await flush();
    f.controls.apiError = 'カタログを取得できません'; await f.open();
    assert.equal(f.data.error.value, 'カタログを取得できません');
    assert.equal(f.apply().props.disabled, true, '再取得できなかった古い選択は適用不可');
    for (const node of f.selectNodes()) {
      assert.equal(all(node, child => child?.type === 'option' && child.props?.disabled == null).length, 0, '取得失敗時に古い候補を選び直せない');
    }
    await f.data.applyModel(); assert.deepEqual(f.calls.saves, [], '再取得できなかった古い選択を保存しない');
    assert.deepEqual(clone(f.data.settings.value), before.settings); assert.deepEqual(clone(f.data.preferred.value), before.preferred);
    assert.equal(f.calls.connects.length, before.connects); assert.equal(f.calls.disconnects, 0);
    assert.equal(f.data.connected.value, connected); assert.equal(f.data.mic.value, connected);

    f.button('キャンセル').props.onClick(); await flush(); f.controls.apiError = '';
    await f.open(); assert.equal(f.data.error.value, '');
    assert.deepEqual(clone(f.data.selectedModel.value), initialSettings, '復旧時はキャンセルした値でなく確定済み設定から開始する');
    await f.choose(0, 'gemini_live'); await f.choose(1, 'gemini-second'); await f.choose(2, 'Aoede');
    await f.apply().props.onClick(); await flush();
    const selected = { LIVE_AI_NAME: 'gemini_live', LIVE_GEMINI_MODEL: 'gemini-second', LIVE_GEMINI_VOICE: 'Aoede' };
    assert.deepEqual(f.calls.saves, [selected]); assert.deepEqual(clone(f.data.preferred.value), selected);
    assert.equal(f.data.picker.value, false); assert.equal(f.data.connected.value, connected);
    assert.equal(f.calls.connects.length, before.connects + Number(connected));
  });
}

test('Live: 保存中は二重適用を止め、保存失敗なら元の接続・設定を維持する', async t => {
  const f = await fixture(t); await f.data.connect(); await f.open(); await f.choose(1, 'free-second');
  const before = clone(f.data.settings.value); let save;
  f.controls.saveGate = new Promise(resolve => { save = resolve; }); f.controls.saveError = '設定を保存できません';
  const pending = f.apply().props.onClick(); await flush();
  assert.equal(f.data.modelSaving.value, true); assert.equal(f.apply().props.disabled, true);
  assert.ok(f.selectNodes().every(node => node.props.disabled)); assert.equal(f.dialog().props.locked, true);
  await f.data.applyModel(); assert.equal(f.calls.saves.length, 1);
  save(); await pending; await flush();
  assert.equal(f.data.error.value, '設定を保存できません'); assert.equal(f.data.connected.value, true);
  assert.equal(f.data.picker.value, true); assert.equal(f.data.modelSaving.value, false);
  assert.equal(f.calls.connects.length, 1); assert.equal(f.calls.disconnects, 0);
  assert.deepEqual(clone(f.data.settings.value), before); assert.deepEqual(clone(f.data.preferred.value), initialSettings);
});
