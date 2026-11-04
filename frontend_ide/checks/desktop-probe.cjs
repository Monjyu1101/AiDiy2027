// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Electron実機確認用。通信・音声はテスト画面と疑似デバイスに限定する。
const {app,screen}=require('electron');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {windowBounds}=require('../デスクトップ/window-layout.cjs');
if(process.env.AIDIY_TEST_PROFILE)app.setPath('appData',process.env.AIDIY_TEST_PROFILE);
let openingWindow,openingMetrics;
app.on('browser-window-created',(_event,window)=>{
 window.webContents.once('did-finish-load',async()=>{
  if(window.webContents.getURL().startsWith('data:text/html')){
   openingWindow=window;
   const bounds=window.getBounds(),content=window.getContentBounds();
   openingMetrics=window.webContents.executeJavaScript(`new Promise(resolve=>{
    const panel=document.querySelector('div');let maxScale=0;
    const sample=()=>{maxScale=Math.max(maxScale,new DOMMatrixReadOnly(getComputedStyle(panel).transform).a);};
    const timer=setInterval(sample,10);sample();
    panel.addEventListener('animationend',()=>{sample();clearInterval(timer);const rect=panel.getBoundingClientRect();resolve({maxScale,width:rect.width,height:rect.height});},{once:true});
   })`).then(animation=>({bounds,content,...animation}),error=>({error:error.message}));
   return;
  }
  if(window.webContents.getURL()!==process.env.AIDIY_DEVELOPMENT_URL)return;
  try{
   await new Promise(resolve=>setTimeout(resolve,1800));
   if(!openingWindow?.isDestroyed())throw Error('拡大表示用ウィンドウの生成・終了が確認できません');
   if(!window.isVisible())throw Error('拡大表示後に画面が表示されていません');
   const result=await window.webContents.executeJavaScript(`(async()=>{
     const kind=document.querySelector('[data-app]')?.dataset.app;
     let audio;try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});audio=stream.getAudioTracks().length;stream.getTracks().forEach(track=>track.stop());}catch(error){audio=error.name;}
     const root=document.querySelector('.development-app');
     const panel=kind==='ide'?root:document.querySelector('.ai-component');
     return{kind,audio,bridge:typeof window.aidiyWindow?.close,component:!!document.querySelector('[data-component]'),opening:document.documentElement.classList.contains('desktop-opening'),opacity:getComputedStyle(root).opacity,fade:getComputedStyle(panel).animationName};
   })()`);
   console.log('PROBE '+JSON.stringify(result));
   if(result.opening||result.opacity!=='1'||result.fade!=='startup-fade-in')throw Error('拡大後のフェード表示が完了していません');
   writeFileSync(join(__dirname,`../../nn-size-${result.kind}.png`),(await window.webContents.capturePage()).toPNG());
   const initialBounds=window.getBounds();
   const opening=await openingMetrics;
   console.log('OPENING '+JSON.stringify({opening,actual:window.getContentBounds()}));
   if(opening?.error||!opening||opening.maxScale>1.00001)throw Error('拡大演出が最終倍率を超えています');
   const actualContent=window.getContentBounds();
   // Chromiumの矩形計算には浮動小数点の微小誤差がある。
   if(opening.width>actualContent.width+.01||opening.height>actualContent.height+.01)throw Error('拡大演出が実画面の表示領域を超えています');
   const expected=windowBounds(result.kind,screen.getDisplayMatching(initialBounds).workArea);
   // Windowsの小数倍率では外枠の論理座標に最大2pxの丸め差が出る。
   for(const key of ['x','y','width','height'])if(Math.abs(initialBounds[key]-expected[key])>2)throw Error(`初期配置 ${key}: ${initialBounds[key]} / ${expected[key]}`);
   if(['code','live'].includes(result.kind)){
    const content=window.getContentBounds();
    process.send?.({contentSize:{width:content.width,height:content.height}});
    const [minWidth,minHeight]=window.getMinimumSize();
    if(minWidth!==360||minHeight!==480)throw Error(`最小サイズ: ${minWidth} x ${minHeight}`);
   }
   console.log('WINDOW initial '+JSON.stringify(initialBounds));
   await window.webContents.executeJavaScript(`document.querySelector('[aria-label="最大化"]').click()`);
   await new Promise(resolve=>setTimeout(resolve,500));
   if(!window.isMaximized())throw Error('最大化ボタンがウィンドウに反映されていません');
   await window.webContents.executeJavaScript(`document.querySelector('[aria-label="元のサイズに戻す"]').click()`);
   await new Promise(resolve=>setTimeout(resolve,500));
   if(window.isMaximized())throw Error('元のサイズに戻せません');
   const restored=window.getBounds();
   if(restored.width!==initialBounds.width||restored.height!==initialBounds.height)throw Error('復元サイズが一致しません');
   console.log('WINDOW maximize / restore OK');
   process.send?.({tested:true});
   if(result.kind!==process.env.AIDIY_DEVELOPMENT_KIND||result.bridge!=='function')process.exitCode=1;
   if(result.kind==='live'?result.audio!==1:typeof result.audio!=='string')process.exitCode=1;
  }catch(error){console.error(error);process.exitCode=1;}finally{app.exit(process.exitCode||0);}
 });
});
require('../desktop.cjs');
setTimeout(()=>app.exit(2),12000).unref();
