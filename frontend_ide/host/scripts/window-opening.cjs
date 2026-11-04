/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

'use strict';
// AiDiy の全Electronアプリ・機能パネル共通の表示開始演出（中央から拡大）。
// 実ウィンドウを毎フレーム setBounds で広げると、Windows では描画が追いつく前の新しい縁が白く見える。
// そこで、最終位置・最終サイズの透明なキャンバス用ウィンドウを先に確保し、その中で実画面の画像を CSS で拡大する。
// 実ウィンドウは大きさを変えず、透明のまま表示して実際に描画されてから見せる（表示直後の未描画フレームも白くなる）。
// 注意: キャンバス用ウィンドウに setIgnoreMouseEvents / focusable: false を付けると、Windows では
// 透明部分が白く描かれる環境がある。付けずに showInactive で表示し、演出後すぐ閉じる。
const 演出時間 = 750, 開始倍率 = .55;

function 演出HTML(snapshot, { width, height }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
div{position:absolute;left:0;top:0;width:${width}px;height:${height}px;max-width:100%;max-height:100%;background:transparent;transform:scale(${開始倍率})}
img{display:block;width:100%;height:100%;object-fit:fill}
.go div{animation:grow ${演出時間}ms cubic-bezier(.33,1,.68,1) forwards}
@keyframes grow{to{transform:scale(1)}}
</style></head><body><div><img alt="" src="${snapshot}"></div></body></html>`;
}

const 待機 = ms => new Promise(resolve => setTimeout(resolve, ms));
// 描画を2フレーム待つ。ページが応答しない場合でも表示が止まらないよう、上限を設ける。
const 描画待ち = contents => Promise.race([
  contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))').catch(() => {}),
  待機(300),
]);

// 非表示の実画面を描画して取り込む。登場待ちのopacityだけを一時解除し、白い代用面は作らない。
async function 表示画像(contents) {
  try {
    await contents.executeJavaScript(`(()=>{const style=document.createElement('style');style.dataset.aidiyOpeningCapture='';style.textContent='html,body,#app{opacity:1!important}#app{animation:none!important}.development-app.console.desktop-window,.panel-opening,.viewer-popup,.route-file-list,.viewer-window,.explorer-window{animation:none!important}';document.head.append(style);})()`);
    for(let attempt=0;attempt<3;attempt++){
      contents.invalidate?.();await 描画待ち(contents);
      try{
        const snapshot=await contents.capturePage(undefined,{stayHidden:true,stayAwake:true});
        if(snapshot.isEmpty())throw Error('表示画像が空です');
        return snapshot.toDataURL();
      }catch(error){if(attempt===2)throw error;await 待機(50);}
    }
  } finally {
    await contents.executeJavaScript("document.querySelector('style[data-aidiy-opening-capture]')?.remove()").catch(()=>{});
  }
}

/** 実ウィンドウ（show: false で作成し、最終位置・サイズ・内容まで準備済み）を拡大演出の後に表示する。 */
async function 拡大表示(BrowserWindow, window, { canShow = () => true } = {}) {
  let canvas;
  try {
    if(window.isDestroyed()||!canShow())return false;
    const snapshot=await 表示画像(window.webContents);
    if(window.isDestroyed()||!canShow())return false;
    const bounds = window.getContentBounds();
    canvas = new BrowserWindow({
      title: 'AiDiy 表示準備',
      ...bounds, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, skipTaskbar: true, show: false,
      // VR中のIDEにも隠れないよう、短命な画像だけ実窓と同じ層に置く。OFF窓は通常層のまま。
      alwaysOnTop: window.isAlwaysOnTop?.() === true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    canvas.isAiDiyOpeningCanvas = true;
    // WindowsのDPI補正で作成時の寸法が膨らむため、実画面の表示領域へ明示的に揃える。
    canvas.setBounds(bounds);
    await canvas.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(演出HTML(snapshot, bounds))}`);
    canvas.showInactive();
    await 描画待ち(canvas.webContents);
    // タイマーだけで切り上げず、描画側の拡大完了を待つ。負荷時の未描画の縁を見せない。
    await Promise.race([
      canvas.webContents.executeJavaScript("document.body.classList.add('go');document.querySelector('div').getAnimations()[0]?.finished.catch(()=>{})"),
      待機(演出時間+1000),
    ]);
  } catch { /* 画像を取れない時は、色だけの代用面を出さず実画面を表示する。 */ }
  if (window.isDestroyed() || !canShow()) { if (canvas && !canvas.isDestroyed()) canvas.destroy(); return false; }
  // 透明のまま表示し、実際に描画されてから見せる。キャンバスは実ウィンドウが見えてから閉じる。
  window.setOpacity(0);
  window.show(); window.focus();
  await 描画待ち(window.webContents);
  await 待機(50);
  if (!window.isDestroyed()) { if (canShow()) window.setOpacity(1); else window.hide(); }
  if (canvas && !canvas.isDestroyed()) setTimeout(() => { if (!canvas.isDestroyed()) canvas.destroy(); }, 100);
  return !window.isDestroyed() && canShow();
}

module.exports = { 拡大表示, 演出時間, 開始倍率 };
