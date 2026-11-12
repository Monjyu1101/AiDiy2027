// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const require = createRequire(import.meta.url), vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const { buildSync, transformSync } = require('esbuild');
function load(path) {
  const module = { exports: {} };
  const code = buildSync({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
  vm.runInNewContext(code, { module, atob, btoa, Uint8Array, setTimeout, clearTimeout });
  return module.exports;
}
const files = load('../src/components/添付ファイル/ファイル送信.js');
const attachments = load('../host/src/file-attachments.ts');
const protocol = load('../host/aidiy_live/src/protocol.ts');
const { descriptor } = parse(readFileSync(new URL('../src/components/ライブ/ライブパネル.vue', import.meta.url), 'utf8'));
const script = compileScript(descriptor, { id: 'LiveFiles', genDefaultAs: 'component' });
const template = compileTemplate({ source: descriptor.template.content, filename: 'LivePanel.vue', id: 'LiveFiles', compilerOptions: { bindingMetadata: script.bindings } });
assert.deepEqual(template.errors, []);
const code = transformSync(`${script.content}\n${template.code}\ncomponent.render=render;module.exports=component;`, { format: 'cjs' }).code;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1kAAAAASUVORK5CYII=';
const file = (name = '画像.png', body = 'image') => ({ name, size: Buffer.byteLength(body), arrayBuffer: async () => Uint8Array.from(Buffer.from(body)).buffer });
const drop = list => ({ dataTransfer: { files: list, types: ['Files'] }, prevented: false, preventDefault() { this.prevented = true; } });
const clone = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function walk(node, predicate) {
  if (predicate(node)) return node;
  for (const child of Array.isArray(node?.children) ? node.children : []) { const found = walk(child, predicate); if (found) return found; }
}
async function fixture(t, host = false) {
  const sockets = [], sent = [], mounted = [], unmounted = [], noop = () => {};
  let sessionCount = 0, session = '', disposed = false;
  const settings = { LIVE_AI_NAME: 'freeai_live', LIVE_FREEAI_MODEL: 'test', LIVE_FREEAI_VOICE: 'Zephyr' };
  class Socket {
    readyState = 1; bufferedAmount = 0; channel = '';
    constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
    send(raw) {
      if (this.fail) throw Error('模擬送信失敗');
      const packet = JSON.parse(raw); sent.push({ socket: this, packet });
      if (packet.type === 'connect') {
        this.channel = packet.ソケット番号;
        if (this.channel === 'input') session = `session-${++sessionCount}`;
        queueMicrotask(() => this.emit({ メッセージ識別: 'init', セッションID: session }));
      }
    }
    emit(packet) { this.onmessage?.({ data: JSON.stringify(packet) }); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(); }
  }
  class Environment {
    host = host; socketUrl = ''; captureUrl = ''; socket = () => new Socket();
    async context() { return { 作業フォルダ: { 名前: 'fixture', パス: '/project' }, 保存モデル設定: settings }; }
    async api() { return { status: 'OK', data: { モデル設定: settings, available_models: { live_models: { freeai_live: { test: 'test' } }, live_voices: { freeai_live: { Zephyr: 'Zephyr' } } } } }; }
    onStop() {} onMicrophoneStop() {} onFolder() {} ready() {} dispose() {}
  }
  const Attachment = { name: 'ChatAttachment' };
  const modules = {
    '../ライブ/ライブ通信': { LiveEnvironment: Environment }, '../../../host/aidiy_live/src/protocol': protocol,
    '../../../host/aidiy_live/src/audio': { LiveAudio: class { async unlock() {} mute() {} close() {} stop() {} } },
    '../../../host/aidiy_live/src/visualizer': { AudioCloud: class { dispose() {} } },
    '../../../host/aidiy_live/src/model-catalog': { ライブ選択エラー: () => '' },
    '../../../host/aidiy_live/src/microphone-error': { microphoneError: error => error.message },
    '../../../host/src/file-attachments': attachments, '../添付ファイル/ファイル送信.js': files,
    '../添付ファイル/チャット添付.vue': Attachment,
    '../下書き連携/下書き受け渡し.js': { createDraftReceiver: () => ({ mount: noop, publish: noop, dispose: noop }) },
    '../コード/会話到着演出': { chatArrival: () => ({ reset: noop, dispose: noop, show: noop }) },
    '../コード/パネル表示切替.vue': {}, '../共通表示/状態バー.vue': {}, '../コンソール/開始表示.vue': {}, '../../dialog/共通ダイアログ.vue': {},
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, URL, crypto, console, location: { href: 'http://localhost/live/' }, window: {},
    ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame: noop, setInterval: () => 1, clearInterval: noop,
    require(id) { if (id === 'vue') return { ...vue, withDirectives: node => node, onMounted: cb => mounted.push(cb), onBeforeUnmount: cb => unmounted.push(cb) }; if (Object.hasOwn(modules, id)) return modules[id]; throw Error(id); },
  });
  const props = { config: {}, visible: true }, scope = vue.effectScope(), data = scope.run(() => module.exports.setup(props, { expose: noop }));
  data.canvas.value = {}; data.conversation.value = { scrollHeight: 100, scrollTop: 0 };
  const dispose = () => { if (disposed) return; disposed = true; for (const cb of unmounted) cb(); scope.stop(); };
  t.after(dispose); for (const cb of mounted) await cb();
  await data.connect(); assert.equal(data.connected.value, true);
  const socket = channel => sockets.filter(item => item.channel === channel).at(-1);
  const uploadPackets = () => sent.filter(item => item.packet.メッセージ識別 === 'input_file').map(item => item.packet);
  const echo = (extra = {}, channel = '0') => socket(channel).emit({ セッションID: session, チャンネル: '0', メッセージ識別: 'input_file', ファイル名: 'temp/input/one.png', 元ファイル名: '画像.png', サムネイル画像: png, ...extra });
  return { data, sockets, sent, socket, uploadPackets, echo, dispose, Attachment, session: () => session,
    render: () => module.exports.render({}, [], props, vue.proxyRefs(data), {}, {}) };
}
for (const host of [false, true]) {
  test(`Live添付: ${host ? '拡張' : '単独/IDE'}のD&Dを実protocolで送信し、echoとAI画像だけを1件ずつ表示`, async t => {
    const f = await fixture(t, host); f.data.prompt.value = '画像を確認して';
    const event = drop([file()]); assert.equal(f.render().props.onDrop, f.data.dropFiles);
    await f.render().props.onDrop(event); assert.equal(event.prevented, true);
    assert.deepEqual(clone(f.uploadPackets()), [{ チャンネル: '0', 出力先チャンネル: '0', 送信モード: 'Live', プロジェクトパス: '/project', メッセージ識別: 'input_file', メッセージ内容: Buffer.from('image').toString('base64'), ファイル名: '画像.png', サムネイル画像: null, セッションID: f.session() }]);
    assert.equal(f.data.messages.value.length, 0); assert.equal(f.data.prompt.value, '画像を確認して'); assert.match(f.data.fileStatus.value, /Coreの受信表示/);
    f.echo(); f.echo(); assert.equal(f.data.messages.value.length, 1); assert.match(f.data.fileStatus.value, /受信済み/);
    const first = f.data.messages.value[0]; assert.equal(first.role, 'user'); assert.equal(first.attachment.thumbnail, `data:image/png;base64,${png}`);
    f.data.copyInput(first); assert.equal(f.data.prompt.value, '画像を確認して');
    f.echo({ メッセージ識別: 'output_file', チャンネル: undefined, ファイル名: 'temp/output/generated.png', 元ファイル名: '生成画像.png' });
    assert.equal(f.data.messages.value[1].role, 'assistant'); assert.equal(f.data.messages.value[1].attachment.name, '生成画像.png');
    const node = walk(f.render(), node => node?.type === f.Attachment); assert.ok(node); assert.equal(node.props.attachment.key, first.attachment.key);
    f.echo({ ファイル名: 'temp/input/doc.pdf', 元ファイル名: '文書.pdf', サムネイル画像: null });
    assert.equal(f.data.messages.value[2].attachment.thumbnail, ''); assert.equal(f.data.messages.value[2].attachment.name, '文書.pdf');
    await f.data.dropFiles(drop([file('画像.png', 'repeat')])); assert.equal(f.uploadPackets().length, 2);
    f.echo({ ファイル名: 'temp/input/two.png' }); assert.equal(f.data.messages.value.length, 4, '同名でもCoreの別保存先なら別表示');
  });
}
test('Live添付: 他session/channel/project、音声socket、古いsocketの受信を除外', async t => {
  const f = await fixture(t);
  for (const patch of [{ セッションID: 'other' }, { チャンネル: '1' }, { プロジェクトパス: '/other' }]) f.echo(patch);
  f.echo({}, 'audio'); f.echo({}, 'input'); assert.equal(f.data.messages.value.length, 0);
  const old = f.socket('0'), oldSession = f.session(); f.data.disconnect(); await f.data.connect();
  old.emit({ セッションID: oldSession, チャンネル: '0', メッセージ識別: 'input_file', ファイル名: 'temp/input/stale.png' });
  assert.equal(f.data.messages.value.length, 0); f.echo(); assert.equal(f.data.messages.value.length, 1);
});
test('Live添付: 読込中の切断・再接続・project変更・破棄は古いファイルを送らない', async t => {
  for (const action of ['disconnect', 'reconnect', 'project', 'dispose']) {
    const f = await fixture(t); let finish;
    const pending = f.data.dropFiles(drop([{ ...file(), arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }]));
    assert.equal(f.data.uploadingFiles.value, true);
    if (action === 'dispose') f.dispose();
    else if (action === 'project') f.data.project.value = { パス: '/other' };
    else { f.data.disconnect(); if (action === 'reconnect') await f.data.connect(); }
    finish(Uint8Array.from(Buffer.from('image')).buffer); await pending;
    assert.equal(f.uploadPackets().length, 0); assert.equal(f.data.uploadingFiles.value, false);
  }
});
test('Live添付: 実readerの上限・不正名・読込失敗・送信失敗を表示し、残りを止める', async t => {
  const f = await fixture(t);
  for (const list of [[{ ...file(), size: 4 * 1024 * 1024 + 1 }], Array.from({ length: 11 }, () => file()), [file('../bad')], [{ ...file(), arrayBuffer: async () => { throw Error('読込失敗'); } }]]) {
    await f.data.dropFiles(drop(list)); assert.ok(f.data.error.value); assert.equal(f.uploadPackets().length, 0); assert.equal(f.data.uploadingFiles.value, false);
  }
  f.socket('input').fail = true; await f.data.dropFiles(drop([file(), file('second.txt')])); assert.match(f.data.error.value, /送信できません/); assert.equal(f.uploadPackets().length, 0);
  f.socket('input').fail = false; await f.data.dropFiles(drop([file('large.txt', 'x'.repeat(200000))])); assert.equal(f.uploadPackets().length, 1, '128kを超える有効ファイルは送れる');
  f.echo({ メッセージ識別: 'error', メッセージ内容: '保存先に書き込めません', エラーコード: 'FILE_UPLOAD_FAILED' });
  assert.match(f.data.error.value, /保存先/); assert.equal(f.data.fileStatus.value, ''); assert.equal(f.data.messages.value.length, 0);
  f.echo({ ファイル名: null }); assert.match(f.data.error.value, /保存できません/);
});
test('Live添付: 連打・未接続・バックプレッシャーで無断再送せず、本文D&Dは横取りしない', async t => {
  const f = await fixture(t); let finish;
  const pending = f.data.dropFiles(drop([{ ...file(), arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }]));
  await f.data.dropFiles(drop([file()])); assert.equal(f.uploadPackets().length, 0);
  finish(Uint8Array.from(Buffer.from('image')).buffer); await pending; assert.equal(f.uploadPackets().length, 1);
  f.socket('input').bufferedAmount = 128001; await f.data.dropFiles(drop([file()])); assert.equal(f.uploadPackets().length, 1); assert.match(f.data.error.value, /送信できません/);
  f.data.disconnect(); await f.data.dropFiles(drop([file()])); assert.equal(f.uploadPackets().length, 1);
  const text = { dataTransfer: { files: [], types: ['text/plain'] }, preventDefault() { throw Error('本文は止めない'); } };
  f.data.dragFiles(text); await f.data.dropFiles(text);
});
test('Live拡張transport: host側拒否をerror表示へ中継し、ソケットを閉じず古いidは無視', () => {
  const module = { exports: {} }, sent = []; let receive;
  vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/ライブ/ライブ通信.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, URL, location: { href: 'http://localhost/live/', protocol: 'http:' },
    acquireVsCodeApi: () => ({ postMessage: packet => sent.push(packet) }),
    window: { addEventListener: (_type, cb) => { receive = cb; }, removeEventListener() {} },
  });
  const env = new module.exports.LiveEnvironment({ host: true });
  const socket = env.socket(''), id = sent.at(-1).id, messages = []; socket.onmessage = event => messages.push(JSON.parse(event.data));
  receive({ data: { type: 'socket-opened', id } });
  receive({ data: { type: 'socket-send-error', id, error: '送信上限を超えました' } });
  assert.equal(messages[0].メッセージ識別, 'error'); assert.match(messages[0].メッセージ内容, /送信上限/); assert.equal(socket.readyState, 1);
  receive({ data: { type: 'socket-closed', id } }); receive({ data: { type: 'socket-send-error', id, error: '古い拒否' } }); assert.equal(messages.length, 1);
});


