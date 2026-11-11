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
import * as selectedFiles from '../src/components/ファイル閲覧/選択ファイル.js';
import * as viewerIdle from '../src/components/ファイル閲覧/閲覧待機.js';
import * as references from '../src/components/ファイル閲覧/ファイル参照.js';
import * as actions from '../src/components/ファイル閲覧/ファイル操作.js';
import * as browserLaunch from '../src/components/ブラウザ/起動.js';
import * as fileAnalysisStatus from '../src/components/ファイル閲覧/ファイル解析状態.js';
import * as displayUrls from '../viewer/表示URL.mjs';
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
async function viewer(t, { desktop, browserCopy = async () => {}, pinned = false, root = 'C:\\作業 フォルダ', file = { name: '日本語 & #.txt', path: '資料/日本語 & #.txt' }, fileData = { kind: 'text', text: '本文は消えません', size: 24 }, browser = browserLaunch, previewData = {}, previewFetch, openAnalysis, analysisFetch, channelFactory = () => null } = {}) {
  const window = new EventTarget(); window.aidiyWindow = desktop;
  window.location={origin:'http://127.0.0.1:9000'};
  const timers = new Map(), warnings = [], copies = [], analysisCalls = [];
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
    module, window, console, AbortController, AbortSignal, URLSearchParams, URL, Date,
    localStorage: { getItem: () => null },
    fetch: async (url,options) => url.startsWith('/api/file-analysis?')?(analysisCalls.push({url,...options}),analysisFetch?analysisFetch(url,options):{ok:true,json:async()=>({path:new URLSearchParams(url.split('?')[1]).get('path'),job:null,result:null})}):url.startsWith('/api/preview?')&&previewFetch ? previewFetch(url) : ({ ok: true, json: async () => url.startsWith('/api/preview?')?previewData:fileData }),
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
    require: id => id === './選択ファイル.js' ? selectedFiles : id.endsWith('/ファイル解析状態.js')?{...fileAnalysisStatus,createFileAnalysisStatus:options=>fileAnalysisStatus.createFileAnalysisStatus({...options,channelFactory,setTimer:(callback,delay)=>{const id=++sequence;timers.set(id,{callback,delay});return id;},clearTimer:id=>timers.delete(id)})}:id === '../共通表示/再読込ボタン.vue' ? refreshModule.exports : id === '../ファイル閲覧/閲覧待機.js' ? viewerIdle : id === 'vue' ? vue : id === '../ファイル閲覧/ファイル参照.js' ? references
      : id === '../ファイル閲覧/ファイル操作.js' ? { ...actions, copyBrowserText: async text => { copies.push(text); await browserCopy(text); } }
        : id === '../ブラウザ/起動.js' ? browser : id === '../../../viewer/表示URL.mjs' ? displayUrls : id === '../../../viewer/media-types.mjs' ? mediaTypes : id === '../ファイル閲覧/コード表示.js' ? { loadMonaco: async () => null, monacoLanguage: () => 'text' } : assert.fail(`Unexpected import ${id}`),
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
  return { props, state, timers, copies, analysisCalls, find, dispose, text: () => textOf(container),
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


test('ソース→画面URL実Vue: JS/TS共通部品の複数画面を独立選択し、理由と選択URLを表示・Browserへ渡す',async t=>{
 const routes=[{path:'画面',url:'http://localhost:3456/list',reason:'List.vue:4 → shared.js'},{path:'画面',url:'http://localhost:3456/detail',reason:'Detail.vue:7 → shared.js'}],opened=[];
 const instances=[];
 for(const name of ['shared.js','shared.tsx','shared.svelte']){
  const f=await viewer(t,{file:{name,path:'src/'+name},previewData:{kind:'analysis',routes,reason:'到達性は未確認'},browser:{openBrowser:async(...args)=>{opened.push([args[0],args[3],args[4]]);return{ok:true};}}});instances.push(f);
  assert.equal(f.state.mode.value,'code');assert.match(f.text(),/List.vue:4/);assert.match(f.text(),/到達性は未確認/);assert.ok(f.find('viewer-mode'));assert.match(f.text(),/http:\/\/localhost:3456\/detail/);
  f.state.routeIndex.value=1;await flush();await f.click('viewer-analysis-page');assert.deepEqual(opened.at(-1),['src/'+name,routes[1].url,true]);
  f.state.setMode('view');await flush();assert.equal(f.find('viewer-preview').props.src,routes[1].url);assert.match(f.text(),/Detail.vue:7/);
  await f.state.refresh();await flush();assert.equal(f.state.routeIndex.value,1);
 }
 instances[0].state.routeIndex.value=0;await flush();assert.equal(instances[1].state.routeIndex.value,1);
});

test('ソース→画面URL実Vue: URLなしJSはコードだけを保ち、次ファイルと遅い応答のURLを混同しない',async t=>{
 const pending=deferred();let calls=0;
 const f=await viewer(t,{file:{name:'shared.js',path:'shared.js'},previewFetch:()=>++calls===1?pending.promise:Promise.resolve({ok:true,json:async()=>({kind:'analysis',routes:[],error:'画面なし'})})});
 assert.equal(f.find('viewer-browser'),undefined);assert.equal(f.find('viewer-mode'),undefined);
 f.props.file={name:'server.js',path:'server.js'};await flush();pending.resolve({ok:true,json:async()=>({kind:'analysis',routes:[{url:'http://localhost:3456/old'}]})});await flush();
 assert.equal(f.state.mode.value,'code');assert.match(f.text(),/本文は消えません/);assert.equal(f.find('viewer-analysis-page'),undefined);assert.equal(f.find('viewer-browser'),undefined);assert.equal(f.find('viewer-mode'),undefined);assert.equal(f.find('viewer-preview'),undefined);
});

test('解析状態実Vue: 通常・ピン留めのボタンは依頼通知で即座に同期し、途中保存中も解析中を維持する',async t=>{
 const channels=new Set(),channelFactory=()=>{const channel={postMessage(data){for(const other of channels)if(other!==channel)other.onmessage?.({data});},close(){channels.delete(channel);}};channels.add(channel);return channel;};
 let response={path:'src/a.vue',job:null,result:null};const opened=[];
 const config={file:{path:'src/a.vue',name:'a.vue'},root:'/project',openAnalysis:(...args)=>opened.push(args),analysisFetch:async()=>({ok:true,json:async()=>response}),channelFactory};
 const embedded=await viewer(t,config),pinned=await viewer(t,{...config,pinned:true});assert.equal(embedded.find('viewer-analysis').text,'AI解析');assert.equal(pinned.find('viewer-analysis').text,'AI解析');for(const f of [embedded,pinned])assert.equal(new URLSearchParams(f.analysisCalls[0].url.split('?')[1]).get('status'),'1');
 response={...response,job:{id:'new-job',status:'waiting',monitoring:true}};fileAnalysisStatus.notifyFileAnalysisChanged('src/a.vue','/project',channelFactory);await flush();
 for(const f of [embedded,pinned]){assert.equal(f.find('viewer-analysis').text,'AI解析中…');assert.equal(f.find('viewer-analysis').props['aria-label'],'AI解析中…');await f.click('viewer-analysis');assert.equal(f.find('viewer-analysis').props.disabled,undefined);assert.match(f.text(),/本文は消えません/);}
 assert.equal(opened.length,2);response={...response,job:{status:'complete',monitoring:true},result:{id:'saved'}};await embedded.state.analysisMonitor.refresh();await flush();assert.equal(embedded.find('viewer-analysis').text,'AI解析中…');
 response={...response,job:{status:'complete',monitoring:false}};fileAnalysisStatus.notifyFileAnalysisChanged('src/a.vue','/project',channelFactory);await flush();for(const f of [embedded,pinned]){assert.equal(f.find('viewer-analysis').text,'AI解析済');assert.equal(f.timers.size,0);f.dispose();}assert.equal(channels.size,0);
});

test('解析状態実Vue: 別ファイルへ移動・復帰しても対象だけを表示し、遅い取得と閉じるを無視する',async t=>{
 const pending=deferred();let count=0,close;
 const f=await viewer(t,{file:{path:'a.vue',name:'a.vue'},openAnalysis:(_file,_root,onClose)=>{close=onClose;},analysisFetch:async url=>{const path=new URLSearchParams(url.split('?')[1]).get('path');return ++count===1?pending.promise:{ok:true,json:async()=>({path,job:path==='a.vue'?{status:'waiting'}:null,result:null})};}});
 await f.click('viewer-analysis');f.props.file={path:'b.py',name:'b.py'};await flush();assert.equal(f.analysisCalls[0].signal.aborted,true);assert.equal(f.find('viewer-analysis').text,'AI解析');const calls=count;close();await flush();assert.equal(count,calls);
 pending.resolve({ok:true,json:async()=>({path:'a.vue',job:{status:'waiting'}})});await flush();assert.equal(f.find('viewer-analysis').text,'AI解析');
 f.props.file={path:'a.vue',name:'a.vue'};await flush();assert.equal(f.find('viewer-analysis').text,'AI解析中…');assert.equal(f.timers.size,1);f.dispose();assert.equal(f.timers.size,0);assert.equal(f.analysisCalls.at(-1).signal.aborted,true);
});

test('解析状態実Vue: 通信失敗時に確定表示せず再確認し、再解析失敗は過去結果と区別する',async t=>{
 let response={ok:false,json:async()=>({error:'通信エラー'})};const f=await viewer(t,{openAnalysis:()=>{},analysisFetch:async()=>response});assert.equal(f.find('viewer-analysis').text,'AI解析');assert.match(f.find('viewer-analysis').props.title,/確認できません/);assert.equal(f.timers.size,1);
 const path=f.props.file.path;response={ok:true,json:async()=>({path,job:{status:'timeout'},result:{id:'previous'}})};await f.state.analysisMonitor.refresh();await flush();assert.equal(f.find('viewer-analysis').text,'AI解析 要確認');assert.equal(f.timers.size,0);
 response={ok:true,json:async()=>({path,job:{status:'waiting'},result:{id:'previous'}})};await f.state.refresh();await flush();assert.equal(f.find('viewer-analysis').text,'AI解析中…');assert.equal(f.analysisCalls.length,3);
});

test('参照実Vue: 別窓だけにボタン、外部テキスト・キャンセル・再選択・元ファイル変更',async t=>{
 const inline=await viewer(t);assert.equal(inline.find('viewer-browse'),undefined);
 const f=await viewer(t,{pinned:true});assert.ok(f.find('viewer-browse'));
 const choose=async text=>{await f.state.selectLocal({target:{files:[new File([text],'outside.txt')],value:'selected'}});await flush();};
 await choose('外部の本文');assert.match(f.text(),/外部の本文/);assert.equal(f.find('viewer-analysis'),undefined);
 await f.state.selectLocal({target:{files:[],value:''}});await flush();assert.match(f.text(),/外部の本文/);
 await choose('再選択の本文');assert.match(f.text(),/再選択の本文/);
 f.props.file={path:'other.txt',name:'other.txt'};await flush();assert.match(f.text(),/本文は消えません/);assert.doesNotMatch(f.text(),/再選択の本文/);
});
test('参照実Vue: Electronのプロジェクト内パスは既存APIで読む',async t=>{
 const f=await viewer(t,{pinned:true,root:'/project',desktop:{selectedFilePath:()=>'/project/sub/inside.txt'}});
 await f.state.selectLocal({target:{files:[new File(['ローカル値'],'inside.txt')],value:'selected'}});await flush();
 assert.match(f.text(),/\/project\/sub\/inside.txt/);assert.match(f.text(),/本文は消えません/);assert.doesNotMatch(f.text(),/ローカル値/);
});
