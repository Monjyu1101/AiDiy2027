// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 配布されたDiagの折り畳み・連打・入力保持をローカルChromiumで確認する。
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import WebSocket from '../../frontend_ide/node_modules/ws/wrapper.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const output=join(root,'backend_diag/temp/titlebar-check');mkdirSync(output,{recursive:true});
const temporary=mkdtempSync(join(tmpdir(),'diag-titlebar-'));
const server=createServer((req,res)=>{const file=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','app.js','style.css'].includes(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(join(root,'backend_diag/static',file)));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
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
  await evaluate(`document.querySelector('#token').value='synthetic-kept'`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.code-panel-mark')).width`),'22px');
  const height=await evaluate(`document.querySelector('.diag-panel').getBoundingClientRect().height`);
  await capture('01-expanded');
  await click('.code-panel-toggle');await sleep(70);
  const middle=await evaluate(`document.querySelector('.diag-panel').getBoundingClientRect().height`);assert.ok(middle>31&&middle<height);
  await sleep(250);assert.equal(await evaluate(`document.querySelector('.diag-panel').getBoundingClientRect().height`),31);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.connection-bar')).display`),'none');
  for(const selector of ['html','body','#app'])assert.equal(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`),'rgba(0, 0, 0, 0)');
  await capture('02-collapsed');
  await click('.code-panel-toggle');await sleep(70);
  assert.ok(await evaluate(`document.querySelector('.diag-panel').getBoundingClientRect().height>31`));await sleep(250);
  assert.equal(await evaluate(`document.querySelector('.diag-panel').getBoundingClientRect().height`),height);
  await click('.code-panel-toggle');await sleep(40);await click('.code-panel-toggle');await sleep(300);
  assert.equal(await evaluate(`document.querySelector('.diag-panel').getBoundingClientRect().height`),height);
  assert.equal(await evaluate(`document.querySelector('#token').value`),'synthetic-kept');await capture('03-restored');assert.deepEqual(errors,[]);
  console.log('PASS: Diag real bundled Vue collapse/expand, intermediate animation, rapid reversal, input retention and 22px glyph. Screenshots: '+output);

} finally {
  socket?.close(); if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await sleep(150); rmSync(temporary, { recursive: true, force: true });
}
