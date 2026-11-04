// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 本番Vue / preload / Electronで表示・操作だけを検証し、Bot workerは合成する。
const assert=require('node:assert/strict'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {readFileSync}=require('node:fs');
const {createRequire}=require('node:module');
const path=require('node:path');
const electron=require('electron'),{app,BrowserWindow}=electron;
const {holdMove,holdUnmoved,checkNativeControls,until}=require('../../frontend_ide/checks/window-move-probe.cjs');
app.setPath('appData',process.env.DISCORD_WINDOW_PROFILE);app.disableHardwareAcceleration();
delete process.env.AIDIY_DISCORD_CONNECT;delete process.env.AIDIY_DISCORD_READY;
const show=BrowserWindow.prototype.showInactive,opacity=BrowserWindow.prototype.setOpacity;
BrowserWindow.prototype.show=BrowserWindow.prototype.showInactive=function(){if(!this.isAiDiyOpeningCanvas){this.setIgnoreMouseEvents(true);this.setSkipTaskbar(true);}show.call(this);};
BrowserWindow.prototype.focus=function(){};BrowserWindow.prototype.setOpacity=function(value){opacity.call(this,this.isAiDiyOpeningCanvas?value:.01);};
const requests=[],worker=Object.assign(new EventEmitter(),{connected:true,exitCode:null,signalCode:null,send(message,callback){
 requests.push(message.action);callback?.();
 queueMicrotask(()=>worker.emit('message',{id:message.id,result:message.action==='initial'?{settings:{},models:{},voices:{},features:{live:false,code:true},code:{provider:'openai_oauth',model:'fixture-model'},folder:{name:'検証',path:'fixture'},state:{phase:'idle'}}:{providers:[{id:'openai_oauth',label:'OpenAI fixture'}],models:[{id:'fixture-model',label:'Fixture'}]}}));
}});
let openings=0;
async function inspect(window){
 try{
  assert.equal(openings,1);await until(()=>window.webContents.executeJavaScript("!!document.querySelector('#code-model:not(:disabled)')"),'Discord読込');
  assert.equal(BrowserWindow.getAllWindows().length,1,'演出用の透明パネルを回収');
  assert.equal(window.isAlwaysOnTop(),false);
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#pin').getAttribute('aria-pressed')"),'false');
  await window.webContents.executeJavaScript("document.querySelector('#pin').click()");
  await until(()=>window.isAlwaysOnTop()&&window.webContents.executeJavaScript("document.querySelector('#pin').getAttribute('aria-pressed')==='true'"),'Discordピン ON');
  await window.webContents.executeJavaScript("document.querySelector('#pin').click()");
  await until(()=>!window.isAlwaysOnTop()&&window.webContents.executeJavaScript("document.querySelector('#pin').getAttribute('aria-pressed')==='false'"),'Discordピン OFF');
  const results=[await holdMove(window,window.webContents,'.hint','Discord_背景'),await holdUnmoved(window,window.webContents,'#code-model','Discord_モデル入力'),await checkNativeControls(window,window.webContents,'Discord')];
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#code-model').value`),'fixture-model','保持・入力確認で保存済みモデルを変えない');
  assert.ok(requests.every(action=>['initial','catalog-code'].includes(action)),'Botの起動・接続・設定変更をしない');
  process.send({testPassed:true,openingCount:openings,initialPin:false,pinRoundTrip:true,results},()=>app.exit(0));
 }catch(error){console.error(error);app.exit(1);}
}
const filename=path.resolve(__dirname,'../panel/desktop.cjs'),load=createRequire(filename);
vm.runInNewContext(readFileSync(filename,'utf8'),{__dirname:path.dirname(filename),process,console,setTimeout,clearTimeout,
 require:id=>id==='electron'?electron:id==='node:child_process'?{fork:()=>worker,spawn:()=>{throw Error('unexpected spawn');}}
 :id.endsWith('single-instance.cjs')?{起動ロック:async()=>({close:async()=>{}})}
 :id.endsWith('window-opening.cjs')?{拡大表示:async(Constructor,window,options)=>{openings++;const before=window.getBounds();const shown=await load(id).拡大表示(Constructor,window,options);assert.deepEqual(window.getBounds(),before);setTimeout(()=>inspect(window),200);return shown;}}:load(id)});
setTimeout(()=>app.exit(1),30000).unref();
