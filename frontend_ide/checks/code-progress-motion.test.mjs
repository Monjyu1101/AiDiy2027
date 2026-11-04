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
const flush = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
const streamModule = { exports: {} };
vm.runInNewContext(transformSync(readFileSync(new URL('../host/src/stream-control.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: streamModule });
function fixture(provider = 'aidiy_hermes', host = false) {
  const source = readFileSync(new URL('../src/components/コード/コードパネル.vue', import.meta.url), 'utf8');
  const { descriptor, errors } = parse(source); assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'code', genDefaultAs: 'component' });
  const template = compileTemplate({ source: descriptor.template.content, filename: 'CodePanel.vue', id: 'code', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const module = { exports: {} }, unmounted = [], calls = [], streamPackets = [];
  let receive;
  const noop = () => {};
  vm.runInNewContext(transformSync(script.content + '\n' + template.code + '\ncomponent.render=render;module.exports=component;', { format: 'cjs' }).code, {
    module, URL, location: { href: 'http://localhost/' }, console,
    require: id => id === 'vue' ? { ...vue, withDirectives: node => node, onMounted: noop, onBeforeUnmount: fn => unmounted.push(fn) }
      : id === 'markdown-it' ? class { renderer = { rules: {} }; utils = { escapeHtml: text => text }; render(text) { return text; } }
      : id === '../コード/コード通信.js' ? { codeTransport: (_props, fn) => { receive = fn; return { send: async packet => calls.push(packet), saveDraft: noop, dispose: noop }; } }
      : id === '../../../host/src/stream-control' ? streamModule.exports
      : id === '../コード/会話到着演出' ? { chatArrival: () => ({ reserve: noop, reset: noop, show: noop, cancelReservation: noop, dispose: noop }) }
      : id === '../下書き連携/下書き受け渡し.js' ? { createDraftReceiver: () => ({ publish: noop, dispose: noop }) } : {},
  });
  const scope = vue.effectScope(), component = module.exports, props = { host };
  const data = scope.run(() => component.setup(props, { expose() {} }));
  data.stream.value = { sync: noop, reset: noop, packet: text => streamPackets.push(text) };
  let snapshot = { type: 'state', 会話ID: 'one', 作業フォルダ: { パス: '/project' }, 信頼済み: true, 接続済み: true, 実行中: false, 進捗: [], メッセージ: [], 履歴: [], provider };
  const walk = (node, predicate) => { if (predicate(node)) return node; for (const child of Array.isArray(node?.children) ? node.children : []) { const found = walk(child, predicate); if (found) return found; } };
  const rendered = () => component.render({}, [], props, vue.proxyRefs(data), {}, {});
  return { data, calls, streamPackets, receive,
    async state(change = {}) { snapshot = { ...snapshot, ...change }; receive(structuredClone(snapshot)); await flush(); },
    motion: () => walk(rendered(), node => node?.type === 'form').props.class.includes('running'),
    input: () => walk(rendered(), node => node?.type === 'textarea'),
    stop: () => walk(rendered(), node => node?.props?.['aria-label'] === '実行を停止'),
    dispose() { for (const fn of unmounted) fn(); scope.stop(); },
  };
}

test('Code: 本文が初めて届いたら入力枠のモーションだけを止め、入力・停止・ストリーム更新を保つ', async () => {
  const f = fixture(); try {
    await f.state(); assert.equal(f.motion(), false);
    await f.state({ 実行中: true }); assert.equal(f.motion(), true);
    f.data.prompt.value = '次の依頼の下書き';
    f.receive({ メッセージ識別: 'output_stream', メッセージ内容: '変更を確認中' });
    await f.state({ 進捗: ['変更を確認中'] });
    assert.equal(f.motion(), false); assert.equal(f.data.busy.value, true);
    assert.equal(f.stop().props.disabled, false); assert.equal(typeof f.input().props['onUpdate:modelValue'] === 'function', true);
    assert.equal(f.data.prompt.value, '次の依頼の下書き'); assert.deepEqual(f.calls, []);
    f.receive({ メッセージ識別: 'output_stream', メッセージ内容: '次の行' });
    await f.state({ 進捗: ['変更を確認中', '次の行'] });
    assert.equal(f.motion(), false); assert.deepEqual(f.streamPackets, ['変更を確認中', '次の行']);
  } finally { f.dispose(); }
});

test('Code: ストリームなし・開始終了制御・空白・heartbeatだけなら従来のモーションを維持', async () => {
  const f = fixture(); try {
    await f.state({ 実行中: true });
    for (const text of ['\x02', '', '\r\n', ' \t ', '\x03']) {
      f.receive({ メッセージ識別: 'output_stream', メッセージ内容: text });
      await f.state({ 進捗: ['\x02', ' \t ', '\x03\r\n'] }); assert.equal(f.motion(), true);
    }
    f.receive({ type: 'pong' }); assert.equal(f.motion(), true);
    await f.state({ 実行中: false, メッセージ: [{ 種別: 'assistant', 本文: '非ストリーム回答' }] });
    assert.equal(f.motion(), false);
  } finally { f.dispose(); }
});

test('Code: 完了・停止・エラー後の遅延生パケットは新しい待機判定を変えない', async () => {
  const f = fixture(); try {
    for (const kind of ['assistant', 'error']) {
      await f.state({ 実行中: true, 進捗: ['処理中'] }); assert.equal(f.motion(), false);
      await f.state({ 実行中: false, 停止中: false, メッセージ: [{ 種別: kind, 本文: '終了' }] });
      f.receive({ メッセージ識別: 'output_stream', メッセージ内容: '遅延した前回分' }); assert.equal(f.motion(), false);
      await f.state({ 実行中: true, 進捗: [] }); assert.equal(f.motion(), true);
      f.receive({ メッセージ識別: 'output_stream', メッセージ内容: '遅延した前回分' }); assert.equal(f.motion(), true);
      await f.state({ 停止中: true }); assert.equal(f.motion(), true);
      await f.state({ 実行中: false }); assert.equal(f.motion(), false);
    }
    await f.state({ 会話ID: 'two', 実行中: true, 進捗: [] }); assert.equal(f.motion(), true);
    await f.state({ 進捗: ['新しい会話の進捗'] }); assert.equal(f.motion(), false);
  } finally { f.dispose(); }
});

test('Code: モデル選択・接続通知では新しい実行とせず、state復元と全Provider・Web/拡張で同じ切替', async () => {
  for (const host of [false, true]) for (const provider of ['aidiy_hermes', 'claude_sdk', 'claude_cli', 'copilot_cli', 'codex_cli', 'antigravity_cli', 'grok_cli', 'opencode_cli']) {
    const f = fixture(provider, host); try {
      await f.state({ 実行中: true, 進捗: ['再接続時に復元した本文'] }); assert.equal(f.motion(), false);
      await f.state({ モデル変更中: true }); assert.equal(f.motion(), false);
      await f.state({ 実行中: false }); assert.equal(f.motion(), false);
      await f.state({ 実行中: true, 進捗: [] }); assert.equal(f.motion(), true);
      f.receive({ type: 'transportError', message: '切断' });
      await f.state({ 実行中: true, 進捗: [] }); assert.equal(f.motion(), true);
      await f.state({ 進捗: ['復帰後の本文'] }); assert.equal(f.motion(), false);
    } finally { f.dispose(); }
  }
});

// 同じstateで進捗が切り詰められても、切替は依頼が終わるまで保持する。
test('Code: 本文後100件の空白でも切替を維持し、同じ描画周期の次の依頼でリセットする', async () => {
  const f = fixture(); try {
    await f.state({ 実行中: true, 進捗: ['本文'] }); assert.equal(f.motion(), false);
    await f.state({ 進捗: Array(100).fill(' \t ') }); assert.equal(f.motion(), false);
    // ホストが新規依頼の進捗を空にする通知だけでも、実行中が連続した境界を認識する。
    await f.state({ 実行中: true, 進捗: [] }); assert.equal(f.motion(), true);
    await f.state({ 進捗: ['次の本文'] }); assert.equal(f.motion(), false);
    const base = { type: 'state', 会話ID: 'one', メッセージ: [], 履歴: [], 進捗: ['次の本文'] };
    // Vueのwatchにまとめられないよう、次の描画を待たず連続受信させる。
    f.receive({ ...base, 実行中: false });
    f.receive({ ...base, 実行中: true, 進捗: [] });
    assert.equal(f.motion(), true);
    f.receive({ メッセージ識別: 'output_stream', メッセージ内容: '前回の遅延本文' });
    assert.equal(f.motion(), true);
    await flush(); assert.equal(f.motion(), true);
  } finally { f.dispose(); }
});
