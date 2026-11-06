/*! COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as draftHandoff from '../src/components/下書き連携/下書き受け渡し.js';

const require = createRequire(import.meta.url), vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const { transformSync, buildSync } = require('esbuild');
const domGlobals = new Map(['Document', 'ShadowRoot'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
test.before(() => { for (const key of domGlobals.keys()) Object.defineProperty(globalThis, key, { configurable: true, value: class {} }); });
test.after(() => { for (const [key, descriptor] of domGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const walk = (node, predicate) => predicate(node) ? node : node.children.map(child => walk(child, predicate)).find(Boolean);
const textOf = node => [node.text, ...node.children.map(textOf)].join('');
const initial = () => ({ type: 'state', 会話ID: 'first', メッセージ: [], 進捗: [], 信頼済み: true, 接続済み: true,
  画面接続済み: true, 実行モード: 'online', 作業フォルダ: { 名前: 'project', パス: '/project' },
  履歴: [{ id: 'first', 題名: '最初の会話', 更新日時: 1 }, { id: 'second', 題名: '次の会話', 更新日時: 2 }] });

// テンプレートの実click → 実codeTransport → HTTP/SSEまたはVS Codeメッセージを通す。
// DOM描画先と通信相手だけを試験用にし、受信・公開API・下書き照合は差し替えない。
async function panel(t, { host = false, desktop = false } = {}) {
  const window = new EventTarget(), requests = [], registrations = [], sent = [], warnings = [];
  let events, handoff, state, exposed, saved = '', hostSend;
  window.aidiyWindow = { registerDraftTarget: async value => { registrations.push(value); }, onDraftHandoff: listener => { handoff = listener; return () => { handoff = undefined; }; } };
  window.acquireVsCodeApi = () => ({ postMessage: packet => { sent.push(packet); hostSend?.(packet); }, getState: () => ({ 下書き: saved }), setState: value => { saved = value.下書き; } });
  const globals = { window, location: { href: 'http://localhost/code/', protocol: 'http:' }, URL, URLSearchParams, Response,
    crypto: { randomUUID }, console, setTimeout, clearTimeout,
    ResizeObserver: class { observe() {} disconnect() {} },
    EventSource: class { constructor() { events = this; } close() {} },
    fetch: (_url, options) => new Promise((resolve, reject) => { const packet = JSON.parse(options.body); sent.push(packet); requests.push({ packet, resolve, reject }); }),
  };
  const transport = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/コード/コード通信.js', import.meta.url), 'utf8'), { format: 'cjs' }).code, { ...globals, module: transport });
  const progress = { setup(_props, { expose }) { expose({ sync() {}, reset() {}, packet() {} }); return () => null; } };
  const modules = {
    '../添付ファイル/ファイル送信.js': {},
    '../コード/コード通信.js': transport.exports, '../下書き連携/下書き受け渡し.js': draftHandoff,
    '../../../host/src/stream-control': { visibleStreamContent: value => value },
    '../コード/会話到着演出': { chatArrival: () => ({ reset() {}, dispose() {}, show() {}, reserve() {}, cancelReservation() {} }) },
    'markdown-it': require('markdown-it'), '../コンソール/進捗表示.vue': progress,
  };
  const { descriptor } = parse(readFileSync(new URL('../src/components/コード/コードパネル.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id: 'CodePanel', genDefaultAs: 'component' });
  const template = compileTemplate({ source: descriptor.template.content, filename: 'CodePanel.vue', id: 'CodePanel', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const module = { exports: {} };
  vm.runInNewContext(transformSync(`${script.content}\n${template.code}\ncomponent.render=render;module.exports=component;`, { format: 'cjs' }).code, {
    ...globals, module, require: id => id === 'vue' ? vue : modules[id] || (id.endsWith('.vue') ? { render: () => null } : assert.fail(id)),
  });
  const component = module.exports, setup = component.setup;
  component.setup = (props, context) => { state = setup(props, { ...context, expose(value) { exposed = value; context.expose(value); } }); return state; };
  function element(type, text = '') {
    const node = new EventTarget();
    return Object.assign(node, { type, tagName: type.toUpperCase(), text, children: [], props: {}, style: {}, value: '', scrollTop: 0,
      focus() {}, setSelectionRange() {}, setAttribute() {}, removeAttribute() {}, getRootNode: () => ({ activeElement: null }) });
  }
  const renderer = vue.createRenderer({
    createElement: element, createText: text => element('text', text), createComment: text => element('comment', text),
    insert(node, parent, anchor) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = parent; const index = parent.children.indexOf(anchor); parent.children.splice(index < 0 ? parent.children.length : index, 0, node); },
    remove(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
    parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1],
    patchProp: (node, key, _previous, value) => { node.props[key] = value; },
    setText: (node, text) => { node.text = text; }, setElementText: (node, text) => { node.text = text; node.children = []; },
  });
  const root = element('root'), app = renderer.createApp(component, { host, desktop, linked: desktop });
  app.config.warnHandler = warning => warnings.push(warning);
  let disposed = false;
  const dispose = () => { if (!disposed) { disposed = true; app.unmount(); } };
  app.mount(root); t.after(() => { dispose(); assert.deepEqual(warnings, []); });
  function packet(data) { if (host) { const event = new Event('message'); event.data = data; window.dispatchEvent(event); } else events.onmessage({ data: JSON.stringify(data) }); }
  packet(initial()); await flush(); state.prompt.value = '保持する下書き'; await flush();
  const find = predicate => walk(root, predicate);
  async function action(type, id = 'second') {
    if (type === 'selectHistory') { state.history.value = true; await flush(); }
    return () => find(node => node.type === 'button' && (type === 'new' ? textOf(node) === '＋ 新規' : node.props['aria-label'] === `会話を開く: ${id === 'first' ? '最初の会話' : '次の会話'}`)).props.onClick();
  }
  return { state, exposed, sent, requests, registrations, packet, action, dispose, textarea: () => find(node => node.type === 'textarea'), notice: () => textOf(find(node => node.props.role === 'status') || { text: '', children: [] }), onPost: callback => { hostSend = callback; }, handoff: data => handoff(data),
    disconnect: () => events.onerror(), reply: (index = 0, status = 200) => requests[index].resolve(new Response(JSON.stringify(status === 200 ? { ok: true } : { error: '会話がありません。' }), { status })) };
}

test('Navigator実Vue・実transport: 接続待ちから入力欄へ提案を表示し、確定sessionで一度だけHTTP送信する', async t => {
  const f = await panel(t), base = { ...initial(), navigationRunSupported: true, 自動接続: true, 接続世代: 1 };
  f.packet({ ...base, 接続済み: false, 接続中: true, 実行モード: 'offline', 接続プロジェクトパス: '', セッションID: '' });await flush();
  assert.equal(f.exposed.navigationReadiness('/project').ready, false);await assert.rejects(f.exposed.runNavigationPrompt({ text: '最初の提案', projectPath: '/project' }));assert.equal(f.sent.length, 0);
  const connected = { ...base, 接続中: false, 接続済み: true, 実行モード: 'online', 接続プロジェクトパス: '/project', セッションID: 'connected-session' };f.packet(connected);await flush();
  const pending = f.exposed.runNavigationPrompt({ text: '最初の提案', projectPath: '/project' });await flush();
  assert.equal(f.textarea().value, '最初の提案');assert.equal(f.textarea().props.readonly, true);assert.equal(f.state.prompt.value, '保持する下書き');
  assert.equal(f.sent.length, 1);assert.equal(f.sent[0].メッセージ内容, '最初の提案');assert.equal(f.sent[0].sessionId, 'connected-session');
  const requestId = f.sent[0].navigationRequestId;f.reply();f.packet({ type: 'navigationRunResult', requestId, status: 'accepted' });f.packet({ ...connected, 実行中: true, メッセージ: [{ 種別: 'user', 本文: '最初の提案' }] });await flush();
  assert.equal(f.textarea().value, '保持する下書き');f.packet({ ...connected, 実行中: false, メッセージ: [{ 種別: 'user', 本文: '最初の提案' }, { 種別: 'assistant', 本文: '完了' }] });f.packet({ type: 'navigationRunResult', requestId, status: 'succeeded' });await pending;await flush();
  assert.equal(f.sent.length, 1);assert.equal(f.exposed.navigationReadiness('/project').ready, true);
});

async function extensionPanel(t) {
  // 現行ホストの実在判定をそのまま使い、試験所有のローカルフォルダだけを渡す。
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'aidiy-code-transition-'));
  const projectPath = mkdtempSync(join(fixtureRoot, 'project-'));
  const otherPath = mkdtempSync(join(fixtureRoot, 'other-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const workspaceModule = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL('../host/src/workspace-folder.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module: workspaceModule, require,
  });
  const predictionModule = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL('../host/src/input-prediction.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module: predictionModule, exports: predictionModule.exports, AbortController,
    fetch: () => assert.fail('この会話切替試験では予測の外部接続は禁止'),
    require: id => id === '../aidiy_live/local-backend.cjs' ? {} : assert.fail(id),
  });
  const f = await panel(t, { host: true }), pending = [], posts = [];
  const uri = path => ({ scheme: 'file', fsPath: path, toString: () => `file://${path}` });
  const folders = [projectPath, otherPath].map((path, index) => ({ name: index ? 'other' : 'project', uri: uri(path) }));
  const subscription = { dispose() {} }; let provider, receive, editorChanged;
  const vscode = { workspace: { isTrusted: true, workspaceFolders: folders, getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    getWorkspaceFolder: value => folders.find(folder => value.fsPath.startsWith(folder.uri.fsPath)), onDidChangeWorkspaceFolders: () => subscription },
    window: { activeTextEditor: { document: { uri: folders[0].uri } },
      onDidChangeActiveTextEditor(callback) { editorChanged = callback; return subscription; },
      createOutputChannel: () => ({ appendLine() {}, clear() {}, dispose() {} }), registerWebviewViewProvider(_id, value) { provider = value; return subscription; } },
    Uri: { joinPath: (_root, path) => uri(path) }, commands: { registerCommand: () => subscription } };
  const modules = { vscode, './workspace-folder': workspaceModule.exports, './file-attachments': {},
    './extension-installation': { extensionCoreConnection: () => assert.fail('この会話切替試験ではCoreへの外部接続は禁止') },
    './input-prediction': predictionModule.exports,
    './vscode-html': { developmentHtml: () => '' },
    './code-connection': { コード選択: value => ({ provider: value.provider || '', model: value.model || '' }), CodeConnection: class { constructor() { assert.fail('外部接続は禁止'); } } },
    './model-preferences': { モデル保存先: () => 'model.json', オフラインモデル保存先: () => 'offline.json', コードモデル読込() {}, コード設定保存先: () => 'options.json', 検証回数読込: () => 0 },
    '../aidiy_code/src/offline': { オフラインモデル候補: () => [{ id: 'same' }], Hermes既定モデル: () => 'same', オフラインモデル保存先: () => 'offline.json' },
    './conversation-store': { 会話保存先: path => path, 会話一覧: path => path === projectPath ? ['first', 'second'].map((id, i) => ({ id, 更新日時: i + 1, 初回依頼: i ? '次の会話' : '最初の会話', メッセージ: [], provider: '', model: '', 実行モード: 'online' })) : [], 会話書込() {}, 会話削除() {}, 会話本文上限: 4e6, 履歴メッセージ長さ: item => item.本文.length },
    './runner': {}, './protocol': {}, '../aidiy_live/local-backend.cjs': {},
  };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL('../host/src/extension.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, setTimeout: () => 0, clearTimeout() {}, console, require: id => modules[id] || require(id),
  });
  module.exports.activate({ extensionPath: '/fixture', extensionUri: uri('/fixture'), subscriptions: [],
    workspaceState: { get: key => key === '会話履歴' ? { 現在ID: 'first', 一覧: [] } : undefined, update: async () => {} }, globalState: { get() {} } });
  provider.自動接続 = false;
  provider.resolveWebviewView({ webview: { options: {}, cspSource: 'self', asWebviewUri: value => value,
    onDidReceiveMessage(callback) { receive = callback; return subscription; }, postMessage(packet) { posts.push(structuredClone(packet)); f.packet(packet); return Promise.resolve(); } },
    onDidDispose: () => subscription, onDidChangeVisibility: () => subscription });
  t.after(() => provider.dispose());
  f.onPost(packet => pending.push(packet)); receive({ type: 'ready' }); await flush();
  return { ...f, projectPath, otherPath, posts, provider, pending, activateOther() { editorChanged({ document: { uri: folders[1].uri } }); },
    async dispatch() { receive(pending.shift()); await flush(); } };
}

test('Code: 実VS CodeホストのNewは固定中の会話Aからアクティブな別ルートBへ安全に切り替わる', async t => {
  const f = await extensionPanel(t), target = f.exposed.draftTarget();
  f.activateOther(); await flush(); assert.equal(f.state.state.作業フォルダ.パス, f.projectPath);
  const click = await f.action('new'); click(); assert.equal(f.exposed.draftTarget(), null);
  await f.dispatch();
  const current = f.exposed.draftTarget(); assert.ok(current); assert.equal(current.projectPath, f.otherPath);
  assert.equal(f.state.changingConversation.value, false); assert.equal(f.state.busy.value, false);
  assert.equal(f.exposed.insertDraft({ ...target, text: '前のプロジェクトへの追加' }).ok, false);
  assert.equal(f.exposed.insertDraft({ ...current, text: '新しいプロジェクトへの追加' }).ok, true);
});

for (const type of ['new', 'selectHistory', 'deleteHistory']) for (const reason of ['run', 'model']) {
  test(`Code: 実VS Codeホストの${type}/${reason}拒否は要求IDを照合し、下書きを保って操作へ復帰する`, async t => {
    const f = await extensionPanel(t), target = f.exposed.draftTarget();
    if (type === 'deleteHistory') void f.state.send(type, { id: 'first' }); else (await f.action(type))();
    const request = f.pending[0];
    f.packet({ type: 'conversationChangeResult', requestId: 'unrelated', ok: false, message: '古い拒否' });
    assert.equal(f.exposed.draftTarget(), null);
    if (reason === 'run') f.provider.実行中 = true; else f.provider.モデル反映中 = true;
    await f.dispatch();
    assert.equal(f.posts.at(-1).type, 'conversationChangeResult'); assert.equal(f.posts.at(-1).requestId, request.requestId);
    assert.equal(f.posts.at(-1).ok, false); assert.match(f.state.error.value, /実行中/);
    assert.equal(f.state.prompt.value, '保持する下書き'); assert.equal(f.state.changingConversation.value, false);
    const current = f.exposed.draftTarget(); assert.ok(current); assert.notEqual(current.contextId, target.contextId);
    assert.equal(f.exposed.insertDraft({ ...target, text: '以前の選択' }).ok, false);
  });
}

for (const type of ['selectHistory', 'deleteHistory']) {
  test(`Code: 実VS Codeホストで${type}前に消えた履歴は相関した拒否を表示する`, async t => {
    const f = await extensionPanel(t);
    if (type === 'deleteHistory') void f.state.send(type, { id: 'first' }); else (await f.action(type))();
    f.provider.履歴 = []; await f.dispatch();
    assert.match(f.state.error.value, /会話がありません/); assert.equal(f.state.changingConversation.value, false);
    assert.equal(f.state.prompt.value, '保持する下書き'); assert.ok(f.exposed.draftTarget());
  });
}

for (const type of ['selectHistory', 'deleteHistory']) {
  test(`Code: 実VS Codeホストの${type}成功は同じプロジェクトの応答だけで再公開する`, async t => {
    const f = await extensionPanel(t), target = f.exposed.draftTarget();
    if (type === 'deleteHistory') void f.state.send(type, { id: 'first' }); else (await f.action(type))();
    assert.equal(f.exposed.draftTarget(), null); await f.dispatch();
    const current = f.exposed.draftTarget(); assert.ok(current); assert.equal(current.projectPath, f.projectPath);
    assert.notEqual(current.contextId, target.contextId); assert.equal(f.state.changingConversation.value, false);
  });
}

test('Code: VS Codeの成功応答は要求・会話・プロジェクトを照合し、旧ホストの無応答中も復帰方法を表示する', async t => {
  const f = await panel(t, { host: true }); (await f.action('selectHistory'))(); await flush();
  assert.match(f.notice(), /再読み込み/);
  const requestId = f.sent.at(-1).requestId;
  const result = { type: 'conversationChangeResult', requestId, ok: true, 会話ID: 'second', projectPath: '/other' };
  f.packet(result); f.packet({ ...initial(), 会話ID: 'second', 作業フォルダ: { 名前: 'other', パス: '/other' } }); await flush();
  assert.equal(f.exposed.draftTarget(), null, '履歴選択は相関した成功でも別プロジェクトへ広げない');
  f.packet({ ...result, projectPath: '/project' }); await flush(); assert.equal(f.exposed.draftTarget(), null, '実際の状態が一致するまで待つ');
  f.packet({ ...initial(), 会話ID: 'second' }); await flush(); assert.ok(f.exposed.draftTarget());
});

for (const host of [false, true]) for (const type of ['new', 'selectHistory']) {
  test(`Code ${host ? 'VS Code' : 'HTTP/SSE'}: ${type}の実click時に旧渡し先を即時失効し、目的の会話まで再公開しない`, async t => {
    const f = await panel(t, { host, desktop: !host }), target = f.exposed.draftTarget(), click = await f.action(type);
    click();
    assert.equal(f.exposed.insertDraft({ ...target, text: '消えてはいけないファイル参照' }).ok, false);
    assert.equal(f.exposed.draftTarget(), null);
    if (!host) { assert.equal(f.registrations.at(-1), null); assert.equal(f.handoff({ ...target, text: '遅延IPC' }).ok, false); }
    click(); await flush(); assert.equal(f.sent.filter(packet => packet.type === type).length, 1, '再描画前の連打も送信しない');
    f.packet({ ...initial(), 接続中: true }); await flush();
    assert.equal(f.exposed.draftTarget(), null, '古い会話の接続通知では切替を完了させない');
    if (!host) { f.reply(); await flush(); assert.equal(f.exposed.draftTarget(), null, 'HTTP成功だけではSSE状態を推測しない'); }
    assert.equal(f.state.prompt.value, '保持する下書き');
    f.packet({ ...initial(), 会話ID: 'second' }); await flush();
    if (host) {
      assert.equal(f.exposed.draftTarget(), null, 'ホストの成功確認前には状態だけで再公開しない');
      f.packet({ type: 'conversationChangeResult', requestId: f.sent.find(packet => packet.type === type).requestId, ok: true, 会話ID: 'second', projectPath: '/project' }); await flush();
    }
    const current = f.exposed.draftTarget(); assert.ok(current); assert.notEqual(current.contextId, target.contextId);
    assert.equal(f.state.prompt.value, ''); assert.equal(f.exposed.insertDraft({ ...target, text: '古い要求' }).ok, false);
    assert.equal(f.exposed.insertDraft({ ...current, text: '新しい会話へ追加' }).ok, true);
    assert.equal(f.state.prompt.value, '新しい会話へ追加');
  });
}

test('Code: HTTPで確定した拒否だけは既存下書きを保ち、新しいcontextIdで元の会話へ復帰する', async t => {
  const f = await panel(t, { desktop: true }), target = f.exposed.draftTarget(), click = await f.action('selectHistory');
  click(); f.reply(0, 404); await flush();
  assert.match(f.state.error.value, /会話がありません/); assert.equal(f.state.prompt.value, '保持する下書き');
  const current = f.exposed.draftTarget(); assert.ok(current); assert.notEqual(current.contextId, target.contextId);
  assert.equal(f.exposed.insertDraft({ ...target, text: '旧contextId' }).ok, false);
  assert.equal(f.exposed.insertDraft({ ...current, text: '再選択した追加' }).ok, true);
});

test('Code: 応答を失った要求や500では旧状態を安全とみなさず、実際の会話切替を待つ', async t => {
  for (const failure of ['network', 'server']) {
    const f = await panel(t), target = f.exposed.draftTarget(), click = await f.action('new'); click();
    if (failure === 'network') f.requests[0].reject(new TypeError('Failed to fetch')); else f.reply(0, 500);
    await flush(); assert.equal(f.exposed.draftTarget(), null);
    f.packet(initial()); await flush(); assert.equal(f.exposed.draftTarget(), null);
    assert.match(f.state.error.value, /再読み込み/); assert.equal(f.state.prompt.value, '保持する下書き');
    f.packet({ ...initial(), 会話ID: 'second' }); await flush();
    assert.ok(f.exposed.draftTarget()); assert.equal(f.exposed.insertDraft({ ...target, text: '遅延した要求' }).ok, false);
    assert.equal(f.state.error.value, '');
  }
});

test('Code: SSE切断の復帰・無関係なerror・accepted・モデルエラーは会話切替の確認にならない', async t => {
  const f = await panel(t), click = await f.action('new'); click(); f.disconnect();
  for (const packet of [{ type: 'error', message: '別処理のエラー' }, { type: 'accepted' }, { type: 'modelCatalogError', message: 'モデルエラー' }, initial()]) {
    f.packet(packet); await flush(); assert.equal(f.exposed.draftTarget(), null);
  }
  f.reply(); await flush(); assert.equal(f.exposed.draftTarget(), null);
  f.packet({ ...initial(), 会話ID: 'second' }); await flush(); assert.ok(f.exposed.draftTarget());
});

test('Code: 選択中の履歴を再度開く操作は下書きを維持し、不要な会話変更を送らない', async t => {
  const f = await panel(t), target = f.exposed.draftTarget(), click = await f.action('selectHistory', 'first'); click(); await flush();
  assert.equal(f.sent.length, 0); assert.equal(f.state.prompt.value, '保持する下書き');
  assert.equal(f.exposed.insertDraft({ ...target, text: '同じ会話へ追加' }).ok, true);
});

test('Code: 前のHTTP応答が新しい切替中に失敗しても、新しい要求を解除しない', async t => {
  const f = await panel(t), click = await f.action('new'); click();
  f.packet({ ...initial(), 会話ID: 'second' }); await flush();
  const current = f.exposed.draftTarget(); assert.ok(current);
  click(); f.reply(0, 404); await flush();
  assert.equal(f.exposed.draftTarget(), null); assert.equal(f.state.error.value, '');
  assert.equal(f.exposed.insertDraft({ ...current, text: '古い連携' }).ok, false);
  f.reply(1); f.packet({ ...initial(), 会話ID: 'third' }); await flush();
  assert.ok(f.exposed.draftTarget()); assert.equal(f.state.error.value, '');
});

test('Code: 履歴の要求と違う会話・プロジェクトの状態や破棄後の失敗は受信先を再公開しない', async t => {
  const f = await panel(t, { desktop: true }), click = await f.action('selectHistory'); click();
  for (const packet of [{ ...initial(), 会話ID: 'unrelated' }, { ...initial(), 会話ID: 'second', 作業フォルダ: { 名前: 'other', パス: '/other' } }]) {
    f.packet(packet); await flush(); assert.equal(f.exposed.draftTarget(), null);
  }
  f.dispose(); f.reply(0, 404); await flush();
  assert.equal(f.exposed.draftTarget(), null); assert.equal(f.registrations.at(-1), null); assert.equal(f.state.error.value, '');
});

test('Code: 単独版の明示オフラインからのONだけは新規会話を待ち、VS Codeの再接続を妨げない', async t => {
  for (const host of [false, true]) {
    const f = await panel(t, { host }); f.packet({ ...initial(), 実行モード: 'offline', 自動接続: false }); await flush();
    const target = f.exposed.draftTarget(); void f.state.toggleAuto();
    if (host) { assert.equal(f.exposed.draftTarget().contextId, target.contextId); }
    else {
      assert.equal(f.exposed.draftTarget(), null); f.reply(); await flush(); assert.equal(f.exposed.draftTarget(), null);
      f.packet({ ...initial(), 会話ID: 'online-conversation' }); await flush(); assert.ok(f.exposed.draftTarget());
    }
  }
});

test('Code: 稼働中会話の削除も即時失効し、別履歴の削除は渡し先を変更しない', async t => {
  const f = await panel(t), target = f.exposed.draftTarget();
  void f.state.send('deleteHistory', { id: 'second' }); assert.equal(f.exposed.draftTarget().contextId, target.contextId);
  f.reply(); await flush();
  void f.state.send('deleteHistory', { id: 'first' }); assert.equal(f.exposed.draftTarget(), null);
  assert.equal(f.exposed.insertDraft({ ...target, text: '削除される会話へ' }).ok, false);
  f.reply(1); f.packet({ ...initial(), 会話ID: 'replacement' }); await flush();
  assert.ok(f.exposed.draftTarget());
});

test('Code: 実サーバーのHTTP拒否とSSE会話切替を、生成物を書き換えず接続して確認する', { timeout: 5000 }, async t => {
  const folder = mkdtempSync(join(tmpdir(), 'aidiy-code-transition-'));
  const compiled = buildSync({ entryPoints: [fileURLToPath(new URL('../host/aidiy_code/src/server.ts', import.meta.url))],
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', write: false });
  const serverModule = new Module(join(folder, 'server.cjs'));
  serverModule._compile(compiled.outputFiles[0].text, join(folder, 'server.cjs'));
  const app = await serverModule.exports.単独起動(folder, 'http://127.0.0.1:0', { offline: true, lockedMode: true, provider: 'aidiy_hermes', model: 'same' },
    join(folder, 'model.json'), () => assert.fail('AI実行は禁止'), join(folder, 'histories'));
  let reader;
  t.after(async () => { await reader?.cancel(); await app.close(); rmSync(folder, { recursive: true, force: true }); });
  reader = (await fetch(app.url + 'events')).body.getReader();
  let buffer = ''; const decoder = new TextDecoder();
  async function nextState(predicate = () => true) {
    while (true) {
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (!block.startsWith('data: ')) continue;
        const packet = JSON.parse(block.slice(6)); if (packet.type === 'state' && predicate(packet)) return packet;
      }
      const { value, done } = await reader.read(); assert.equal(done, false); buffer += decoder.decode(value, { stream: true });
    }
  }
  const f = await panel(t), original = await nextState(); f.packet(original); await flush();
  f.state.prompt.value = '保持する下書き'; await flush();
  const target = f.exposed.draftTarget(), missing = f.state.send('selectHistory', { id: 'missing' });
  assert.equal(f.exposed.draftTarget(), null);
  const post = packet => fetch(app.url + 'message', { method: 'POST', headers: { Origin: new URL(app.url).origin, 'Content-Type': 'application/json' }, body: JSON.stringify(packet) });
  const rejected = await post(f.requests[0].packet); assert.equal(rejected.status, 404);
  f.requests[0].resolve(rejected); await missing; await flush();
  assert.ok(f.exposed.draftTarget()); assert.notEqual(f.exposed.draftTarget().contextId, target.contextId);
  assert.equal(f.state.prompt.value, '保持する下書き');
  const click = await f.action('new'), changing = click(); const accepted = await post(f.requests[1].packet); assert.equal(accepted.status, 200);
  f.requests[1].resolve(accepted); await changing; await flush(); assert.equal(f.exposed.draftTarget(), null);
  f.packet(await nextState(packet => packet.会話ID !== original.会話ID)); await flush();
  const current = f.exposed.draftTarget(); assert.ok(current);
  assert.equal(f.exposed.insertDraft({ ...current, text: '実際の新規会話へ' }).ok, true);
  assert.equal(f.state.prompt.value, '実際の新規会話へ');
});
