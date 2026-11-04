// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 本番の共有helperを隔離した合成画面で検証。AI接続・保存・メッセージ送信はしない。
// sandboxを維持する。headlessで実行してもOS固有のdropdown popup確認の代わりにはしない。
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const kind=process.env.AIDIY_TEST_WINDOW_KIND||'code';
assert.ok(['code','task','team'].includes(kind),'isolated input probe kind');
const output=fs.mkdtempSync(path.join(os.tmpdir(),`aidiy-native-input-${kind}-`));
const {installNativeWindowMove}=require('../デスクトップ/長押し窓移動.cjs');
app.on('window-all-closed',()=>{});app.disableHardwareAcceleration();app.setPath('userData',path.join(output,'profile'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const html=`<style>body{margin:0;background:#edf5ff}#bg{position:absolute;left:20px;top:100px;width:500px;height:250px;background:#cde}select{font:18px sans-serif;height:38px}dialog{width:400px;height:220px}#modal-bg{height:100px}</style><select id="select"><option value="codex_cli">Codex</option><option value="aidiy_hermes">Hermes</option></select><select id="list" size="2" style="height:65px"><option value="codex_cli">Codex</option><option value="aidiy_hermes">Hermes</option></select><div id="bg">Background pointer target</div><dialog><div id="modal-bg">Modal background</div><select id="modal-select"><option value="codex_cli">Codex</option><option value="aidiy_hermes">Hermes</option></select></dialog><script>window.events=[];window.dragging=false;window.backgroundClicks=0;for(const t of ['pointerdown','mousedown','pointercancel','pointerup','mouseup','click','change'])document.addEventListener(t,e=>events.push({type:e.type,target:e.target.id,trusted:e.isTrusted}),true);bg.onpointerdown=e=>{dragging=true;bg.setPointerCapture(e.pointerId)};bg.onpointercancel=()=>dragging=false;bg.onpointerup=()=>{if(dragging)backgroundClicks++;dragging=false};</script>`;
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:650,height:450,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}}),c=win.webContents;
 let begins=0;const dispose=installNativeWindowMove({record:{window:win,kind},screen:{getCursorScreenPoint:()=>({x:100,y:100})},drag:{forRecord:()=>({begin:()=>{begins++;return'token'},end(){},move:()=>true})}});
 await win.loadURL('data:text/html,'+encodeURIComponent(html));c.enableDeviceEmulation({screenPosition:'desktop',screenSize:{width:650,height:450},viewPosition:{x:0,y:0},viewSize:{width:650,height:450},deviceScaleFactor:1,scale:1});win.show();c.focus();await sleep(250);
 const runs=[];
 const js=code=>c.executeJavaScript(code),point=selector=>js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
 const input=(type,p)=>c.sendInputEvent({type,...p,button:'left',clickCount:1});
 async function hold(selector,expectedDrag,ending='release'){
  await js('events=[]');const p=await point(selector),before=begins;input('mouseDown',p);await sleep(100);assert.deepEqual((await js('events')).slice(0,2).map(e=>e.type),['pointerdown','mousedown']);await sleep(650);
  const active=await js(`({overlay:!!document.querySelector('[data-aidiy-window-move]'),dragging,events:events.slice()})`);assert.equal(begins-before,expectedDrag?1:0,selector+' movement');assert.equal(active.overlay,expectedDrag,selector+' overlay');
  if(expectedDrag){assert.equal(active.dragging,false);assert.ok(active.events.some(e=>e.type==='pointercancel'));}
  if(ending==='escape'){c.sendInputEvent({type:'keyDown',keyCode:'Escape'});c.sendInputEvent({type:'keyUp',keyCode:'Escape'});await sleep(80);}
  input('mouseUp',p);await sleep(150);const after=await js(`({events:events.slice(),overlay:!!document.querySelector('[data-aidiy-window-move]'),dragging,backgroundClicks})`);
  assert.equal(after.overlay,false);assert.equal(after.events.filter(e=>e.type==='pointerup').length,1);assert.equal(after.events.filter(e=>e.type==='mouseup').length,1);
  if(expectedDrag){assert.equal(after.events.filter(e=>e.type==='click').length,0);assert.equal(after.backgroundClicks,0);assert.equal(after.dragging,false);}
  runs.push({selector,expectedDrag,ending,active,after});
 }
 await hold('#bg',true);await hold('#bg',true,'escape');
 const p=await point('#bg');input('mouseDown',p);await sleep(80);input('mouseUp',p);await sleep(80);assert.equal(await js('backgroundClicks'),1);await js('backgroundClicks=0');
 await hold('#select',false);for(const keyCode of ['Home','Down','Return']){c.sendInputEvent({type:'keyDown',keyCode});c.sendInputEvent({type:'keyUp',keyCode});}await sleep(100);assert.equal(await js('select.value'),'aidiy_hermes');
 const list=await point('#list option[value="aidiy_hermes"]');input('mouseDown',list);input('mouseUp',list);await sleep(100);assert.equal(await js('list.value'),'aidiy_hermes');
 await js(`document.querySelector('dialog').showModal()`);await hold('#modal-bg',false);await hold('#modal-select',false);
 for(const keyCode of ['Home','Down','Return']){c.sendInputEvent({type:'keyDown',keyCode});c.sendInputEvent({type:'keyUp',keyCode});}await sleep(100);assert.equal(await js(`document.querySelector('#modal-select').value`),'aidiy_hermes');
 const screenshot=await c.capturePage(),screenshotSize=screenshot.getSize(),screenshotUsable=screenshotSize.width>1&&screenshotSize.height>1;
 if(screenshotUsable)fs.writeFileSync(path.join(output,'native-input.png'),screenshot.toPNG());
 const result={electron:process.versions.electron,chrome:process.versions.chrome,sandbox:true,coverage:'native input, listbox and DOM dialog; OS dropdown popup and window bounds require real desktop',output,screenshotUsable,screenshotSize,nativeSelectKeyboard:true,twoRowMouseSelection:true,modalSelectKeyboard:true,nextBackgroundClick:true,runs};fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log('GESTURE_PROBE_RESULT '+JSON.stringify(result));dispose();win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)});setTimeout(()=>app.exit(2),18000).unref();
