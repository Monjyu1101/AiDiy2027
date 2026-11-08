// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vueの表示・アクセシブル名を模擬APIで確認する。実AI・配布ビルドは使わない。
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'temp/ai-action-labels-check');
const bundle = await build({
  stdin: { resolveDir: root, contents: `import {createApp,h,ref} from 'vue';
import Explorer from './src/components/ファイル閲覧/ファイル一覧.vue';
import Viewer from './src/components/ファイル閲覧/ファイルビューア.vue';
import Analysis from './src/dialog/ファイル解析ダイアログ.vue';
const file={name:'sample.txt',path:'sample.txt'},tree={n:'fixture',f:[['sample.txt',12,1]],d:[]},dialog=ref(false),pinned=ref(false);
const app=createApp({render:()=>[h(Explorer,{tree,root:'/fixture',open:true,startedAt:1}),h(Viewer,{file,root:'/fixture',pinned:pinned.value}),dialog.value?h(Analysis,{file,root:'/fixture',onClose:()=>dialog.value=false}):null]});
app.provide('openFileAnalysis',()=>dialog.value=true);app.mount('#app');window.dispose=()=>app.unmount();window.pinViewer=()=>pinned.value=true;` },
  bundle: true, write: false, format: 'iife', plugins: [{ name: 'vue-label-check', setup(builder) {
    builder.onLoad({ filter: /コード表示\.js$/ }, () => ({ contents: 'export const loadMonaco=async()=>null;export const monacoLanguage=()=>"plaintext";' }));
    builder.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor, errors } = parse(readFileSync(args.path, 'utf8'), { filename: args.path });
      assert.deepEqual(errors, []);
      const script = compileScript(descriptor, { id: 'ai-label-check', inlineTemplate: true });
      return { contents: script.content + `\n{const style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s => s.content).join('\n'))};document.head.append(style);}`, resolveDir: dirname(args.path) };
    });
  } }],
});
if (process.argv.includes('--compile-only')) {
  console.log('PASS: Explorer, AI search, Viewer and Analysis Vue components compile.'); process.exit(0);
}
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'ai-label-check-'));
const requests = [], css = readFileSync(join(root, 'src/style.css'), 'utf8');
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'); requests.push({ method: req.method, path: url.pathname });
  const json = value => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
  if (url.pathname === '/api/ai-search/history') return json({ entries: [] });
  if (url.pathname === '/api/ai-search') return json({ id: 'fixture', path: 'temp/fixture.json', status: 'timeout', prompt: '模擬依頼', message: '模擬結果待ち' });
  if (url.pathname === '/api/file') return json({ kind: 'text', text: '読み取り専用の表示確認', size: 12 });
  if (url.pathname === '/api/file-history') return json({ versions: [] });
  if (url.pathname === '/api/latest') return json({ paths: [], files: [] });
  if (url.pathname === '/api/file-analysis') {
    for await (const chunk of req) { void chunk; }
    return json(req.method === 'GET' ? { result: null, job: null, stale: false, instruction: '表示の確認' } : { ok: true });
  }
  if (url.pathname === '/app.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle.outputFiles[0].text);
  if (url.pathname === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><meta charset="utf-8"><style>${css}\nhtml,body,#app{margin:0;width:100%;height:100%;background:#000;color:#e5edf8}.viewer-popup{left:420px;right:20px;top:80px;bottom:20px;width:auto}</style><div id="app"></div><script src="/app.js"></script>`);
  res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const chrome = spawn(process.env.CHROME_PATH || '/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', '--window-size=1200,850', '--user-data-dir=' + temporary, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, HOME: temporary, XDG_CONFIG_HOME: temporary, XDG_CACHE_HOME: temporary } });
