import {test} from 'node:test';
import assert from 'node:assert/strict';
import {長押し移動を作成} from '../memo/ui/src/長押し移動.mjs';
function fixture(){
 const host=new EventTarget(),calls=[],markers=[];let timer,loop,enabled=true,resolve;
 const target={selectionStart:1,selectionEnd:3,selectionDirection:'forward',setPointerCapture(){},releasePointerCapture(){},setSelectionRange(...args){calls.push(['selection',...args]);}};
 const native={beginWindowMove:async()=>{calls.push('begin');return 'token';},moveWindow:async()=>{calls.push('move');return true;},endWindowMove:async()=>calls.push('end')};
 const control=長押し移動を作成({host,native,changed:v=>markers.push(v),enabled:()=>enabled,setTimer:(fn,ms)=>{assert.equal(ms,500);timer=fn;return 1;},clearTimer:()=>{timer=null;},setLoop:fn=>{loop=fn;return 2;},clearLoop:()=>{loop=null;}});
 const fire=(name,props={})=>{const e=new Event(name,{cancelable:true});for(const [key,value]of Object.entries({pointerId:1,clientX:10,clientY:10,...props}))Object.defineProperty(e,key,{value});host.dispatchEvent(e);return e;};
 return {control,calls,markers,fire,native,target,start:()=>control.start({target,button:0,pointerId:1,clientX:10,clientY:10}),tick:async()=>{await timer?.();},loop:async()=>{await loop?.();await Promise.resolve();},disable:()=>{enabled=false;},defer:()=>{native.beginWindowMove=()=>new Promise(r=>{calls.push('begin');resolve=r;});},resolve:()=>resolve('token')};
}
test('500 ms stationary hold enables marker, native move and restores text selection; release cleans up',async()=>{
 const f=fixture();f.start();assert.deepEqual(f.calls,[]);await f.tick();assert.equal(f.markers.at(-1),true);assert.equal(f.fire('pointermove').defaultPrevented,true);await f.loop();assert.ok(f.calls.includes('move'));f.fire('pointerup');assert.equal(f.markers.at(-1),false);assert.equal(f.calls.at(-1),'end');assert.equal(f.fire('pointermove').defaultPrevented,false);
});
test('short selection, release, scroll, IME, key, cancel and blur never initiate movement',async()=>{
 for(const [name,props] of [['pointermove',{clientX:30}],['pointerup',{}],['scroll',{}],['wheel',{}],['compositionstart',{}],['keydown',{}],['pointercancel',{}],['blur',{}]]){
  const f=fixture();f.start();f.fire(name,props);await f.tick();assert.deepEqual(f.calls,[],name);
 }
 const f=fixture();f.disable();f.start();await f.tick();assert.deepEqual(f.calls,[]);
});
test('release during pending native begin ends token and never revives marker/interval',async()=>{
 const f=fixture();f.defer();f.start();const pending=f.tick();f.fire('pointerup');f.resolve();await pending;await f.loop();assert.deepEqual(f.calls,['begin','end']);assert.ok(!f.markers.includes(true));
});

test('captured input blur during title/body focus change does not cancel the hold',async()=>{
 for(const input of ['INPUT','TEXTAREA']){
  const f=fixture();f.start();f.fire('blur',{target:{tagName:input}});await f.tick();
  assert.deepEqual(f.calls,['begin']);assert.equal(f.markers.at(-1),true);
  f.fire('blur');assert.equal(f.markers.at(-1),false);assert.equal(f.calls.at(-1),'end');
 }
});
test('repeated holds cancel the old timer/token and never keep the movement marker',async()=>{
 const f=fixture();f.start();await f.tick();f.start();assert.equal(f.calls.at(-1),'end');
 await f.tick();f.control.cancel();assert.deepEqual(f.calls,['begin','end','begin','end']);
 assert.equal(f.markers.at(-1),false);await f.loop();assert.ok(!f.calls.includes('move'));
});

 test('body whitespace uses the editor selection and the same 500 ms movement lifecycle',async()=>{
 const f=fixture();f.control.start({target:{},button:0,pointerId:1,clientX:10,clientY:10},f.target);
 await f.tick();assert.deepEqual(f.calls,['begin']);assert.equal(f.markers.at(-1),true);
 f.fire('pointermove');assert.deepEqual(f.calls.at(-1),['selection',1,3,'forward']);
 f.fire('pointerup');assert.equal(f.calls.at(-1),'end');assert.equal(f.markers.at(-1),false);
});
