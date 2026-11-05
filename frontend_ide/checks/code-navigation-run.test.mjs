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
function fixture(host = false, options = {}) {
  const calls = [], unmounted = [], timers = new Map(), timerDelays = new Map(), no = () => {}; let exposed, timerId = 0;
  let receive, notificationHost, cancel = () => {}, send = async message => calls.push(structuredClone(message));
  const { descriptor } = parse(source), script = compileScript(descriptor, { id: 'code', genDefaultAs: 'component' });
  const template = compileTemplate({ source: descriptor.template.content, filename: 'code.vue', id: 'code', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const module = { exports: {} }, modules = {
    '../共通表示/状態バー.vue': { name: 'StatusBar' },
    '../ターミナル/開始表示.vue': { name: 'TerminalWelcome' },
    '../コード/コード通信.js': { codeTransport: (_props, callback) => { receive = callback; return { send: message => send(message), cancelFiles: () => cancel(), saveDraft: no, dispose: no }; } },
    '../添付ファイル/ファイル送信.js': helper.exports,
    '../コード/会話到着演出': { chatArrival: (_scroll, host) => { notificationHost = host; return { reset: no, dispose: no, show: no, reserve: no, cancelReservation: no }; } },
    '../下書き連携/下書き受け渡し.js': { createDraftReceiver: () => ({ publish: no, dispose: no }) },
    '../../../host/src/stream-control': { visibleStreamContent: text => text, streamControlOf: text => text === '\x18' ? 'cancel' : undefined },
  };
  vm.runInNewContext(transformSync(`${script.content}\n${template.code}\ncomponent.render=render;module.exports=component;`, { format: 'cjs' }).code, {
    module, URL, console, window: {}, location: { href: 'http://localhost/code/' }, crypto, setTimeout: (fn, ms) => { timers.set(++timerId, fn); timerDelays.set(timerId, ms); return timerId; }, clearTimeout: id => { timers.delete(id); timerDelays.delete(id); },
    require: id => id === 'vue' ? { ...vue, withDirectives: node => node, onMounted: no, onBeforeUnmount: callback => unmounted.push(callback) }
      : id === 'markdown-it' ? require('markdown-it') : modules[id] || {},
  });
  const scope = vue.effectScope(), props = { host, ...options }, data = scope.run(() => module.exports.setup(props, { expose: value => { exposed = value; } }));
  let snapshot = { type: 'state', navigationRunSupported: true, 会話ID: 'conversation', メッセージ: [], 履歴: [], 進捗: [], 作業フォルダ: { パス: '/project' }, 接続プロジェクトパス: '/project', セッションID: 'session', 接続世代: 1, 信頼済み: true, 接続済み: true, 実行モード: 'online' };
  receive(snapshot);
  return { data, calls, exposed, packet: receive, timers, timerDelays, notificationHost: row => notificationHost(row), render: () => module.exports.render({}, [], props, vue.proxyRefs(data), {}, {}), state(change) { snapshot = { ...snapshot, ...change }; receive(snapshot); }, setSend(fn) { send = fn; }, setCancel(fn) { cancel = fn; },
    dispose() { for (const callback of unmounted) callback(); scope.stop(); } };
}

const run = (f, signal) => f.exposed.runNavigationPrompt({ text: '次の作業', projectPath: '/project', signal });
const result = (f, status, id = f.calls[0].navigationRequestId) => f.packet({ type: 'navigationRunResult', requestId: id, status });
test('Code通知: Web IDEタブの明示指定以外は単独・子窓・VS Code・Navi埋込の自分の領域だけを選ぶ', () => {
  const root = {}, body = {}, row = { ownerDocument: { body }, closest(selector) { assert.equal(selector, '.code-component'); return root; } };
  for (const [host, options] of [[false, {}], [false, { desktop: true }], [false, { embedded: true, linked: true, desktop: true }], [true, {}], [false, { embedded: true, hideStatusBar: true }], [false, { embedded: true, pageNotifications: true }]]) {
    const f = fixture(host, options);try { assert.equal(f.notificationHost(row), options.pageNotifications ? body : root); } finally { f.dispose(); }
  }
});
test('Navigator Code: 初回の一時offline表示・接続失敗・未確定sessionでは送らず、オンライン確定後に1回だけ送る', async () => {
  const f = fixture();try {
    for (const connecting of [true, false]) {
      f.state({ 自動接続: true, 接続済み: false, 接続中: connecting, 実行モード: 'offline', セッションID: undefined, 接続プロジェクトパス: '', provider: 'aidiy_hermes', model: 'same' });
      assert.equal(f.exposed.navigationReadiness('/project').ready, false);await assert.rejects(run(f), /オンライン接続/);assert.equal(f.calls.length, 0);
    }
    f.state({ 接続済み: true, 接続中: false, 実行モード: 'online', セッションID: 'session', 接続プロジェクトパス: '/project' });
    for (const invalid of [{ セッションID: '' }, { 接続プロジェクトパス: '' }, { 接続プロジェクトパス: '/other' }, { 接続世代: undefined }]) {
      f.state(invalid);assert.equal(f.exposed.navigationReadiness('/project').ready, false);f.state({ セッションID: 'session', 接続プロジェクトパス: '/project', 接続世代: 1 });
    }
    const pending = run(f);assert.equal(f.calls.length, 1);assert.equal(f.calls[0].sessionId, 'session');result(f, 'accepted');result(f, 'succeeded');await pending;
    assert.equal(f.exposed.navigationReadiness('/project').ready, true);
  } finally { f.dispose(); }
});
test('Navigator Code: 明示オフラインは維持し、自動入力は人間の下書きを変更しない', async () => {
  const f = fixture();try {
    f.state({ 自動接続: false, 接続済み: false, 実行モード: 'offline', セッションID: undefined, 接続プロジェクトパス: '' });f.data.prompt.value = '人間の下書き';
    const pending = run(f);assert.equal(f.data.displayedPrompt.value, '次の作業');assert.equal(f.data.prompt.value, '人間の下書き');
    result(f, 'accepted', 'other');assert.equal(f.data.displayedPrompt.value, '次の作業');result(f, 'accepted');assert.equal(f.data.displayedPrompt.value, '人間の下書き');
    result(f, 'succeeded');await pending;assert.equal(f.calls.filter(p => p.type === 'input_text').length, 1);
  } finally { f.dispose(); }
});
test('Navigator Code: 完了監視だけ1時間、Codeの15分無応答失敗は直ちに停止し再評価・再送しない', async () => {
  for (const backendFailure of [false, true]) {
    const f = fixture();try {
      const pending = run(f), rejected = assert.rejects(pending);assert.deepEqual([...f.timerDelays.values()], [30000]);result(f, 'accepted');assert.deepEqual([...f.timerDelays.values()], [3600000]);
      result(f, 'accepted');assert.deepEqual([...f.timerDelays.values()], [3600000]);
      if (backendFailure) f.packet({ type: 'navigationRunResult', requestId: f.calls[0].navigationRequestId, status: 'failed', message: '処理タイムアウト(900秒)が発生しました。' });
      else [...f.timers.values()][0]();
      await rejected;assert.match(f.data.error.value, backendFailure ? /900秒/ : /1時間/);assert.equal(f.data.navigationRunning.value, false);assert.equal(f.calls.filter(p => p.type === 'input_text').length, 1);assert.equal(f.calls.filter(p => p.type === 'cancel_run').length, 1);
    } finally { f.dispose(); }
  }
  const cli=readFileSync(new URL('../../backend_server/AIコア/AIコード_cli.py',import.meta.url),'utf8');assert.match(cli,/タイムアウト秒数: int = 900/);assert.match(cli,/time\.monotonic\(\) - last_output_time > timeout/);
});
test('Navigator Code: ID一致の受付と成功だけで完了、idle・別ID・重複送信は無効', async () => {
  const f = fixture(); try {
    f.data.prompt.value = '手動の下書き';
    assert.equal(f.exposed.navigationReadiness('/project').ready, true);
    const pending = run(f); let done = false; pending.then(() => { done = true; });
    assert.equal(f.exposed.navigationReadiness().running, true);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].self_check_loop, 0);
    assert.equal('autoApprove' in f.calls[0], false);
    await assert.rejects(run(f));
    await f.data.send('new'); await f.data.openModels(); await f.data.submit();
    assert.equal(f.calls.length, 1);
    f.packet({ type: 'accepted' }); assert.equal(f.data.prompt.value, '手動の下書き');
    f.state({ 実行中: true }); f.state({ 実行中: false });
    result(f, 'accepted', 'unrelated'); result(f, 'succeeded', 'unrelated'); await flush(); assert.equal(done, false);
    result(f, 'accepted'); await flush(); assert.equal(done, false);
    result(f, 'succeeded'); assert.equal((await pending).status, 'succeeded');
    assert.equal(f.exposed.navigationReadiness().ready, true);
    assert.equal(f.timers.size, 0);
  } finally { f.dispose(); }
});
test('Navigator Code: 事前中止・別project・非対応・実行中には一切送信しない', async () => {
  const f = fixture(); try {
    const controller = new AbortController(); controller.abort(); await assert.rejects(run(f, controller.signal));
    await assert.rejects(f.exposed.runNavigationPrompt({ text: '依頼', projectPath: '/other' }));
    f.state({ navigationRunSupported: false }); await assert.rejects(run(f));
    f.state({ navigationRunSupported: true, 実行中: true }); await assert.rejects(run(f));
    assert.equal(f.calls.length, 0);
  } finally { f.dispose(); }
});
test('Navigator Code: 中止・切断・scope変更・timeout・破棄・失敗は元のIDを停止し再送禁止', async () => {
  for (const action of ['abort', 'disconnect', 'session', 'project', 'conversation', 'epoch', 'model', 'mode', 'trust', 'stop', 'timeout', 'dispose', 'failed', 'success-before-accept']) {
    const f = fixture(), controller = new AbortController();
    const pending = run(f, controller.signal), rejected = assert.rejects(pending);
    if (action === 'abort') controller.abort();
    if (action === 'disconnect') f.packet({ type: 'transportError', message: '切断' });
    if (action === 'session') f.state({ セッションID: 'new' });
    if (action === 'project') f.state({ 作業フォルダ: { パス: '/other' } });
    if (action === 'conversation') f.state({ 会話ID: 'new' });
    if (action === 'epoch') f.state({ 接続世代: 2 });
    if (action === 'model') f.state({ model: 'other' });
    if (action === 'mode') f.state({ 実行モード: 'offline' });
    if (action === 'trust') f.state({ 信頼済み: false });
    if (action === 'stop') await f.data.stop();
    if (action === 'timeout') [...f.timers.values()][0]();
    if (action === 'dispose') f.dispose();
    if (action === 'failed') result(f, 'failed');
    if (action === 'success-before-accept') result(f, 'succeeded');
    await rejected;
    assert.equal(f.calls.filter(p => p.type === 'cancel_run').length, 1, action);
    assert.equal(f.calls[1].navigationRequestId, f.calls[0].navigationRequestId);
    result(f, 'accepted'); result(f, 'succeeded');
    await assert.rejects(run(f)); assert.equal(f.calls.filter(p => p.type === 'input_text').length, 1);
    if (action !== 'dispose') f.dispose();
  }
});
test('Navigator Code: HTTP結果不明でも再送せず、受付後の実行期限も停止する', async () => {
  for (const mode of ['send-failed', 'execution-timeout']) {
    const f = fixture(); try {
      if (mode === 'send-failed') f.setSend(async message => { f.calls.push(message); if (message.type === 'input_text') throw Error('応答喪失'); });
      const pending = run(f), rejected = assert.rejects(pending);
      if (mode === 'execution-timeout') { result(f, 'accepted'); [...f.timers.values()][0](); }
      await rejected; await assert.rejects(run(f)); assert.equal(f.calls.filter(p => p.type === 'input_text').length, 1);
    } finally { f.dispose(); }
  }
});

