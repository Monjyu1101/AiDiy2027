// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue・xterm・Chromium。WebSocketは模擬し、シェル/CLI/外部APIは起動しない。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { build } from 'esbuild';
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'console-focus-'));
const output = join(root, 'temp/console-focus-check');
mkdirSync(output, { recursive: true });
const bundle = await build({
  stdin: { contents: `import {createApp,h,ref,nextTick} from 'vue';import Panel from './src/components/コンソール/コンソールパネル.vue';import './src/style.css';import {Terminal} from '@xterm/xterm';
const open=Terminal.prototype.open;Terminal.prototype.open=function(...args){window.testTerminal=this;return open.apply(this,args);};
const shown=ref(true);window.showConsole=async value=>{shown.value=value;await nextTick();};
const app=createApp({render:()=>h(Panel,{base:'/console/',visible:shown.value,style:shown.value?'':'display:none'})});app.mount('#app');window.dispose=()=>app.unmount();`, resolveDir: root },
  bundle: true, write: false, outdir: temporary, format: 'iife',
  plugins: [{ name: 'vue', setup(build) { build.onLoad({ filter: /\.vue$/ }, args => {
    const { descriptor, errors } = parse(readFileSync(args.path, 'utf8')); assert.deepEqual(errors, []);
    const id = 'data-v-' + createHash('sha256').update(args.path).digest('hex').slice(0, 8);
    const compiled = compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs: 'component' });
    const css = descriptor.styles.map(style => {
      const result = compileStyle({ source: style.content, id, scoped: style.scoped }); assert.deepEqual(result.errors, []); return result.code;
    }).join('\n');
    return { contents: compiled.content + `\ncomponent.__scopeId=${JSON.stringify(id)};export default component;const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);`, resolveDir: dirname(args.path) };
  }); } }],
});
if (process.argv.includes('--compile-only')) {
  rmSync(temporary, { recursive: true, force: true });
  console.log('PASS: Console Vue, scoped styles, xterm and focus handlers compile without a production build.'); process.exit(0);
}
const fixture = `window.inputs=[];window.packets=[];window.sockets=[];window.WebSocket=class{static OPEN=1;readyState=1;constructor(){sockets.push(this);window.termSocket=this;setTimeout(()=>this.onopen?.(),0);}send(raw){const packet=JSON.parse(raw);packets.push(packet);if(packet.type==='input')inputs.push(packet.data);if(packet.type==='start')setTimeout(()=>this.receive({type:'ready',project:'/fixture 日本語',shell:'fixture',completion:false,toolsEnabled:true}),0);if(packet.type==='tools-check')this.receive({type:'tools',enabled:packet.enabled,online:false});}receive(packet){this.onmessage?.({data:JSON.stringify(packet)});}close(){this.readyState=3;this.onclose?.();}};`;
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>html,body{margin:0;height:100%;background:#000}#test-controls{height:36px;display:flex}#app{height:calc(100% - 36px)}#test-controls input{width:160px}#selection-text{color:white}</style><div id="test-controls"><button id="show" onclick="showConsole(true)">Console</button><input id="other" placeholder="別の入力欄"><button id="hide" onclick="showConsole(false)">非表示</button><span id="selection-text">選択してコピーする文字</span></div><div id="app"></div><script>${fixture}</script><script src="/app.js"></script>`;
const server = createServer((req, res) => {
  const file = req.url === '/app.js' ? bundle.outputFiles.find(file => file.path.endsWith('.js')) : req.url === '/app.css' ? bundle.outputFiles.find(file => file.path.endsWith('.css')) : null;
  if (file) return res.writeHead(200, { 'content-type': req.url.endsWith('.js') ? 'text/javascript' : 'text/css' }).end(file.text);
  if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(html);
  if (req.url === '/development/AiDiy.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(readFileSync(join(root, 'public/AiDiy.png')));
  res.writeHead(404).end();
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const executable = process.env.CHROME_PATH || ['/usr/bin/chromium', ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(base => join(base, 'Google/Chrome/Application/chrome.exe'))].find(existsSync);
assert.ok(executable, 'CHROME_PATH または Chromium が必要です');
const chrome = spawn(executable, ['--headless=new', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--window-size=1000,700', '--remote-debugging-port=0', `--user-data-dir=${temporary}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErrors = ''; chrome.stderr.on('data', chunk => { chromeErrors = (chromeErrors + chunk).slice(-8000); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) { if (chrome.exitCode !== null) throw Error('Chromium failed: ' + chrome.exitCode); try { port = readFileSync(join(temporary, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {} if (!port) await sleep(100); }
  assert.ok(port, 'Chromium did not open its debug endpoint: ' + chromeErrors);
  const target = (await fetch(`http://127.0.0.1:${port}/json/list`).then(res => res.json())).find(target => target.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, 'open');
  let id = 0; const pending = new Map(), errors = [];
  socket.on('message', raw => { const value = JSON.parse(raw); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const task = pending.get(value.id); if (task) { pending.delete(value.id); value.error ? task.reject(Error(JSON.stringify(value.error))) : task.resolve(value.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const until = async (expression, label = expression) => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(25); } throw Error(label); };
  const point = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  const mouse = async (type, p, extra = {}) => send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1, ...extra });
  const click = async selector => { const p = await point(selector); await mouse('mousePressed', p); await mouse('mouseReleased', p); await sleep(30); };
  const focused = `document.activeElement===document.querySelector('.xterm-helper-textarea')`;
  const type = async text => { await send('Input.insertText', { text }); await sleep(30); assert.deepEqual(await evaluate('inputs.splice(0)'), [text], 'one exact input packet without a second terminal click'); };
  const screenshot = async name => { const value = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(output, name + '.png'), Buffer.from(value.data, 'base64')); };
  await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await until(focused, 'initial ready input');
  assert.equal(await evaluate(`document.querySelector('.console-component').classList.contains('console-waiting')`), true);
  // 初期案内と余白のクリックで、入力を合成せず同じxtermへ戻す。
  await click('#other'); await click('.console-welcome'); assert.equal(await evaluate(focused), true);
  await type('日本語の入力'); await until(`!document.querySelector('.console-component').classList.contains('console-waiting')`);
  assert.equal(await evaluate('sockets.length'), 1, 'the terminal session is not recreated');
  await screenshot('01-background-input');
  for (const selector of ['.panel-brand strong', '.console-meta', '.component-toolbar > span']) {
    await click('#other'); await click(selector); assert.equal(await evaluate(focused), true, selector); await type('x');
  }
  // 端末の内側でない8pxの余白にも対応する。
  await click('#other'); const padding = await evaluate(`(()=>{const r=document.querySelector('.console-screen').getBoundingClientRect();return{x:r.left+2,y:r.top+20};})()`);
  await mouse('mousePressed', padding); await mouse('mouseReleased', padding); assert.equal(await evaluate(focused), true); await type('p');
  // ウィンドウfocus通知を再現。OS固有の非アクティブクリック順は実機で別途確認する。
  for (let i = 0; i < 3; i++) {
    await evaluate(`document.activeElement.blur();window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));`);
    await until(focused); await type('r');
  }
  await evaluate(`document.activeElement.blur();document.dispatchEvent(new Event('visibilitychange'));`); await until(focused); await type('v');
  // focus通知の直後にボタンを押しても、押下中・完了後の操作先を奪わない。
  await evaluate(`document.activeElement.blur();window.dispatchEvent(new Event('focus'));document.querySelector('.auto-connect').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));`);
  await click('.auto-connect'); assert.equal(await evaluate(`document.activeElement===document.querySelector('.auto-connect')`), true);
  assert.equal(await evaluate(`document.querySelector('.auto-connect').getAttribute('aria-checked')`), 'false');
  await evaluate(`window.dispatchEvent(new Event('focus'))`); await sleep(30); assert.equal(await evaluate(focused), false);
  await click('#other'); await evaluate(`window.dispatchEvent(new Event('focus'))`); await sleep(30);
  await send('Input.insertText', { text: '別の入力' }); assert.equal(await evaluate(`document.querySelector('#other').value`), '別の入力'); assert.deepEqual(await evaluate('inputs.splice(0)'), []);
  // DOM文字選択とxterm選択は保持し、選択したテキストをコピーできる。
  await evaluate(`(()=>{document.activeElement.blur();const selection=getSelection(),range=document.createRange();range.selectNodeContents(document.querySelector('#selection-text'));selection.removeAllRanges();selection.addRange(range);window.dispatchEvent(new Event('focus'));})()`);
  await sleep(30); assert.equal(await evaluate('getSelection().toString()'), '選択してコピーする文字'); assert.equal(await evaluate(focused), false);
  await evaluate('getSelection().removeAllRanges()');
  await evaluate(`termSocket.receive({type:'data',data:'copy selection test'})`); await sleep(100);
  const terminalPoint = await evaluate(`(()=>{const r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.left+20,y:r.top+8};})()`);
  await mouse('mousePressed', terminalPoint, { clickCount: 3 }); await mouse('mouseReleased', terminalPoint, { clickCount: 3 });
  assert.equal(await evaluate('testTerminal.hasSelection()'), true);
  const beforeSelection = await evaluate('testTerminal.getSelection()');
  assert.ok(beforeSelection.includes('copy selection test'));
  await evaluate(`document.activeElement.blur();window.dispatchEvent(new Event('focus'));`); await sleep(30); assert.equal(await evaluate(focused), false, 'terminal selection is not refocused');
  assert.equal(await evaluate('testTerminal.getSelection()'), beforeSelection);
  await screenshot('02-selection-kept');
  await mouse('mousePressed', terminalPoint); await mouse('mouseReleased', terminalPoint); await type('t');
  // 非表示Consoleと終了済み端末へは戻さず、タブ表示の明示操作では復帰する。
  await click('#hide'); await click('#other'); await evaluate(`window.dispatchEvent(new Event('focus'));`); await sleep(30); assert.equal(await evaluate(focused), false);
  await click('#show'); await until(focused); await type('s');
  assert.equal(await evaluate('sockets.length'), 1);
  await evaluate(`termSocket.receive({type:'exit',exitCode:0});document.activeElement.blur();window.dispatchEvent(new Event('focus'));`); await sleep(30); assert.equal(await evaluate(focused), false);
  await click('.component-toolbar button:last-child'); await until('sockets.length===2');
  await click('.console-welcome'); await until(focused); await type('再開');
  await screenshot('03-restored-input');
  // 待機中の復帰を残さず破棄し、キー・WebSocket送信も増えない。
  const count = await evaluate('packets.length');
  await evaluate(`window.dispatchEvent(new Event('focus'));dispose();`); await sleep(30);
  assert.equal(await evaluate(`document.querySelector('.xterm-helper-textarea')`), null);
  await evaluate(`window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));`); await sleep(30); assert.equal(await evaluate('packets.length'), count);
  assert.deepEqual(errors, []);
  console.log('PASS: actual Vue/xterm initial and repeated focus return, welcome/title/footer/padding clicks, exact Japanese input once, buttons/external input/DOM and terminal selections, hidden tabs, tab return, exit/restart and pending-focus disposal. Screenshots: ' + output);
} finally {
  socket?.close(); chrome.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await sleep(200);
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
