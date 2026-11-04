// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const assert=require('node:assert/strict');
const {BrowserWindow,screen}=require('electron');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {setWindowBounds}=require('../デスクトップ/全画面横断.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function checkVRPanelPlacement(owner,{evaluate,until,output,stamp}){
 const find=label=>BrowserWindow.getAllWindows().find(w=>w!==owner&&w.webContents.getTitle()===`AiDiy IDE / ${label}`);
 const labels=['Explorer','軌跡'],area=screen.getPrimaryDisplay().workArea,targets={},shots=[],motion=[];
 for(const [index,label] of labels.entries()){
  const win=find(label),bounds=win.getBounds();
  setWindowBounds(win,{...bounds,x:area.x+Math.min(330+index*430,area.width-bounds.width-16),y:area.y+120+index*90});
  targets[label]=win.getBounds();
 }
 await evaluate(owner,`document.querySelector('.all-restore-button').click()`);
 await until(()=>labels.every(label=>!find(label)),'終了時に元のパネルを閉じる');
 await until(()=>evaluate(owner,`!document.querySelector('.all-transition')`),'VR終了処理完了');
 // 通常画面の窓を動かしても、VRの絶対位置を記憶していることを確かめる。
 const normal=owner.getBounds();setWindowBounds(owner,{...normal,x:normal.x+20,y:normal.y+16});
 owner.webContents.invalidate();await owner.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
 await sleep(600);
 await evaluate(owner,`document.querySelector('.window-all').click()`);
 await Promise.all(labels.map(async label=>{
  let win;
  try{await until(async()=>{win=find(label);return win&&await evaluate(win,`!!document.querySelector('[data-aidiy-move-marker]')`);},`${label}移動中の共通マーカー`);}catch(error){console.log('配置確認診断',label,targets[label],win?.getBounds(),win&&await evaluate(win,`({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,markers:document.querySelectorAll('[data-aidiy-window-move]').length})`),await evaluate(owner,`({state:document.querySelector('.window-all')?.getAttribute('aria-pressed'),text:document.body.innerText.slice(-1200)})`));throw error;}
  const start=win.getBounds();
  assert.equal(await evaluate(owner,`!!document.querySelector('.all-transition')`),true,'移動完了までは移行中');
  assert.equal(await evaluate(owner,`!document.querySelector('.panel-pin-preview,.explorer-panel,.explorer-routes')`),true,'Web側の元表示を消してから移動する');
  const file=join(output,`${stamp}_vr-panel-moving-${label==='Explorer'?'explorer':'routes'}.png`);
  // 巨大なVR窓と同時の撮影は到着後のフレームになり得る。表示順は上のDOM検査でも確認する。
  const crop={x:0,y:0,width:Math.min(220,win.getContentBounds().width),height:Math.min(100,win.getContentBounds().height)};
  win.webContents.invalidate();
  writeFileSync(file,(await win.webContents.capturePage(crop,{stayHidden:true,stayAwake:true})).toPNG());shots.push(file);
  await sleep(80);const middle=win.getBounds();
  assert.ok(start.x!==middle.x||start.y!==middle.y,'実OS窓が滑らかに移動');
  assert.ok(Math.abs(start.width-middle.width)<=2&&Math.abs(start.height-middle.height)<=2,'移動でサイズを変更しない');
  motion.push({label,start,middle,target:targets[label]});
 }));
 await until(()=>evaluate(owner,`!document.querySelector('.all-transition')`),'両方の移動完了');
 for(const label of labels){const win=find(label),bounds=win.getBounds();assert.ok(Math.abs(bounds.x-targets[label].x)<=2&&Math.abs(bounds.y-targets[label].y)<=2,JSON.stringify({label,bounds,target:targets[label]}));assert.equal(await evaluate(win,`!!document.querySelector('[data-aidiy-move-marker]')`),false);}
 // 2回目の位置変更も次の往復に反映する。
 const explorer=find('Explorer');setWindowBounds(explorer,{...explorer.getBounds(),x:targets.Explorer.x+60,y:targets.Explorer.y+40});targets.Explorer=explorer.getBounds();
 await evaluate(owner,`document.querySelector('.all-restore-button').click()`);await until(()=>labels.every(label=>!find(label)),'再終了');await until(()=>evaluate(owner,`!document.querySelector('.all-transition')`),'再終了処理完了');
 await evaluate(owner,`document.querySelector('.window-all').click()`);
 await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-transition')`),'3回目のVR移行完了');
 for(const label of labels){const bounds=find(label).getBounds();assert.ok(Math.abs(bounds.x-targets[label].x)<=2&&Math.abs(bounds.y-targets[label].y)<=2);}
 return{testPassed:true,scope:'VR panel placement',displayCount:screen.getAllDisplays().length,sequentialMarkers:true,rememberAfterRecreation:true,updatedPosition:true,motion,shots};
}
module.exports={checkVRPanelPlacement};
