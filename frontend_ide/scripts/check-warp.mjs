// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// ワープの旋回と直進を実画面・仮想時計で検証する。
// ルートから node frontend_ide/scripts/check-warp.mjs。オフラインだけを使いAI接続はしない。
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
utimesSync(join(project,'nested','next.txt'),baseTime-120,baseTime-120);
utimesSync(join(project,'first.txt'),baseTime-60,baseTime-60);
mkdirSync(join(project,'nested','deep'));
mkdirSync(join(project,'other'));
for(const name of ['nested/deep/inside.txt','other/remote.txt']){
  writeFileSync(join(project,name),'Explorer warp preview');utimesSync(join(project,name),baseTime-180,baseTime-180);
}
const app = await startDevelopment(project);
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
    const directory=resolve('temp/space-layout-check');mkdirSync(directory,{recursive:true});
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
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('first.txt')`,'起動時の最終更新へ移動');
  await evaluate(`window.aidiyIDE.setAutoSpin(false);window.aidiyIDE.clear()`);
  await advance(5000);
  await evaluate(`window.eyeOf=view=>({x:view.tx-Math.sin(view.yaw)*Math.cos(view.pitch)*view.dist,y:view.ty-Math.sin(view.pitch)*view.dist,z:view.tz-Math.cos(view.yaw)*Math.cos(view.pitch)*view.dist});window.beforeWarp={...window.aidiyIDE.cam};window.warpTarget=window.aidiyIDE.world.galaxies[0];void window.aidiyIDE.dive(window.warpTarget)`);
  await advance(550);
  const turning=await evaluate(`({before:window.eyeOf(window.beforeWarp),now:window.eyeOf(window.aidiyIDE.cam),yaw:window.aidiyIDE.cam.yaw,oldYaw:window.beforeWarp.yaw})`);
  for(const key of ['x','y','z'])assert.ok(Math.abs(turning.before[key]-turning.now[key])<1e-7,'旋回中に船体が横滑りしない');
  assert.notEqual(turning.yaw,turning.oldYaw);
  await capture('nn-warp-turn.png');
  await advance(550);await sleep(40);await advance(250);
  const zoom=await evaluate(`(()=>{const v=window.aidiyIDE.cam,t=window.warpTarget,p=window.eyeOf(v),dx=t.x-p.x,dy=t.y-p.y,dz=t.z-p.z;return {lateral:dx*Math.cos(v.yaw)-dz*Math.sin(v.yaw),vertical:dy*Math.cos(v.pitch)-(dx*Math.sin(v.yaw)+dz*Math.cos(v.yaw))*Math.sin(v.pitch),distance:Math.hypot(dx,dy,dz),before:Math.hypot(t.x-window.eyeOf(window.beforeWarp).x,t.y-window.eyeOf(window.beforeWarp).y,t.z-window.eyeOf(window.beforeWarp).z)};})()`);
  assert.ok(Math.abs(zoom.lateral)<1e-7&&Math.abs(zoom.vertical)<1e-7,'目的地を正面に固定して前進');
  assert.ok(zoom.distance<zoom.before,'旋回してから距離を縮める');
  await capture('nn-warp-zoom.png');
  await advance(1800);await sleep(80);await advance(16);
  await capture('nn-warp-streaks.png');
  await until(`window.aidiyIDE.trail.join('/')==='nested'&&!document.querySelector('.space-canvas').classList.contains('warping')`,'ワープ後の階層へ到着');
  await capture('nn-warp-arrived.png');
  // 帰還もゲートへ向いてから前進する。
  await evaluate(`window.beforeWarp={...window.aidiyIDE.cam};void window.aidiyIDE.ascend(0)`);
  await advance(550);
  const returning=await evaluate(`({before:window.eyeOf(window.beforeWarp),now:window.eyeOf(window.aidiyIDE.cam)})`);
  for(const key of ['x','y','z'])assert.ok(Math.abs(returning.before[key]-returning.now[key])<1e-7);
  await until(`window.aidiyIDE.trail.length===0&&!document.querySelector('.space-canvas').classList.contains('warping')`,'ゲートから親階層へ帰還');
  // 同階層の一覧選択も、船体位置・投影中心を固定して向きを変えてから直進する。
  await evaluate(`document.querySelector('.explorer-toggle').click();window.explorerOrigin={...window.aidiyIDE.goal};window.beforeWarp={...window.aidiyIDE.cam};window.beforeProjection={...window.aidiyIDE.projection};window.warpTarget=window.aidiyIDE.world.byPath.get('first.txt');window.sameFolderAnimations=0;window.originalCanvasAnimate=document.querySelector('.space-canvas').animate;document.querySelector('.space-canvas').animate=function(...args){window.sameFolderAnimations++;return window.originalCanvasAnimate.apply(this,args)}`);
  await evaluate(`document.querySelector('[data-path="first.txt"]').click()`);
  await advance(550);
  const sameLevel=await evaluate(`({before:window.eyeOf(window.beforeWarp),now:window.eyeOf(window.aidiyIDE.cam),center:window.aidiyIDE.projection,oldCenter:window.beforeProjection})`);
  for(const key of ['x','y','z'])assert.ok(Math.abs(sameLevel.before[key]-sameLevel.now[key])<1e-7,'同階層でも船体位置を固定して旋回');
  assert.deepEqual(sameLevel.center,sameLevel.oldCenter,'同階層でも投影中心は横滑りしない');
  await capture('same-folder-turn.png');
  await advance(550);await sleep(40);await advance(250);
  const approach=await evaluate(`(()=>{const v=window.aidiyIDE.cam,t=window.warpTarget,p=window.eyeOf(v),dx=t.x-p.x,dy=t.y-p.y,dz=t.z-p.z;return {lateral:dx*Math.cos(v.yaw)-dz*Math.sin(v.yaw),vertical:dy*Math.cos(v.pitch)-(dx*Math.sin(v.yaw)+dz*Math.cos(v.yaw))*Math.sin(v.pitch),distance:Math.hypot(dx,dy,dz),before:Math.hypot(t.x-window.eyeOf(window.beforeWarp).x,t.y-window.eyeOf(window.beforeWarp).y,t.z-window.eyeOf(window.beforeWarp).z)};})()`);
  assert.ok(Math.abs(approach.lateral)<1e-7&&Math.abs(approach.vertical)<1e-7&&approach.distance<approach.before,'同階層の目的ファイルを正面に保って直進');
  await until(`document.querySelector('.viewer-path')?.textContent==='first.txt'&&!document.querySelector('.space-canvas').classList.contains('warping')`,'同階層のファイルへ接近して開く');
  assert.equal(await evaluate('window.sameFolderAnimations'),0,'同階層では拡縮・暗転・再出現のアニメーションを一切開始しない');
  await evaluate(`document.querySelector('.space-canvas').animate=window.originalCanvasAnimate`);
  const sameFolderArrival=await evaluate(`({...window.aidiyIDE.cam})`);await advance(1500);
  assert.deepEqual(await evaluate(`({...window.aidiyIDE.cam})`),sameFolderArrival,'パネルの中央調整中も船体位置と向きを維持');
  await sleep(200);await advance(250);await capture('nn-warp-explorer-file.png');
  const closedAt=await evaluate('({...window.aidiyIDE.cam})');
  await evaluate(`void window.aidiyIDE.clear()`);await advance(2000);
  assert.deepEqual(await evaluate('({...window.aidiyIDE.cam})'),closedAt,'ビューアを閉じても船体位置と向きは変えない');
  // ドラッグだけは中心の星を軸に回る。次の航行は回り込んだ実位置から始まる。
  for(const button of ['left','right']) {
    const before=await evaluate('window.eyeOf(window.aidiyIDE.cam)'),pivot=await evaluate(`window.aidiyIDE.world.byPath.get('first.txt')`);
    const radius=position=>Math.hypot(...['x','y','z'].map(key=>position[key]-pivot[key]));
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:900,y:300,button,clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1000,y:340,button,buttons:button==='left'?1:2});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:1000,y:340,button,clickCount:1});
    for(let step=0;step<8;step++){
      await advance(250);const now=await evaluate('window.eyeOf(window.aidiyIDE.cam)');
      assert.ok(Math.abs(radius(now)-radius(before))<1e-7,'ドラッグ中は中心星までの距離を維持');
      if(step===7)assert.ok(Math.hypot(...['x','y','z'].map(key=>now[key]-before[key]))>10,'ドラッグは中心星の周囲へ回り込む');
    }
  }
  // 展開ボタンだけでは移動せず、離れた階層の行選択で1段ずつ飛ぶ。
  await evaluate(`document.querySelector('[data-path="nested"] .chevron').click()`);
  assert.deepEqual(await evaluate('window.aidiyIDE.trail'),[]);
  await evaluate(`window.explorerSnapshots=[];window.explorerScrolls=0;window.explorerState=()=>({cursor:document.querySelector('[role=treeitem].cursor')?.dataset.path,current:document.querySelector('.explorer-search small').textContent,expanded:[...document.querySelectorAll('[role=treeitem][aria-expanded=true]')].map(row=>row.dataset.path),scroll:document.querySelector('[role=tree]').scrollTop});const scroll=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(...args){if(this.closest('[role=tree]'))window.explorerScrolls++;return scroll.apply(this,args);};const tick=window.orbitTestAdvance;window.orbitTestAdvance=ms=>{const result=tick(ms);window.explorerSnapshots.push(window.explorerState());return result;};`);
  await evaluate(`window.visited=[];const advance=window.orbitTestAdvance;window.orbitTestAdvance=ms=>{const result=advance(ms);window.visited.push(window.aidiyIDE.trail.join('/'));return result;};document.querySelector('[data-path="nested/deep"]').click()`);
  const folderExplorer=await evaluate('window.explorerState()');
  await until(`window.aidiyIDE.trail.join('/')==='nested/deep'&&!document.querySelector('.space-canvas').classList.contains('warping')`,'深いフォルダへワープ');
  assert.ok((await evaluate('window.visited')).includes('nested'),'中間フォルダも通る');
  for(const state of await evaluate('window.explorerSnapshots'))assert.deepEqual(state,folderExplorer,'中間階層でも一覧のカーソル・表示先・展開・スクロールを維持');
  assert.equal(await evaluate('window.explorerScrolls'),0,'移動演出から一覧を自動スクロールしない');
  await evaluate(`window.visited=[];document.querySelector('[data-path="other"] .chevron').click()`);
  await evaluate(`document.querySelector('[data-path="other/remote.txt"]').click()`);
  await evaluate('window.explorerSnapshots=[];window.explorerScrolls=0');
  const fileExplorer=await evaluate('window.explorerState()');
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('remote.txt')&&!document.querySelector('.space-canvas').classList.contains('warping')`,'別の枝のファイルへワープ');
  for(const state of await evaluate('window.explorerSnapshots'))assert.deepEqual(state,fileExplorer,'別枝へのファイル移動中も一覧表示を維持');
  assert.equal(await evaluate('window.explorerScrolls'),0);
  const route=await evaluate('window.visited');
  for(const path of ['nested','','other'])assert.ok(route.includes(path),`経由階層: ${path}`);
  await capture('nn-warp-explorer-remote.png');
  await evaluate(`void window.aidiyIDE.clear()`);
  await advance(2000);
  assert.equal(await evaluate(`window.aidiyIDE.trail.join('/')`),'other','ビューアを閉じても到着フォルダに留まる');
  // 移動中の選び直しで、古い行のプレビューが後から開かない。
  await evaluate(`window.opened=[];new MutationObserver(()=>{const text=document.querySelector('.viewer-popup')?.textContent;if(text)window.opened.push(text);}).observe(document.querySelector('.space-view'),{childList:true,subtree:true});document.querySelector('[data-path="first.txt"]').click()`);
  await advance(550);
  await evaluate(`document.querySelector('[data-path="other"]').click()`);
  await until(`window.aidiyIDE.trail.join('/')==='other'&&!document.querySelector('.space-canvas').classList.contains('warping')`,'最後のフォルダ選択を優先');
  assert.equal(await preview(),'');assert.equal(await evaluate(`window.opened.some(text=>text.includes('first.txt'))`),false);
  // 星を直接選ぶ入口も旧来の平行移動ではなく、その場で旋回する。
  await evaluate(`window.beforeWarp={...window.aidiyIDE.cam};window.beforeProjection={...window.aidiyIDE.projection};void window.aidiyIDE.approach(window.aidiyIDE.world.byPath.get('other/remote.txt'))`);
  assert.equal(await preview(),'');await advance(550);
  const direct=await evaluate(`({before:window.eyeOf(window.beforeWarp),now:window.eyeOf(window.aidiyIDE.cam),center:{...window.aidiyIDE.projection},oldCenter:window.beforeProjection})`);
  for(const key of ['x','y','z'])assert.ok(Math.abs(direct.before[key]-direct.now[key])<1e-7,'星の直接選択も位置固定で旋回');
  assert.deepEqual(direct.center,direct.oldCenter);
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('remote.txt')&&!document.querySelector('.space-canvas').classList.contains('warping')`,'直接選択でファイルへ到着');
  await advance(3000);
  // 旧プレビューが開いた状態から別ファイルへ移る時も投影中心を滑らせない。
  await evaluate(`window.beforeWarp={...window.aidiyIDE.cam};window.beforeProjection={...window.aidiyIDE.projection};document.querySelector('[data-path="first.txt"]').click()`);
  await advance(550);
  const changing=await evaluate(`({before:window.eyeOf(window.beforeWarp),now:window.eyeOf(window.aidiyIDE.cam),center:{...window.aidiyIDE.projection},oldCenter:window.beforeProjection})`);
  for(const key of ['x','y','z'])assert.ok(Math.abs(changing.before[key]-changing.now[key])<1e-7);
  assert.deepEqual(changing.center,changing.oldCenter,'パネルを閉じる時も宇宙の投影中心を固定');
  await capture('nn-warp-preview-switch-turn.png');
  await until(`document.querySelector('.viewer-popup')?.textContent.includes('first.txt')&&!document.querySelector('.space-canvas').classList.contains('warping')`,'プレビュー切替で新しいファイルへ到着');
  // 縦横・狭い縦画面で、3パネルの全開閉パターンを実際の描画寸法と照合する。
  await evaluate(`window.aidiyIDE.clear();void window.aidiyIDE.goTo({type:'dir',path:''})`);
  await until(`window.aidiyIDE.trail.length===0&&!document.querySelector('.space-canvas').classList.contains('warping')`,'レイアウト確認の起点へ戻る');
  assert.equal(await evaluate(`document.querySelector('[aria-label="高速ワープ"]').getAttribute('aria-checked')`),'false','高速ワープは既定OFF');
  await evaluate(`document.querySelector('[aria-label="高速ワープ"]').click();const canvas=document.querySelector('.space-canvas'),animate=canvas.animate.bind(canvas);window.fastStages=0;canvas.animate=(...args)=>{window.fastStages++;return animate(...args)};`);
  for(const [path,destination] of [['nested/deep/inside.txt','nested/deep'],['other/remote.txt','other'],['first.txt','']]){
    await evaluate(`window.fastStages=0;window.visited=[];void window.aidiyIDE.goTo({type:'file',path:${JSON.stringify(path)}})`);
    await until(`document.querySelector('.viewer-path')?.textContent===${JSON.stringify(path)}&&!document.querySelector('.space-canvas').classList.contains('warping')`,'高速ワープで目的ファイルへ到着');
    assert.equal(await evaluate('window.fastStages'),2,'退出と到着の1回だけで移動');
    const visited=await evaluate('[...new Set(window.visited)]');
    assert.ok(visited.length<=2&&visited.at(-1)===destination,'中間フォルダを経由しない '+JSON.stringify(visited));
    const arrived=await evaluate('({...window.aidiyIDE.cam})');await advance(2000);
    assert.deepEqual(await evaluate('({...window.aidiyIDE.cam})'),arrived,'到着後にファイルへ横滑りしない');
  }
  await capture('fast-warp-on.png');
  await evaluate(`window.fastStages=0;void window.aidiyIDE.goTo({type:'file',path:'first.txt'})`);
  await until(`document.querySelector('.viewer-path')?.textContent==='first.txt'&&!document.querySelector('.space-canvas').classList.contains('warping')`,'高速ONでも同階層のファイルへ旋回・接近');
  assert.equal(await evaluate('window.fastStages'),0,'高速ONでも同階層にワープ演出を入れない');
  await evaluate(`window.fastStages=0;void window.aidiyIDE.goTo({type:'file',path:'first.txt'})`);
  await advance(2000);assert.equal(await evaluate('window.fastStages'),0,'接近済みの同じファイルは飛び直さない');
  await evaluate(`void window.aidiyIDE.goTo({type:'file',path:'nested/deep/inside.txt'})`);await advance(550);
  await evaluate(`void window.aidiyIDE.goTo({type:'file',path:'first.txt'})`);
  await until(`document.querySelector('.viewer-path')?.textContent==='first.txt'&&!document.querySelector('.space-canvas').classList.contains('warping')`,'選び直したファイルへ到着');
  assert.equal(await evaluate(`document.querySelector('.viewer-path')?.textContent`),'first.txt','選び直しで古い高速ワープを取り消す');
  assert.deepEqual(await evaluate('window.aidiyIDE.trail'),[]);
  await evaluate(`document.querySelector('[aria-label="高速ワープ"]').click();window.aidiyIDE.clear();void window.aidiyIDE.goTo({type:'dir',path:''})`);
  await until(`window.aidiyIDE.trail.length===0&&!document.querySelector('.space-canvas').classList.contains('warping')`,'高速ワープ検証後に起点へ戻る');
  console.log('FAST WARP PASS: 既定OFF・深いフォルダ/別枝/親への1回の移動・同階層は旋回と接近・連続選択の取消');
  for(const [width,height] of [[1280,800],[768,1000],[390,844]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await sleep(100);
    for(const explorer of [false,true])for(const list of [false,true])for(const viewer of [false,true]){
      await evaluate(`document.querySelector('[aria-label="エクスプローラーを${explorer?'開く':'閉じる'}"]')?.click()`);
      await evaluate(viewer?`void window.aidiyIDE.goTo({type:'file',path:'first.txt'})`:`void window.aidiyIDE.clear()`);
      if(viewer)await until(`document.querySelector('.viewer-path')?.textContent==='first.txt'&&!document.querySelector('.space-canvas').classList.contains('warping')`,'レイアウト確認用のファイルを開く');
      await evaluate(`(()=>{const button=document.querySelector('.route-choice');if((button.getAttribute('aria-expanded')==='true')!==${list})button.click();})()`);
      await advance(4000);await sleep(30);
      const state=await evaluate(`(()=>{const rect=s=>{const e=document.querySelector(s);return e&&getComputedStyle(e).display!=='none'?e.getBoundingClientRect().toJSON():null};return {center:window.aidiyIDE.projection,explorer:rect('.explorer-panel'),list:rect('.route-file-list'),bar:rect('.explorer-routes'),viewer:rect('.viewer-popup')};})()`);
      const label=JSON.stringify({width,height,explorer,list,viewer});
      assert.equal(!!state.explorer,explorer,label);assert.equal(!!state.list,list,label);assert.equal(!!state.viewer,viewer,label);
      if(explorer)assert.ok(Math.abs(state.explorer.width-width*.25)<1,'エクスプローラーは横幅25% '+label);
      assert.ok(Math.abs(state.bar.width-width*.25)<1,'軌跡は開閉状態によらず横幅25% '+label);
      const contains=r=>r&&state.center.x>r.left&&state.center.x<r.right&&state.center.y>r.top&&state.center.y<r.bottom;
      for(const panel of [state.explorer,state.list,state.viewer])assert.ok(!contains(panel),'宇宙の中心がパネルに隠れない '+label);
      if(height>=width){
        assert.ok(state.bar.left>=width/2,'縦表示の軌跡は常に上右 '+label);
        if(explorer)assert.ok(state.explorer.right<=width/2&&state.explorer.bottom<=height/2,'上左のエクスプローラー '+label);
        if(list)assert.ok(state.list.bottom<=height/2,'軌跡は半分まで '+label);
        if(viewer)assert.ok(state.viewer.top>=height/2&&state.center.y<height/2,'ビューアは下、宇宙は上 '+label);
        else assert.ok(Math.abs(state.center.x-width/2)<1&&Math.abs(state.center.y-height/2)<1,'ビューア非表示は一覧の開閉によらず画面中央 '+label);
      }else{
        if(explorer)assert.ok(state.explorer.right<=state.bar.left,'エクスプローラーの右に軌跡 '+label);
        if(list)assert.ok(Math.abs(state.list.bottom-(height-60))<2&&state.list.right<width*.67-16,'軌跡はビューアより左側・下端まで '+label);
        if(viewer)assert.ok(Math.abs(state.viewer.width-width*.33)<1,'右側33%のビューア '+label);
      }
      if(explorer&&list&&viewer)await capture(`layout-${width}x${height}.png`);
    }
  }
  console.log('LAYOUT PASS: 縦横3サイズ × エクスプローラー・軌跡リスト・ビューアの8パターン');
  assert.deepEqual(errors,[]);

  console.log('EXPLORER WARP PASS: 同階層の旋回と直進・深いフォルダと別枝はワープ・連続選択・閉じた時の現在地保持・ドラッグの中心星周回');

  console.log('WARP PASS: 船体位置を固定した旋回、正面を維持した前進、光跡、子階層到着、ゲート帰還');
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
