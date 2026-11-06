// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationMenuPosition,bindNavigationMenu} from '../src/components/開発スペース/ナビ画面メニュー.js';
class Target {
 listeners=new Map();
 addEventListener(type,fn,capture){if(!this.listeners.has(type))this.listeners.set(type,new Map());this.listeners.get(type).set(fn,capture);}
 removeEventListener(type,fn,capture){const entries=this.listeners.get(type);if(entries?.get(fn)===capture)entries.delete(fn);}
 send(type,values={}){const event={type,target:this,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...values};for(const fn of [...this.listeners.get(type)?.keys()||[]])fn(event);return event;}
 get count(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0);}
}
function fixture({anchorDocument=null,scrollLeft=0,scrollTop=0}={}){
 const doc=new Target(),owner=new Target(),menu=new Target(),anchor=new Target();let closes=0;
 Object.assign(doc,{defaultView:owner,hidden:false,activeElement:null});
 Object.assign(anchor,{ownerDocument:anchorDocument||doc,isConnected:true,disabled:false,focus(){doc.activeElement=this;},getBoundingClientRect:()=>({left:200,bottom:180})});
 const items=[0,1,2,3,4].map(id=>({id,disabled:id===2,focus(){doc.activeElement=this;}}));
 const parent={scrollLeft,scrollTop,clientLeft:1,clientTop:1,clientWidth:300,clientHeight:200,getBoundingClientRect:()=>({left:100,top:50})};
 Object.assign(menu,{ownerDocument:doc,offsetParent:parent,parentElement:parent,offsetWidth:120,offsetHeight:100,style:{},contains:target=>target===menu||items.includes(target),querySelectorAll:()=>items.filter(item=>!item.disabled)});
 const binding=bindNavigationMenu(menu,{anchor,point:{x:390,y:240}},()=>closes++);
 return {doc,owner,menu,anchor,items,parent,binding,get closes(){return closes;}};
}
const base={anchor:{left:110,bottom:90},bounds:{left:100,top:50,width:300,height:200},width:120,height:100};
test('ポインター座標をパネル内に変換し四辺を4px余白で制限する',()=>{
 assert.deepEqual(navigationMenuPosition({...base,point:{x:150,y:120}}),{left:50,top:70});
 assert.deepEqual(navigationMenuPosition({...base,point:{x:0,y:0}}),{left:4,top:4});
 assert.deepEqual(navigationMenuPosition({...base,point:{x:999,y:999}}),{left:176,top:96});
});
test('キーボードと無効座標はアンカー左下を使い、狭いパネルでも負座標を作らない',()=>{
 for(const point of [null,undefined,{x:NaN,y:Infinity}])assert.deepEqual(navigationMenuPosition({...base,point}),{left:10,top:40});
 assert.deepEqual(navigationMenuPosition({...base,width:400,height:300}),{left:4,top:4});
});
test('境界線を除いた現在のパネル寸法で配置し、先頭の有効項目へフォーカスする',()=>{
 const f=fixture();assert.deepEqual(f.menu.style,{left:'176px',top:'96px'});assert.equal(f.doc.activeElement,f.items[0]);f.binding.dispose();
});
test('矢印とHome/Endは無効項目を飛ばし循環する',()=>{
 const f=fixture();for(const [key,index]of [['ArrowUp',4],['ArrowDown',0],['ArrowDown',1],['ArrowDown',3],['End',4],['Home',0]]){
  const event=f.menu.send('keydown',{key});assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.equal(f.doc.activeElement,f.items[index]);
 }
 f.menu.send('keydown',{key:'ArrowDown',isComposing:true});assert.equal(f.doc.activeElement,f.items[0]);f.binding.dispose();
});
function cleaned(f){assert.equal(f.doc.count,0);assert.equal(f.owner.count,0);assert.equal(f.menu.count,0);}
test('Escapeは閉じて元ボタンへフォーカスを戻し全購読を解除する',()=>{
 const f=fixture(),event=f.menu.send('keydown',{key:'Escape'});assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.equal(f.closes,1);assert.equal(f.doc.activeElement,f.anchor);cleaned(f);
 f.binding.dispose();f.owner.send('blur');assert.equal(f.closes,1);
});
test('Tabは標準移動を阻止せず閉じ、起点を元ボタンへ戻す',()=>{
 const f=fixture(),event=f.menu.send('keydown',{key:'Tab'});assert.equal(event.defaultPrevented,false);assert.equal(f.closes,1);assert.equal(f.doc.activeElement,f.anchor);cleaned(f);
});
for(const type of ['pointerdown','contextmenu','focusin','scroll'])test(type+'は自分のメニュー内では維持し外側だけで閉じる',()=>{
 const f=fixture();f.doc.send(type,{target:f.items[1]});assert.equal(f.closes,0);
 const otherMenu={className:'navigation-scene-menu'};f.doc.send(type,{target:otherMenu});assert.equal(f.closes,1);assert.equal(f.doc.activeElement,f.items[0]);cleaned(f);
});
for(const type of ['blur','pagehide','resize'])test('表示先Windowの'+type+'で閉じる',()=>{const f=fixture();f.owner.send(type);assert.equal(f.closes,1);cleaned(f);});
test('表示先Documentが非表示になった時だけ閉じる',()=>{
 const f=fixture();f.doc.send('visibilitychange');assert.equal(f.closes,0);f.doc.hidden=true;f.doc.send('visibilitychange');assert.equal(f.closes,1);cleaned(f);
});
for(const change of [f=>{f.anchor.disabled=true;},f=>{f.anchor.isConnected=false;},f=>{f.anchor.ownerDocument=new Target();}])test('フォーカス復帰時に無効・切断・別Documentのアンカーを触らない',()=>{
 const f=fixture();change(f);f.menu.send('keydown',{key:'Escape'});assert.equal(f.doc.activeElement,f.items[0]);cleaned(f);
});
test('購読先はmenu.ownerDocumentとそのWindowだけで、disposeは通知もフォーカス変更もしない',()=>{
 const oldDoc=new Target(),oldOwner=new Target();oldDoc.defaultView=oldOwner;const f=fixture({anchorDocument:oldDoc});
 assert.equal(oldDoc.count,0);assert.equal(oldOwner.count,0);oldDoc.send('pointerdown');oldOwner.send('blur');assert.equal(f.closes,0);
 assert.ok(f.doc.count>0);assert.ok(f.owner.count>0);f.binding.dispose();f.binding.dispose();assert.equal(f.closes,0);assert.equal(f.doc.activeElement,f.items[0]);cleaned(f);
 f.doc.send('pointerdown');f.owner.send('resize');f.menu.send('keydown',{key:'Escape'});assert.equal(f.closes,0);
});

test('有効項目がなくても矢印操作は例外にならずEnter・Spaceは標準操作へ委ねる',()=>{
 const f=fixture();f.items.forEach(item=>{item.disabled=true;});
 for(const key of ['ArrowUp','ArrowDown','Home','End'])assert.doesNotThrow(()=>f.menu.send('keydown',{key}));
 for(const key of ['Enter',' '])assert.equal(f.menu.send('keydown',{key}).defaultPrevented,false);
 assert.equal(f.closes,0);f.binding.dispose();cleaned(f);
});

test('既にスクロール済みのパネルでは表示範囲内に制限後にスクロール量を加える',()=>{
 const f=fixture({scrollLeft:85,scrollTop:25});
 assert.deepEqual(f.menu.style,{left:'261px',top:'121px'});
 assert.equal(parseFloat(f.menu.style.left)-f.parent.scrollLeft,176);
 assert.equal(parseFloat(f.menu.style.top)-f.parent.scrollTop,96);
 assert.equal(f.doc.activeElement,f.items[0]);f.binding.dispose();cleaned(f);
});
