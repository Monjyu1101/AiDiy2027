// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 本番CSSと共通移動helperを合成DOMで検証。AI接続・外部通信・ユーザープロファイルは使わない。
// 実行: frontend_avatar/node_modules/.bin/electron frontend_ide/checks/panel-hold-drag-desktop.cjs --ozone-platform=headless
// trusted入力は実Electron。カーソルと移動先はmockであり、WindowsのOS窓移動確認ではない。
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {installNativeWindowMove}=require('../デスクトップ/長押し窓移動.cjs');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'aidiy-panel-hold-'));
const profile=path.join(output,'profile'),preload=path.join(output,'preload.cjs');
fs.writeFileSync(preload,`const{contextBridge}=require('electron');contextBridge.exposeInMainWorld('fixtureSecurity',{sandboxed:process.sandboxed===true,contextIsolated:process.contextIsolated===true});`);
const css=fs.readFileSync(path.join(__dirname,'../src/style.css'),'utf8');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const windows=[],disposers=[],results=[],screenshots=[];
app.disableHardwareAcceleration();app.setPath('userData',profile);app.on('window-all-closed',()=>{});
function markup(kind){
 const explorer=`<main class="development-app native-panel-window explorer-window">
 <div class="panel-window-title"><header class="panel-brand desktop"><span class="connection-label">offline</span><strong>エクスプローラー</strong><nav class="window-actions"><button id="title-pin">📌</button><button>×</button></nav></header></div>
 <aside class="explorer-panel"><header><button>≡</button><span>エクスプローラー</span><button id="header-control">◎</button></header>
 <section class="explorer-search"><select id="select"><option value="one">One</option><option value="two">Two</option></select><input id="input" value="editable text"><p id="text">Normal text selection stays available before the long hold threshold.</p></section>
 <ul id="tree" role="tree" tabindex="0" data-aidiy-window-move-list><li id="file-row" role="treeitem"><span id="file-name">sample.txt</span></li><li role="treeitem"><button id="chevron">▸</button><span>folder</span></li><li role="treeitem"><input id="rename" class="explorer-rename" value="new-name.txt"></li></ul><div id="menu" class="selection-popup" data-aidiy-no-window-move style="display:none;position:fixed;left:400px;top:100px;width:180px;height:60px;background:#203040;z-index:90"><button id="menu-button">ファイル操作</button></div></aside></main>`;
 const routes=`<main class="development-app routes-window"><div class="explorer-routes"><div class="route-controls" data-aidiy-window-move-handle><div class="route-window-actions"><nav class="window-actions"><button id="route-pin">📌</button></nav></div><button class="burger-button route-burger" title="ドラッグして移動"><span class="burger burger-v"><i></i><i></i><i></i></span></button><button class="route-choice">軌跡 1</button><button>＋</button><button>×</button></div></div></main>`;
 return `<!doctype html><html class="${kind==='panel-routes'?'route-window-document native-route-window':''}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>${css}</style></head><body>${kind==='explorer'?explorer:routes}
 <script>window.events=[];for(const type of ['pointerdown','mousedown','pointercancel','pointerup','mouseup','click','dblclick','contextmenu'])document.addEventListener(type,event=>events.push({type,target:event.target.id||event.target.className,trusted:event.isTrusted}),true);window.fileClicks=0;window.fileDoubleClicks=0;window.fileMenus=0;const row=document.querySelector('#file-row');if(row){row.onclick=()=>fileClicks++;row.ondblclick=()=>fileDoubleClicks++;row.oncontextmenu=event=>{event.preventDefault();fileMenus++};}</script></body></html>`;
}
app.whenReady().then(async()=>{
 const isolated=session.fromPartition('panel-hold-'+Date.now());
 isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 isolated.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
 for(const kind of ['explorer','panel-routes']){
  const win=new BrowserWindow({show:false,frame:false,width:650,height:450,webPreferences:{preload,session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}});
  windows.push(win);const contents=win.webContents;let cursor={x:100,y:100},begins=0,moves=0,ends=0;
  disposers.push(installNativeWindowMove({record:{window:win,kind},screen:{getCursorScreenPoint:()=>({...cursor})},drag:{forRecord:()=>({begin:()=>{begins++;return'token';},move:()=>{moves++;return true;},end:()=>{ends++;}})}}));
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(markup(kind)));
  contents.enableDeviceEmulation({screenPosition:'desktop',screenSize:{width:650,height:450},viewPosition:{x:0,y:0},viewSize:{width:650,height:450},deviceScaleFactor:1,scale:1});
  win.show();contents.focus();await sleep(150);
  const js=code=>contents.executeJavaScript(code);
  assert.deepEqual(await js(`({...fixtureSecurity,require:typeof require,process:typeof process})`),{sandboxed:true,contextIsolated:true,require:'undefined',process:'undefined'});
  const point=async(selector,padding=false)=>js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),r=n.getBoundingClientRect();if(!r.width||!r.height)throw Error('hidden target');return{x:Math.round(r.x+${padding?'2':'r.width/2'}),y:Math.round(r.y+${padding?'2':'r.height/2'})};})()`);
  const input=(type,p)=>contents.sendInputEvent({type,...p,button:'left',clickCount:1});
  async function hold(selector,expected,{padding=false,keepFocus=false}={}){
   if(!keepFocus)await js('document.activeElement?.blur()');
   await js('events=[]');const p=await point(selector,padding),before=begins,moveBefore=moves,endBefore=ends;
   input('mouseDown',p);await sleep(150);
   assert.equal(begins,before,selector+' must wait before activation');
   assert.deepEqual((await js('events')).slice(0,2).map(e=>e.type),['pointerdown','mousedown'],selector+' original down events');
   await sleep(500);
   assert.equal(begins-before,expected?1:0,selector+' hold eligibility');
   assert.equal(await js(`!!document.querySelector('[data-aidiy-window-move]')`),expected,selector+' move feedback');
   if(expected){cursor={x:cursor.x+8,y:cursor.y+4};input('mouseMove',{x:p.x+8,y:p.y+4});await sleep(25);assert.ok(moves>moveBefore);}
   input('mouseUp',p);await sleep(80);
   const events=await js('events');
   assert.equal(events.filter(event=>event.type==='pointerup'&&event.trusted).length,1,selector+' trusted pointerup passes');
   assert.equal(events.filter(event=>event.type==='mouseup'&&event.trusted).length,1,selector+' trusted mouseup passes');
   if(expected){assert.ok(events.some(event=>event.type==='pointercancel'));assert.equal(events.filter(event=>event.type==='click').length,0);assert.equal(ends-endBefore,1);}
   else assert.equal(events.filter(event=>event.type==='click').length,1,selector+' normal click survives');
   assert.equal(await js(`!!document.querySelector('[data-aidiy-window-move]')`),false);
   results.push({kind,selector,expectedMove:expected,afterClosedSelect:keepFocus,downUpPassed:true});
  }
  if(kind==='explorer'){
   await hold('#file-name',true);await hold('#tree',true,{padding:true});
   assert.equal(await js('fileClicks'),0,'hold does not open file');
   await hold('#title-pin',false);await hold('#header-control',false);await hold('#input',false);await hold('#rename',false);await hold('#chevron',false);
   // 閉じたnative selectにfocusを残した直後の最初の一覧押下も扱う。
   await js(`select.focus()`);
   for(const keyCode of ['Home','Down','Return']){contents.sendInputEvent({type:'keyDown',keyCode});contents.sendInputEvent({type:'keyUp',keyCode});}
   await sleep(60);assert.equal(await js('select.value'),'two');assert.equal(await js('document.activeElement.id'),'select');assert.equal(await js(`select.matches(':open')`),false);
   await hold('#file-name',true,{keepFocus:true});
   const file=await point('#file-name'),beforeClicks=await js('fileClicks');
   for(const clickCount of [1,2]){contents.sendInputEvent({type:'mouseDown',...file,button:'left',clickCount});contents.sendInputEvent({type:'mouseUp',...file,button:'left',clickCount});await sleep(40);}
   assert.equal(await js('fileClicks'),beforeClicks+2);assert.equal(await js('fileDoubleClicks'),1,'ordinary double click remains');
   contents.sendInputEvent({type:'mouseDown',...file,button:'right',clickCount:1});contents.sendInputEvent({type:'mouseUp',...file,button:'right',clickCount:1});await sleep(60);
   assert.equal(await js('fileMenus'),1,'ordinary row context menu remains');results.push({kind,rowSingleDoubleClickAndContextMenu:true});
   await js(`document.querySelector('#menu').style.display='block'`);await hold('#file-name',false);await hold('#menu-button',false);await js(`document.querySelector('#menu').style.display='none'`);
   // 一覧の文字選択dragは500msより先に移動すれば窓移動へ変えない。
   await js(`document.activeElement?.blur();getSelection().removeAllRanges()`);
   const rect=await js(`(()=>{const r=document.querySelector('#file-name').getBoundingClientRect();return{x:Math.round(r.x+2),y:Math.round(r.y+6)}})()`),before=begins;
   input('mouseDown',rect);cursor={x:cursor.x+100,y:cursor.y};input('mouseMove',{x:rect.x+100,y:rect.y});await sleep(550);input('mouseUp',{x:rect.x+100,y:rect.y});await sleep(50);
   assert.equal(begins,before);assert.ok((await js('getSelection().toString()')).length>0,'file-name text selection is preserved');results.push({kind,fileNameTextSelection:true});
  }else{
   assert.equal(await js(`getComputedStyle(document.querySelector('.route-controls')).webkitAppRegion`),'no-drag');
   assert.equal(await js(`getComputedStyle(document.querySelector('.route-burger')).webkitAppRegion`),'drag');
   assert.equal(await js(`!!document.querySelector('.route-drag-handle')`),false);
   await hold('.route-controls',true,{padding:true});await hold('.route-choice',true);await hold('#route-pin',true);
  }
  // 成立した移動の直後にも通常の短いクリックは一度だけ通す。
  const selector=kind==='explorer'?'#title-pin':'#route-pin',p=await point(selector),before=begins;
  await js('events=[]');input('mouseDown',p);await sleep(60);input('mouseUp',p);await sleep(60);
  assert.equal(begins,before);assert.equal((await js('events')).filter(event=>event.type==='click').length,1);results.push({kind,nextShortClick:true});
  const image=await contents.capturePage();if(image.getSize().width>1&&image.getSize().height>1){const file=path.join(output,kind+'.png');fs.writeFileSync(file,image.toPNG());screenshots.push(file);}
  win.hide();
 }
 const result={passed:true,electron:process.versions.electron,sandbox:true,coverage:'Production CSS + synthetic panel DOM + shared native handler; real trusted input. Cursor and move destination mocked. Not Windows OS window movement or native popup proof.',results,screenshots};
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log('PANEL_HOLD_DRAG_RESULT '+JSON.stringify({output,...result}));
 for(const dispose of disposers)dispose();for(const win of windows)win.destroy();app.quit();
}).catch(error=>{console.error(error);for(const dispose of disposers)dispose();for(const win of windows)if(!win.isDestroyed())win.destroy();app.exit(1);});
setTimeout(()=>app.exit(2),30000).unref();
