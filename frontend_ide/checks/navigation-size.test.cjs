// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test');const assert=require('node:assert/strict');
const {windowBounds,windowMinimumSize,allWindowBounds}=require('../デスクトップ/window-layout.cjs');
const {panelBounds}=require('../デスクトップ/panel-windows.cjs');
const size=require('../host/scripts/window-size.cjs');
test('Navi starts at the left center of the work area and clamps its initial DIP size',()=>{
 for(const area of [{x:0,y:0,width:1920,height:1040},{x:50,y:80,width:1200,height:916},{x:-1200,y:80,width:1200,height:915},{x:-900,y:-50,width:900,height:700},{x:0,y:0,width:400,height:480},{x:100,y:-1900,width:1080,height:1880},{x:-321,y:41,width:641,height:641}]){
  const code=windowBounds('code',area),expected=[Math.min(480,area.width-16),Math.min(900,area.height-16)];
  assert.deepEqual([code.width,code.height],[Math.min(480,area.width-16),Math.min(900,area.height-16)]);
  assert.deepEqual([windowBounds('live',area).width,windowBounds('live',area).height],[code.width,code.height]);
  const standalone=windowBounds('navi',area);assert.deepEqual([standalone.width,standalone.height],expected);assert.deepEqual(windowMinimumSize('navi',standalone),windowMinimumSize('code',code));assert.equal(standalone.x,area.x+8);assert.ok(Math.abs(standalone.y+standalone.height/2-area.y-area.height/2)<=.5);
  assert.deepEqual(windowBounds('navi',area,{x:area.x+200,y:area.y+100,width:800,height:600}),standalone);
  assert.deepEqual(allWindowBounds('navi',area),standalone);
  assert.ok(standalone.y>=area.y+8&&standalone.y+standalone.height<=area.y+area.height-8);
  for(const zoom of [1,1.25,1.5,2]){
   const b=panelBounds({left:1900,top:900,width:400,height:700},{window:{getContentBounds:()=>area,webContents:{getZoomFactor:()=>zoom}}},{getDisplayMatching:()=>({workArea:area})},'panel-navigation');
   assert.deepEqual(b,standalone);
  }
 }
});

test('Navi Web panel uses its own initial height and keeps viewport limits',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/components/開発スペース/Naviパネル.vue'),'utf8');
 const size=require('../host/scripts/window-size.cjs');
 assert.equal(size.ナビ高さ,900);
 assert.equal(size.会話高さ,900);
 assert.ok(source.includes(`width:min(${size.幅}px,calc(100vw - 32px))`));
 assert.ok(source.includes(`height:min(${size.ナビ高さ}px,calc(100vh - var(--workspace-top,78px) - 16px))`));
});

test('Navi goal starts at four rows and preserves vertical resizing',()=>{
 const {readFileSync}=require('node:fs');
 const {join}=require('node:path');
 const source=readFileSync(join(__dirname,'../src/components/開発スペース/Naviパネル.vue'),'utf8');
 assert.match(source,/<textarea[^>]*v-model="goal"[^>]*rows="4"[^>]*@input="editGoal"/);
 assert.match(source,/\.navigation-goal-form textarea\{[^}]*resize:vertical;[^}]*min-height:48px;max-height:120px[;}]/);
});

test('Navi prompt sits outside the scrolling items after the overall evaluation',()=>{
 const {readFileSync}=require('node:fs');const {join}=require('node:path');
 const source=readFileSync(join(__dirname,'../src/components/開発スペース/Naviパネル.vue'),'utf8');
 assert.ok(source.indexOf('class="navigation-display"')<source.indexOf('class="navigation-overall"'));
 assert.ok(source.indexOf('class="navigation-overall"')<source.indexOf('class="navigation-next"'));
 assert.match(source,/\.navigation-panel>\.navigation-next\{flex:none;/);
 assert.match(source,/\.navigation-panel>\.navigation-next \.navigation-prompt\{[^}]*overflow:auto/);
});
