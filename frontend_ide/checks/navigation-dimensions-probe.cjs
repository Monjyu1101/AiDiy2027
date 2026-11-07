// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const assert=require('node:assert/strict');
const {screen}=require('electron');
const {execFileSync}=require('node:child_process');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {windowBounds}=require('../デスクトップ/window-layout.cjs');

// CSS pxの数値誤差だけを許す。31.000001907348633の再現値より十分大きく、
// 1 CSS pxの高さ違いは必ず落とす。native寸法の既存2 DIP許容とは混同しない。
const titleToleranceCssPx=.001,windowToleranceDip=2;
function windowsMetrics(window){
 if(process.platform!=='win32')return null;
 const handle=window.getNativeWindowHandle();
 const hwnd=(handle.length===8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())).toString();
 // DPI仮想化を避けるのはこの読み取り専用補助プロセスだけ。OS設定は変更しない。
 const command=`Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class NaviWindowMetrics {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
[void][NaviWindowMetrics]::SetThreadDpiAwarenessContext([IntPtr](-4))
$naviHwnd=[IntPtr]([long]${hwnd})
$naviRect=New-Object NaviWindowMetrics+Rect
if (-not [NaviWindowMetrics]::GetWindowRect($naviHwnd,[ref]$naviRect)) { throw 'GetWindowRect failed' }
$naviClient=New-Object NaviWindowMetrics+Rect
if (-not [NaviWindowMetrics]::GetClientRect($naviHwnd,[ref]$naviClient)) { throw 'GetClientRect failed' }
$naviTextScale=(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Accessibility' -Name TextScaleFactor -ErrorAction SilentlyContinue).TextScaleFactor
if (-not $naviTextScale) { $naviTextScale=100 }
@{dpi=[NaviWindowMetrics]::GetDpiForWindow($naviHwnd);textScalePercent=$naviTextScale;physicalClientSize=@{width=$naviClient.Right;height=$naviClient.Bottom};physicalBounds=@{x=$naviRect.Left;y=$naviRect.Top;width=$naviRect.Right-$naviRect.Left;height=$naviRect.Bottom-$naviRect.Top}} | ConvertTo-Json -Compress`;
 return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:10000}));
}

