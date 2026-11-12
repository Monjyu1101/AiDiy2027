// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Code/Liveをコンパイルし、共通開閉部品のアニメーションと入力保持を実Vueで確認する。
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
const output = join(root, 'temp/panel-collapse-check');
const bundle = await build({
  stdin: { resolveDir: root, contents: `import {createApp,h,ref} from 'vue';
import Code from './src/components/コード/コードパネル.vue';
import Live from './src/components/ライブ/ライブパネル.vue';
import Toggle from './src/components/コード/パネル表示切替.vue';
import Status from './src/components/共通表示/状態バー.vue';

window.components=[Code,Live];
createApp({setup(){const collapsed=ref(false),hidden=ref(false);return()=>h('section',{class:'ai-component '+(hidden.value?'panel-collapsed':'')},[h(Status,{title:'AiDiy Code / Live',connected:true},{leading:()=>h(Toggle,{collapsed:collapsed.value,onToggle:()=>collapsed.value=!collapsed.value,onHidden:value=>hidden.value=value})}),h('textarea',{value:'入力と接続を保持'}),h('p','パネル本文')]);}}).mount('#app');` },
  bundle: true, write: false, format: 'iife', plugins: [{ name: 'vue-label-check', setup(builder) {
    builder.onLoad({ filter: /コード表示\.js$/ }, () => ({ contents: 'export const loadMonaco=async()=>null;export const monacoLanguage=()=>"plaintext";' }));
    builder.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor, errors } = parse(readFileSync(args.path, 'utf8'), { filename: args.path });
      assert.deepEqual(errors, []);
      const script = compileScript(descriptor, { id: 'panel-collapse-check', inlineTemplate: true });
      return { contents: script.content + `\n{const style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s => s.content).join('\n'))};document.head.append(style);}`, resolveDir: dirname(args.path) };
    });
  } }],
});
if (process.argv.includes('--compile-only')) {
  console.log('PASS: Code, Live and panel toggle Vue components compile.'); process.exit(0);
}
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'panel-collapse-check-'));
const css = readFileSync(join(root, 'src/style.css'), 'utf8');
const server = createServer((req,res)=>res.end(`<!doctype html><meta charset="utf-8"><style>${css}.panel-collapsed > :not(.panel-brand){display:none!important}</style><div id="app"></div><script>${bundle.outputFiles[0].text}</script>`));
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
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
  await until(() => evaluate(`!!document.querySelector('.code-panel-toggle')`),'panel');
  const height=await evaluate(`document.querySelector('section').getBoundingClientRect().height`);
  await capture('01-expanded');
  await click('.code-panel-toggle');await sleep(70);
  const middle=await evaluate(`document.querySelector('section').getBoundingClientRect().height`);assert.ok(middle>31&&middle<height);
  await sleep(250);assert.equal(await evaluate(`document.querySelector('section').getBoundingClientRect().height`),31);await capture('02-collapsed');
  await click('.code-panel-toggle');await sleep(70);
  assert.ok(await evaluate(`document.querySelector('section').getBoundingClientRect().height>31`));await sleep(250);
  assert.equal(await evaluate(`document.querySelector('section').getBoundingClientRect().height`),height);
  await click('.code-panel-toggle');await sleep(40);await click('.code-panel-toggle');await sleep(300);
  assert.equal(await evaluate(`document.querySelector('section').getBoundingClientRect().height`),height);
  assert.equal(await evaluate(`document.querySelector('textarea').value`),'入力と接続を保持');await capture('03-restored');assert.deepEqual(errors,[]);
  console.log('PASS: Code/Live compile, shared real Vue UI collapse/expand, intermediate animation, rapid reversal, input retention. Screenshots: '+output);

} finally {
  socket?.close(); if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await sleep(150); rmSync(temporary, { recursive: true, force: true });
}
