// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実IDEでOffice/PDFの描画・操作とMonacoとの切替を確認する。原本は変更しない。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startDevelopment } from '../server.mjs';
import { createFixtures } from '../viewer/checks/fixtures.mjs';

const chromePath = process.env.CHROME_PATH || [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
  .filter(Boolean).flatMap(base => ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].map(path => join(base, path))).find(existsSync)
  || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chromePath) throw Error('Chrome / Edge を CHROME_PATH で指定してください。');
const temporary = mkdtempSync(join(tmpdir(), 'aidiy-office-ui-')), project = join(temporary, 'project');
await createFixtures(project);
copyFileSync(new URL('../../AiDiy概要.pptx', import.meta.url), join(project, 'sample.pptx'));
const app = await startDevelopment(project);
await fetch(app.url + 'api/connection/offline', { method: 'POST' });
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'browser')}`,
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote'] : []), 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(check, label) { for (let n = 0; n < 450; n++) { if (await check()) return; await sleep(100); } throw Error('待機タイムアウト: ' + label); }
const errors = [], sockets = [];
async function client(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl); sockets.push(socket); await once(socket, 'open');
  let id = 0; const pending = new Map();
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id) { pending.get(data.id)?.(data); pending.delete(data.id); }
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    if (data.method === 'Network.responseReceived' && data.params.response.status >= 400 && !data.params.response.url.endsWith('/favicon.ico')) errors.push(`${data.params.response.status}: ${data.params.response.url}`);
  });
  const send = (method, params = {}) => new Promise(done => { pending.set(++id, done); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression, contextId) => {
    const response = await send('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.error || response.result?.exceptionDetails) throw Error(JSON.stringify(response));
    return response.result?.result?.value;
  };
  async function child(expression) {
    const tree = await send('Page.getFrameTree'), frame = tree.result?.frameTree.childFrames?.find(item => item.frame.url.includes('/office.html'))?.frame;
    if (!frame) return null;
    const world = await send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'office-check' });
    if (!world.result) return null;
    return evaluate(expression, world.result.executionContextId);
  }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  return { send, evaluate, child };
}
const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(/\D/g, '');
let sequence = 0;
async function capture(browser, label) {
  // 到着アニメーションが終わってから文字を撮影する。
  await sleep(350);
  const result = await browser.send('Page.captureScreenshot', { format: 'png' });
  const folder = resolve('temp/office-viewer-check'); mkdirSync(folder, { recursive: true });
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
  await evaluate('window.aidiyIDE.setAutoSpin(false)');
  const open = async path => {
    await evaluate(`void window.aidiyIDE.goTo({type:'file',path:${JSON.stringify(path)}})`);
    await until(() => evaluate(`document.querySelector('.viewer-popup>header>span')?.textContent===${JSON.stringify(path)}`), path);
  };
  const healthy = () => child(`document.getElementById('notice')?.hidden&&!document.getElementById('notice')?.classList.contains('error')`);
  await open('sample.js');
  await until(() => evaluate('!!document.querySelector(".monaco-editor")&&!!window.monaco?.editor'), 'Monaco');
  await open('日本語文書.docx');
  await until(() => child(`document.querySelectorAll('section.docx').length===2&&document.getElementById('page-status').textContent==='1 / 2'&&[...document.querySelectorAll('section.docx')].filter(page=>!page.hidden).length===1&&document.querySelector('section.docx:not([hidden])')?.textContent.includes('Wordの日本語')`), 'Word日本語と先頭ページ');
  assert.equal(await healthy(), true);
  assert.equal(await evaluate(`!!window.monaco?.editor&&typeof document.querySelector('iframe').contentWindow.require==='undefined'`), true, 'Office iframeはAMDローダーを共有しない');
  assert.equal(await child(`document.getElementById('page-top').hidden&&!document.getElementById('page-bottom').hidden`), true, 'Word先頭は次ページだけ案内');
  await capture(browser, 'word');
  await child(`document.getElementById('page-next').click();true`);
  await until(() => child(`document.getElementById('page-status').textContent==='2 / 2'&&document.querySelector('section.docx:not([hidden])')?.textContent.includes('2ページ目')`), 'Word次ページ');
  assert.equal(await child(`!document.getElementById('page-top').hidden&&document.getElementById('page-bottom').hidden&&document.getElementById('content').scrollTop===0`), true, 'Word最終ページは前ページだけ案内');
  await capture(browser, 'word-page2');
  await child(`document.getElementById('page-previous').click();true`);
  await until(() => child(`document.getElementById('page-status').textContent==='1 / 2'&&document.querySelector('section.docx:not([hidden])')?.textContent.includes('Wordの日本語')`), 'Word前ページ');
  await child(`document.getElementById('zoom').value='1.5';document.getElementById('zoom').dispatchEvent(new Event('change'));true`);
  await until(() => child(`document.querySelector('.word-pages').style.zoom==='1.5'`), 'Word倍率');
  // ファイルを一時プロジェクトでだけ書き換え、親ビューアの⟳で新しい本文を確認する。
  const docx = await import('../viewer/node_modules/jszip/lib/index.js');
  const zip = await docx.default.loadAsync(readFileSync(join(project, '日本語文書.docx')));
  const xml = await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml', xml.replace('Wordの日本語表示を確認します。', '再読込後の日本語表示です。'));
  writeFileSync(join(project, '日本語文書.docx'), await zip.generateAsync({ type: 'nodebuffer' }));
  await evaluate(`document.querySelector('.viewer-refresh').click()`);
  await until(() => child(`document.getElementById('content').textContent.includes('再読込後の日本語')`), 'Word再読込');
  await open('売上.xlsx');
  await until(() => child(`document.querySelectorAll('#sheets button').length===3&&document.querySelector('table')?.textContent.includes('サンプル商品')`), 'Excel');
  assert.equal(await child(`document.querySelector('td[title="数式: =B2*C2"]')?.textContent`), '3,600');
  assert.equal(await child(`document.querySelector('table img')===null`), true, 'セル値をHTMLとして解釈しない');
  await capture(browser, 'excel');
  await child(`document.querySelectorAll('#sheets button')[1].click();true`);
  await until(() => child(`document.getElementById('page-status').textContent.includes('1–200 / 205')`), '明細200行');
  await child(`document.getElementById('next').click();true`);
  await until(() => child(`document.getElementById('page-status').textContent.includes('201–205 / 205')`), '明細次ページ');
  await child(`document.querySelectorAll('#sheets button')[2].click();true`);
  await until(() => child(`!!document.querySelector('td[rowspan="2"][colspan="3"]')`), '結合セル');
  await open('一覧.csv');
  await until(() => child(`document.querySelector('table')?.textContent.includes('サンプル')`), 'CSV');
  await open('sample.pdf');
  await until(() => child(`document.getElementById('page-status').textContent==='1 / 2'&&document.querySelector('canvas')?.width>0`), 'PDF');
  assert.equal(await healthy(), true);
  const pdfFirst = await child(`document.querySelector('canvas').toDataURL()`);
  await capture(browser, 'pdf');
  await child(`document.getElementById('next').click();true`);
  await until(() => child(`document.getElementById('page-status').textContent==='2 / 2'`), 'PDF次ページ');
  assert.notEqual(await child(`document.querySelector('canvas').toDataURL()`), pdfFirst);
  await child(`document.getElementById('zoom').value='2';document.getElementById('zoom').dispatchEvent(new Event('change'));true`);
  await until(() => child(`document.querySelector('canvas').style.width==='1190px'&&!document.getElementById('previous').disabled`), 'PDF倍率');
  await open('sample.pptx');
  await until(() => child(`document.getElementById('page-status').textContent.startsWith('1 / ')&&document.querySelector('canvas')?.width>0&&!document.getElementById('next').disabled`), 'PowerPoint');
  assert.equal(await healthy(), true);
  const slideFirst = await child(`document.querySelector('canvas').toDataURL()`);
  await capture(browser, 'powerpoint');
  await child(`document.getElementById('next').click();true`);
  await until(() => child(`document.getElementById('page-status').textContent.startsWith('2 / ')`), 'PowerPoint次スライド');
  assert.notEqual(await child(`document.querySelector('canvas').toDataURL()`), slideFirst);
  await child(`document.getElementById('zoom').value='1.5';document.getElementById('zoom').dispatchEvent(new Event('change'));true`);
  await until(() => child(`document.querySelector('canvas').style.width==='1440px'&&!document.getElementById('next').disabled`), 'PowerPoint倍率');
  await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(500); assert.equal(await healthy(), true); await capture(browser, 'powerpoint-portrait');
  await open('sample.js');
  await until(() => evaluate('!!document.querySelector(".monaco-editor")&&!document.querySelector("iframe")'), 'OfficeからMonacoへ');
  await open('broken.docx');
  await until(() => child(`document.getElementById('notice').classList.contains('error')`), '壊れた文書の説明');
  await capture(browser, 'broken-document');
  await open('日本語文書.docx');
  await until(() => child(`document.querySelectorAll('section.docx').length===2`), 'エラー後の文書切替');
  await evaluate(`document.querySelector('[aria-label="プレビューを閉じる"]').click()`);
  await until(() => evaluate('!document.querySelector("iframe")'), 'Office iframeの破棄');
  assert.deepEqual(errors, []);
  console.log('OFFICE PASS: Word日本語・上下ページ送り・ページ区切り・倍率・再読込、Excel計算結果・シート・行送り・結合・CSV、PDF/PPTページ送り・倍率・縦横、Monaco切替・壊れた文書・復旧・破棄');
} finally {
  for (const socket of sockets) socket.close(); chrome.kill(); await app.close();
  if (chrome.exitCode === null) await once(chrome, 'exit');
  rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
