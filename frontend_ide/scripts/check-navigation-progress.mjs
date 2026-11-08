// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 模擬AIと実ブラウザで複数Naviの入力・結果・モデル・終了の独立を確認する。
// ルートから node frontend_ide/scripts/check-navigation-progress.mjs。CHROME_PATHでブラウザを指定可能。
// --step-4 は画面からの作成・再評価と保存内容の整合確認だけを実行する。
import {DEFAULT_NAVIGATION_GOAL} from '../src/components/開発スペース/Navigation既定値.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createNavigationScreenRecord } from './navigation-step4-check.mjs';
import { createCoreConnection } from '../viewer/core-connection.mjs';
import {startMockDevelopment as startDevelopment,mockOutput,mockStage,removeMockDirectory,readMockDebugPort} from '../checks/navigation-mock-support.mjs';

const chromePath = process.env.CHROME_PATH || [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
  .filter(Boolean).flatMap(base => ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].map(tail => join(base, tail))).find(existsSync)
  || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chromePath) throw Error('Chrome / Edge が見つかりません。CHROME_PATH を指定してください。');
const temporary = mkdtempSync(join(tmpdir(), 'aidiy-connection-check-'));
const project = join(temporary, 'project'); mkdirSync(project);
writeFileSync(join(project, 'README.md'), '# 接続表示の検証\n', 'utf8');
const step4=process.argv.includes('--step-4');
const record=createNavigationScreenRecord({name:'check-navigation-progress',temporary,project,stateRoot:join(temporary,'navigation-state'),progress:true});
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
const app = await startDevelopment(project, { connection, navigationOptions:{defaultModel:async()=>({provider:"aidiy_hermes",model:"same"}),availability:async()=>({available:dependencyReady,reason:dependencyReady?'':'試験依存が停止しています'}),stateRoot:join(temporary,'navigation-state'),runAgent:async({prompt})=>{
 if(step4)return record.respond(prompt);
 aiCalls++;if(holdNext){holdNext=false;await new Promise(resolve=>releaseHeld=resolve);}if(failNext){failNext=false;throw Error('試験用の応答失敗');}const shape=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1).replace(/^出力形式: /,''));
 shape.items=[{id:'one',name:'検索画面の入力を整える',progress:0,reason:'入力欄を確認。空入力の検証を次に行います。'},{id:'two',name:'操作ガイドを整える',progress:50,reason:'既存の章に追記する方針です。'}];shape.items.push({id:'three',name:'長い項目名でも縮小窓で折り返して読めることを確認する',progress:100,reason:'表示確認用の模擬結果です。'});shape.schemaVersion=3;shape.nextItemId='one';shape.items.forEach((item,index)=>{item.weight=[60,30,10][index];item.weightReason='表示試験用の作業量見積もり';});shape.overall={progress:25,reason:'作業量に基づく加重評価の模擬結果'};shape.nextPrompt='検索画面の空入力とエラー表示を確認し、必要なテストを追加してください。';
 await new Promise(r=>setTimeout(r,300));return {content:JSON.stringify(shape)};
}} });
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'browser')}`,
  '--window-size=1280,800', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(check, label) { mockStage(label); const end = Date.now() + 30000; while (Date.now() < end) { if (await check()) return; await sleep(100); } throw Error(`待機タイムアウト: ${label}`); }
let socket,standalone;
try {
  const activePort = join(temporary, 'browser', 'DevToolsActivePort');
  await until(() => existsSync(activePort), 'ブラウザ起動');
  const { readFileSync } = await import('node:fs');
  let port;await until(()=>(port=readMockDebugPort(activePort)),'debug port readable');
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
  await evaluate(`aidiyIDE.setAutoSpin(false);window.testNavi=[];const originalOpen=window.open;window.open=(...args)=>{const child=originalOpen.apply(window,args);testNavi.push(child);return child;};document.querySelector('.navigation-launch').click()`);
  const child=(index,expression)=>evaluate(`testNavi[${index}].eval(${JSON.stringify(expression)})`);
  record.bind({evaluate,child,app,port,target,errors,getAiCalls:()=>aiCalls});
  await until(()=>evaluate(`!!testNavi[0]?.document.querySelector('textarea')`),'Navi 1');
  await until(()=>child(0,`!!document.querySelector('.navigation-start:not(:disabled)')`),'Navi 1 実行可能');
  if(step4){await record.run();}else{
  await child(0,`(()=>{const t=document.querySelector('textarea');t.value='検索画面を整える';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.navigation-start').click();})()`);
  await until(()=>child(0,`document.querySelectorAll('.navigation-items .navigation-progress').length===3`),'Navi 1 result');
  assert.equal(aiCalls,1);
  dependencyReady=false;
  await until(()=>child(0,`document.querySelector('.navigation-start').disabled&&document.querySelector('.navigation-evaluate').disabled&&document.querySelector('.navigation-unavailable')?.textContent.includes('停止')`),'依存停止表示');
  assert.equal(await child(0,`document.querySelectorAll('.navigation-items .navigation-progress').length`),3);
  dependencyReady=true;
  await until(()=>child(0,`!document.querySelector('.navigation-start').disabled&&document.querySelector('.navigation-evaluate')?.disabled===false`),'依存復帰');
  const barStyles=await child(0,`[...document.querySelectorAll('.navigation-items .navigation-progress')].map(el=>({value:el.getAttribute('aria-valuenow'),width:el.style.getPropertyValue('--progress-width'),color:el.style.getPropertyValue('--progress-fill'),label:el.textContent}))`);
  assert.deepEqual(barStyles.map(x=>x.value),['0','50','100']);assert.deepEqual(barStyles.map(x=>x.width),['0%','50%','100%']);assert.equal(new Set(barStyles.map(x=>x.color)).size,3);
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const navTarget=targets.find(t=>t.title==='AiDiy IDE / Navigator 1');assert.ok(navTarget);
  const captureSocket=new WebSocket(navTarget.webSocketDebuggerUrl);await once(captureSocket,'open');
  let captureId=0;const captureSend=(method,params={})=>new Promise(done=>{const id=++captureId;const handler=event=>{const data=JSON.parse(event.data);if(data.id===id){captureSocket.removeEventListener('message',handler);done(data);}};captureSocket.addEventListener('message',handler);captureSocket.send(JSON.stringify({id,method,params}));});
  await captureSend('Emulation.setDeviceMetricsOverride',{width:500,height:600,deviceScaleFactor:1,mobile:false});
  await child(0,`document.querySelector('.navigation-items').scrollIntoView({block:'start'})`);await sleep(300);
  const navCapture=await captureSend('Page.captureScreenshot',{format:'jpeg',quality:32});
  mkdirSync(mockOutput('temp/navigation-ui-check'),{recursive:true});writeFileSync(join(mockOutput('temp/navigation-ui-check'),'Navigator_bars.jpg'),Buffer.from(navCapture.result.data,'base64'));captureSocket.close();
  await child(0,`document.querySelector('.navigation-panel').style.width='320px'`);
  assert.equal(await child(0,`[...document.querySelectorAll('.navigation-items .navigation-progress')].every(e=>e.scrollWidth<=e.clientWidth)`),true);

  await evaluate(`document.querySelector('.navigation-launch').click()`);
  await until(()=>evaluate(`!!testNavi[1]?.document.querySelector('textarea')`),'Navi 2');
  assert.equal(await child(1,`document.querySelector('textarea').value`),DEFAULT_NAVIGATION_GOAL);
  assert.ok(await child(0,`document.body.textContent.includes('AiDiy IDE / Navigator 1')`));
  assert.ok(await child(1,`document.body.textContent.includes('AiDiy IDE / Navigator 2')`));
  assert.equal(await child(1,`document.querySelectorAll('.navigation-items .navigation-progress').length`),0);
  await child(1,`document.querySelector('.navigation-model-line button').click()`);
  await until(()=>child(1,`!!document.querySelector('.navigation-model-picker button[type=submit]:not(:disabled)')`),'model ready');
  await child(1,`(()=>{const input=document.querySelector('.navigation-model-choice');input.value='auto';input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.navigation-model-picker').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`);
  await until(()=>child(1,`document.querySelector('.navigation-model-line>span').textContent.includes('auto')`),'モデル保存');
  assert.ok(await child(0,`document.querySelector('.navigation-model-line>span').textContent.includes('same')`));
  await child(0,`document.querySelector('.navigation-evaluate').click()`);
  await until(()=>child(0,`document.querySelector('.navigation-evaluate')?.disabled===false`),'評価完了');
  assert.equal(aiCalls,2);
  await child(0,`document.querySelector('.navigation-project nav button:last-child').click()`);
  await until(()=>child(0,`document.querySelectorAll('.navigation-history>button').length===1`),'history list');
  await child(0,`document.querySelector('.navigation-history>button').click()`);
  await until(()=>child(0,`!document.querySelector('.navigation-history')`),'history selected');
  assert.equal(aiCalls,2);
  assert.equal(await child(1,`document.querySelectorAll('.navigation-items .navigation-progress').length`),0);
  assert.equal(await evaluate(`document.querySelectorAll('.navigation-toggle').length`),0);
  await evaluate(`document.querySelector('.explorer-toggle').click()`);
  assert.equal(await evaluate(`document.querySelector('.space-view').classList.contains('navigation-open')`),false);
  const setGoal=value=>child(0,`(()=>{const t=document.querySelector('textarea');t.value=${JSON.stringify(value)};t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await setGoal('変更後の目標');assert.equal(await child(0,`document.querySelector('.navigation-evaluate').disabled`),false);
  assert.equal(await child(0,`document.querySelector('.navigation-start').classList.contains('is-next-action')`),true);
  await setGoal('検索画面を整える');assert.equal(await child(0,`document.querySelector('.navigation-evaluate').disabled`),false);
  await setGoal('');await sleep(5200);assert.equal(await child(0,`document.querySelector('textarea').value`),'');
  await setGoal('変更後の目標');failNext=true;await child(0,`document.querySelector('.navigation-start').click()`);
  await until(()=>child(0,`document.body.textContent.includes('試験用の応答失敗')`),'失敗表示');
  assert.equal(await child(0,`document.querySelector('.navigation-evaluate').disabled`),false);
  assert.equal(await child(0,`document.querySelectorAll('.navigation-items .navigation-progress').length`),3);
  await child(0,`document.querySelector('.navigation-start').click()`);
  await until(()=>child(0,`document.querySelector('.navigation-evaluate')?.disabled===false`),'新目標成功');
  holdNext=true;await setGoal('処理中の目標');await child(0,`document.querySelector('.navigation-start').click()`);await until(()=>!!releaseHeld,'実行開始');
  assert.equal(await child(0,`document.querySelector('textarea').disabled`),false);
  assert.equal(await child(0,`!!document.querySelector('.navigation-stop:not(:disabled)')&&!document.querySelector('.navigation-start')`),true);
  await setGoal('実行中に編集した次の目標');releaseHeld();
  await until(()=>child(0,`!!document.querySelector('.navigation-start:not(:disabled)')&&!document.querySelector('.navigation-stop')`),'実行完了');
  assert.equal(await child(0,`document.querySelector('textarea').value`),'実行中に編集した次の目標');
  assert.equal(await child(0,`document.querySelector('.navigation-evaluate').disabled`),false);
  await child(0,`document.querySelector('.navigation-project nav button:last-child').click()`);
  await until(()=>child(0,`document.querySelectorAll('.navigation-history>button').length===3`),'更新履歴');
  assert.equal(await child(0,`document.querySelector('textarea').disabled`),false);
  await child(0,`document.querySelector('.navigation-history>button').click()`);
  await until(()=>child(0,`!document.querySelector('.navigation-history')&&document.querySelector('.navigation-evaluate')?.disabled===false`),'履歴の目標と同期');
  assert.equal(await child(1,`document.querySelector('textarea').value`),DEFAULT_NAVIGATION_GOAL);
  assert.equal(aiCalls,5);
  assert.equal(await child(0,`document.querySelectorAll('.terminal-welcome').length`),0);
  assert.equal(await child(1,`document.querySelectorAll('.terminal-welcome').length`),1);
  assert.equal(await child(1,`document.querySelectorAll('.terminal-welcome .welcome-mark').length`),1);
  await child(0,`document.querySelector('[aria-label="Navigatorを閉じる"]').click()`);
  await until(()=>evaluate(`testNavi[0].closed`),'Navi 1 close');
  assert.equal(await child(1,`document.querySelector('textarea').value`),DEFAULT_NAVIGATION_GOAL);
  await child(1,`document.querySelector('[aria-label="Navigatorを閉じる"]').click()`);
  standalone=await startDevelopment(project,{kind:'navi',navigationOptions:{defaultModel:async()=>({provider:"aidiy_hermes",model:"same"}),availability:async()=>({available:dependencyReady,reason:dependencyReady?'':'試験依存が停止しています'}),stateRoot:join(temporary,'standalone-state'),runAgent:()=>{throw Error('No standalone AI expected');}}});
  await send('Page.navigate',{url:standalone.url});
  await until(()=>evaluate(`!!document.querySelector('.navigation-panel.standalone textarea')`),'standalone Navigation');
  assert.ok(await evaluate(`document.body.textContent.includes('AiDiy Navigator')`));
  assert.ok(await evaluate(`document.querySelector('.navigation-project').textContent.includes('project')`));
  await evaluate(`document.querySelector('.navigation-model-line button').click()`);
  await until(()=>evaluate(`!!document.querySelector('.navigation-model-picker')`),'standalone model dialog');
  assert.ok(await evaluate(`document.querySelector('.navigation-model-picker').textContent.includes('same')`));
  const capture=await send('Page.captureScreenshot',{format:'png'});
  mkdirSync(mockOutput('temp/navigation-ui-check'),{recursive:true});writeFileSync(join(mockOutput('temp/navigation-ui-check'),'standalone.png'),Buffer.from(capture.result.data,'base64'));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,ai:'mock only',aiCalls,checks:['two popup windows','independent model/result/evaluation','Explorer unchanged','close isolation','editable during running','changed/restored/empty draft','failure and retry','history sync']}));

  }
} catch(error) {
  await record.capture('failure',error);throw error;
} finally {
  socket?.close(); if(chrome.exitCode===null&&chrome.signalCode===null){const exited = once(chrome, 'exit'); chrome.kill(); await exited;}
  await standalone?.close();await app.close(); connection.close(); for (const timer of replies) clearTimeout(timer);
  core.closeAllConnections(); await new Promise(done => core.close(done));
  if(!resolve(temporary).startsWith(resolve(tmpdir())+sep))throw Error('一時保存先が不正です。');
  removeMockDirectory(temporary);
}

