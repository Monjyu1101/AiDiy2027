// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// AiDiy解析の指示復元・結果保存・ダイアログを実画面で検証する。
// ルートから node frontend_ide/scripts/check-file-analysis.mjs。オフラインだけを使いAI接続はしない。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startDevelopment } from '../server.mjs';

const project = mkdtempSync(join(tmpdir(), 'aidiy_autodrive-'));
mkdirSync(join(project,'nested'));
writeFileSync(join(project,'first.txt'),'First preview');
writeFileSync(join(project,'nested','next.txt'),'Next preview');
const baseTime = Date.now()/1000;
writeFileSync(join(project,'picture.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="cyan"/></svg>');
utimesSync(join(project,'picture.svg'),baseTime-180,baseTime-180);
utimesSync(join(project,'nested','next.txt'),baseTime-120,baseTime-120);
utimesSync(join(project,'first.txt'),baseTime-60,baseTime-60);
mkdirSync(join(project,'nested','deep'));
mkdirSync(join(project,'other'));
for(const name of ['nested/deep/inside.txt','other/remote.txt']){
  writeFileSync(join(project,name),'Explorer warp preview');utimesSync(join(project,name),baseTime-180,baseTime-180);
}
let finishAnalysis,calls=0;
const app = await startDevelopment(project,{fileAnalysisOptions:{pollMs:50,runAgent:async({prompt})=>{
  calls++;await new Promise(resolve=>{finishAnalysis=resolve;});
  const spec=JSON.parse(prompt.split('形式: ')[1].split('\n')[0]),target=prompt.match(/結果は (temp\/[^ ]+)\.tmp に/)[1];
  writeFileSync(join(project,target),JSON.stringify({...spec,content:'# 機能概要\nこれは検証用の解析結果です。\n\n## 主な役割\n- 入力ファイルの内容を表示します。\n- 実行入口は `main` です。\n\n<script>window.analysisInjected=true</script>\n![外部画像](https://example.invalid/image.png)'}));
}}});
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
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    let clock=0,sequence=0;const callbacks=new Map();
    performance.now=()=>clock;
    const timers=new Map(),realTimeout=window.setTimeout.bind(window),realClear=window.clearTimeout.bind(window);let timerId=-1;
    window.setTimeout=(fn,ms,...args)=>{if(ms!==180000)return realTimeout(fn,ms,...args);const id=timerId--;timers.set(id,{at:clock+ms,fn:()=>fn(...args)});return id;};
    window.clearTimeout=id=>{timers.delete(id);realClear(id);};
    window.previewRemaining=()=>[...timers.values()].map(t=>t.at-clock);
    window.runPreviewTimers=()=>{for(const [id,t] of timers)if(t.at<=clock){timers.delete(id);t.fn();}};
    window.requestAnimationFrame=callback=>{callbacks.set(++sequence,callback);return sequence;};
    window.cancelAnimationFrame=id=>callbacks.delete(id);
    window.orbitTestAdvance=ms=>{const end=clock+ms;while(clock<end){clock=Math.min(end,clock+250);const batch=[...callbacks.values()];callbacks.clear();for(const callback of batch)callback(clock);}return clock;};
    const realFetch=window.fetch.bind(window);window.analysisSaveError=false;window.analysisSaveCalls=[];
    window.fetch=(url,options)=>{
      if(String(url).startsWith('/api/file-analysis')&&options?.method==='PUT'){
        window.analysisSaveCalls.push(JSON.parse(options.body));
        if(window.analysisSaveError)return Promise.resolve(new Response(JSON.stringify({error:'指示保存の試験エラー'}),{status:503,headers:{'content-type':'application/json'}}));
      }
      return realFetch(url,options);
    };
  `});
  await send('Page.navigate', { url });
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
    return response.result?.result?.value;
  }
  const captureStamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace(/\D/g,'');
  let captureNumber=0;
  async function capture(name) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const directory=resolve('temp/file-analysis-check');mkdirSync(directory,{recursive:true});
    const path=join(directory,`${captureStamp}_${String(++captureNumber).padStart(2,'0')}_${name.replace(/^nn-/,'')}`);
    writeFileSync(path, Buffer.from(shot.result.data, 'base64'));
    console.log(path);
  }
  await sleep(1000);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
  for(let i=0;i<100&&!await evaluate(`!!window.aidiyIDE?.world`);i++)await sleep(100);
  assert.equal(await evaluate(`!!window.aidiyIDE?.world`),true);
  assert.equal(await evaluate(`document.querySelector('[role=switch][aria-label="自動探索"]').getAttribute('aria-checked')`),'true');
  const advance = ms => evaluate(`window.orbitTestAdvance(${ms})`);
  const view = () => evaluate(`({...window.aidiyIDE.goal})`);
  async function until(expression,message) {
    for(const deadline=Date.now()+30000;Date.now()<deadline;){
      if(await evaluate(expression))return;
      await advance(250);await sleep(20);
    }
    assert.fail(message+' '+JSON.stringify(await evaluate(`({trail:window.aidiyIDE.trail,warping:document.querySelector('.space-canvas').classList.contains('warping'),preview:document.querySelector('.viewer-popup')?.textContent?.slice(0,100)})`)));
  }
  const preview=()=>evaluate(`document.querySelector('.viewer-popup')?.textContent||''`);
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('first.txt')`,'起動ファイルを表示');
  await evaluate(`window.aidiyIDE.setAutoSpin(false);document.querySelector('[aria-label="AiDiy分析"]').click()`);
  await until(`document.querySelector('.file-analysis-dialog[open] textarea')&&!document.querySelector('.file-analysis-dialog textarea').disabled`,'解析ダイアログを開く');
  assert.match(await evaluate(`document.querySelector('#file-analysis-instruction').value`),/機能概要/);assert.equal(calls,0,'開くだけではエージェントを実行しない');
  await evaluate(`const input=document.querySelector('#file-analysis-instruction');input.value='機能概要と処理の流れを説明してください';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label="AiDiy解析を閉じる"]').click()`);
  await until(`!document.querySelector('.file-analysis-dialog')`,'指示を保存して閉じる');
  await evaluate(`document.querySelector('[aria-label="AiDiy分析"]').click()`);
  await until(`document.querySelector('#file-analysis-instruction')?.value==='機能概要と処理の流れを説明してください'`,'前回指示を復元');
  // 保存失敗時は入力を残し、編集継続・明示破棄・保存再試行を選べる。
  const savesBeforeFailure=await evaluate(`analysisSaveCalls.length`);
  await evaluate(`{const input=document.querySelector('#file-analysis-instruction');input.value='保存せずに破棄する指示';input.dispatchEvent(new Event('input',{bubbles:true}));analysisSaveError=true;const close=document.querySelector('[aria-label="AiDiy解析を閉じる"]');close.click();close.click();}`);
  await until(`!!document.querySelector('.analysis-save-error')&&!document.querySelector('[aria-label="AiDiy解析を閉じる"]').disabled`,'保存失敗時に閉じ方を選べる');
  assert.equal(await evaluate(`analysisSaveCalls.length`),savesBeforeFailure+1,'保存中の連打では重複保存しない');
  assert.equal(await evaluate(`!!document.querySelector('.file-analysis-dialog[open]')`),true);
  assert.equal(await evaluate(`document.querySelector('#file-analysis-instruction').value`),'保存せずに破棄する指示');
  assert.match(await evaluate(`document.querySelector('.analysis-save-error').textContent`),/指示保存の試験エラー.*今回の指示の変更は失われます/s);
  assert.equal(await evaluate(`document.activeElement.textContent`),'編集を続ける','失敗時は安全な選択肢にフォーカスする');
  await evaluate(`[...document.querySelectorAll('.analysis-save-error button')].find(b=>b.textContent==='編集を続ける').click()`);
  await until(`!document.querySelector('.analysis-save-error')`,'閉じる操作を取り消して編集を続ける');
  assert.equal(await evaluate(`document.querySelector('#file-analysis-instruction').value`),'保存せずに破棄する指示');
  assert.equal(await evaluate(`document.activeElement.id`),'file-analysis-instruction');
  assert.equal(await evaluate(`analysisSaveCalls.length`),savesBeforeFailure+1);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await until(`!!document.querySelector('.analysis-save-error')`,'Escからの保存失敗も同じ選択肢を出す');
  assert.equal(await evaluate(`analysisSaveCalls.length`),savesBeforeFailure+2);
  await capture('01-analysis-save-failure.png');
  await evaluate(`[...document.querySelectorAll('.analysis-save-error button')].find(b=>b.textContent==='保存せずに閉じる').click()`);
  await until(`!document.querySelector('.file-analysis-dialog')`,'保存できなくても明示破棄で閉じられる');
  assert.equal(await evaluate(`analysisSaveCalls.length`),savesBeforeFailure+2,'破棄で保存を再実行しない');
  assert.equal((await fetch(url+'api/file-analysis?path=first.txt').then(r=>r.json())).instruction,'機能概要と処理の流れを説明してください','破棄は前回保存した指示を上書きしない');
  await evaluate(`document.querySelector('[aria-label="AiDiy分析"]').click()`);
  await until(`document.querySelector('#file-analysis-instruction')?.value==='機能概要と処理の流れを説明してください'`,'破棄後は保存済みの指示を復元');
  await evaluate(`{const input=document.querySelector('#file-analysis-instruction');input.value='機能概要と処理の流れを説明してください（保存を再試行）';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label="AiDiy解析を閉じる"]').click();}`);
  await until(`!!document.querySelector('.analysis-save-error')`,'再試行する指示の保存失敗を表示');
  await evaluate(`analysisSaveError=false;[...document.querySelectorAll('.analysis-save-error button')].find(b=>b.textContent==='保存して閉じる').click()`);
  await until(`!document.querySelector('.file-analysis-dialog')`,'保存の再試行が成功したら閉じる');
  assert.equal(await evaluate(`analysisSaveCalls.length`),savesBeforeFailure+4);
  await evaluate(`document.querySelector('[aria-label="AiDiy分析"]').click()`);
  await until(`document.querySelector('#file-analysis-instruction')?.value==='機能概要と処理の流れを説明してください（保存を再試行）'`,'再試行で保存した指示を復元');
  assert.equal(calls,0,'閉じる操作の失敗や再試行でエージェントを実行しない');
  await capture('01-analysis-instruction.png');
  await evaluate(`[...document.querySelectorAll('.file-analysis-dialog button')].find(b=>b.textContent==='解析を実行').click()`);
  await until(`document.querySelector('.file-analysis-dialog').textContent.includes('解析中…')`,'AI解析を依頼');
  assert.equal(calls,1);
  await evaluate(`document.querySelector('[aria-label="AiDiy解析を閉じる"]').click()`);
  await until(`!document.querySelector('.file-analysis-dialog')`,'実行中もダイアログを閉じられる');
  finishAnalysis();
  let record;for(let i=0;i<100;i++){record=await fetch(url+'api/file-analysis?path=first.txt').then(r=>r.json());if(record.result)break;await sleep(50);}
  assert.match(record.result.content,/検証用/);
  await evaluate(`document.querySelector('[aria-label="AiDiy分析"]').click()`);
  await until(`document.querySelector('.analysis-result')?.textContent.includes('検証用')`,'保存済みの結果を表示');
  assert.equal(await evaluate(`window.analysisInjected===true`),false);assert.equal(await evaluate(`document.querySelectorAll('.analysis-result img').length`),0);
  await evaluate(`window.aidiyIDE.clear()`);
  assert.equal(await evaluate(`!!document.querySelector('.file-analysis-dialog[open]')`),true,'ビューア消去後も解析ダイアログを維持');
  await capture('02-analysis-result.png');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await sleep(100);await advance(500);
  const bounds=await evaluate(`(()=>{const d=document.querySelector('.file-analysis-dialog'),r=d.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:d.scrollWidth,client:d.clientWidth}})()`);
  assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.bottom<=bounds.height&&bounds.scroll<=bounds.client,'縦表示でもダイアログが画面内に収まる');
  await capture('03-analysis-portrait.png');
  await evaluate(`document.querySelector('[aria-label="AiDiy解析を閉じる"]').click()`);
  await until(`!document.querySelector('.file-analysis-dialog')`,'解析を閉じる');
  await evaluate(`void window.aidiyIDE.goTo({path:'picture.svg',type:'file'})`);
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('picture.svg')`,'画像ファイルを開く');
  await evaluate(`document.querySelector('[aria-label="AiDiy分析"]').click()`);
  await until(`document.querySelector('#file-analysis-instruction')&&!document.querySelector('#file-analysis-instruction').disabled`,'画像用の指示を読み込む');
  assert.match(await evaluate(`document.querySelector('#file-analysis-instruction').value`),/この画像.*構図・配色/);
  await capture('04-image-instruction.png');
  await evaluate(`{const input=document.querySelector('#file-analysis-instruction');input.value='画像内の文字を読み取ってください';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label="AiDiy解析を閉じる"]').click();}`);
  await until(`!document.querySelector('.file-analysis-dialog')`,'画像の指示を保存');
  await evaluate(`document.querySelector('[aria-label="AiDiy分析"]').click()`);
  await until(`document.querySelector('#file-analysis-instruction')?.value==='画像内の文字を読み取ってください'`,'画像でも前回指示を優先して復元');
  assert.equal(calls,1,'画像を開くだけでは解析しない');
  assert.deepEqual(errors,[]);console.log('FILE ANALYSIS PASS: ソースと画像の指示例・前回指示優先・保存失敗時の入力保持・×とEsc・編集継続・明示破棄・保存再試行・明示実行・閉じた後の保存・結果復元・HTML無効化・ビューア独立・縦表示');
  ws.close();
} finally {
  chrome.kill();await app.close();await sleep(300);
  for(const path of [profile,project]){if(!resolve(path).startsWith(resolve(tmpdir())+(process.platform==='win32'?'\\':'/')))throw Error('一時パスが不正です');try{rmSync(path,{recursive:true,force:true});}catch{}}
}