test('Live添付: 読込中は本文送信をhandlerと実buttonで止め、Core/host拒否で残りの読込を破棄する', async t => {
  for (const code of ['FILE_UPLOAD_FAILED', 'SOCKET_SEND_FAILED']) {
    const f = await fixture(t); let finish;
    f.data.prompt.value = '添付を見てください';
    const pending = f.data.dropFiles(drop([file('first.png'), { ...file('second.png'), arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }, file('third.png')]));
    await flush(); assert.equal(f.uploadPackets().length, 1); assert.equal(f.data.uploadingFiles.value, true);
    f.data.submit(); assert.equal(f.data.prompt.value, '添付を見てください'); assert.equal(f.sent.some(item => item.packet.メッセージ識別 === 'input_text'), false);
    const send = walk(f.render(), node => node?.type === 'button' && node.props?.['aria-label'] === '送信'); assert.equal(send.props.disabled, true);
    f.echo({ メッセージ識別: 'error', エラーコード: code, メッセージ内容: 'ファイル送信の試験エラー' }, code === 'SOCKET_SEND_FAILED' ? 'input' : '0');
    finish(Uint8Array.from(Buffer.from('image')).buffer); await pending;
    assert.equal(f.uploadPackets().length, 1); assert.equal(f.data.uploadingFiles.value, false); assert.equal(f.data.fileStatus.value, ''); assert.match(f.data.error.value, /試験エラー/);
  }
});
