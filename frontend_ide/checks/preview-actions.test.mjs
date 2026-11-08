// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as viewerIdle from '../src/components/ファイル閲覧/閲覧待機.js';
import * as references from '../src/components/ファイル閲覧/ファイル参照.js';
import * as actions from '../src/components/ファイル閲覧/ファイル操作.js';
import * as browserLaunch from '../src/components/ブラウザ/起動.js';
import * as mediaTypes from '../viewer/media-types.mjs';

const require = createRequire(import.meta.url), vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const { transformSync } = require('esbuild');
// 共通ボタンも実Vueを読み込み、ビューアの現在の部品構成で検証する。
const refreshFilename = fileURLToPath(new URL('../src/components/共通表示/再読込ボタン.vue', import.meta.url));
const refreshDescriptor = parse(readFileSync(refreshFilename, 'utf8')).descriptor;
const refreshScript = compileScript(refreshDescriptor, { id: 'RefreshButton', inlineTemplate: true });
const refreshModule = { exports: {} };
vm.runInNewContext(transformSync(refreshScript.content, { format: 'cjs' }).code, {
  module: refreshModule, exports: refreshModule.exports,
  require: id => id === 'vue' ? vue : assert.fail(`Unexpected refresh import ${id}`),
});
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const walk = (node, predicate) => predicate(node) ? node : node.children?.map(child => walk(child, predicate)).find(Boolean);
const hasClass = (node, name) => String(node.props?.class || '').split(/\s+/).includes(name);
const textOf = node => [node.text || '', ...(node.children || []).map(textOf)].join('');

