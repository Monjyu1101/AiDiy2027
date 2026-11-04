// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const assert=require('node:assert/strict');
const {app,BrowserWindow,screen}=require('electron');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {displayBounds}=require('../デスクトップ/全画面横断.cjs');
const {panelBounds}=require('../デスクトップ/panel-windows.cjs');
app.setPath('appData',process.env.AIDIY_TEST_PROFILE);
const viewerOnly=process.env.AIDIY_ALL_VIEWER_ONLY==='1';
// 巨大なVR窓の同時検証でGPUリソースを占有しない。窓の座標・DPIは実OSのまま検証する。
if(process.env.AIDIY_ALL_CENTER_ONLY!=='1')app.disableHardwareAcceleration();
// OS上の前後関係も検証する。ほぼ透明・マウス透過・タスクバー非掲載で、フォーカスを奪わない。
// 完全透明だとOSが描画を停止する環境があるため、撮影とviewport更新に必要な最小の不透明度を残す。
const nativeShowInactive=BrowserWindow.prototype.showInactive,nativeOpacity=BrowserWindow.prototype.setOpacity;
const shownWindows=[];
BrowserWindow.prototype.setOpacity=function(value){nativeOpacity.call(this,this.isAiDiyOpeningCanvas?value:process.env.AIDIY_ALL_PANEL_POSITION_ONLY==='1'?1:.01);};
BrowserWindow.prototype.show=BrowserWindow.prototype.showInactive=function(){if(!this.isAiDiyOpeningCanvas){this.setOpacity(0);this.setIgnoreMouseEvents(true);this.setSkipTaskbar(true);shownWindows.push(this.id);}nativeShowInactive.call(this);};
BrowserWindow.prototype.focus=function(){};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=async(window,source)=>{try{return await window.webContents.executeJavaScript(source,true);}catch(error){throw new Error(`ALL確認の実行失敗: ${source}`,{cause:error});}};
async function until(check,label){for(let i=0;i<200;i++){if(await check())return;await sleep(100);}throw Error('ALL確認タイムアウト: '+label);}
const near=(actual,expected)=>{for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<=2,`${key}: ${actual[key]} / ${expected[key]}`);};
const output=join(__dirname,'../../temp/all-displays-check');mkdirSync(output,{recursive:true});
const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()).replace(/\D/g,'');
let running=false;
app.on('browser-window-created',(_,owner)=>{
 owner.webContents.setBackgroundThrottling(false);
 if(running)return;
 running=true;
 owner.webContents.once('did-finish-load',async()=>{
  try{
   await until(()=>owner.isVisible()&&evaluate(owner,`!!document.querySelector('.ide-heading .window-actions')&&!document.documentElement.classList.contains('desktop-opening')`),'起動');
   // DOM移動より先に監視する。did-finish-loadからの登録では小さな軌跡窓の表示に間に合わない。
   await evaluate(owner,`(()=>{const open=window.open;window.open=function(...args){const child=open.apply(this,args);if(child){child.openingShines=0;new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&node.classList.contains('opening-shine'))child.openingShines++;}).observe(child.document,{childList:true,subtree:true});}return child;};})()`);
   const headingShot=async name=>{
    owner.webContents.invalidate();await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
    await sleep(500);
    const shot=await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
    writeFileSync(join(output,`${stamp}_${name}.png`),shot.crop({x:0,y:0,width:shot.getSize().width,height:160}).toPNG());
   };
   const viewerSpacingChecks=[],viewerSpacingShots=[];
   const checkViewerSpacing=async(selector,vr)=>{
    const measured=await evaluate(owner,`(()=>{const box=e=>{const r=e.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};},r=box(document.querySelector(${JSON.stringify(selector)})),heading=box(document.querySelector('.ide-heading')),controls=[...document.querySelectorAll(${JSON.stringify(vr?'.all-restore-zone':'.ide-heading .ai-launchers')})].map(box).filter(b=>b.width&&b.height);return{selector:${JSON.stringify(selector)},vr:${vr},viewport:{width:innerWidth,height:innerHeight},panel:r,explorer:${vr}?null:box(document.querySelector('.explorer-panel')),topGap:r.top-( ${vr} ? 0 : heading.bottom),bottomGap:innerHeight-r.bottom,controls,overlaps:controls.filter(b=>r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top).length};})()`);
    assert.ok(measured.topGap>=(vr?48:0),JSON.stringify(measured));
    assert.ok(measured.bottomGap>=(vr?47.5:59.5),JSON.stringify(measured));
    if(!vr){for(const edge of ['top','bottom'])assert.ok(Math.abs(measured.panel[edge]-measured.explorer[edge])<1,'通常横画面はExplorerと上下端をそろえる: '+JSON.stringify(measured));}
    assert.equal(measured.overlaps,0,'ビューア・比較を上部の起動・VR操作に重ねない');
    assert.ok(measured.panel.height>100);viewerSpacingChecks.push(measured);return measured;
   };
   const spacingShot=async name=>{
    await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await sleep(300);
    const file=join(output,`${stamp}_${name}.png`);writeFileSync(file,(await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());viewerSpacingShots.push(file);
   };
   const checkWeb=async()=>{
    const web=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{sandbox:true,contextIsolation:true}});
    try{
     await web.loadURL(owner.webContents.getURL());
     await until(()=>evaluate(web,`!!document.querySelector('.ide-view-modes')`),'Web版の利用中画面');
     assert.equal(await evaluate(web,`typeof window.aidiyWindow==='undefined'&&!document.querySelector('.window-all')`),true,'Web版は3DでもALLを非表示');
    }finally{web.destroy();}
   };
   const buttonsOnly=process.env.AIDIY_ALL_BUTTONS_ONLY==='1';
   if(buttonsOnly||viewerOnly||process.env.AIDIY_ALL_PANEL_POSITION_ONLY==='1'){nativeOpacity.call(owner,1);await sleep(500);}
   const buttons=await evaluate(owner,`[...document.querySelectorAll('.ide-heading .window-actions button')].map(button=>button.getAttribute('aria-label')||button.textContent.trim())`);
   assert.deepEqual(buttons,['最小化','最大化','ピン留め（最前面を維持）','終了']);
   if(buttonsOnly)await headingShot('startup-no-all');
   await evaluate(owner,`[...document.querySelectorAll('button')].find(b=>b.textContent==='オフライン利用').click()`);
   await until(()=>evaluate(owner,'!!window.aidiyIDE'),'宇宙表示');
   assert.equal(await evaluate(owner,`document.querySelectorAll('.window-all').length`),1,'利用開始後の3DではALLを表示');
   if(buttonsOnly)await headingShot('3d-all');
   await evaluate(owner,`aidiyIDE.setAutoSpin(false);aidiyIDE.interact();window.originalSpace=aidiyIDE;document.querySelector('.explorer-toggle').click();document.querySelectorAll('.ide-view-modes button')[1].click()`);
   await until(()=>evaluate(owner,`!!document.querySelector('.explorer-panel')`),'Explorer');
   assert.equal(await evaluate(owner,`document.querySelectorAll('.window-all').length`),0,'2DではALLを非表示');
   if(buttonsOnly){
    await headingShot('2d-no-all');
    await evaluate(owner,`document.querySelectorAll('.ide-view-modes button')[0].click()`);
    await until(()=>evaluate(owner,`!!document.querySelector('.window-all')`),'3Dへ戻すとALLを再表示');
    await checkWeb();
    const result={testPassed:true,scope:'ALL button visibility',startupHidden:true,only3D:true,webHidden:true,shots:['startup-no-all','3d-all','2d-no-all'].map(name=>join(output,`${stamp}_${name}.png`))};
    writeFileSync(join(output,'buttons-result.json'),JSON.stringify(result,null,2));process.send?.(result);app.exit(0);return;
   }
   await evaluate(owner,`aidiyIDE.goTo({type:'file',path:'sample.txt'})`);
   if(viewerOnly){
    await until(()=>evaluate(owner,`!!document.querySelector('.viewer-popup .viewer-meta')`),'余白確認のビューア表示');
    await checkViewerSpacing('.viewer-popup',false);await spacingShot('normal-viewer-spacing');
    const saved=owner.getBounds();
    for(const [width,height] of [[900,500],[1280,720]]){
     owner.setBounds({...saved,width,height});await sleep(250);await checkViewerSpacing('.viewer-popup',false);await spacingShot(`normal-viewer-spacing-${width}x${height}`);
    }
    owner.setBounds(saved);await sleep(250);
   }
   if(process.env.AIDIY_OPENING_ONLY==='1'){
    await until(()=>evaluate(owner,`!!document.querySelector('.viewer-popup .viewer-meta')`),'ビューア表示');
    const shots=[],capture=async(window,name)=>{const shot=join(output,`${stamp}_opening-clean-${name}.png`);writeFileSync(shot,(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());shots.push(shot);};
    await sleep(850);assert.equal(await evaluate(owner,`document.querySelectorAll('.opening-shine,.opening-shine-band').length`),0);await capture(owner,'inline');
    for(const [label,title] of [['エクスプローラーを別ウィンドウで開く','Explorer']]){
     const before=new Set(BrowserWindow.getAllWindows().map(window=>window.id));
     await evaluate(owner,`document.querySelector('[aria-label="${label}"]').click()`);
     let child;await until(()=>{child=BrowserWindow.getAllWindows().find(w=>!before.has(w.id)&&w.webContents.getURL()==='about:blank');return child&&shownWindows.includes(child.id);},title+'表示');
     await sleep(850);assert.equal(await evaluate(child,'window.openingShines'),0);assert.equal(await evaluate(child,`document.querySelectorAll('.opening-shine,.opening-shine-band').length`),0);await capture(child,title);
    }
    const result={testPassed:true,scope:'opening without shine',shots};writeFileSync(join(output,'opening-result.json'),JSON.stringify(result,null,2));process.send?.(result);app.exit(0);return;
   }
   await until(()=>evaluate(owner,`!!document.querySelector('.viewer-history')`),'比較入口');
   await evaluate(owner,`document.querySelector('.viewer-history').click()`);
   await until(()=>evaluate(owner,`!!document.querySelector('.history-embedded .file-history-changes')&&!document.querySelector('.file-history-changes').textContent.includes('計算中')`),'比較表示');
   await evaluate(owner,`document.querySelectorAll('.ide-view-modes button')[0].click();window.originalCompare=document.querySelector('.history-embedded');window.originalViewer=document.querySelector('.viewer-session');window.originalExplorer=document.querySelector('.explorer-panel');window.originalRoutes=document.querySelector('.explorer-routes')`);
   await until(()=>evaluate(owner,`!!document.querySelector('.window-all')`),'3Dへ戻すとALLを再表示');
   if(viewerOnly){await checkViewerSpacing('.history-embedded',false);await spacingShot('normal-comparison-spacing');}
   // 閉じた軌跡バーの矩形は0になる。移行前の位置を比較するため先に表示する。
   await evaluate(owner,`document.querySelector('.route-restore-toggle')?.click()`);
   await until(()=>evaluate(owner,`document.querySelector('.explorer-routes')?.getBoundingClientRect().width>0`),'軌跡バーを表示して位置を測定');
   const originals=await evaluate(owner,`['.explorer-panel','.explorer-routes','.history-embedded'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height}})`);
   const expectedPanels=originals.map((rect,index)=>panelBounds(index===1?{...rect,width:360,height:38}:rect,{window:owner},screen,index===1?'panel-routes':index===2?'panel-viewer':'explorer'));
   const original=owner.getBounds(),displays=screen.getAllDisplays(),expected=displayBounds(displays);
   if(process.platform==='win32'){expected.x-=2;expected.y-=2;expected.width+=4;expected.height+=4;}
   await evaluate(owner,`document.querySelector('.window-all').click()`);
   await until(()=>evaluate(owner,`document.querySelector('.all-transition')?.textContent.includes('VR空間へ移行中')`),'切り替え中表示');near(owner.getBounds(),original);
   await until(()=>evaluate(owner,`document.querySelector('.window-all').getAttribute('aria-pressed')==='true'`),'ALL開始');
   await sleep(300);
   near(owner.getBounds(),expected);
   const children=BrowserWindow.getAllWindows().filter(window=>window!==owner&&window.webContents.getURL()==='about:blank');assert.equal(children.length,2);
   const explorerChild=children.find(w=>w.webContents.getTitle().includes('/ Explorer'));
   const routesChild=children.find(w=>w.webContents.getTitle().includes('/ 軌跡'));
   const checkBarClose=async visible=>{
    await until(()=>evaluate(explorerChild,`document.querySelector('[aria-label="終了"]')?.disabled===${!visible}&&!!document.querySelector('[aria-label="エクスプローラーを閉じる"]')===${visible}`),'Explorerの閉じる操作');
    await until(()=>evaluate(routesChild,`!document.querySelector('.route-window-actions .window-close')&&!!document.querySelector('.route-window-actions .panel-return')===${visible}&&!!document.querySelector('[aria-label="軌跡バーを閉じる"]')===${visible}`),'軌跡の閉じる操作');
   };
   await checkBarClose(false);
   const checkBarsClosed=async()=>{
    await until(()=>BrowserWindow.getAllWindows().every(w=>w===owner||!['AiDiy IDE / Explorer','AiDiy IDE / 軌跡'].includes(w.webContents.getTitle())),'ALL解除でExplorer・軌跡の別窓を終了');
    await until(()=>evaluate(owner,`originalExplorer.ownerDocument===document&&originalRoutes.ownerDocument===document&&getComputedStyle(originalExplorer).display==='none'&&getComputedStyle(originalRoutes).display==='none'&&!!document.querySelector('.explorer-toggle')&&!!document.querySelector('.route-restore-toggle')`),'本体へDOMを回収して閉じる');
   };
   for(const child of children){assert.equal(child.getParentWindow(),null);assert.equal(child.isAlwaysOnTop(),true,`${child.webContents.getTitle()} の前面維持`);}
   for(const child of children){
    assert.equal(await evaluate(child,'window.openingShines'),0,`${child.webContents.getTitle()} に登場後の光沢を出さない`);
   }
   const assertPinOrder=windows=>{
    const explorer=windows.find(w=>w.webContents.getTitle().includes('/ Explorer')),routes=windows.find(w=>w.webContents.getTitle().includes('/ 軌跡'));
    assert.ok(explorer&&routes);
    assert.ok(shownWindows.indexOf(explorer.id)>=0&&shownWindows.indexOf(routes.id)>shownWindows.indexOf(explorer.id),'Explorerの別窓を表示してから軌跡の別窓を表示する');
   };
   assertPinOrder(children);
   for(const [index,key] of ['originalExplorer','originalRoutes'].entries()){
    assert.equal(await evaluate(owner,`${key}.ownerDocument!==document&&${key}.ownerDocument.contains(${key})`),true);
    const child=children.find(window=>window.webContents.getTitle().includes(index===0?'Explorer':index===1?'軌跡':'Viewer'));assert.ok(child);
    const bounds=child.getBounds(),target=expectedPanels[index];
    // 軌跡は内容に合わせて高さを更新する。位置と幅は切替前の矩形を保つ。
    if(index===1){assert.ok(Math.abs(bounds.x-target.x)<=2,JSON.stringify({bounds,target}));assert.ok(Math.abs(bounds.y-target.y)<=2);assert.ok(Math.abs(bounds.width-target.width)<=4,'透明窓の外枠・DPI丸めを含む軌跡の幅');}else near(bounds,target);
   }
   assert.equal(await evaluate(owner,`originalViewer.ownerDocument===document&&originalCompare===originalViewer.querySelector('.history-embedded')`),true,'ALL移行で閲覧・比較DOMを別窓にしない');
   assert.equal(await evaluate(owner,'aidiyIDE===originalSpace'),true);
   assert.equal(owner.isResizable(),false);assert.equal(owner.isMovable(),false);
   const state=await evaluate(owner,`aidiyWindow.allDisplays('state')`);assert.equal(state.displayCount,displays.length);
   if(process.env.AIDIY_ALL_F11_ONLY==='1'){
    for(const source of ['ide','explorer']){
     const target=source==='ide'?owner:BrowserWindow.getAllWindows().find(w=>w.webContents.getTitle()==='AiDiy IDE / Explorer');
     target.focus();target.webContents.sendInputEvent({type:'keyDown',keyCode:'F11'});target.webContents.sendInputEvent({type:'keyUp',keyCode:'F11'});
     await until(()=>evaluate(owner,`!document.querySelector('.all-restore-button')`),'F11でVR解除: '+source);
     near(owner.getBounds(),original);await checkBarsClosed();
     owner.focus();owner.webContents.sendInputEvent({type:'keyDown',keyCode:'F11'});owner.webContents.sendInputEvent({type:'keyUp',keyCode:'F11'});
     await sleep(200);assert.equal(await evaluate(owner,`!!document.querySelector('.all-restore-button')`),false,'通常時のF11ではVRへ入らない');
     if(source==='ide'){
      await evaluate(owner,`document.querySelector('.window-all').click()`);
      await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-transition')`),'VR再移行');
     }
    }
    const shot=join(output,`${stamp}_f11-restored.png`);writeFileSync(shot,(await owner.webContents.capturePage()).toPNG());
    const result={testPassed:true,scope:'VR F11 exit only',displayCount:displays.length,sources:['ide','explorer'],normalDoesNotEnter:true,shot};
    process.send?.(result);app.exit(0);return;
   }
   if(process.env.AIDIY_ALL_PANEL_POSITION_ONLY==='1'){
    const result=await require('./vr-panel-placement-probe.cjs').checkVRPanelPlacement(owner,{evaluate,until,output,stamp});
    writeFileSync(join(output,'panel-position-result.json'),JSON.stringify(result,null,2));process.send?.(result);app.exit(0);return;
   }
   if(process.env.AIDIY_ALL_CENTER_ONLY==='1'){
    const result=await require('./ide-center-move-probe.cjs').checkIdeCenter(owner,{evaluate,until,output,stamp,near});
    writeFileSync(join(output,'center-result.json'),JSON.stringify(result,null,2));process.send?.(result);app.exit(0);return;
   }
   if(process.env.AIDIY_ALL_EDGE_ONLY==='1'){
    const area=displayBounds(displays),actual=owner.getBounds();
    if(process.platform==='win32'){assert.ok(actual.x<area.x&&actual.y<area.y);assert.ok(actual.x+actual.width>area.x+area.width&&actual.y+actual.height>area.y+area.height);}
    const shot=join(output,`${stamp}_vr-top.png`);
    writeFileSync(shot,(await owner.webContents.capturePage({x:0,y:0,width:1000,height:80},{stayHidden:true,stayAwake:true})).toPNG());
    const roundTrips=[];
    for(let i=0;i<5;i++){
     await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-restore-button').disabled`),'VR移行完了後の復帰操作');await evaluate(owner,`document.querySelector('.all-restore-button').click()`);
     await until(()=>evaluate(owner,`!document.querySelector('.all-restore-button')`),'VR復帰');assert.deepEqual(owner.getBounds(),original,'VR往復で通常窓の位置・寸法を完全に維持');await checkBarsClosed();
     roundTrips.push(owner.getBounds());
     if(i<4){await evaluate(owner,`document.querySelector('.window-all').click()`);await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-transition')`),'VR再移行');near(owner.getBounds(),expected);}
    }
    const result={testPassed:true,scope:'VR frame coverage',displayCount:displays.length,displays:displays.map(d=>({bounds:d.bounds,scaleFactor:d.scaleFactor})),coverage:actual,original,restored:owner.getBounds(),roundTrips:5,restoredBounds:roundTrips,shot};
    writeFileSync(join(output,'edge-result.json'),JSON.stringify(result,null,2));process.send?.(result);app.exit(0);return;
   }
   assert.equal(await evaluate(owner,`document.querySelector('.ide-heading').getBoundingClientRect().height`),0);
   assert.equal(await evaluate(owner,`[...document.querySelectorAll('.space-flight-controls,.space-filter-toggle,.space-breadcrumb,.explorer-toggle,.route-restore-toggle')].every(node=>getComputedStyle(node).display==='none')`),true);
   const checkInline=async selector=>{
    const r=await evaluate(owner,`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,center:parseFloat(document.querySelector('.space-view').style.getPropertyValue('--focus-x'))||innerWidth/2,viewportWidth:innerWidth,viewportHeight:innerHeight,visible:getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none',count:document.querySelectorAll('.viewer-session').length};})()`);
    assert.equal(r.visible,true);assert.equal(r.count,1);
    const expectedLeft=Math.max(16,Math.min(r.center+128,r.viewportWidth-r.width-16));
    assert.ok(Math.abs(r.x-expectedLeft)<2,'中心星の128px右を基本に、画面右端の余白へ収める: '+JSON.stringify(r));
    assert.ok(r.width<=641&&r.width>100&&r.right<=r.viewportWidth+1&&r.bottom<=r.viewportHeight+1,JSON.stringify(r));if(viewerOnly)await checkViewerSpacing(selector,true);return r;
   };
   await checkInline('.history-embedded');
   const checkInlineViewer=async()=>{
    const shots=[];
    const capture=async name=>{
     await checkInline(documentSelector);
     await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await sleep(500);
     const image=await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
     const path=join(output,`${stamp}_${name}.png`);writeFileSync(path,image.toPNG());shots.push(path);
    };
    let documentSelector='.history-embedded';await capture('all-inline-comparison');
    const count=()=>BrowserWindow.getAllWindows().filter(w=>w!==owner&&w.webContents.getURL()==='about:blank').length;
    await evaluate(owner,`aidiyIDE.setFastWarp(true);aidiyIDE.goTo({type:'file',path:'second.txt'})`);
    await until(()=>evaluate(owner,`!!document.querySelector('[data-viewer-path="second.txt"] .viewer-meta')`),'ALL中の新規ファイルをIDE内に表示');
    assert.equal(count(),2);documentSelector='.viewer-popup';await capture('all-inline-viewer');
    await evaluate(owner,`window.secondViewer=document.querySelector('.viewer-session');aidiyIDE.goTo({type:'file',path:'second.txt'})`);await sleep(200);
    assert.equal(await evaluate(owner,`secondViewer===document.querySelector('.viewer-session')`),true);assert.equal(count(),2);
    await until(()=>evaluate(owner,`!!document.querySelector('.viewer-history')`),'再選択後の比較入口');
    await evaluate(owner,`document.querySelector('.viewer-history').click()`);
    await until(()=>evaluate(owner,`!!document.querySelector('.file-history-changes')&&!document.querySelector('.file-history-changes').textContent.includes('計算中')`),'ALL中の比較も同じIDE内パネル');
    await checkInline('.history-embedded');assert.equal(count(),2);
    await evaluate(owner,`document.querySelector('[aria-label="ソース比較を別ウィンドウで開く"]').click()`);
    let pinned;
    await until(async()=>{pinned=BrowserWindow.getAllWindows().find(w=>w.webContents.getTitle().includes('Viewer - second.txt'));return pinned&&await evaluate(pinned,`!!document.querySelector('.history-embedded')`);},'明示的なピン留めだけ別窓にする');
    await until(()=>evaluate(owner,`!document.querySelector('.viewer-session')`),'ピン留め後はIDE内から移す');
    assert.equal(count(),3);assert.equal(pinned.getParentWindow(),null);
    await evaluate(owner,`aidiyIDE.goTo({type:'file',path:'sample.txt'})`);
    await until(()=>evaluate(owner,`!!document.querySelector('[data-viewer-path="sample.txt"] .viewer-meta')`),'次のファイルは再びIDE内に表示');
    await checkInline('.viewer-popup');assert.equal(count(),3);
    await evaluate(owner,`aidiyIDE.goTo({type:'file',path:'second.txt'})`);await sleep(200);
    assert.equal(count(),3);assert.equal(await evaluate(owner,`document.querySelectorAll('.viewer-session').length`),0,'既にピン留めしたファイルの再選択で重複を作らない');
    await evaluate(owner,`aidiyIDE.goTo({type:'file',path:'sample.txt'})`);
    await until(()=>evaluate(owner,`!!document.querySelector('[data-viewer-path="sample.txt"] .viewer-meta')`),'復帰前のIDE内ビューアー');
    await checkInline('.viewer-popup');
    return{shots,pinned};
   };
   if(viewerOnly){
    const {shots,pinned}=await checkInlineViewer();
    assert.equal(await evaluate(pinned,`!!document.querySelector('[aria-label="終了"]')`),true,'手動ピン留めしたビューアーはALL中も閉じられる');
    const captureBars=async suffix=>{
     for(const [name,child] of [['explorer',explorerChild],['routes',routesChild]]){
      await child.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await sleep(500);
      const image=await child.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
      const size=image.getSize(),file=join(output,`${stamp}_${name}-${suffix}.png`);
      writeFileSync(file,image.crop({x:0,y:0,width:size.width,height:Math.min(size.height,160)}).toPNG());shots.push(file);
     }
    };
    await captureBars('all-no-close');
    await evaluate(owner,`window.inlineBeforeRestore=document.querySelector('.viewer-session');document.querySelector('.all-restore-button').click()`);
    await until(()=>evaluate(owner,`!document.querySelector('.all-restore-button')`),'ALL解除');
    await checkBarsClosed();
    assert.equal(explorerChild.isDestroyed(),true);assert.equal(routesChild.isDestroyed(),true);
    assert.equal(pinned.isDestroyed(),false,'手動ピン留めしたビューアーは残す');
    await evaluate(owner,`document.querySelector('.explorer-toggle').click();document.querySelector('.route-restore-toggle').click()`);
    await until(()=>evaluate(owner,`getComputedStyle(originalExplorer).display!=='none'&&getComputedStyle(originalRoutes).display!=='none'`),'通常画面から両方を再表示');
    assert.equal(await evaluate(owner,`originalExplorer===document.querySelector('.explorer-panel')&&originalRoutes===document.querySelector('.explorer-routes')`),true,'再表示でもDOMと状態を維持');
    await headingShot('normal-bars-reopened');shots.push(join(output,`${stamp}_normal-bars-reopened.png`));
    assert.equal(await evaluate(owner,`inlineBeforeRestore===document.querySelector('.viewer-session')&&getComputedStyle(document.querySelector('.viewer-popup')).visibility==='visible'`),true,'ALL解除後も閲覧を維持');
    await checkViewerSpacing('.viewer-popup',false);await spacingShot('restored-viewer-spacing');
    await evaluate(owner,`document.querySelector('.window-all').click()`);
    await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-transition')`),'再表示後のALL再開始');
    await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-restore-button').disabled`),'VR移行完了後の復帰操作');await evaluate(owner,`document.querySelector('.all-restore-button').click()`);
    await checkBarsClosed();
    const result={testPassed:true,scope:'ALL inline viewer',displayCount:displays.length,autoPinned:['explorer','routes'],barCloseHiddenInAll:true,barsClosedOnExit:true,barsReopened:true,repeatedExit:true,viewerClosePreserved:true,inlineComparison:true,reuseSingleViewer:true,manualPin:true,viewerSpacingChecks,viewerSpacingShots,shots};
    writeFileSync(join(output,'viewer-result.json'),JSON.stringify(result,null,2));process.send?.(result);app.exit(0);return;
   }
   const zone=await evaluate(owner,`(()=>{const r=document.querySelector('.all-restore-zone[data-display-id="${screen.getPrimaryDisplay().id}"]').getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,width:r.width}})()`),area=screen.getPrimaryDisplay().workArea,zoom=owner.webContents.getZoomFactor();
   // OSで丸められた実際の窓原点を使う。理想の外接矩形との差を二重に足さない。
   assert.ok(Math.abs(zone.right*zoom-(area.x+area.width-state.bounds.x))<=2);assert.ok(Math.abs(zone.y*zoom-(area.y-state.bounds.y))<=2);
   owner.webContents.sendInputEvent({type:'mouseMove',x:400,y:400});await sleep(200);
   assert.equal(await evaluate(owner,`getComputedStyle(document.querySelector('.all-restore-button')).opacity`),'0');
   // 非表示の実Electronでも最新フレームを撮影する。
   owner.webContents.invalidate();await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await sleep(500);
   const shot=join(output,`${stamp}_all.png`);writeFileSync(shot,(await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
   const button=await evaluate(owner,`(()=>{const r=document.querySelector('.all-restore-button').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
   owner.webContents.sendInputEvent({type:'mouseMove',...button});await until(()=>evaluate(owner,`getComputedStyle(document.querySelector('.all-restore-button')).opacity==='1'`),'右上ホバー');
   const hoverShot=join(output,`${stamp}_hover.png`);writeFileSync(hoverShot,(await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
   owner.webContents.sendInputEvent({type:'mouseMove',x:400,y:400});await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await until(()=>evaluate(owner,`getComputedStyle(document.querySelector('.all-restore-button')).opacity==='0'`),'右上から離れると非表示');
   await evaluate(owner,`document.querySelector('.all-restore-button').focus()`);await until(()=>evaluate(owner,`getComputedStyle(document.querySelector('.all-restore-button')).opacity==='1'`),'キーボード復帰');
   await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-restore-button').disabled`),'VR移行完了後の復帰操作');await evaluate(owner,`document.querySelector('.all-restore-button').click()`);
   await until(()=>evaluate(owner,`document.querySelector('.window-all').getAttribute('aria-pressed')==='false'`),'ALL解除');near(owner.getBounds(),original);await checkBarsClosed();
   assert.ok(await evaluate(owner,`document.querySelector('.ide-heading').getBoundingClientRect().height>0&&!document.querySelector('.all-restore-zone')`));
   await headingShot('3d-all');
   await evaluate(owner,`document.querySelectorAll('.ide-view-modes button')[1].click()`);
   await until(()=>evaluate(owner,`!document.querySelector('.window-all')`),'復帰後の2DでもALLを非表示');
   await headingShot('2d-no-all');
   await evaluate(owner,`document.querySelectorAll('.ide-view-modes button')[0].click()`);
   await until(()=>evaluate(owner,`!!document.querySelector('.window-all')`),'復帰後も3DでALLを再表示');
   assert.equal(owner.isResizable(),true);assert.equal(owner.isMovable(),true);
   for(const child of children)assert.equal(child.isDestroyed(),true,'ALL解除で両方の別窓を終了');
   await evaluate(owner,`document.querySelector('.window-all').click()`);await until(()=>evaluate(owner,`document.querySelector('.window-all').getAttribute('aria-pressed')==='true'`),'ALL再開始');
   assert.equal(BrowserWindow.getAllWindows().filter(w=>w===owner||w.webContents.getURL()==='about:blank').length,3);
   await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-restore-button').disabled`),'VR移行完了後の復帰操作');await evaluate(owner,`document.querySelector('.all-restore-button').click()`);await until(()=>evaluate(owner,`!document.querySelector('.all-restore-button')`),'再解除');
   owner.maximize();await until(()=>owner.isMaximized(),'通常最大化');
   await evaluate(owner,`document.querySelector('.window-all').click()`);await until(()=>evaluate(owner,`document.querySelector('.window-all').getAttribute('aria-pressed')==='true'`),'最大化からALL');
   near(owner.getBounds(),expected);assert.equal(owner.isMaximized(),false);
   await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-restore-button').disabled`),'VR移行完了後の復帰操作');await evaluate(owner,`document.querySelector('.all-restore-button').click()`);await until(()=>owner.isMaximized(),'元の最大化へ復帰');
   owner.unmaximize();await sleep(300);near(owner.getBounds(),original);
   await checkBarsClosed();
   await until(()=>evaluate(owner,`originalExplorer.ownerDocument===document&&getComputedStyle(originalExplorer).display==='none'&&originalRoutes.ownerDocument===document&&getComputedStyle(originalRoutes).display==='none'`),'エクスプローラーと軌跡を閉じる');
   await evaluate(owner,`document.querySelector('.window-all').click()`);await until(()=>evaluate(owner,`document.querySelector('.window-all').getAttribute('aria-pressed')==='true'`),'閉じていたパネルも自動ピン留め');
   assert.equal(BrowserWindow.getAllWindows().filter(w=>w===owner||w.webContents.getURL()==='about:blank').length,3);assert.equal(await evaluate(owner,`originalExplorer.ownerDocument!==document&&originalRoutes.ownerDocument!==document`),true);
   const reopened=BrowserWindow.getAllWindows(),explorerBounds=reopened.find(w=>w.webContents.getTitle().includes('/ Explorer')).getBounds(),routesBounds=reopened.find(w=>w.webContents.getTitle().includes('/ 軌跡')).getBounds();
   assert.ok(routesBounds.x>=explorerBounds.x+explorerBounds.width-2,'閉じていたExplorerの裏へ軌跡バーを重ねない');
   assertPinOrder(reopened);
   const {shots:inlineShots,pinned:newViewer}=await checkInlineViewer();
   const viewerBounds=newViewer.getBounds(),newPanelShot=inlineShots.at(-1);
   await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-restore-button').disabled`),'VR移行完了後の復帰操作');await evaluate(owner,`document.querySelector('.all-restore-button').click()`);await until(()=>evaluate(owner,`!document.querySelector('.all-restore-button')`),'最終復帰');near(owner.getBounds(),original);
   near(newViewer.getBounds(),viewerBounds);assert.equal(newViewer.getParentWindow(),null);
   // preloadのない通常Web環境でも同じ実画面を読み、--browserの表示条件を確認する。
   await checkWeb();
   const result={testPassed:true,displays:displays.map(d=>({bounds:d.bounds,scaleFactor:d.scaleFactor})),all:expected,restored:original,autoPinned:['explorer','routes'],pinOrder:['explorer','routes'],closedPanelsPinned:true,barsClosedOnExit:true,newViewerAndComparison:true,nativeOwnedPanels:true,zone,shot,hoverShot,newPanelShot};
   writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));process.send?.(result);app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
 });
});
setTimeout(()=>{console.error('ALL確認期限');app.exit(1);},90000).unref();
require('../desktop.cjs');
