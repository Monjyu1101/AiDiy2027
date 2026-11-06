/*!
 * -*- coding: utf-8 -*-
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const { build } = require('esbuild');

const fixtureToken = 'fixture-only-not-a-real-token-origin';
const disposable = () => ({ dispose() {} });
const uri = fsPath => ({ scheme: 'file', fsPath, toString: () => `file://${fsPath}` });
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

async function extensionFixture(t, kind) {
  const home = mkdtempSync(join(tmpdir(), 'aidiy-origin-host-'));
  let context;
  t.after(() => {
    for (const item of context?.subscriptions || []) item.dispose();
    rmSync(home, { recursive: true, force: true });
  });
  const root = join(home, 'AiDiy 配置元'), project = join(home, 'unrelated-project');
  const extensionPath = join(home, '.vscode', 'extensions', `aidiy.aidiy-${kind}-0.1.0`);
  for (const dir of [project, extensionPath, join(root, '_config'), join(root, 'backend_server'), join(root, '_AIDIY', 'backend_core')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, '_config', 'AiDiy_key.json'), JSON.stringify({ PORT_CORE: 18097 }));
  writeFileSync(join(root, 'backend_server', 'core_main.py'), '# fixture only\n');
  writeFileSync(join(root, '_AIDIY', 'backend_core', 'internal_auth.json'), JSON.stringify({ token_type: 'bearer', access_token: fixtureToken, expires_at: new Date(Date.now() + 3600000).toISOString() }));
  writeFileSync(join(extensionPath, 'aidiy-installation.json'), JSON.stringify({ version: 1, root }));
  const captures = [], packets = [], opened = [], commands = new Map();
  const folder = { name: 'unrelated-project', uri: uri(project) };
  let provider, receive;
  const vscode = {
    Uri: { joinPath: (base, ...parts) => uri(join(base.fsPath, ...parts)), parse: value => ({ toString: () => value }) },
    workspace: { isTrusted: true, workspaceFolders: [folder], getWorkspaceFolder: () => folder,
      getConfiguration: () => ({ get: (_key, fallback) => fallback }), onDidChangeWorkspaceFolders: disposable },
    window: { onDidChangeActiveTextEditor: disposable,
      registerWebviewViewProvider: (_name, value) => { provider = value; return disposable(); },
      createOutputChannel: () => ({ appendLine: value => assert.fail(value), clear() {}, dispose() {} }),
      showErrorMessage: value => assert.fail(value), showInformationMessage: value => assert.fail(value) },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return disposable(); }, executeCommand: async () => {} },
    env: { openExternal: async value => { opened.push(value.toString()); return true; } },
  };
  // Port/auth/installation resolver と HTML は本物。通信・予測・CLI境界だけを置換する。
  const replacements = [
    [/[/\\]code-connection\.ts$/, `exports.コード選択 = value => ({provider: value.provider || 'codex_cli', model: value.model || 'auto'});
      exports.CodeConnection = class { constructor(...args) { captures.push({kind:'code', backend:args[0], authorization:args[5], instance:this}); }
      connected=false; model={provider:'codex_cli',model:'auto'}; start(project) { this.projectPath=project; } dispose() {} disconnect() {} };`],
    [/[/\\]input-prediction\.ts$/, 'exports.InputPrediction = class { sync() {} clear() {} dispose() {} };'],
    [/[/\\]offline\.ts$/, `exports.オフラインモデル候補=()=>[{id:'same'}]; exports.Hermes既定モデル=()=> 'same';
      exports.オフラインモデル保存先=()=> require('node:path').join(require('node:os').homedir(), 'offline-model.json'); exports.オフライン実行=()=>{throw Error('Unexpected CLI');};`],
    [/aidiy_live[/\\]src[/\\]host\.ts$/, `exports.microphonePython=()=>{throw Error('Unexpected microphone');};
      exports.LiveHost=class { constructor(...args) { captures.push({kind:'live',backend:args[0],authorization:args[4]}); } dispose() {} stop() {} pauseMicrophone() {} };`],
    [/aidiy_live[/\\]src[/\\]server\.ts$/, `exports.ライブ起動=async (...args)=>{captures.push({kind:'browser',backend:args[1],authorization:args[7],project:args[3]}); return {url:'http://127.0.0.1:18098/fixture-browser',close:async()=>{}};};`],
  ];
  const entry = resolve(__dirname, kind === 'code' ? '../src/extension.ts' : '../aidiy_live/src/extension.ts');
  const bundle = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode', 'undici'],
    plugins: [{ name: 'memory-only-transports', setup(builder) {
      for (const [filter, contents] of replacements) builder.onLoad({ filter }, () => ({ contents, loader: 'js' }));
    } }],
  });
  const loaded = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module: loaded, exports: loaded.exports, captures, process, Buffer, URL, AbortController, console, setTimeout, clearTimeout,
    fetch: () => { throw Error('Unexpected network'); },
    require: name => {
      if (name === 'vscode') return vscode;
      if (name === 'node:os') return { ...require(name), homedir: () => home };
      if (name === 'node:child_process') return { spawn() { throw Error('Unexpected external process'); } };
      return require(name);
    },
  });
  context = { extensionPath, extensionUri: uri(extensionPath), subscriptions: [], workspaceState: { get() {}, update: async () => {} }, globalState: { get() {} } };
  loaded.exports.activate(context);
  const view = { visible: true, webview: { cspSource: 'https://webview.test',
    asWebviewUri: value => ({ toString: () => `https://webview.test/${encodeURIComponent(value.fsPath)}` }),
    postMessage: value => { packets.push(value); return Promise.resolve(true); },
    onDidReceiveMessage: callback => { receive = callback; return disposable(); } }, onDidDispose: disposable, onDidChangeVisibility: disposable };
  provider.resolveWebviewView(view);
  return { root, project, captures, packets, opened, commands, view, receive: message => receive(message) };
}
function checkTransport(item) {
  assert.equal(item.backend, 'http://127.0.0.1:18097');
  assert.equal(item.authorization().Authorization, `Bearer ${fixtureToken}`);
}
function checkRenderer(f) {
  const text = f.view.webview.html + JSON.stringify(f.packets) + JSON.stringify(f.opened);
  for (const forbidden of [fixtureToken, f.root, encodeURIComponent(f.root), 'access_token', 'aidiy-installation.json']) assert.ok(!text.includes(forbidden), `renderer leaked ${forbidden}`);
}

test('配置元統合: Code 拡張entryは外部projectから記録元のport/authへ接続し秘密を画面へ渡さない', async t => {
  const f = await extensionFixture(t, 'code');
  f.receive({ type: 'ready' }); await flush();
  assert.equal(f.captures.length, 1);
  assert.equal(f.captures[0].kind, 'code'); checkTransport(f.captures[0]);
  assert.equal(f.captures[0].instance.projectPath, f.project);
  assert.ok(f.packets.some(packet => packet.type === 'state'));
  checkRenderer(f);
});

test('配置元統合: Live webviewとブラウザcommandは同じ記録元を使い秘密を画面へ渡さない', async t => {
  const f = await extensionFixture(t, 'live');
  assert.equal(f.captures.length, 1); assert.equal(f.captures[0].kind, 'live'); checkTransport(f.captures[0]);
  const boot = JSON.parse(f.view.webview.html.match(/id="development-config"[^>]*>(.*?)<\/script>/)[1]);
  assert.equal(boot.live.backend, 'http://127.0.0.1:18097');
  assert.equal(boot.live.作業フォルダ.パス, f.project);
  await f.commands.get('aidiyLive.standalone')();
  assert.equal(f.captures.length, 2); assert.equal(f.captures[1].kind, 'browser'); checkTransport(f.captures[1]);
  assert.equal(f.captures[1].project, f.project);
  assert.deepEqual(f.opened, ['http://127.0.0.1:18098/fixture-browser']);
  checkRenderer(f);
});
