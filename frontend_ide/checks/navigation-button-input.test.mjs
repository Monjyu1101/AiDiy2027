// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {bindNavigationButton} from '../src/components/開発スペース/ナビボタン入力.js';

// イベント伝播は明示的に渡し、別Documentと時計を独立して検証する。
class Target {
  listeners = new Map();
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  send(type, values = {}) {
    const event = {type, defaultPrevented:false, preventDefault() { this.defaultPrevented=true; }, ...values};
    for (const handler of [...(this.listeners.get(type) || [])]) handler(event);
    return event;
  }
  get count() { return [...this.listeners.values()].reduce((sum, entries) => sum+entries.size, 0); }
}
function fixture() {
  let now=0, id=0;
  const timers=new Map(), calls=[], doc=new Target(), owner=new Target(), element=new Target();
  Object.assign(doc, {defaultView:owner, hidden:false});
  Object.assign(element, {ownerDocument:doc, disabled:false, isConnected:true,
    getClientRects:()=>[{}], getBoundingClientRect:()=>({left:0,right:100,top:0,bottom:50}),
    setPointerCapture(id) { this.capture=id; }, hasPointerCapture(id) { return this.capture===id; },
    releasePointerCapture() { this.capture=null; },
  });
  const clock={performance:{now:()=>now},setTimeout(fn, delay) { timers.set(++id,{fn,at:now+delay}); return id; }, clearTimeout(id) { timers.delete(id); }};
  const binding=bindNavigationButton(element,{run:()=>calls.push('run'),choose:()=>calls.push('choose')},clock);
  const pointer={button:0,isPrimary:true,pointerId:1,clientX:30,clientY:25,pointerType:'mouse'};
  return {doc,owner,element,timers,calls,binding,
    elapse(ms) { now+=ms; },
    tick(ms) { now+=ms; for (const [id,timer] of [...timers]) if (timer.at<=now) { timers.delete(id); timer.fn(); } },
    down(values={}) { return element.send('pointerdown',{...pointer,...values}); },
    move(values={}) { return doc.send('pointermove',{...pointer,...values}); },
    up(values={}) { return doc.send('pointerup',{...pointer,...values}); },
    click(values={}) { return element.send('click',{detail:1,...values}); },
    key(key,values={}) { return element.send('keydown',{key,...values}); },
  };
}
function cleaned(f) {
  assert.equal(f.timers.size,0,'中断後のタイマーを残さない');
  assert.equal(f.doc.count,0,'押下先Documentの購読を残さない');
  assert.equal(f.owner.count,0,'押下先Windowの購読を残さない');
  assert.equal(f.element.capture,null,'ポインター捕捉を解除する');
}

