// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// 自動運転の最終更新追跡と5分プレビューを実画面・仮想時計で検証する。
// ルートから node frontend_ide/scripts/check-autodrive.mjs。オフラインだけを使いAI接続はしない。
import assert from 'node:assert/strict';
import {checkOrbitRoutes} from '../checks/orbit-route-probe.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startDevelopment } from '../server.mjs';

const project = mkdtempSync(join(tmpdir(), 'aidiy_autodrive-'));
mkdirSync(join(project,'nested'));
writeFileSync(join(project,'first.txt'),'First preview');
writeFileSync(join(project,'second.txt'),'Second preview');
writeFileSync(join(project,'nested','next.txt'),'Next preview');
const baseTime = Date.now()/1000;
// 文書を開くだけでできる新しいOfficeロックに、自動探索が飛ばないことも確認する。
for(const path of ['~$報告.docx','nested/~$集計.xlsx']){
  writeFileSync(join(project,path),'Office lock');utimesSync(join(project,path),baseTime+1000,baseTime+1000);
}
utimesSync(join(project,'nested','next.txt'),baseTime-120,baseTime-120);
utimesSync(join(project,'first.txt'),baseTime-60,baseTime-60);
utimesSync(join(project,'second.txt'),baseTime-180,baseTime-180);
const app = await startDevelopment(project);
const url = app.url;
const chromePath = process.env.CHROME_PATH || [
  [process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'],
  [process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'],
  [process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'],
  [process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'],
  [process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'],
].filter(([base]) => base).map(([base, tail]) => join(base, tail)).find(existsSync)
  || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chromePath) { console.error('Chrome / Edge が見つかりません。'); process.exit(1); }

const port = 9333 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'aidiy_ide_shot-'));
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote'] : []),
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
    const interval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>{if(ms===60000)window.pollLatestTest=()=>fn(...args);return interval(fn,ms,...args);};
    let clock=0,sequence=0;const callbacks=new Map();
    performance.now=()=>clock;
    const timers=new Map(),realTimeout=window.setTimeout.bind(window),realClear=window.clearTimeout.bind(window);let timerId=-1;
    window.setTimeout=(fn,ms,...args)=>{if(ms!==300000)return realTimeout(fn,ms,...args);const id=timerId--;timers.set(id,{at:clock+ms,fn:()=>fn(...args)});return id;};
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
  const shots=resolve('temp/autodrive-check');mkdirSync(shots,{recursive:true});
  const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date()).replace(/[^0-9]/g,'');let shotNumber=0;
  async function capture(name) {
    name=join(shots,`${stamp}_${String(++shotNumber).padStart(2,'0')}_${name.replace(/^nn-/, '')}`);
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
  async function until(expression,message) {
    for(const deadline=Date.now()+30000;Date.now()<deadline;){
      if(await evaluate(expression))return;
      await advance(250);await sleep(20);
    }
    assert.fail(message+' '+JSON.stringify(await evaluate(`({trail:window.aidiyIDE.trail,warping:document.querySelector('.space-canvas').classList.contains('warping'),preview:document.querySelector('.viewer-popup')?.textContent?.slice(0,100)})`)));
  }
  const preview=()=>evaluate(`document.querySelector('.viewer-popup')?.textContent||''`);
  const explorationStatus=()=>evaluate(`document.querySelector('.space-orbit-status')?.textContent||''`);
  await evaluate(`window.autoAnimations=0;const canvas=document.querySelector('.space-canvas'),animate=canvas.animate;canvas.animate=function(...args){window.autoAnimations++;return animate.apply(this,args)};`);
  await evaluate(`window.orbitStrokes=0;window.orbitAlphas=[];{const context=document.querySelector('.space-canvas').getContext('2d'),stroke=context.stroke;context.stroke=function(...args){if(this.strokeStyle==='#8aa9ed'){window.orbitStrokes++;if(this.lineWidth<2)window.orbitAlphas.push(this.globalAlpha);}return stroke.apply(this,args)};}`);
  await evaluate(`{const context=document.querySelector('.space-canvas').getContext('2d');let points=[];
    for(const name of ['beginPath','moveTo','lineTo','stroke']){const original=context[name];context[name]=function(...args){
      if(name==='beginPath')points=[];
      if(name==='moveTo'||name==='lineTo')points.push(args);
      if(name==='stroke'&&this.strokeStyle==='#8aa9ed')window.orbitScreenPoints=points;
      return original.apply(this,args);
    };}}`);
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('first.txt')`,'起動時の最終更新へ移動');
  assert.equal(await evaluate('window.autoAnimations'),0,'同階層の自動追跡にはワープ演出を使わない');
  await capture('nn-autodrive-preview.png');
  if(process.env.AIDIY_STATUS_STYLE_ONLY==='1'){
    await advance(3000);await evaluate('aidiyIDE.clear();aidiyIDE.interact()');await advance(250);
    const textStyle=()=>evaluate(`(()=>{const e=document.querySelector('.space-orbit-status'),s=getComputedStyle(e),g=document.querySelector('.space-flight-controls');return {background:s.backgroundColor,border:s.borderTopWidth,shadow:s.boxShadow,pointer:s.pointerEvents,z:Number(getComputedStyle(g).zIndex)};})()`);
    const plain=style=>{assert.equal(style.background,'rgba(0, 0, 0, 0)');assert.equal(style.border,'0px');assert.equal(style.shadow,'none');assert.equal(style.pointer,'none');};
    const threeD=await textStyle();plain(threeD);await capture('nn-status-transparent-3d.png');
    await evaluate(`void aidiyIDE.goTo({type:'file',path:'first.txt'})`);
    await until(`!!document.querySelector('.viewer-popup')&&!document.querySelector('.space-canvas').classList.contains('warping')`,'ビューアを表示');
    await advance(1000);
    // 重なり検証ではパネル位置だけを動かし、本番の重なり順・背景・入力設定を使う。
    await evaluate(`document.querySelector('.viewer-popup').style.bottom='16px'`);
    const covered=kind=>evaluate(`(()=>{const g=document.querySelector('.space-flight-controls'),b=g.querySelector('[aria-label="自動探索"]'),p=document.querySelector('${kind}'),r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {controlZ:Number(getComputedStyle(g).zIndex),panelZ:Number(getComputedStyle(p).zIndex),covered:p.contains(document.elementFromPoint(x,y))};})()`);
    const viewer=await covered('.viewer-popup');assert.ok(viewer.controlZ<viewer.panelZ);assert.equal(viewer.covered,true);await capture('nn-status-behind-viewer.png');
    await evaluate(`document.querySelector('.explorer-toggle').click()`);
    await evaluate(`Object.assign(document.querySelector('.explorer-panel').style,{left:'auto',right:'16px',top:'auto',bottom:'16px',height:'180px',width:'260px'})`);
    const explorer=await covered('.explorer-panel');assert.ok(explorer.controlZ<explorer.panelZ);assert.equal(explorer.covered,true);await capture('nn-status-behind-explorer.png');
    await evaluate(`document.querySelector('[aria-label="エクスプローラーを閉じる"]').click();aidiyIDE.clear();Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click()`);
    const twoD=await textStyle();plain(twoD);await capture('nn-status-transparent-2d.png');
    assert.deepEqual(errors,[]);writeFileSync(join(shots,`${stamp}_status-style-result.json`),JSON.stringify({status:'✅ OK',threeD,twoD,viewer,explorer,method:'隔離Chrome。重なりの確認時だけパネル位置を調整し、本番CSSの重なり順で検証。',errors},null,2));
    console.log('STATUS STYLE PASS: transparent text, no border/shadow, controls behind viewer/explorer, 2D/3D, errors=[]');
  }else if(process.env.AIDIY_SELECTED_ORBIT_ONLY==='1'){
    await advance(3000);
    assert.equal(await explorationStatus(),'観測中');
    await evaluate(`window.selectedOrbitOffset=()=>{const v=aidiyIDE.cam,s=aidiyIDE.selected;return [v.tx-Math.sin(v.yaw)*Math.cos(v.pitch)*v.dist-s.x,v.ty-Math.sin(v.pitch)*v.dist-s.y,v.tz-Math.cos(v.yaw)*Math.cos(v.pitch)*v.dist-s.z]};`);
    const start=await evaluate('selectedOrbitOffset()');
    const near=(actual,expected,label)=>assert.ok(Math.hypot(...actual.map((v,i)=>v-expected[i]))<1e-5,label);
    await capture('nn-selected-orbit-start.png');
    await advance(45000);await capture('nn-selected-orbit-quarter.png');
    await advance(45000);near(await evaluate('selectedOrbitOffset()'),start.map(v=>-v),'90秒で反対側');
    await capture('nn-selected-orbit-half.png');
    await advance(90000);near(await evaluate('selectedOrbitOffset()'),start,'180秒でちょうど1周');
    await capture('nn-selected-orbit-full.png');
    assert.equal(await evaluate('aidiyIDE.selected.path'),'first.txt');
    assert.ok((await preview()).includes('first.txt'),'周回中もビューアの選択を維持');
    await evaluate('aidiyIDE.setAutoSpin(false)');const held=await view();
    await advance(5000);const stopped=await view();
    for(const key of Object.keys(held))assert.ok(Math.abs(stopped[key]-held[key])<1e-9,'OFF中は停止: '+key);
    assert.equal(await explorationStatus(),'','OFFでは状態表示を外す');
    await capture('nn-selected-orbit-off.png');
    assert.deepEqual(errors,[]);console.log('SELECTED ORBIT PASS: 180 seconds / 1 revolution, preview retained, OFF stops, errors=[]');
  }else if(process.env.AIDIY_IDLE_ORBIT_ONLY==='1'){
    await advance(3000);
    await evaluate(`window.idlePivot={...aidiyIDE.selected};window.idleEye=()=>{const v=aidiyIDE.cam,p=idlePivot;return [v.tx-Math.sin(v.yaw)*Math.cos(v.pitch)*v.dist-p.x,v.ty-Math.sin(v.pitch)*v.dist-p.y,v.tz-Math.cos(v.yaw)*Math.cos(v.pitch)*v.dist-p.z]};aidiyIDE.clear();aidiyIDE.interact();`);
    const start=await evaluate('idleEye()'),radius=Math.hypot(...start);
    // 閲覧後は中心を斜めに見ているため、回転軸に沿う成分は半周後も反転しない。
    const axis=await evaluate(`(()=>{const v=aidiyIDE.cam,cy=Math.cos(v.yaw),sy=Math.sin(v.yaw),cp=Math.cos(v.pitch),sp=Math.sin(v.pitch),cr=Math.cos(v.roll||0),sr=Math.sin(v.roll||0);return [-cy*sr-sy*sp*cr,cp*cr,sy*sr-cy*sp*cr]})()`);
    const axial=start.reduce((sum,v,i)=>sum+v*axis[i],0),half=start.map((v,i)=>2*axial*axis[i]-v);
    const near=(actual,expected,label)=>assert.ok(Math.hypot(...actual.map((v,i)=>v-expected[i]))<1e-5,label);
    const samples=[];
    assert.equal(await explorationStatus(),'周回軌道航行中');
    await capture('nn-idle-orbit-start.png');
    for(let n=1;n<=4;n++){
      await advance(45000);
      const eye=await evaluate('idleEye()');samples.push({seconds:n*45,eye});
      assert.equal(await evaluate('aidiyIDE.orbitPhase'),'idle','手動待機中は航行しない');
      assert.equal(await explorationStatus(),'周回軌道航行中');
      assert.equal(await evaluate('aidiyIDE.selected'),null,'ファイル未選択のまま回転');
      assert.ok(Math.abs(Math.hypot(...eye)-radius)<1e-5,'閲覧終了後も同じ中心星との距離を維持');
      if(n===2)near(eye,half,'90秒で回転軸の反対側');
      await capture(`nn-idle-orbit-${n*45}s.png`);
      await evaluate('aidiyIDE.interact()');
    }
    near(samples.at(-1).eye,start,'180秒でちょうど1周');
    await advance(59750);assert.equal(await evaluate('aidiyIDE.orbitPhase'),'idle');
    const before=await evaluate('idleEye()');await advance(250);
    assert.equal(await evaluate('aidiyIDE.orbitPhase'),'centering');
    assert.equal(await explorationStatus(),'軌道計算と姿勢制御中');
    await capture('nn-idle-orbit-preparing.png');
    near(await evaluate('idleEye()'),before,'航行再開時に船体位置が飛ばない');
    await until(`aidiyIDE.orbitPhase==='flying'`,'低速回転から通常航行へ復帰');
    assert.equal(await explorationStatus(),'探索軌道航行中');
    await capture('nn-idle-orbit-resumed.png');
    assert.deepEqual(errors,[]);
    writeFileSync(join(shots,`${stamp}_idle-orbit-result.json`),JSON.stringify({status:'✅ OK',clock:'仮想時計・実ブラウザー描画',start,radius,samples,resumedPhase:await evaluate('aidiyIDE.orbitPhase'),errors},null,2));
    console.log('IDLE ORBIT PASS: 180 seconds / 1 revolution, manual pause rotates, 60s resumes flight, errors=[]');
  }else if(process.env.AIDIY_ORBIT_ROUTES_ONLY==='1'){
    await evaluate(`window.eyeOf=v=>({x:v.tx-Math.sin(v.yaw)*Math.cos(v.pitch)*v.dist,y:v.ty-Math.sin(v.pitch)*v.dist,z:v.tz-Math.cos(v.yaw)*Math.cos(v.pitch)*v.dist});aidiyIDE.clear();aidiyIDE.setAutoSpin(true);`);
    await until(`aidiyIDE.orbitPhase==='flying'`,'巡回開始');
    const targets=await checkOrbitRoutes({evaluate,advance,capture});
    assert.deepEqual(errors,[]);console.log('ORBIT ROUTES PASS: '+JSON.stringify({targets,errors}));
  }else{
  await advance(500);assert.equal(await evaluate(`document.querySelector('[aria-label="自動探索"]').classList.contains('driving')`),true);
  await evaluate(`window.aidiyIDE.requestFollow('first.txt')`);await advance(250);await sleep(50);await advance(250);
  assert.equal(await evaluate(`document.querySelector('.space-canvas').classList.contains('warping')`),false,'同じ最終更新の通知で再ジャンプしない');
  // 自動追跡のファイル接近でも横移動せず、その場で旋回する。
  utimesSync(join(project,'second.txt'),baseTime+0.5,baseTime+0.5);
  await evaluate(`window.eyeOf=v=>({x:v.tx-Math.sin(v.yaw)*Math.cos(v.pitch)*v.dist,y:v.ty-Math.sin(v.pitch)*v.dist,z:v.tz-Math.cos(v.yaw)*Math.cos(v.pitch)*v.dist});window.beforeFollow={eye:window.eyeOf(window.aidiyIDE.cam),center:{...window.aidiyIDE.projection}};window.aidiyIDE.requestFollow('second.txt')`);
  await until(`document.querySelector('.space-canvas').classList.contains('warping')`,'自動ファイル接近でワープを開始');
  // 走査待ちの間も含めて、旧プレビューを閉じる時の投影中心を固定する。
  await advance(450);
  const turn=await evaluate(`({before:window.beforeFollow,eye:window.eyeOf(window.aidiyIDE.cam),center:{...window.aidiyIDE.projection}})`);
  for(const key of ['x','y','z'])assert.ok(Math.abs(turn.before.eye[key]-turn.eye[key])<1e-7,'自動接近の旋回中に船体が横滑りしない');
  assert.deepEqual(turn.center,turn.before.center,'旧プレビューを閉じても画面中心が滑らない');
  await capture('nn-autodrive-turn.png');
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('second.txt')&&!document.querySelector('.space-canvas').classList.contains('warping')`,'旋回後に自動プレビューを表示');
  assert.equal(await evaluate('window.autoAnimations'),0,'同階層の再追跡も旋回と接近のみ');
  // 操作から5分を数え直す。
  await advance(100000);
  let remaining=await evaluate('window.previewRemaining()[0]');
  await evaluate(`document.querySelector('.viewer-popup').dispatchEvent(new Event('pointerdown',{bubbles:true}))`);
  assert.equal(await evaluate('window.previewRemaining()[0]'),300000);
  await advance(100000);
  await evaluate(`document.querySelector('.viewer-popup').dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true}))`);
  assert.equal(await evaluate('window.previewRemaining()[0]'),300000);
  remaining=await evaluate('window.previewRemaining()[0]');
  await advance(remaining-1);await evaluate('window.runPreviewTimers()');assert.ok((await preview()).includes('second.txt'));
  await advance(1);await evaluate('window.runPreviewTimers()');assert.equal(await preview(),'');
  const closed=await view();await advance(10000);assert.notDeepEqual(await view(),closed);
  await advance(300000);assert.equal(await preview(),'','変更がなければ同じプレビューを繰り返さない');
  assert.equal(await evaluate(`window.aidiyIDE.orbitPath?.length`),385,'計算済みの軌道線を公開');
  assert.ok(await evaluate('window.orbitStrokes>0'),'実際のCanvasに軌道線を描く');
  // 外周から中心を眺める時に、傾けた円盤のカーブを確認する。
  for(let i=0;i<400&&!await evaluate(`Math.hypot(...Object.values(window.eyeOf(window.aidiyIDE.cam)))>window.aidiyIDE.world.radius*2.2`);i++)await advance(1000);
  const curvature=await evaluate(`(()=>{
    const points=window.orbitScreenPoints.filter(([x,y])=>x>=0&&x<=1280&&y>=0&&y<=800);
    const n=points.length,mx=points.reduce((s,p)=>s+p[0],0)/n,my=points.reduce((s,p)=>s+p[1],0)/n;
    const xx=points.reduce((s,p)=>s+(p[0]-mx)**2,0)/n,yy=points.reduce((s,p)=>s+(p[1]-my)**2,0)/n;
    const xy=points.reduce((s,p)=>s+(p[0]-mx)*(p[1]-my),0)/n;
    return {count:n,spread:Math.sqrt(Math.max(0,(xx+yy-Math.hypot(xx-yy,2*xy))/2))};
  })()`);
  assert.ok(curvature.count>10 && curvature.spread>4,'船の下へ表示した軌道が一本線に潰れず曲がる: '+JSON.stringify(curvature));
  await capture('nn-autodrive-space.png');
  await checkOrbitRoutes({evaluate,advance,capture});
  // 遠点で旧軌道を消してから機体を回し、新しい軌道を表示する。
  await evaluate(`(()=>{for(let i=0;i<6000&&window.aidiyIDE.orbitPhase!=='hiding';i++)window.orbitTestAdvance(250);})()`);
  assert.equal(await evaluate('window.aidiyIDE.orbitPhase'),'hiding');
  assert.equal(await explorationStatus(),'軌道計算と姿勢制御中','旧軌道の消去も準備状態として表示');
  await advance(500);await capture('nn-orbit-hide.png');
  await until(`window.aidiyIDE.orbitPhase==='aligning'`,'暗転後に次の軌道へ機体回転');
  const alignEye=await evaluate('window.eyeOf(window.aidiyIDE.cam)');
  const hiddenStrokes=await evaluate('window.orbitStrokes');await advance(750);
  assert.equal(await evaluate('window.orbitStrokes'),hiddenStrokes,'機体回転中は軌道線を表示しない');
  const turningEye=await evaluate('window.eyeOf(window.aidiyIDE.cam)');
  for(const key of ['x','y','z'])assert.ok(Math.abs(alignEye[key]-turningEye[key])<1e-6);
  await capture('nn-orbit-align.png');
  assert.equal(await explorationStatus(),'軌道計算と姿勢制御中','軌道を消した後の姿勢調整も準備状態として表示');
  await until(`window.aidiyIDE.orbitPhase==='flying'`,'新しい軌道の表示後に航行再開');
  assert.equal(await explorationStatus(),'探索軌道航行中','航行再開時は航行状態へ切替');
  await capture('nn-orbit-next.png');
  // 自動運転を入り直しても、到着済みの最終更新へは戻らない。
  await evaluate(`window.aidiyIDE.setAutoSpin(false)`);
  assert.equal(await evaluate(`window.aidiyIDE.orbitPath`),null,'OFFでは軌道線を消す');
  await evaluate('window.orbitAlphas=[]');await advance(1500);
  const fading=await evaluate('window.orbitAlphas');
  assert.ok(fading.length>=3 && fading[0]<.6 && fading.at(-1)<.1,'OFF後も線を残し、柔らかく消す: '+JSON.stringify(fading));
  assert.ok(fading.every((alpha,i)=>!i || alpha<fading[i-1]),'消える途中で濃さが増えない');
  const strokes=await evaluate('window.orbitStrokes');await advance(1000);assert.equal(await evaluate('window.orbitStrokes'),strokes);
  await evaluate(`window.aidiyIDE.setAutoSpin(true)`);
  await until(`window.aidiyIDE.orbitPhase==='revealing'`,'中心へ向き、水平を合わせてから軌道表示');
  await evaluate('window.orbitAlphas=[]');await advance(1500);
  const appearing=await evaluate('window.orbitAlphas');
  assert.ok(appearing[0]<.1 && Math.abs(appearing.at(-1)-.6)<1e-6,'再開時は薄い線から浮かび上がる');
  assert.ok(appearing.every((alpha,i)=>!i || alpha>=appearing[i-1]),'現れる途中で濃さが減らない');
  await advance(95000);assert.equal(await preview(),'','ONへ戻しても同じ最終更新は繰り返さない');
  // プレビュー中も別の最終更新へ移り、その表示から5分を数え直す。
  utimesSync(join(project,'nested','next.txt'),baseTime+1,baseTime+1);
  await evaluate('window.aidiyIDE.refresh()');
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('next.txt')`,'表示中の最終更新変更に追従');
  assert.ok(await evaluate('window.previewRemaining()[0]>299000'));
  // 直前の走査から10秒未満で新規作成されたファイルも表示する。
  writeFileSync(join(project,'new.txt'),'New file');utimesSync(join(project,'new.txt'),baseTime+2,baseTime+2);
  await evaluate(`window.aidiyIDE.requestFollow('new.txt')`);
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('new.txt')`,'新規ファイルを再走査して開く');
  // 移動の途中でさらに新しい対象へ変わったら、古い対象のプレビューを開かない。
  await evaluate(`window.openedPreviews=[];new MutationObserver(()=>{const text=document.querySelector('.viewer-popup')?.textContent;if(text)window.openedPreviews.push(text);}).observe(document.querySelector('.space-view'),{childList:true,subtree:true});window.aidiyIDE.requestFollow('nested/next.txt')`);
  await advance(250);await sleep(50);
  await evaluate(`window.aidiyIDE.requestFollow('first.txt')`);
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('first.txt')`,'移動途中の新しい予約を優先');
  assert.equal(await evaluate(`window.openedPreviews.some(text=>text.includes('next.txt'))`),false);
  // 手動で別星系へ行ったら、そこで待機後の彗星軌道を再開する。
  await evaluate(`void window.aidiyIDE.goTo({type:'dir',path:'nested'})`);
  await until(`window.aidiyIDE.trail.join('/')==='nested'&&!document.querySelector('.space-canvas').classList.contains('warping')`,'手動で別星系へ移動');
  await advance(1000);await sleep(50);
  await evaluate(`document.querySelector('canvas.space-canvas').dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:80,cancelable:true}))`);
  await advance(59999);assert.equal(await preview(),'');
  await advance(30000);await sleep(50);await advance(1000);
  assert.equal(await preview(),'','手動移動後も到着済みファイルへ引き戻さない');
  assert.deepEqual(await evaluate('window.aidiyIDE.trail'),['nested']);
  const localOrbit=await view();await advance(10000);assert.notDeepEqual(await view(),localOrbit,'移動先で彗星軌道を続ける');
  await evaluate(`void window.aidiyIDE.goTo({type:'dir',path:''})`);
  await until(`window.aidiyIDE.trail.length===0&&!document.querySelector('.space-canvas').classList.contains('warping')`,'ルートへ移動');
  await advance(95000);await sleep(50);await advance(1000);
  assert.equal(await preview(),'');assert.deepEqual(await evaluate('window.aidiyIDE.trail'),[],'ルートでもそのまま自動運転');
  await capture('nn-autodrive-manual-root.png');
  // 手動待機中の新しい対象は、待機が終わったら追いかける。
  utimesSync(join(project,'nested','next.txt'),baseTime+3,baseTime+3);
  await evaluate(`document.querySelector('canvas.space-canvas').dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:80,cancelable:true}));window.aidiyIDE.requestFollow('nested/next.txt')`);
  await advance(59999);assert.equal(await preview(),'');
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('next.txt')`,'手動待機後も新しい最終更新へは移動');
  // OFF中の更新を保留し、ONへ戻った際に追いかける。
  await evaluate(`window.aidiyIDE.clear();window.aidiyIDE.setAutoSpin(false);window.aidiyIDE.requestFollow('new.txt')`);
  await advance(95000);assert.equal(await preview(),'');
  await evaluate(`window.aidiyIDE.setAutoSpin(true)`);
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('new.txt')`,'OFF中の予約に追従');
  // 同じhh:mm:ssの境界を含めて取得し、前回最後のファイルを除いた3件を表示する。
  const batchTime=Math.floor(baseTime)+10;
  writeFileSync(join(project,'boundary.py'),'# Previous last');utimesSync(join(project,'boundary.py'),batchTime+.45,batchTime+.45);
  await evaluate('window.pollLatestTest()');
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('boundary.py')&&!document.querySelector('.space-canvas').classList.contains('warping')`,'比較の起点ファイルへ到着');
  await evaluate(`window.aidiyIDE.setAutoSpin(false);document.querySelector('.explorer-toggle')?.click();window.openedPreviews=[];`);
  const updated=[['updates/first.py',.45],['other/second.py',.6],['updates/last.py',.8]];
  for(const [path,offset] of updated){mkdirSync(join(project,path.split('/')[0]),{recursive:true});writeFileSync(join(project,path),'# '+path);utimesSync(join(project,path),batchTime+offset,batchTime+offset);}
  await evaluate('window.pollLatestTest()');
  const recent=()=>evaluate(`Array.from(document.querySelectorAll('[data-latest-path]')).map(button=>button.dataset.latestPath)`);
  assert.deepEqual(await recent(),updated.map(([path])=>path),'前回最後のファイルは同じ秒でも再表示しない');
  const beforeBatch=await view();
  await evaluate('window.pollLatestTest()');
  assert.deepEqual(await recent(),updated.map(([path])=>path),'更新なしなら3件を維持');
  assert.deepEqual(await view(),beforeBatch,'OFF中に勝手に移動しない');
  await evaluate('window.aidiyIDE.setAutoSpin(true)');
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('last.py')&&!document.querySelector('.space-canvas').classList.contains('warping')`,'3件の最後だけへ移動');
  assert.equal(await evaluate(`window.openedPreviews.some(text=>text.includes('first.py')||text.includes('second.py'))`),false,'先の2件は表示しない');
  const saved=await evaluate(`JSON.parse(localStorage.getItem('aidiy_ide:'+${JSON.stringify(project)}))`);
  assert.deepEqual(saved.journal.filter(entry=>updated.some(([path])=>path===entry.path)).map(entry=>entry.path),[...updated].reverse().map(([path])=>path));
  assert.deepEqual(saved.voyages.updates.filter(key=>key.startsWith('f:')),['f:updates/first.py','f:updates/last.py']);
  assert.ok(saved.voyages.other.includes('f:other/second.py'),'移動しなかった別フォルダの経路も保存');
  await capture('nn-updates-three-landscape.png');
  await send('Emulation.setDeviceMetricsOverride',{width:768,height:1000,deviceScaleFactor:1,mobile:false});await advance(1000);await sleep(350);
  await capture('nn-updates-three-portrait.png');
  // 3行を超えた場合もツリーを押し出さず、小さいスクロールで全件を辿る。
  await evaluate('window.aidiyIDE.setAutoSpin(false)');
  for(let i=0;i<6;i++){const path=join(project,`updates/extra${i}.py`);writeFileSync(path,'# Extra');utimesSync(path,batchTime+.9+i*.001,batchTime+.9+i*.001);}
  await evaluate('window.pollLatestTest()');
  assert.equal((await recent()).length,6);
  assert.equal(await evaluate(`(()=>{const list=document.querySelector('.explorer-latest-list');return list.clientHeight<=78&&list.scrollHeight>list.clientHeight;})()`),true,'更新一覧だけを小さくスクロール');
  await evaluate(`document.querySelector('.explorer-latest-list').scrollTop=1000`);
  assert.ok(await evaluate(`document.querySelector('.explorer-latest-list').scrollTop>0`));
  await capture('nn-updates-scroll.png');
  assert.deepEqual(errors,[]);
  console.log('AUTODRIVE PASS: 起動時ジャンプ、到着済み重複抑制、手動移動先・ルートで彗星軌道再開、5分消去、新しい更新追従、移動中の予約変更、新規ファイル、OFF中保留、秒境界の重複除外、複数更新の保持・経路保存・最後だけ移動・小さいスクロール');
  }
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
