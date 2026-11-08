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
const { runInNewContext } = require('node:vm');
const { mkdtempSync, readFileSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { transformSync } = require('esbuild');
const { core } = require('./fake-core.cjs');
const flush = async () => { for (let i=0;i<8;i++) await new Promise(resolve=>setImmediate(resolve)); };

test('Code 拡張: 本文上限の日本語履歴をプロジェクトだけに保存し、再起動後も全文を復元する', async t => {
  const project = mkdtempSync(join(tmpdir(), 'aidiy-code-extension-history-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const store = require('../out/conversation-store.cjs');
  const uri = { scheme: 'file', fsPath: project, toString: () => `file://${project}` }, folder = { uri, name: 'project' };
  const messages = [{ 種別: 'user', 本文: '長文' }, { 種別: 'assistant', 本文: 'あ'.repeat(store.会話本文上限 - 2) }];
  const saved = new Map([['会話', { メッセージ: messages, 作業URI: uri.toString(), provider: 'aidiy_hermes', model: 'same', コアセッションID: 'long-japanese-session' }]]);
  const context = { extensionPath: project, subscriptions: [], workspaceState: {
    get: () => { throw Error('旧workspaceState読込禁止'); }, update: () => { throw Error('workspaceState書込禁止'); },
  }, globalState: { get() {} } };
  const errors = [], subscription = { dispose() {} };
  let provider;
  const vscode = {
    workspace: { isTrusted: true, workspaceFolders: [folder], getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      getWorkspaceFolder: () => folder, onDidChangeWorkspaceFolders: () => subscription },
    window: { onDidChangeActiveTextEditor: () => subscription,
      createOutputChannel: () => ({ appendLine: message => errors.push(message), dispose() {} }),
      registerWebviewViewProvider: (_id, object) => { provider = object; return subscription; } },
    commands: { registerCommand: () => subscription },
  };
  const loaded = { exports: {} };
  runInNewContext(transformSync(readFileSync('src/extension.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module: loaded, exports: loaded.exports, setTimeout, clearTimeout, console, URL,
    require(name) {
      if (name === './workspace-folder') return { usableFolder: folder => folder?.uri.scheme === 'file', folderRequired: '先にプロジェクトフォルダを開いてください' };
      if (name === './extension-installation') return { extensionCoreConnection: () => ({ backend: 'http://127.0.0.1:18091', authorization: () => ({}) }) };
      if (name === './file-attachments') return require('../out/file-attachments.cjs');
      if (name === 'vscode') return vscode;
      if (name === './conversation-store') return store;
      if (name === './input-prediction') return require('../out/input-prediction.cjs');
      if (name === './code-connection') return { CodeConnection: class { start() {} dispose() {} }, コード選択: value => ({ provider: value.provider, model: value.model }) };
      if (name === './model-preferences') return { モデル保存先: () => 'model.json', コードモデル読込() {}, コード設定保存先: () => 'options.json', 検証回数読込() {} };
      if (name === '../aidiy_code/src/offline') return { オフラインモデル候補: () => [{ id: 'same' }], Hermes既定モデル: () => 'same', オフラインモデル保存先: () => 'offline.json' };
      if (name.endsWith('/vscode-html') || name === './runner' || name === './protocol' || name.endsWith('/local-backend.cjs')) return {};
      return require(name);
    },
  });
  loaded.exports.activate(context);
  assert.equal(provider.会話.メッセージ.length,0,'旧履歴を自動移行しない');
  provider.会話 = saved.get('会話');provider.保存();
  provider.dispose(); // 終了時に保留中の履歴をファイルへ書き出す。
  await flush();
  const id = store.会話選択読込(store.会話保存先(project));
  const path = join(store.会話保存先(project), `${id}.json`);
  assert.ok(statSync(path).size > 4 * 1024 * 1024);
  saved.delete('会話');
  loaded.exports.activate(context);
  try {
    assert.equal(provider.会話ID, id);
    assert.deepEqual(JSON.parse(JSON.stringify(provider.会話.メッセージ)), messages);
    assert.equal(provider.会話.コアセッションID, 'long-japanese-session');
    assert.deepEqual(errors, []);
  } finally { provider.dispose(); }
});

test('Code 拡張: 接続状態ごとのモデル保存・復元、Hermes実行、再接続中の維持と停止', async t => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const backend = core(); backend.install(t);
  const posts = [], saved = [], context = { extensionPath: process.cwd(), extensionUri: {fsPath:process.cwd()}, subscriptions:[],
    workspaceState:{get(){},update(key,value){saved.push(value);return Promise.resolve();}}, globalState:{get(){},update(){return Promise.resolve();}} };
  const uri = { scheme:'file',fsPath:'/project',toString:()=> 'file:///project' }, folder = {uri,name:'project'};
  let provider, receive, disposed, visibility, selected, folderChanged;
  const preferences = new Map([['online.json', {provider:'codex_cli',model:'auto'}],
    ['online_offline.json', {provider:'aidiy_hermes',model:'openai_oauth/gpt-6.1-sol'}]]);
  const runs = [];
  const subscription = {dispose(){}};
  const vscode = { workspace:{isTrusted:true,workspaceFolders:[],getConfiguration:()=>({get:(_key,fallback)=>fallback}),
    getWorkspaceFolder:()=>folder,onDidChangeWorkspaceFolders:fn=>{folderChanged=fn;return subscription;}},
    window:{activeTextEditor:undefined,onDidChangeActiveTextEditor:()=>subscription,
      createOutputChannel:()=>({appendLine(){},clear(){},dispose(){}}),registerWebviewViewProvider(_id,object){provider=object;return subscription;}},
    Uri:{joinPath:(_uri,path)=>({fsPath:path})},commands:{registerCommand:()=>subscription,executeCommand:async()=>{}},
  };
  const loaded = {exports:{}};
  runInNewContext(transformSync(readFileSync('src/extension.ts','utf8'),{loader:'ts',format:'cjs'}).code,{
    exports:loaded.exports,module:loaded,require(name){
      if (name === './workspace-folder') return { usableFolder: folder => folder?.uri.scheme === 'file', folderRequired: '先にプロジェクトフォルダを開いてください' };
      if (name === './extension-installation') return { extensionCoreConnection: () => ({ backend: 'http://127.0.0.1:18091', authorization: () => ({}) }) };
      if(name.endsWith('/vscode-html')) { const m={exports:{}}; runInNewContext(transformSync(readFileSync(require('node:path').resolve(__dirname, '../src/vscode-html.ts'),'utf8'),{loader:'ts',format:'cjs'}).code,{module:m,exports:m.exports}); return m.exports; }
      if(name==='./file-attachments') return require('../out/file-attachments.cjs');
      if(name==='vscode') return vscode;
      if(name==='./code-connection') { const actual = require('../out/code-connection.cjs'); return { ...actual, CodeConnection: class extends actual.CodeConnection { constructor(...args) { args[3] = url => new global.WebSocket(url); super(...args); } } }; }
      if(name==='./input-prediction') return require('../out/input-prediction.cjs');
      if(name==='./model-preferences') return {
        モデル保存先:()=> 'online.json', コードモデル読込:(file='online.json')=>preferences.get(file),
        コードモデル保存:(value,file='online.json')=>{ selected=JSON.parse(JSON.stringify(value));preferences.set(file,selected);return selected; },
        コード設定保存先:()=> 'options.json', 検証回数読込:file=>preferences.get(file)?.検証回数,
        検証回数保存:(count,file)=>{ if(![0,1,2,3].includes(count)) throw new Error('検証回数の指定が不正です。'); preferences.set(file,{検証回数:count}); return count; },
      };
      if(name==='./conversation-store') return {...require('../out/conversation-store.cjs'),会話保存先:()=>undefined,会話一覧:()=>[],会話書込(){},会話削除(){}};
      if(name==='./runner') return {起動解決:()=>({実行ファイル:'fake-hermes',引数:[]})};
      if(name==='../aidiy_code/src/offline') return {
        ...require('../out/offline.cjs'),Hermes既定モデル:()=> 'openai_oauth/gpt-6-astra',
        // この試験は選択・保存を検証する。利用者のDiag保存済み候補に依存させない。
        オフラインモデル候補:()=>[{id:'same',label:'変更なし'},{id:'openai_oauth/gpt-6.1-sol',label:'fixture Sol'},{id:'copilot_cli/auto',label:'fixture Copilot'}],
        オフライン実行(root,project,model,text,session,receive,launch) {
          let finish;
          const run={root,project,model,text,session,launch,receive,stops:0,
            完了:new Promise(resolve=>{finish=resolve;}),停止(){run.stops++;},finish(result={終了コード:0,セッションID:'hermes-only'}){finish(result);}};
          runs.push(run);receive({メッセージ識別:'output_stream',メッセージ内容:'\x02'});return run;
        }
      };
      if(name==='./protocol') return require('../out/protocol.cjs');
      if(name==='../aidiy_live/local-backend.cjs') return {ローカル接続先:()=> 'http://127.0.0.1:18091'};
      return require(name);
    },setTimeout,clearTimeout,console,URL,
  });
  loaded.exports.activate(context);
  const view = {visible:true,webview:{options:{},cspSource:'self',asWebviewUri:uri=>uri.fsPath,
    postMessage(packet){posts.push(JSON.parse(JSON.stringify(packet)));return Promise.resolve();},
    onDidReceiveMessage(callback){receive=callback;return subscription;}},
    onDidDispose(callback){disposed=callback;return subscription;}, onDidChangeVisibility(callback){visibility=callback;return subscription;}};
  provider.resolveWebviewView(view);
  try {
    visibility();
    let latest = () => posts.findLast(p=>p.type==='state');
    assert.equal(latest().provider,'aidiy_hermes');assert.equal(latest().model,'same');
    assert.equal(latest().実行モード,'offline');assert.equal(latest().オフライン対応,true);
    // 画面（Vue）が送るメッセージを直接送り、拡張が返す状態を確認する。
    receive({type:'chooseModel',provider:''});await flush();
    assert.equal(posts.findLast(p=>p.type==='modelCatalog'),undefined);
    assert.match(posts.at(-1).message,/フォルダ/);
    receive({type:'setModel',provider:'aidiy_hermes',model:'same'});await flush();
    assert.equal(latest().model,'same');
    // 作業フォルダを開くと、接続失敗・再試行中も入力とモデル選択を許可する。
    vscode.workspace.workspaceFolders=[folder];backend.unavailable=true;
    receive({type:'ready'});await flush();
    assert.match(String(latest().接続エラー),/接続できません/);
    assert.equal(latest().実行モード,'offline');
    receive({type:'connect'});
    await flush();
    receive({type:'setModel',provider:'aidiy_hermes',model:'openai_oauth/gpt-6.1-sol'});await flush();
    backend.unavailable=false;
    receive({type:'connect'});await flush();
    assert.equal(latest().接続エラー || '','');
    receive({type:'ready'});await flush();
    assert.ok(posts.some(p=>p.type==='state' && p.接続中 && !p.接続済み));
    assert.equal(posts.findLast(p=>p.type==='state').接続済み,true);
    assert.equal(latest().provider,'codex_cli');assert.equal(latest().model,'auto');
    assert.equal(latest().自動接続,true);
    const sessionBeforeToggle = latest().コアセッションID;
    const conversationBeforeToggle = latest().会話ID;
    receive({type:'autoConnect',enabled:false});await flush();
    assert.equal(latest().自動接続,false);assert.equal(latest().接続済み,false);
    assert.ok(backend.sockets.every(socket=>socket.readyState===3));
    const socketCount = backend.sockets.length;
    receive({type:'ready'});await flush();
    receive({type:'new'});await flush();
    receive({type:'selectHistory',id:conversationBeforeToggle});await flush();
    assert.equal(latest().会話ID,conversationBeforeToggle);
    assert.equal(backend.sockets.length,socketCount);
    receive({type:'autoConnect',enabled:true});await flush();
    assert.equal(latest().自動接続,true);assert.equal(latest().接続済み,true);
    assert.equal(latest().コアセッションID,sessionBeforeToggle);
    receive({type:'chooseModel',provider:'aidiy_hermes'});await flush();
    assert.ok(posts.findLast(p=>p.type==='modelCatalog').items.some(m=>m.id==='openai_oauth/gpt-6.1-sol'));
    receive({type:'setModel',provider:'copilot_cli',model:'gpt-6-sol'});await flush();
    assert.deepEqual(selected,{provider:'copilot_cli',model:'gpt-6-sol'});
    let finishCatalog;
    backend.catalogWait=new Promise(resolve=>{finishCatalog=resolve;});
    receive({type:'setModel',provider:'copilot_cli',model:'gpt-6-sol'});await flush();
    assert.equal(latest().モデル変更中,true);
    const beforeModelChange=latest().会話ID, beforeModelSockets=backend.sockets.length;
    for(const data of [{type:'autoConnect',enabled:false},{type:'new'},{type:'disconnect'}]) receive(data);
    await flush();assert.equal(latest().会話ID,beforeModelChange);assert.equal(latest().自動接続,true);
    assert.equal(backend.sockets.length,beforeModelSockets);
    finishCatalog();backend.catalogWait=undefined;await flush();assert.equal(latest().モデル変更中,false);
    receive({メッセージ識別:'input_text',メッセージ内容:'調査'});await flush();
    const state=posts.findLast(p=>p.type==='state');assert.equal(state.メッセージ.at(-1).種別,'assistant');
    assert.ok(state.コアセッションID); assert.equal(state.メッセージ.filter(p=>p.種別==='user').length,1);
    const latestRequest = () => backend.sockets.flatMap(socket=>socket.sent).findLast(packet=>packet.メッセージ識別==='input_text');
    assert.equal(latestRequest().self_check_loop,1);
    for (const count of [0,1,2,3]) {
      receive({メッセージ識別:'input_text',メッセージ内容:`検証${count}回`,self_check_loop:count});await flush();
      assert.equal(latestRequest().self_check_loop,count);
    }
    // 画面で選び直した検証回数を保存し、状態通知で返す（次回の起動で復元する）。
    assert.equal(posts.findLast(p=>p.type==='state').検証回数,0);
    receive({type:'setSelfCheckLoop',count:2});await flush();
    assert.deepEqual(preferences.get('options.json'),{検証回数:2});
    receive({type:'ready'});await flush();
    assert.equal(posts.findLast(p=>p.type==='state').検証回数,2);
    view.visible=false;visibility();view.visible=true;visibility();assert.equal(posts.findLast(p=>p.type==='state').接続済み,true);
    const coreSession = latest().コアセッションID;
    backend.hold=true;
    receive({メッセージ識別:'input_text',メッセージ内容:'スイッチ変更拒否の確認'});await flush();
    receive({type:'autoConnect',enabled:false});await flush();
    assert.equal(latest().自動接続,true);assert.equal(latest().接続済み,true);
    for(const type of ['connect','disconnect']) {receive({type});await flush();assert.equal(latest().接続済み,true);assert.equal(latest().実行中,true);}
    backend.holdCancel=true;
    receive({セッションID:latest().会話ID,チャンネル:'code1',メッセージ識別:'cancel_run',メッセージ内容:'強制停止！'});await flush();
    assert.equal(latest().停止中,true);assert.equal(latest().実行中,true);
    const stopsBefore=backend.sockets.flatMap(s=>s.sent).filter(p=>p.メッセージ識別==='cancel_run').length;
    receive({メッセージ識別:'cancel_run'});await flush();
    assert.equal(backend.sockets.flatMap(s=>s.sent).filter(p=>p.メッセージ識別==='cancel_run').length,stopsBefore);
    receive({type:'autoConnect',enabled:false});await flush();assert.equal(latest().自動接続,true);
    backend.sockets.findLast(s=>s.channel==='1' && s.readyState===1).emit({メッセージ識別:'output_end',メッセージ内容:'',実行中:false});await flush();
    assert.equal(latest().停止中,false);assert.equal(latest().実行中,false);
    backend.holdCancel=false;backend.hold=false;
    receive({type:'disconnect'});await flush();
    assert.equal(latest().接続済み,false);assert.equal(latest().provider,'aidiy_hermes');
    assert.equal(latest().model,'openai_oauth/gpt-6.1-sol');
    const requestsBefore = backend.requests.length;
    receive({type:'chooseModel',provider:''});await flush();
    assert.deepEqual(posts.findLast(p=>p.type==='modelCatalog').items.map(m=>m.id),['aidiy_hermes']);
    receive({type:'chooseModel',provider:'aidiy_hermes'});await flush();
    assert.ok(posts.findLast(p=>p.type==='modelCatalog').items.some(m=>m.id==='copilot_cli/auto'));
    receive({type:'setModel',provider:'aidiy_hermes',model:'copilot_cli/auto'});await flush();
    assert.equal(latest().model,'copilot_cli/auto');assert.equal(backend.requests.length,requestsBefore);
    assert.deepEqual(preferences.get('online.json'),{provider:'copilot_cli',model:'gpt-6-sol'});
    assert.deepEqual(preferences.get('online_offline.json'),{provider:'aidiy_hermes',model:'copilot_cli/auto'});
    backend.unavailable=true;receive({type:'autoConnect',enabled:true});await flush();
    receive({セッションID:latest().会話ID,チャンネル:'code1',メッセージ識別:'input_text',メッセージ内容:'切断中',self_check_loop:0});await flush();
    assert.equal(runs.length,1);assert.equal(runs[0].model,'copilot_cli/auto');assert.equal(runs[0].session,undefined);
    assert.equal(runs[0].project,'/project');assert.equal(latest().実行中,true);
    backend.unavailable=false;t.mock.timers.tick(10000);await flush();assert.equal(latest().接続済み,true);
    assert.equal(latest().実行モード,'offline');assert.equal(latest().model,'copilot_cli/auto');assert.equal(latest().実行中,true);
    for(const data of [{type:'autoConnect',enabled:false},{type:'autoConnect',enabled:true},{type:'connect'},{type:'disconnect'}]) {
      receive(data);await flush();assert.equal(latest().接続済み,true);assert.equal(latest().実行中,true);
    }
    const id=latest().会話ID;
    receive({type:'new'});receive({type:'setModel',provider:'aidiy_hermes',model:'auto'});
    receive({メッセージ識別:'input_text',メッセージ内容:'重複'});await flush();
    assert.equal(latest().会話ID,id);assert.equal(runs.length,1);
    runs[0].receive({メッセージ識別:'output_text',メッセージ内容:'Hermes回答'});
    assert.equal(latest().実行中,true);
    runs[0].finish();await flush();
    assert.equal(latest().実行中,false);assert.equal(latest().provider,'copilot_cli');assert.equal(latest().model,'gpt-6-sol');
    assert.equal(latest().HermesセッションID,'hermes-only');assert.equal(latest().コアセッションID,coreSession);
    receive({type:'disconnect'});await flush();
    receive({メッセージ識別:'input_text',メッセージ内容:'Hermes続き'});await flush();
    assert.equal(runs[1].session,'hermes-only');assert.equal(runs[1].model,'copilot_cli/auto');
    receive({メッセージ識別:'cancel_run'});await flush();assert.equal(runs[1].stops,1);
    runs[1].receive({メッセージ識別:'output_stream',メッセージ内容:'\x18'});
    receive({メッセージ識別:'cancel_run'});await flush();assert.equal(runs[1].stops,1);
    assert.equal(latest().実行中,true);assert.equal(latest().停止中,true);
    runs[1].finish({終了コード:1,停止理由:'停止しました。'});await flush();assert.equal(latest().実行中,false);
    receive({type:'connect'});await flush();assert.equal(latest().provider,'copilot_cli');
    // 再起動でもモード別の保存値を読む。
    provider.dispose();loaded.exports.activate(context);provider.resolveWebviewView(view);visibility();
    assert.equal(latest().provider,'aidiy_hermes');assert.equal(latest().model,'copilot_cli/auto');
    receive({type:'ready'});await flush();assert.equal(latest().provider,'copilot_cli');assert.equal(latest().model,'gpt-6-sol');
    assert.equal(latest().自動接続,true);
    receive({type:'disconnect'});await flush();vscode.workspace.isTrusted=false;
    receive({メッセージ識別:'input_text',メッセージ内容:'未信頼'});await flush();assert.equal(runs.length,2);
    assert.equal(latest().信頼済み,false);vscode.workspace.isTrusted=true;
    receive({メッセージ識別:'input_text',メッセージ内容:'破棄前'});await flush();
    disposed();assert.ok(backend.sockets.every(s=>s.readyState===3));
    assert.equal(runs[2].stops,1);runs[2].finish();await flush();
    provider.resolveWebviewView(view);
    // フォルダを閉じると通信・保存・実行を抑止し、別フォルダで新しい接続を作る。
    vscode.workspace.workspaceFolders=[];folderChanged();await flush();
    assert.equal(latest().作業フォルダ,null);
    const socketsBefore=backend.sockets.length, runsBefore=runs.length, settingsBefore=JSON.stringify([...preferences]);
    for (const message of [{type:'connect'}, {type:'setModel',provider:'aidiy_hermes',model:'copilot_cli/auto'},
      {メッセージ識別:'input_text',メッセージ内容:'拒否するfixture'}]) receive(message);
    await flush();assert.equal(backend.sockets.length,socketsBefore);assert.equal(runs.length,runsBefore);
    assert.equal(JSON.stringify([...preferences]),settingsBefore);
    const nextFolder={name:'next',uri:{scheme:'file',fsPath:'/next',toString:()=> 'file:///next'}};
    vscode.workspace.workspaceFolders=[nextFolder];folderChanged();await flush();
    assert.equal(latest().作業フォルダ.パス,'/next');
    receive({type:'connect'});await flush();assert.equal(latest().接続済み,true);
    assert.equal(latest().作業フォルダ.パス,'/next');
  } finally { provider.dispose(); }
});

test('Code 拡張添付: 信頼済みonlineの現scopeだけ送信、echo画像保存・拒否応答・stale防止', async () => {
  const posts = [], sent = [], subscription = { dispose() {} }; let provider, connection;
  const uri = { scheme: 'file', fsPath: '/project', toString: () => 'file:///project' }, folder = { uri, name: 'project' };
  const vscode = { workspace: { isTrusted: true, workspaceFolders: [folder], getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    getWorkspaceFolder: () => folder, onDidChangeWorkspaceFolders: () => subscription },
    window: { onDidChangeActiveTextEditor: () => subscription, createOutputChannel: () => ({ appendLine() {}, dispose() {} }), registerWebviewViewProvider: (_id, value) => { provider = value; return subscription; } },
    Uri: { joinPath: (_root, value) => value }, commands: { registerCommand: () => subscription } };
  class Connection {
    connected = true; epoch = 1; session = 'session'; projectPath = '/project'; model = { provider: 'codex_cli', model: 'auto' };
    constructor(_backend, receive, notify) { connection = this; this.receive = receive; this.notify = notify; }
    start() { this.notify(); } disconnect() { this.connected = false; } dispose() {} send(packet) { sent.push(packet); return true; }
  }
  const dependencies = { './workspace-folder': { usableFolder: folder => folder?.uri.scheme === 'file', folderRequired: '先にプロジェクトフォルダを開いてください' }, './extension-installation': { extensionCoreConnection: () => ({ backend: 'http://127.0.0.1:18091', authorization: () => ({}) }) }, vscode, './vscode-html': { developmentHtml: () => '' }, './file-attachments': require('../out/file-attachments.cjs'),
    './code-connection': { CodeConnection: Connection, コード選択: value => ({ provider: value.provider || '', model: value.model || '' }) },
    './input-prediction': { InputPrediction: class { sync() {} clear() {} } }, './protocol': require('../out/protocol.cjs'),
    './model-preferences': { モデル保存先: () => 'model', コードモデル読込() {}, コード設定保存先: () => 'options', 検証回数読込() {} },
    './conversation-store': { ...require('../out/conversation-store.cjs'), 会話保存先() {}, 会話一覧: () => [], 会話書込() {} },
    '../aidiy_code/src/offline': { オフラインモデル候補: () => [{ id: 'same' }], Hermes既定モデル: () => 'same', オフラインモデル保存先: () => 'offline' },
    '../aidiy_live/local-backend.cjs': { ローカル接続先: () => 'http://127.0.0.1:18091' }, './runner': {},
  };
  const loaded = { exports: {} };
  runInNewContext(transformSync(readFileSync('src/extension.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module: loaded, exports: loaded.exports, setTimeout, clearTimeout, console, URL, require: name => dependencies[name] || require(name),
  });
  loaded.exports.activate({ extensionPath: '/fixture', extensionUri: uri, subscriptions: [], workspaceState: { get() {}, update: async () => {} }, globalState: { get() {} } });
  provider.resolveWebviewView({ webview: { asWebviewUri: value => value, onDidReceiveMessage() {}, postMessage: packet => posts.push(packet) }, onDidDispose() {}, onDidChangeVisibility() {} });
  try {
    await provider.受信({ type: 'ready' });
    const upload = { type: 'sendFile', requestId: 'file-1', name: '画像.png', base64: 'aGk=', conversationId: provider.会話ID, sessionId: connection.session, projectPath: connection.projectPath, connectionEpoch: connection.epoch };
    for (const field of ['conversationId', 'sessionId', 'projectPath', 'connectionEpoch']) {
      await provider.受信({ ...upload, [field]: 'wrong' }); assert.equal(posts.at(-1).ok, false);
    }
    vscode.workspace.isTrusted = false; await provider.受信(upload); assert.equal(posts.at(-1).ok, false);
    vscode.workspace.isTrusted = true; connection.connected = false; await provider.受信(upload); assert.equal(posts.at(-1).ok, false);
    connection.connected = true; provider.実行中 = true; await provider.受信(upload); assert.equal(posts.at(-1).ok, false);
    provider.実行中 = false; await provider.受信({ ...upload, name: '../bad' }); assert.equal(posts.at(-1).ok, false);
    assert.equal(sent.length, 0);
    connection.epoch++; // 同じsession/projectへ再接続したホストを模擬する。
    await provider.受信(upload); assert.equal(posts.at(-1).ok, false); assert.equal(sent.length, 0);
    await provider.受信({ ...upload, connectionEpoch: undefined }); assert.equal(posts.at(-1).ok, false);
    upload.connectionEpoch = connection.epoch; provider.通知();
    assert.equal(posts.at(-1).接続世代, connection.epoch);
    await provider.受信(upload); assert.equal(posts.at(-1).ok, true); assert.equal(sent.length, 1);
    assert.equal(provider.会話.メッセージ.length, 0, 'host受理はCore保存完了ではない');
    const thumbnail = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
    const packet = { セッションID: 'session', チャンネル: '1', メッセージ識別: 'output_file', ファイル名: 'temp/output/画像.png', サムネイル画像: thumbnail };
    connection.receive({ ...packet, セッションID: 'wrong' }); assert.equal(provider.会話.メッセージ.length, 0);
    connection.receive(packet); connection.receive(packet); assert.equal(provider.会話.メッセージ.length, 1);
    assert.equal(provider.会話.メッセージ[0].添付.thumbnail, 'data:image/png;base64,' + thumbnail);
    connection.receive({ ...packet, メッセージ識別: 'input_file', ファイル名: 'temp/input/画像.png' });
    assert.equal(provider.会話.メッセージ[1].種別, 'user');
    connection.receive({ メッセージ識別: 'error', メッセージ内容: 'ファイル保存に失敗しました' });
    assert.equal(provider.会話.メッセージ.at(-1).種別, 'error');
  } finally { provider.dispose(); }
});
