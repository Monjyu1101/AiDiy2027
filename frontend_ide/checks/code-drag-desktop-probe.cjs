// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const assert=require('node:assert/strict');
const {app,BrowserWindow,screen}=require('electron');
const {createCodeDrag}=require('../デスクトップ/code-drag.cjs');
app.setPath('userData',process.env.AIDIY_TEST_PROFILE);
const deadline=setTimeout(()=>{console.error('Code移動確認タイムアウト');app.exit(1);},30000);
app.whenReady().then(async()=>{
 const results=[];
 for(const display of screen.getAllDisplays()){
  const window=new BrowserWindow({x:display.workArea.x+40,y:display.workArea.y+40,width:480,height:600,frame:false,show:false,opacity:0,skipTaskbar:true});
  window.setIgnoreMouseEvents(true);window.showInactive();
  // 利用者のフォーカスを奪わず、座標取得・移動・サイズ測定は実OS窓で確認する。
  window.isFocused=()=>true;
  let cursor={x:display.workArea.x+100,y:display.workArea.y+100};
  const record={window,kind:'code',revision:1},event={record};
  const drag=createCodeDrag({trustedEvent:e=>e.record,screen:{getCursorScreenPoint:()=>({...cursor})}});
  const initial=window.getBounds();
  // 整数DIPへ戻す際の1 DIP以内の誤差は許容するが、ジェスチャー間でも累積させない。
  function check(stage){const actual=window.getBounds();assert.ok(Math.abs(actual.width-initial.width)<=1&&Math.abs(actual.height-initial.height)<=1,`${stage}: ${JSON.stringify({initial,actual})}`);}
  const kinds=['code','live','console','viewer','explorer','panel-viewer','panel-routes'];
  for(const kind of kinds){
   record.kind=kind;
   const token=drag.begin(event);assert.equal(typeof token,'string');
   const stationary=window.getBounds();
   for(let i=0;i<20;i++){assert.equal(drag.move(event,token),true);assert.deepEqual(window.getBounds(),stationary);check('静止中');}
   const before=window.getBounds();
   for(let i=0;i<40;i++){
    cursor={x:cursor.x+(i%2===0?7:-5),y:cursor.y+(i%2===0?5:-3)};
    assert.equal(drag.move(event,token),true);check('移動中');
   }
   const after=window.getBounds();assert.ok(Math.abs(after.x-before.x-40)<=1);assert.ok(Math.abs(after.y-before.y-40)<=1);
   drag.end(event,token);
  }
  results.push({scaleFactor:display.scaleFactor,initial,final:window.getBounds(),kinds,gestures:kinds.length,moves:40*kinds.length,stationary:20*kinds.length});
  window.destroy();
 }
 process.send?.({testPassed:true,results});clearTimeout(deadline);app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1);});
