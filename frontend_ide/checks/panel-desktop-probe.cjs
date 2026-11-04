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
// 非表示の専用プロファイルで実ElectronのDOM/IPC/配置/終了を検証する。
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};BrowserWindow.prototype.focus=function(){};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=(window,source)=>window.webContents.executeJavaScript(source,true).catch(error=>{throw Error('Expression: '+source+'\n'+error.message);});
async function until(check,label){for(let i=0;i<150;i++){if(await check())return;await sleep(100);}throw Error('Electron確認タイムアウト: '+label);}
const output=join(__dirname,'../../temp/panel-pin-check');mkdirSync(output,{recursive:true});
const results=[];let running=false;
const nearBounds=(actual,expected)=>{for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<=2,`${key}: ${actual[key]} / ${expected[key]}`);};
async function checkExplorerHeading(window,label){
 const geometry=await evaluate(window,`(()=>{const header=document.querySelector('.explorer-panel>header'),burger=header.querySelector('.explorer-burger').getBoundingClientRect(),title=header.querySelector(':scope>span').getBoundingClientRect(),lines=[...header.querySelectorAll('.burger i')].map(node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right}});return{button:{left:burger.left,right:burger.right},title:{left:title.left,right:title.right},lines};})()`);
 assert.ok(geometry.title.left>=geometry.button.right+3,label+'の見出しはバーガーの右に置く');
 assert.ok(geometry.lines.every(line=>line.left>=geometry.button.left&&line.right<=geometry.button.right),label+'の三本線はボタンの内側に収まる');
 results.push({heading:label,...geometry});
}
async function capturePanel(window,name){
 const visible=window.isVisible(),opacity=window.getOpacity();
 try{
  // 非表示窓の古い合成フレームを撮らず、ユーザーのフォーカスを奪わずに描画させる。
  window.setOpacity(.01);window.setIgnoreMouseEvents(true);window.setSkipTaskbar(true);showInactive.call(window);
  window.webContents.invalidate();await evaluate(window,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await sleep(200);
  writeFileSync(join(output,name),(await window.webContents.capturePage()).toPNG());
 }finally{if(!visible)window.hide();window.setOpacity(opacity);window.setIgnoreMouseEvents(false);}
}
async function dragPanel(window,selector,label,frame=false){
 const originalFocus=window.isFocused,originalCursor=screen.getCursorScreenPoint;
 let cursor=originalCursor();window.isFocused=()=>true;screen.getCursorScreenPoint=()=>cursor;
 const doc=frame?"document.querySelector('#drag-fixture').contentDocument":'document';
 try{
  const point=await evaluate(window,`(()=>{const doc=${doc},r=doc.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),f=${frame?"document.querySelector('#drag-fixture').getBoundingClientRect()":"{left:0,top:0}"};return{x:Math.round(f.left+r.left+Math.min(20,r.width/2)),y:Math.round(f.top+r.top+r.height/2)}})()`);
  const before=window.getBounds();
  await evaluate(window,`window.holdInputs=[];window.holdListener=e=>holdInputs.push(e.type);for(const type of ['pointerdown','mousedown','pointercancel','pointerup','mouseup','click'])document.addEventListener(type,holdListener,true);`);
  const zoom=window.webContents.getZoomFactor(),inputPoint={x:Math.round(point.x*zoom),y:Math.round(point.y*zoom)};
  window.webContents.sendInputEvent({type:'mouseDown',...inputPoint,button:'left',clickCount:1});
  await until(()=>evaluate(window,`!!document.querySelector('[data-aidiy-window-move]:popover-open')`),label+'移動表示');
  const hitCursor=await evaluate(window,`(()=>{let doc=document,node=doc.elementFromPoint(${point.x},${point.y});if(node?.tagName==='IFRAME'&&node.contentDocument){const r=node.getBoundingClientRect();doc=node.contentDocument;node=doc.elementFromPoint(${point.x}-r.x,${point.y}-r.y);}return doc.defaultView.getComputedStyle(node).cursor;})()`);
  assert.equal(hitCursor,'move',label+'押している場所の移動カーソル');
  assert.equal(await evaluate(window,`document.elementFromPoint(${point.x},${point.y}).hasAttribute('data-aidiy-window-move')`),true,label+'iframeより手前に表示');
  // 非表示窓ではChromiumがpopoverの描画を省略するため、実際に表示して撮影する。
  window.setIgnoreMouseEvents(true);showInactive.call(window);await sleep(150);
  writeFileSync(join(output,'marker-'+label+'.png'),(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  assert.deepEqual(await evaluate(window,'holdInputs'),['pointerdown','mousedown','pointercancel'],label+'元の押下を渡し、移動成立時にpointer操作を取消す');
  cursor={x:cursor.x+30,y:cursor.y+20};
  window.webContents.sendInputEvent({type:'mouseMove',x:inputPoint.x+2,y:inputPoint.y+2,button:'left',modifiers:['leftButtonDown']});
  await until(()=>Math.abs(window.getBounds().x-before.x-30)<=1,label+'窓移動');
  const after=window.getBounds();assert.ok(Math.abs(after.width-before.width)<=1&&Math.abs(after.height-before.height)<=1,label+'サイズ維持');
  window.webContents.sendInputEvent({type:'mouseUp',x:inputPoint.x+2,y:inputPoint.y+2,button:'left',clickCount:1});
  await until(()=>evaluate(window,`!document.querySelector('[data-aidiy-window-move]')`),label+'移動表示解除');
  window.hide();window.setIgnoreMouseEvents(false);
  await until(async()=> (await evaluate(window,'holdInputs')).includes('mouseup'),label+'元の解放を配信');
  assert.deepEqual(await evaluate(window,'holdInputs'),['pointerdown','mousedown','pointercancel','pointerup','mouseup'],label+'解放は渡して移動後のclickだけを抑止');
  await evaluate(window,`for(const type of ['pointerdown','mousedown','pointercancel','pointerup','mouseup','click'])document.removeEventListener(type,holdListener,true)`);
  results.push({drag:label,before,after});
 }finally{window.isFocused=originalFocus;screen.getCursorScreenPoint=originalCursor;}
}
app.on('browser-window-created',(_,owner)=>{
 owner.webContents.setBackgroundThrottling(false);
 if(running)return;running=true;
 owner.webContents.once('did-finish-load',async()=>{
  try{
   await until(()=>evaluate(owner,`!!document.querySelector('.component-toolbar')&&!document.documentElement.classList.contains('desktop-opening')`),'起動');
   await evaluate(owner,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
   await until(()=>evaluate(owner,`!!window.aidiyIDE`),'利用');
   await evaluate(owner,`aidiyIDE.setAutoSpin(false);aidiyIDE.interact();Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click()`);
   await evaluate(owner,`aidiyIDE.goTo({type:'file',path:'sample.txt'})`);
   await until(()=>evaluate(owner,`!!document.querySelector('.viewer-popup .viewer-meta')`),'Viewer');
   await evaluate(owner,`document.querySelector('.explorer-toggle').click()`);
   for(const mode of ['since','grep','ai']){
    await evaluate(owner,`document.querySelector('input[value="${mode}"]').click()`);await sleep(80);
    await checkExplorerHeading(owner,'本体Explorer '+mode);
   }
   await evaluate(owner,`document.querySelector('input[value="since"]').click()`);await sleep(80);
   await capturePanel(owner,'electron-explorer-heading.png');
   for(const zoom of process.env.AIDIY_PANEL_ROUTES_ONLY==='1'?[]:[1,1.25]){
    console.log('Explorer zoom',zoom);
    owner.webContents.setZoomFactor(zoom);await sleep(150);
    const rect=await evaluate(owner,`(()=>{const r=document.querySelector('.explorer-panel').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    const expected=require('../デスクトップ/panel-windows.cjs').panelBounds(rect,{window:owner},screen);
    await evaluate(owner,`(()=>{window.originalExplorer=document.querySelector('.explorer-panel');window.pinPreviewObserved=false;const observer=new MutationObserver(()=>{if(!document.querySelector('.explorer-panel')){window.pinPreviewObserved=!!document.querySelector('.panel-pin-preview');observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});const pin=document.querySelector('[aria-label="エクスプローラーを別ウィンドウで開く"]');pin.click();pin.click()})()`);
    await until(()=>evaluate(owner,`!document.querySelector('.explorer-panel')`),'Explorer移動');
    assert.equal(await evaluate(owner,`pinPreviewObserved`),true,'別窓へDOMを移す時点では元位置の表示を残す');
    if(zoom===1)writeFileSync(join(output,'electron-pin-before-show.png'),(await owner.webContents.capturePage()).toPNG());
    const child=BrowserWindow.getAllWindows().find(w=>w!==owner&&w.webContents.getURL()==='about:blank');assert.ok(child);
    await until(()=>evaluate(child,`!!document.querySelector('.explorer-panel')`),'Explorer DOM');
    await until(()=>evaluate(child,`!!document.querySelector('.panel-window-title .window-actions')`),'共通タイトルバー');
    await checkExplorerHeading(child,'別窓Explorer '+zoom);
    assert.equal(await evaluate(child,`document.querySelector('.panel-window-title .connection-bar').classList.contains('offline')`),true);
    nearBounds(child.getBounds(),expected);
    await until(()=>evaluate(owner,`!document.querySelector('.panel-pin-preview')`),'別窓表示後に元表示を除去');
    if(zoom===1){
     await dragPanel(child,await probeBackground(child.webContents),'Explorer背景');
     results.push(await checkNativeControls(child,child.webContents,'Explorer'));
     await evaluate(child,`document.querySelector('#move-probe-background').remove()`);
     await dragPanel(child,'[data-path="sample.txt"] .file-name','Explorerファイル項目');
    }
    if(zoom===1)writeFileSync(join(output,'electron-explorer-title.png'),(await child.webContents.capturePage()).toPNG());
    await evaluate(child,`document.querySelector('input[value="grep"]').click()`);
    await evaluate(child,`const input=document.querySelector('input[type=search]');input.value='Electron';input.dispatchEvent(new Event('input',{bubbles:true}));Array.from(document.querySelectorAll('form button')).find(b=>b.textContent==='検索').click()`);
    await until(()=>evaluate(child,`document.querySelector('form [role=status]')?.textContent.includes('1ファイル一致')`),'検索結果');
    const reloaded=new Promise(resolve=>child.webContents.once('did-finish-load',resolve));child.webContents.reload();await reloaded;
    await until(()=>evaluate(child,`document.querySelector('input[type=search]')?.value==='Electron'`),'再読込復帰');
    await until(()=>evaluate(child,`(()=>{const panel=document.querySelector('.explorer-panel'),style=getComputedStyle(panel);return style.visibility==='visible'&&style.opacity==='1'&&panel.getBoundingClientRect().height>100})()`),'再読込後の可視性');
    await sleep(300);
    // about:blank再読み込み後の隠れた窓はChromiumが描画を省くため、画像確認時だけ非アクティブ表示。
    if(process.env.AIDIY_TEST_VISIBLE==='1'){
     showInactive.call(child);await sleep(300);
     writeFileSync(join(output,`electron-explorer-${zoom}.png`),(await child.webContents.capturePage()).toPNG());child.hide();
    }
    child.close();await until(()=>evaluate(owner,`getComputedStyle(originalExplorer).display==='none'`),'X折畳み');
    await evaluate(owner,`document.querySelector('.explorer-toggle').click()`);await until(()=>evaluate(owner,`getComputedStyle(originalExplorer).display!=='none'`),'再表示');
    assert.equal(await evaluate(owner,`document.querySelector('.explorer-panel')===originalExplorer`),true);
    results.push({kind:'explorer',zoom,bounds:expected,reload:true,restore:true});
   }
   for(const zoom of process.env.AIDIY_PANEL_ROUTES_ONLY==='1'?[]:[1,1.25]){
    console.log('Viewer zoom',zoom);
    owner.webContents.setZoomFactor(zoom);await sleep(150);
    const rect=await evaluate(owner,`(()=>{const r=document.querySelector('.viewer-popup').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    const expected=require('../デスクトップ/panel-windows.cjs').panelBounds(rect,{window:owner},screen);
    await evaluate(owner,`document.querySelector('[aria-label="ファイルを別ウィンドウで開く"]').click()`);
    await until(()=>evaluate(owner,`!document.querySelector('.viewer-popup')`),'Viewer移動');
    const child=BrowserWindow.getAllWindows().find(w=>w!==owner&&w.webContents.getURL()==='about:blank');assert.ok(child);
    nearBounds(child.getBounds(),expected);await until(()=>evaluate(child,`!!document.querySelector('.viewer-pinned .viewer-meta')`),'Viewer表示');
    await until(()=>evaluate(owner,`!document.querySelector('.panel-pin-preview')`),'Viewer表示完了');
    writeFileSync(join(output,`electron-viewer-${zoom}.png`),(await child.webContents.capturePage()).toPNG());
    if(zoom===1){
     await until(()=>evaluate(child,`!!document.querySelector('.viewer-code .view-line')`),'Monaco本文');
     await dragPanel(child,await probeBackground(child.webContents),'Viewer背景');
     results.push(await holdUnmoved(child,child.webContents,'.viewer-code .view-line','Viewer本文'));
     await evaluate(child,`document.querySelector('#move-probe-background').remove()`);
     await until(()=>evaluate(child,`!!document.querySelector('.viewer-history')`),'比較入口');
     await evaluate(child,`document.querySelector('.viewer-history').click()`);
     await until(()=>evaluate(child,`!!document.querySelector('.history-embedded .file-history-changes')&&!document.querySelector('.file-history-changes').textContent.includes('計算中')`),'比較表示');
     assert.equal(await evaluate(child,`document.querySelectorAll('.panel-window-title').length`),1);
     child.webContents.invalidate();await child.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await sleep(300);
     writeFileSync(join(output,'electron-compare-title.png'),(await child.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
     results.push(await holdUnmoved(child,child.webContents,'.history-embedded .original .view-line','比較左本文'));
     results.push(await holdUnmoved(child,child.webContents,'.history-embedded .modified .view-line','比較右本文'));
     await evaluate(child,`(()=>{const f=document.createElement('iframe');f.id='drag-fixture';f.style='position:fixed;inset:100px auto auto 20px;width:260px;height:180px;border:0;z-index:99999';f.srcdoc='<p>HTML / Office の本文</p><input>';document.body.append(f);})()`);
     await until(()=>evaluate(child,`!!document.querySelector('#drag-fixture')?.contentDocument?.querySelector('p')`),'iframe本文');
     results.push(await holdUnmoved(child,child.webContents,'p','iframe本文',{frame:'#drag-fixture'}));
     results.push(await holdUnmoved(child,child.webContents,'input','iframe入力',{frame:'#drag-fixture'}));
     await evaluate(child,`document.querySelector('#drag-fixture').remove()`);
     const preview=await evaluate(owner,`fetch('/api/preview?path=sample.html').then(r=>r.json())`);
     await evaluate(child,`(()=>{const f=document.createElement('iframe');f.id='drag-cross';f.style='position:fixed;inset:100px auto auto 20px;width:260px;height:180px;border:0;z-index:99999';f.src=${JSON.stringify(preview.url)};document.body.append(f);})()`);
     await sleep(500);assert.equal(await evaluate(child,`document.querySelector('#drag-cross').contentDocument===null`),true,'別オリジンで検証');
     results.push(await holdUnmoved(child,child.webContents,'#drag-cross','別オリジンHTML本文',{dom:false}));
     await evaluate(child,`document.querySelector('#drag-cross').remove()`);
    }
    await evaluate(child,`document.querySelector('.panel-window-title [aria-label="終了"]').click()`);await until(()=>evaluate(owner,`!document.querySelector('.viewer-session')`),'Viewer X終了');
    await evaluate(owner,`aidiyIDE.goTo({type:'file',path:'sample.txt'})`);await until(()=>evaluate(owner,`!!document.querySelector('.viewer-popup .viewer-meta')`),'Viewer再open');
    results.push({kind:'viewer',zoom,bounds:expected,dismiss:true,reopen:true});
   }
   // 閉じたバーの非表示ボタンを直接押さず、利用者と同じ順で展開してからpinする。
   await evaluate(owner,`document.querySelector('[aria-label="軌跡バーを開く"]')?.click()`);
   await until(()=>evaluate(owner,`document.querySelector('.explorer-routes').getBoundingClientRect().height>0`),'軌跡展開');
   await evaluate(owner,`document.querySelector('[aria-label="軌跡バーを別ウィンドウで開く"]').click()`);
   await until(()=>evaluate(owner,`!document.querySelector('.explorer-routes')`),'軌跡pin');
   const routes=BrowserWindow.getAllWindows().find(w=>w!==owner&&w.webContents.getURL()==='about:blank');
   await until(()=>evaluate(routes,`!!document.querySelector('.route-controls')`),'軌跡表示');
   await until(()=>evaluate(owner,`!document.querySelector('.panel-pin-preview')`),'軌跡ズーム完了');
   await sleep(350);
   // 非表示の重複操作を除き、高さが異なるボタンは縦中心で同じ行に整列する。
   const row=await evaluate(routes,`(()=>{const bar=document.querySelector('.route-controls'),buttons=[...bar.querySelectorAll('button')].filter(button=>button.getBoundingClientRect().width>0);return{rows:new Set(buttons.map(b=>{const r=b.getBoundingClientRect();return Math.round(r.top+r.height/2)})).size,height:document.querySelector('.explorer-routes').getBoundingClientRect().height,overflow:bar.scrollWidth>bar.clientWidth}})()`);
   assert.equal(row.rows,1);assert.equal(row.overflow,false);assert.ok(row.height<=40.01,JSON.stringify(row));
   assert.equal(await evaluate(routes,`(()=>{const bar=document.querySelector('.route-controls').getBoundingClientRect(),buttons=[...document.querySelectorAll('.route-window-actions button')];return buttons.length===2&&buttons.every(button=>{const r=button.getBoundingClientRect();return r.left>=bar.left&&r.right<=bar.right;});})()`),true,'軌跡のピン・本体復帰だけを表示する');
   assert.equal(await evaluate(routes,`(()=>{const tools=document.querySelector('.route-window-actions'),pin=tools.querySelector('.window-pin'),close=tools.querySelector('.panel-return');return tools===tools.parentElement.lastElementChild&&tools.getBoundingClientRect().left>[...document.querySelectorAll('.route-choice')].at(-1).getBoundingClientRect().left&&close.getBoundingClientRect().left>=pin.getBoundingClientRect().right&&!!close.querySelector('.close-icon');})()`),true,'右側はピン・×の順に置く');
   const selectedRoute=await evaluate(routes,`document.querySelector('.route-choice').getAttribute('aria-expanded')`),pinned=await evaluate(routes,`document.querySelector('.window-pin').getAttribute('aria-pressed')`);
   results.push(await holdMove(routes,routes.webContents,'.route-choice','軌跡ボタン'));
   results.push(await holdMove(routes,routes.webContents,'.window-pin','軌跡ピン'));
   assert.equal(await evaluate(routes,`document.querySelector('.route-choice').getAttribute('aria-expanded')`),selectedRoute,'長押し移動で分類を開閉しない');
   assert.equal(await evaluate(routes,`document.querySelector('.window-pin').getAttribute('aria-pressed')`),pinned,'長押し移動でピンを切り替えない');
   await evaluate(routes,`document.querySelector('.route-choice[aria-expanded="true"]')?.click()`);
   await shortClick(routes.webContents,'.route-choice');await until(()=>evaluate(routes,`document.querySelector('.route-choice').getAttribute('aria-expanded')==='true'`),'短押しで分類を開く');
   await shortClick(routes.webContents,'.route-choice');await until(()=>evaluate(routes,`document.querySelector('.route-choice').getAttribute('aria-expanded')==='false'`),'短押しで分類を閉じる');
   await until(()=>evaluate(routes,`document.querySelector('.route-reveal').dataset.phase==='closed'`),'分類の縮小完了');await sleep(100);
   await dragPanel(routes,await probeBackground(routes.webContents),'軌跡背景');
   await evaluate(routes,`document.querySelector('#move-probe-background').remove()`);
   await capturePanel(routes,'electron-routes-single-row.png');
   await shortClick(routes.webContents,'.panel-return');await until(()=>routes.isDestroyed(),'軌跡×で別窓終了');
   await until(()=>evaluate(owner,`!!document.querySelector('.explorer-routes')&&document.querySelector('.explorer-routes').getBoundingClientRect().height>0&&!document.querySelector('.route-window-actions')`),'軌跡×で本体へ復帰');results.push({kind:'routes',...row,closedToEmbedded:true});
   await evaluate(owner,`document.querySelector('[aria-label="エクスプローラーを別ウィンドウで開く"]').click()`);await until(()=>evaluate(owner,`!document.querySelector('.explorer-panel')`),'終了前pin');
   const child=BrowserWindow.getAllWindows().find(w=>w!==owner&&w.webContents.getURL()==='about:blank');
   await evaluate(owner,`Array.from(document.querySelectorAll('.component-toolbar button')).find(b=>b.textContent==='終了').click()`);
   await until(()=>child.isDestroyed(),'利用終了');
   writeFileSync(join(output,'electron-result.json'),JSON.stringify(results,null,2));process.send?.({testPassed:true,results});app.exit(0);
  }catch(error){console.error(error);try{console.error(await evaluate(owner,'document.body.innerText'));}catch{}app.exit(1);}
 });
});
setTimeout(()=>{console.error('Electron確認期限');app.exit(1);},90000).unref();
require('../desktop.cjs');
