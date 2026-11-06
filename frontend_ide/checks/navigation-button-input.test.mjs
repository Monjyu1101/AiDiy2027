// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {bindNavigationButton} from '../src/components/開発スペース/ナビボタン入力.js';

class Target {
 listeners=new Map();
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
 send(type,values={}){const event={type,button:0,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...values};for(const fn of [...this.listeners.get(type)||[]])fn(event);return event;}
 get count(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0);}
}
function fixture(){
 const element=new Target(),doc=new Target(),owner=new Target(),calls=[];
 Object.assign(doc,{defaultView:owner});Object.assign(element,{ownerDocument:doc,disabled:false,isConnected:true,setPointerCapture(){assert.fail('ポインター捕捉は不要');}});
 const clock={setTimeout(){assert.fail('長押しタイマーは不要');},clearTimeout(){assert.fail('長押しタイマーは不要');}};
 const binding=bindNavigationButton(element,{run:()=>calls.push('run'),choose:value=>calls.push(value)},clock);
 return {element,doc,owner,calls,binding};
}
test('通常クリックはrelease後のclickだけで実行し、押下監視・タイマーを作らない',()=>{
 const f=fixture();assert.deepEqual([...f.element.listeners.keys()].sort(),['click','contextmenu','keydown']);
 for(const pointerType of ['mouse','touch','pen']){
  f.element.send('pointerdown',{pointerType});assert.equal(f.calls.length,0);
  f.element.send('pointerup',{pointerType});assert.equal(f.calls.length,0);
 }
 assert.equal(f.doc.count,0);assert.equal(f.owner.count,0);
 assert.equal(f.element.send('click').defaultPrevented,true);assert.deepEqual(f.calls,['run']);
});
test('長い左押下でも選択を開かず、通常clickを抑制しない',async()=>{
 const f=fixture();f.element.send('pointerdown');await new Promise(resolve=>setTimeout(resolve,550));
 assert.deepEqual(f.calls,[]);f.element.send('pointerup');f.element.send('click');assert.deepEqual(f.calls,['run']);
});
test('右クリックは座標付き候補だけを開き、通常実行しない',()=>{
 const f=fixture();const event=f.element.send('contextmenu',{button:2,clientX:123,clientY:67,pointerType:'mouse'});
 assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);
 assert.deepEqual(f.calls,[{anchor:f.element,point:{x:123,y:67}}]);
 f.element.send('click',{button:2});f.element.send('click',{button:1});assert.equal(f.calls.length,1);
 f.element.send('click');assert.equal(f.calls.at(-1),'run');
});
test('Controlクリックは候補のみで実行しない',()=>{
 const f=fixture();f.element.send('click',{ctrlKey:true});f.element.send('contextmenu',{ctrlKey:true,clientX:4,clientY:8});
 assert.deepEqual(f.calls,[{anchor:f.element,point:{x:4,y:8}}]);
});
test('タッチ長押し由来contextmenuは候補を開かない',()=>{
 const f=fixture();assert.equal(f.element.send('contextmenu',{pointerType:'touch',button:2}).defaultPrevented,true);
 assert.deepEqual(f.calls,[]);f.element.send('click',{pointerType:'touch'});assert.deepEqual(f.calls,['run']);
});
for(const [key,extra]of [['ContextMenu',{}],['F10',{shiftKey:true}],['ArrowDown',{}]])test(key+'はアンカー付き候補を開き、repeatは無視する',()=>{
 const f=fixture();const event=f.element.send('keydown',{key,...extra});assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);
 f.element.send('keydown',{key,...extra,repeat:true});assert.deepEqual(f.calls,[{anchor:f.element,point:null}]);
});
test('IME・修飾キー・通常F10は候補を開かない',()=>{
 const f=fixture();for(const extra of [{isComposing:true},{ctrlKey:true},{metaKey:true},{altKey:true}])f.element.send('keydown',{key:'ArrowDown',...extra});
 f.element.send('keydown',{key:'F10'});assert.deepEqual(f.calls,[]);
});
test('Enter・Spaceと支援技術のnative clickを維持しキーリピートだけ抑制する',()=>{
 const f=fixture();for(const key of ['Enter',' ']){assert.equal(f.element.send('keydown',{key}).defaultPrevented,false);assert.equal(f.element.send('keydown',{key,repeat:true}).defaultPrevented,true);f.element.send('click',{detail:0});}
 assert.deepEqual(f.calls,['run','run']);
});
for(const property of ['disabled','isConnected'])test(property+'で実行不可ならどの入力も実行しない',()=>{
 const f=fixture();f.element[property]=property==='disabled';
 f.element.send('click');f.element.send('contextmenu',{button:2});f.element.send('keydown',{key:'ArrowDown'});assert.deepEqual(f.calls,[]);
});
test('DOM移動後も現在のアンカーを使い旧Documentは購読しない',()=>{
 const f=fixture(),doc=new Target();f.element.ownerDocument=doc;f.element.send('contextmenu',{button:2,clientX:0,clientY:0});
 assert.equal(f.calls[0].anchor.ownerDocument,doc);assert.equal(f.doc.count,0);assert.equal(f.owner.count,0);
});
test('破棄は全購読を除去し、繰り返し破棄も安全',()=>{
 const f=fixture();f.binding.dispose();f.binding.dispose();assert.equal(f.element.count,0);
 f.element.send('click');f.element.send('contextmenu',{button:2});f.element.send('keydown',{key:'ArrowDown'});assert.deepEqual(f.calls,[]);
});
