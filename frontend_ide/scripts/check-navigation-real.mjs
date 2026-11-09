// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 明示承認後だけ手動実行する実AI試験。専用の公開試験資料をHermes経由の設定済みAIへ送る。
// ルートから node frontend_ide/scripts/check-navigation-real.mjs。CHROME_PATHでブラウザを指定可能。
import assert from 'node:assert/strict';
import {runNavigationAgent} from '../ファイル機能/navigation-agent.mjs';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
writeFileSync(join(project,'README.md'),'# 公開試験：色一覧\n赤・青の色名を日本語で示す文書を作る計画です。赤の説明は完了、青の説明と確認手順は未作成です。\n','utf8');
writeFileSync(join(project,'red.txt'),'赤：りんごに使われる色です。\n','utf8');
const snapshot=()=>{const result={};const walk=(folder,prefix='')=>{for(const entry of readdirSync(folder,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory()){result[name+'/']='directory';walk(join(folder,entry.name),name+'/');}else result[name]=createHash('sha256').update(readFileSync(join(folder,entry.name))).digest('hex');}};walk(project);return result;};let before;
const evidence=resolve('temp/navigation-real-check');mkdirSync(evidence,{recursive:true});const actual=[];
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
let aiCalls=0;
const app = await startDevelopment(project, { connection, navigationOptions:{stateRoot:join(temporary,'navigation-state'),runAgent:async args=>{
 aiCalls++;console.log(JSON.stringify({stage:'AI start',call:aiCalls,selection:args.selection,time:new Date().toISOString()}));
 const answer=await runNavigationAgent(args);actual.push({call:aiCalls,provider:answer.provider,model:answer.model,content:answer.content});writeFileSync(join(evidence,'responses.json'),JSON.stringify(actual,null,2));console.log(JSON.stringify({stage:'AI returned',call:aiCalls,provider:answer.provider,model:answer.model}));return answer;
}} });
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'browser')}`,
  '--window-size=1280,800', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(check, label) { const end = Date.now() + 330000; while (Date.now() < end) { if (await check()) return; await sleep(100); } throw Error(`待機タイムアウト: ${label}`); }
let socket;
try {
  const activePort = join(temporary, 'browser', 'DevToolsActivePort');
  await until(() => existsSync(activePort), 'ブラウザ起動');
  
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
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true,userGesture:true });
    assert.equal(result.result?.exceptionDetails, undefined, JSON.stringify(result.result?.exceptionDetails));
    return result.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate',{url:app.url});
  await until(()=>evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='AiDiy接続利用')`),'開始');
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='AiDiy接続利用').click()`);
  await until(()=>evaluate(`!!window.aidiyIDE`),'IDE');
  before=snapshot();
  await evaluate(`aidiyIDE.setAutoSpin(false);window.testNavi=[];const originalOpen=window.open;window.open=(...args)=>{const child=originalOpen.apply(window,args);testNavi.push(child);return child;};document.querySelector('.navigation-launch').click()`);
  const child=(index,expression)=>evaluate(`testNavi[${index}].eval(${JSON.stringify(expression)})`);
  await until(()=>evaluate(`!!testNavi[0]?.document.querySelector('textarea')`),'Navi 1');
  await child(0,`(()=>{const t=document.querySelector('textarea');t.value='このフォルダの赤・青の色一覧文書を完成させる。ファイルは変更せず現状から作業を提案してください。';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.navigation-start').click();})()`);
  await until(()=>child(0,`document.querySelectorAll('.navigation-progress').length>0 || document.querySelector('.navigation-error')`),'Navi 1 result');
  assert.equal(aiCalls,1);const firstResult=await evaluate(`fetch('/api/navigation?instance=navi-1').then(r=>r.json())`);writeFileSync(join(evidence,'navigation-stage.json'),JSON.stringify({firstResult,before,after:snapshot(),aiCalls,returned:actual.length},null,2));assert.equal(firstResult.job.status,'complete',firstResult.job.message);assert.equal(actual.length,1);
  await evaluate(`document.querySelector('.navigation-launch').click()`);
  await until(()=>evaluate(`!!testNavi[1]?.document.querySelector('textarea')`),'Navi 2');
  assert.equal(await child(1,`document.querySelector('textarea').value`),'');
  assert.equal(await child(1,`document.querySelectorAll('.navigation-progress').length`),0);
  await child(1,`document.querySelector('.navigation-model-line button').click()`);
  await child(1,`(()=>{const input=document.querySelector('.navigation-model-choice');input.value='auto';input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.navigation-model-picker').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`);
  await until(()=>child(1,`document.querySelector('.navigation-model-line>span').textContent.includes('auto')`),'モデル保存');
  assert.ok(await child(0,`document.querySelector('.navigation-model-line>span').textContent.includes('same')`));
  await child(0,`document.querySelector('.navigation-evaluate').click()`);
  await until(()=>child(0,`!document.querySelector('.navigation-evaluate').disabled`),'評価完了');
  assert.equal(aiCalls,2);assert.equal(actual.length,2);const secondResult=await evaluate(`fetch('/api/navigation?instance=navi-1').then(r=>r.json())`);assert.equal(secondResult.job.status,'complete',secondResult.job.message);assert.deepEqual(secondResult.result.items.map(i=>[i.id,i.name]),firstResult.result.items.map(i=>[i.id,i.name]));assert.deepEqual(snapshot(),before);writeFileSync(join(evidence,'result.json'),JSON.stringify({pass:true,aiCalls,before,after:snapshot(),firstResult,secondResult,actual:actual.map(({content,...rest})=>rest)},null,2));
  assert.equal(await child(1,`document.querySelectorAll('.navigation-progress').length`),0);
  assert.equal(await evaluate(`document.querySelectorAll('.navigation-toggle').length`),0);
  await evaluate(`document.querySelector('.explorer-toggle').click()`);
  assert.equal(await evaluate(`document.querySelector('.space-view').classList.contains('navigation-open')`),false);
  await child(0,`document.querySelector('[aria-label="Naviを閉じる"]').click()`);
  await until(()=>evaluate(`testNavi[0].closed`),'Navi 1 close');
  assert.equal(await child(1,`document.querySelector('textarea').value`),'');
  await child(1,`document.querySelector('[aria-label="Naviを閉じる"]').click()`);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,ai:'real readonly Hermes',aiCalls,checks:['two popup windows','independent model/result/evaluation','Explorer unchanged','close isolation']}));

} finally {
  writeFileSync(join(evidence,'file-integrity.json'),JSON.stringify({before,after:snapshot(),aiCalls,returned:actual.length},null,2));
  socket?.close(); const exited = once(chrome, 'exit'); chrome.kill(); await exited;
  await app.close(); connection.close(); for (const timer of replies) clearTimeout(timer);
  core.closeAllConnections(); await new Promise(done => core.close(done));
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
