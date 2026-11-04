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
const require = createRequire(import.meta.url), vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const { transformSync } = require('esbuild');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const hermesModels = ['copilot_cli/same', 'openai_oauth/gpt-6.1-sol', 'openai_oauth/gpt-6.1-sol-900k',
  'openai_oauth/gpt-6-astra', 'openai_oauth/gpt-6-luna', 'openai_oauth/gpt-6-luna-900k',
  'openai_oauth/gpt-5.6-sol', 'openai_oauth/gpt-6.1-terra', 'openai_oauth/gpt-6.1-terra-900k',
  'openai_oauth/gpt-5.6-luna'].map(id => ({ id, label: `????/??/?? - ${id.split('/')[1]}` }));

function fixture({ host = false, offline = false } = {}) {
  const calls = [], unmounted = [], noop = () => {};
  let receive, events, listener;
  const items = provider => provider ? [{ id: 'same', label: 'same (変更なし)' }, ...hermesModels]
    : (offline ? ['aidiy_hermes'] : ['codex_cli', 'aidiy_hermes']).map(id => ({ id, label: id }));
  const globals = { URL, console, location: { href: 'http://localhost/code/' },
    window: { addEventListener: (_type, fn) => { listener = fn; }, removeEventListener: noop,
      acquireVsCodeApi: () => ({ getState: noop, setState: noop, postMessage(packet) {
        calls.push(packet);
        if (packet.type === 'chooseModel') queueMicrotask(() => listener({ data: { type: 'modelCatalog', provider: packet.provider, items: items(packet.provider) } }));
      } }) },
    EventSource: class { constructor() { events = this; } close() {} },
    fetch: async (url, options) => {
      if (options?.body) { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true }) }; }
      const provider = new URL(url).searchParams.get('provider') || '';
      calls.push({ type: 'chooseModel', provider });
      return { ok: true, json: async () => provider ? { models: items(provider) } : { providers: items(provider) } };
    },
  };
  const transport = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/コード/コード通信.js', import.meta.url), 'utf8'), { format: 'cjs' }).code, { ...globals, module: transport });
  const { descriptor } = parse(readFileSync(new URL('../src/components/コード/コードパネル.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id: 'CodePanel', genDefaultAs: 'component' });
  const template = compileTemplate({ source: descriptor.template.content, filename: 'CodePanel.vue', id: 'CodePanel', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const module = { exports: {} };
  vm.runInNewContext(transformSync(`${script.content}\n${template.code}\ncomponent.render=render;module.exports=component;`, { format: 'cjs' }).code, {
    ...globals, module,
    require: id => id === 'vue' ? { ...vue, withDirectives: node => node, onMounted: noop, onBeforeUnmount: fn => unmounted.push(fn) }
      : id === 'markdown-it' ? require('markdown-it')
      : id === '../コード/コード通信.js' ? { codeTransport: (props, fn) => { receive = fn; return transport.exports.codeTransport(props, fn); } }
      : id === '../../../host/src/stream-control' ? { visibleStreamContent: text => text }
      : id === '../コード/会話到着演出' ? { chatArrival: () => ({ reset: noop, dispose: noop, show: noop }) }
      : id === '../下書き連携/下書き受け渡し.js' ? { createDraftReceiver: () => ({ publish: noop, dispose: noop }) } : {},
  });
  const scope = vue.effectScope(), component = module.exports, props = { host, base: '/code/' };
  const data = scope.run(() => component.setup(props, { expose: noop }));
  const state = { type: 'state', 会話ID: 'one', 作業フォルダ: { パス: '/project' }, 信頼済み: true,
    接続済み: !offline, 実行モード: offline ? 'offline' : 'online', 進捗: [], メッセージ: [], 履歴: [],
    provider: offline ? 'aidiy_hermes' : 'codex_cli', model: 'same' };
  const walk = (node, predicate) => {
    if (predicate(node)) return node;
    const children = Array.isArray(node?.children) ? node.children : node?.children?.default?.() || [];
    for (const child of children) { const found = walk(child, predicate); if (found) return found; }
  };
  const select = async (node, value, current) => {
    const element = new EventTarget(), options = [];
    walk(node, child => { if (child?.type === 'option') options.push({ _value: child.props.value, selected: false }); return false; });
    Object.assign(element, { options, multiple: false });
    Object.defineProperty(element, 'selectedIndex', { get: () => options.findIndex(option => option.selected),
      set: index => options.forEach((option, i) => { option.selected = i === index; }) });
    // 実v-modelのchangeハンドラーを先に登録し、テンプレートの@changeまで通す。
    vue.vModelSelect.created(element, { value: current, modifiers: {} }, node);
    vue.vModelSelect.mounted(element, { value: current });
    element.addEventListener('change', event => node.props.onChange?.(event));
    element.selectedIndex = options.findIndex(option => option._value === value);
    assert.notEqual(element.selectedIndex, -1);
    element.dispatchEvent(new Event('change')); await flush();
  };
  const providerSelect = () => walk(component.render({}, [], props, vue.proxyRefs(data), {}, {}), node => node?.type === 'select' && node.props?.onChange === data.changeProvider);
  const modelSelect = () => walk(component.render({}, [], props, vue.proxyRefs(data), {}, {}), node => node?.type === 'select' && node.props?.['onUpdate:modelValue'] && node.props['onUpdate:modelValue'].toString().includes('model'));
  return { data, calls, walk, render: () => component.render({}, [], props, vue.proxyRefs(data), {}, {}),
    async start() { await data.transport.start(); receive(state); await flush(); },
    providerSelect, modelSelect,
    chooseProvider: value => select(providerSelect(), value, data.provider.value),
    chooseModel: value => select(modelSelect(), value, data.model.value),
    dispose() { for (const fn of unmounted) fn(); scope.stop(); },
  };
}

test('Code拡張: フォルダなしは入力直上の案内と操作抑止、選択後に解除', async () => {
  const f = fixture({ host: true });
  try {
    await f.start(); f.data.state.作業フォルダ = null; await flush();
    assert.equal(f.data.operable.value, false);
    assert.equal(f.walk(f.render(), n => n?.type === 'textarea').props.disabled, true);
    const notice = f.walk(f.render(), n => n?.props?.class === 'workspace-required');
    assert.ok(notice);
    f.walk(notice, n => n?.type === 'button').props.onClick();
    assert.equal(f.calls.at(-1).type, 'openFolder');
    const before = f.calls.length; await f.data.openModels();
    assert.equal(f.calls.length, before);
    f.data.state.作業フォルダ = { パス: '/new-project' }; await flush();
    assert.equal(f.data.operable.value, true);
    assert.equal(f.walk(f.render(), n => n?.props?.class === 'workspace-required'), undefined);
    assert.equal(f.walk(f.render(), n => n?.type === 'textarea').props.disabled, false);
  } finally { f.dispose(); }
});

for (const host of [false, true]) for (const offline of [false, true]) {
  test(`Code: Hermesのprovider付きモデルを表示・選択できる (${host ? '拡張' : '単独/IDE'}, ${offline ? '未接続' : '接続済み'})`, async () => {
    const f = fixture({ host, offline });
    try {
      await f.start(); await f.data.openModels(); await flush();
      assert.ok(f.data.providers.value.some(item => item.id === 'aidiy_hermes'));
      assert.equal(Boolean(f.providerSelect().props.disabled), offline, '接続済みならコードAIを変更でき、未接続ならHermes固定');
      if (!offline) await f.chooseProvider('aidiy_hermes');
      assert.equal(f.data.provider.value, 'aidiy_hermes');
      assert.equal(f.data.catalogBusy.value, false); assert.equal(f.data.catalogReady.value, true);
      assert.equal(f.modelSelect().props.disabled, false);
      assert.deepEqual(JSON.parse(JSON.stringify(f.data.models.value)), [{ id: 'same', label: 'same (変更なし)' }, ...hermesModels]);
      for (const item of hermesModels) {
        await f.chooseModel(item.id);
        assert.equal(f.data.canApplyModel.value, true);
        await f.data.applyModel();
        assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))), { type: host ? 'setModel' : 'model', provider: 'aidiy_hermes', model: item.id });
        await f.data.openModels(); await flush();
        if (!offline) await f.chooseProvider('aidiy_hermes');
      }
    } finally { f.dispose(); }
  });
}
