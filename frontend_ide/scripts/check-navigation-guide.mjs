// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 模擬AIと実ブラウザで複数Naviの入力・結果・モデル・終了の独立を確認する。
// ルートから node frontend_ide/scripts/check-navigation.mjs。CHROME_PATHでブラウザを指定可能。
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
let aiCalls=0,dependencyReady=true,failNext=false,holdNext=false,releaseHeld;
const app = await startDevelopment(project, { connection, navigationOptions:{availability:async()=>({available:dependencyReady,reason:dependencyReady?'':'試験依存が停止しています'}),stateRoot:join(temporary,'navigation-state'),runAgent:async({prompt})=>{
 aiCalls++;if(holdNext){holdNext=false;await new Promise(resolve=>releaseHeld=resolve);}if(failNext){failNext=false;throw Error('試験用の応答失敗');}const shape=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1).replace(/^出力形式: /,''));
 shape.items=[{id:'one',name:'検索画面の入力を整える',progress:0,reason:'入力欄を確認。空入力の検証を次に行います。'},{id:'two',name:'操作ガイドを整える',progress:50,reason:'既存の章に追記する方針です。'}];shape.items.push({id:'three',name:'長い項目名でも縮小窓で折り返して読めることを確認する',progress:100,reason:'表示確認用の模擬結果です。'});shape.schemaVersion=2;shape.items.forEach((item,index)=>{item.weight=[60,30,10][index];item.weightReason='表示試験用の作業量見積もり';});shape.overall={progress:25,reason:'作業量に基づく加重評価の模擬結果'};shape.nextPrompt='検索画面の空入力とエラー表示を確認し、必要なテストを追加してください。';
 await new Promise(r=>setTimeout(r,300));return {content:JSON.stringify(shape)};
}} });
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'browser')}`,
  '--window-size=1280,800', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(check, label) { const end = Date.now() + 30000; while (Date.now() < end) { if (await check()) return; await sleep(100); } throw Error(`待機タイムアウト: ${label}`); }
let socket,standalone,code;
try {
  const activePort = join(temporary, 'browser', 'DevToolsActivePort');
  await until(() => existsSync(activePort), 'ブラウザ起動');
  const { readFileSync } = await import('node:fs');
  let port;await until(()=>{try{port=readFileSync(activePort,'utf8').split('\n')[0];return /^\d+$/.test(port.trim());}catch{return false;}},'debug port readable');
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
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true,userGesture:true });
    assert.equal(result.result?.exceptionDetails, undefined, JSON.stringify(result.result?.exceptionDetails));
    return result.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  standalone=await startDevelopment(project,{kind:'navi',connection,navigationOptions:{stateRoot:join(temporary,'guide-state'),runAgent:()=>{throw Error('No AI allowed in guide capture');}}});
  await send('Emulation.setDeviceMetricsOverride',{width:500,height:600,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:standalone.url});
  await until(()=>evaluate(`!!document.querySelector('.navigation-panel.standalone textarea')`),'standalone');
  const out=resolve('temp/navigation-guide-current');mkdirSync(out,{recursive:true});
  const capture=async name=>{await sleep(250);const result=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,name+'.png'),Buffer.from(result.result.data,'base64'));};
  await until(()=>evaluate(`!!document.querySelector('.terminal-welcome .welcome-mark img')?.naturalWidth`),'welcome image');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.welcome-mark'),'::before').borderTopStyle`),'solid');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.welcome-mark'),'::after').borderTopStyle`),'solid');
  assert.ok(await evaluate(`document.querySelector('textarea').value.startsWith('最近更新したファイル')`));
  await evaluate(`(()=>{const t=document.querySelector('textarea');t.value='';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.navigation-start').click();})()`);
  await until(()=>evaluate(`document.body.textContent.includes('開発目標を入力してください')`),'empty goal');
  assert.equal(aiCalls,0);
  await evaluate(`document.querySelector('.navigation-project nav button').click()`);
  await connection.connect();
  await until(()=>evaluate(`document.querySelector('.connection-bar').classList.contains('online')`),'Tools online');
  healthy=false;await connection.check();
  await until(()=>evaluate(`!document.querySelector('.connection-bar').classList.contains('online')`),'Tools offline');
  assert.ok(await evaluate(`!!document.querySelector('.navigation-panel textarea')`));
  healthy=true;await connection.check();
  await until(()=>evaluate(`document.querySelector('.connection-bar').classList.contains('online')`),'Tools recovered');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.navigation-panel')).backgroundColor`),'rgb(0, 0, 0)');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.navigation-panel')).borderTopWidth`),'1px');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.model-caption')).backgroundColor`),'rgb(255, 255, 255)');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.model-caption')).color`),'rgb(0, 0, 0)');
  const naviTitle=await evaluate(`(()=>{const h=document.querySelector('.panel-brand');return {height:h.getBoundingClientRect().height,font:getComputedStyle(h.querySelector('strong')).fontSize}})()`);
  await sleep(22000);await capture('initial');
  await evaluate(`document.querySelector('.navigation-project nav button:last-child').click()`);
  await until(()=>evaluate(`!!document.querySelector('.navigation-history')`),'history');await capture('history');
  await evaluate(`document.querySelector('.navigation-project nav button:last-child').click();document.querySelector('.navigation-model-line button').click()`);
  await until(()=>evaluate(`!!document.querySelector('.navigation-model-picker')`),'model');await capture('model');
  code=await startDevelopment(project,{kind:'code',offline:true});
  await send('Page.navigate',{url:code.url});
  await until(()=>evaluate(`!!document.querySelector('.code-component .panel-brand')`),'Code comparison');
  await sleep(1500);
  const codeTitle=await evaluate(`(()=>{const h=document.querySelector('.panel-brand');return {height:h.getBoundingClientRect().height,font:getComputedStyle(h.querySelector('strong')).fontSize}})()`);
  assert.deepEqual(naviTitle,codeTitle);console.log(JSON.stringify({sameDPI:true,naviTitle,codeTitle}));
  assert.equal(aiCalls,0);assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,externalAIRequests:0,viewport:[500,600],output:out}));

} finally {
  socket?.close(); const exited = once(chrome, 'exit'); chrome.kill(); await exited;
  await code?.close();await standalone?.close();await app.close(); connection.close(); for (const timer of replies) clearTimeout(timer);
  core.closeAllConnections(); await new Promise(done => core.close(done));
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
