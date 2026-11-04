// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// Code / Live の旧版演出を実ブラウザ・模擬通信で検証する。外部 AI には送信しない。
// （--screenshot の仮想時間ではアニメーションが進まず、Claude のブラウザペインは拡大率がずれるため）
// 使い方: node frontend_ide/viewer/scripts/shot.mjs URL 出力.png [待機ms=8000] [撮影前に実行するJS] [JS後の待機ms=3000]
// 例:     node frontend_ide/viewer/scripts/shot.mjs "http://127.0.0.1:<起動ログのポート>/#/frontend_web" out.png 8000 "aidiyIDE.flyHome()"
// JS は Runtime.evaluate で評価し、戻り値（Promise なら解決値）を標準出力へ JSON で出す。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startDevelopment } from '../server.mjs';
import { createServer } from 'node:http';

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
  await send('Emulation.setDeviceMetricsOverride', { width: 560, height: 800, deviceScaleFactor: 1, mobile: false });
  const errors = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(JSON.stringify(m.params.args)); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text); });
  await send('Runtime.enable');await send('Page.enable');

  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
    return response.result?.result?.value;
  }
  async function capture(name) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(name, Buffer.from(shot.result.data, 'base64'));
    console.log(name);
  }
  async function waitFor(expression) {
    for(let i=0;i<200;i++){if(await evaluate(expression))return;await sleep(100);}
    throw Error('演出の待機がタイムアウトしました: '+expression);
  }
  async function watchHolds() {
    await evaluate(`window.holdRecords=[];window.holdObserver?.disconnect();window.holdObserver=new MutationObserver(()=>{
      const now=performance.now();
      for(const popup of document.querySelectorAll('.answer-popup')){
        let item=holdRecords.find(item=>item.popup===popup);
        if(!item){item={popup};holdRecords.push(item);}
        if(item.complete===undefined&&!popup.querySelector('.terminal-cursor')){item.complete=now;item.text=popup.textContent;}
        if(item.flight===undefined&&popup.style.position==='fixed')item.flight=now;
      }
      for(const item of holdRecords)if(!item.popup.isConnected&&item.removed===undefined)item.removed=now;
    });holdObserver.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});`);
  }
  async function checkHolds(kind,count) {
    await waitFor(`holdRecords.filter(item=>item.removed!==undefined).length===${count}`);
    const results=await evaluate(`holdRecords.map(({text,complete,flight})=>({text,hold:flight-complete}))`);
    for(const result of results)assert.ok(result.hold>=2950&&result.hold<4000,`${kind}: 全文表示後の待機 ${JSON.stringify(result)}`);
    console.log(kind+' HOLD '+JSON.stringify(results));
  }
  async function stopMetrics(selector) {
    return evaluate(`(()=>{
      const button=document.querySelector(${JSON.stringify(selector)}), icon=button.querySelector('img'), label=button.querySelector('.stop-label');
      const rect=button.getBoundingClientRect(), image=icon.getBoundingClientRect(), text=label.getBoundingClientRect();
      const style=getComputedStyle(button), font=getComputedStyle(label);
      return {width:rect.width,height:rect.height,background:style.backgroundColor,border:style.borderColor,
        icon:[image.width,image.height,image.left-rect.left,image.top-rect.top],loaded:icon.naturalWidth>0,
        label:[font.fontFamily,font.fontSize,font.lineHeight,font.fontWeight,text.left-rect.left,rect.bottom-text.bottom]};
    })()`);
  }
  async function liveMetrics(selectors) {
    return evaluate(`(()=>{const result={};for(const [name,selector] of Object.entries(${JSON.stringify(selectors)})){const element=document.querySelector(selector),style=getComputedStyle(element);result[name]=Object.fromEntries(['fontSize','lineHeight','color','backgroundColor','borderTopColor','borderTopWidth','padding','opacity'].map(key=>{const value=style[key];return[key,value.startsWith('rgba(')&&value.endsWith(', 1)')?'rgb('+value.slice(5,-4)+')':value];}));}return result;})()`);
  }
  const fixture=readFileSync(new URL('../checks/host-fixture.js',import.meta.url),'utf8').replace("下書き:'保存された依頼'", "下書き:''");
  const bridge = `window.aidiyWindow={isMaximized:async()=>false,minimize:async()=>{},maximize:async()=>{},close:async()=>{}};`;
  const codeInit=await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.fixtureKind='code';window.fixtureManual=true;\n"+bridge+fixture});
  await send('Page.navigate',{url});await sleep(1400);
  // 単独窓と同じタイトル行を表示し、初期演出はCSSの時計を固定して撮影する。
  await evaluate(`document.querySelector('.development-app').classList.remove('vscode-host');document.getAnimations().forEach(a=>{a.pause();a.currentTime=7500;});`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.welcome-text')).animationDuration`),'12s');
  assert.equal(await evaluate(`document.querySelector('[aria-label="最大化"]')!==null`),true);
  assert.equal(await evaluate(`document.querySelector('.send img').naturalWidth>0`),true);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.progress')).display`),'none');
  await capture('nn-effects-code-welcome.png');
  await evaluate(`document.getAnimations().forEach(a=>a.play());const input=document.querySelector('textarea');input.value='旧版と同じ演出を確認します。';input.dispatchEvent(new Event('input',{bubbles:true}));`);await sleep(50);
  await evaluate(`document.querySelector('form').requestSubmit();fixtureState.実行中=true;fixtureState.メッセージ=[{種別:'user',本文:'旧版と同じ演出を確認します。'}];fixtureNotify({type:'accepted'});fixtureNotify({...fixtureState});`);await sleep(140);
  assert.equal(await evaluate(`!!document.querySelector('.input-flight')`),true);
  assert.equal(await evaluate(`document.querySelector('.message.user').classList.contains('arrival-pending')`),true);
  await capture('nn-effects-code-input-flight.png');
  await sleep(1550);
  assert.equal(await evaluate(`!!document.querySelector('.input-flight,.arrival-pending')`),false);
  assert.equal(await evaluate(`(()=>{const u=document.querySelector('.message.user').getBoundingClientRect(),c=document.querySelector('.conversation').getBoundingClientRect();return u.left>c.left+100&&Math.abs(u.right-c.right)<5;})()`),true);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.prompt-frame'),'::before').animationName`),'prompt-reflect');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.prompt-frame'),'::after').height`),'1px');
  await evaluate(`fixtureNotify({メッセージ識別:'output_stream',メッセージ内容:'\u0002'});fixtureNotify({メッセージ識別:'output_stream',メッセージ内容:'変更箇所を確認しています。'});`);await sleep(180);
  assert.equal(await evaluate(`document.querySelector('.progress pre').textContent.trim()`),'変更箇所を確認しています。');
  assert.equal(await evaluate(`!!document.querySelector('.progress .terminal-cursor')`),true);
  // ストリーム枠が開いたら、光はストリーム枠の上下の枠線を流れる。
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.progress'),'::before').animationName`),'prompt-reflect');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.progress'),'::after').height`),'1px');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.prompt-frame'),'::before').animationName`),'none');
  await capture('nn-effects-code-running.png');
  const stopAppearance=await stopMetrics('.stop');
  assert.equal(stopAppearance.loaded,true);
  assert.equal(await evaluate(`document.querySelector('.send')`),null);
  await capture('nn-effects-code-stop.png');
  await evaluate(`document.querySelector('.stop').click();document.querySelector('.stop').click();`);await sleep(50);
  assert.equal(await evaluate(`document.querySelector('.stop').disabled`),true);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.stop')).opacity`),'0.4');
  assert.equal(await evaluate(`fixtureMessages.filter(m=>m.メッセージ識別==='cancel_run').length`),1);
  await evaluate(`fixtureState.停止中=true;fixtureNotify({...fixtureState});`);await sleep(50);
  assert.equal(await evaluate(`document.querySelector('.stop').disabled`),true);
  await watchHolds();
  await evaluate(`fixtureNotify({メッセージ識別:'output_stream',メッセージ内容:'\u0003'});fixtureState.実行中=false;fixtureState.進捗=['変更箇所を確認しています。'];fixtureState.メッセージ.push({種別:'assistant',本文:'**確認できました。**\\n送信した入力は右側へ、回答は中央の文字送りから履歴へ移動します。'});fixtureNotify({...fixtureState});`);await sleep(1200);
  assert.equal(await evaluate(`document.querySelectorAll('.answer-popup').length`),1);
  assert.equal(await evaluate(`document.querySelector('.stop')`),null);
  assert.equal(await evaluate(`!!document.querySelector('.send')`),true);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.message.assistant')).display`),'none');
  assert.equal(await evaluate(`document.querySelector('.progress .terminal-cursor')`),null);
  await capture('nn-effects-code-answer-popup.png');
  // 同じ状態が再送されても回答演出を再開しない。
  await evaluate(`window.originalPopup=document.querySelector('.answer-popup');fixtureNotify({...fixtureState});`);await sleep(100);
  assert.equal(await evaluate(`originalPopup===document.querySelector('.answer-popup')`),true);
  // 後続回答が先着しても、表示中の回答の3秒待機を打ち切らない。
  await evaluate(`fixtureState.メッセージ.push({種別:'assistant',本文:'続けて届いた回答です。'},{種別:'assistant',本文:'同じ通知で届いた3つ目の回答です。'});fixtureNotify({...fixtureState});`);await sleep(100);
  assert.equal(await evaluate(`originalPopup===document.querySelector('.answer-popup')`),true,'Code: 後続回答で3秒待機が中断されない');
  await checkHolds('Code',3);
  assert.equal(await evaluate(`document.querySelectorAll('.answer-popup,.input-flight,.arrival-waiting,.arrival-pending').length`),0);
  assert.equal(await evaluate(`document.querySelector('.message.assistant strong').textContent`),'確認できました。');
  await capture('nn-effects-code-history.png');
  // 会話切替では保存済み回答を再演出せず、進行中の枠・タイマーを解除する。
  await evaluate(`fixtureState.メッセージ.push({種別:'assistant',本文:'次の回答'},{種別:'assistant',本文:'順番待ちの回答'});fixtureNotify({...fixtureState});`);await sleep(100);
  assert.equal(await evaluate(`!!document.querySelector('.answer-popup')`),true);
  await evaluate(`fixtureState.会話ID='history';fixtureState.メッセージ=[{種別:'assistant',本文:'保存済み回答'}];fixtureNotify({...fixtureState});`);await sleep(1700);
  assert.equal(await evaluate(`document.querySelectorAll('.answer-popup,.input-flight,.arrival-waiting,.arrival-pending').length`),0);
  await evaluate(`fixtureState.会話ID='new';fixtureState.メッセージ=[];fixtureNotify({...fixtureState});`);await sleep(100);
  assert.equal(await evaluate(`document.querySelector('.terminal-welcome').classList.contains('welcome-input-started')`),false);
  await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:codeInit.result.identifier});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.fixtureKind='live';\n"+bridge+fixture});
  await send('Page.navigate',{url});await sleep(1400);
  assert.equal(await evaluate(`fixtureMessages.filter(m=>m.type==='socket-open').length`),0);
  await evaluate(`document.querySelector('.development-app').classList.remove('vscode-host');document.getAnimations().forEach(a=>{a.pause();a.currentTime=7500;});`);
  await capture('nn-effects-live-welcome.png');
  const liveAppearance=await liveMetrics({audio:'.audio-button',label:'.audio-button strong',input:'textarea',send:'.send',footer:'.composer'});
  await evaluate(`document.getAnimations().forEach(a=>a.play());`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='接続').click()`);await sleep(700);
  assert.equal(await evaluate(`fixtureMessages.filter(m=>m.type==='socket-open').length`),3);
  assert.equal(await evaluate(`document.querySelector('.connection-bar').classList.contains('online')`),true);
  await evaluate(`const input=document.querySelector('textarea');input.value='こんにちは';input.dispatchEvent(new Event('input',{bubbles:true}));`);await sleep(50);
  await watchHolds();
  await evaluate(`document.querySelector('form').requestSubmit()`);await sleep(150);
  assert.equal(await evaluate(`document.querySelector('article').textContent`),'Liveテスト回答');
  assert.equal(await evaluate(`document.querySelectorAll('.answer-popup').length`),1);
  await sleep(800);await capture('nn-effects-live-answer-popup.png');
  // Liveは別の回答・遅れた入力通知でも表示中の回答を3秒保持する。
  await evaluate(`window.firstLivePopup=document.querySelector('.answer-popup');window.livePacket=packet=>fixtureNotify({type:'socket-data',id:fixtureMessages.find(m=>m.type==='socket-open').id,data:JSON.stringify({チャンネル:'0',...packet})});livePacket({メッセージ識別:'output_request',メッセージ内容:'コードエージェントの回答です。'});`);await sleep(100);
  assert.equal(await evaluate(`document.querySelectorAll('.answer-popup').length`),1);
  assert.equal(await evaluate(`firstLivePopup===document.querySelector('.answer-popup')`),true);
  await evaluate(`livePacket({メッセージ識別:'input_text',メッセージ内容:'こんにちは'});`);await sleep(120);
  assert.equal(await evaluate(`!!document.querySelector('.input-flight')`),true);
  assert.equal(await evaluate(`firstLivePopup===document.querySelector('.answer-popup')`),true);
  await evaluate(`livePacket({メッセージ識別:'recognition_output',メッセージ内容:'音声認識の表示も確認できました。'});`);
  await waitFor(`!!document.querySelector('.answer-popup.output_request')&&!document.querySelector('.answer-popup .terminal-cursor')`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.answer-popup-text')).color`),'rgb(0, 255, 255)');
  await waitFor(`!!document.querySelector('.answer-popup.recognition_output')&&!document.querySelector('.answer-popup .terminal-cursor')`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.answer-popup-text')).color`),'rgb(154, 230, 180)');
  await checkHolds('Live',3);await capture('nn-effects-live-history.png');
  assert.equal(await evaluate(`document.querySelectorAll('.answer-popup,.input-flight,.arrival-waiting,.arrival-pending').length`),0);
  await evaluate(`document.querySelector('.audio-actions button').click()`);await sleep(100);
  await evaluate(`livePacket({メッセージ識別:'output_text',メッセージ内容:'会話切替で止める回答'});livePacket({メッセージ識別:'output_request',メッセージ内容:'会話切替で破棄する順番待ち回答'});`);await sleep(100);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='新しい会話').click()`);await sleep(700);
  assert.equal(await evaluate(`fixtureSession`),2);
  assert.equal(await evaluate(`document.querySelectorAll('.answer-popup,.arrival-waiting,.arrival-pending').length`),0);
  assert.match(await evaluate(`document.querySelector('.audio-actions button').textContent`),/OFF/);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='切断').click()`);await sleep(100);
  assert.equal(await evaluate(`fixtureMessages.filter(m=>m.type==='socket-close').length`),6);
  assert.equal(await evaluate(`document.querySelectorAll('.answer-popup,.input-flight').length`),0);
  assert.deepEqual(errors,[]);
  console.log('Vue Code / Live: 初期文字送り・紙ヒコーキ・入力飛行・上下バー・進捗・中央回答・着地・再送・会話切替・Live種別色を確認');
  ws.close();
} finally {
  chrome.kill();
  await app.close();
  await sleep(300);
  if (!resolve(profile).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('一時パスが不正です');
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome が掴んでいれば残す */ }
}
