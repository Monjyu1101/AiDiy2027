// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実行出力の全WindowRoleを実Electronで検査する。本文だけ合成し、AI・音声・認証へ接続しない。
'use strict';
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createRequire}=require('node:module');
const path=require('node:path');
const vm=require('node:vm');
const electron=require('electron');
const {app,BrowserWindow}=electron;
const {holdMove,checkNativeControls,probeBackground,until}=require('../../frontend_ide/checks/window-move-probe.cjs');
app.setPath('userData',process.env.AVATAR_MOVE_PROFILE);
app.setPath('sessionData',process.env.AVATAR_MOVE_PROFILE);
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const created=[],openings=[];
const html='<!doctype html><html style="height:100%;background:transparent"><body style="margin:0;min-height:100%;background:#152238;color:white"><button id="action" onclick="window.clicks=(window.clicks||0)+1">クリック確認</button><textarea id="text">文字選択の確認</textarea></body></html>';
const fixtureUrl='data:text/html;charset=utf-8,'+encodeURIComponent(html);
function TestWindow(options){
 const window=new BrowserWindow({...options,show:false,webPreferences:{...options.webPreferences,preload:undefined}});
 // 演出用の透明窓は本番のまま測る。クリック透過・1%不透明度を適用するとWindowsで白くなる。
 if(!options.webPreferences?.preload)return window;
 const opacity=window.setOpacity.bind(window);window.setOpacity=()=>opacity(.01);
 window.setOpacity(.01);window.setIgnoreMouseEvents(true);window.setSkipTaskbar(true);
 const load=window.loadURL.bind(window);
 window.show=()=>window.showInactive();window.focus=()=>{};
 if(options.webPreferences?.preload){window.loadURL=url=>{window.probeRole=new URL(url).searchParams.get('role');return load(fixtureUrl);};created.push(window);}
 return window;
}
TestWindow.getAllWindows=()=>BrowserWindow.getAllWindows();
app.whenReady().then(async()=>{
 try{
  const filename=path.resolve(__dirname,'../dist-electron/main.js'),load=createRequire(filename);
  const context={__dirname:path.dirname(filename),exports:{},console,process,URL,setTimeout,clearTimeout,
   require:id=>id==='electron'?{...electron,BrowserWindow:TestWindow,app:{getAppPath:()=>path.resolve(__dirname,'..'),requestSingleInstanceLock:()=>true,whenReady:()=>({then(){}}),on(){},setName(){}}}:id.endsWith('window-opening.cjs')?{拡大表示:async(Constructor,window,options)=>{assert.equal(window.isVisible(),false);openings.push(window);const before=window.getBounds();const result=await load(id).拡大表示(Constructor,window,options);assert.deepEqual(window.getBounds(),before);return result;}}:load(id)};
  vm.runInNewContext(readFileSync(filename,'utf8')+'\nglobalThis.probe={createBaseWindow,openSettingsWindow,ウィンドウ表示,LOGIN_BOUNDS,CORE_BOUNDS,PANEL_BOUNDS,windowRoles};',context);
  const f=context.probe,results=[];
  const roles=[['login',f.LOGIN_BOUNDS],['core',f.CORE_BOUNDS],...Object.entries(f.PANEL_BOUNDS),['settings']];
  for(const [role,bounds]of roles){
   const count=created.length;
   if(role==='settings')f.openSettingsWindow('probe-session');
   else f.createBaseWindow(bounds,role,false);
   assert.equal(created.length,count+1);const window=created.at(-1),contents=window.webContents;
   assert.equal(f.windowRoles.get(window.id),role);assert.equal(window.probeRole,role);
   await until(()=>!contents.isLoading()&&contents.executeJavaScript("!!document.querySelector('#action')"),role+'読込');
   // 全12種類とも本番の生成関数・共通移動処理・実OS座標を使う。
   assert.equal(await f.ウィンドウ表示(window),true);
   assert.equal(openings.filter(item=>item===window).length,1,role+'表示開始の実ズーム');
   await f.ウィンドウ表示(window);assert.equal(openings.filter(item=>item===window).length,1,role+'表示中はズームを重ねない');
   const background=await probeBackground(contents);
   results.push(await holdMove(window,contents,background,'Avatar_'+role,role==='settings'?'blur':'release'));
   const controls=await checkNativeControls(window,contents,'Avatar_'+role);
   results.at(-1).controls=controls;
   assert.equal(await contents.executeJavaScript('window.clicks||0'),0);
   assert.equal(await contents.executeJavaScript(`document.querySelector('#text').value`),'文字選択の確認','既存入力を変更しない');
   if(role==='settings'){f.openSettingsWindow('probe-session-2');assert.equal(created.length,count+1);}
   window.destroy();assert.equal(contents.listenerCount('before-mouse-event'),0);
  }
  assert.equal(results.length,12);process.send({testPassed:true,roles:roles.map(([role])=>role),openingCount:openings.length,results},()=>app.exit(0));
 }catch(error){console.error(error);app.exit(1);}
});
setTimeout(()=>app.exit(1),90000).unref();