test('499msの短押しはrelease後のclickで一度だけ実行する',()=>{
  const f=fixture(); f.down(); f.tick(499); assert.deepEqual(f.calls,[]);
  f.up(); assert.deepEqual(f.calls,[]); cleaned(f);
  assert.equal(f.click().defaultPrevented,true); assert.deepEqual(f.calls,['run']);
});
test('500msの長押しは選択を開き、releaseと後続clickで実行しない',()=>{
  const f=fixture(); f.down(); f.tick(500); assert.deepEqual(f.calls,['choose']);
  f.tick(5000); f.up(); f.click(); assert.deepEqual(f.calls,['choose']); cleaned(f);
  f.down(); f.tick(100); f.up(); f.click(); assert.deepEqual(f.calls,['choose','run']);
});
test('長押し後にEscapeで閉じてもreleaseのclickを実行しない',()=>{
  const f=fixture(); f.down(); f.tick(500); f.doc.send('keydown',{key:'Escape'});
  f.up(); f.click(); assert.deepEqual(f.calls,['choose']); cleaned(f);
});
for (const [name,cancel] of [
  ['Escape',f=>f.doc.send('keydown',{key:'Escape'})],
  ['Tab',f=>f.doc.send('keydown',{key:'Tab'})],
  ['blur',f=>f.owner.send('blur')],
  ['pagehide',f=>f.owner.send('pagehide')],
  ['非表示',f=>{ f.doc.hidden=true; f.doc.send('visibilitychange'); }],
  ['外側への移動',f=>f.move({clientX:101})],
  ['10pxを超えるタッチ移動',f=>f.move({clientX:41,pointerType:'touch'})],
  ['外側でrelease',f=>f.up({clientY:51})],
  ['pointercancel',f=>f.doc.send('pointercancel',{pointerId:1})],
  ['lostpointercapture',f=>f.doc.send('lostpointercapture',{pointerId:1})],
  ['別ポインター',f=>f.doc.send('pointerdown',{pointerId:2})],
  ['外部から取消',f=>f.binding.cancel()],
]) test(name+'で長押しを中断し、遅いclickを消費する',()=>{
  const f=fixture(); f.down({pointerType:'touch'}); f.tick(200); cancel(f);
  cleaned(f); f.tick(1000); f.up(); f.click(); assert.deepEqual(f.calls,[]);
});
test('別ポインターのmove/up/cancelでは主ポインターを終了しない',()=>{
  const f=fixture(); f.down(); f.move({pointerId:2,clientX:200}); f.up({pointerId:2});
  f.doc.send('pointercancel',{pointerId:2}); f.tick(500); assert.deepEqual(f.calls,['choose']);
  f.up(); cleaned(f);
});
test('右クリックと非primaryポインターは長押しを開始しない',()=>{
  for (const values of [{button:2},{isPrimary:false}]) {
    const f=fixture(); f.down(values); f.tick(1000);
    assert.deepEqual(f.calls,[]); assert.equal(f.timers.size,0); assert.equal(f.doc.count,0);
  }
});
for (const [name,change] of [
  ['disabled',f=>{f.element.disabled=true;}],
  ['切断',f=>{f.element.isConnected=false;}],
  ['表示領域なし',f=>{f.element.getClientRects=()=>[];}],
  ['Document移動',f=>{f.element.ownerDocument={defaultView:new Target(),hidden:false};}],
]) test(name+'を閾値時に再確認し、選択も実行もしない',()=>{
  const f=fixture(); f.down(); change(f); f.tick(500); f.up(); f.click();
  assert.deepEqual(f.calls,[]); cleaned(f);
});
test('破棄は全購読を除去し、遅いタイマーや入力を無効にする',()=>{
  const f=fixture(); f.down(); f.binding.dispose(); cleaned(f); assert.equal(f.element.count,0);
  f.tick(1000); f.up(); f.click(); f.key('ArrowDown'); assert.deepEqual(f.calls,[]);
  f.binding.dispose();
});
test('通常の支援技術clickとEnter/Spaceのnative clickを受け入れる',()=>{
  const f=fixture(); f.click({detail:0}); assert.deepEqual(f.calls,['run']);
  for (const key of ['Enter',' ']) {
    assert.equal(f.key(key).defaultPrevented,false); f.click({detail:0});
  }
  assert.deepEqual(f.calls,['run','run','run']); assert.equal(f.timers.size,0);
});
test('ArrowDownは一度だけ選択を開き、repeatとIME入力を無視する',()=>{
  const f=fixture(); assert.equal(f.key('ArrowDown').defaultPrevented,true);
  assert.equal(f.key('ArrowDown',{repeat:true}).defaultPrevented,true);
  f.key('ArrowDown',{isComposing:true}); f.click(); assert.deepEqual(f.calls,['choose']);
  for (const key of ['Enter',' ']) assert.equal(f.key(key,{repeat:true}).defaultPrevented,true);
  f.key('Enter'); f.click(); assert.deepEqual(f.calls,['choose','run']);
});
test('disabled時のキーボードとclickは実行しない',()=>{
  const f=fixture(); f.element.disabled=true;
  f.down(); f.key('ArrowDown'); f.key('Enter'); f.click(); f.tick(1000);
  assert.deepEqual(f.calls,[]); assert.equal(f.timers.size,0);
});
test('長押し中だけcontextmenuを抑制する',()=>{
  const f=fixture(); assert.equal(f.element.send('contextmenu').defaultPrevented,false);
  f.down(); assert.equal(f.element.send('contextmenu').defaultPrevented,true);
  f.tick(500); f.up(); assert.equal(f.element.send('contextmenu').defaultPrevented,true);
  f.down(); f.up(); f.click(); assert.equal(f.element.send('contextmenu').defaultPrevented,false);
});

test('タイマーが遅れても500ms以上のreleaseは長押しとして一度だけ扱う',()=>{
  for (const elapsed of [500,650,3000]) {
    const f=fixture(); f.down(); f.elapse(elapsed); assert.deepEqual(f.calls,[]);
    f.up(); f.click(); f.tick(1000); assert.deepEqual(f.calls,['choose']); cleaned(f);
  }
});
test('長押し後も支援技術clickは使え、物理clickだけを抑制する',()=>{
  const f=fixture(); f.down(); f.tick(500);
  f.click({detail:0}); assert.deepEqual(f.calls,['choose'],'押下が続く間は支援技術clickも抑制する');
  f.up(); f.click({detail:1}); assert.deepEqual(f.calls,['choose']);
  f.click({detail:0}); assert.deepEqual(f.calls,['choose','run']);
});
test('移動後の次の押下は新しいDocumentとWindowだけを購読する',()=>{
  const f=fixture(); f.down(); f.binding.cancel(); cleaned(f);
  const doc=new Target(), owner=new Target(); Object.assign(doc,{defaultView:owner,hidden:false});
  f.element.ownerDocument=doc; f.down(); assert.equal(f.doc.count,0); assert.ok(doc.count>0);
  f.owner.send('blur'); f.tick(500); assert.deepEqual(f.calls,['choose']);
  owner.send('blur'); assert.equal(doc.count,0); assert.equal(owner.count,0);
  f.click(); assert.deepEqual(f.calls,['choose']);
});
