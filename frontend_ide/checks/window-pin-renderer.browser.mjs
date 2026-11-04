// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 本番Vue/CSSをローカルfixtureだけで描画。AI・tools・外部ページへ接続しない。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
const root = fileURLToPath(new URL('../', import.meta.url));
const profile = mkdtempSync(join(tmpdir(), 'aidiy-pin-renderer-'));
const output = process.env.AIDIY_PIN_RENDERER_SHOT || join(tmpdir(), `aidiy-pin-renderer-${Date.now()}.png`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = `
import { createApp, h } from 'vue';
import StatusBar from '/src/components/共通表示/状態バー.vue';
import FileViewer from '/src/components/ファイル閲覧/ファイルビューア.vue';
import { mountPanelTitle } from '/src/components/ファイル閲覧/別窓タイトル.js';
import '/src/style.css';
import '/src/components/共通表示/会話表示.css';
const embedded=document.createElement('section');embedded.className='development-app space-view';embedded.dataset.kind='embeddedViewer';document.body.append(embedded);
const viewerState={pins:0,closes:0};
createApp({render:()=>h(FileViewer,{file:{name:'sample.bin',path:'sample.bin'},root:'/fixture',onPin:()=>viewerState.pins++,onClose:()=>viewerState.closes++})}).mount(embedded);
const apis = {};
function api(name, pinned=false, locked=false) {
 let state={pinned,locked}, listeners=new Set();
 const result={calls:0,closed:0,pinState:async()=>({...state}),isMaximized:async()=>false,
  minimize:async()=>{},maximize:async()=>{},close:async()=>{result.closed++;},
  togglePin:async()=>{result.calls++;if(!state.locked)state={...state,pinned:!state.pinned};result.emit(state);return {...state};},
  onPinChanged:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  emit:value=>{state={...value};for(const fn of listeners)fn(value);},
  count:()=>listeners.size};
 return apis[name]=result;
}
const hosts = ['IDE','Code','Live','Console','Viewer','Browser'];
for (const [index,name] of hosts.entries()) {
 const section=document.createElement('section'); section.dataset.kind=name;
 section.className=name==='Code'?'code-component':name==='Live'?'live-component':'';
 document.body.append(section);
 const title=name==='Code'?'AiDiy IDE / Code':name==='Live'?'AiDiy IDE / Live':'AiDiy '+name;
 createApp({render:()=>h(StatusBar,{title,status:index===0?'単独起動：OFF':index===1?'IDEから起動：ON':index===2?'VRモード：固定':'単独起動：OFF',desktop:true,windowApi:api(name,index===1||index===2,index===2)})}).mount(section);
}
const listeners=new Set(), panels={explorer:{pinned:true,locked:false},comparison:{pinned:true,locked:false},routes:{pinned:true,locked:true}};
const panelCalls=[];
const ownerState=document.createElement('div');ownerState.className='development-app ide';ownerState.style.display='none';ownerState.innerHTML='<div class="ide-heading"><div class="connection-bar offline"></div></div>';document.body.append(ownerState);
window.aidiyWindow={
 onPinChanged:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
 panelAction:async(name,action)=>{panelCalls.push([name,action]);if(action==='isMaximized')return false;if(action==='toggle-pin'&&!panels[name].locked)panels[name].pinned=!panels[name].pinned;return {...panels[name]};}
};
const unmount=[],restores=[];
for(const name of ['explorer','comparison']){
 const host=document.createElement('section');host.dataset.kind=name;document.body.append(host);
 const child={name,document,addEventListener:window.addEventListener.bind(window),removeEventListener:window.removeEventListener.bind(window)};
 unmount.push(mountPanelTitle(host,child,window,name==='explorer'?'Explorer':'ソース比較',name==='explorer'?'explorer':'panel-viewer'));
}
const route=document.createElement('section');route.dataset.kind='routes';route.className='routes-window native-route-window';route.innerHTML='<div class="explorer-routes"><div class="route-controls"><button class="burger-button route-burger" aria-label="軌跡バーを閉じる"><span class="burger burger-v" aria-hidden="true"><i></i><i></i><i></i></span></button><button class="route-choice" title="閲覧軌跡">閲覧軌跡</button><button class="route-choice" title="検索軌跡">検索軌跡</button><button class="route-choice" title="AiDiy検索軌跡">AiDiy検索軌跡</button><button>ルート</button><button>&lt;</button><button>&gt;</button></div></div>';document.body.append(route);
const bar=route.querySelector('.route-controls'),beforeHeight=bar.getBoundingClientRect().height;
unmount.push(mountPanelTitle(bar,{name:'routes',document,addEventListener:window.addEventListener.bind(window),removeEventListener:window.removeEventListener.bind(window)},window,'軌跡','panel-routes',{restore:()=>restores.push('routes')}));
window.fixture={viewerState,apis,panels,panelCalls,restores,beforeHeight,setAllDisplays:value=>ownerState.classList.toggle('all-displays',value),emitPanel:(name,value)=>{panels[name]=value;for(const fn of listeners)fn({panelName:name,...value});},cleanup:()=>unmount.forEach(fn=>fn()),listenerCount:()=>listeners.size};
`;
const server = await createServer({
  root, configFile: false, plugins: [vue(), {
    name: 'pin-renderer-fixture',
    resolveId(id) { if (id === '/__pin_fixture.mjs') return '\0pin-renderer-fixture'; },
    load(id) { if (id === '\0pin-renderer-fixture') return fixture; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url.startsWith('/api/file')) { res.setHeader('Content-Type','application/json');res.end(JSON.stringify({kind:'binary',size:0,versions:[]}));return; }
        if (req.url !== '/__pin_fixture') return next();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><style>html,body{overflow:auto!important;height:auto!important}body{padding:20px!important;background:#080c16!important}section{margin-bottom:18px;background:#000;width:760px;border:1px solid #26394a}[data-kind=embeddedViewer] .viewer-popup{position:relative;inset:auto;width:auto;animation:none}[data-kind=embeddedViewer]{width:760px}.routes-window{width:360px;height:auto!important}.panel-brand{--muted:#9aa7b8;--surface:#080c16;--hover-surface:#202737}</style><body><script type="module" src="/__pin_fixture.mjs"></script></body></html>');
      });
    },
  }], server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
if (process.env.AIDIY_PIN_RENDERER_SERVE === '1') {
  console.log(`PIN RENDERER FIXTURE: http://127.0.0.1:${server.httpServer.address().port}/__pin_fixture`);
  const close = async () => { await server.close(); rmSync(profile, { recursive: true, force: true }); process.exit(0); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  await new Promise(() => {});
}
const browser = spawn(process.env.CHROME_PATH || '/usr/bin/chromium', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let socket;
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { await sleep(50); } }
  assert.ok(port, 'Chrome / Chromiumを起動できません。');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let sequence = 0; const pending = new Map(), errors = [];
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); } if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); });
  const send = (method, params = {}) => new Promise(resolve => { pending.set(++sequence, resolve); socket.send(JSON.stringify({ id: sequence, method, params })); });
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert.equal(result.result?.exceptionDetails, undefined, JSON.stringify(result.result)); return result.result.result.value; }
  async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(50); } assert.fail(expression); }
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/__pin_fixture` });
  await until('!!window.fixture && document.querySelectorAll(".window-pin").length===9');
  await until('!document.querySelector("[data-kind=IDE] .window-pin").disabled');
  for (const size of ['10px','18px']) {
    await evaluate(`document.documentElement.style.setProperty('--file-font-size','${size}')`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-kind=embeddedViewer] .viewer-pin span')).fontSize`), '14px');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-kind=embeddedViewer] header>span')).fontSize`), size);
  }
  await evaluate(`document.documentElement.style.setProperty('--file-font-size','10px');document.querySelector('[data-kind=embeddedViewer] .viewer-pin').click();document.querySelector('[data-kind=embeddedViewer] .viewer-close').click()`);
  assert.deepEqual(await evaluate('fixture.viewerState'),{pins:1,closes:1});
  for (const kind of ['IDE','Code','Viewer']) assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-kind=${kind}] .window-pin span')).fontSize`),'14px');
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('[data-kind=IDE] .window-actions').children).map(b=>b.className||b.getAttribute('aria-label'))`), ['最小化', '最大化', 'window-pin', 'window-close']);
  assert.equal(await evaluate(`document.querySelector('[data-kind=IDE] .window-pin').getAttribute('aria-pressed')`), 'false');
  assert.equal(await evaluate(`document.querySelector('[data-kind=Code] .window-pin').getAttribute('aria-pressed')`), 'true');
  assert.equal(await evaluate(`document.querySelector('[data-kind=Live] .window-pin').disabled`), true);
  assert.match(await evaluate(`document.querySelector('[data-kind=Live] .window-pin').title`), /VRモード中/);
  assert.match(await evaluate(`getComputedStyle(document.querySelector('[data-kind=IDE] .window-pin')).boxShadow`), /inset/);
  await evaluate(`document.querySelector('[data-kind=IDE] .window-pin').click()`);
  await until(`document.querySelector('[data-kind=IDE] .window-pin').getAttribute('aria-pressed')==='true'`);
  await evaluate(`fixture.apis.IDE.emit({pinned:true,locked:true});fixture.apis.Live.emit({pinned:true,locked:false})`);
  await until(`document.querySelector('[data-kind=IDE] .window-pin').disabled&&!document.querySelector('[data-kind=Live] .window-pin').disabled`);
  await evaluate(`document.querySelector('[data-kind=IDE] .window-pin').click()`);
  assert.equal(await evaluate('fixture.apis.IDE.calls'), 1);
  await evaluate(`fixture.emitPanel('comparison',{pinned:false,locked:false})`);
  await until(`document.querySelector('[data-kind=comparison] .window-pin').getAttribute('aria-pressed')==='false'`);
  assert.equal(await evaluate(`document.querySelector('[data-kind=explorer] .window-pin').getAttribute('aria-pressed')`), 'true');
  await evaluate(`document.querySelector('[data-kind=explorer] .window-pin').click()`);
  await until(`document.querySelector('[data-kind=explorer] .window-pin').getAttribute('aria-pressed')==='false'`);
  assert.equal(await evaluate(`fixture.panelCalls.some(([name,action])=>name==='explorer'&&action==='toggle-pin')`), true);
  await evaluate(`document.querySelector('[data-kind=routes] .panel-return').click()`);
  assert.deepEqual(await evaluate('fixture.restores'), ['routes']);
  await evaluate('fixture.setAllDisplays(true)');
  await until(`document.querySelector('[data-kind=explorer] .window-close').disabled`);
  assert.equal(await evaluate(`document.querySelector('[data-kind=routes] .panel-return')`), null);
  assert.equal(await evaluate(`document.querySelector('[data-kind=routes] .window-close')`), null);
  assert.equal(await evaluate(`document.querySelectorAll('[data-kind=explorer] .window-actions button').length`), 4);
  assert.equal(await evaluate(`document.querySelector('[data-kind=comparison] .window-close').disabled`), false);
  await evaluate('fixture.setAllDisplays(false)');
  await until(`!document.querySelector('[data-kind=explorer] .window-close').disabled`);
  assert.equal(await evaluate(`document.querySelector('[data-kind=routes] .window-close')`), null);
  assert.equal(await evaluate(`document.querySelector('[data-kind=routes] .route-controls').getBoundingClientRect().height`), await evaluate('fixture.beforeHeight'));
  assert.equal(await evaluate(`document.querySelector('[data-kind=routes]').getBoundingClientRect().width`), 360);
  assert.equal(await evaluate(`document.querySelector('[data-kind=routes] [aria-label="最大化"]')`), null);
  assert.equal(await evaluate(`document.querySelector('[data-kind=routes] [aria-label="最小化"]')`), null);
  await evaluate(`fixture.apis.IDE.emit({pinned:false,locked:false});fixture.apis.Live.emit({pinned:true,locked:true})`);
  await until(`document.querySelector('[data-kind=IDE] .window-pin').getAttribute('aria-pressed')==='false'`);
  await evaluate(`fixture.setAllDisplays(true);fixture.emitPanel('explorer',{pinned:true,locked:true});fixture.emitPanel('comparison',{pinned:true,locked:true})`);
  assert.equal(await evaluate(`document.querySelector('[data-kind=routes] .window-close')`), null);
  const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(output, Buffer.from(shot.result.data, 'base64'));
  await evaluate('fixture.cleanup()'); assert.equal(await evaluate('fixture.listenerCount()'), 0);
  assert.deepEqual(errors, []);
  console.log(`PIN RENDERER PASS: 9 surfaces, OFF/ON/VR, action ordering, panel isolation, same route dimensions, unsubscribe. Screenshot: ${output}`);
} finally {
  socket?.close(); browser.kill(); await server.close();
  await sleep(100); rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
