// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// AiDiy検索の画面とファイル受取を模擬エージェントで検証する。
// ルートから node frontend_ide/scripts/check-ai-search.mjs。オフラインだけを使いAI接続はしない。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startDevelopment } from '../server.mjs';

const project = mkdtempSync(join(tmpdir(), 'aidiy_ai_search-'));
mkdirSync(join(project,'src'));
writeFileSync(join(project,'main.ts'),'// main');
writeFileSync(join(project,'src','login.ts'),'// authentication');
for(const [path,age] of [['recent/deep/changed.ts',120],['older/hour.ts',1200],['archive/old.ts',172800]]){
  mkdirSync(join(project,path,'..'),{recursive:true});writeFileSync(join(project,path),'// 起点検索の検証');
  const at=Date.now()/1000-age;utimesSync(join(project,path),at,at);
}
let clock=Date.now();
const requests=[];
const app=await startDevelopment(project,{aiSearchOptions:{now:()=>clock,runAgent:async args=>{requests.push(args);return new Promise(()=>{});}}});
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
  // OSのアクセシビリティ設定とは独立して通常アニメーションを検証する。
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
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
  `});
  await send('Page.navigate', { url });
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
    return response.result?.result?.value;
  }
  async function capture(name) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const directory=resolve('temp/ai-search-check');mkdirSync(directory,{recursive:true});
    const path=join(directory,name.replace(/^nn-/,''));
    writeFileSync(path, Buffer.from(shot.result.data, 'base64'));
    console.log(path);
  }
  await sleep(1000);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
  for(let i=0;i<100&&!await evaluate(`!!window.aidiyIDE?.world`);i++)await sleep(100);
  assert.equal(await evaluate(`!!window.aidiyIDE?.world`),true);
  await evaluate(`window.aidiyIDE.setAutoSpin(false);document.querySelector('.explorer-toggle').click()`);
  const openFolders=()=>evaluate(`[...document.querySelectorAll('[role=treeitem][aria-expanded=true]')].map(row=>row.dataset.path).sort()`);
  async function settleTree(){await evaluate('window.orbitTestAdvance(500)');await sleep(300);}
  async function settlePreset(){await settleTree();await sleep(100);await settleTree();}
  const preset=async label=>{
    await evaluate(`window.presetTrace=[];window.presetObserver?.disconnect();window.presetObserver=new MutationObserver(()=>window.presetTrace.push({root:document.querySelector('.explorer-root .chevron').getAttribute('aria-expanded'),rows:document.querySelectorAll('[role=treeitem]').length}));window.presetObserver.observe(document.querySelector('[role=tree]'),{childList:true});[...document.querySelectorAll('.since-presets button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
    assert.equal(await evaluate(`document.querySelector('.explorer-root .chevron').getAttribute('aria-expanded')`),'false','まずルートを閉じる');
    await settlePreset();
    assert.equal(await evaluate(`window.presetTrace.some(state=>state.root==='false'&&state.rows===0)`),true,'全行が消えてから再展開する');
    await evaluate(`window.presetObserver.disconnect()`);
  };
  const initialTrail=await evaluate(`window.aidiyIDE.trail`);
  await evaluate(`document.querySelector('[data-path="archive"] .chevron').click();document.querySelector('.explorer-root .chevron').click()`);
  await preset('15分');
  assert.deepEqual(await openFolders(),['recent','recent/deep','src'],'古い手動展開を閉じ、一致ファイルの祖先だけ展開');
  assert.equal(await evaluate(`document.querySelector('.explorer-root .chevron').getAttribute('aria-expanded')`),'true');
  await evaluate(`document.querySelector('[data-path="archive"] .chevron').click();document.querySelector('[data-path="recent"] .chevron').click()`);
  await preset('15分');
  assert.deepEqual(await openFolders(),['recent','recent/deep','src'],'同じプリセットの再クリックでも展開を組み直す');
  await preset('1時間');assert.deepEqual(await openFolders(),['older','recent','recent/deep','src']);
  await evaluate(`[...document.querySelectorAll('.since-presets button')].find(b=>b.textContent==='15分').click()`);
  await evaluate('window.orbitTestAdvance(500)');await sleep(40);
  await evaluate(`[...document.querySelectorAll('.since-presets button')].find(b=>b.textContent==='1時間').click()`);
  await settlePreset();assert.deepEqual(await openFolders(),['older','recent','recent/deep','src'],'連続選択では最後の期間だけ展開');
  await evaluate(`[...document.querySelectorAll('.since-presets button')].find(b=>b.textContent==='15分').click();document.querySelector('input[value=grep]').click()`);
  await settlePreset();assert.deepEqual(await openFolders(),[],'検索方式の変更後に古い展開を再開しない');
  await evaluate(`document.querySelector('input[value=since]').click()`);
  await preset('起動');assert.deepEqual(await openFolders(),[],'一致なしはルート直下だけ');
  await preset('今日');assert.equal((await openFolders()).includes('archive'),false);
  await preset('解除');assert.deepEqual(await openFolders(),[]);
  await evaluate(`{const input=document.querySelector('input[type="datetime-local"]');input.value='2099-01-01T00:00:00';input.dispatchEvent(new Event('change',{bubbles:true}));}`);
  assert.deepEqual(await openFolders(),[]);
  assert.deepEqual(await evaluate(`window.aidiyIDE.trail`),initialTrail,'起点検索では宇宙を移動しない');
  await preset('15分');await capture('nn-since-matching-folders.png');
  // CSSの実時間で途中の高さを測り、一括表示・消去になっていないことを確認する。
  await evaluate(`document.querySelector('[data-path="recent"] .chevron').click()`);
  // Vueの二重rAFを別々の描画フレームへ進める。一括で進めるとCSS開始前に両方実行される。
  await evaluate('window.orbitTestAdvance(16)');await sleep(32);
  await evaluate('window.orbitTestAdvance(16)');await sleep(80);
  const collapsing=await evaluate(`document.querySelector('[data-path="recent/deep/changed.ts"]')?.getBoundingClientRect().height`);
  assert.ok(collapsing>0&&collapsing<25,'折りたたみ途中で行の高さが連続して縮む: '+JSON.stringify(await evaluate(`({height:document.querySelector('[data-path="recent/deep/changed.ts"]')?.getBoundingClientRect().height,classes:document.querySelector('[data-path="recent/deep/changed.ts"]')?.className,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,animations:document.getAnimations().map(a=>({state:a.playState,time:a.currentTime,target:a.effect.target?.dataset?.path}))})`)));
  await settleTree();
  assert.equal(await evaluate(`!!document.querySelector('[data-path="recent/deep/changed.ts"]')`),false);
  await evaluate(`document.querySelector('[data-path="recent"] .chevron').click()`);
  await evaluate('window.orbitTestAdvance(16)');await sleep(32);
  await evaluate('window.orbitTestAdvance(16)');await sleep(80);
  const expanding=await evaluate(`document.querySelector('[data-path="recent/deep/changed.ts"]')?.getBoundingClientRect().height`);
  assert.ok(expanding>0&&expanding<25,'展開途中で行の高さが連続して伸びる');
  await settleTree();
  for(let i=0;i<3;i++){await evaluate(`document.querySelector('[data-path="recent"] .chevron').click()`);await evaluate('window.orbitTestAdvance(500)');await sleep(30);}
  await settleTree();
  assert.equal(await evaluate(`document.querySelector('[data-path="recent"]').getAttribute('aria-expanded')`),'false','連打後のフォルダ状態は閉じる');
  // leaveの取消・再開始で予約された二重rAFも進め、実CSSの終了を待つ。
  for(let i=0;i<30&&await evaluate(`!!document.querySelector('[data-path="recent/deep/changed.ts"]')`);i++){await evaluate('window.orbitTestAdvance(500)');await sleep(100);}
  assert.equal(await evaluate(`!!document.querySelector('[data-path="recent/deep/changed.ts"]')`),false,'連打後も最後の折りたたみ状態になる');
  await preset('15分');
  await evaluate(`document.querySelector('input[value=ai]').click()`);
  const treeVisible=()=>evaluate(`document.querySelector('[role=tree]').getClientRects().length>0`);
  assert.equal(await treeVisible(),true,'AiDiy検索でもファイルツリーを表示する');
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.explorer-search')).maxHeight`),'none','検索操作はツリーの領域を残す');
  for(const mode of ['since','grep']){
    await evaluate(`document.querySelector('input[value=${mode}]').click()`);
    assert.equal(await treeVisible(),true,'通常の検索へ戻るとツリーを再表示');
    await evaluate(`document.querySelector('input[value=ai]').click()`);
    assert.equal(await treeVisible(),true,'検索方法を切り替えてもツリーを維持する');
  }
  async function until(expression,message){const end=Date.now()+15000;while(Date.now()<end){await evaluate('window.orbitTestAdvance(250)');if(await evaluate(expression))return;await sleep(60);}await capture('failure.png');throw Error(message+' '+JSON.stringify(await evaluate(`({paths:[...document.querySelectorAll('.viewer-path')].map(x=>x.textContent),trail:aidiyIDE.trail,text:document.body.innerText.slice(-1600)})`)));}
  async function submit(query){await evaluate(`(()=>{const input=document.querySelector('.ai-search-panel textarea');input.value=${JSON.stringify(query)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await evaluate(`document.querySelector('.ai-search-panel form').requestSubmit()`);}
  async function waitRequest(count){for(let i=0;i<100&&requests.length<count;i++)await sleep(30);assert.equal(requests.length,count);return requests.at(-1);}
  function dataFor(args){const line=args.prompt.split('\n').find(line=>line.startsWith('形式: '));const data=JSON.parse(line.slice(4));return {...data,title:data.query==='認証機能に関わるファイル'?'認証処理の関連ファイル':data.query+'の関連ファイル',files:[{path:'main.ts',reason:'アプリの入口'},{path:'src/login.ts',reason:'認証処理'}],route:['main.ts','src/login.ts']};}
  function outputFor(args){return args.prompt.match(/temp\/\d{8}_\d{6}_result\.json/)[0];}
  await submit('認証機能に関わるファイル');
  const first=await waitRequest(1);
  await capture('nn-ai-search-waiting.png');
  assert.match(await evaluate(`document.querySelector('.ai-search-panel').textContent`),/最大5分/);
  const before=await evaluate(`({trail:window.aidiyIDE.trail,cam:{...window.aidiyIDE.cam}})`);
  writeFileSync(join(project,outputFor(first)),JSON.stringify(dataFor(first)));
  await until(`document.querySelector('.ai-search-panel').textContent.includes('2件の関連ファイル')`,'AI結果反映');
  const after=await evaluate(`({trail:window.aidiyIDE.trail,cam:{...window.aidiyIDE.cam}})`);
  assert.deepEqual(after.trail,before.trail,'結果受取だけで階層移動しない');
  for(const key of Object.keys(before.cam))assert.ok(Math.abs(after.cam[key]-before.cam[key])<1e-7,'結果受取だけでワープしない');
  assert.deepEqual(await evaluate('window.aidiyIDE.routeState'),{mode:'ai',paths:['main.ts','src/login.ts']});
  assert.equal(await evaluate(`document.querySelector('[data-path="src/login.ts"]').classList.contains('fresh')`),true);
  assert.equal(await evaluate(`document.querySelector('[data-path="src"]').classList.contains('fresh')`),true);
  assert.equal(await evaluate(`document.querySelector('.search-results-toggle').getAttribute('aria-expanded')`),'false','結果到着で自動展開しない');
  assert.equal(await evaluate(`!!document.querySelector('.search-results-content')`),false);
  await evaluate(`document.querySelector('.search-results-toggle').click()`);
  await capture('nn-ai-search-results.png');
  await evaluate(`[...document.querySelectorAll('.explorer-routes button')].find(b=>b.textContent==='閲覧軌跡').click()`);
  assert.equal(await evaluate('window.aidiyIDE.routeState.mode'),'view');
  await evaluate(`[...document.querySelectorAll('.explorer-routes button')].find(b=>b.textContent==='AiDiy検索軌跡').click()`);
  assert.equal(await evaluate(`document.querySelector('.ai-route-title').textContent`),'認証処理の関連ファイル');
  await evaluate(`document.querySelector('[aria-label="次の関連ファイル"]').click()`);
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('main.ts')`,'順番にファイルを開く');
  await evaluate(`document.querySelector('[aria-label="エクスプローラーを閉じる"]').click()`);
  assert.equal(await evaluate(`!!document.querySelector('.explorer-routes.explorer-collapsed')`),true);
  await evaluate(`document.querySelector('[data-route-path="src/login.ts"]').click()`);
  await until(`document.querySelector('.viewer-session')?.dataset.viewerPath==='src/login.ts'`,'AiDiy検索軌跡の一覧からワープ');
  await evaluate(`[...document.querySelectorAll('.route-choice')].find(b=>b.textContent==='閲覧軌跡').click()`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-route-point^="f:"]>[data-route-path]')].map(b=>b.dataset.routePath)`),['main.ts','src/login.ts']);
  await evaluate(`document.querySelector('[data-route-path="main.ts"]').click()`);
  await until(`document.querySelector('.viewer-session')?.dataset.viewerPath==='main.ts'`,'閲覧軌跡の一覧からワープ');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-route-point^="f:"]>[data-route-path]')].map(b=>b.dataset.routePath)`),['main.ts','src/login.ts'],'再訪で一覧の順序を動かさない');
  assert.equal(await evaluate(`document.querySelector('[aria-label="前の閲覧ファイル"]').disabled`),false);
  await capture('nn-route-view-list.png');
  await evaluate(`[...document.querySelectorAll('.route-choice')].find(b=>b.textContent==='AiDiy検索軌跡').click()`);
  await capture('nn-route-ai-list.png');
  await evaluate(`document.querySelector('.explorer-toggle').click()`);
  await submit('期限切れの確認');const second=await waitRequest(2);clock+=300001;
  await until(`document.querySelector('.ai-search-panel').textContent.includes('5分以内')`,'5分期限');
  assert.deepEqual(await evaluate('window.aidiyIDE.routeState.paths'),['main.ts','src/login.ts']);
  assert.match(await evaluate(`document.querySelector('.ai-search-panel').textContent`),/エージェントを実行/);
  await capture('nn-ai-search-timeout.png');
  writeFileSync(join(project,outputFor(second)),JSON.stringify(dataFor(second)));
  await evaluate(`[...document.querySelectorAll('.ai-search-panel button')].find(b=>b.title==='AiDiy検索の結果を再確認').click()`);
  await until(`document.querySelector('.ai-search-panel').textContent.includes('2件の関連ファイル')`,'遅れた結果の再確認');
  // 続けて依頼し、古い結果が新しい依頼へ混ざらないことを確認する。
  await submit('古い検索');const third=await waitRequest(3);
  await submit('新しい検索');const fourth=await waitRequest(4);
  writeFileSync(join(project,outputFor(third)),JSON.stringify(dataFor(third)));
  await sleep(2300);
  assert.ok(!(await evaluate(`document.querySelector('.ai-search-panel').textContent`)).includes('2件の関連ファイル'));
  const fourthData=dataFor(fourth);fourthData.files=fourthData.files.slice(1);fourthData.route=fourthData.route.slice(1);
  writeFileSync(join(project,outputFor(fourth)),JSON.stringify(fourthData));
  await until(`document.querySelector('.search-results-content')?.textContent.includes('新しい検索')`,'最後の依頼だけを反映');
  await until(`document.querySelector('.ai-history-header').textContent.includes('履歴 (3)')`,'履歴3件');
  await evaluate(`document.querySelector('.ai-history-header button').click()`);
  await until(`document.querySelectorAll('.ai-history-open').length===3&&!document.querySelector('.ai-history-open').disabled`,'履歴一覧');
  assert.equal(await evaluate(`[...document.querySelectorAll('.ai-history-open span')].some(e=>e.textContent==='認証処理の関連ファイル')`),true,'要求文ではなく生成タイトルで履歴を選べる');
  await capture('nn-ai-search-history.png');
  const historyBefore=await evaluate(`({trail:window.aidiyIDE.trail,cam:{...window.aidiyIDE.cam}})`);
  await evaluate(`[...document.querySelectorAll('.ai-history-open')].find(b=>b.textContent.includes('認証処理の関連ファイル')).click()`);
  await until(`document.querySelector('.search-results-content')?.textContent.includes('認証処理の関連ファイル')`,'過去結果へ切替');
  assert.deepEqual(await evaluate('window.aidiyIDE.routeState.paths'),['main.ts','src/login.ts']);
  assert.deepEqual(await evaluate(`({trail:window.aidiyIDE.trail,cam:{...window.aidiyIDE.cam}})`),historyBefore,'履歴切替だけで移動しない');
  await send('Page.reload');
  for(let i=0;i<100&&!await evaluate(`!!window.aidiyIDE?.world`);i++)await sleep(50);
  await evaluate(`window.aidiyIDE.setAutoSpin(false);document.querySelector('.explorer-toggle').click()`);
  await evaluate(`[...document.querySelectorAll('.explorer-routes button')].find(b=>b.textContent==='AiDiy検索軌跡').click()`);
  await until(`window.aidiyIDE.routeState.paths.length===2`,'選択履歴を復元');
  assert.equal(await evaluate(`document.querySelector('.ai-route-title').textContent`),'認証処理の関連ファイル','再読込でも選択タイトルを復元');
  assert.deepEqual(await evaluate('window.aidiyIDE.routeState.paths'),['main.ts','src/login.ts'],'再読込でも前回のAI結果を保持');
  assert.equal(requests.length,4,'再読込だけでAIへ再依頼しない');
  await evaluate(`document.querySelector('.ai-history-header button').click()`);
  await until(`document.querySelectorAll('.ai-history-open').length===3&&!document.querySelector('.ai-history-open').disabled`,'履歴を再表示');
  await evaluate(`[...document.querySelectorAll('.ai-history-open')].find(b=>b.textContent.includes('新しい検索')).click()`);
  await until(`window.aidiyIDE.routeState.paths.length===1`,'別の履歴へ切替');
  assert.equal(await evaluate(`document.querySelector('[data-path="main.ts"]').classList.contains('fresh')`),false,'以前のマークを解除');
  await evaluate(`document.querySelector('.ai-history-header button').click()`);
  await until(`!document.querySelector('.ai-history-open').disabled`,'履歴再取得');
  await evaluate(`document.querySelector('.ai-history-row.active .ai-history-delete').click()`);
  await evaluate(`[...document.querySelectorAll('.ai-history-confirm button')].find(b=>b.textContent==='取消').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.ai-history-row').length`),3);
  await evaluate(`document.querySelector('.ai-history-row.active .ai-history-delete').click()`);
  await evaluate(`[...document.querySelectorAll('.ai-history-confirm button')].find(b=>b.textContent==='削除する').click()`);
  await until(`window.aidiyIDE.routeState.paths.length===0`,'表示中履歴の削除でマークと軌跡を解除');
  await evaluate(`[...document.querySelectorAll('.ai-history-open')].find(b=>b.textContent.includes('認証処理の関連ファイル')).click()`);
  await until(`window.aidiyIDE.routeState.paths.length===2`,'残った履歴を再表示');
  await send('Emulation.setDeviceMetricsOverride',{width:768,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate('window.orbitTestAdvance(1000)');await capture('nn-ai-search-portrait.png');
  assert.deepEqual(errors,[]);
  console.log('AI SEARCH PASS: 依頼・結果検証・マーク・軌跡切替・順番に閲覧・期限・再確認・古い結果の抑制');
  ws.close();
} finally {
  chrome.kill();
  await app.close();
  await sleep(300);
  if (!resolve(profile).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('一時パスが不正です');
  if (!resolve(project).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('一時プロジェクトが不正です');
  rmSync(project,{recursive:true,force:true});
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome が掴んでいれば残す */ }
}
