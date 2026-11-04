// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const assert=require('node:assert/strict');
const {screen}=require('electron');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function checkIdeCenter(owner,{evaluate,until,output,stamp,near}){
 const contents=owner.webContents,originalFocus=owner.isFocused,originalCursor=screen.getCursorScreenPoint;
 let cursor={x:400,y:400};owner.isFocused=()=>true;screen.getCursorScreenPoint=()=>({...cursor});
 const results=[],shots=[];
 const snapshot=()=>evaluate(owner,`({center:aidiyIDE.projection,selected:aidiyIDE.selected?.path,trail:aidiyIDE.trail.join('/'),width:innerWidth,height:innerHeight,marker:(()=>{const r=document.querySelector('[data-aidiy-move-marker]')?.getBoundingClientRect();return r&&{x:r.x,y:r.y,width:r.width,height:r.height}})()})`);
 async function gesture(vr,dx,dy,ending='release'){
  console.log('中心移動確認: 開始', {vr,dx,dy,ending});
  const zoom=contents.getZoomFactor(),point={x:Math.round(240*zoom),y:Math.round(240*zoom)};
  const bounds=owner.getBounds(),before=await snapshot();cursor={x:400,y:400};
  await evaluate(owner,`window.centerMoveInputs=[];window.centerMoveListener=e=>centerMoveInputs.push(e.type);for(const name of ['pointerdown','mousedown','pointercancel','pointerup','mouseup','click'])document.addEventListener(name,centerMoveListener,true)`);
  contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
  await sleep(400);assert.deepEqual(owner.getBounds(),bounds);assert.equal((await snapshot()).marker,undefined);
  assert.deepEqual(await evaluate(owner,'centerMoveInputs'),['pointerdown','mousedown'],'背景への押下を遅延・再送しない');
  await until(async()=>!!(await snapshot()).marker,'長押しの共通マーカー');
  const marker=(await snapshot()).marker;assert.ok(Math.abs(marker.width-28)<.01);assert.ok(Math.abs(marker.height-28)<.01);
  cursor={x:400+dx,y:400+dy};contents.sendInputEvent({type:'mouseMove',x:point.x+dx,y:point.y+dy,modifiers:['leftButtonDown']});
  // VR切替直後はOSの端数DPIでviewportが1px変わる場合がある。画面中央からの補正量を比較する。
  await until(async()=>{const current=await snapshot();return vr?Math.abs(current.center.x-current.width/2-(before.center.x-before.width/2)-dx/zoom)<.01&&Math.abs(current.center.y-current.height/2-(before.center.y-before.height/2)-dy/zoom)<.01&&Math.abs(current.marker.x-marker.x-dx/zoom)<.01:Math.abs(owner.getBounds().x-bounds.x-dx)<=2;},'ドラッグ量への追従');
  const after=await snapshot();
  if(vr){assert.deepEqual(owner.getBounds(),bounds);assert.ok(Math.abs(after.marker.y-marker.y-dy/zoom)<.01);}
  else near(owner.getBounds(),{...bounds,x:bounds.x+dx,y:bounds.y+dy});
  assert.equal(after.selected,before.selected);assert.equal(after.trail,before.trail);
  if(vr&&shots.length===0){
   const rect={x:150,y:150,width:500,height:300},options={stayHidden:true,stayAwake:true};
   contents.invalidate();await contents.capturePage(rect,options);await sleep(500);
   const path=join(output,`${stamp}_vr-center-marker.png`);writeFileSync(path,(await contents.capturePage(rect,options)).toPNG());shots.push(path);
  }
  if(ending==='escape')contents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  if(ending==='blur')owner.emit('blur');
  contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x+dx,y:point.y+dy});
  await until(async()=>!(await snapshot()).marker,'マーカー解除');
  await until(async()=> (await evaluate(owner,'centerMoveInputs')).includes('mouseup'),'元の解放を配信');
  assert.deepEqual(await evaluate(owner,`centerMoveInputs`),['pointerdown','mousedown','pointercancel','pointerup','mouseup'],'元のpointer操作を取消し、解放は渡してclickだけを抑止する');
  await evaluate(owner,`for(const name of ['pointerdown','mousedown','pointercancel','pointerup','mouseup','click'])document.removeEventListener(name,centerMoveListener,true)`);
  results.push({vr,zoom,dx,dy,ending,before:before.center,after:after.center,bounds:owner.getBounds()});
 }
 try{
  await until(()=>evaluate(owner,`aidiyIDE.projection.x===innerWidth/2`),'初期VR中心');
  await gesture(true,60,30);
  await gesture(true,-30,-60);
  const center=await snapshot();
  await evaluate(owner,`aidiyIDE.clear()`);await sleep(400);
  assert.deepEqual((await snapshot()).center,center.center,'ビューアを閉じても中心補正を維持');
  contents.setZoomFactor(1.5);await sleep(500);
  await gesture(true,60,-30,'blur');
  await gesture(true,-30,60,'escape');
  const corrected=await snapshot(),offset={x:corrected.center.x-corrected.width/2,y:corrected.center.y-corrected.height/2};
  await evaluate(owner,`document.querySelector('.all-restore-button').click()`);
  await until(()=>evaluate(owner,`!document.querySelector('.all-restore-button')`),'通常モードへ復帰');await sleep(500);
  await gesture(false,48,24);
  await gesture(false,-24,-12);
  // 0.5秒以内のドラッグは既存の宇宙旋回へ渡し、窓移動を始めない。
  const bounds=owner.getBounds();cursor={x:400,y:400};
  contents.sendInputEvent({type:'mouseDown',button:'left',x:300,y:300});cursor={x:420,y:400};
  contents.sendInputEvent({type:'mouseMove',x:320,y:300,modifiers:['leftButtonDown']});
  contents.sendInputEvent({type:'mouseUp',button:'left',x:320,y:300});await sleep(200);
  assert.deepEqual(owner.getBounds(),bounds);assert.equal((await snapshot()).marker,undefined);
  await evaluate(owner,`document.querySelector('.window-all').click()`);
  await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-transition')`),'VR再移行');
  await until(async()=>{const s=await snapshot();return Math.abs(s.center.x-s.width/2-offset.x)<.01&&Math.abs(s.center.y-s.height/2-offset.y)<.01;},'再移行しても手動中心を維持');
  await evaluate(owner,`document.querySelector('.all-restore-button').click()`);
  await until(()=>evaluate(owner,`!document.querySelector('.all-restore-button')`),'検証終了');
  return{testPassed:true,scope:'IDE long press: VR center / normal window',displayCount:screen.getAllDisplays().length,results,shots};
 }finally{owner.isFocused=originalFocus;screen.getCursorScreenPoint=originalCursor;}
}
module.exports={checkIdeCenter};
