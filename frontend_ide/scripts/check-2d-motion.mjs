// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 隔離Chrome・一時プロジェクトで2Dの実CSS描画と3D復帰を確認する。AIへは接続しない。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,utimesSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {startDevelopment} from '../server.mjs';

const chromePath=process.env.CHROME_PATH||[
  [process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'],
  [process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe'],
  [process.env.PROGRAMFILES,'Microsoft/Edge/Application/msedge.exe'],
].filter(([base])=>base).map(([base,name])=>join(base,name)).find(existsSync)
  || ['/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
assert.ok(chromePath,'Chrome / Edge が必要です。CHROME_PATH で指定できます。');
const project=mkdtempSync(join(tmpdir(),'aidiy-2d-motion-'));
const profile=mkdtempSync(join(tmpdir(),'aidiy-2d-motion-browser-'));
for(const folder of ['資料','資料/内部','資料/内部/詳細','別の資料'])mkdirSync(join(project,folder),{recursive:true});
for(const file of ['入口.txt','資料/メモ.txt','資料/内部/詳細/深い資料.txt','別の資料/更新先.txt'])writeFileSync(join(project,file),`2D motion fixture: ${file}`);
const app=await startDevelopment(project);
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check',
  ...(process.platform==='linux'?['--no-sandbox','--disable-dev-shm-usage']:[]),'about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace(/\D/g,'');
const output=resolve('docs/セルフテスト、操作ガイド/images/セルフテスト,aidiy_ide,操作編');
mkdirSync(output,{recursive:true});
const records=resolve('docs/セルフテスト、操作ガイド/evidence/.aidiy_cache/selftest/セルフテスト,aidiy_ide,操作編');
mkdirSync(records,{recursive:true});
const checks=[],shots=[],errors=[];
let ws,send,evaluate;
function save(status,error){writeFileSync(join(records,`${stamp}-ide-2d-motion__result.json`),JSON.stringify({status,date:new Date().toISOString(),os:process.platform,method:'隔離Chromeの実CSS・Canvas描画。CSSの途中時刻を固定して撮影します。最終更新の通知データは試験用に指定し、ページ・ツリー・ビューアは実物を使います。',checks,shots,errors,...(error?{error:String(error.stack||error)}:{})},null,2));}
try{
  let port;
  for(let i=0;i<60&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
  assert.ok(port,'テスト用ブラウザーに接続できません。');
  const target=(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
  let sequence=0;const pending=new Map();
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
  send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++sequence,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id:sequence,method,params}));});
  evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;};
  async function until(expression,label=expression){for(let i=0;i<160;i++){if(await evaluate(expression))return;await sleep(30);}assert.fail('画面待機: '+label);}
  async function capture(title,description){const {data}=await send('Page.captureScreenshot',{format:'png'});const bytes=Buffer.from(data,'base64'),file=`${stamp}-ide-2d-motion__ide-操作_${601+shots.length}_${title}画面.png`;writeFileSync(join(output,file),bytes);shots.push({file,description,sha256:createHash('sha256').update(bytes).digest('hex')});}
  const status=()=>evaluate(`document.querySelector('.space-orbit-status')?.textContent||''`);
  const idle=()=>until(`!document.querySelector('.folder-page-sheet')`,'ページ切替の完了');
  async function finishTurns(){for(let i=0;i<8;i++){if(!await evaluate(`!!document.querySelector('.folder-page-sheet')`))return;await evaluate(`document.querySelectorAll('.folder-page-stack *').forEach(e=>e.getAnimations().forEach(a=>a.finish()))`);await sleep(40);}assert.fail('古いページが残っています。');}
  async function pauseTurn(direction){await until(`!!document.querySelector('.folder-page-sheet.page-turn-${direction}')`);return evaluate(`(()=>{window.motionAnimations=[...document.querySelector('.folder-page-stack').getAnimations({subtree:true})];motionAnimations.forEach(a=>{a.pause();a.currentTime=0;});const sheet=document.querySelector('.folder-page-sheet.page-turn-${direction}');return sheet.getAnimations()[0].effect.getTiming().duration;})()`);}
  async function sampleTurn(progress){return evaluate(`(()=>{motionAnimations.forEach(a=>a.currentTime=Number(a.effect.getTiming().duration)*${progress});const sheet=document.querySelector('[data-page-layer="outgoing"]'),edge=document.querySelector('.folder-page-turn-edge'),live=document.querySelector('[data-page-layer="live"]');return {clip:getComputedStyle(sheet).clipPath,left:edge.getBoundingClientRect().left,top:edge.getBoundingClientRect().top,path:live.dataset.pagePath,liveLists:document.querySelectorAll('.folder-page-body[role="listbox"]').length};})()`);}
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    let clock=0,sequence=0;const frames=new Map(),timers=new Map();let timerId=-1;
    performance.now=()=>clock;
    const timeout=window.setTimeout.bind(window),clear=window.clearTimeout.bind(window),interval=window.setInterval.bind(window),originalFetch=window.fetch;
    window.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};window.cancelAnimationFrame=id=>frames.delete(id);
    window.setTimeout=(fn,ms,...args)=>{if(ms<1000||ms>180000)return timeout(fn,ms,...args);const id=timerId--;timers.set(id,{at:clock+ms,fn:()=>fn(...args)});return id;};
    window.clearTimeout=id=>{timers.delete(id);clear(id);};
    window.setInterval=(fn,ms,...args)=>{if(ms===60000)window.motionPollLatest=()=>fn(...args);return interval(fn,ms,...args);};
    window.motionLatest=[];
    window.fetch=function(url,options){if(String(url).startsWith('/api/latest'))return Promise.resolve(new Response(JSON.stringify({files:motionLatest}),{status:200,headers:{'content-type':'application/json'}}));return originalFetch.apply(this,arguments);};
    window.motionAdvance=ms=>{const end=clock+ms;while(clock<end){clock=Math.min(end,clock+250);const batch=[...frames.values()];frames.clear();for(const fn of batch)fn(clock);for(const [id,t] of [...timers])if(t.at<=clock&&timers.delete(id))t.fn();}return {clock,frames:frames.size};};
    window.motionFrameCount=()=>frames.size;
  `});
  await send('Page.navigate',{url:app.url});
  await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='オフライン利用')`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
  await until(`!!window.aidiyIDE?.world`);await evaluate(`aidiyIDE.setAutoSpin(false);Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click();motionAdvance(250);`);
  await until(`!!document.querySelector('.folder-pages')`);
  const frozen=await evaluate(`({...aidiyIDE.cam})`);assert.equal(await evaluate(`!!document.querySelector('.folder-page-sheet')`),false);await capture('2D初期表示','2Dへ切り替えた初回は、ページめくりを挟まず一覧を表示します。');checks.push({name:'2D初期表示は不要なページめくりなし',status:'✅ OK'});

  await evaluate(`document.querySelector('[data-page-layer="live"] [title="資料"]').click()`);
  const forwardMs=await pauseTurn('forward'),forwardA=await sampleTurn(.25);await capture('進むページ切替25パーセント','子フォルダへ進む途中です。斜線と旧ページの切り抜きを確認します。');
  const forwardB=await sampleTurn(.75);await capture('進むページ切替75パーセント','斜線が右から左へ進み、移動先の一覧が現れます。');
  assert.equal(forwardMs,800);assert.ok(forwardB.left<forwardA.left);assert.notEqual(forwardA.clip,forwardB.clip);assert.equal(forwardB.liveLists,1);await finishTurns();
  await evaluate(`document.querySelector('button[title^="親フォルダ"]').click()`);
  const backMs=await pauseTurn('back'),backA=await sampleTurn(.25);const backB=await sampleTurn(.75);await capture('戻るページ切替','親へ戻る時は、同じ斜線が左から右へ進みます。');
  assert.equal(backMs,800);assert.ok(backB.left>backA.left);await finishTurns();checks.push({name:'進む・戻るページ切替',status:'✅ OK',forwardMs,backMs,forwardA,forwardB,backA,backB});

  await evaluate(`document.querySelector('[data-page-layer="live"] [title="資料"]').click()`);await pauseTurn('forward');
  await evaluate(`document.querySelector('.folder-page-stack').dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true}))`);await idle();
  assert.equal(await evaluate(`document.querySelector('[data-page-layer="live"]').dataset.pagePath`),'資料');await capture('スクロールでページ演出中断','スクロール操作で切替演出だけを終え、現在のフォルダを保ちます。');checks.push({name:'ユーザー操作による演出中断',status:'✅ OK'});

  await evaluate(`aidiyIDE.goTo({type:'dir',path:''})`);await finishTurns();
  await evaluate(`document.querySelector('.explorer-toggle').click();`);await until(`!!document.querySelector('.explorer-panel')`);
  await evaluate(`{const button=document.querySelector('.explorer-root .chevron');if(button.getAttribute('aria-expanded')!=='true')button.click();}`);
  for(const path of ['資料','資料/内部','資料/内部/詳細']){
    await until(`!!document.querySelector('.explorer-panel li[data-path="${path}"]')`);
    await evaluate(`{const row=document.querySelector('.explorer-panel li[data-path="${path}"]');if(row.getAttribute('aria-expanded')!=='true')row.querySelector('button.chevron').click();}`);
  }
  await until(`!!document.querySelector('.explorer-panel li[data-path="資料/内部/詳細/深い資料.txt"]')`);
  await evaluate(`document.querySelector('.explorer-panel li[data-path="資料/内部/詳細/深い資料.txt"]').click()`);const deepMs=await pauseTurn('forward');
  await sampleTurn(.5);await capture('エクスプローラー選択で複数階層移動','エクスプローラーで深いファイルを選ぶと、経由ページを順に表示します。');await finishTurns();
  assert.ok(Math.abs(deepMs*3-800)<.1);assert.equal(await evaluate(`aidiyIDE.trail.join('/')`),'資料/内部/詳細');assert.equal(await evaluate(`aidiyIDE.selected?.path`),'資料/内部/詳細/深い資料.txt');
  await capture('エクスプローラー選択先のファイル表示','切替完了後は、エクスプローラーで選んだファイルとビューアの名前が一致します。');checks.push({name:'エクスプローラーのファイル選択と複数階層の連続切替',status:'✅ OK',perPageMs:deepMs,totalMs:deepMs*3});
  await evaluate(`document.querySelector('[aria-label="エクスプローラーを閉じる"]').click()`);

  await evaluate(`document.querySelector('.folder-page-refresh').click()`);const refreshMs=await pauseTurn('refresh'),refreshA=await sampleTurn(.25);await capture('一覧更新の途中','一覧更新は、上から下へ旧ページを切り替えます。');
  const refreshB=await sampleTurn(.75);assert.equal(refreshMs,650);assert.ok(refreshB.top>refreshA.top);await finishTurns();checks.push({name:'一覧更新の縦方向切替',status:'✅ OK',refreshMs,refreshA,refreshB});

  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await evaluate(`document.querySelector('button[title^="親フォルダ"]').click()`);await until(`aidiyIDE.trail.join('/')==='資料/内部'`);await pauseTurn('back');await sampleTurn(.5);
  assert.equal(await evaluate(`!!document.querySelector('.folder-page-sheet')`),true);
  await capture('OS設定でも規定のページ繰り','OSが動きを減らす設定でも、規定のページ繰りを省略しません。');await finishTurns();checks.push({name:'OS設定によるページ繰り省略なし',status:'✅ OK'});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`aidiyIDE.goTo({type:'dir',path:''})`);await finishTurns();

  await evaluate(`motionAdvance(15000)`);assert.equal(await evaluate('motionFrameCount()'),0);assert.deepEqual(await evaluate(`({...aidiyIDE.cam})`),frozen);
  writeFileSync(join(project,'別の資料/更新先.txt'),'2D latest selection updated');const updated=Date.now()/1000+10;utimesSync(join(project,'別の資料/更新先.txt'),updated,updated);
  await evaluate(`motionLatest=[{path:'別の資料/更新先.txt',name:'更新先.txt',mtime:${updated}}];motionPollLatest();document.querySelector('.explorer-toggle').click()`);
  await until(`!!document.querySelector('[data-latest-path="別の資料/更新先.txt"]')`);await capture('最終更新ファイルの選択前','最終更新欄に出たファイルを選び、別フォルダへのページ切替を確認します。');
  await evaluate(`document.querySelector('[data-latest-path="別の資料/更新先.txt"]').click()`);await pauseTurn('forward');await sampleTurn(.5);await capture('最終更新選択でページ切替','最終更新欄からの選択でも、移動先へ同じページめくりを使います。');await finishTurns();
  assert.equal(await evaluate(`aidiyIDE.selected?.path`),'別の資料/更新先.txt');await until(`document.querySelector('.viewer-popup')?.textContent.includes('更新先.txt')`);await capture('最終更新選択先のファイル表示','移動先の一覧と、選んだ更新ファイルのビューアを表示します。');
  assert.equal(await status(),'');checks.push({name:'最終更新欄のファイル選択とページ切替',status:'✅ OK'});

  const selection=await evaluate(`({path:aidiyIDE.selected.path,trail:[...aidiyIDE.trail]})`);
  await evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='3D').click();motionAdvance(250);`);await until(`!document.querySelector('.folder-pages')`);
  assert.equal(await evaluate('aidiyIDE.selected.path'),selection.path);assert.deepEqual(await evaluate('[...aidiyIDE.trail]'),selection.trail);await capture('3D復帰と選択維持','3Dへ戻っても、同じフォルダと選択ファイルを維持します。');
  await evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click();motionAdvance(250)`);await until(`!!document.querySelector('.folder-pages')`);assert.equal(await evaluate('motionFrameCount()'),0);assert.equal(await evaluate(`!!document.querySelector('.folder-page-sheet')`),false);checks.push({name:'2Dと3Dの切替・選択維持',status:'✅ OK'});
  assert.deepEqual(errors,[]);save('✅ OK');console.log(JSON.stringify({status:'✅ OK',output,checks:checks.map(item=>item.name),screenshots:shots.length}));
}catch(error){save('❌ NG',error);throw error;}
finally{
  ws?.close();chrome.kill();await app.close();await sleep(300);
  for(const folder of [project,profile]){assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep),'一時フォルダだけを削除します。');try{rmSync(folder,{recursive:true,force:true});}catch{/* Chromeが保持中なら残す。 */}}
}
