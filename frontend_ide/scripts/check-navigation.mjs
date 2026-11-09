// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 模擬AIと実ブラウザで複数Naviの入力・結果・モデル・終了の独立を確認する。
// ルートから node frontend_ide/scripts/check-navigation.mjs。CHROME_PATHでブラウザを指定可能。
// --step-4 は画面からの作成・再評価と保存内容の整合確認だけを実行する。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createNavigationScreenRecord } from './navigation-step4-check.mjs';
import { createCoreConnection } from '../viewer/core-connection.mjs';
import {startMockDevelopment as startDevelopment,mockOutput,mockStage,removeMockDirectory} from '../checks/navigation-mock-support.mjs';

const chromePath = process.env.CHROME_PATH || [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
  .filter(Boolean).flatMap(base => ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].map(tail => join(base, tail))).find(existsSync)
  || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chromePath) throw Error('Chrome / Edge が見つかりません。CHROME_PATH を指定してください。');
const temporary = mkdtempSync(join(tmpdir(), 'aidiy-connection-check-'));
const project = join(temporary, 'project'); mkdirSync(project);
writeFileSync(join(project, 'README.md'), '# 接続表示の検証\n', 'utf8');
const step4=process.argv.includes('--step-4');
const record=createNavigationScreenRecord({name:'check-navigation',temporary,project,stateRoot:join(temporary,'navigation-state')});
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
let aiCalls=0,failNext=false;
const app = await startDevelopment(project, { connection, navigationOptions:{defaultModel:async()=>({provider:'aidiy_hermes',model:'auto'}),stateRoot:join(temporary,'navigation-state'),providerList:async()=>({providers:['aidiy_hermes'],notice:''}),runAgent:async({prompt})=>{
 if(step4)return record.respond(prompt);
 aiCalls++;if(failNext){failNext=false;await new Promise(r=>setTimeout(r,800));throw Error('表示試験の失敗');}const shape=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1).replace(/^出力形式: /,''));
 shape.items=[{id:'one',name:'検索画面の入力を整える',progress:65,reason:'入力欄を確認。空入力の検証を次に行います。'},{id:'two',name:'操作ガイドを整える',progress:20,reason:'既存の章に追記する方針です。'}];shape.schemaVersion=3;shape.nextItemId='one';shape.items.forEach((item,index)=>{item.weight=[80,20][index];item.weightReason='表示試験用の作業量見積もり';});shape.overall={progress:56,reason:'作業量に基づく加重評価の模擬結果'};shape.nextPrompt='検索画面の空入力とエラー表示を確認し、必要なテストを追加してください。';
 await new Promise(r=>setTimeout(r,1000));return {content:JSON.stringify(shape)};
}} });
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'browser')}`,
  '--window-size=1280,800', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(check, label) { mockStage(label); const end = Date.now() + 30000; while (Date.now() < end) { if (await check()) return; await sleep(100); } throw Error(`待機タイムアウト: ${label}`); }
let socket,standalone;
try {
  const activePort = join(temporary, 'browser', 'DevToolsActivePort');
  const { readFileSync } = await import('node:fs');
  let port;await until(()=>{try{if(!existsSync(activePort))return false;port=readFileSync(activePort,'utf8').split('\n')[0];return /^\d+$/.test(port);}catch(error){if(['EBUSY','EACCES','ENOENT'].includes(error.code))return false;throw error;}},'ブラウザ起動');
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
  // 枠と文字の試験は羽衣ライディングを明示選択し、ランダムな演出種別に依存させない。
  const runRide=async selector=>{await child(0,`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true}))`);await until(()=>child(0,`!!document.querySelector('[data-scene=ride]')`),'羽衣ライディングを選択');await child(0,`document.querySelector('[data-scene=ride]').click()`);};
  record.bind({evaluate,child,app,port,target,errors,getAiCalls:()=>aiCalls});
  await until(()=>evaluate(`!!testNavi[0]?.document.querySelector('textarea')`),'Navi 1');
  await until(()=>child(0,`!!document.querySelector('.navigation-start:not(:disabled)')`),'Navi 1 実行可能');
  if(step4){await record.run();}else{
  assert.equal(await child(0,`document.querySelector('textarea').rows`),4);
  assert.equal(await child(0,`(async()=>{const mark=document.querySelector('.mark-escape'),rect=mark.getBoundingClientRect(),offset=()=>parseFloat(mark.style.transform.match(/-?[0-9.]+/)[0]),wait=()=>new Promise(resolve=>setTimeout(resolve,50));mark.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse',clientX:rect.left+1,clientY:rect.top+rect.height/2}));for(let i=0;i<40&&offset()<2;i++)await wait();const moved=offset();document.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',clientX:-2000,clientY:-2000}));for(let i=0;i<40&&offset()>=moved;i++)await wait();const returning=offset();return moved>=2&&returning>=0&&returning<moved&&!!mark.querySelector('.welcome-mark img');})()`),true);
  await child(0,`(()=>{const t=document.querySelector('textarea');t.value='検索画面を整える';t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await runRide('.navigation-start');
  await until(()=>child(0,`!!document.querySelector('.navigation-display.running')`),'nav busy');
  assert.equal(await child(0,`document.querySelector('.terminal-welcome h1').textContent`),'FINDING YOUR ROUTE');
  assert.equal(await child(0,`(()=>{const button=document.querySelector('.navigation-stop');return !!button&&!button.disabled&&button.querySelector('.navigation-stop-label')?.textContent==='調査中'&&!document.querySelector('.navigation-start');})()`),true);
  assert.equal(await child(0,`getComputedStyle(document.querySelector('.navigation-display'),'::before').top`),'2px');
  assert.equal(await child(0,`getComputedStyle(document.querySelector('.navigation-display'),'::after').bottom`),'2px');
  assert.equal(await child(0,`getComputedStyle(document.querySelector('.navigation-form-foot')).marginTop`),'3px');
  assert.equal(await child(0,`getComputedStyle(document.querySelector('.navigation-goal-form')).paddingBottom`),'3px');
  const popupTarget=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page'&&item.id!==target.id);
  assert.ok(popupTarget,'Naviの画面を取得できません');
  const popupSocket=new WebSocket(popupTarget.webSocketDebuggerUrl);await once(popupSocket,'open');
  const popupCapture=new Promise(resolve=>popupSocket.addEventListener('message',event=>{const response=JSON.parse(event.data);if(response.id===1)resolve(response); }));
  popupSocket.send(JSON.stringify({id:1,method:'Page.captureScreenshot',params:{format:'png'}}));
  const routeCapture=await popupCapture;popupSocket.close();
  mkdirSync(mockOutput('temp/navigation-ui-check'),{recursive:true});writeFileSync(join(mockOutput('temp/navigation-ui-check'),'route.png'),Buffer.from(routeCapture.result.data,'base64'));
  assert.equal(await child(0,`getComputedStyle(document.querySelector('.navigation-display'),'::before').animationName`),'prompt-reflect');
  await until(()=>child(0,`document.querySelectorAll('.navigation-items .navigation-progress').length===2`),'Navi 1 result');
  assert.match(await child(0,`document.querySelector('.navigation-task-heading').textContent`),/^タスク \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\)$/);
  assert.equal(await child(0,`document.querySelector('.navigation-content').textContent.includes('Naviを更新しました')`),false);
  assert.equal(await child(0,`(()=>{const content=document.querySelector('.navigation-content'),items=content.querySelector('.navigation-items'),note=content.querySelector('.navigation-estimate-note');return !content.querySelector('.navigation-result-heading')&&items.nextElementSibling===note&&note.textContent.includes('達成度はAIの推定');})()`),true);
  assert.equal(await child(0,`document.querySelector('.navigation-overall [role="progressbar"]').getAttribute('aria-valuenow')`),'56');
  assert.equal(await child(0,`document.querySelector('.navigation-overall-reason').textContent`),'作業量に基づく加重評価の模擬結果');
  assert.equal(await child(0,`(()=>{const content=document.querySelector('.navigation-content'),row=document.querySelector('.navigation-items li'),overall=document.querySelector('.navigation-overall .navigation-progress'),spacer=document.createElement('div');spacer.style.height='1000px';content.append(spacer);const ok=content.scrollHeight>content.clientHeight&&Math.abs(row.getBoundingClientRect().right-overall.getBoundingClientRect().right)<2;spacer.remove();return ok;})()`),true);
  assert.ok(await child(0,`document.querySelector('.navigation-effort').textContent.includes('80%')&&document.querySelector('.navigation-effort').textContent.includes('表示試験用の作業量見積もり')`));
  assert.equal(await child(0,`document.querySelector('.navigation-next').parentElement.classList.contains('navigation-panel')`),true);
  assert.equal(await child(0,`document.querySelector('.navigation-overall').parentElement.classList.contains('navigation-panel')`),true);
  assert.equal(await child(0,`document.querySelector('.navigation-goal-form label').textContent`),'目標');
  assert.equal(await child(0,`document.querySelector('.navigation-next h2').textContent`),'プロンプト(案)');
  assert.equal(await child(0,`document.querySelectorAll('.navigation-purpose,.navigation-target').length`),0);
  assert.equal(await child(0,`document.querySelector('.navigation-prompt').textContent`),'検索画面の空入力とエラー表示を確認し、必要なテストを追加してください。');
  assert.equal(await child(0,`(()=>{const goal=document.querySelector('.navigation-goal-form textarea'),prompt=document.querySelector('.navigation-prompt'),original=prompt.innerHTML;prompt.textContent=('表示確認'+String.fromCharCode(10)).repeat(12);const ok=Math.abs(goal.getBoundingClientRect().height-prompt.getBoundingClientRect().height)<2&&prompt.scrollHeight>prompt.clientHeight&&getComputedStyle(prompt).overflowY==='auto';prompt.innerHTML=original;return ok;})()`),true);
  assert.equal(await child(0,`document.querySelectorAll('.navigation-disclosure[open]').length`),0);
  assert.equal(await child(0,`(()=>{const items=document.querySelectorAll('.navigation-items details'),overall=document.querySelector('.navigation-overall details');items[0].querySelector('summary').click();return items[0].open&&!items[1].open&&!overall.open;})()`),true);
  assert.equal(await child(0,`(()=>{const items=document.querySelectorAll('.navigation-items details'),overall=document.querySelector('.navigation-overall details');overall.querySelector('summary').click();return items[0].open&&!items[1].open&&overall.open;})()`),true);
  assert.equal(await child(0,`(()=>{document.querySelectorAll('.navigation-disclosure[open]>summary').forEach(summary=>summary.click());return document.querySelectorAll('.navigation-disclosure[open]').length;})()`),0);

  const resultLayout=await child(0,`(()=>{const panel=document.querySelector('.navigation-panel'),content=panel.querySelector('.navigation-display'),overall=panel.querySelector('.navigation-overall'),next=panel.querySelector('.navigation-next');return {contentBottom:content.getBoundingClientRect().bottom,overallTop:overall.getBoundingClientRect().top,overallBottom:overall.getBoundingClientRect().bottom,nextTop:next.getBoundingClientRect().top,nextBottom:next.getBoundingClientRect().bottom,height:innerHeight};})()`);
  assert.ok(resultLayout.contentBottom<=resultLayout.overallTop+1);assert.ok(resultLayout.overallBottom<=resultLayout.nextTop+1);assert.ok(resultLayout.nextBottom<=resultLayout.height+1);

  assert.equal(aiCalls,1);
  await evaluate(`document.querySelector('.navigation-launch').click()`);
  await until(()=>evaluate(`!!testNavi[1]?.document.querySelector('textarea')`),'Navi 2');
  assert.equal(await child(1,`document.querySelector('textarea').value.startsWith('最近更新したファイル')`),true);
  assert.ok(await child(0,`document.body.textContent.includes('AiDiy IDE / Navi 1')`));
  assert.ok(await child(1,`document.body.textContent.includes('AiDiy IDE / Navi 2')`));
  assert.equal(await child(1,`document.querySelectorAll('.navigation-items .navigation-progress').length`),0);
  await child(1,`document.querySelector('.navigation-model-line button').click()`);
  await until(()=>child(1,`!!document.querySelector('.navigation-model-picker button[type=submit]:not(:disabled)')`),'モデル方式の確認');
  assert.deepEqual(await child(1,`[...document.querySelectorAll('.navigation-model-picker label:first-of-type select option')].map(option=>option.value)`),['aidiy_hermes']);
  const modelTarget=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page'&&item.id!==target.id&&item.id!==popupTarget.id);
  assert.ok(modelTarget,'モデル選択の画面を取得できません');
  const modelSocket=new WebSocket(modelTarget.webSocketDebuggerUrl);await once(modelSocket,'open');
  const modelCapture=new Promise(resolve=>modelSocket.addEventListener('message',event=>{const response=JSON.parse(event.data);if(response.id===1)resolve(response);}));
  modelSocket.send(JSON.stringify({id:1,method:'Page.captureScreenshot',params:{format:'png'}}));
  writeFileSync(join(mockOutput('temp/navigation-ui-check'),'models.png'),Buffer.from((await modelCapture).result.data,'base64'));modelSocket.close();
  await child(1,`(()=>{const input=document.querySelector('.navigation-model-choice');input.value='auto';input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.navigation-model-picker').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`);
  await until(()=>child(1,`document.querySelector('.navigation-model-line>span').textContent.includes('auto')`),'モデル保存');
  assert.ok(await child(0,`document.querySelector('.navigation-model-line>span').textContent.includes('aidiy_hermes')`));
  await runRide('.navigation-evaluate');
  await until(()=>child(0,`!!document.querySelector('.navigation-display.running')`),'evaluate busy');
  assert.equal(await child(0,`document.querySelector('.terminal-welcome h1').textContent`),'FINDING YOUR ROUTE');
  assert.equal(await child(0,`document.querySelectorAll('.navigation-items').length`),0);
  assert.equal(await child(0,`getComputedStyle(document.querySelector('.navigation-overall')).display`),'none');
  assert.equal(await child(0,`getComputedStyle(document.querySelector('.navigation-next')).display`),'none');
  assert.equal(await child(1,`!!document.querySelector('.navigation-display.running')`),false);
  await until(()=>child(0,`document.querySelector('.navigation-evaluate')?.disabled===false`),'評価完了');
  assert.equal(aiCalls,2);
  assert.equal(await child(0,`!!document.querySelector('.navigation-display.running')`),false);
  assert.equal(await child(1,`!!document.querySelector('.navigation-display.running')`),false);
  await child(0,`document.querySelector('.navigation-project nav button:last-child').click()`);
  await until(()=>child(0,`document.querySelectorAll('.navigation-history>button').length===1`),'history list');
  await child(0,`document.querySelector('.navigation-history>button').click()`);
  await until(()=>child(0,`!document.querySelector('.navigation-history')`),'history selected');
  assert.equal(aiCalls,2);
  assert.equal(await child(1,`document.querySelectorAll('.navigation-items .navigation-progress').length`),0);
  assert.equal(await evaluate(`document.querySelectorAll('.navigation-toggle').length`),0);
  await evaluate(`document.querySelector('.explorer-toggle').click()`);
  assert.equal(await evaluate(`document.querySelector('.space-view').classList.contains('navigation-open')`),false);
  failNext=true;
  await child(0,`document.querySelector('.navigation-start').click()`);
  await until(()=>child(0,`!!document.querySelector('.navigation-display.running')`),'failure busy');
  await until(()=>child(0,`document.body.textContent.includes('表示試験の失敗')`),'failure');
  assert.equal(await child(0,`!![...document.querySelectorAll('dialog[open]')].find(d=>d.textContent.includes('ナビの実行に失敗しました')&&d.textContent.includes('別のエージェントをお試しください。'))`),true);
  const failureSocket=new WebSocket(popupTarget.webSocketDebuggerUrl);await once(failureSocket,'open');
  const failureCapture=new Promise(resolve=>failureSocket.addEventListener('message',event=>{const response=JSON.parse(event.data);if(response.id===1)resolve(response);}));
  failureSocket.send(JSON.stringify({id:1,method:'Page.captureScreenshot',params:{format:'png'}}));
  writeFileSync(join(mockOutput('temp/navigation-ui-check'),'failure.png'),Buffer.from((await failureCapture).result.data,'base64'));failureSocket.close();
  await child(0,`[...document.querySelectorAll('dialog[open]')].find(d=>d.textContent.includes('ナビの実行に失敗しました')).querySelector('button').click()`);
  await new Promise(resolve=>setTimeout(resolve,2200));
  assert.equal(await child(0,`!![...document.querySelectorAll('dialog[open]')].find(d=>d.textContent.includes('ナビの実行に失敗しました'))`),false);
  assert.equal(await child(0,`!!document.querySelector('.navigation-display.running')`),false);
  assert.equal(await child(0,`document.querySelectorAll('.navigation-items .navigation-progress').length`),2);
  await child(0,`document.querySelector('.navigation-start').click()`);
  await until(()=>child(0,`!!document.querySelector('.navigation-display.running')`),'closing busy');
  await child(0,`document.querySelector('[aria-label="Naviを閉じる"]').click()`);
  await until(()=>evaluate(`testNavi[0].closed`),'Navi 1 close');
  assert.equal(await child(1,`document.querySelector('textarea').value.startsWith('最近更新したファイル')`),true);
  await child(1,`document.querySelector('[aria-label="Naviを閉じる"]').click()`);
  standalone=await startDevelopment(project,{kind:'navi',navigationOptions:{stateRoot:join(temporary,'standalone-state'),runAgent:()=>{throw Error('No standalone AI expected');}}});
  await send('Emulation.setDeviceMetricsOverride',{width:500,height:600,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:standalone.url});
  await until(()=>evaluate(`!!document.querySelector('.navigation-panel.standalone textarea')`),'standalone Navi');
  assert.equal(await evaluate(`document.querySelector('.navigation-panel.standalone textarea').rows`),4);
  const goalLayout=await evaluate(`(()=>{const t=document.querySelector('.navigation-panel.standalone textarea'),s=getComputedStyle(t);return {height:t.getBoundingClientRect().height,resize:s.resize,maxHeight:s.maxHeight};})()`);
  assert.ok(goalLayout.height>48&&goalLayout.height<=120);assert.equal(goalLayout.resize,'vertical');assert.equal(goalLayout.maxHeight,'120px');
  const inputCapture=await send('Page.captureScreenshot',{format:'png'});
  mkdirSync(mockOutput('temp/navigation-ui-check'),{recursive:true});writeFileSync(join(mockOutput('temp/navigation-ui-check'),'three-row-input.png'),Buffer.from(inputCapture.result.data,'base64'));
  assert.ok(await evaluate(`document.body.textContent.includes('AiDiy Navi')`));
  assert.ok(await evaluate(`document.querySelector('.navigation-project').textContent.includes('project')`));
  await evaluate(`document.querySelector('.navigation-model-line button').click()`);
  await until(()=>evaluate(`!!document.querySelector('.navigation-model-picker')`),'standalone model dialog');
  assert.ok(await evaluate(`document.querySelector('.navigation-model-picker').textContent.includes('same')`));
  const capture=await send('Page.captureScreenshot',{format:'png'});
  mkdirSync(mockOutput('temp/navigation-ui-check'),{recursive:true});writeFileSync(join(mockOutput('temp/navigation-ui-check'),'standalone.png'),Buffer.from(capture.result.data,'base64'));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,ai:'mock only',aiCalls,checks:['two popup windows','independent model/result/evaluation','Explorer unchanged','close isolation']}));

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

