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
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const { transformSync, buildSync } = require('esbuild');
const helper = { exports: {} };
vm.runInNewContext(buildSync({ entryPoints: [fileURLToPath(new URL('../src/components/添付ファイル/ファイル送信.js', import.meta.url))], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text, { module: helper, btoa, atob, Uint8Array });
const source = readFileSync(new URL('../src/components/コード/コードパネル.vue', import.meta.url), 'utf8');
const file = (name = '画像.png', body = 'image') => ({ name, size: Buffer.byteLength(body), arrayBuffer: async () => Uint8Array.from(Buffer.from(body)).buffer });
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function fixture(host = false) {
  const calls = [], unmounted = [], no = () => {};
  let receive, cancel = () => {}, send = async message => calls.push(structuredClone(message));
  const { descriptor } = parse(source), script = compileScript(descriptor, { id: 'code', genDefaultAs: 'component' });
  const template = compileTemplate({ source: descriptor.template.content, filename: 'code.vue', id: 'code', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const module = { exports: {} }, modules = {
    '../コード/コード通信.js': { codeTransport: (_props, callback) => { receive = callback; return { send: message => send(message), cancelFiles: () => cancel(), saveDraft: no, dispose: no }; } },
    '../添付ファイル/ファイル送信.js': helper.exports,
    '../コード/会話到着演出': { chatArrival: () => ({ reset: no, dispose: no, show: no }) },
    '../下書き連携/下書き受け渡し.js': { createDraftReceiver: () => ({ publish: no, dispose: no }) },
    '../../../host/src/stream-control': { visibleStreamContent: text => text },
  };
  vm.runInNewContext(transformSync(`${script.content}\n${template.code}\ncomponent.render=render;module.exports=component;`, { format: 'cjs' }).code, {
    module, URL, console, location: { href: 'http://localhost/code/' }, crypto, setTimeout, clearTimeout,
    require: id => id === 'vue' ? { ...vue, onMounted: no, onBeforeUnmount: callback => unmounted.push(callback) }
      : id === 'markdown-it' ? require('markdown-it') : modules[id] || {},
  });
  const scope = vue.effectScope(), props = { host }, data = scope.run(() => module.exports.setup(props, { expose: no }));
  let snapshot = { type: 'state', 会話ID: 'conversation', メッセージ: [], 履歴: [], 進捗: [], 作業フォルダ: { パス: '/project' }, 接続プロジェクトパス: '/project', セッションID: 'session', 接続世代: 1, 信頼済み: true, 接続済み: true, 実行モード: 'online' };
  receive(snapshot);
  return { data, calls, state(change) { snapshot = { ...snapshot, ...change }; receive(snapshot); }, setSend(fn) { send = fn; }, setCancel(fn) { cancel = fn; },
    dispose() { for (const callback of unmounted) callback(); scope.stop(); } };
}
for (const host of [false, true]) {
  test(`Code添付: ${host ? '拡張' : '単独/IDE'}でD&Dと選択を共用、scope固定・本文不変・echoだけを表示`, async () => {
    const f = fixture(host); try {
      f.data.prompt.value = '画像を確認してください';
      let prevented = 0;
      f.data.dropFiles({ dataTransfer: { files: [file()] }, preventDefault() { prevented++; }, stopPropagation() {} }); await flush();
      assert.equal(prevented, 1); assert.equal(f.calls.length, 1);
      assert.deepEqual(f.calls[0], { type: 'sendFile', name: '画像.png', base64: Buffer.from('image').toString('base64'), conversationId: 'conversation', sessionId: 'session', projectPath: '/project', connectionEpoch: 1 });
      assert.equal(f.data.prompt.value, '画像を確認してください'); assert.equal(f.data.state.メッセージ.length, 0);
      assert.match(f.data.fileNotice.value, /1件を送信/);
      await f.data.attachFiles([file('文書.txt', 'text')]); assert.equal(f.calls.length, 2);
      f.state({ メッセージ: [{ 種別: 'user', 本文: '画像.png', 添付: { kind: 'input_file', name: '画像.png' } }] });
      assert.equal(f.data.state.メッセージ[0].添付.name, '画像.png');
      assert.equal(f.calls.filter(message => message.type === 'input_text').length, 0);
    } finally { f.dispose(); }
  });
}
test('Code添付: 読込中の新規会話・session変更・切断・破棄後は送信しない', async () => {
  for (const change of [{ 会話ID: 'next' }, { セッションID: 'next' }, { 接続世代: 2 }, { 接続済み: false }, 'dispose']) {
    const f = fixture(); let finish;
    const loading = f.data.attachFiles([{ ...file(), arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }]);
    assert.equal(f.data.uploading.value, true);
    if (change === 'dispose') f.dispose(); else f.state(change);
    finish(Uint8Array.from(Buffer.from('image')).buffer); await loading;
    assert.equal(f.calls.length, 0);
    if (change !== 'dispose') { assert.equal(f.data.uploading.value, false); f.dispose(); }
  }
});
test('Code添付: offline・実行中・不正/過大ファイルを拒否、通信失敗は残りを送らない', async () => {
  const f = fixture(); try {
    f.state({ 実行モード: 'offline' }); await f.data.attachFiles([file()]); assert.equal(f.calls.length, 0);
    f.state({ 実行モード: 'online', 実行中: true }); await f.data.attachFiles([file()]); assert.equal(f.calls.length, 0);
    f.state({ 実行中: false }); await f.data.attachFiles([{ ...file(), size: 4 * 1024 * 1024 + 1 }]); assert.equal(f.calls.length, 0);
    await f.data.attachFiles([file('../bad.txt')]); assert.equal(f.calls.length, 0);
    f.setSend(async () => { throw Error('送信できません'); });
    await f.data.attachFiles([file(), file('next.txt')]); assert.match(f.data.error.value, /送信できません/); assert.equal(f.data.uploading.value, false);
  } finally { f.dispose(); }
});
test('Code添付transport: 拡張応答を相関し、拒否・タイムアウト・破棄を処理して自動再送しない', async () => {
  const sent = [], timers = new Map(); let listener, timerId = 0;
  const module = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/コード/コード通信.js', import.meta.url), 'utf8'), { format: 'cjs' }).code, {
    module, crypto, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    window: { addEventListener: (_type, fn) => { listener = fn; }, removeEventListener() {} },
  });
  const transport = module.exports.codeTransport({ host: true, api: { postMessage: packet => sent.push(packet) } }, () => {});
  await transport.start();
  const first = transport.send({ type: 'sendFile', name: 'a.txt' });
  listener({ data: { type: 'fileUploadResult', requestId: 'unknown', ok: true } }); assert.equal(timers.size, 1);
  listener({ data: { type: 'fileUploadResult', requestId: sent.at(-1).requestId, ok: false, message: '拒否' } }); await assert.rejects(first, /拒否/);
  const second = transport.send({ type: 'sendFile' }); listener({ data: { type: 'fileUploadResult', requestId: sent.at(-1).requestId, ok: true } }); await second;
  const third = transport.send({ type: 'sendFile' }); [...timers.values()][0](); await assert.rejects(third, /送信確認/);
  const fourth = transport.send({ type: 'sendFile' }); transport.dispose(); await assert.rejects(fourth, /画面を閉じた/);
  assert.equal(sent.filter(packet => packet.type === 'sendFile').length, 4);
});

test('Code添付transport: 単独HTTPの30秒期限・画面破棄は残りを止め、受理状況不明として案内する', async () => {
  const timers = new Map(), requests = []; let timerId = 0;
  const module = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/コード/コード通信.js', import.meta.url), 'utf8'), { format: 'cjs' }).code, {
    module, URL, AbortController, location: { href: 'http://localhost/code/' }, window: { removeEventListener() {} },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    fetch: (_url, options) => new Promise((_resolve, reject) => { requests.push(options); options.signal.addEventListener('abort', () => reject(Error('aborted'))); }),
  });
  const transport = module.exports.codeTransport({ base: '/code/' }, () => {});
  const first = transport.send({ type: 'sendFile' }); [...timers.values()][0](); await assert.rejects(first, /送信確認/);
  const second = transport.send({ type: 'sendFile' }); transport.cancelFiles(); await assert.rejects(second, /送信確認/);
  const third = transport.send({ type: 'sendFile' }); transport.dispose(); await assert.rejects(third, /送信確認/);
  assert.equal(requests.length, 3); assert.ok(requests.every(request => request.signal.aborted));
});
test('Code/Live共通VSCode CSP: 検証済み画像のdataだけを許可し外部画像・script/frameを広げない', () => {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL('../host/src/vscode-html.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports });
  const html = module.exports.developmentHtml(path => path, 'vscode-resource:', 'nonce', { kind: 'code' });
  assert.match(html, /img-src vscode-resource: data:;/);
  assert.match(html, /script-src 'nonce-nonce' vscode-resource:;/);
  assert.match(html, /connect-src vscode-resource:;/); assert.match(html, /frame-src 'none';/);
  assert.doesNotMatch(html, /img-src[^;]*(?:https?:|\*)/);
});

test('Code添付: epochだけ変化した同session再接続でも待機中の送信確認を中断し、自動再送しない', async () => {
  const f = fixture(); let reject, cancellations = 0, sent = 0;
  try {
    f.setSend(() => { sent++; return new Promise((_resolve, fail) => { reject = fail; }); });
    f.setCancel(() => { cancellations++; reject?.(Error('送信確認を中断')); });
    const uploading = f.data.attachFiles([file(), file('next.txt')]); await flush();
    assert.equal(sent, 1); assert.equal(f.data.uploading.value, true);
    f.state({ 接続世代: 2 }); await uploading;
    assert.equal(cancellations, 1); assert.equal(sent, 1); assert.equal(f.data.uploading.value, false);
    assert.equal(f.data.fileNotice.value, '', '旧送信を受信完了とは表示しない');
    f.setSend(async packet => { f.calls.push(packet); });
    await f.data.attachFiles([file('fresh.txt')]);
    assert.equal(f.calls.at(-1).connectionEpoch, 2);
  } finally { f.dispose(); }
});
