// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test');const assert=require('node:assert/strict');
const {windowBounds,windowMinimumSize}=require('../デスクトップ/window-layout.cjs');
const {panelBounds}=require('../デスクトップ/panel-windows.cjs');
test('Navigator initial DIP and screen-edge clamp',()=>{
 for(const area of [{x:0,y:0,width:1920,height:1040},{x:-900,y:-50,width:900,height:700},{x:0,y:0,width:400,height:480}]){
  const code=windowBounds('code',area),expected=[code.width,code.height];
  const standalone=windowBounds('navi',area);assert.deepEqual([standalone.width,standalone.height],expected);assert.deepEqual(windowMinimumSize('navi',standalone),windowMinimumSize('code',code));assert.equal(standalone.x,area.x+8);assert.equal(standalone.y,area.y+area.height-8-standalone.height);
  for(const zoom of [1,1.25,1.5,2]){
   const b=panelBounds({left:1900,top:900,width:400,height:700},{window:{getContentBounds:()=>area,webContents:{getZoomFactor:()=>zoom}}},{getDisplayMatching:()=>({workArea:area})},'panel-navigation');
   assert.deepEqual(b,standalone);
  }
 }
});

test('Navigator Web panel matches Code initial size and keeps viewport limits',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/components/開発スペース/Navigationパネル.vue'),'utf8');
 const size=require('../host/scripts/window-size.cjs');
 assert.ok(source.includes(`width:min(${size.幅}px,calc(100vw - 32px))`));
 assert.ok(source.includes(`height:min(${size.会話高さ}px,calc(100vh - var(--workspace-top,78px) - 16px))`));
});

test('Navigator goal starts at four rows and preserves vertical resizing',()=>{
 const {readFileSync}=require('node:fs');
 const {join}=require('node:path');
 const source=readFileSync(join(__dirname,'../src/components/開発スペース/Navigationパネル.vue'),'utf8');
 assert.match(source,/<textarea[^>]*v-model="goal"[^>]*rows="4"[^>]*@input="editGoal"/);
 assert.match(source,/\.navigation-goal-form textarea\{[^}]*resize:vertical;[^}]*min-height:48px;max-height:120px[;}]/);
});

test('Navigator prompt sits outside the scrolling items after the overall evaluation',()=>{
 const {readFileSync}=require('node:fs');const {join}=require('node:path');
 const source=readFileSync(join(__dirname,'../src/components/開発スペース/Navigationパネル.vue'),'utf8');
 assert.ok(source.indexOf('class="navigation-display"')<source.indexOf('class="navigation-overall"'));
 assert.ok(source.indexOf('class="navigation-overall"')<source.indexOf('class="navigation-next"'));
 assert.match(source,/\.navigation-panel>\.navigation-next\{flex:none;/);
 assert.match(source,/\.navigation-panel>\.navigation-next \.navigation-prompt\{[^}]*overflow:auto/);
});
