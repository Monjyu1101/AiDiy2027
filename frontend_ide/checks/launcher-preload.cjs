// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 起動コマンドを変更せず、テスト専用プロファイルの実ウィンドウだけを観測する。
if(process.versions.electron&&process.type==='browser')process.nextTick(()=>{
 const {app,BrowserWindow,dialog,screen}=require('electron');
 // ランチャー検証の終了操作は承認する。取消の分岐はcore-stop-probeで検証する。
 dialog.showMessageBox=async()=>({response:0});
 const {existsSync,writeFileSync}=require('node:fs');
 const {join}=require('node:path');
 const folder=process.env.AIDIY_LAUNCH_TEST;
 app.setPath('appData',join(folder,'profile'));
 app.on('browser-window-created',(_event,window)=>{
  window.webContents.once('did-finish-load',()=>{
   if(window.webContents.getURL()!==process.env.AIDIY_DEVELOPMENT_URL)return;
   let childRequested=false;
   const timer=setInterval(async()=>{
    if(existsSync(join(folder,'close'))){clearInterval(timer);void window.webContents.executeJavaScript('window.aidiyWindow.close()');}
    else if(!childRequested&&existsSync(join(folder,'open-child'))){
     childRequested=true;
     try{
      const result=await window.webContents.executeJavaScript(`(async()=>{await fetch('/api/connection/offline',{method:'POST'});return window.aidiyWindow.openApp('code');})()`);
      if(!result.ok)throw Error(result.error);
      const children=BrowserWindow.getAllWindows().filter(child=>child!==window&&child.webContents.getURL().startsWith('http://127.0.0.1:')).map(child=>child.webContents.getURL());
      writeFileSync(join(folder,'children.json'),JSON.stringify({children}));
     }catch(error){writeFileSync(join(folder,'children.json'),JSON.stringify({error:error.message}));}
    }
   },100);
   window.once('closed',()=>clearInterval(timer));
   const captureReady=async()=>{
    if(window.isDestroyed())return;
    if(!window.isVisible()||await window.webContents.executeJavaScript(`document.documentElement.classList.contains('desktop-opening')`)){setTimeout(captureReady,100);return;}
    writeFileSync(join(folder,'window.json'),JSON.stringify({pid:process.pid,visible:window.isVisible(),url:window.webContents.getURL(),bounds:window.getBounds(),area:screen.getDisplayMatching(window.getBounds()).workArea}));
    writeFileSync(join(folder,'launcher.png'),(await window.webContents.capturePage()).toPNG());
   };
   setTimeout(captureReady,100);
  });
 });
});
