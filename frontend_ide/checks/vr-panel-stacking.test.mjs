// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import stacking from '../デスクトップ/VRパネル前面.cjs';
import pinModule from '../デスクトップ/最前面ピン.cjs';
function fixture(platform="linux"){
 const windows=new Map(),order=[],calls=[],tasks=new Map(),errors=[];let serial=0,active=false;
 const pins=pinModule.createWindowPins();
 const controller=stacking.createVRPanelStacking({windows,platform,isPinned:record=>record.stack!==false,isActive:owner=>active&&owner===ide,schedule:fn=>{tasks.set(++serial,fn);return serial;},cancel:id=>tasks.delete(id),onError:error=>errors.push(error)});
 function add(kind,owner){
  const id=`window:${windows.size+1}:0`,window=new EventEmitter();
  const record={window,kind,owner};
  function place(index){order.splice(order.indexOf(id),1);order.splice(index,0,id);}
  Object.assign(window,{isDestroyed:()=>!!window.dead,isVisible:()=>window.visible!==false,isMinimized:()=>!!window.minimized,isFocused:()=>!!window.focused,
   getMediaSourceId:()=>id,setAlwaysOnTop:value=>window.pinned=value,
   moveTop(){place(order.length-1);},moveAbove(target){calls.push([id,target]);order.splice(order.indexOf(id),1);order.splice(order.indexOf(target)+1,0,id);},
   focus(){for(const record of windows.values())record.window.focused=false;window.focused=true;window.emit('focus');},
   setParentWindow(){assert.fail('OS親子関係を作らない');},destroy(){window.dead=true;window.emit('closed');windows.delete(id);}});
  windows.set(id,record);order.push(id);pins.register(window,{pinned:!!owner,locked:!!owner&&active});controller.register(record);return record;
 }
 const ide=add('ide');
 return{ide,add,pins,controller,order,calls,tasks,errors,flush(){const work=[...tasks.values()];tasks.clear();for(const task of work)task();},
  vr(value){active=value;for(const record of windows.values())if(record===ide||record.owner===ide)pins.setLocked(record.window,value);controller.refresh(ide);},
  above(record){assert.ok(order.indexOf(record.window.getMediaSourceId())>order.indexOf(ide.window.getMediaSourceId()));}};
}
test('起動済みの別rendererパネルをVR開始時とIDE選択後に本体より前へ置く',()=>{
 const f=fixture(),explorer=f.add('explorer',f.ide),routes=f.add('panel-routes',f.ide);
 f.pins.toggle(explorer.window);assert.equal(explorer.window.pinned,false);
 f.vr(true);f.above(explorer);f.above(routes);assert.equal(explorer.window.pinned,true);
 for(let i=0;i<10;i++){f.ide.window.focus();f.above(explorer);f.above(routes);assert.equal(f.ide.window.isFocused(),true);}
 assert.equal(f.tasks.size,1,'OSイベント後の確認はまとめて一回だけ');f.flush();assert.equal(f.tasks.size,0);
 f.vr(false);assert.equal(explorer.window.pinned,false);assert.equal(routes.window.pinned,true);
 const calls=f.calls.length;f.ide.window.focus();f.flush();assert.equal(f.calls.length,calls,'通常表示では選択順に戻る');
});
test('表示・復元・最大化・画面更新・VR中に新規作成したパネルにも適用',()=>{
 const f=fixture();f.vr(true);const explorer=f.add('explorer',f.ide),routes=f.add('panel-routes',f.ide);
 for(const record of [f.ide,explorer,routes])for(const event of ['show','restore','maximize','unmaximize']){
  f.ide.window.moveTop();record.window.emit(event);f.above(explorer);f.above(routes);
 }
 f.ide.window.moveTop();f.controller.refresh(f.ide);f.above(explorer);f.above(routes);
 explorer.window.focus();f.controller.refresh(f.ide);assert.equal(f.order.at(-1),explorer.window.getMediaSourceId(),'選択パネルをパネル群の最上段に保つ');
});
test('他のIDE、ピンOFF、非表示・最小化したパネルを持ち上げない',()=>{
 const f=fixture(),other=f.add('ide'),foreign=f.add('explorer',other),code=f.add('code',f.ide),hidden=f.add('explorer',f.ide),minimized=f.add('panel-routes',f.ide);
 code.stack=false;hidden.window.visible=false;minimized.window.minimized=true;f.calls.length=0;f.vr(true);f.ide.window.focus();f.flush();assert.equal(f.calls.length,0);
 for(const record of [other,foreign,code,hidden,minimized])assert.ok(!f.calls.some(([id])=>id===record.window.getMediaSourceId()));
 hidden.window.visible=true;hidden.window.emit('show');f.above(hidden);assert.ok(!minimized.window.isFocused());
 f.calls.length=0;f.ide.window.minimized=true;f.controller.refresh(f.ide);f.flush();assert.equal(f.calls.length,0);
});
test('再入・終了・VR解除後の遅延処理を安全に扱い、購読を片付ける',()=>{
 const f=fixture(),explorer=f.add('explorer',f.ide);f.vr(true);
 const move=explorer.window.moveAbove;explorer.window.moveAbove=target=>{move(target);f.ide.window.emit('focus');};
 f.ide.window.focus();f.flush();assert.equal(f.tasks.size,0,'moveAboveがfocusを誘発してもループしない');
 explorer.window.moveAbove=()=>{throw Error('native target disappeared');};f.controller.refresh(f.ide);assert.ok(f.errors.length>0);
 f.vr(false);const calls=f.calls.length;f.flush();assert.equal(f.calls.length,calls);
 f.vr(true);f.ide.window.destroy();assert.equal(f.tasks.size,0);assert.equal(f.ide.window.listenerCount('show'),0);
 explorer.window.destroy();assert.equal(explorer.window.listenerCount('restore'),0);f.flush();
});
test('実mainはピン登録後の全窓登録とVRロック更新後の再配置を接続',()=>{
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 assert.match(source,/windowPins\.register\(record\.window,[^\n]+\n vrPanelStacking\.register\(record\);/);
 assert.match(source,/windowPins\.setLocked\(record\.window,locked\|\|\(record\.kind==='browser'&&record\.window\.isFullScreen\(\)\)\);\r?\n vrPanelStacking\.refresh\(owner\);/);
});

test('Windowsは同じ最前面層のmoveTopで本体選択後もパネルを維持する',()=>{
 const f=fixture('win32'),explorer=f.add('explorer',f.ide),routes=f.add('panel-routes',f.ide);
 explorer.window.moveAbove=routes.window.moveAbove=()=>assert.fail('WindowsではmoveAboveを使わない');
 f.vr(true);for(let i=0;i<5;i++){f.ide.window.focus();f.flush();f.above(explorer);f.above(routes);assert.equal(f.ide.window.isFocused(),true);}
});

test('VR中に追加した全種別のパネルはピン固定で本体より前に出る',()=>{
 const f=fixture('win32');f.vr(true);
 for(const kind of ['explorer','panel-routes','panel-viewer','code','live','navi','console']){const record=f.add(kind,f.ide);assert.deepEqual(f.pins.state(record.window),{pinned:true,locked:true});f.pins.toggle(record.window);assert.equal(f.pins.state(record.window).pinned,true);f.ide.window.focus();f.flush();f.above(record);}
});
