// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NAVIGATION_SCENES,pickNavigationScene,createRipples} from '../src/components/開発スペース/ナビ風景.js';
import {navigationKeyActive,bindNavigationKeys} from '../src/components/開発スペース/ナビ入力.js';
test('既存の航行・花火を残して3種類を均等な範囲で選ぶ',()=>{
 assert.deepEqual(NAVIGATION_SCENES,['ride','fireworks','aquarium','kaleidoscope','water']);
 assert.deepEqual([.01,.21,.41,.61,.81].map(n=>pickNavigationScene(()=>n)),NAVIGATION_SCENES);
});
test('波紋点は毎回異なる位置から広がり、寿命と上限で片付ける',()=>{
 let n=0;const ripples=createRipples(()=>((n++%10)/10));
 const a=ripples.add(),b=ripples.add();assert.notEqual(a.x,b.x);assert.notEqual(a.y,b.y);
 ripples.step(1);assert.equal(a.age,1);assert.equal(b.age,1);
 for(let i=0;i<40;i++)ripples.add();assert.equal(ripples.points.length,32);
 ripples.step(8);assert.equal(ripples.points.length,0);
});
test('波紋点は指定したポインター位置を使い、不正な位置はランダムへ戻す',()=>{
 const ripples=createRipples(()=>.5);
 assert.deepEqual(ripples.add({x:.8,y:.2}),{x:.8,y:.2,age:0});
 assert.deepEqual(ripples.add({x:-1,y:2}),{x:0,y:1,age:0});
 assert.deepEqual(ripples.add({x:NaN,y:.2}),{x:.5,y:.5,age:0});
 assert.deepEqual(ripples.add(),{x:.5,y:.5,age:0});
});
function target(selector){return {closest:query=>query.includes(selector)?{}:null};}
test('別窓の要素はinstanceofなしで判定し、入力・IME・標準操作を奪わない',()=>{
 const focus={};const el={ownerDocument:{activeElement:focus},contains:value=>value===focus};
 assert.equal(navigationKeyActive({target:{}},el),true);
 for(const selector of ['input','textarea','select','button','summary','a[href]','[role="textbox"]','[contenteditable]'])assert.equal(navigationKeyActive({target:target(selector)},el,true),false);
 assert.equal(navigationKeyActive({target:{},isComposing:true},el,true),false);
 assert.equal(navigationKeyActive({target:{},defaultPrevented:true},el,true),false);
 el.ownerDocument.activeElement={};assert.equal(navigationKeyActive({target:{}},el),false);
 assert.equal(navigationKeyActive({target:{}},el,true),true);
});
const doc=()=>Object.assign(new EventTarget(),{defaultView:new EventTarget()});
test('DOMの別窓移動・復帰でキー購読を移し、破棄で全て解除する',()=>{
 const a=doc(),b=doc(),el=Object.assign(new EventTarget(),{ownerDocument:a});
 let sync,count=0,cleared=false,blurs=0;
 const stop=bindNavigationKeys(el,{keydown:()=>count++,blur:()=>blurs++},{setInterval:fn=>(sync=fn,1),clearInterval:()=>{cleared=true;}});
 a.dispatchEvent(new Event('keydown'));assert.equal(count,1);
 el.ownerDocument=b;el.dispatchEvent(new Event('focusin'));a.dispatchEvent(new Event('keydown'));b.dispatchEvent(new Event('keydown'));assert.equal(count,2);
 el.ownerDocument=a;sync();b.dispatchEvent(new Event('keydown'));a.dispatchEvent(new Event('keydown'));assert.equal(count,3);
 stop();sync();a.dispatchEvent(new Event('keydown'));b.dispatchEvent(new Event('keydown'));assert.equal(count,3);assert.equal(cleared,true);assert.ok(blurs>=3);
});
test('新演出は黒背景、Spaceの長押し重複を除き、所有窓の描画を終了する',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ風景.vue',import.meta.url),'utf8');
 assert.match(source,/event\.repeat/);assert.match(source,/navigationKeyActive\(event,el,hover\)/);
 assert.match(source,/ctx\.fillStyle='#000'/);assert.match(source,/frameOwner=el\.ownerDocument\.defaultView/);
 assert.match(source,/cancelAnimationFrame\(raf\);unbind\(\)/);
 for(const name of ['ナビ航行.vue','ナビ花火.vue']){
  const existing=readFileSync(new URL('../src/components/開発スペース/'+name,import.meta.url),'utf8');
  assert.match(existing,/bindNavigationKeys\(el/);assert.match(existing,/unbindKeys\(\)/);assert.doesNotMatch(existing,/instanceof Element|document\.addEventListener\('key/);
 }
});

test('3演出と既存2演出・NavigatorのVue script/templateをコンパイルする',async()=>{
 const {parse,compileScript,compileTemplate}=await import('@vue/compiler-sfc');
 for(const name of ['ナビ風景.vue','ナビ航行.vue','ナビ花火.vue','Navigationパネル.vue']){
  const source=readFileSync(new URL('../src/components/開発スペース/'+name,import.meta.url),'utf8');
  const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
  assert.ok(compileScript(descriptor,{id:name}));
  assert.deepEqual(compileTemplate({source:descriptor.template.content,filename:name,id:name}).errors,[]);
 }
});
