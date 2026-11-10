// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// Vue Code / Live を実ブラウザと模擬ホストで確認する。外部AIへは送信しない。
// node frontend_ide/scripts/check-host.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const fixture=readFileSync(new URL('../checks/host-fixture.js',import.meta.url),'utf8');
  const codeInit=await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.fixtureKind='code';\n"+fixture});
  await send('Page.navigate',{url});await sleep(1400);
  assert.equal(await evaluate(`document.querySelector('textarea').value`),'保存された依頼');
  await evaluate(`document.querySelector('form').requestSubmit()`);await sleep(250);
  assert.equal(await evaluate(`document.querySelector('textarea').value`),'');
  assert.equal(await evaluate(`document.querySelector('article strong').textContent`),'テスト回答');
  assert.equal(await evaluate(`fixtureMessages.find(message=>message.type==='input_text').self_check_loop`),0);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='モデル ▾').click()`);await sleep(250);
  assert.equal(await evaluate(`document.querySelector('dialog').open`),true);
  assert.deepEqual(await evaluate(`[...document.querySelector('.model-dialog select').options].map(o=>o.value)`),['','codex_cli']);
  assert.equal(await evaluate(`document.querySelectorAll('.model-dialog select')[1].value`),'auto');
  await evaluate(`document.querySelectorAll('.model-dialog select')[1].value='__custom__';document.querySelectorAll('.model-dialog select')[1].dispatchEvent(new Event('change',{bubbles:true}));`);await sleep(30);
  await evaluate(`const custom=document.querySelector('.model-dialog input');custom.value='  ';custom.dispatchEvent(new Event('input',{bubbles:true}));`);await sleep(30);
  assert.equal(await evaluate(`document.querySelector('.model-dialog button').disabled`),true);
  await evaluate(`const provider=document.querySelector('.model-dialog select');provider.value='';provider.dispatchEvent(new Event('change',{bubbles:true}));`);await sleep(30);
  assert.equal(await evaluate(`document.querySelector('.model-dialog button').disabled`),false);
  await evaluate(`document.querySelector('.model-dialog button').click()`);await sleep(30);
  assert.deepEqual(await evaluate(`fixtureMessages.findLast(m=>m.type==='setModel')`),{type:'setModel',provider:'',model:''});
  // 検証回数の選択を次の送信へ反映し、オフライン往復でも元の値を保つ。
  await evaluate(`const checks=document.querySelector('[aria-label="検証回数"]');checks.value='3';checks.dispatchEvent(new Event('change',{bubbles:true}));const nextInput=document.querySelector('textarea');nextInput.value='  余白付き依頼  ';nextInput.dispatchEvent(new Event('input',{bubbles:true}));`);await sleep(40);
  await evaluate(`document.querySelector('form').requestSubmit()`);await sleep(80);
  assert.equal(await evaluate(`fixtureMessages.findLast(m=>m.type==='input_text').self_check_loop`),3);
  assert.equal(await evaluate(`fixtureMessages.findLast(m=>m.type==='input_text').メッセージ内容`),'  余白付き依頼  ');
  await evaluate(`Object.assign(fixtureState,{実行モード:'offline',接続済み:false,オフライン対応:true});fixtureNotify({...fixtureState})`);await sleep(40);
  assert.equal(await evaluate(`document.querySelector('[aria-label="検証回数"]').value`),'0');
  assert.equal(await evaluate(`document.querySelector('[aria-label="検証回数"]').disabled`),true);
  await evaluate(`Object.assign(fixtureState,{実行モード:'online',接続済み:true});fixtureNotify({...fixtureState})`);await sleep(40);
  assert.equal(await evaluate(`document.querySelector('[aria-label="検証回数"]').value`),'3');
  // 遅いモデル候補応答中は決定・プロバイダ変更を許可しない。
  await evaluate(`fixtureHold=p=>p.type==='modelCatalog'&&!!p.provider;Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='モデル ▾').click()`);await sleep(80);
  assert.equal(await evaluate(`document.querySelector('.model-dialog button').disabled`),true);
  await evaluate(`fixtureHold=null;fixtureFlush()`);await sleep(80);
  assert.equal(await evaluate(`document.querySelector('.model-dialog button').disabled`),false);
  await capture('nn-audit-code-model.png');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(60);
  assert.equal(await evaluate(`document.querySelector('dialog')===null`),true);
  // 履歴は新しい順、削除は確認後だけ送信する。
  await evaluate(`fixtureState.履歴=[{id:'old',題名:'古い会話',更新日時:1000000},{id:'fixture-code',題名:'現在の会話',更新日時:2000000}];fixtureNotify({...fixtureState});Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='一覧').click()`);await sleep(60);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.history-title')].map(e=>e.textContent)`),['現在の会話','古い会話']);
  assert.equal(await evaluate(`document.querySelector('.history-row').classList.contains('active')`),true);
  assert.match(await evaluate(`document.querySelector('.history-date').textContent`),/1970\/01\/01/);
  await evaluate(`document.querySelector('.history-delete').click()`);await sleep(60);
  assert.equal(await evaluate(`fixtureMessages.filter(m=>m.type==='deleteHistory').length`),0);
  await capture('nn-audit-code-delete.png');
  await evaluate(`Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent==='キャンセル').click()`);await sleep(30);
  assert.equal(await evaluate(`fixtureMessages.filter(m=>m.type==='deleteHistory').length`),0);
  await evaluate(`document.querySelector('.history-delete').click()`);await sleep(30);
  await evaluate(`Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent==='削除する').click()`);await sleep(30);
  assert.equal(await evaluate(`fixtureMessages.findLast(m=>m.type==='deleteHistory').id`),'fixture-code');
  await evaluate(`fixtureNotify({type:'showConversation'})`);await sleep(30);
  assert.equal(await evaluate(`document.querySelector('.history-list')===null`),true);
  // オンライン自動接続の未接続は赤脈動、手動OFFは静的黒。連打も抑止する。
  await evaluate(`Object.assign(fixtureState,{自動接続:true,接続済み:false,実行モード:'offline',オフライン対応:true});fixtureNotify({...fixtureState})`);await sleep(40);
  assert.equal(await evaluate(`document.querySelector('.connection-bar').classList.contains('disconnected')`),true);
  await evaluate(`document.querySelector('.auto-connect').click();document.querySelector('.auto-connect').click()`);await sleep(30);
  assert.equal(await evaluate(`fixtureMessages.filter(m=>m.type==='autoConnect').length`),1);
  await evaluate(`fixtureState.自動接続=false;fixtureNotify({...fixtureState})`);await sleep(40);
  assert.equal(await evaluate(`document.querySelector('.connection-bar').classList.contains('offline')`),true);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.connection-bar')).backgroundColor`),'rgb(0, 0, 0)');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='モデル ▾').click()`);await sleep(100);
  assert.equal(await evaluate(`document.querySelector('.model-dialog select').disabled`),true);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.model-dialog select')[1].options].map(o=>o.value)`),['auto']);
  await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:codeInit.result.identifier});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.fixtureKind='live';\n"+`window.fixtureCaptureUrl=URL.createObjectURL(new Blob([${JSON.stringify(readFileSync('frontend_ide/host/aidiy_live/media/capture.js','utf8'))}],{type:'text/javascript'}));\n`+fixture});
  await send('Page.navigate',{url});await sleep(1400);
  assert.equal(await evaluate(`fixtureMessages.filter(m=>m.type==='socket-open').length`),0);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='接続').click()`);await sleep(700);
  assert.equal(await evaluate(`fixtureMessages.filter(m=>m.type==='socket-open').length`),3);
  assert.equal(await evaluate(`document.querySelector('.terminal-welcome')===null`),true,'初回接続では開始画面を消す');
  await evaluate(`document.querySelector('.microphone').click()`);await sleep(650);
  assert.equal(await evaluate(`document.querySelector('.microphone').getAttribute('aria-pressed')`),'true');
  assert.match(await evaluate(`document.querySelector('.connection-label').textContent`),/会話中/);
  assert.equal(await evaluate(`fixtureMessages.some(m=>m.type==='socket-send'&&JSON.parse(m.data).メッセージ識別==='input_audio')`),true,'共通WorkletからPCMを送信する');

  assert.equal(await evaluate(`document.querySelector('.connection-bar').classList.contains('online')`),true);
  await evaluate(`const input=document.querySelector('textarea');input.value='こんにちは';input.dispatchEvent(new Event('input',{bubbles:true}));`);await sleep(50);
  await evaluate(`document.querySelector('form').requestSubmit()`);await sleep(150);
  assert.equal(await evaluate(`document.querySelector('article').textContent`),'Liveテスト回答');
  assert.equal(await evaluate(`document.querySelector('.audio-actions button').getAttribute('aria-pressed')`),'true');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='新しい会話').click()`);await sleep(700);
  assert.equal(await evaluate(`fixtureSession`),2);
  assert.equal(await evaluate(`document.querySelector('.microphone').getAttribute('aria-pressed')`),'true','新しい会話でマイクONを復元');
  assert.equal(await evaluate(`document.querySelectorAll('article').length`),0);
  assert.equal(await evaluate(`!!document.querySelector('.terminal-welcome')`),true);

  assert.match(await evaluate(`document.querySelector('.audio-actions button').textContent`),/ON/);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='切断').click()`);await sleep(100);
  assert.equal(await evaluate(`fixtureMessages.filter(m=>m.type==='socket-close').length`),6);
  assert.equal(await evaluate(`document.querySelector('.audio-actions button').getAttribute('aria-pressed')`),'false');
  // 初期ON、OFFを選んだ状態でのモデル再接続、会話の維持。
  await evaluate(`document.querySelector('.live-connect').click()`);await sleep(350);
  await evaluate(`document.querySelector('.audio-actions button').click()`);await sleep(40);
  await evaluate(`fixtureHold=p=>p.type==='reply';Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='モデル ▾').click()`);await sleep(60);
  assert.equal(await evaluate(`document.querySelector('.apply-model').disabled`),true);
  await evaluate(`fixtureHold=null;fixtureFlush()`);await sleep(60);
  assert.equal(await evaluate(`document.querySelector('.apply-model').disabled`),true); // 変更なし
  await evaluate(`const model=document.querySelectorAll('.model-dialog select')[1];model.value='other-model';model.dispatchEvent(new Event('change',{bubbles:true}));`);await sleep(40);
  assert.equal(await evaluate(`document.querySelector('.apply-model').disabled`),false);
  await capture('nn-audit-live-model.png');
  await evaluate(`document.querySelector('.apply-model').click()`);await sleep(350);
  assert.equal(await evaluate(`document.querySelector('.connection-bar').classList.contains('online')`),true);
  assert.equal(await evaluate(`document.querySelector('.audio-actions button').getAttribute('aria-pressed')`),'false');
  assert.equal(await evaluate(`document.querySelector('.audio-actions .microphone').getAttribute('aria-pressed')`),'false');
  assert.match(await evaluate(`document.querySelector('.model-label').textContent`),/other-model/);
  assert.match(await evaluate(`document.querySelector('article.system').textContent`),/選択したモデル/);
  // 接続中にフォルダが変わったら旧フォルダへの接続を継続しない。
  await evaluate(`document.querySelector('.live-connect').click()`);await sleep(40);
  await evaluate(`fixtureHold=p=>p.type==='reply';document.querySelector('.live-connect').click()`);await sleep(80);
  assert.equal(await evaluate(`document.querySelector('.live-connect').textContent`),'接続中…');
  await evaluate(`fixtureNotify({type:'folder',作業フォルダ:{名前:'next',パス:'/next'}})`);await sleep(60);
  const openedBefore = await evaluate(`fixtureMessages.filter(m=>m.type==='socket-open').length`);
  await evaluate(`fixtureHold=null;fixtureFlush()`);await sleep(100);
  assert.equal(await evaluate(`fixtureMessages.filter(m=>m.type==='socket-open').length`),openedBefore);
  assert.equal(await evaluate(`document.querySelector('.live-connect').textContent`),'接続');
  assert.match(await evaluate(`document.querySelector('.component-toolbar').textContent`),/next/);
  // モデル保存中の停止を、遅れて届いた保存応答で取り消さない。
  await evaluate(`document.querySelector('.live-connect').click()`);await sleep(250);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='モデル ▾').click()`);await sleep(60);
  await evaluate(`const modelForSave=document.querySelectorAll('.model-dialog select')[1];modelForSave.value='test-model';modelForSave.dispatchEvent(new Event('change',{bubbles:true}));fixtureHold=p=>p.type==='reply'`);await sleep(40);
  await evaluate(`document.querySelector('.apply-model').click()`);await sleep(50);
  assert.equal(await evaluate(`document.querySelector('.apply-model').textContent`),'保存中…');
  await evaluate(`fixtureNotify({type:'host-stop'})`);await sleep(50);
  const beforeSaveReply = await evaluate(`fixtureMessages.filter(m=>m.type==='socket-open').length`);
  await evaluate(`fixtureHold=null;fixtureFlush()`);await sleep(80);
  assert.equal(await evaluate(`fixtureMessages.filter(m=>m.type==='socket-open').length`),beforeSaveReply);
  assert.equal(await evaluate(`document.querySelector('dialog')===null`),true);
  assert.equal(await evaluate(`document.querySelector('.live-connect').textContent`),'接続');

  // マイク準備中にホスト停止が届いたら、遅い応答でマイクを再開しない。
  await evaluate(`document.querySelector('.live-connect').click()`);await sleep(300);
  await evaluate(`fixtureHold=p=>p.type==='reply';document.querySelector('.microphone').click()`);await sleep(80);
  assert.equal(await evaluate(`document.querySelector('.microphone').getAttribute('aria-busy')`),'true');
  assert.equal(await evaluate(`document.querySelector('.microphone strong').textContent`),'OFF');
  await evaluate(`fixtureNotify({type:'host-stop'})`);await sleep(60);
  await evaluate(`fixtureHold=null;fixtureFlush()`);await sleep(100);
  assert.equal(await evaluate(`document.querySelector('.microphone').getAttribute('aria-pressed')`),'false');
  assert.equal(await evaluate(`document.querySelector('.microphone').getAttribute('aria-busy')`),'false');
  assert.equal(await evaluate(`document.querySelector('.composer .error')===null`),true,'中断されたマイクの古いエラーを表示しない');
  assert.ok(await evaluate(`fixtureMessages.some(m=>m.type==='mic-stop')`));
  // 音声認識の再編集、連続受信の上限、入力による末尾追従。
  await evaluate(`document.querySelector('.live-connect').click()`);await sleep(250);
  await evaluate(`window.liveInput=fixtureMessages.findLast(m=>m.type==='socket-send'&&JSON.parse(m.data).type==='connect'&&JSON.parse(m.data).ソケット番号==='0').id;
    for(let i=0;i<105;i++)fixtureNotify({type:'socket-data',id:liveInput,data:JSON.stringify({チャンネル:'0',メッセージ識別:'recognition_input',メッセージ内容:'音声認識 '+i})});`);await sleep(100);
  assert.equal(await evaluate(`document.querySelectorAll('article').length`),100);
  await evaluate(`document.querySelector('article:last-child').click()`);await sleep(60);
  assert.equal(await evaluate(`document.querySelector('textarea').value`),'音声認識 104');
  assert.equal(await evaluate(`document.querySelector('textarea').selectionStart`),'音声認識 104'.length);
  await evaluate(`document.querySelector('.conversation').scrollTop=0;const followInput=document.querySelector('textarea');followInput.value+='追記';followInput.dispatchEvent(new Event('input',{bubbles:true}));`);await sleep(60);
  assert.equal(await evaluate(`(()=>{const e=document.querySelector('.conversation');return Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop)<2})()`),true);
  await evaluate(`fixtureNotify({type:'socket-data',id:liveInput,data:JSON.stringify({チャンネル:'0',メッセージ識別:'output_text',メッセージ内容:'!'})})`);await sleep(40);
  assert.match(await evaluate(`document.querySelector('.composer .error').textContent`),/送信できません/);
  await evaluate(`document.querySelector('form').requestSubmit()`);await sleep(60);
  assert.equal(await evaluate(`document.querySelector('.composer .error')===null`),true,'再送したら前の送信エラーを消す');
  await capture('nn-audit-live-controls.png');
  // マイク一時停止はセッションを閉じず、モデル保存失敗も会話を保つ。
  await evaluate(`document.querySelector('.microphone').click()`);await sleep(350);
  await evaluate(`fixtureNotify({type:'mic-paused'})`);await sleep(80);
  assert.equal(await evaluate(`document.querySelector('.microphone').getAttribute('aria-pressed')`),'false');
  assert.equal(await evaluate(`document.querySelector('.live-connect').textContent`),'切断');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='モデル ▾').click()`);await sleep(70);
  await evaluate(`const voiceForSave=document.querySelectorAll('dialog select')[2];voiceForSave.value='Puck';voiceForSave.dispatchEvent(new Event('change',{bubbles:true}));fixtureSaveError='保存の試験エラー'`);await sleep(40);
  const sessionBeforeVoice = await evaluate(`fixtureSession`);
  const historyBeforeVoice = await evaluate(`document.querySelectorAll('article').length`);
  await evaluate(`document.querySelector('.apply-model').click()`);await sleep(70);
  assert.match(await evaluate(`document.querySelector('dialog .error').textContent`),/保存の試験エラー/);
  assert.equal(await evaluate(`fixtureSession`),sessionBeforeVoice);
  assert.equal(await evaluate(`document.querySelectorAll('article').length`),historyBeforeVoice);
  // 音声だけ変更し、APIを遅延させて再接続中の表示と操作ロックを確認する。
  await evaluate(`fixtureSaveError=null;fixtureHold=p=>p.type==='reply'&&p.value?.status==='OK';document.querySelector('.apply-model').click()`);await sleep(80);
  assert.equal(await evaluate(`document.querySelector('.connection-label').textContent.trim()`),'再接続中');
  assert.equal(await evaluate(`document.querySelector('.apply-model').textContent`),'再接続中…');
  assert.equal(await evaluate(`document.querySelector('.picker-close').disabled`),true);
  await evaluate(`fixtureHold=null;fixtureFlush()`);await sleep(350);
  assert.equal(await evaluate(`fixtureSession`),sessionBeforeVoice+1);
  assert.equal(await evaluate(`JSON.parse(fixtureMessages.findLast(m=>m.type==='socket-send'&&JSON.parse(m.data).type==='connect').data).モデル設定.LIVE_FREEAI_VOICE`),'Puck');
  assert.equal(await evaluate(`document.querySelector('.microphone').getAttribute('aria-pressed')`),'false');
  assert.ok(await evaluate(`document.querySelectorAll('article').length`)>=historyBeforeVoice);
  // モデル変更後の再接続が失敗しても、表示済みの会話と未送信の下書きを失わない。
  await evaluate(`const draft=document.querySelector('.composer textarea');draft.value='再接続失敗後も残す下書き';draft.dispatchEvent(new Event('input',{bubbles:true}));Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='モデル ▾').click()`);await sleep(70);
  const historyBeforeReconnectFailure = await evaluate(`[...document.querySelectorAll('.live-conversation article')].map(item=>({role:item.classList.contains('user')?'user':item.classList.contains('system')?'system':'assistant',text:item.textContent}))`);
  assert.ok(historyBeforeReconnectFailure.length>0);
  await evaluate(`const nextModel=document.querySelectorAll('dialog select')[1];nextModel.value=nextModel.value==='test-model'?'other-model':'test-model';nextModel.dispatchEvent(new Event('change',{bubbles:true}));fixtureApiError='モデル再接続の試験エラー'`);await sleep(40);
  await evaluate(`document.querySelector('.apply-model').click()`);await sleep(150);
  assert.equal(await evaluate(`document.querySelector('.live-connect').textContent`),'接続');
  assert.equal(await evaluate(`document.querySelector('.live-connect').disabled`),false);
  assert.equal(await evaluate(`document.querySelector('.microphone').getAttribute('aria-pressed')`),'false');
  assert.equal(await evaluate(`document.querySelector('.composer textarea').value`),'再接続失敗後も残す下書き');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.live-conversation article')].map(item=>({role:item.classList.contains('user')?'user':item.classList.contains('system')?'system':'assistant',text:item.textContent}))`),historyBeforeReconnectFailure);
  assert.equal(await evaluate(`!!document.querySelector('.terminal-welcome')`),false);
  assert.match(await evaluate(`document.querySelector('.composer .error').textContent`),/モデル再接続の試験エラー/);
  await capture('nn-audit-live-reconnect-failure.png');
  // 「新しい会話」では明示どおり履歴と下書きを消し、その後は通常どおり再試行できる。
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='新しい会話').click();fixtureApiError=null;document.querySelector('.live-connect').click()`);await sleep(300);
  assert.equal(await evaluate(`document.querySelector('.composer textarea').value`),'');
  assert.equal(await evaluate(`document.querySelector('.live-connect').textContent`),'切断');
  // 新しい会話の再接続失敗は初期画面を保持する。
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='新しい会話').click();fixtureApiError='接続の試験エラー'`);await sleep(150);
  assert.equal(await evaluate(`document.querySelector('.live-connect').textContent`),'接続');
  assert.equal(await evaluate(`document.querySelectorAll('article').length`),0);
  assert.equal(await evaluate(`!!document.querySelector('.terminal-welcome')`),true);
  assert.match(await evaluate(`document.querySelector('.composer .error').textContent`),/接続の試験エラー/);
  await evaluate(`fixtureApiError=null;document.querySelector('.live-connect').click()`);await sleep(300);
  assert.equal(await evaluate(`document.querySelector('.live-connect').textContent`),'切断');
  assert.deepEqual(errors,[]);
  console.log('Vue Code / Live: 送信・履歴確認・モデル候補・遅延応答・接続中フォルダ変更・保存中停止・音声Worklet・マイク中断・新規会話引継ぎ・音声変更・保存失敗・モデル再接続失敗時の会話と下書き保持を確認');
  ws.close();
} finally {
  chrome.kill();
  await app.close();
  await sleep(300);
  if (!resolve(profile).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('一時パスが不正です');
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome が掴んでいれば残す */ }
}
