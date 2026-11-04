// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// 自動軌道の実画面検証。テスト専用の描画時計で1分の停止も待ち時間なく確認する。
// ルートから node frontend_ide/scripts/check-orbit.mjs。オフラインだけを使いAI接続はしない。
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
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    let clock=0,sequence=0;const callbacks=new Map();
    performance.now=()=>clock;
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
    writeFileSync(name, Buffer.from(shot.result.data, 'base64'));
    console.log(name);
  }
  await sleep(1000);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
  for(let i=0;i<100&&!await evaluate(`!!window.aidiyIDE?.world`);i++)await sleep(100);
  assert.equal(await evaluate(`!!window.aidiyIDE?.world`),true);
  assert.equal(await evaluate(`document.querySelector('[role=switch][aria-label="自動探索"]').getAttribute('aria-checked')`),'true');
  const advance = ms => evaluate(`window.orbitTestAdvance(${ms})`);
  const view = () => evaluate(`({...window.aidiyIDE.goal})`);
  await advance(8000);
  const far = await view();
  await capture('nn-orbit-overview.png');
  // 最初の接近で実カメラも星々の分布半径1500の内側へ入るまで進める。
  let entered=false;
  for(let i=0;i<60;i++){
    await advance(2000);
    if(await evaluate(`window.aidiyIDE.cam.dist<1500`)){entered=true;break;}
  }
  assert.equal(entered,true,'全景の外周だけでなく星々の内側へ入り込む');
  const near = await view();
  assert.ok(near.dist < far.dist*.85);
  assert.equal(near.tx,0);assert.equal(near.ty,0);assert.equal(near.tz,0);
  await capture('nn-orbit-near.png');
  await evaluate(`window.aidiyIDE.goTo({type:'file',path:'package.json'})`);
  await sleep(700);await advance(3000);
  const selected = await view();await advance(95000);
  assert.deepEqual(await view(),selected);
  await capture('nn-orbit-selected.png');
  await evaluate(`window.aidiyIDE.clear()`);await advance(8000);
  assert.notDeepEqual(await view(),selected);
  await evaluate(`document.querySelector('canvas.space-canvas').dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:80,cancelable:true}))`);
  const manual = await view();await advance(59999);
  assert.deepEqual(await view(),manual);
  await advance(3000);assert.notDeepEqual(await view(),manual);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:130,y:260,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:230,y:300,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:230,y:300,button:'left',clickCount:1});
  const dragged = await view();await advance(59999);assert.deepEqual(await view(),dragged);
  await advance(3000);assert.notDeepEqual(await view(),dragged);
  const toggle=()=>evaluate(`document.querySelector('[role=switch][aria-label="自動探索"]').click()`);
  const enabled=()=>evaluate(`document.querySelector('[role=switch][aria-label="自動探索"]').getAttribute('aria-checked')`);
  await toggle();assert.equal(await enabled(),'false');
  const stopped=await view();await advance(95000);assert.deepEqual(await view(),stopped);
  await capture('nn-orbit-toggle-off.png');
  await evaluate(`document.querySelector('canvas.space-canvas').dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:80,cancelable:true}))`);
  const adjusted=await view();assert.notDeepEqual(adjusted,stopped);await advance(95000);assert.deepEqual(await view(),adjusted);
  // 明示的なONは手動操作後の待機を解除し、その場から自動移動を再開する。
  await evaluate(`document.querySelector('canvas.space-canvas').dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:10,cancelable:true}))`);
  const beforeResume=await view();await toggle();assert.equal(await enabled(),'true');await advance(3000);assert.notDeepEqual(await view(),beforeResume);
  await capture('nn-orbit-toggle-on.png');
  await evaluate(`window.aidiyIDE.goTo({type:'file',path:'package.json'})`);await sleep(300);await advance(3000);
  await toggle();await evaluate(`window.aidiyIDE.clear()`);await advance(95000);assert.equal(await enabled(),'false');
  const cleared=await view();await advance(5000);assert.deepEqual(await view(),cleared);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',cancelable:true}))`);assert.equal(await enabled(),'true');
  // 同じワールド寸法を使い、実Canvasの描画サイズが奥行きに反比例することを確認する。
  const perspective=await evaluate(`(()=>{
    const ide=window.aidiyIDE,world=ide.world,planet={...world.planets[0],x:0,y:0,z:0},galaxy={...world.galaxies.find(g=>g.stars.length),x:0,y:0,z:0};
    const star={...galaxy.stars[0],x:0,y:0,z:0,born:0,galaxy};galaxy.stars=[star];galaxy.fresh=0;
    ide.clear();ide.setAutoSpin(false);ide.marks({mode:'since',since:null,paths:[]});world.gate=null;world.galaxies=[];world.planets=[planet];world.stars=[];
    const ctx=document.querySelector('.space-canvas').getContext('2d'),draw=ctx.drawImage,line=ctx.lineTo;let sizes=[],links=0;
    ctx.drawImage=function(...args){sizes.push(args[3]);return draw.apply(this,args);};
    ctx.lineTo=function(...args){if(this.strokeStyle==='#7897bf'&&this.globalAlpha>0)links++;return line.apply(this,args);};
    const sample=distance=>{sizes=[];links=0;Object.assign(ide.cam,{tx:0,ty:0,tz:0,yaw:0,pitch:0,dist:distance});Object.assign(ide.goal,ide.cam);window.orbitTestAdvance(250);return [...sizes];};
    try{
      const farPlanet=sample(2400).at(-1),nearPlanet=sample(1200).at(-1),closePlanet=sample(60).at(-1);
      const visibleLinks=links;
      planet.x=10000;sample(1000);const offscreenLinks=links;
      planet.x=0;planet.z=-120;sample(100);const behindLinks=links;
      world.planets=[];world.galaxies=[galaxy];world.stars=[star];
      const far=sample(2400),near=sample(1200),close=sample(60);
      galaxy.z=-120;star.z=-60;const inside=sample(100);
      document.querySelector('.space-canvas').dispatchEvent(new MouseEvent('dblclick',{clientX:innerWidth/2,clientY:innerHeight/2,bubbles:true}));
      const selectedInside=ide.goal.tz===star.z;ide.clear();
      star.z=-110;const behind=sample(100);
      return{planetRatio:nearPlanet/farPlanet,galaxyRatio:near[0]/far[0],starRatio:near.at(-1)/far.at(-1),closePlanet,closeStar:close.at(-1),insideStars:inside.length,behindStars:behind.length,selectedInside,visibleLinks,offscreenLinks,behindLinks};
    }finally{ctx.drawImage=draw;ctx.lineTo=line;}
  })()`);
  for(const name of ['planetRatio','galaxyRatio','starRatio'])assert.ok(Math.abs(perspective[name]-2)<.001,JSON.stringify(perspective));
  assert.ok(perspective.closePlanet>140);assert.ok(perspective.closeStar>48);
  assert.equal(perspective.insideStars,1);assert.equal(perspective.behindStars,0);
  assert.equal(perspective.selectedInside,true,'銀河の中心が背後でも見えている星を選択できる');
  assert.equal(perspective.visibleLinks,1);assert.equal(perspective.offscreenLinks,0);assert.equal(perspective.behindLinks,0);
  console.log('PERSPECTIVE PASS: '+JSON.stringify(perspective));
  assert.deepEqual(errors,[]);
  console.log('ORBIT PASS: 楕円自動探索・手動操作後60秒停止・トグル初期ON/停止/再開・選択解除/Spaceキー連動');
  ws.close();
} finally {
  chrome.kill();
  await app.close();
  await sleep(300);
  if (!resolve(profile).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('一時パスが不正です');
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome が掴んでいれば残す */ }
}
