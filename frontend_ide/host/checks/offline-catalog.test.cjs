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
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');

const host = resolve(__dirname, '..');
const oldModel = 'openai_oauth/gpt-6.1-sol';
const newModel = 'openai_oauth/gpt-6-astra';
const onlinePreference = JSON.stringify({ provider: 'codex_cli', model: 'auto' }) + '\n';
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

// 配布先の階層まで一時フォルダに置き、リポジトリの診断JSON・実際のホームを読まない。
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aidiy-offline-catalog-'));
  const project = join(root, 'project'), extensionPath = join(root, 'installation', 'frontend_ide', 'host');
  const home = join(root, 'home'), modelFile = join(project, '_AIDIY', 'aidiy_code', 'aidiy_code_model.json');
  mkdirSync(project, { recursive: true }); mkdirSync(extensionPath, { recursive: true });
  mkdirSync(dirname(modelFile), { recursive: true }); writeFileSync(modelFile, onlinePreference);
  const catalogFile = join(project, '_AIDIY', 'aidiy_diag', 'code_models_info.json');
  const write = value => { mkdirSync(dirname(catalogFile), { recursive: true }); writeFileSync(catalogFile, value); };
  const cleanup = [];
  let executions = 0;
  const noExecution = () => { executions++; throw new Error('このテストではAI・CLIを実行しません。'); };
  const overrides = {
    'node:os': { ...require('node:os'), homedir: () => home },
    'node:child_process': { ...require('node:child_process'), spawn: noExecution, spawnSync: noExecution, exec: noExecution, execFile: noExecution, execFileSync: noExecution },
  };
  const bundle = (entry, filename, extra = {}) => {
    const result = buildSync({ entryPoints: [join(host, entry)], bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['vscode'], write: false });
    const loaded = new Module(filename, module); loaded.filename = filename; loaded.paths = module.paths;
    const dependencies = { ...overrides, ...extra };
    loaded.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name);
    loaded._compile(result.outputFiles[0].text, filename);
    return loaded.exports;
  };
  t.after(async () => {
    try { for (const close of cleanup.reverse()) await close(); assert.equal(executions, 0, 'モデル選択はAI・CLIを実行しない'); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
  return { root, project, extensionPath, modelFile, bundle, noExecution, onClose: close => cleanup.push(close),
    models: models => write('\uFEFF' + JSON.stringify({ aidiy_hermes: { models } })),
    malformed: () => write('{broken'),
    saved: () => JSON.parse(readFileSync(modelFile.replace(/\.json$/, '_offline.json'), 'utf8')),
    onlineUnchanged: () => assert.equal(readFileSync(modelFile, 'utf8'), onlinePreference),
  };
}

async function server(t, f) {
  const { 単独起動 } = f.bundle('aidiy_code/src/server.ts', join(f.extensionPath, 'out', 'aidiy_code', 'server.cjs'));
  const app = await 単独起動(f.project, 'http://127.0.0.1:1', { offline: true }, f.modelFile, f.noExecution, join(f.root, 'histories'));
  f.onClose(() => app.close());
  return {
    catalog: async () => { const response = await fetch(app.url + 'catalog?provider=aidiy_hermes'); return { status: response.status, ...await response.json() }; },
    choose: async model => { const response = await fetch(app.url + 'message', { method: 'POST', headers: { Origin: new URL(app.url).origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'model', provider: 'aidiy_hermes', model }) }); return { status: response.status, ...await response.json() }; },
  };
}

test('Code 単独: 起動後の診断生成・更新を再読込し、確定時も最新候補を検証する', async t => {
  const f = fixture(t), app = await server(t, f);
  assert.deepEqual((await app.catalog()).models.map(item => item.id), ['same']);
  f.models({ [oldModel]: '2026/10/20 - gpt-6.1-sol', 'copilot_cli/auto': 'Copilot 自動' });
  assert.deepEqual((await app.catalog()).models, [{ id: 'same', label: 'same (変更なし)' }, { id: oldModel, label: '2026/10/20 - gpt-6.1-sol' }, { id: 'copilot_cli/auto', label: 'Copilot 自動' }]);
  assert.equal((await app.choose(oldModel)).status, 200);
  assert.deepEqual(f.saved(), { provider: 'aidiy_hermes', model: oldModel });
  // ダイアログを開いた後で診断結果が変わっても、削除済みIDは保存しない。
  f.models({ [newModel]: 'GPT 6 Astra' });
  assert.equal((await app.choose(oldModel)).status, 400);
  assert.equal((await app.choose('openai_oauth/not-in-catalog')).status, 400);
  assert.deepEqual(f.saved(), { provider: 'aidiy_hermes', model: oldModel });
  // 再度一覧を開かなくても、新しく追加されたIDは確定時に読める。
  assert.equal((await app.choose(newModel)).status, 200);
  assert.deepEqual(f.saved(), { provider: 'aidiy_hermes', model: newModel });
  assert.deepEqual((await app.catalog()).models.map(item => item.id), ['same', newModel]);
  f.onlineUnchanged();
});

test('Code 単独: 診断JSONの破損を通知し、修復後は再起動せず再選択できる', async t => {
  const f = fixture(t); f.models({ [oldModel]: 'GPT 6.1 Sol' });
  const app = await server(t, f);
  assert.equal((await app.choose(oldModel)).status, 200);
  f.malformed();
  const catalog = await app.catalog(); assert.equal(catalog.status, 500); assert.match(catalog.error, /モデル情報/);
  assert.equal((await app.choose(oldModel)).status, 500);
  assert.deepEqual(f.saved(), { provider: 'aidiy_hermes', model: oldModel });
  f.models({ [newModel]: 'GPT 6 Astra' });
  assert.deepEqual((await app.catalog()).models.map(item => item.id), ['same', newModel]);
  assert.equal((await app.choose(newModel)).status, 200);
  assert.deepEqual(f.saved(), { provider: 'aidiy_hermes', model: newModel });
  f.onlineUnchanged();
});

function extension(t, f) {
  const subscription = { dispose() {} }, posts = [];
  const uri = { scheme: 'file', fsPath: f.project, toString: () => `file://${f.project}` }, folder = { uri, name: 'project' };
  let provider, receive;
  const vscode = {
    workspace: { isTrusted: true, workspaceFolders: [folder], getConfiguration: () => ({ get: (_key, fallback) => fallback }), getWorkspaceFolder: () => folder, onDidChangeWorkspaceFolders: () => subscription },
    window: { onDidChangeActiveTextEditor: () => subscription, createOutputChannel: () => ({ appendLine() {}, dispose() {} }), registerWebviewViewProvider: (_id, object) => { provider = object; return subscription; } },
    Uri: { joinPath: (uri, path) => ({ fsPath: join(uri.fsPath, path), toString() { return this.fsPath; } }) },
    commands: { registerCommand: () => subscription },
  };
  const context = { extensionPath: f.extensionPath, extensionUri: { fsPath: f.extensionPath }, subscriptions: [], workspaceState: { get() {}, update: async () => {} }, globalState: { get() {}, update: async () => {} } };
  const loaded = f.bundle('src/extension.ts', join(f.extensionPath, 'out', 'extension.cjs'), { vscode });
  loaded.activate(context);
  provider.resolveWebviewView({ visible: true, webview: { options: {}, cspSource: 'self', asWebviewUri: uri => uri,
    postMessage: async packet => { posts.push(JSON.parse(JSON.stringify(packet))); }, onDidReceiveMessage: callback => { receive = callback; return subscription; } },
    onDidDispose: () => subscription, onDidChangeVisibility: () => subscription });
  // AIコアへの接続を開始せず、実際の拡張メッセージ入口とファイル読込・保存だけを使う。
  receive({ type: 'autoConnect', enabled: false });
  f.onClose(() => { try { assert.equal(provider.connection, undefined, 'AIコアへの接続を作成しない'); } finally { provider.dispose(); } });
  return {
    catalog: async () => { const before = posts.length; receive({ type: 'chooseModel', provider: 'aidiy_hermes' }); await flush(); return posts.slice(before).findLast(packet => ['modelCatalog', 'modelCatalogError'].includes(packet.type)); },
    choose: async model => { receive({ type: 'setModel', provider: 'aidiy_hermes', model }); await flush(); return posts.findLast(packet => packet.type === 'state'); },
  };
}

test('Code 拡張: 起動後の候補生成・削除・破損・修復を反映し、オンライン保存値を維持する', async t => {
  const f = fixture(t), app = extension(t, f);
  assert.deepEqual((await app.catalog()).items.map(item => item.id), ['same']);
  f.models({ [oldModel]: '2026/10/20 - gpt-6.1-sol' });
  assert.deepEqual((await app.catalog()).items, [{ id: 'same', label: 'same (変更なし)' }, { id: oldModel, label: '2026/10/20 - gpt-6.1-sol' }]);
  assert.equal((await app.choose(oldModel)).model, oldModel);
  assert.deepEqual(f.saved(), { provider: 'aidiy_hermes', model: oldModel });
  f.models({ [newModel]: 'GPT 6 Astra' });
  for (const model of [oldModel, 'openai_oauth/not-in-catalog']) {
    const state = await app.choose(model); assert.match(state.メッセージ.at(-1).本文, /モデルを選択/);
    assert.deepEqual(f.saved(), { provider: 'aidiy_hermes', model: oldModel });
  }
  assert.equal((await app.choose(newModel)).model, newModel);
  f.malformed();
  const failed = await app.catalog(); assert.equal(failed.type, 'modelCatalogError'); assert.match(failed.message, /モデル情報/);
  assert.match((await app.choose(newModel)).メッセージ.at(-1).本文, /モデル情報/);
  assert.deepEqual(f.saved(), { provider: 'aidiy_hermes', model: newModel });
  f.models({ [oldModel]: '修復後の候補' });
  assert.deepEqual((await app.catalog()).items.map(item => item.id), ['same', oldModel]);
  assert.equal((await app.choose(oldModel)).model, oldModel);
  assert.deepEqual(f.saved(), { provider: 'aidiy_hermes', model: oldModel });
  f.onlineUnchanged();
});
