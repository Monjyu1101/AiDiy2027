// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';

// 縮小・拡大・移動とも背面の透明窓で画像を動かす。
// CSPを持つ実画面にはdata画像・動的styleを注入しない。
// native寸法を毎フレーム変更せず、Windowsの未描画の縁を避ける。
const 演出時間=380;
const 待機=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const 描画待ち=contents=>Promise.race([
 contents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))').catch(()=>{}),
 待機(300),
]);
function 囲む(a,b){
 const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
 return {x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};
}
function 画面サイズ演出を作成(BrowserWindow,window,{topmostLevel=()=>'floating'}={}){
 let current;
 function 終了(){
  const state=current;current=undefined;if(!state)return;
  clearTimeout(state.timer);
  if(!window.isDestroyed()){
   window.setOpacity(state.opacity);
  }
  if(state.canvas&&!state.canvas.isDestroyed())state.canvas.destroy();
 }
 async function 準備(target){
  if(current)return false;
  if(window.isDestroyed())return false;
  if(!window.isVisible()||window.isMinimized())return true;
  const state={opacity:window.getOpacity()};current=state;
  // rendererが切替完了を通知できなくても、実窓を透明なまま残さない。
  state.timer=setTimeout(終了,2500);state.timer.unref?.();
  try{
   const from=window.getContentBounds();let area=囲む(from,target);
   const snapshot=await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
   if(snapshot.isEmpty())throw Error('画像なし');
   if(current!==state||window.isDestroyed())return false;
   state.from=from;state.area=area;state.target=target;
   const canvas=new BrowserWindow({title:'AiDiy サイズ切替',...area,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,skipTaskbar:true,show:false,alwaysOnTop:window.isAlwaysOnTop(),webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
   canvas.isAiDiyOpeningCanvas=true;canvas.isAiDiyResizeCanvas=true;state.canvas=canvas;
   canvas.setBounds(area);
   if(window.isAlwaysOnTop()){canvas.setAlwaysOnTop(false);canvas.setAlwaysOnTop(true,topmostLevel());}
   // Windowsの端数DPI・作業領域補正後の実座標を使い、旧画像の左肩をずらさない。
   area=canvas.getContentBounds();state.area=area;
   const html=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:transparent}#image{position:absolute;left:0;top:0;width:${from.width}px;height:${from.height}px;transform-origin:0 0;isolation:isolate;transform:translate(${from.x-area.x}px,${from.y-area.y}px)}img{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;mix-blend-mode:plus-lighter}#next{opacity:0}</style></head><body><div id="image"><img id="old" alt="" src="${snapshot.toDataURL()}"><img id="next" alt=""></div></body></html>`;
   await canvas.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
   if(current!==state||window.isDestroyed()){if(!canvas.isDestroyed())canvas.destroy();return false;}
   // 表示前に旧画像のdecodeを完了し、空の演出面を実窓へ重ねない。
   await canvas.webContents.executeJavaScript("document.querySelector('#old').decode()");
   if(current!==state||window.isDestroyed()){if(!canvas.isDestroyed())canvas.destroy();return false;}
   // showInactiveは非フォーカス表示だけ。元窓を明示的に上へ置き、準備中は背面を維持する。
   canvas.setOpacity(0);canvas.showInactive();
   window.moveAbove(canvas.getMediaSourceId());
   canvas.setOpacity(state.opacity);await 描画待ち(canvas.webContents);
   if(current!==state||window.isDestroyed()){if(current===state)終了();return false;}
   window.setOpacity(0);
   // 透明化も描画へ反映してから呼出元のnativeサイズ変更を許可する。
   // 同じtickでmaximize/setBoundsし、透明化前の実窓が動く競合を避ける。
   await 描画待ち(canvas.webContents);
   if(current!==state||window.isDestroyed()){if(current===state)終了();return false;}
   state.covered=true;
  }catch{if(current!==state)return false;終了();if(window.isDestroyed())return false;}
  return true;
 }
 async function 完了({beforeCapture}={}){
  const state=current;if(!state)return true;
  try{
   await 描画待ち(window.webContents);
   // Vueの描画後に届くResizeObserverの高さ通知まで待ち、完成した寸法へ一度だけ変形する。
   await 待機(60);
   if(current!==state||window.isDestroyed())return true;
   if(beforeCapture){beforeCapture();await 描画待ち(window.webContents);}
   if(current!==state||window.isDestroyed())return true;
   const to=window.getContentBounds(),snapshot=await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
   if(snapshot.isEmpty())throw Error('画像なし');
   if(current!==state||window.isDestroyed()||!state.canvas||state.canvas.isDestroyed())return true;
   const {from}=state,canvas=state.canvas;
   let area=state.area;
   // 折り返し名称など、測定後の最終寸法が予定範囲を越える場合も切り取らない。
   const finalArea=囲む(area,to);
   if(finalArea.x!==area.x||finalArea.y!==area.y||finalArea.width!==area.width||finalArea.height!==area.height){
    canvas.setBounds(finalArea);area=canvas.getContentBounds();state.area=area;
    await canvas.webContents.executeJavaScript(`document.querySelector('#image').style.transform=${JSON.stringify(`translate(${from.x-area.x}px,${from.y-area.y}px)`)}`);
    await 描画待ち(canvas.webContents);
    if(current!==state||window.isDestroyed()||canvas.isDestroyed())return true;
   }
   // 相補的な透明度を同じ時間軸で加算合成する。通常のsource-over合成では
   // 2枚とも半透明になり実窓を隠した背後が透ける。アイコンの透明領域も維持する。
   const start=`translate(${from.x-area.x}px,${from.y-area.y}px) scale(1,1)`,end=`translate(${to.x-area.x}px,${to.y-area.y}px) scale(${to.width/from.width},${to.height/from.height})`;
   await Promise.race([
    canvas.webContents.executeJavaScript(`(async()=>{const image=document.querySelector('#image'),next=document.querySelector('#next'),old=document.querySelector('#old');next.src=${JSON.stringify(snapshot.toDataURL())};await next.decode();const options={duration:${演出時間},easing:'cubic-bezier(.33,1,.68,1)',fill:'forwards'};const motion=image.animate([{transform:${JSON.stringify(start)}},{transform:${JSON.stringify(end)}}],options);next.animate([{opacity:0},{opacity:1}],options);old.animate([{opacity:1},{opacity:0}],options);await motion.finished.catch(()=>{});})()`),
    待機(演出時間+500),
   ]);
   if(current===state&&!window.isDestroyed()){
    window.setOpacity(state.opacity);await 描画待ち(window.webContents);
   }
  }catch{ /* 撮影やアニメーションに失敗しても、実窓の表示を復元する。 */ }
  finally{if(current===state)await 終了();}
  return true;
 }
 return {window,準備,完了,中止:終了,get active(){return !!current;},get preparing(){return !!current&&!current.covered;}};
}
module.exports={画面サイズ演出を作成,演出時間};