async function checkNavigationDimensions(window,label){
 const contents=window.webContents;
 contents.setBackgroundThrottling(false);
 // 表示開始ズームの途中を測らない。専用窓の通常描画を待つ。
 for(let attempt=0;;attempt++){
  const ready=await contents.executeJavaScript(`!!document.querySelector('.panel-brand .window-actions')&&!document.documentElement.classList.contains('desktop-opening')&&getComputedStyle(document.querySelector('.navigation-panel')).visibility==='visible'`);
  if(ready&&window.isVisible()&&window.getOpacity()===1)break;
  assert.ok(attempt<300,'Navigator寸法測定の表示待機');
  await new Promise(done=>setTimeout(done,100));
 }
 const dom=await contents.executeJavaScript(`(()=>{
  const header=document.querySelector('.panel-brand'),actions=header.querySelector('.window-actions'),title=header.querySelector('strong'),connection=header.querySelector('.connection-label'),css=getComputedStyle(header);
  const rect=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const ancestors=[];for(let node=header;node;node=node.parentElement){const c=getComputedStyle(node);ancestors.push({tag:node.tagName,transform:c.transform,zoom:c.zoom});}
  return {devicePixelRatio,viewport:{width:innerWidth,height:innerHeight},visualViewportScale:visualViewport?.scale,
   titlebar:{rect:rect(header),height:rect(header).height,computedHeight:css.height,minHeight:css.minHeight,boxSizing:css.boxSizing,display:css.display,right:rect(header).right-rect(actions).right},
   title:{text:title.textContent,rect:rect(title),overflow:getComputedStyle(title).overflow,textOverflow:getComputedStyle(title).textOverflow},connection:rect(connection),
   actions:rect(actions),buttons:[...actions.querySelectorAll('button')].map(element=>({title:element.title,rect:rect(element)})),
   ancestors,horizontalOverflow:document.documentElement.scrollWidth>innerWidth};
 })()`);
 const bounds=window.getBounds(),display=screen.getDisplayMatching(bounds),expected=windowBounds('navi',display.workArea),zoom=contents.getZoomFactor();
 const native=windowsMetrics(window),checks=[];
 const near=(name,actual,expected,tolerance,unit)=>checks.push({name,actual,expected,tolerance,unit,pass:Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance});
 near('初期幅',bounds.width,expected.width,windowToleranceDip,'DIP');
 near('初期高さ',bounds.height,expected.height,windowToleranceDip,'DIP');
 near('左余白',bounds.x,expected.x,windowToleranceDip,'DIP');
 near('作業領域の縦中央',bounds.y+bounds.height/2,display.workArea.y+display.workArea.height/2,windowToleranceDip,'DIP');
 near('タイトル行の高さ',dom.titlebar.height,31,titleToleranceCssPx,'CSS px');
 checks.push({name:'タイトル行grid',actual:dom.titlebar.display,expected:'grid',pass:dom.titlebar.display==='grid'});
 checks.push({name:'右端の操作列',actual:dom.titlebar.right,expected:[-titleToleranceCssPx,4+titleToleranceCssPx],unit:'CSS px',pass:dom.titlebar.right>=-titleToleranceCssPx&&dom.titlebar.right<=4+titleToleranceCssPx});
 const bar=dom.titlebar.rect;
 checks.push({name:'窓操作ボタンの収まり',pass:dom.buttons.length>0&&dom.buttons.every(({rect:r})=>r.left>=bar.left-titleToleranceCssPx&&r.right<=bar.right+titleToleranceCssPx&&r.top>=bar.top-titleToleranceCssPx&&r.bottom<=bar.bottom+titleToleranceCssPx)});
 checks.push({name:'タイトルと操作列・接続表示の非重複',actual:{titleRight:dom.title.rect.right,actionsLeft:dom.actions.left,titleLeft:dom.title.rect.left,connectionRight:dom.connection.right},pass:dom.title.rect.right<=dom.actions.left+titleToleranceCssPx&&dom.title.rect.left>=dom.connection.right-titleToleranceCssPx});
 checks.push({name:'横方向のはみ出しなし',pass:!dom.horizontalOverflow});
 near('CSS幅とcontent幅の照合',dom.viewport.width*zoom,window.getContentBounds().width,windowToleranceDip,'DIP');
 near('CSS高さとcontent高さの照合',dom.viewport.height*zoom,window.getContentBounds().height,windowToleranceDip,'DIP');
 near('devicePixelRatioと画面倍率×ページ倍率',dom.devicePixelRatio,display.scaleFactor*zoom,.0001,'ratio');
 if(native){
  // ChromiumのWindows画面倍率にはアクセシビリティの文字倍率も含まれる。
  near('Windows表示倍率×文字倍率とElectron倍率',native.dpi/96*native.textScalePercent/100,display.scaleFactor,.0001,'ratio');
  near('Windows client物理幅とElectron content幅',native.physicalClientSize.width,window.getContentBounds().width*display.scaleFactor,Math.ceil(display.scaleFactor),'physical px');
  near('Windows client物理高さとElectron content高さ',native.physicalClientSize.height,window.getContentBounds().height*display.scaleFactor,Math.ceil(display.scaleFactor),'physical px');
 }
 const output=resolve(process.env.AIDIY_TEST_NAVIGATION_OUTPUT||join(__dirname,'../../temp/navigation-dimensions-check'));
 mkdirSync(output,{recursive:true});
 const capture=await contents.capturePage();
 writeFileSync(join(output,label+'.png'),capture.toPNG());
 const result={label,timestamp:new Date().toISOString(),pass:checks.every(check=>check.pass),versions:process.versions,
  boundsDip:bounds,contentBoundsDip:window.getContentBounds(),expectedBoundsDip:expected,
  display:{id:display.id,bounds:display.bounds,workArea:display.workArea,scaleFactor:display.scaleFactor},zoom,native,dom,
  titleHeightDip:dom.titlebar.height*zoom,titleHeightPhysicalPx:dom.titlebar.height*zoom*display.scaleFactor,
  captureSize:capture.getSize(),checks};
 writeFileSync(join(output,label+'.json'),JSON.stringify(result,null,2)+'\n');
 console.log('Navigator dimensions',JSON.stringify(result));
 for(const check of checks)assert.ok(check.pass,JSON.stringify(check));
 return result;
}
module.exports={checkNavigationDimensions};
