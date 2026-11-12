// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Coreのローカル試験用アカウントでログインし、業務データを変更せず窓の寿命を確認する。
const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
app.setPath('appData', process.env.AIDIY_TEST_PROFILE);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (w, source) => w.webContents.executeJavaScript(source, true);
async function until(check, label, attempts=250) { for(let i=0;i<attempts;i++){try{if(await check())return;}catch{}await sleep(100);}throw Error('Task実機確認期限: '+label); }
// 表示アニメーション用の一時窓は主画面数へ含めない。
const peers = () => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.webContents.getURL().startsWith(process.env.AIDIY_DEVELOPMENT_URL));
const view = name => peers().find(w => w.webContents.getURL().endsWith('#task-view='+name));
const ready = w => until(() => evaluate(w, `!!document.querySelector('.taskteam-content')&&!document.documentElement.classList.contains('desktop-opening')`), '画面準備');
let running=false,shown=false;
const send=process.send.bind(process);process.send=(message,...args)=>{if(message?.windowShown)shown=true;return send(message,...args);};
app.on('browser-window-created',(_,owner)=>{
 if(running)return;running=true;
 owner.webContents.once('did-finish-load',async()=>{
  try{
   await until(()=>evaluate(owner,`!!document.querySelector('.taskteam-login button:not(:disabled)')`),'初期ログイン');
   await until(()=>shown,'起動完了通知');
   assert.equal(peers().length,1,JSON.stringify(peers().map(w=>({title:w.getTitle(),url:w.webContents.getURL()}))));
   assert.equal(await evaluate(owner,`document.querySelector('.panel-brand strong')?.textContent`),'AiDiy TASK');
   await evaluate(owner,`document.querySelector('.taskteam-login').requestSubmit()`);
   await ready(owner);assert.equal(peers().length,1,'ログイン後もメインのみ');
   await evaluate(owner,`for(const caption of ['フロー図','明細'])Array.from(document.querySelectorAll('.component-toolbar button')).find(b=>b.textContent===caption).click()`);
   await until(()=>peers().length===3,'明示操作後3窓');
   for(const w of peers())await ready(w);
   console.log('Task: 実Core認証・初期メインのみ・明示操作で3窓表示 OK');
   if(process.env.AIDIY_TEST_CONNECTION_INTERRUPT==='1'){
    const allStatus=async text=>(await Promise.all(peers().map(w=>evaluate(w,`document.body.textContent.includes(${JSON.stringify(text)})`)))).every(Boolean);
    await until(()=>allStatus('接続済'),'3窓接続');
    console.log('TASK_CONNECTION_READY: TaskTeamを停止してください');
    await until(()=>allStatus('未接続'),'3窓切断',1800);
    console.log('TASK_CONNECTION_OFFLINE: TaskTeamを再起動してください');
    await until(()=>allStatus('接続済'),'3窓再接続',1800);
    console.log('Task: 3窓同時の実サービス切断・復帰 OK');
   }
   for(const name of ['request','flow','detail']){
    const target=view(name);target.close();await until(()=>!view(name),'個別終了');
    const survivor=peers()[0];
    const caption={request:'要求',flow:'フロー図',detail:'明細'}[name];
    await until(()=>evaluate(survivor,`Array.from(document.querySelectorAll('.component-toolbar button')).some(b=>b.textContent===${JSON.stringify(caption)})`),'再表示ボタン');
    await evaluate(survivor,`{const b=Array.from(document.querySelectorAll('.component-toolbar button')).find(b=>b.textContent===${JSON.stringify(caption)});b.click();b.click();}`);
    await until(()=>!!view(name),'再表示');await ready(view(name));
    assert.equal(peers().length,3,JSON.stringify(peers().map(w=>({title:w.getTitle(),url:w.webContents.getURL()}))));
   }
   console.log('Task: 要求・フロー図・明細の個別終了／再表示・連打重複防止 OK');
   view('request').close();await until(()=>!view('request'),'要求終了');
   await evaluate(view('flow'),`Array.from(document.querySelectorAll('.component-toolbar button')).find(b=>b.textContent==='ログアウト').click()`);
   await until(()=>peers().length===1&&!!view('request'),'主画面再作成');
   const primary=view('request');
   await until(()=>evaluate(primary,`!!document.querySelector('.taskteam-login button:not(:disabled)')`),'ログアウト後ログイン');
   assert.equal(await evaluate(primary,`Object.keys(localStorage).some(k=>/password|token/i.test(k))`),false);
   await evaluate(primary,`document.querySelector('.taskteam-login').requestSubmit()`);
   await ready(primary);assert.equal(peers().length,1,'再ログイン後もメインのみ');
   await evaluate(primary,`for(const caption of ['フロー図','明細'])Array.from(document.querySelectorAll('.component-toolbar button')).find(b=>b.textContent===caption).click()`);
   await until(()=>peers().length===3,'再表示後3窓');for(const w of peers())await ready(w);
   console.log('Task: 主画面なしのログアウト・主画面復元・再ログイン OK');
   const dir=join(__dirname,'../../temp/task-check');mkdirSync(dir,{recursive:true});
   for(const name of ['request','flow','detail'])writeFileSync(join(dir,`task-${name}.png`),(await view(name).webContents.capturePage()).toPNG());
   process.send?.({testPassed:true});
   for(const name of ['detail','request','flow']){view(name).close();await sleep(150);}
  }catch(error){console.error(error);app.exit(1);}
 });
});
setTimeout(()=>{console.error('Task全体確認期限');app.exit(1);},process.env.AIDIY_TEST_CONNECTION_INTERRUPT==='1'?480000:120000).unref();
require('../desktop.cjs');