let socket, browserErrors = ''; chrome.stderr.on('data', data => { browserErrors += data; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { for (let n = 0; n < 160; n++) { if (await check()) return; await sleep(50); } throw Error('Timeout: ' + label); }
try {
  let port;
  await until(() => { try { port = readFileSync(join(temporary, 'DevToolsActivePort'), 'utf8').split('\n')[0]; return !!port; } catch { return false; } }, 'Chromium').catch(error => { throw Error(error.message + '\n' + browserErrors); });
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, 'open');
  let id = 0; const pending = new Map(), errors = [];
  socket.on('message', value => { const data = JSON.parse(value); if (data.id) { pending.get(data.id)?.(data); pending.delete(data.id); } if (data.method === 'Runtime.exceptionThrown') errors.push(data.params); });
  const send = (method, params = {}) => new Promise(resolve => { pending.set(++id, resolve); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }); assert.equal(response.result?.exceptionDetails, undefined, JSON.stringify(response)); return response.result.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const capture = async name => writeFileSync(join(output, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  const noLegacy = async () => assert.equal(await evaluate(`/aidiy[\\s_-]*(?:検索|解析|分析)/i.test(document.body.innerText+' '+[...document.querySelectorAll('[title],[aria-label]')].map(n=>(n.title||'')+' '+(n.getAttribute('aria-label')||'')).join(' '))`), false);
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
  await until(() => evaluate(`!!document.querySelector('.viewer-analysis')&&!!document.querySelector('input[value="ai"]')`), 'initial labels');
  assert.equal(await evaluate(`document.querySelector('.viewer-analysis').textContent.trim()`), 'AI解析');
  assert.equal(await evaluate(`document.querySelector('input[value="ai"]').parentElement.textContent`), 'AI検索');
  await click('input[value="ai"]'); await click('[aria-label="軌跡バーを開く"]');
  await until(() => evaluate(`!!document.querySelector('.ai-search-panel button[type="submit"]')`), 'search panel');
  assert.equal(await evaluate(`document.querySelector('.ai-search-panel button[type="submit"]').textContent`), 'AI検索を依頼');
  assert.ok((await evaluate(`[...document.querySelectorAll('.route-choice')].map(n=>n.textContent)`)).includes('AI検索軌跡'));
  await noLegacy(); await capture('01-search-and-analysis-buttons');
  await evaluate(`{const input=document.querySelector('.ai-search-panel textarea');input.value='確認';input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await click('.ai-search-panel button[type="submit"]');
  await until(() => evaluate(`!!document.querySelector('[title="AI検索の結果を再確認"]')`), 'search timeout/recheck');
  assert.equal(await evaluate(`document.querySelector('[aria-label="AI検索の依頼文"]').value`), '模擬依頼');
  await click('[title="AI検索の結果を再確認"]'); await noLegacy(); await capture('02-search-recheck');
  await click('.ai-history-header button'); await until(() => evaluate(`!!document.querySelector('[aria-label="このプロジェクトのAI検索履歴"]')`), 'search history');
  await noLegacy(); await capture('03-search-history'); await click('.ai-history-header button');
  for (let attempt = 0; attempt < 2; attempt++) {
    await click('[aria-label="AI解析"]'); await until(() => evaluate(`!!document.querySelector('dialog[open]')&&!document.querySelector('#file-analysis-instruction').disabled`), 'analysis dialog');
    assert.equal(await evaluate(`document.querySelector('#file-analysis-title').textContent`), 'AI解析');
    await noLegacy(); if (!attempt) await capture('04-analysis-dialog');
    await click('[aria-label="AI解析を閉じる"]'); await until(() => evaluate(`!document.querySelector('dialog')`), 'analysis close');
  }
  await evaluate('pinViewer()'); await noLegacy();
  assert.equal(requests.filter(r => r.method === 'PUT' && r.path === '/api/file-analysis').length, 2);
  assert.equal(requests.some(r => r.method === 'POST' && r.path === '/api/file-analysis'), false);
  await evaluate('dispose()'); assert.deepEqual(errors, []);
  console.log('PASS: real Vue/Chromium search, routes, history, retry, analysis open/close/reopen and pinned-viewer labels. Screenshots: ' + output);
} finally {
  socket?.close(); if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await sleep(150); rmSync(temporary, { recursive: true, force: true });
}
