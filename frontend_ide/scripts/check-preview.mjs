// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// HTML / SVG の相対参照を実ブラウザの文書表示で検証する。
// ルートから node frontend_ide/scripts/check-preview.mjs。オフラインだけを使いAI接続はしない。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { startDevelopment } from '../server.mjs';

const project = mkdtempSync(join(tmpdir(), 'aidiy_preview-'));
for(const path of ['pages/assets','shared','pages/sub'])mkdirSync(join(project,path),{recursive:true});
const png=readFileSync(resolve('frontend_ide/dist/AiDiy.png'));
// 外部サイト役もローカルで動かし、ブラウザのRefererにプレビューtokenが入らないことを確認する。
const externalRequests=[];
const external=createServer((req,res)=>{externalRequests.push({path:req.url,referer:req.headers.referer});res.writeHead(200,{'content-type':'image/png'});res.end(png);});
await new Promise(done=>external.listen(0,'127.0.0.1',done));
const externalImage=`http://127.0.0.1:${external.address().port}/external.png`;
for(const path of ['pages/assets/ロゴ 画像.png','shared/logo.png'])writeFileSync(join(project,path),png);
writeFileSync(join(project,'pages/assets/defs.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><symbol id="mark" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#9559eb"/></symbol></svg>');
writeFileSync(join(project,'pages/assets/style.css'),'body{margin:24px;background:#f3f5fa;color:#17243b;font:16px sans-serif}h1{font-size:22px}.card{background:white;border:1px solid #ddd;padding:16px;margin:16px 0}img,.css-image{width:96px;height:96px;object-fit:contain}.css-image{background:url("../../shared/logo.png") center/contain no-repeat}');
writeFileSync(join(project,'pages/assets/module.js'),'document.body.dataset.module="loaded";');
writeFileSync(join(project,'pages/日本語 ページ.html'),`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="assets/style.css"><h1>相対参照の表示確認</h1><div class="card">同じフォルダからの画像<br><img id="local" src="assets/ロゴ%20画像.png"></div><div class="card">親フォルダからの画像<br><img id="parent" src="../shared/logo.png"></div><div class="card">CSSの相対画像<div class="css-image"></div>外部SVG参照 <svg width="32" height="32"><use id="symbol" href="assets/defs.svg#mark" width="32" height="32"/></svg></div><script type="module" src="assets/module.js"></script><script>try{parent.document.body;document.body.dataset.isolated='no'}catch{document.body.dataset.isolated='yes'}</script>`);
writeFileSync(join(project,'pages/図面.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="430" viewBox="0 0 520 430"><rect width="520" height="430" fill="#f3f5fa"/><text x="24" y="40" font-size="22">SVGの相対画像</text><image id="local" href="assets/ロゴ%20画像.png" x="24" y="64" width="180" height="180" onload="this.dataset.loaded='yes'"/><image id="parent" href="../shared/logo.png" x="254" y="64" width="180" height="180" onload="this.dataset.loaded='yes'"/><text x="24" y="280" font-size="18">同じフォルダ / 親フォルダ</text><use id="symbol" href="assets/defs.svg#mark" x="24" y="320" width="48" height="48"/></svg>`);
writeFileSync(join(project,'pages/sub/index.html'),'<img id="index-image" src="../assets/ロゴ%20画像.png">');
const htmlFixture=join(project,'pages/日本語 ページ.html');
writeFileSync(htmlFixture,readFileSync(htmlFixture,'utf8')+`<img id="root-relative" src="/assets/ロゴ%20画像.png"><img id="external" src="${externalImage}">`);
const argument=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null;};
const htmlExample=argument('--html'),svgExample=argument('--svg');
const app = await startDevelopment(htmlExample&&svgExample?resolve(argument('--project')||'.'):project);
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
  const responses=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Network.responseReceived')responses.push(m.params.response);});await send('Network.enable');
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
  async function wheelPreview() {
    const point=await evaluate(`(()=>{const r=document.querySelector('.viewer-preview').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+Math.min(80,r.height/2)};})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:100});
  }
  await fetch(new URL('/api/connection/offline',url),{method:'POST'});
  async function until(check,message){for(let i=0;i<150;i++){if(await check())return;await sleep(100);}assert.fail(message);}
  async function openFile(path){
    await send('Page.navigate',{url:url+'?previewTest='+Date.now()+'#viewer='+encodeURIComponent(path)});
    await until(()=>evaluate(`!!document.querySelector('.viewer-mode')`),'ファイルを表示');
  }
  async function childContext(){
    const tree=await send('Page.getFrameTree');const child=tree.result.frameTree.childFrames?.find(item=>item.frame.url.includes('/p/'));
    if(!child)return null;
    const result=await send('Page.createIsolatedWorld',{frameId:child.frame.id,worldName:'preview-check'});return result.result?.executionContextId;
  }
  async function child(expression){const contextId=await childContext();if(!contextId)return null;const response=await send('Runtime.evaluate',{expression,contextId,returnByValue:true});return response.result?.result?.value;}
  if(htmlExample&&svgExample){
    await openFile(htmlExample);
    await evaluate(`Array.from(document.querySelectorAll('.viewer-mode button')).find(b=>b.textContent==='表示').click()`);
    await until(()=>child(`document.styleSheets.length>0&&Array.from(document.styleSheets).some(sheet=>sheet.cssRules.length>0)`),'実HTMLの相対CSSを読込');
    await capture('nn-preview-example-html.png');
    console.log('HTML CSS:',JSON.stringify(await child(`({title:document.title,styles:Array.from(document.styleSheets).map(sheet=>sheet.href),bodyMaxWidth:getComputedStyle(document.body).maxWidth})`)));
    await openFile(svgExample);
    await until(()=>child(`!!document.querySelector('svg image')`),'実SVGの文書表示');
    const imageUrl=await child(`new URL(document.querySelector('svg image').getAttribute('href')||document.querySelector('svg image').getAttribute('xlink:href'),location.href).href`);
    await until(async()=>responses.some(item=>item.url===imageUrl&&item.status===200),'実SVGの相対画像が200応答');
    await sleep(500);await capture('nn-preview-example-svg.png');
    console.log('SVG IMAGE:',imageUrl,'200');assert.deepEqual(errors,[]);
    console.log('EXAMPLES PASS: 指定HTMLの相対CSSと指定SVGの背景画像を表示');
  }else{
  await openFile('pages/日本語 ページ.html');
  await evaluate(`Array.from(document.querySelectorAll('.viewer-mode button')).find(b=>b.textContent==='表示').click()`);
  await until(()=>child(`document.querySelector('#local')?.naturalWidth>0&&document.querySelector('#parent')?.naturalWidth>0&&document.body.dataset.module==='loaded'`),'HTMLの相対画像とモジュール');
  assert.equal(await child(`document.body.dataset.isolated`),'yes','IDEへの親DOMアクセスは隔離');
  await until(()=>child(`document.querySelector('#root-relative')?.naturalWidth>0&&document.querySelector('#external')?.naturalWidth>0`),'ルート相対画像と別公開元の画像');
  assert.ok(externalRequests.some(request=>request.path==='/external.png'));
  assert.ok(externalRequests.every(request=>!request.referer),'外部画像にtokenやプロジェクト内パスを送らない');
  await evaluate(`window.previewActivity=0;addEventListener('message',e=>{if(e.source===document.querySelector('.viewer-preview')?.contentWindow&&e.data?.type==='aidiy-ide-viewer-activity')window.previewActivity++;});`);
  await wheelPreview();
  await until(()=>evaluate('window.previewActivity>0'),'HTML内の操作を親へ通知');
  await until(()=>child(`document.querySelector('#symbol')?.getBBox().width>0`),'HTML内の外部SVG参照');
  assert.match(await child(`getComputedStyle(document.querySelector('.css-image')).backgroundImage`),/shared\/logo.png/);
  await capture('nn-preview-html-relative.png');
  await openFile('pages/図面.svg');
  await until(()=>child(`document.querySelector('#local')?.dataset.loaded==='yes'&&document.querySelector('#parent')?.dataset.loaded==='yes'`),'SVGから相対画像を読込');
  await until(()=>child(`document.querySelector('#symbol')?.getBBox().width>0`),'SVG内の外部SVG参照');
  assert.equal(await evaluate(`document.querySelector('.viewer-content>img')===null`),true);
  await evaluate(`window.previewActivity=0;addEventListener('message',e=>{if(e.source===document.querySelector('.viewer-preview')?.contentWindow&&e.data?.type==='aidiy-ide-viewer-activity')window.previewActivity++;});`);
  await wheelPreview();
  await until(()=>evaluate('window.previewActivity>0'),'SVG内の操作を親へ通知');
  await capture('nn-preview-svg-relative.png');
  await evaluate(`Array.from(document.querySelectorAll('.viewer-mode button')).find(b=>b.textContent==='コード').click()`);
  await until(()=>evaluate(`document.querySelector('.viewer-code')?.getBoundingClientRect().height>0`),'SVGのコード表示');
  await evaluate(`Array.from(document.querySelectorAll('.viewer-mode button')).find(b=>b.textContent==='表示').click()`);
  await until(()=>child(`document.querySelector('#local')?.dataset.loaded==='yes'`),'SVGの表示へ復帰');
  await evaluate(`document.querySelector('.viewer-refresh').click()`);
  await until(()=>child(`document.querySelector('#local')?.dataset.loaded==='yes'`),'再読込でも相対参照を維持');
  assert.deepEqual(errors,[]);
  console.log('PREVIEW PASS: HTML/SVGの同階層・親階層画像、CSS、モジュール、外部SVG参照、IDE隔離、コード切替、再読込');
  }
  ws.close();
} finally {
  external.closeAllConnections();await new Promise(done=>external.close(done));
  chrome.kill();
  await app.close();
  await sleep(300);
  if (!resolve(profile).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('一時パスが不正です');
  if (!resolve(project).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('一時プロジェクトが不正です');
  rmSync(project,{recursive:true,force:true});
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome が掴んでいれば残す */ }
}
