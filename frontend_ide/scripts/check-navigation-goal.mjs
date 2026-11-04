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
const project=resolve('..');
const sourceNames=['frontend_ide/ファイル機能/navigation.mjs','frontend_ide/ファイル機能/navigation-agent.mjs','frontend_ide/ファイル機能/navigation_readonly.py','frontend_ide/src/components/開発スペース/Navigationパネル.vue','frontend_ide/desktop.cjs','frontend_ide/server.mjs'];
const snapshot=()=>Object.fromEntries(sourceNames.map(name=>[name,createHash('sha256').update(readFileSync(join(project,name))).digest('hex')]));let before;
const evidence=resolve('temp/navigation-goal-check');mkdirSync(evidence,{recursive:true});const actual=[];
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
  await until(()=>evaluate(`!!window.aidiyIDE`),'IDE');before=snapshot();
  await evaluate(`aidiyIDE.setAutoSpin(false);window.testNavi=[];const originalOpen=window.open;window.open=(...args)=>{const child=originalOpen.apply(window,args);testNavi.push(child);return child;};`);
  const child=(index,expression)=>evaluate(`testNavi[${index}].eval(${JSON.stringify(expression)})`);
  const results=[];
  for(const [index,goal] of ['Navi機能追加'].entries()){
   await evaluate(`document.querySelector('.navigation-launch').click()`);
   await until(()=>evaluate(`!!testNavi[${index}]?.document.querySelector('textarea')`),'Navigator window');
   await child(index,`(()=>{const t=document.querySelector('textarea');t.value=${JSON.stringify(goal)};t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
   await until(()=>child(index,`!document.querySelector('.navigation-start').disabled`),'実行準備');
   await child(index,`fetch('/api/navigation?instance=navi-${index+1}',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'aidiy_hermes',model:'same'})}).then(r=>r.json())`);
   await child(index,`document.querySelector('.navigation-start').click()`);
   await until(()=>child(index,`fetch('/api/navigation?instance=navi-${index+1}').then(r=>r.json()).then(d=>!!d.job&&d.job.status!=='running')`),'AI結果');
   const data=await child(index,`fetch('/api/navigation?instance=navi-${index+1}').then(r=>r.json())`);
   results.push({input:goal,mode:goal?'explicit':'default',data});writeFileSync(join(evidence,'result.json'),JSON.stringify({results,aiCalls,actual:actual.map(({content,...rest})=>rest),before,after:snapshot()},null,2));
   console.log(JSON.stringify({stage:'Navigator completed',mode:goal?'explicit':'default',status:data.job.status,message:data.job.message,items:data.result?.items?.length}));
   await until(()=>child(index,`!document.querySelector('.navigation-start').disabled`),'UI反映');
   const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const target=targets.find(t=>t.title===`AiDiy IDE / Navigator ${index+1}`);
   const ws=new WebSocket(target.webSocketDebuggerUrl);await once(ws,'open');let n=0;const cmd=(method,params={})=>new Promise(done=>{const id=++n;const f=e=>{const d=JSON.parse(e.data);if(d.id===id){ws.removeEventListener('message',f);done(d);}};ws.addEventListener('message',f);ws.send(JSON.stringify({id,method,params}));});
   await cmd('Emulation.setDeviceMetricsOverride',{width:500,height:600,deviceScaleFactor:1,mobile:false});await sleep(300);
   const capture=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(join(evidence,(goal?'explicit':'default')+'.png'),Buffer.from(capture.result.data,'base64'));ws.close();
   await child(index,`document.querySelector('[aria-label="Navigatorを閉じる"]').click()`);
  }
  assert.equal(aiCalls,1);assert.deepEqual(snapshot(),before);assert.deepEqual(errors,[]);console.log(JSON.stringify({finished:true,aiCalls,sourceFilesUnchanged:true,statuses:results.map(x=>x.data.job.status)}));

} finally {
  writeFileSync(join(evidence,'file-integrity.json'),JSON.stringify({before,after:snapshot(),aiCalls,returned:actual.length},null,2));
  socket?.close(); const exited = once(chrome, 'exit'); chrome.kill(); await exited;
  await app.close(); connection.close(); for (const timer of replies) clearTimeout(timer);
  core.closeAllConnections(); await new Promise(done => core.close(done));
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
