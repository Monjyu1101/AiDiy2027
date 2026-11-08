/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { build } = require('esbuild');
const { runInNewContext } = require('node:vm');

test('Live のタブ切り替え: 同じ接続を保持し、会話と切断通知を復帰時に届ける', async t => {
  const home = mkdtempSync(join(tmpdir(), 'aidiy-live-extension-model-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const extensionPath = join(__dirname, '..');
  const packets = [], sockets = [], timers = new Map();
  let provider, options, receive, visibility, dispose, folderChanged, timerId = 0;
  const resource = fsPath => ({ fsPath, scheme: 'file', toString: () => `https://webview.test/${fsPath}` });
  const disposable = () => ({ dispose() {} });
  const vscode = {
    Uri: { joinPath: (uri, ...parts) => resource(join(uri.fsPath, ...parts)) },
    workspace: {
      isTrusted: true, workspaceFolders: [{ name: 'fixture', uri: resource(home) }],
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      onDidChangeWorkspaceFolders: fn => { folderChanged = fn; return disposable(); }, onDidChangeConfiguration: disposable,
    },
    window: {
      registerWebviewViewProvider: (_id, value, config) => { provider = value; options = config; return disposable(); },
      onDidChangeActiveTextEditor: disposable, showErrorMessage: error => assert.fail(error),
    },
    commands: { registerCommand: disposable },
  };
  class Socket {
    readyState = 1; bufferedAmount = 0; sent = [];
    constructor() { sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.closed = true; this.readyState = 3; this.onclose?.(); }
  }
  const module = { exports: {} };
  // 実配置の認証ファイルは読まず、ホスト境界だけをメモリ内fixtureへ置換する。
  const bundle = await build({ entryPoints: [join(extensionPath, 'src/extension.ts')], bundle: true, write: false,
    platform: 'node', format: 'cjs', external: ['vscode'], plugins: [{ name: 'fixture-auth', setup(builder) {
      builder.onLoad({ filter: /internal-auth\.ts$/ }, () => ({ contents: 'exports.internalAuthorization=()=>()=>({Authorization:"Bearer fixture-only"}); exports.internalSocket=(url)=>new WebSocket(url);', loader: 'js' }));
      builder.onLoad({ filter: /local-backend\.cjs$/ }, () => ({ contents: 'exports.ローカル接続先=()=>"http://127.0.0.1:8091";', loader: 'js' }));
    } }] });
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: name => name === 'vscode' ? vscode : name === 'node:os' ? { homedir: () => home } : require(name),
    WebSocket: Socket, process, Buffer, URL, AbortController, console,
    setTimeout, clearTimeout,
    setInterval: callback => { timers.set(++timerId, callback); return timerId; },
    clearInterval: id => timers.delete(id),
  });
  const context = { extensionPath, extensionUri: resource(extensionPath), subscriptions: [] };
  module.exports.activate(context);
  assert.equal(options.webviewOptions.retainContextWhenHidden, true);
  const view = {
    visible: true,
    webview: {
      cspSource: 'https://webview.test', asWebviewUri: uri => uri,
      postMessage: message => { packets.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: callback => { receive = callback; return disposable(); },
    },
    onDidChangeVisibility: callback => { visibility = callback; return disposable(); },
    onDidDispose: callback => { dispose = callback; return disposable(); },
  };
  provider.resolveWebviewView(view);
  try {
    const settings = { LIVE_AI_NAME: 'freeai_live', LIVE_FREEAI_MODEL: 'saved-model', LIVE_FREEAI_VOICE: 'Zephyr' };
    receive({ type: 'save-model', id: 90, settings });
    assert.deepEqual(JSON.parse(readFileSync(join(home, '_AIDIY/aidiy_live/aidiy_live_model.json'), 'utf8')), settings);
    assert.equal(packets.at(-1).id, 90); assert.equal(packets.at(-1).value.ok, true);
    provider.resolveWebviewView(view);
    const boot = JSON.parse(view.webview.html.match(/id="development-config"[^>]*>(.*?)<\/script>/)[1]);
    assert.deepEqual(boot.live.保存モデル設定, settings);
    receive({ type: 'save-model', id: 91, settings: { ...settings, LIVE_AI_NAME: 'unknown' } });
    assert.ok(packets.at(-1).error);
    assert.deepEqual(JSON.parse(readFileSync(join(home, '_AIDIY/aidiy_live/aidiy_live_model.json'), 'utf8')), settings);
    for (const [index, channel] of ['input', '0', 'audio'].entries()) {
      const id = index + 1;
      receive({ type: 'socket-open', id }); sockets[index].onopen();
      receive({ type: 'socket-send', id, data: JSON.stringify({ type: 'connect', ソケット番号: channel }) });
      sockets[index].onmessage({ data: JSON.stringify({ メッセージ識別: 'init', セッションID: 'same-session' }) });
    }
    receive({ type: 'socket-send', id: 1, data: JSON.stringify({ メッセージ識別: 'operations', メッセージ内容: { ボタン: { マイク: true, スピーカー: false } } }) });
    view.visible = false; visibility();
    assert.ok(sockets.every(socket => !socket.closed));
    assert.equal(sockets[0].sent.at(-1).メッセージ内容.ボタン.マイク, false);
    assert.equal(sockets[0].sent.at(-1).メッセージ内容.ボタン.スピーカー, false);
    for (const tick of timers.values()) tick();
    assert.equal(sockets[0].sent.at(-1).type, 'ping');
    assert.equal(sockets[0].sent.at(-1).セッションID, 'same-session');
    const count = packets.length;
    sockets[1].onmessage({ data: JSON.stringify({ メッセージ識別: 'output_text', メッセージ内容: '非表示中の回答' }) });
    sockets[2].onmessage({ data: JSON.stringify({ メッセージ識別: 'output_audio', ファイル名: 'pcm' }) });
    assert.equal(packets.length, count);
    view.visible = true; visibility();
    assert.ok(sockets.every(socket => !socket.closed));
    assert.ok(packets.some(packet => packet.type === 'mic-paused'));
    assert.ok(packets.some(packet => packet.data?.includes('非表示中の回答')));
    assert.ok(!packets.some(packet => packet.data?.includes('output_audio')));
    receive({ type: 'socket-send', id: 1, data: JSON.stringify({ セッションID: 'same-session', メッセージ識別: 'input_text', メッセージ内容: '続き' }) });
    assert.equal(sockets.length, 3);
    assert.equal(sockets[0].sent.at(-1).セッションID, 'same-session');
    view.visible = false; visibility(); sockets[0].close();
    assert.equal(timers.size, 0);
    view.visible = true; visibility();
    assert.ok(packets.some(packet => packet.type === 'socket-closed' && packet.id === 1));
    const oldReceive = receive, oldSockets = sockets.length;
    vscode.workspace.workspaceFolders = []; folderChanged();
    assert.ok(sockets.every(socket => socket.closed));
    receive({ type: 'socket-open', id: 200 });
    receive({ type: 'api', id: 201, path: 'core/AIコア/モデル情報/取得' });
    receive({ type: 'save-model', id: 202, settings: { ...settings, LIVE_AI_NAME: 'gemini_live' } });
    assert.equal(sockets.length, oldSockets);
    assert.match(packets.at(-1).error, /フォルダ/);
    assert.deepEqual(JSON.parse(readFileSync(join(home, '_AIDIY/aidiy_live/aidiy_live_model.json'), 'utf8')), settings);
    const empty = JSON.parse(view.webview.html.match(/id="development-config"[^>]*>(.*?)<\/script>/)[1]);
    assert.equal(empty.live.作業フォルダ, null);
    vscode.workspace.workspaceFolders = [{ name: 'second', uri: resource(extensionPath) }]; folderChanged();
    const reopened = JSON.parse(view.webview.html.match(/id="development-config"[^>]*>(.*?)<\/script>/)[1]);
    assert.equal(reopened.live.作業フォルダ.パス, extensionPath);
    oldReceive({ type: 'socket-open', id: 203 });
    assert.equal(sockets.length, oldSockets, '古いWebviewからの要求は再利用しない');
    receive({ type: 'socket-open', id: 204 });
    assert.equal(sockets.length, oldSockets + 1);

  } finally { dispose(); context.subscriptions[0].dispose(); }
  assert.ok(sockets.every(socket => socket.closed));
  assert.equal(timers.size, 0);
});
