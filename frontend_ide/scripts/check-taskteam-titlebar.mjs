// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Task/Teamの実ルートと共通開閉部品を隔離画面で確認する。業務APIと子画面はstub。
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
const output = join(root, 'temp/taskteam-titlebar-check');
const bundle = await build({
  stdin: { resolveDir: root, contents: `import {createApp,h} from 'vue';
import Panel from './src/components/タスクチーム/タスクチームパネル.vue';
window.fetch=async()=>({ok:true,json:async()=>({connected:true,port:8093})});
createApp({render:()=>h('div',{style:'height:750px'},['task','team'].map(kind=>h('div',{style:'height:360px',class:kind},[h(Panel,{config:{kind,taskTeamBase:'/mock'}})])))}).mount('#app');` },
  bundle: true, write: false, format: 'iife', plugins: [{ name: 'vue-label-check', setup(builder) {
    builder.onLoad({ filter: /タスクチーム[\\/]components[\\/].*\.vue$/ }, () => ({contents:'export default {render(){return null;}}'}));
    builder.onLoad({ filter: /タスクチーム[\\/]api[\\/]client\.ts$/ }, () => ({contents:'let value="";export function token(v){if(v!==undefined)value=v;return value;} export default {post:async()=>({data:{status:"OK",data:{利用者ID:"test"}}})};'}));
    builder.onLoad({ filter: /コード表示\.js$/ }, () => ({ contents: 'export const loadMonaco=async()=>null;export const monacoLanguage=()=>"plaintext";' }));
    builder.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor, errors } = parse(readFileSync(args.path, 'utf8'), { filename: args.path });
      assert.deepEqual(errors, []);
      const script = compileScript(descriptor, { id: 'panel-collapse-check', inlineTemplate: true });
      return { loader: descriptor.scriptSetup?.lang === 'ts' ? 'ts' : 'js', contents: script.content + `\n{const style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s => s.content).join('\n'))};document.head.append(style);}`, resolveDir: dirname(args.path) };
    });
  } }],
});
if (process.argv.includes('--compile-only')) {
  console.log('PASS: Task/Team root and shared toggle compile (business child views stubbed).'); process.exit(0);
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
  for (const kind of ['task','team']) {
    const root = '.'+kind+' .taskteam-shell', toggle = root+' .code-panel-toggle';
    const height = await evaluate(`document.querySelector('${root}').getBoundingClientRect().height`);
    await evaluate(`document.querySelector('${root} input').value='保持するID';document.querySelector('${root} input').dispatchEvent(new Event('input',{bubbles:true}))`);
    await capture(kind+'-01-expanded');
    await click(toggle); await sleep(70);
    const middle=await evaluate(`document.querySelector('${root}').getBoundingClientRect().height`);assert.ok(middle>31&&middle<height);
    await sleep(250); assert.equal(await evaluate(`document.querySelector('${root}').getBoundingClientRect().height`),31);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('${root} .connection-bar')).display`),'none');
    await capture(kind+'-02-collapsed');
    await click(toggle); await sleep(300);
    assert.equal(await evaluate(`document.querySelector('${root}').getBoundingClientRect().height`),height);
    assert.equal(await evaluate(`document.querySelector('${root} input').value`),'保持するID');
    await click(toggle);await sleep(40);await click(toggle);await sleep(300);
    assert.equal(await evaluate(`document.querySelector('${root}').getBoundingClientRect().height`),height);
    assert.equal(await evaluate(`document.querySelector('${root} input').value`),'保持するID');
    await capture(kind+'-03-restored');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: Task/Team actual root login screen: 220ms web collapse/expand, cyan bar hiding, reversal and input retention. Native Electron and authenticated child views not exercised. Screenshots: '+output);


} finally {
  socket?.close(); if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await sleep(150); rmSync(temporary, { recursive: true, force: true });
}
