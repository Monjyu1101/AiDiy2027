// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const assert=require('node:assert/strict');
const {app,BrowserWindow,screen}=require('electron');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {checkNavigationDimensions}=require('./navigation-dimensions-probe.cjs');
const {holdUnmoved,holdMove,shortClick,checkNativeControls,probeBackground}=require('./window-move-probe.cjs');
app.setPath('appData',process.env.AIDIY_TEST_PROFILE);
const showInactive=BrowserWindow.prototype.showInactive;
// 専用プロファイルを非アクティブ表示し実ElectronのDOM/IPC/配置/終了を検証する。
BrowserWindow.prototype.show=function(){showInactive.call(this);};BrowserWindow.prototype.focus=function(){};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=(window,source)=>window.webContents.executeJavaScript(source,true).catch(error=>{throw Error('Expression: '+source+'\n'+error.message);});
async function until(check,label){for(let i=0;i<300;i++){if(await check())return;await sleep(100);}throw Error('Electron確認タイムアウト: '+label);}
let running=false;
app.on('browser-window-created',(_,window)=>{if(running)return;running=true;window.webContents.once('did-finish-load',async()=>{try{
 await until(()=>evaluate(window,`!!document.querySelector('.navigation-panel.standalone textarea')`),'Navigation');
 assert.equal(window.getTitle(),'AiDiy Navigator');
 const initialArea=screen.getDisplayMatching(window.getBounds()).workArea;
  assert.ok(Math.abs(window.getBounds().width-Math.min(480,initialArea.width-16))<=2&&Math.abs(window.getBounds().height-Math.min(800,initialArea.height-16))<=2,'初期480×800 DIP、小画面は縮小（Windows丸め2 DIP以内）');
 const bounds=window.getBounds(),area=screen.getDisplayMatching(bounds).workArea;
 assert.ok(Math.abs(bounds.x-area.x-8)<=2&&Math.abs(bounds.y+bounds.height/2-area.y-area.height/2)<=2,'単独Navigatorは作業領域の左中央');
 console.log('Navigator initial bounds',JSON.stringify(window.getBounds()));
 assert.equal(await evaluate(window,`document.title`),'AiDiy Navigator');
 assert.ok(await evaluate(window,`document.querySelector('.navigation-project').textContent.includes('プロジェクト:')`));
 assert.equal(await evaluate(window,`(()=>{const outer=getComputedStyle(document.querySelector('.development-app.navi')),inner=getComputedStyle(document.querySelector('.navigation-panel.standalone'));return ['Left','Right','Top','Bottom'].every(side=>{const size=parseFloat(outer['border'+side+'Width']);return size>0&&size<=1&&parseFloat(inner['border'+side+'Width'])===0;});})()`),true);
 await checkNavigationDimensions(window,'standalone');
 if(process.env.AIDIY_TEST_NAVIGATION_DIMENSIONS_ONLY==='1'){
  process.send?.({testPassed:true,scope:'navigation dimensions and titlebar only',results:['standalone native Navigator: initial bounds, DPI, DOM titlebar and controls'],skipped:['window dragging','shared model dialog']});app.exit(0);return;
 }
 const out=join(__dirname,'../../temp/navigation-titlebar-check');mkdirSync(out,{recursive:true});window.webContents.setBackgroundThrottling(false);await until(()=>evaluate(window,`!document.documentElement.classList.contains('desktop-opening')`),'opening complete');await new Promise(r=>setTimeout(r,22000));writeFileSync(join(out,'standalone.png'),(await window.webContents.capturePage()).toPNG());
 const moveResults=[];
 for(const ending of ['release','escape'])moveResults.push(await holdMove(window,window.webContents,'.navigation-display','Navigator背景_'+ending,ending));
 await evaluate(window,`(()=>{const panel=document.querySelector('.navigation-panel');const fixture=document.createElement('div');fixture.id='navi-move-fixture';fixture.style='position:fixed;top:45%;left:10%;width:70%;z-index:20;background:#222';fixture.innerHTML='<ol class="navigation-items"><li><details><summary>タスクの試験</summary><p>詳細</p></details></li></ol><section class="navigation-overall"><details><summary>総合評価の試験</summary><p>詳細</p></details></section>';panel.append(fixture);})()`);
 for(const [selector,label] of [['#navi-move-fixture .navigation-items summary','タスク'],['#navi-move-fixture .navigation-overall summary','総合評価']]){
  await shortClick(window.webContents,selector);assert.equal(await evaluate(window,`document.querySelector(${JSON.stringify(selector)}).parentElement.open`),true,label+'短押しで開く');
  await shortClick(window.webContents,selector);assert.equal(await evaluate(window,`document.querySelector(${JSON.stringify(selector)}).parentElement.open`),false,label+'短押しで閉じる');
  moveResults.push(await holdMove(window,window.webContents,selector,'Navigator'+label+'_長押し'));
  assert.equal(await evaluate(window,`document.querySelector(${JSON.stringify(selector)}).parentElement.open`),false,label+'長押し移動では開閉しない');
 }
 await evaluate(window,`document.querySelector('#navi-move-fixture').remove()`);
 moveResults.push(await holdUnmoved(window,window.webContents,'textarea','Navigator目標入力'));
 writeFileSync(join(out,'move-result.json'),JSON.stringify({testPassed:true,input:'Electron sendInputEvent; cursor/focus fixture; actual OS window bounds',results:moveResults},null,2));
 writeFileSync(join(out,'standalone-moved.png'),(await window.webContents.capturePage()).toPNG());
 await evaluate(window,`document.querySelector('.navigation-model-line button').click()`);
 await until(()=>evaluate(window,`!!document.querySelector('.navigation-model-picker')`),'モデル選択');
 process.send?.({testPassed:true,results:['standalone native title','project display','shared model dialog','no AI calls']});app.exit(0);
}catch(error){console.error(error);app.exit(1);}});});
setTimeout(()=>app.exit(1),45000).unref();require('../desktop.cjs');
