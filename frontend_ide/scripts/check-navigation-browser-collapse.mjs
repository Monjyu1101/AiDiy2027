// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Navi・Browser・Navi別窓を実Vueで確認する。Native窓のIPCだけ模擬し、実OSの窓変更は別途確認する。
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'temp/navigation-browser-collapse-check');
const bundle = await build({
  stdin: { resolveDir: root, contents: `import {createApp,h,ref} from 'vue';
import Navi from './src/components/開発スペース/Naviパネル.vue';
import Browser from './src/components/ブラウザ/ブラウザパネル.vue';
import Viewer from './src/components/ファイル閲覧/閲覧ウィンドウ.vue';
import {mountPanelTitle} from './src/components/ファイル閲覧/別窓タイトル.js';
const kind=location.hash.slice(1)||'navi';
window.fetch=async()=>({ok:true,json:async()=>({result:null,job:null,active:true,startedAt:1,project:{path:'/tmp/project'},connected:true,mode:'online',availability:{available:true}})});
window.aidiyWindow={title:async()=> 'AiDiy Browser',pinState:async()=>({pinned:false}),onPinChanged:()=>()=>{},onBrowserChanged:()=>()=>{},browserAction:async()=>({ok:true,url:'https://example.test/',title:'日本語ページ',available:true,connected:true}),async collapsePanel(collapsed){const el=document.querySelector('.ai-component');const height=el.getBoundingClientRect().height;el.style.height=collapsed?'31px':'700px';const animation=el.animate([{height:height+'px'},{height:collapsed?'31px':'700px'}],{duration:220});await animation.finished;return{ok:true};}};
if(['child','explorer','panel-viewer'].includes(kind)){
 const host=document.createElement('main');host.className='development-app native-panel-window '+(kind==='child'?'navigation-window':kind==='explorer'?'explorer-window':'viewer-window');host.style.height='700px';document.querySelector('#app').append(host);
 mountPanelTitle(host,window,window,kind==='child'?'Navi 1':'Viewer / Explorer',kind==='child'?'panel-navigation':kind);
 const textarea=document.createElement('textarea');textarea.value='別窓の入力を保持';host.append(textarea);
}else createApp(kind==='viewer'?Viewer:kind==='browser'?Browser:Navi,{desktop:true,path:'sample.txt',standalone:true,instance:'navi-check',project:{path:'/tmp/project',name:'確認プロジェクト'}}).mount('#app');
` },
  bundle: true, write: false, format: 'iife', loader: {'.css':'empty'}, plugins: [{ name: 'vue-label-check', setup(builder) {
    builder.onLoad({ filter: /コード表示\.js$/ }, () => ({ contents: 'export const loadMonaco=async()=>null;export const monacoLanguage=()=>"plaintext";' }));
    builder.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor, errors } = parse(readFileSync(args.path, 'utf8'), { filename: args.path });
      assert.deepEqual(errors, []);
      const id='data-v-collapse-'+Buffer.from(args.path).toString('hex');
      const script = compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs:'component' });
      const css=descriptor.styles.map(style=>{const result=compileStyle({source:style.content,id,scoped:style.scoped});assert.deepEqual(result.errors,[]);return result.code;}).join('\n');
      return { contents: script.content + `\ncomponent.__scopeId=${JSON.stringify(id)};export default component;{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);}`, resolveDir: dirname(args.path) };
    });
  } }],
});
if (process.argv.includes('--compile-only')) {
  console.log('PASS: Navi, Browser and detached title Vue components compile.'); process.exit(0);
}
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'panel-collapse-check-'));
const css = readFileSync(join(root, 'src/style.css'), 'utf8')+readFileSync(join(root, 'src/components/共通表示/会話表示.css'), 'utf8')+'html,body,#app{height:700px}.ai-component{height:700px}';
const server = createServer((req,res)=>res.end(`<!doctype html><meta charset="utf-8"><style>${css}</style><div id="app"></div><script>${bundle.outputFiles[0].text}</script>`));
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
  await send('Runtime.enable'); await send('Page.enable');
  for(const kind of ['navi','browser','child','explorer','panel-viewer']){
   await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/#${kind}`});
   await until(()=>evaluate(`!!document.querySelector('.code-panel-toggle')`),'panel');await sleep(100);
   const input=kind==='browser'?'.browser-toolbar input':'textarea';
   const value=await evaluate(`document.querySelector(${JSON.stringify(input)}).value`);
   await capture(kind+'-01-expanded');
   await click('.code-panel-toggle');await sleep(70);
   const middle=await evaluate(`document.querySelector('.ai-component').getBoundingClientRect().height`);assert.ok(middle>31&&middle<700,kind+' intermediate');
   await sleep(250);assert.equal(await evaluate(`document.querySelector('.ai-component').getBoundingClientRect().height`),31);
   assert.equal(await evaluate(`document.querySelector('.connection-bar').getBoundingClientRect().height`),0,kind+' cyan hidden');
   await capture(kind+'-02-collapsed');
   await click('.code-panel-toggle');await sleep(300);
   assert.equal(await evaluate(`document.querySelector('.ai-component').getBoundingClientRect().height`),700);
   assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).value`),value);
   await capture(kind+'-03-restored');
  }
  assert.deepEqual(errors,[]);console.log('PASS: Navi/Browser/detached Navi real Vue collapse and expand, intermediate size, cyan hidden, input retained. Native IPC is mocked. '+output);

} finally {
  socket?.close(); if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await sleep(150); rmSync(temporary, { recursive: true, force: true });
}