function nodeOf(node, predicate) {
  if (predicate(node)) return node;
  const children = Array.isArray(node?.children) ? node.children : node?.children?.default?.() || [];
  for (const child of children) { const found = nodeOf(child, predicate); if (found) return found; }
}
const element = (f, predicate) => nodeOf(f.render(), predicate);
test('Codeの指定説明はプロジェクト表示の直下に1つだけ置き、通常Codeには出さない', () => {
  const notice='Navigator制御下です。自動航行オンならここで実行し、完了後に再評価します。評価が3回改善しない場合は停止します。';
  for (const options of [{}, { embedded:true, projectNotice:notice }]) {
    const f=fixture(false,options);try {
      const children=f.render().children,toolbar=children.findIndex(node=>node.props?.class==='component-toolbar'),notes=children.filter(node=>node.props?.class==='code-project-notice');
      assert.equal(notes.length,options.projectNotice?1:0);if(notes.length){assert.equal(children[toolbar+1],notes[0]);assert.equal(notes[0].children,notice);}
    } finally { f.dispose(); }
  }
});
test('Navigator埋込だけタイトルと接続バーを省略し、空会話へAiDiyアイコンを渡す', () => {
  const f = fixture(false, { embedded: true, hideStatusBar: true, icon: '/development/AiDiy.png' });
  try {
    assert.equal(element(f, node => node.type?.name === 'StatusBar'), undefined);
    const welcome = element(f, node => node.type?.name === 'TerminalWelcome');assert.ok(welcome);assert.equal(welcome.props.icon, '/development/AiDiy.png');
    f.state({ メッセージ: [{ 種別: 'user', 本文: '依頼' }] });assert.equal(element(f, node => node.type?.name === 'TerminalWelcome'), undefined);
    f.state({ メッセージ: [], 会話ID: 'new-conversation' });assert.equal(element(f, node => node.type?.name === 'TerminalWelcome').props.icon, '/development/AiDiy.png');
  } finally { f.dispose(); }
});
test('通常・IDE埋込・VS CodeのCodeは既存タイトルと接続バーを維持する', () => {
  for (const [host, options] of [[false, {}], [false, { embedded: true, linked: true }], [true, {}]]) {
    const f = fixture(host, options);
    try { const status = element(f, node => node.type?.name === 'StatusBar');assert.ok(status);assert.equal(status.props.title, options.linked ? 'AiDiy IDE / Code' : 'AiDiy Code'); }
    finally { f.dispose(); }
  }
});
async function humanSend(f, text) {
  const input = element(f, node => node?.type === 'textarea');
  assert.equal(Boolean(input.props.disabled), false); assert.equal(Boolean(input.props.readonly), false);
  input.props['onUpdate:modelValue'](text); await flush();
  const button = element(f, node => node?.props?.['aria-label'] === '送信');
  assert.equal(Boolean(button.props.disabled), false);
  element(f, node => node?.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
  const request = f.calls.at(-1);
  assert.equal(request.type, 'input_text'); assert.equal(request.メッセージ内容, text);
  assert.equal('navigationRequestId' in request, false, '人間の送信をNavigator要求に変えない');
  f.packet({ type: 'accepted' }); f.state({ 実行中: false }); await flush();
}
async function humanModel(f) {
  const button = element(f, node => node?.type === 'button' && node.props?.onClick === f.data.openModels);
  assert.equal(Boolean(button.props.disabled), false); await button.props.onClick();
  f.packet({ type: 'modelCatalog', provider: '', items: [{ id: 'aidiy_hermes', label: 'Hermes' }] });
  f.data.provider.value = 'aidiy_hermes'; await f.data.changeProvider();
  f.packet({ type: 'modelCatalog', provider: 'aidiy_hermes', items: [{ id: 'same', label: 'same' }] });
  const select = element(f, node => node?.type === 'select' && node.props?.['onUpdate:modelValue']?.toString().includes('model'));
  assert.equal(Boolean(select.props.disabled), false); select.props['onUpdate:modelValue']('same'); await flush();
  const apply = element(f, node => node?.type === 'button' && node.props?.onClick === f.data.applyModel);
  assert.equal(Boolean(apply.props.disabled), false); await apply.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))), { type: 'setModel', provider: 'aidiy_hermes', model: 'same' });
  assert.equal(f.data.picker.value, false);
}
test('Code手動: 表示だけで何も送らず、人間の入力・送信・モデル選択は自動航行の前後で使える', async () => {
  const f = fixture(); try {
    assert.equal(f.calls.length, 0); assert.equal(f.data.autoSuggest.value, false);
    await humanSend(f, '人間が依頼します'); await humanModel(f);
    const before = f.calls.length, pending = run(f), id = f.calls.at(-1).navigationRequestId;
    assert.equal(f.calls.length, before + 1);
    result(f, 'accepted', id); f.state({ 実行中: true });
    result(f, 'succeeded', id); await pending; f.state({ 実行中: false });
    await humanSend(f, '完了後も人間が依頼'); await humanModel(f);
    assert.equal(f.calls.filter(p => p.navigationRequestId && p.type === 'input_text').length, 1);
  } finally { f.dispose(); }
});
test('Code手動: 受付前OFFは停止応答を待って手動へ戻る。遅延した受付で下書きを消さない', async () => {
  const f = fixture(); try {
    let acknowledgeCancel;
    f.setSend(message => { f.calls.push(structuredClone(message)); return message.type === 'cancel_run'
      ? new Promise(resolve => { acknowledgeCancel = resolve; }) : Promise.resolve(); });
    const controller = new AbortController(), pending = run(f, controller.signal), id = f.calls.at(-1).navigationRequestId;
    const rejected = assert.rejects(pending); controller.abort(); await rejected;
    f.data.prompt.value = '人間の次の入力';
    assert.equal(f.data.pending.value, false); assert.equal(f.data.busy.value, true);
    await f.data.submit(); await f.data.openModels(); assert.equal(f.calls.length, 2);
    acknowledgeCancel(); await flush(); assert.equal(f.data.busy.value, false);
    f.packet({ type: 'accepted', navigationRequestId: id }); assert.equal(f.data.prompt.value, '人間の次の入力');
    await humanSend(f, '停止後の人間の依頼'); await humanModel(f);
    await assert.rejects(run(f), /開き直して/);
    assert.equal(f.calls.filter(p => p.navigationRequestId && p.type === 'input_text').length, 1);
  } finally { f.dispose(); }
});
test('Code手動: 稼働中OFFは停止受付後も実終了まで待ち、停止確認失敗では安全側に止める', async () => {
  for (const cancelFails of [false, true]) {
    const f = fixture(); try {
      if (cancelFails) f.setSend(async message => { f.calls.push(structuredClone(message)); if (message.type === 'cancel_run') throw Error('切断'); });
      const controller = new AbortController(), pending = run(f, controller.signal);
      result(f, 'accepted'); f.state({ 実行中: true }); const rejected = assert.rejects(pending); controller.abort(); await rejected; await flush();
      assert.equal(f.data.busy.value, true); f.state({ 実行中: false }); await flush();
      if (cancelFails) {
        assert.equal(f.data.busy.value, true); await f.data.openModels(); assert.equal(f.data.picker.value, false);
        await f.data.submit(); assert.equal(f.calls.filter(p => p.type === 'input_text').length, 1);
      } else { await humanSend(f, '終了を確認して人間が送信'); await humanModel(f); }
    } finally { f.dispose(); }
  }
});
test('Code手動: 停止応答を失った後も同じ要求の確定完了で手動だけ復帰する', async () => {
  const f = fixture(); try {
    f.setSend(async message => { f.calls.push(structuredClone(message)); if (message.type === 'cancel_run') throw Error('応答喪失'); });
    const controller = new AbortController(), pending = run(f, controller.signal), rejected = assert.rejects(pending);
    controller.abort(); await rejected; await flush(); assert.equal(f.data.busy.value, true);
    result(f, 'succeeded', 'unrelated'); assert.equal(f.data.busy.value, true);
    result(f, 'succeeded'); await flush(); assert.equal(f.data.busy.value, false);
    await humanSend(f, '確定完了後の人間の入力'); await humanModel(f);
    await assert.rejects(run(f), /開き直して/);
  } finally { f.dispose(); }
});
test('Code手動: 停止HTTP応答がSSEより先でも、サーバーが終了待ちなら手動操作を解放しない', async () => {
  const f = fixture(); try {
    f.setSend(async message => { f.calls.push(structuredClone(message)); return { ok: true, navigationPending: message.type === 'cancel_run' }; });
    const controller = new AbortController(), pending = run(f, controller.signal), rejected = assert.rejects(pending);
    controller.abort(); await rejected; await flush();
    assert.equal(f.data.state.実行中, undefined); assert.equal(f.data.busy.value, true);
    f.state({ 実行中: false }); assert.equal(f.data.busy.value, true);
    f.data.prompt.value = '人間の依頼'; await f.data.submit(); await f.data.openModels();
    assert.equal(f.calls.length, 2);
    result(f, 'cancelled'); await flush(); assert.equal(f.data.busy.value, false);
    await humanSend(f, '終了確認後の人間の依頼'); await humanModel(f);
  } finally { f.dispose(); }
});

test('Code手動: terminalが停止HTTP応答より先なら、遅延した終了待ち応答で再ロックしない', async () => {
  const f = fixture(); try {
    let acknowledgeCancel;
    f.setSend(message => { f.calls.push(structuredClone(message)); return message.type === 'cancel_run'
      ? new Promise(resolve => { acknowledgeCancel = resolve; }) : Promise.resolve(); });
    const controller = new AbortController(), pending = run(f, controller.signal), rejected = assert.rejects(pending);
    controller.abort(); await rejected; assert.equal(f.data.busy.value, true);
    result(f, 'cancelled'); await flush(); assert.equal(f.data.busy.value, false);
    acknowledgeCancel({ ok: true, navigationPending: true }); await flush(); assert.equal(f.data.busy.value, false);
    await humanSend(f, '手動操作を続ける');
  } finally { f.dispose(); }
});
