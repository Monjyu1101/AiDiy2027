// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {openFloatingDialog} from '../src/components/共通表示/浮動ダイアログ.js';
class Events{
 listeners=new Map();
 addEventListener(name,fn){let set=this.listeners.get(name);if(!set)this.listeners.set(name,set=new Set());set.add(fn);}
 removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
 dispatch(name,extra={}){const event={button:0,pointerId:1,clientX:100,clientY:100,preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true},...extra};for(const fn of this.listeners.get(name)||[])fn(event);return event;}
 count(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0);}
}
function fixture(){
 const win=Object.assign(new Events(),{innerWidth:1400,innerHeight:900}),doc=Object.assign(new Events(),{defaultView:win});let shown=0,observed=0,disconnected=0,resize;
 win.ResizeObserver=class{constructor(fn){resize=fn;}observe(){observed++;}disconnect(){disconnected++;}};
 const dialog=Object.assign(new Events(),{ownerDocument:doc,style:{},show(){shown++},getBoundingClientRect(){return{left:parseFloat(this.style.left)||0,top:parseFloat(this.style.top)||0,width:480,height:280}}});
 const sourceElement={getBoundingClientRect:()=>({left:800,right:1380,top:100})};let cancelled=0;
 const cleanup=openFloatingDialog(dialog,{sourceElement,onCancel:()=>cancelled++});
 const header={closest:selector=>selector==='[data-dialog-drag]'?{}:null};
 return {win,doc,dialog,header,cleanup,resize:()=>resize(),shown:()=>shown,cancelled:()=>cancelled,observed:()=>observed,disconnected:()=>disconnected};
}
test('非モーダル: showだけを使い、Viewerの左側に配置し、別Documentの監視を使う',()=>{
 const f=fixture();assert.equal(f.shown(),1);assert.equal(f.dialog.style.left,'308px');assert.equal(f.dialog.style.top,'76px');assert.equal(f.observed(),1);assert.equal(f.doc.count(),0);assert.equal(f.win.count(),1);f.cleanup();assert.equal(f.disconnected(),1);assert.equal(f.win.count(),0);assert.equal(f.dialog.count(),0);
});
test('移動: 見出しだけをドラッグし、入力・ボタンは動かさず、画面外へ出さない',()=>{
 const f=fixture(),before=f.dialog.style.left;
 f.dialog.dispatch('pointerdown',{target:{closest:()=>({})}});assert.equal(f.doc.count(),0);assert.equal(f.dialog.style.left,before);
 const start=f.dialog.dispatch('pointerdown',{target:f.header});assert.equal(start.prevented,true);assert.equal(f.doc.count(),3);
 f.doc.dispatch('pointermove',{clientX:3000,clientY:-3000});assert.equal(f.dialog.style.left,'912px');assert.equal(f.dialog.style.top,'8px');
 f.doc.dispatch('pointerup');assert.equal(f.doc.count(),0);f.cleanup();
});
test('Escと片付け: 呼出し元が保存・busyを判断し、破棄は移動中の購読も解除する',()=>{
 const f=fixture();const event=f.dialog.dispatch('keydown',{key:'Escape'});assert.equal(f.cancelled(),1);assert.equal(event.stopped,true);assert.equal(event.prevented,true);
 f.doc.dispatch('keydown',{key:'Escape'});assert.equal(f.cancelled(),1,'背景側のEscを横取りしない');
 f.dialog.dispatch('pointerdown',{target:f.header});f.cleanup();assert.equal(f.doc.count(),0);assert.equal(f.dialog.count(),0);assert.equal(f.win.count(),0);
});
test('縮小と再レイアウト: 表示位置を小さい窓内へ戻す',()=>{
 const f=fixture();f.win.innerWidth=520;f.win.innerHeight=320;f.win.dispatch('resize');assert.equal(f.dialog.style.left,'32px');assert.equal(f.dialog.style.top,'32px');f.dialog.style.left='1000px';f.resize();assert.equal(f.dialog.style.left,'32px');f.cleanup();
});
