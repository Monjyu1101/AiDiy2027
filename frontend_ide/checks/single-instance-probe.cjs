// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {app,BrowserWindow,screen}=require('electron');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const {windowBounds}=require('../デスクトップ/window-layout.cjs');
function assertBounds(actual,expected){for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<=2,`${key}: ${actual[key]} / ${expected[key]}`);}
app.setPath('appData',process.env.AIDIY_TEST_PROFILE);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.on('browser-window-created',(_event,window)=>{
 if(process.env.AIDIY_SECONDARY){process.send?.({unexpectedWindow:true});return;}
 window.webContents.once('did-finish-load',async()=>{
  if(window.webContents.getURL()!==process.env.AIDIY_DEVELOPMENT_URL)return;
  try{
   await sleep(1800);
   assert.equal(window.isVisible(),true,'最初の起動で画面が表示される');
   const kind=process.env.AIDIY_DEVELOPMENT_KIND;
   assertBounds(window.getBounds(),windowBounds(kind,screen.getDisplayMatching(window.getBounds()).workArea));
   const original=window.webContents.getURL();
   window.minimize();await sleep(300);
   const secondary=spawn(process.execPath,[__filename],{env:{...process.env,AIDIY_SECONDARY:'1'},windowsHide:false,stdio:['ignore','inherit','inherit','ipc']});
   let reused=false,unexpected=false;
   secondary.on('message',message=>{reused||=message.existingWindow===true;unexpected||=message.unexpectedWindow===true;});
   const code=await new Promise((resolve,reject)=>{secondary.once('exit',resolve);secondary.once('error',reject);});
   assert.equal(code,0);assert.equal(reused,true);assert.equal(unexpected,false);
   for(let i=0;i<50&&(!window.isFocused()||window.isMinimized());i++)await sleep(100);
   assert.equal(window.isMinimized(),false);assert.equal(window.isFocused(),true);
   assert.equal(window.webContents.getURL(),original);assert.equal(BrowserWindow.getAllWindows().length,1);
   console.log('SINGLE INSTANCE PASS: '+kind);app.quit();
  }catch(error){console.error(error);app.exit(1);}
 });
});
require('../desktop.cjs');
setTimeout(()=>app.exit(2),15000).unref();
