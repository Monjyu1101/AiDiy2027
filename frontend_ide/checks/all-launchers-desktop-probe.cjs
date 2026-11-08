// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const assert=require('node:assert/strict');
const {app,BrowserWindow,screen}=require('electron');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {join}=require('node:path');
const {createServer}=require('node:http');
const Module=require('node:module');
const {allWindowBounds}=require('../デスクトップ/window-layout.cjs');
app.disableHardwareAcceleration();app.setPath('appData',process.env.AIDIY_TEST_PROFILE);
const nativeShow=BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.show=BrowserWindow.prototype.showInactive=function(){if(!this.isAiDiyOpeningCanvas){this.setIgnoreMouseEvents(true);this.setSkipTaskbar(true);}nativeShow.call(this);};
BrowserWindow.prototype.focus=function(){};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=(window,source)=>window.webContents.executeJavaScript(source,true);
async function until(check,label){for(let i=0;i<200;i++){if(await check())return;await sleep(100);}throw Error('ALLメニュー確認タイムアウト: '+label);}
const near=(actual,expected)=>{for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<=3,`${key}: ${actual[key]} / ${expected[key]}`);};
const output=join(__dirname,'../../temp/all-displays-check');mkdirSync(output,{recursive:true});
const stamp=Date.now(),shots=[],opened=[];
// 起動IPC・セッション確認・native配置・ズームは本物。子の通信本文だけを固定HTMLにする。
// Code CLI / PTY / マイク / 有料APIを起動しない。
globalThis.__allLauncherFixture={startDevelopment:async(_project,{kind})=>{
 const server=createServer((_request,response)=>response.end(`<html><body style="background:#070b17;color:#fff">${kind} placement fixture</body></html>`));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return{url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise(resolve=>server.close(resolve))};
}};
let running=false;
app.on('browser-window-created',(_,owner)=>{
 owner.webContents.setBackgroundThrottling(false);
 if(running)return;running=true;
 owner.webContents.once('did-finish-load',async()=>{
  try{
   await until(()=>owner.isVisible()&&evaluate(owner,`!!document.querySelector('.ide-heading')&&!document.documentElement.classList.contains('desktop-opening')`),'IDE起動');
   await evaluate(owner,`[...document.querySelectorAll('button')].find(b=>b.textContent==='AiDiy接続利用').click()`);
   await until(()=>evaluate(owner,`!!document.querySelector('.window-all')`),'接続利用fixture');
   const displays=screen.getAllDisplays();
   const enter=async()=>{await evaluate(owner,`document.querySelector('.window-all').click()`);await until(()=>evaluate(owner,`document.querySelectorAll('.all-restore-zone').length===${displays.length}&&!document.querySelector('.all-transition')`),'各画面のメニュー');await sleep(400);};
   await enter();
   assert.equal((await evaluate(owner,`aidiyWindow.openApp('code',-999999)`)).ok,false,'存在しない画面を拒否');
   const selector=display=>`.all-restore-zone[data-display-id="${display.id}"]`;
   const hover=async display=>{
    const rect=await evaluate(owner,`(()=>{const r=document.querySelector('${selector(display)}').getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,width:r.width,height:r.height};})()`);
    const bounds=owner.getBounds(),zoom=owner.webContents.getZoomFactor(),area=display.workArea;
    assert.ok(Math.abs(rect.right*zoom-(area.x+area.width-bounds.x))<=3,'選んだ画面の右端');
    assert.ok(Math.abs(rect.y*zoom-(area.y-bounds.y))<=3,'選んだ画面の上端');
    owner.webContents.sendInputEvent({type:'mouseMove',x:Math.round(rect.right-14),y:Math.round(rect.y+14)});
    await until(()=>evaluate(owner,`getComputedStyle(document.querySelector('${selector(display)} .all-restore-button')).opacity==='1'&&getComputedStyle(document.querySelector('${selector(display)} .all-launchers')).visibility==='visible'`),'ホバーで操作を表示');return rect;
   };
   const capture=async(display,label)=>{
    const rect=await hover(display);
    await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await sleep(300);
    const image=await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
    const viewport=await evaluate(owner,'({width:innerWidth,height:innerHeight})'),ratio=image.getSize().width/viewport.width;
    const x=Math.max(0,Math.floor((rect.x-20)*ratio)),y=Math.max(0,Math.floor(rect.y*ratio));
    const path=join(output,`${stamp}_menu-${display.id}-${label}.png`);
    writeFileSync(path,image.crop({x,y,width:Math.min(image.getSize().width-x,Math.ceil((rect.width+20)*ratio)),height:Math.min(image.getSize().height-y,Math.ceil((rect.height+20)*ratio))}).toPNG());shots.push(path);
   };
   for(const display of displays){
    await capture(display,'available');
    assert.deepEqual(await evaluate(owner,`[...document.querySelectorAll('${selector(display)} .all-launchers button')].map(b=>b.textContent.trim())`),['Console','Code','Live','Browser']);
    for(const kind of ['console','code','live']){
     const before=new Set(BrowserWindow.getAllWindows().map(w=>w.id));
     await evaluate(owner,`[...document.querySelectorAll('${selector(display)} .all-launchers button')].find(b=>b.textContent.includes('${kind[0].toUpperCase()+kind.slice(1)}')).click()`);
     let child;
     await until(()=>{child=BrowserWindow.getAllWindows().find(w=>!before.has(w.id)&&w.getTitle().includes(kind==='code'?'Code':kind==='live'?'Live':'Console'));return child?.isVisible();},kind+'別窓');
     await until(()=>evaluate(owner,`[...document.querySelectorAll('${selector(display)} button')].every(b=>!b.disabled)`),'起動完了');
     near(child.getBounds(),allWindowBounds(kind,display.workArea));
     assert.equal(child.getParentWindow(),null);assert.equal(child.isAlwaysOnTop(),true);
     opened.push({displayId:display.id,kind,bounds:child.getBounds()});
     if(kind==='live'){
      assert.equal(await evaluate(owner,`[...document.querySelectorAll('.all-launchers button')].some(b=>b.textContent.includes('Live'))`),false,'Live起動後は全画面でボタンを隠す');
      const count=BrowserWindow.getAllWindows().length;
      assert.equal((await evaluate(owner,`aidiyWindow.openApp('live',${display.id})`)).reused,true);assert.equal(BrowserWindow.getAllWindows().length,count);
      await capture(display,'live-open');
     }
     child.close();
     await evaluate(owner,`document.querySelector('${selector(display)}').dispatchEvent(new MouseEvent('mouseenter'))`);
     if(kind==='live')await until(()=>evaluate(owner,`[...document.querySelectorAll('${selector(display)} button')].some(b=>b.textContent==='Live')`),'Live終了後の再表示');
    }
    await evaluate(owner,`document.querySelector('${selector(display)} .all-restore-button').click()`);
    await until(()=>evaluate(owner,`!document.querySelector('.all-restore-zone')&&!document.querySelector('.all-transition')`),'どの画面からでもALL解除');
    assert.equal((await evaluate(owner,`aidiyWindow.openApp('code',${display.id})`)).ok,false,'ALL解除後の画面指定を拒否');
    if(display!==displays.at(-1))await enter();
   }
   const result={testPassed:true,scope:'ALL per-display launchers',displayCount:displays.length,liveHiddenAndRestored:true,restoreFromEveryDisplay:true,opened,shots};
   writeFileSync(join(output,'launchers-result.json'),JSON.stringify(result,null,2));process.send?.(result);app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
 });
});
setTimeout(()=>{console.error('ALLメニュー確認期限');app.exit(1);},180000).unref();
const filename=require.resolve('../desktop.cjs');
const desktop=new Module(filename,module);desktop.filename=filename;desktop.paths=Module._nodeModulePaths(join(__dirname,'..'));
desktop._compile(readFileSync(filename,'utf8').replace("const {startDevelopment}=await import('./server.mjs');","const {startDevelopment}=globalThis.__allLauncherFixture;"),filename);
