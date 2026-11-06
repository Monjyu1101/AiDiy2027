// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {pinLevel}=require('../../frontend_ide/デスクトップ/最前面ピン.cjs');
const {表示切替基準を作成}=require('./表示切替位置.cjs');
// 名前上端: 中央アイコン中心(64px)+回転枠の外側(48px)。CSS の .micro-project と合わせる。
const 閉じた幅=128,開いた幅=320,名前上端=112;
const {円周配置}=require('../ui/src/components/アプリ起動/円周配置.cjs');
const {createCodeDrag}=require('../../frontend_ide/デスクトップ/code-drag.cjs');
function マイクロ表示を作成(window,{screen,pins,位置=表示切替基準を作成(screen)}={}){
 let saved,expanded=false,timer,busy=false,generation=0,ignored=false,foldedBounds,expandedBounds;
 // closed 後は BrowserWindow.webContents の取得自体が失敗するため、生存中に保持する。
 const contents=window.webContents;
 const drag=createCodeDrag({screen,trustedEvent:()=>null}).forRecord({window,kind:'diag',revision:0});
 let moveToken,pressedPoint;
 const nativePress=(_event,input)=>{
  if(!saved||input.type!=='mouseDown'||input.button!=='left')return;
  const b=window.getBounds(),zoom=window.webContents.getZoomFactor?.()||1;
  pressedPoint={x:b.x+input.x/zoom,y:b.y+input.y/zoom,time:Date.now()};
 };
 contents.on?.('before-mouse-event',nativePress);
 function 最前面維持(){
  if(!saved||window.isDestroyed()||window.isAlwaysOnTop())return;
  // Windowsではfloatingの指定後、trueのままlevelだけ変えてもOSに反映されない。
  // 一度解除してアイコン専用の層へ切り替える。フォーカスは奪わない。
  window.setAlwaysOnTop(false);
  window.setAlwaysOnTop(true,process.platform==='win32'?'pop-up-menu':'floating');
 }
 function endMove(token=moveToken){if(token&&token===moveToken){drag.end(token);moveToken=undefined;}}
 function ignore(value){if(ignored===value||window.isDestroyed())return;ignored=value;window.setIgnoreMouseEvents(value,{forward:true});}
 function place(bounds){
  window.setBounds(bounds,false);
  // Windowsの端数DPIによる寸法・座標の丸めを一度だけ補正する。
  const actual=window.getBounds(),corrected={};let changed=false;
  for(const key of ['x','y','width','height']){const delta=bounds[key]-actual[key];corrected[key]=bounds[key]+delta;changed ||= delta!==0;}
  if(changed&&corrected.width>0&&corrected.height>0)window.setBounds(corrected,false);
 }
 function fit(size,b=window.getBounds()){
  const area=screen.getDisplayMatching(b).workArea;
  const x=Math.max(area.x,Math.min(area.x+area.width-size,Math.round(b.x+b.width/2-size/2)));
  const y=Math.max(area.y,Math.min(area.y+area.height-size,Math.round(b.y+b.height/2-size/2)));
  window.setMinimumSize(size-2,size-2);place({x,y,width:size,height:size});
 }
 async function hit(){
  if(!saved||busy||window.isDestroyed())return;busy=true;const version=generation;
  try{
   if(moveToken){ignore(false);return;}
   const p=screen.getCursorScreenPoint(),b=window.getBounds(),x=p.x-b.x,y=p.y-b.y;
   const inside=x>=0&&y>=0&&x<b.width&&y<b.height;
   const interactive=inside&&await window.webContents.executeJavaScript(`!!document.elementFromPoint(${x},${y})?.closest('[data-micro-hit]')`);
   if(saved&&version===generation){
    // DOM照会中に押下・移動・展開が進んだ場合、古い位置の結果でクリックを透過させない。
    if(moveToken){ignore(false);return;}
    const now=screen.getCursorScreenPoint(),bounds=window.getBounds();
    if(now.x!==p.x||now.y!==p.y||bounds.x!==b.x||bounds.y!==b.y||bounds.width!==b.width||bounds.height!==b.height)return;
    ignore(!interactive);
   }
  }catch{if(saved&&version===generation)ignore(false);}finally{busy=false;}
 }
 function set(enabled,{origin}={}){
  if(typeof enabled!=='boolean'||window.isDestroyed())return false;
  if(enabled===!!saved)return true;generation++;
  const start=origin||window.getBounds();
  if(enabled){
   saved={bounds:window.getNormalBounds(),minimum:window.getMinimumSize(),maximized:window.isMaximized(),maximizable:window.isMaximizable(),resizable:window.isResizable()};
   if(saved.maximized)window.unmaximize();
   window.setMaximizable(false);window.setResizable(false);pins.setLocked(window,true);
   expanded=false;foldedBounds=expandedBounds=undefined;
   window.setMinimumSize(閉じた幅-2,閉じた幅-2);place(位置.計算(start,{width:閉じた幅,height:閉じた幅},{画面内:true}));
   最前面維持();timer=setInterval(hit,60);timer.unref?.();
  }else{
   endMove();clearInterval(timer);ignore(false);const previous=saved;saved=undefined;expanded=false;
   pins.setLocked(window,false);window.setAlwaysOnTop(pins.state(window).pinned,pinLevel);window.setMinimumSize(...previous.minimum);window.setResizable(previous.resizable);window.setMaximizable(previous.maximizable);place(位置.計算(start,previous.bounds));
  }
  位置.記録(window.getBounds());
  return true;
 }
 window.on('blur',()=>endMove());
 window.once('closed',()=>{endMove();generation++;clearInterval(timer);saved=undefined;contents.removeListener?.('before-mouse-event',nativePress);});
 return {get active(){return !!saved;},get normalBounds(){return saved?.bounds;},set,最前面維持,
 beginMove(){if(!saved)return null;endMove();moveToken=pressedPoint&&Date.now()-pressedPoint.time<1000?drag.beginAt(pressedPoint):drag.begin();pressedPoint=undefined;if(moveToken)ignore(false);return moveToken;},
 move(token){if(!saved||!token||token!==moveToken)return false;const ok=drag.move(token);if(!ok)endMove(token);return ok;},
 endMove,resizeLabel(height){
  if(!saved||expanded||window.isDestroyed()||!Number.isInteger(height)||height<18||height>4096)return false;
  const b=window.getBounds(),area=screen.getDisplayMatching(b).workArea;
  const target=Math.min(area.height,Math.max(閉じた幅,名前上端+height+8));
  if(b.height!==target){window.setMinimumSize(閉じた幅-2,閉じた幅-2);place(位置.計算(b,{width:閉じた幅,height:target},{画面内:true}));位置.記録(window.getBounds());}
  return true;
 },expand(value,count=13){
  const layout=円周配置(count);
  if(!saved||typeof value!=='boolean'||!layout)return false;
  if(expanded&&value&&expandedBounds.width!==layout.幅){
   const current=window.getBounds();
   foldedBounds.x+=current.x-expandedBounds.x;foldedBounds.y+=current.y-expandedBounds.y;
   fit(layout.幅);expandedBounds=window.getBounds();
  }else if(expanded!==value){
   expanded=value;
   if(value){foldedBounds=window.getBounds();fit(layout.幅,{...foldedBounds,height:閉じた幅});expandedBounds=window.getBounds();}
   else{
    const current=window.getBounds();
    // 展開時の画面端補正は収納時に戻す。展開中に移動した分だけは引き継ぐ。
    const restored={...foldedBounds,x:foldedBounds.x+current.x-expandedBounds.x,y:foldedBounds.y+current.y-expandedBounds.y};
    const area=screen.getDisplayMatching(restored).workArea;
    restored.x=Math.max(area.x,Math.min(area.x+area.width-restored.width,restored.x));
    restored.y=Math.max(area.y,Math.min(area.y+area.height-restored.height,restored.y));
    window.setMinimumSize(閉じた幅-2,閉じた幅-2);place(restored);
   }
  }
  return true;
 }};
}
module.exports={マイクロ表示を作成,閉じた幅,開いた幅};
