/*!
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { runInNewContext } = require('node:vm');
const { transformSync } = require('esbuild');
const { core } = require('./fake-core.cjs');
const root = resolve(__dirname, '..');
const flush = async () => { for (let n = 0; n < 24; n++) await Promise.resolve(); };
const noNetwork = () => { throw new Error('実通信は禁止'); };
function load(file, dependencies = {}, globals = {}) {
  const module = { exports: {} }, path = resolve(root, file);
  runInNewContext(transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, __dirname: dirname(path), URL, AbortController, AbortSignal, DOMException,
    fetch: noNetwork, setTimeout, clearTimeout, setInterval, clearInterval,
    require(id) {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      if (['node:path', 'node:crypto'].includes(id)) return require(id);
      assert.fail(`許可していない依存: ${id}`);
    }, ...globals,
  });
  return module.exports;
}
const fixtureHeaders = { Authorization: 'Bearer prediction-fixture-only-token' };
function authFixture(authorization = () => ({ ...fixtureHeaders })) {
  return {
    internalAuthorization: target => {
      assert.equal(target.origin, 'http://127.0.0.1:18091');
      return authorization;
    },
    internalSocket: noNetwork,
  };
}
function connection(settings = {}, authorization) {
  const backend = core(settings);
  const { CodeConnection } = load('src/code-connection.ts', {
    './internal-auth': authFixture(authorization),
    '../aidiy_live/src/host': { backendUrl: value => new URL(value) },
    '../aidiy_live/src/connection-error': { 接続エラー詳細: (_target, error) => String(error) },
  });
  const client = new CodeConnection('http://127.0.0.1:18091', () => {}, () => {}, (url, headers) => {
    assert.equal(headers.Authorization, fixtureHeaders.Authorization);
    return new backend.Socket(url);
  }, (url, options) => {
    assert.equal(options.headers.Authorization, fixtureHeaders.Authorization);
    assert.equal(options.redirect, 'error');
    return backend.request(url, options);
  });
  return { client, backend };
}
test('予測の接続パスはセッションのモデル情報だけを使い、起動フォルダや共通候補へ戻さない', async () => {
  const { client, backend } = connection({ CODE_BASE_PATH: '/session-project' });
  try {
    assert.equal(client.projectPath, '');
    client.start('/selected-folder', { provider: '', model: '' });
    assert.equal(client.projectPath, '', '両ソケットの接続完了前は未確定');
    await flush();
    assert.equal(client.connected, true);
    assert.equal(client.projectPath, '/session-project');
    assert.equal(backend.requests[0].body.セッションID, client.session);
    await client.catalog();
    assert.equal(client.projectPath, '/session-project', '共通設定取得は接続中のパスを上書きしない');
    client.disconnect();
    assert.equal(client.projectPath, '', '切断では旧セッションのパスを公開しない');
  } finally { client.dispose(); }
});
test('内部認証が失敗したら予測の接続スコープを公開せず通信しない', async () => {
  const { client, backend } = connection({}, () => { throw new Error('fixture auth unavailable'); });
  try {
    client.start('/launch-folder', { provider: '', model: '' });
    await flush();
    assert.equal(client.connected, false);
    assert.equal(client.projectPath, '');
    assert.equal(backend.sockets.length, 0);
    assert.equal(backend.requests.length, 0);
    assert.match(client.error, /fixture auth unavailable/);
  } finally { client.dispose(); }
});
for (const path of [undefined, '', '../relative', 'invalid\0path']) test(`パス未確定・不正値は補完しない: ${JSON.stringify(path)}`, async () => {
  const { client } = connection({ CODE_BASE_PATH: path });
  try { client.start('/launch-folder', { provider: '', model: '' }); await flush(); assert.equal(client.connected, true); assert.equal(client.projectPath, ''); }
  finally { client.dispose(); }
});
test('セッション変更中の旧モデル情報応答は新セッションのパスに採用しない', async () => {
  const { client, backend } = connection({ CODE_BASE_PATH: '/new-session' });
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  client.request = async (url, options) => JSON.parse(options.body).セッションID === 'old' ? pending : backend.request(url, options);
  try {
    client.start('/old-launch', { provider: '', model: '' }, 'old'); await flush();
    client.start('/new-launch', { provider: '', model: '' }, 'new'); await flush();
    assert.equal(client.projectPath, '/new-session');
    finish({ ok: true, json: async () => ({ status: 'OK', data: { モデル設定: { CODE_BASE_PATH: '/stale' } } }) });
    await flush();
    assert.equal(client.projectPath, '/new-session');
  } finally { client.dispose(); }
});
test('モデル設定APIがdataを返さなくても接続パスを失わない', async () => {
  const { client, backend } = connection({ CODE_BASE_PATH: '/session-project' });
  client.request = (url, options) => decodeURI(new URL(url).pathname).endsWith('/設定')
    ? Promise.resolve({ ok: true, json: async () => ({ status: 'OK' }) }) : backend.request(url, options);
  try { client.start('/selected-folder', { provider: 'codex_cli', model: 'auto' }); await flush(); assert.equal(client.connected, true); assert.equal(client.projectPath, '/session-project'); }
  finally { client.dispose(); }
});
const { InputPrediction } = load('src/input-prediction.ts', {
  '../aidiy_live/local-backend.cjs': { ローカルTools接続先: () => 'http://127.0.0.1:18095' },
});
const ok = value => ({ ok: true, json: async () => value });
const health = () => ok({ status: 'ok', name: 'aidiy_code_agents' });
function predictionFixture(request) {
  const context = { projectPath: '/session-project', conversationId: 'conversation', sessionId: 'session', enabled: true }, calls = [];
  const instance = new InputPrediction('/unused-root', () => context, async (url, options) => {
    calls.push({ url, options });
    return request ? request(url, options) : calls.length === 1 ? health() : ok({ status: 'OK', result: '候補' });
  });
  return { context, calls, instance, data: { requestId: 'prediction-1', projectPath: context.projectPath, conversationId: context.conversationId, sessionId: context.sessionId } };
}
test('画面が一致した接続パスだけを履歴取得へ送る', async () => {
  const f = predictionFixture();
  assert.equal((await f.instance.predict({ ...f.data, url: 'http://not-allowed' })).text, '候補');
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { project_path: '/session-project', timeout_sec: 120 });
});
for (const field of ['projectPath', 'sessionId', 'conversationId']) test(`古い画面の${field}では通信しない`, async () => {
  const f = predictionFixture();
  assert.equal((await f.instance.predict({ ...f.data, [field]: 'stale' })).text, '');
  assert.equal(f.calls.length, 0);
});
for (const field of ['projectPath', 'sessionId', 'conversationId']) for (const stage of ['ping', 'prediction']) test(`${stage}中の${field}変更では旧結果を破棄する`, async () => {
  let finish, count = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = predictionFixture(() => ++count === (stage === 'ping' ? 1 : 2) ? pending : health());
  const result = f.instance.predict(f.data); await flush();
  f.context[field] = 'changed'; f.instance.sync();
  assert.equal(f.calls.at(-1).options.signal.aborted, true);
  finish(stage === 'ping' ? health() : ok({ status: 'OK', result: '旧結果' }));
  assert.equal((await result).text, '');
});

// ホスト全体もソースから読み、ファイル・設定・HTTP・接続をすべて試験用に置き換える。
function hostMocks() {
  let connection, prediction, handler;
  const noop = () => {}, store = { 会話保存先: noop, 会話一覧: () => [], 会話書込: noop, 会話本文上限: 100000, 履歴メッセージ長さ: item => item.本文.length };
  class Connection {
    connected = false; session = ''; projectPath = ''; model = { provider: 'codex_cli', model: 'auto' };
    constructor(_url, _packet, state, _socket, _request, authorization) {
      connection = this; this.notify = state;
      assert.equal(authorization().Authorization, fixtureHeaders.Authorization);
    }
    start() { this.connected = true; this.session = 'connected-session'; this.projectPath = '/connected-project'; this.notify(); }
    disconnect() { this.connected = false; this.projectPath = ''; this.notify(); }
    dispose() { this.disconnect(); }
  }
  class Prediction { constructor(_root, context) { prediction = this; this.context = context; } sync() {} clear() {} }
  const models = { コードモデル読込: noop, コードモデル保存: value => value, モデル保存先: () => 'mock-model', コード設定保存先: () => 'mock-options', 検証回数読込: noop };
  const offline = { Hermes既定モデル: () => 'same', オフラインモデル候補: () => [{ id: 'same' }], オフラインモデル保存先: () => 'mock-offline' };
  const common = { 'internal-auth': authFixture(), 'file-attachments': require('../out/file-attachments.cjs'), 'code-connection': { CodeConnection: Connection, コード選択: value => ({ provider: value.provider, model: value.model }) }, 'input-prediction': { InputPrediction: Prediction },
    'model-preferences': models, 'conversation-store': store, 'local-backend.cjs': { ローカル接続先: () => 'http://127.0.0.1:18091' }, protocol: {}, offline };
  const deps = {};
  for (const prefix of ['./', '../../src/']) for (const [name, value] of Object.entries(common)) deps[prefix + name] = value;
  deps['../aidiy_live/local-backend.cjs'] = deps['../../aidiy_live/local-backend.cjs'] = common['local-backend.cjs'];
  deps['../aidiy_code/src/offline'] = offline;
  deps['node:fs'] = { statSync: () => ({ isDirectory: () => true }) };
  deps['node:http'] = { createServer: fn => { handler = fn; return { once: noop, listen: (_port, _host, ready) => ready(), address: () => ({ port: 18090 }), closeAllConnections: noop, close: fn => fn() }; } };
  deps['../../src/forwarded-origin'] = { 接続元許可: class { host() { return true; } origin() { return true; } 公開URL(path) { return `http://127.0.0.1:18090${path}`; } } };
  return { deps, get connection() { return connection; }, get prediction() { return prediction; }, get handler() { return handler; } };
}
for (const lockedMode of [false, true]) test(`${lockedMode ? 'IDE' : '単独版'}の予測は起動フォルダではなく接続中のパス・セッションを使う`, async () => {
  const f = hostMocks(), { 単独起動 } = load('aidiy_code/src/server.ts', f.deps, { setInterval: () => 0, clearInterval() {} });
  const app = await 単独起動('/launch-project', undefined, { lockedMode }, 'mock-model');
  const packets = [], res = { setHeader() {}, writeHead() {}, write(text) { if (text.startsWith('data: ')) packets.push(JSON.parse(text.slice(6))); }, on() {}, end() {} };
  try {
    assert.equal(f.prediction.context().projectPath, '');
    await f.handler({ headers: { host: '127.0.0.1:18090' }, url: new URL(app.url).pathname + 'events', method: 'GET' }, res);
    assert.equal(f.prediction.context().projectPath, '/connected-project');
    assert.equal(f.prediction.context().sessionId, 'connected-session');
    assert.equal(packets.at(-1).接続プロジェクトパス, '/connected-project');
    f.connection.disconnect();
    assert.equal(f.prediction.context().enabled, false); assert.equal(packets.at(-1).接続プロジェクトパス, '');
  } finally { await app.close(); }
});
test('VS Codeの予測は表示フォルダや保存セッションではなく接続中のスコープを使う', () => {
  const f = hostMocks(), subscription = { dispose() {} }, posts = [], noop = () => {};
  let provider;
  const uri = { scheme: 'file', fsPath: '/display-project', toString: () => 'file:///display-project' }, folder = { uri, name: 'display' };
  f.deps.vscode = { workspace: { isTrusted: true, workspaceFolders: [folder], getConfiguration: () => ({ get: (_key, fallback) => fallback }), getWorkspaceFolder: () => folder, onDidChangeWorkspaceFolders: () => subscription },
    window: { onDidChangeActiveTextEditor: () => subscription, createOutputChannel: () => ({ appendLine: noop, dispose: noop }), registerWebviewViewProvider: (_id, value) => { provider = value; return subscription; } }, commands: { registerCommand: () => subscription },
    Uri: { joinPath: (_uri, path) => ({ fsPath: path }) } };
  f.deps['./vscode-html'] = { developmentHtml: () => '' }; f.deps['./runner'] = {};
  const { activate } = load('src/extension.ts', f.deps);
  activate({ extensionPath: '/unused', extensionUri: uri, subscriptions: [], workspaceState: { get: noop, update: async () => {} }, globalState: { get: noop } });
  provider.resolveWebviewView({ webview: { asWebviewUri: uri => uri.fsPath, onDidReceiveMessage: noop, postMessage: packet => posts.push(packet) }, onDidDispose: noop, onDidChangeVisibility: noop });
  try {
    provider.接続更新();
    provider.会話.コアセッションID = 'stale-saved-session';
    assert.equal(f.prediction.context().projectPath, '/connected-project');
    assert.equal(f.prediction.context().sessionId, 'connected-session');
    assert.equal(posts.at(-1).接続プロジェクトパス, '/connected-project');
    f.connection.disconnect(); assert.equal(f.prediction.context().enabled, false);
  } finally { provider.dispose(); }
});
