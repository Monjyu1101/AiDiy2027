// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 模擬toolsと実ブラウザで、10秒間隔の確認中も接続済み表示を維持することを確認する。
// ルートから node frontend_ide/scripts/check-connection.mjs。CHROME_PATHでブラウザを指定可能。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCoreConnection } from '../viewer/core-connection.mjs';
import { startDevelopment } from '../server.mjs';

const chromePath = process.env.CHROME_PATH || [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
  .filter(Boolean).flatMap(base => ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].map(tail => join(base, tail))).find(existsSync)
  || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chromePath) throw Error('Chrome / Edge が見つかりません。CHROME_PATH を指定してください。');
const temporary = mkdtempSync(join(tmpdir(), 'aidiy-connection-check-'));
const project = join(temporary, 'project'); mkdirSync(project);
writeFileSync(join(project, 'README.md'), '# 接続表示の検証\n', 'utf8');
const calls = [], replies = new Set(); let healthy = true;
const core = createServer((req, res) => {
  assert.equal(req.url, '/aidiy_code_agents/ping'); assert.equal(req.method, 'GET');
  calls.push(Date.now()); req.resume();
  const reply = () => {
    if (res.destroyed) return;
    res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'error', name: 'aidiy_code_agents' }));
  };
  if (calls.length === 1 || !healthy) reply();
  else { const timer = setTimeout(() => { replies.delete(timer); reply(); }, 800); replies.add(timer); }
});
await new Promise(done => core.listen(0, '127.0.0.1', done));
const connection = createCoreConnection(project, { target: `http://127.0.0.1:${core.address().port}` });
const app = await startDevelopment(project, { connection });
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'browser')}`,
  '--window-size=1280,800', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(check, label) { const end = Date.now() + 30000; while (Date.now() < end) { if (await check()) return; await sleep(100); } throw Error(`待機タイムアウト: ${label}`); }
let socket;
try {
  const activePort = join(temporary, 'browser', 'DevToolsActivePort');
  await until(() => existsSync(activePort), 'ブラウザ起動');
  const { readFileSync } = await import('node:fs');
  const port = readFileSync(activePort, 'utf8').split('\n')[0];
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, 'open');
  let id = 0; const pending = new Map(), errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise(done => { pending.set(++id, done); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.result?.exceptionDetails, undefined, JSON.stringify(result.result?.exceptionDetails));
    return result.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.connectionPolls=[];const nativeFetch=window.fetch;window.fetch=(input,...args)=>{if(new URL(input,location.href).pathname==='/api/connection')window.connectionPolls.push(performance.now());return nativeFetch(input,...args);};` });
  await send('Page.navigate', { url: app.url });
  await until(() => evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='AiDiy接続利用')`), '起動画面');
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='AiDiy接続利用').click()`);
  const label = `document.querySelector('.ide-heading .connection-label')?.textContent.trim()`;
  await until(async () => (await evaluate(label)) === '接続済', '接続成立');
  const startedAt = connection.state().startedAt;
  await evaluate(`window.connectionLabels=[];new MutationObserver(()=>window.connectionLabels.push(${label})).observe(document.querySelector('.ide-heading .connection-label'),{childList:true,subtree:true,characterData:true});`);
  const folder = resolve('temp/connection-check'); mkdirSync(folder, { recursive: true });
  const stamp = new Date(Date.now() + 9 * 3600000).toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '_');
  async function capture(name) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const path = join(folder, `${stamp}_${name}.png`); writeFileSync(path, Buffer.from(shot.result.data, 'base64')); console.log(path);
  }
  await until(() => calls.length >= 2, '10秒後の定期確認');
  assert.equal(connection.state().connecting, false);
  assert.equal(await evaluate(label), '接続済');
  await capture('01_connected-checking');
  await until(async () => calls.length >= 3 && (await evaluate('window.connectionPolls.length')) >= 3, '次の10秒周期');
  assert.equal(await evaluate(label), '接続済');
  assert.deepEqual(await evaluate('window.connectionLabels'), []);
  const polls = await evaluate('window.connectionPolls');
  for (let i = 1; i < polls.length; i++) assert.ok(polls[i] - polls[i - 1] >= 9800, `状態取得が頻繁です: ${polls}`);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i] - calls[i - 1] >= 9800, `tools確認が頻繁です: ${calls}`);
  healthy = false;
  await until(async () => !connection.state().connected && (await evaluate(label)) === '未接続', 'tools停止');
  assert.equal(connection.state().active, true); assert.equal(connection.state().startedAt, startedAt);
  await capture('02_disconnected');
  healthy = true;
  await until(async () => (await evaluate(label)) === '接続済', '同じセッションで復帰');
  assert.equal(connection.state().startedAt, startedAt);
  await capture('03_reconnected'); assert.deepEqual(errors, []);
  console.log('CONNECTION PASS: 10秒周期、確認中の表示維持、切断検出、セッションを維持した再接続');
} finally {
  socket?.close(); const exited = once(chrome, 'exit'); chrome.kill(); await exited;
  await app.close(); connection.close(); for (const timer of replies) clearTimeout(timer);
  core.closeAllConnections(); await new Promise(done => core.close(done));
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
