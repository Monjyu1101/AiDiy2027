// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const assert=require('node:assert/strict');
const {app,BrowserWindow,screen}=require('electron');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {holdUnmoved,holdMove,shortClick,checkNativeControls,probeBackground}=require('./window-move-probe.cjs');
app.setPath('appData',process.env.AIDIY_TEST_PROFILE);
const showInactive=BrowserWindow.prototype.showInactive;
// 専用プロファイルを非アクティブ表示し実ElectronのDOM/IPC/配置/終了を検証する。
BrowserWindow.prototype.show=function(){showInactive.call(this);};BrowserWindow.prototype.focus=function(){};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=(window,source)=>window.webContents.executeJavaScript(source,true).catch(error=>{throw Error('Expression: '+source+'\n'+error.message);});
async function until(check,label){for(let i=0;i<300;i++){if(await check())return;await sleep(100);}throw Error('Electron確認タイムアウト: '+label);}
const output=join(__dirname,'../../temp/panel-pin-check');mkdirSync(output,{recursive:true});
const results=[];let running=false;
app.on('browser-window-created',(_,owner)=>{
 owner.webContents.setBackgroundThrottling(false);if(running)return;running=true;
 owner.webContents.once('did-finish-load',async()=>{try{
  await until(()=>evaluate(owner,`!!document.querySelector('.component-toolbar')&&!document.documentElement.classList.contains('desktop-opening')`),'起動');
  await evaluate(owner,`[...document.querySelectorAll('button')].find(b=>b.textContent==='オフライン利用').click()`);
  await until(()=>evaluate(owner,`!!window.aidiyIDE`),'IDE');
  await evaluate(owner,`aidiyIDE.setAutoSpin(false);window.navigationFlash=[];window.navigationFlashObserver=new MutationObserver(()=>{for(const n of document.querySelectorAll('.navigation-panel'))if(getComputedStyle(n).visibility!=='hidden'&&getComputedStyle(n).display!=='none')navigationFlash.push('visible');});navigationFlashObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});document.querySelector('.navigation-launch').click()`);
  const children=()=>BrowserWindow.getAllWindows().filter(w=>w!==owner&&!w.isDestroyed()&&w.getTitle().includes('Navigator '));
  await until(()=>children().length===1,'Navi 1');const first=children()[0];
  await until(()=>evaluate(first,`!!document.querySelector('textarea')`),'Navi 1 DOM');
  await until(()=>evaluate(first,`getComputedStyle(document.querySelector('.navigation-panel')).visibility==='visible'`),'Navi 1 visible');
  assert.deepEqual(await evaluate(owner,`navigationFlashObserver.disconnect();navigationFlash`),[],'別窓の準備中にIDE内へNavigatorを表示しない');
  const initialArea=screen.getDisplayMatching(first.getBounds()).workArea;
  assert.ok(Math.abs(first.getBounds().width-Math.min(480,initialArea.width-16))<=2&&Math.abs(first.getBounds().height-Math.min(800,initialArea.height-16))<=2,'初期480×800 DIP、小画面は縮小（Windows丸め2px以内）');
  const area=screen.getDisplayMatching(first.getBounds()).workArea,bounds=first.getBounds();
  assert.ok(Math.abs(bounds.x-area.x-8)<=2&&Math.abs(bounds.y+bounds.height/2-area.y-area.height/2)<=2,'Navigatorは作業領域の左中央');
 console.log('Navigator initial bounds',JSON.stringify(first.getBounds()));
  first.setSize(540,640);
  await evaluate(first,`(()=>{const t=document.querySelector('textarea');t.value='第一の目標';t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(owner,`document.querySelector('.navigation-launch').click()`);
  await until(()=>children().length===2,'Navi 2');const second=children().find(w=>w!==first);assert.equal(first.getTitle(),'AiDiy IDE / Navigator 1');assert.equal(second.getTitle(),'AiDiy IDE / Navigator 2');
  await until(()=>evaluate(second,`!!document.querySelector('textarea')`),'Navi 2 DOM');
  await until(()=>evaluate(second,`getComputedStyle(document.querySelector('.navigation-panel')).visibility==='visible'`),'Navi 2 visible');
 const bar=await evaluate(second,`(()=>{const h=document.querySelector('.panel-brand'),a=h.querySelector('.window-actions');return {height:h.getBoundingClientRect().height,display:getComputedStyle(h).display,right:h.getBoundingClientRect().right-a.getBoundingClientRect().right}})()`);
 assert.equal(bar.height,31);assert.equal(bar.display,'grid');assert.ok(bar.right<=4);console.log('Titlebar',JSON.stringify(bar));
  assert.equal(await evaluate(second,`document.querySelector('textarea').value.startsWith('最近更新したファイル')`),true);
  await evaluate(second,`(()=>{const t=document.querySelector('textarea');t.value='第二の目標';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.navigation-model-line button').click();})()`);
  assert.ok(await evaluate(second,`document.querySelector('.model-dialog').open`));
  assert.ok(await evaluate(second,`document.querySelector('.navigation-project').textContent.includes('プロジェクト:')`));
  writeFileSync(join(output,'navigation-model-dialog.png'),(await second.webContents.capturePage()).toPNG());
  await evaluate(second,`(()=>{const input=document.querySelector('.navigation-model-choice');input.value='auto';input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.navigation-model-picker').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`);
  await until(()=>evaluate(second,`document.querySelector('.navigation-model-line>span').textContent.includes('auto')`),'Navi 2 model');
  assert.ok(await evaluate(first,`document.querySelector('.navigation-model-line>span').textContent.includes('aidiy_hermes')`));
  assert.equal(await evaluate(first,`document.querySelector('textarea').value`),'第一の目標');
  assert.equal(await evaluate(owner,`document.querySelectorAll('.navigation-toggle').length`),0);
  writeFileSync(join(output,'navigation-independent-1.png'),(await first.webContents.capturePage()).toPNG());
  writeFileSync(join(output,'navigation-independent-2.png'),(await second.webContents.capturePage()).toPNG());
  await evaluate(owner,`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='VR').click()`);
  await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-restore-button').disabled`),'VR');
  assert.equal(children().length,2);
  await evaluate(owner,`document.querySelector('.all-restore-button').click()`);
  await until(()=>evaluate(owner,`!document.querySelector('.all-restore-button')`),'VR復帰');
  assert.equal(children().length,2);
  assert.ok(Math.abs(first.getBounds().width-540)<=2&&Math.abs(first.getBounds().height-640)<=2,'手動サイズをVR復帰後も保持');
  await evaluate(first,`document.querySelector('.window-close').click()`);
  await until(()=>first.isDestroyed(),'Navi 1 close');
  assert.equal(await evaluate(second,`document.querySelector('textarea').value`),'第二の目標');
  await evaluate(second,`document.querySelector('.window-close').click()`);
  await until(()=>second.isDestroyed(),'Navi 2 close');
  process.send?.({testPassed:true,results:['two independent native Navi windows','goal/model isolation','VR return preserves both windows','closing one preserves the other','no Explorer split/burger']});app.exit(0);
 }catch(e){console.error(e);console.error(await evaluate(owner,'document.body.innerText').catch(()=>''));app.exit(1);}});
});
setTimeout(()=>{console.error('Navigation期限');app.exit(1);},100000).unref();require('../desktop.cjs');
