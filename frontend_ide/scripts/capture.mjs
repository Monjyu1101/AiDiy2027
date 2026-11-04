// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// AiDiy IDE の画面確認用スクリーンショット。ヘッドレス Chrome を DevTools Protocol で操作し、実時間で待ってから撮る。
// （--screenshot の仮想時間ではアニメーションが進まず、Claude のブラウザペインは拡大率がずれるため）
// 使い方: node frontend_ide/viewer/scripts/shot.mjs URL 出力.png [待機ms=8000] [撮影前に実行するJS] [JS後の待機ms=3000]
// 例:     node frontend_ide/viewer/scripts/shot.mjs "http://127.0.0.1:<起動ログのポート>/#/frontend_web" out.png 8000 "aidiyIDE.flyHome()"
// JS は Runtime.evaluate で評価し、戻り値（Promise なら解決値）を標準出力へ JSON で出す。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startDevelopment } from '../server.mjs';

const app = await startDevelopment(resolve('frontend_ide'));
const url = app.url;
const chromePath = [
  [process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'],
  [process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'],
  [process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'],
  [process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'],
  [process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'],
].filter(([base]) => base).map(([base, tail]) => join(base, tail)).find(existsSync)
  ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chromePath) { console.error('Chrome / Edge が見つかりません。'); process.exit(1); }

const port = 9333 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'aidiy_ide_shot-'));
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--window-size=1280,800', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch { await sleep(200); }
  }
  if (!target) throw new Error('ヘッドレス Chrome に接続できませんでした。');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const errors = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(JSON.stringify(m.params.args)); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text); });
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
    return response.result?.result?.value;
  }
  async function capture(name) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(name, Buffer.from(shot.result.data, 'base64'));
    console.log(name);
  }
  await sleep(1500);
  assert.equal(await evaluate(`!!document.querySelector('.explorer-toggle')`),false);
  await capture('nn-vue-start.png');console.log(JSON.stringify({errors}));
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
  await sleep(3500);
  await evaluate(`document.querySelector('.explorer-toggle').click()`);
  await sleep(500);
  await evaluate(`document.querySelector('.ai-panel-toggle').click()`);
  await sleep(3500);
  assert.equal(await evaluate(`!!document.querySelector('[data-component=CodePanel]') && !document.querySelector('.ai-popup iframe')`),true);
  assert.equal(await evaluate(`document.querySelectorAll('.ai-tabs [role=tab]').length`),1);
  await capture('nn-vue-code.png');
  console.log('offline',await evaluate(`({text:document.body.innerText.slice(-700),canvas:!!window.aidiyIDE?.world})`));
  await evaluate(`window.aidiyIDE.goTo({type:'file',path:'package.json'})`);
  await sleep(3000);
  assert.equal(await evaluate(`!!document.querySelector('.viewer-popup .monaco-editor')`),true);
  await capture('nn-vue-preview.png');
  await evaluate(`document.querySelector('input[value=grep]').click()`);await sleep(100);
  await evaluate(`const input=document.querySelector('.explorer-search input[type=search]');input.value='defineProps';input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await sleep(100);
  await evaluate(`document.querySelector('.explorer-search form').requestSubmit()`);
  await sleep(1200);
  assert.match(await evaluate(`document.querySelector('.explorer-search [role=status]').textContent`),/ファイル一致/);
  assert.ok(await evaluate(`document.querySelectorAll('[role=treeitem].fresh').length`)>0);
  await evaluate(`document.querySelector('input[value=since]').click()`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='利用終了').click()`);
  await sleep(1200);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='AiDiy接続利用').click()`);
  await sleep(3000);
  await evaluate(`document.querySelector('.ai-panel-toggle').click()`);
  await sleep(1500);
  await evaluate(`Array.from(document.querySelectorAll('.ai-tabs button')).find(b=>b.textContent==='Live').click()`);
  await sleep(3500);
  await capture('nn-vue-live.png');
  console.log(JSON.stringify({errors,live:await evaluate(`document.querySelector('[data-component="LivePanel"]')?.innerText.slice(-800)`)}));
  assert.deepEqual(errors,[]);
  assert.equal(await evaluate(`!!document.querySelector('[data-component=LivePanel]') && !document.querySelector('.ai-popup iframe')`),true);
  await evaluate(`document.querySelector('.ai-tabs .close').click()`);await sleep(100);
  assert.equal(await evaluate(`!!document.querySelector('[data-component=LivePanel]')`),false);
  ws.close();
} finally {
  chrome.kill();
  await app.close();
  await sleep(300);
  if (!resolve(profile).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('一時パスが不正です');
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome が掴んでいれば残す */ }
}
