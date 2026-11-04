// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startDevelopment } from '../server.mjs';
const project = mkdtempSync(join(tmpdir(), 'aidiy-console-ui-')), profile = mkdtempSync(join(tmpdir(), 'aidiy-console-browser-'));
const app = await startDevelopment(project);
const chromePath = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(base => ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].map(tail => join(base, tail))).find(existsSync);
const port = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms)); let ws;
try {
  let target; for (let i = 0; i < 50 && !target; i++) { try { target = (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(t => t.type === 'page'); } catch {} if (!target) await sleep(200); }
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(), errors = [];
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); });
  const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.error || result.result.exceptionDetails) throw Error(JSON.stringify(result)); return result.result.result.value; };
  async function until(expression) { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); } throw Error(expression); }
  const button = text => `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`;
  async function type(text) { await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`); await send('Input.insertText', { text }); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); }
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(/\D/g, '');
  const dir = resolve('temp/console-check'); mkdirSync(dir, { recursive: true }); let number = 0;
  async function shot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); const path = join(dir, `${stamp}_${++number}_${name}.png`); writeFileSync(path, Buffer.from(result.result.data, 'base64')); console.log(path); }
  await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: app.url }); await until(`document.body.textContent.includes('オフライン利用')`); await evaluate(button('オフライン利用'));
  await until(`Array.from(document.querySelectorAll('.ai-launchers button')).some(b=>b.textContent==='Console')`); await evaluate(button('Console'));
  await until(`!!document.querySelector('[role=tab]')`); await evaluate(button('Console'));
  await until(`document.querySelector('.console-component')?.textContent.includes('実行中')`);
  await until(`document.querySelector('.xterm-rows')?.textContent.includes('PS ')`);
  await until(`document.querySelector('.console-welcome img')?.naturalWidth>0`);
  assert.equal(await evaluate(`document.querySelector('.console-component [role=switch]').getAttribute('aria-checked')`), 'true');
  await evaluate(button('Tools接続確認'));
  await until(`document.querySelector('.console-component [role=switch]').getAttribute('aria-checked')==='false' && !!document.querySelector('.console-component .connection-bar.offline')`);
  assert.equal(await evaluate(`!!document.querySelector('.console-welcome')`), true);
  await shot('web-console-tools-off');
  await evaluate(button('Tools接続確認'));
  await until(`document.querySelector('.console-component [role=switch]').getAttribute('aria-checked')==='true' && !document.querySelector('.console-component .connection-bar.offline')`);
  assert.equal(await evaluate(`(()=>{const t=document.querySelector('.console-component').getBoundingClientRect(),s=document.querySelector('.console-screen').getBoundingClientRect();return s.top>t.top+t.height*0.65&&s.height<100})()`), true);
  // 文字送りの表示完了時点を撮影し、初期メッセージ全体を確認する。
  await evaluate(`document.querySelector('.console-welcome').getAnimations({subtree:true}).forEach(animation=>{animation.currentTime=8500})`);
  await shot('web-console-welcome');
  await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`);
  await send('Input.insertText', { text: '$' });
  await until(`!document.querySelector('.console-welcome') && document.querySelector('.console-screen').getBoundingClientRect().height>300`);
  await type("termCheck = 41; Write-Output ('日本語ターミナル_'+($termCheck+1))");
  await until(`document.querySelector('.xterm-rows')?.textContent.includes('日本語ターミナル_42')`);
  await shot('web-console');
  await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`);
  await send('Input.insertText', { text: 'codex' });
  await until(`document.querySelector('.console-completion')?.textContent.includes('--dangerously-bypass-approvals-and-sandbox')`);
  await shot('web-console-codex-completion');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await until(`!document.querySelector('.console-completion') && document.querySelector('.xterm-rows')?.textContent.includes('codex --dangerously-bypass-approvals-and-sandbox')`);
  // Enterは送らず、実際のCodexを起動せずに補完確認を終える。
  await evaluate(button('Ctrl+C送信'));
  await sleep(200);
  await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`);
  await send('Input.insertText', { text: 'claude' });
  await until(`document.querySelector('.console-completion')?.getAttribute('aria-label').includes('claude --dangerously-skip-permissions --chrome')`);
  await shot('web-console-claude-completion');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await until(`!document.querySelector('.console-completion') && document.querySelector('.xterm-rows')?.textContent.includes('claude --dangerously-skip-permissions --chrome')`);
  await evaluate(button('Ctrl+C送信'));
  await sleep(200);
  await evaluate(button('Code')); await evaluate(button('Console')); await type("Write-Output ('保持_'+$termCheck)");
  await until(`document.querySelector('.xterm-rows')?.textContent.includes('保持_41')`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await sleep(500);
  assert.equal(await evaluate(`(()=>{const r=document.querySelector('.xterm-screen').getBoundingClientRect();return r.width>100&&r.right<=390&&r.bottom<=844})()`), true);
  await shot('web-console-narrow');
  await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`);
  await send('Input.insertText', { text: 'copilot' });
  await until(`document.querySelector('.console-completion')?.textContent.includes('--allow-all-tools')`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.console-ghost-row')).every(el=>{const r=el.getBoundingClientRect(),s=document.querySelector('.xterm-screen').getBoundingClientRect();return r.left>=s.left-1&&r.right<=s.right+1&&r.bottom<=s.bottom+1&&getComputedStyle(el).color==='rgb(119, 129, 143)'})`), true);
  await shot('web-console-copilot-ghost');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await until(`!document.querySelector('.console-completion') && document.querySelector('.xterm-rows')?.textContent.includes('copilot --allow-all-tools')`);
  await evaluate(button('Ctrl+C送信'));
  await sleep(200);
  await evaluate(button('表示クリア'));
  await until(`!!document.querySelector('.console-welcome') && document.querySelector('.console-screen').getBoundingClientRect().height<100`);
  await evaluate(`document.querySelector('.console-welcome').getAnimations({subtree:true}).forEach(animation=>{animation.currentTime=8500})`);
  await shot('web-console-cleared-welcome');
  await type("Write-Output ('CLEAR_保持_'+$termCheck)");
  await until(`!document.querySelector('.console-welcome') && document.querySelector('.xterm-rows')?.textContent.includes('CLEAR_保持_41')`);
  await type('exit'); await until(`document.querySelector('.console-component')?.textContent.includes('終了 (0)')`);
  await evaluate(button('再起動')); await until(`document.querySelector('.console-component')?.textContent.includes('実行中')`);
  await until(`!!document.querySelector('.console-welcome')`);
  await type("Write-Output ('RESTART_'+'OK')"); await until(`document.querySelector('.xterm-rows')?.textContent.includes('RESTART_OK')`);
  await evaluate(button('利用終了')); await until(`!document.querySelector('.console-component')`);
  assert.deepEqual(errors, []); console.log('Web Console: 日本語・タブ保持・縦横サイズ・exit/再起動・終了 OK');
} finally {
  ws?.close(); chrome.kill(); await app.close(); await sleep(500);
  for (const path of [profile, project]) { if (!path.startsWith(join(tmpdir(), 'aidiy-console-'))) throw Error('一時パスが不正です。'); rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
}