// Vueの実テンプレートをメモリ上にマウントする。OSアプリ・ブラウザは起動しない。
async function viewer(t, { desktop, browserCopy = async () => {}, pinned = false, root = 'C:\\作業 フォルダ', file = { name: '日本語 & #.txt', path: '資料/日本語 & #.txt' }, fileData = { kind: 'text', text: '本文は消えません', size: 24 }, browser = browserLaunch, previewData = {}, previewFetch, openAnalysis } = {}) {
  const window = new EventTarget(); window.aidiyWindow = desktop;
  window.location={origin:'http://127.0.0.1:9000'};
  const timers = new Map(), warnings = [], copies = [];
  let sequence = 0, state;
  function node(type, text = '') {
    return { type, tagName: type.toUpperCase(), text, props: {}, children: [], style: {},
      scrollIntoView() {}, querySelector: () => null,addEventListener(){},removeEventListener(){},
      get options(){return this.children.filter(child=>child.type==='option');} };
  }
  const renderer = vue.createRenderer({
    createElement: node, createText: text => node('text', text), createComment: text => node('comment', text),
    insert(element, parent, anchor) {
      if (element.parent) element.parent.children.splice(element.parent.children.indexOf(element), 1);
      element.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(element); else parent.children.splice(index, 0, element);
    },
    remove(element) { if (element.parent) element.parent.children.splice(element.parent.children.indexOf(element), 1); element.parent = null; },
    parentNode: element => element.parent, nextSibling: element => element.parent?.children[element.parent.children.indexOf(element) + 1],
    patchProp: (element, key, _old, value) => { element.props[key] = value; },
    setText: (element, text) => { element.text = text; }, setElementText: (element, text) => { element.text = text; element.children = []; },
  });
  const filename = fileURLToPath(new URL('../src/components/ファイル閲覧/ファイルビューア.vue', import.meta.url));
  const { descriptor } = parse(readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: 'FileViewer', genDefaultAs: 'component' });
  const template = compileTemplate({ source: descriptor.template.content, id: 'FileViewer', filename, compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const module = { exports: {} };
  vm.runInNewContext(transformSync(`${script.content}\n${template.code}\ncomponent.render=render;module.exports=component;`, { format: 'cjs' }).code, {
    module, window, console, AbortController, URLSearchParams, URL, Date,
    localStorage: { getItem: () => null },
    fetch: async url => url.startsWith('/api/preview?')&&previewFetch ? previewFetch(url) : ({ ok: true, json: async () => url.startsWith('/api/preview?')?previewData:fileData }),
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
    require: id => id === '../共通表示/再読込ボタン.vue' ? refreshModule.exports : id === '../ファイル閲覧/閲覧待機.js' ? viewerIdle : id === 'vue' ? vue : id === '../ファイル閲覧/ファイル参照.js' ? references
      : id === '../ファイル閲覧/ファイル操作.js' ? { ...actions, copyBrowserText: async text => { copies.push(text); await browserCopy(text); } }
        : id === '../ブラウザ/起動.js' ? browser : id === '../../../viewer/media-types.mjs' ? mediaTypes : id === '../ファイル閲覧/コード表示.js' ? { loadMonaco: async () => null, monacoLanguage: () => 'text' } : assert.fail(`Unexpected import ${id}`),
  });
  const component = module.exports, setup = component.setup;
  component.setup = (props, context) => { state = setup(props, context); return state; };
  const props = vue.reactive({ root, pinned, file });
  const container = node('root');
  const app = renderer.createApp({ render: () => vue.h(component, props) });
  app.provide('browserAvailable',true);
  if(openAnalysis)app.provide('openFileAnalysis',openAnalysis);
  app.config.warnHandler = message => warnings.push(message);
  app.mount(container); await flush();
  let disposed = false;
  const dispose = () => { if (!disposed) { disposed = true; app.unmount(); } };
  t.after(() => { dispose(); assert.deepEqual(warnings, []); });
  const find = name => walk(container, item => hasClass(item, name));
  return { props, state, timers, copies, find, dispose, text: () => textOf(container),
    click(name) { const target = find(name); assert.ok(target); return target.props.onClick(); } };
}

test('プレビュー実Vue: Webではアプリボタンを描画せず、全パスのコピーだけをクリック時に実行する', async t => {
  const f = await viewer(t, { root: '/project' });
  assert.equal(f.find('viewer-open-app'), undefined); assert.deepEqual(f.copies, []);
  await f.click('viewer-copy'); await flush();
  assert.deepEqual(f.copies, ['/project/資料/日本語 & #.txt']);
  assert.match(f.text(), /コピーしました/); assert.match(f.text(), /本文は消えません/);
  assert.equal([...f.timers.values()][0].delay, 1500);
  [...f.timers.values()][0].callback(); await flush(); assert.doesNotMatch(f.text(), /コピーしました/);
});

test('表示URL実Vue: コードのままURLを確認し、選択した画面だけ表示・ブラウザへ渡す',async t=>{
 const urls=['http://localhost:8090/first','http://localhost:8090/second'],opened=[];
 const f=await viewer(t,{file:{name:'Page.vue',path:'src/Page.vue'},previewData:{kind:'analysis',routes:urls.map((url,i)=>({path:'画面'+i,url})),stale:true},browser:{openBrowser:async(...args)=>{opened.push([args[0],args[3]]);return{ok:true};}}});
 assert.equal(f.state.mode.value,'code');assert.equal(f.find('viewer-preview'),undefined);assert.match(f.text(),/AI解析の表示URL/);assert.match(f.text(),/更新されています/);assert.deepEqual(opened,[]);
 f.state.routeIndex.value=1;await flush();await f.click('viewer-browser');assert.deepEqual(opened,[['src/Page.vue',urls[1]]]);
 f.state.setMode('view');await flush();assert.equal(f.state.routeIndex.value,1);assert.equal(f.find('viewer-preview').props.src,urls[1]);assert.match(f.find('viewer-preview').props.sandbox,/allow-same-origin/);
 f.state.setMode('code');await flush();assert.equal(f.find('viewer-preview'),undefined);assert.match(f.text(),/本文は消えません/);
});

test('表示URL実Vue: 古い取得結果・解析ダイアログの遅いcloseを新しいファイルへ反映しない',async t=>{
 const pending=deferred();let close,requests=0;
 const f=await viewer(t,{file:{name:'old.vue',path:'old.vue'},previewFetch:()=>{requests++;return requests===1?pending.promise:Promise.resolve({ok:true,json:async()=>({kind:'analysis',routes:[{path:'次',url:'http://localhost:3000/new'}]})});},openAnalysis:(_file,_root,onClose)=>{close=onClose;}});
 assert.equal(f.find('viewer-browser').props.disabled,true);await f.click('viewer-analysis');
 f.props.file={name:'new.vue',path:'new.vue'};await flush();const count=requests;close();await flush();assert.equal(requests,count);
 pending.resolve({ok:true,json:async()=>({kind:'analysis',routes:[{path:'古い',url:'http://localhost:3000/old'}]})});await flush();assert.equal(f.state.previewUrl.value,'http://localhost:3000/new');
 f.dispose();assert.equal(f.state.actionBusy.value,'');
});

test('表示URL実Vue: 解析ダイアログを閉じると再取得し、IDEと同じoriginの画面は隔離する',async t=>{
 let close,requests=0;
 const f=await viewer(t,{file:{name:'a.html',path:'a.html'},previewFetch:async()=>{requests++;return{ok:true,json:async()=>({kind:'analysis',routes:[{path:'画面',url:'http://127.0.0.1:9000/screen'}]})};},openAnalysis:(_file,_root,onClose)=>{close=onClose;}});
 await f.click('viewer-analysis');const before=requests;close();await flush();assert.equal(requests,before+1);
 f.state.setMode('view');await flush();assert.doesNotMatch(f.find('viewer-preview').props.sandbox,/allow-same-origin/);
});

test('表示URL実Vue: URL未検出のVueは理由を示し、HTMLは従来のブラウザ起動を保つ',async t=>{
 const opened=[],browser={openBrowser:async(...args)=>{opened.push([args[0],args[3]]);return{ok:true};}};
 const f=await viewer(t,{file:{name:'a.vue',path:'a.vue'},previewData:{kind:'vue',error:'この部品のルートが見つかりません。'},browser});
 await f.click('viewer-browser');await flush();assert.match(f.text(),/ルートが見つかりません/);assert.deepEqual(opened,[]);
 const html=await viewer(t,{file:{name:'a.html',path:'a.html'},previewData:{kind:'html',url:'http://localhost:4567/p/temporary/a.html'},browser});await html.click('viewer-browser');assert.deepEqual(opened,[['a.html','']]);
});

test('プレビュー実Vue: 通常・ピン留めともElectron APIを優先し、表示だけではコピーも起動もしない', async t => {
  for (const pinned of [false, true]) {
    const copied = [], opened = [];
    const f = await viewer(t, { pinned, desktop: { copyFilePath: async path => { copied.push(path); return { ok: true }; }, openFile: async path => { opened.push(path); return { ok: true }; } } });
    assert.deepEqual(copied, []); assert.deepEqual(opened, []);
    assert.match(f.text(), /C:\\作業 フォルダ\\資料\\日本語 & #\.txt/);
    await f.click('viewer-copy'); await flush();
    assert.deepEqual(copied, ['資料/日本語 & #.txt']); assert.deepEqual(f.copies, []);
    assert.match(f.text(), /コピーしました/);
    await f.click('viewer-open-app'); await flush();
    assert.deepEqual(opened, ['資料/日本語 & #.txt']); assert.equal(f.state.actionError.value, '');
    assert.equal(f.state.copied.value, false); assert.equal(f.timers.size, 0);
    f.dispose();
  }
});

test('プレビュー実Vue: コピー失敗は非遮断で手動コピーを案内し、成功を偽らない', async t => {
  for (const desktop of [undefined, { copyFilePath: async () => ({ ok: false, error: 'denied' }) }]) {
    const f = await viewer(t, { desktop, browserCopy: async () => { throw Error('NotAllowed'); } });
    await f.click('viewer-copy'); await flush();
    assert.match(f.text(), /選択してコピー/); assert.match(f.text(), /本文は消えません/);
    assert.equal(f.state.error.value, ''); assert.equal(f.state.copied.value, false);
    assert.equal(f.find('viewer-copy').props.disabled, false);
    if (desktop) assert.deepEqual(f.copies, []);
    f.dispose();
  }
});

test('プレビュー実Vue: 連打を抑止し、ファイル切替後に古いコピー応答・タイマーを表示しない', async t => {
  const pending = deferred(), paths = [];
  const f = await viewer(t, { desktop: { copyFilePath: path => { paths.push(path); return pending.promise; }, openFile: async () => ({ ok: true }) } });
  const action = f.click('viewer-copy'); await flush();
  assert.equal(f.find('viewer-copy').props.disabled, true); assert.equal(f.find('viewer-open-app').props.disabled, true);
  await f.state.copy(); assert.deepEqual(paths, ['資料/日本語 & #.txt']);
  f.props.file = { name: '次.txt', path: '次.txt' }; await flush();
  pending.resolve({ ok: true }); await action; await flush();
  assert.equal(f.state.copied.value, false); assert.equal(f.timers.size, 0); assert.equal(f.state.actionBusy.value, '');
  assert.match(f.text(), /次\.txt/); assert.doesNotMatch(f.text(), /コピーしました/);
  await f.click('viewer-copy'); await flush();
  assert.equal(paths.at(-1), '次.txt');
  const staleTimer = [...f.timers.values()][0].callback;
  f.props.root = '/another'; await flush();
  staleTimer(); assert.equal(f.state.copied.value, false); assert.equal(f.timers.size, 0);
});

test('プレビュー実Vue: 起動の取消・OSエラーを区別し、古いファイルの結果と破棄後の応答を無視する', async t => {
  let result = { ok: false, cancelled: true }; const paths = [];
  const f = await viewer(t, { desktop: { openFile: path => { paths.push(path); return Promise.resolve(result); } } });
  await f.click('viewer-open-app'); await flush(); assert.equal(f.state.actionError.value, '');
  result = { ok: false, error: '関連アプリが見つかりません。' };
  await f.click('viewer-open-app'); await flush(); assert.match(f.text(), /関連アプリが見つかりません/); assert.match(f.text(), /本文は消えません/);
  const pending = deferred(); result = pending.promise;
  const action = f.click('viewer-open-app'); await flush();
  f.props.file = { name: 'new.txt', path: 'new.txt' }; await flush();
  pending.resolve({ ok: false, error: 'old failure' }); await action; await flush();
  assert.equal(f.state.actionError.value, ''); assert.equal(paths.at(-1), '資料/日本語 & #.txt');
  const closing = deferred(); result = closing.promise;
  const last = f.click('viewer-open-app'); f.dispose(); closing.resolve({ ok: false, error: 'late' }); await last;
  assert.equal(f.state.actionError.value, ''); assert.equal(f.timers.size, 0);
});

test('プレビュー実Vue: 音声・動画は案内と「ブラウザ」ボタンを出し、押すとBrowserで開く（ビューア内では再生しない）', async t => {
  for (const name of ['曲 1.mp3', '動画.MP4']) {
    const opened = [];
    const f = await viewer(t, { browser: { openBrowser: async path => { opened.push(path); return { ok: true }; } }, file: { name, path: '素材/' + name }, fileData: { kind: 'binary', size: 1000 } });
    assert.match(f.text(), /音声・動画は「ブラウザ」で開いて再生できます。/); assert.doesNotMatch(f.text(), /この形式はプレビューできません/);
    assert.ok(f.find('viewer-browser')); assert.deepEqual(opened, []);
    await f.click('viewer-browser'); await flush();
    assert.deepEqual(opened, ['素材/' + name]); assert.equal(f.state.actionError.value, '');
    f.dispose();
  }
  // 音声・動画・HTML 以外は「ブラウザ」ボタンを出さない。
  const other = await viewer(t, { file: { name: 'a.bin', path: 'a.bin' }, fileData: { kind: 'binary', size: 10 } });
  assert.equal(other.find('viewer-browser'), undefined); assert.match(other.text(), /この形式はプレビューできません/);
});
