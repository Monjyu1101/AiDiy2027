// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実画面のMarkdown・画像・リンク・コード切替・再読込・ピン留めを確認する。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startDevelopment } from '../server.mjs';

const chromePath = process.env.CHROME_PATH || [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
  .filter(Boolean).flatMap(base => ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].map(path => join(base, path))).find(existsSync)
  || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chromePath) throw Error('Chrome / Edge を CHROME_PATH で指定してください。');
const temporary = mkdtempSync(join(tmpdir(), 'aidiy-markdown-ui-')), project = join(temporary, 'project');
mkdirSync(join(project, 'docs/assets'), { recursive: true });
const source = '# Markdownプレビュー\n\n日本語を**読みやすく**表示します。\n\n## 表とコード\n\n| 項目 | 値 |\n| --- | --- |\n| 商品 | AiDiy |\n| 数量 | 10 |\n\n```js\nconst message = "こんにちは";\n```\n\n- 箇条書き\n- [別のMarkdownへ](guide.md)\n- [見出しへ](#表とコード)\n\n![相対画像](assets/logo.png)\n\n<script>parent.document.body.dataset.unsafe = "yes"</script>\n';
writeFileSync(join(project, 'docs/README.md'), source);
writeFileSync(join(project, 'docs/guide.md'), '# 次のページ\n\n[戻る](README.md)');
writeFileSync(join(project, 'docs/assets/logo.png'), readFileSync(new URL('../dist/AiDiy.png', import.meta.url)));
const app = await startDevelopment(project);
await fetch(app.url + 'api/connection/offline', { method: 'POST' });
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'browser')}`,
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote'] : []), 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(check, label) { for (let n = 0; n < 300; n++) { if (await check()) return; await sleep(100); } throw Error('待機タイムアウト: ' + label); }
const sockets = [];
async function client(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl); sockets.push(socket); await once(socket, 'open');
  let id = 0; const pending = new Map();
  socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id) { pending.get(data.id)?.(data); pending.delete(data.id); } });
  const send = (method, params = {}) => new Promise(done => { pending.set(++id, done); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression, contextId) => {
    const response = await send('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true, userGesture: true });
    assert.equal(response.result?.exceptionDetails, undefined, JSON.stringify(response.result?.exceptionDetails));
    return response.result?.result?.value;
  };
  async function child(expression) {
    const tree = await send('Page.getFrameTree'), frame = tree.result?.frameTree.childFrames?.[0]?.frame;
    if (!frame) return null;
    const world = await send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'markdown-check' });
    return evaluate(expression, world.result.executionContextId);
  }
  await send('Page.enable'); await send('Runtime.enable');
  return { send, evaluate, child };
}
const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(/\D/g, '');
let sequence = 0;
async function capture(browser, label) {
  const result = await browser.send('Page.captureScreenshot', { format: 'png' });
  const folder = resolve('temp/markdown-preview-check'); mkdirSync(folder, { recursive: true });
  const path = join(folder, `${stamp}_${String(++sequence).padStart(2, '0')}_${label}.png`);
  writeFileSync(path, Buffer.from(result.result.data, 'base64')); console.log(path);
}
try {
  await until(() => existsSync(join(temporary, 'browser/DevToolsActivePort')), 'Chrome起動');
  const port = readFileSync(join(temporary, 'browser/DevToolsActivePort'), 'utf8').split('\n')[0];
  const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  let target; await until(async () => { target = (await targets()).find(page => page.type === 'page'); return !!target; }, '画面');
  const browser = await client(target), { send, evaluate, child } = browser;
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: app.url });
  await until(() => evaluate('!!window.aidiyIDE?.world'), 'IDE');
  await evaluate(`window.aidiyIDE.setAutoSpin(false);void window.aidiyIDE.goTo({type:'file',path:'docs/README.md'})`);
  await until(() => child(`document.querySelector('h1')?.textContent==='Markdownプレビュー'&&document.querySelector('img')?.naturalWidth>0`), '見出しと相対画像');
  assert.equal(await child(`document.querySelectorAll('table tbody tr').length`), 2);
  assert.equal(await child(`document.querySelector('code.language-js').textContent.includes('こんにちは')`), true);
  assert.equal(await evaluate(`document.body.dataset.unsafe===undefined`), true);
  assert.equal(await child(`(()=>{try{parent.document.body;return false;}catch{return true;}})()`), true);
  await capture(browser, 'markdown-landscape');
  await evaluate(`document.querySelector('.viewer-mode button').click()`);
  await until(() => evaluate(`getComputedStyle(document.querySelector('.viewer-code')).display!=='none'`), 'コード切替');
  await until(() => evaluate(`document.querySelector('.viewer-code').textContent.replaceAll('\\u00a0',' ').includes('# Markdownプレビュー')`), 'Markdownソース');
  await evaluate(`document.querySelectorAll('.viewer-mode button')[1].click()`);
  await until(() => child(`document.querySelector('h1')?.textContent==='Markdownプレビュー'`), 'プレビューへ戻る');
  await child(`document.querySelector('a[href="guide.md"]').click();true`);
  await until(() => child(`document.querySelector('h1')?.textContent==='次のページ'`), '別Markdownリンク');
  writeFileSync(join(project, 'docs/README.md'), source.replace('Markdownプレビュー', '更新されたMarkdown'));
  await evaluate(`document.querySelector('.viewer-refresh').click()`);
  await until(() => child(`document.querySelector('h1')?.textContent==='更新されたMarkdown'`), '再読込');
  await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(200); await capture(browser, 'markdown-portrait');
  await evaluate(`document.querySelector('.viewer-pin').click()`);
  let pinned; await until(async () => { pinned = (await targets()).find(page => page.type === 'page' && page.title.startsWith('AiDiy IDE / Viewer - ')); return !!pinned; }, 'ピン留め');
  const pin = await client(pinned);
  await until(() => pin.child(`document.querySelector('h1')?.textContent==='更新されたMarkdown'`), '独立ビューア');
  assert.equal(await pin.evaluate(`!!document.querySelector('.viewer-pinned')`), true);
  await capture(pin, 'markdown-pinned');
  console.log('MARKDOWN PASS: 見出し・表・コード・相対画像・リンク・隔離・コード切替・再読込・ピン留め・縦横画面');
} finally {
  for (const socket of sockets) socket.close(); chrome.kill(); await app.close();
  if (chrome.exitCode === null) await once(chrome, 'exit');
  rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
