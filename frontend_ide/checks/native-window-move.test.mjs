// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import nativeMove from '../デスクトップ/長押し窓移動.cjs';
import codeDrag from '../デスクトップ/code-drag.cjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
test('File背景と非モーダル比較だけを許可し、子入力と別モーダルを保護する',()=>{
 const element=(selectors,parent=null)=>({parentElement:parent,matches:q=>q.split(',').some(s=>selectors.includes(s)),getRootNode:()=>({}),getClientRects:()=>[{}]});
 const allowed=(node,popups=[])=>vm.runInNewContext(`(${nativeMove.backgroundMoveTarget.toString()})(10,20)`,{document:{elementFromPoint:()=>node,querySelector:()=>null,querySelectorAll:()=>popups},getComputedStyle:()=>({visibility:'visible'})});
 const file=element(['section.file-container[data-aidiy-window-move-surface]','[tabindex]:not([tabindex="-1"])']);
 const compare=element(['section.file-history-dialog.history-embedded[data-aidiy-window-move-surface]']);
 const cpu=element(['section.cpu-panel[data-aidiy-window-move-surface]','[tabindex]:not([tabindex="-1"])']);
 for(const surface of [file,compare,cpu]){
  const popups=surface===compare?[compare]:[];
  for(const tag of ['div','svg','path','text','footer'])assert.equal(allowed(element([tag],surface),popups),true);
  for(const control of ['input','button','select','.monaco-editor','[tabindex]:not([tabindex="-1"])','[data-aidiy-no-window-move]'])assert.equal(allowed(element([control],surface),popups),false,control);
  assert.equal(allowed(surface,[...popups,element(['[role="dialog"]'])]),false,'別のモーダルは保護');
 }
 assert.equal(allowed(element(['[tabindex]:not([tabindex="-1"])'])),false,'未指定のtabindexは保護');
 assert.equal(allowed(element(['div']),[element(['[role="dialog"]'])]),false,'通常ダイアログは保護');
});
function fixture(kind='viewer',target=()=>Promise.resolve(1),arm=()=>Promise.resolve(true),realDrag=false){
 const contents=new EventEmitter(),window=new EventEmitter(),timers=new Map(),ticks=new Map(),inputs=[],calls=[],sent=[],queries=[];
 let cursor={x:100,y:100},serial=0,time=0,bounds={x:50,y:60,width:400,height:300};
 const positions=[],leases=new Map();
 const emit=(type,extra={})=>{const event={preventDefault(){this.prevented=true;}},mouse={type,x:20,y:30,button:'left',clickCount:1,...extra};contents.emit('before-mouse-event',event,mouse);if(!event.prevented)inputs.push(mouse);return event;};
 Object.assign(contents,{isDestroyed:()=>false,getZoomFactor:()=>1,executeJavaScript:async()=>{},executeJavaScriptInIsolatedWorld:(world,scripts)=>{const action=scripts[0].code.match(/\)\("(install|query|arm|disarm|dispose)",/)[1];queries.push({world,scripts,action});return action==='query'?target():action==='arm'?arm():Promise.resolve(true);},sendInputEvent:input=>{sent.push(input);return emit(input.type,input);},insertCSS:async()=> 'move-css',removeInsertedCSS:async key=>calls.push(['css-remove',key])});
 Object.assign(window,{webContents:contents,isDestroyed:()=>false,isMaximized:()=>false,isFullScreen:()=>false,isFocused:()=>true,getBounds:()=>({...bounds}),setBounds:value=>{bounds={...value};positions.push({...value});}});
 const record={kind,window};
 const realController=realDrag?codeDrag.createCodeDrag({trustedEvent:()=>null,screen:{getCursorScreenPoint:()=>({...cursor})},setTimer:fn=>{leases.set(++serial,fn);return serial;},clearTimer:id=>leases.delete(id)}):null;
 const dispose=nativeMove.installNativeWindowMove({record,screen:{getCursorScreenPoint:()=>({...cursor})},drag:realController||{forRecord:r=>{assert.equal(r,record);return{begin:()=>{calls.push(['begin']);return'token';},move:()=>{calls.push(['move']);return true;},end:()=>calls.push(['end'])};}},setTimer:(fn,delay)=>{assert.equal(delay,500);timers.set(++serial,{fn,at:time+delay});return serial;},clearTimer:id=>timers.delete(id),setTick:fn=>{ticks.set(++serial,fn);return serial;},clearTick:id=>ticks.delete(id)});
 return{record,emit,contents,window,timers,ticks,inputs,calls,sent,queries,positions,leases,dispose,advance:async(ms=500)=>{time+=ms;for(const [id,timer]of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}for(let i=0;i<12;i++)await Promise.resolve();},cursor:value=>cursor=value};
}
test('Explorer・軌跡: 499msでは通常入力のまま、500msで同じ静止gestureだけを移動',async()=>{
 for(const kind of ['explorer','panel-routes']){
  const f=fixture(kind);const down=f.emit('mouseDown');await f.advance(499);
  assert.notEqual(down.prevented,true);assert.deepEqual(f.calls,[]);assert.deepEqual(f.queries.map(q=>q.action),['install']);
  await f.advance(1);assert.deepEqual(f.calls,[['begin']]);assert.deepEqual(f.queries.map(q=>q.action),['install','query','arm']);
  f.cursor({x:120,y:130});assert.equal(f.emit('mouseMove').prevented,true);assert.ok(f.calls.some(call=>call[0]==='move'));
  assert.notEqual(f.emit('mouseUp').prevented,true);assert.ok(f.calls.some(call=>call[0]==='end'));assert.equal(f.ticks.size,0);f.dispose();
 }
});
test('Discord・Slack・Task・Teamは実共有controllerまで通り、長押し移動・解放・再操作・blurを保つ',async()=>{
 for(const kind of ['discord','slack','task','team']){
  const f=fixture(kind,undefined,undefined,true);
  f.emit('mouseDown');await f.advance(499);assert.equal(f.ticks.size,0,kind);
  await f.advance(1);assert.equal(f.ticks.size,1,kind);assert.equal(f.leases.size,1,kind);
  f.cursor({x:-300,y:70});assert.equal(f.emit('mouseMove').prevented,true,kind);
  assert.deepEqual(f.positions.at(-1),{x:-350,y:30,width:400,height:300},kind);
  assert.notEqual(f.emit('mouseUp').prevented,true,kind);assert.equal(f.ticks.size,0);assert.equal(f.leases.size,0);
  f.emit('mouseDown');await f.advance();assert.equal(f.ticks.size,1,kind);
  f.window.emit('blur');assert.equal(f.ticks.size,0);assert.equal(f.leases.size,0);f.dispose();
  assert.equal(f.contents.listenerCount('before-mouse-event'),0);
 }
});
test('全パネル: nativeのdown/upを直ちに一度だけ渡し、短押しを再送しない',async()=>{
 for(const kind of ['ide','code','live','navi','console','browser','viewer','explorer','panel-viewer','panel-routes','diag','avatar','discord','slack','task','team']){
  const f=fixture(kind);assert.notEqual(f.emit('mouseDown').prevented,true);assert.deepEqual(f.inputs.map(i=>i.type),['mouseDown']);assert.equal(f.calls.length,0);
  assert.notEqual(f.emit('mouseUp').prevented,true);await f.advance();assert.deepEqual(f.inputs.map(i=>i.type),['mouseDown','mouseUp']);assert.equal(f.timers.size,0);assert.deepEqual(f.sent,[]);assert.deepEqual(f.calls,[]);f.dispose();
 }
});
test('背景の長押しだけ移動し、移動後もnative upを渡して次のクリックを妨げない',async()=>{
 for(const kind of ['browser','diag','avatar','discord','slack','task','team']){
 const f=fixture(kind);f.emit('mouseDown');f.emit('mouseMove');await f.advance();assert.deepEqual(f.calls,[['begin']]);
 f.cursor({x:-300,y:70});f.emit('mouseMove');assert.ok(f.calls.some(c=>c[0]==='move'));assert.notEqual(f.emit('mouseUp').prevented,true);assert.equal(f.inputs.filter(i=>i.type==='mouseDown').length,1);assert.equal(f.inputs.filter(i=>i.type==='mouseUp').length,1);f.inputs.length=0;assert.equal(f.ticks.size,0);
 f.emit('mouseDown');f.emit('mouseUp');assert.deepEqual(f.inputs.map(i=>i.type),['mouseDown','mouseUp']);f.dispose();
 }
});
test('操作部品では長押しでもnative入力を遮断・再送せず、移動を開始しない',async()=>{
 for(const kind of ['code','live','diag','avatar','discord','slack','task','team']){
  const f=fixture(kind,async()=>false);assert.notEqual(f.emit('mouseDown').prevented,true);await f.advance();
  assert.notEqual(f.emit('mouseUp').prevented,true);assert.deepEqual(f.inputs.map(i=>i.type),['mouseDown','mouseUp']);assert.deepEqual(f.sent,[]);assert.deepEqual(f.calls,[]);assert.equal(f.timers.size,0);f.dispose();
 }
});
test('通常の文字選択・スライダーdragとダブルクリックは維持',async()=>{
 const f=fixture();f.emit('mouseDown');f.cursor({x:101,y:100});f.emit('mouseMove',{x:21});f.cursor({x:100,y:100});await f.advance();f.emit('mouseUp',{x:20});
 assert.deepEqual(f.inputs.map(i=>i.type),['mouseDown','mouseMove','mouseUp']);assert.equal(f.calls.length,0);
 f.inputs.length=0;for(const count of [1,2]){f.emit('mouseDown',{clickCount:count});f.emit('mouseUp',{clickCount:count});}
 assert.deepEqual(f.inputs.map(i=>i.clickCount),[1,1,2,2]);f.dispose();
});
test('移動成立後のEsc・フォーカス喪失・破棄・遷移で解除してもnative upを渡す',async()=>{
 for(const cancel of [f=>f.window.emit('blur'),f=>f.contents.emit('before-input-event',{}, {key:'Escape'}),f=>f.contents.emit('did-start-navigation',{},'https://example.org',false,true)]){
  const f=fixture();f.emit('mouseDown');await f.advance();cancel(f);f.emit('mouseUp');assert.equal(f.inputs.filter(i=>i.type==='mouseDown').length,1);assert.equal(f.inputs.filter(i=>i.type==='mouseUp').length,1);assert.equal(f.ticks.size,0);f.dispose();assert.equal(f.contents.listenerCount('before-mouse-event'),0);
 }
 const f=fixture();f.emit('mouseDown');f.contents.emit('destroyed');assert.equal(f.timers.size,0);assert.equal(f.contents.listenerCount('before-mouse-event'),0);
});
test('最大化・全画面・未対応の窓は通常入力をそのまま渡す',()=>{
 for(const mode of ['maximized','fullscreen','unsupported']){
  const f=fixture(mode==='unsupported'?'unknown':'code');f.window.isMaximized=()=>mode==='maximized';f.window.isFullScreen=()=>mode==='fullscreen';
  f.emit('mouseDown');f.emit('mouseUp');assert.equal(f.inputs.length,2);assert.equal(f.timers.size,0);assert.equal(f.queries.filter(q=>q.action!=='install').length,0);assert.equal(f.sent.length,0);f.dispose();
 }
});
test('非同期の対象確認が遅くても500ms未満・解放後・取消後には移動を開始しない',async()=>{
 for(const action of [f=>f.emit('mouseUp'),f=>f.window.emit('blur'),f=>f.contents.emit('before-input-event',{}, {key:'Escape'}),f=>f.contents.emit('did-start-navigation',{},'https://example.org',false,true),f=>f.contents.emit('render-process-gone'),f=>f.contents.emit('dom-ready'),f=>f.emit('mouseLeave'),f=>{f.cursor({x:101,y:100});f.emit('mouseMove');},f=>f.contents.emit('destroyed')]){
  const pending=deferred(),f=fixture('code',()=>pending.promise);f.emit('mouseDown');await f.advance();assert.deepEqual(f.calls,[]);action(f);pending.resolve(1);await f.advance();assert.deepEqual(f.calls,[]);assert.equal(f.timers.size,0);assert.equal(f.ticks.size,0);assert.equal(f.sent.length,0);f.dispose();
 }
 const f=fixture();f.emit('mouseDown');await Promise.resolve();assert.deepEqual(f.calls,[]);f.emit('mouseUp');await f.advance();assert.deepEqual(f.calls,[]);f.dispose();
});
test('対象確認失敗は窓移動だけを取り消し、native入力を妨げない',async()=>{
 for(const target of [()=>{throw Error('frame destroyed');},()=>Promise.reject(Error('navigation')),async()=>undefined]){
  const f=fixture('code',target);f.emit('mouseDown');await f.advance();assert.notEqual(f.emit('mouseUp').prevented,true);assert.deepEqual(f.inputs.map(i=>i.type),['mouseDown','mouseUp']);assert.deepEqual(f.calls,[]);assert.deepEqual(f.sent,[]);f.dispose();
 }
});
test('古い対象確認・別窓の結果は現在の操作に混ざらず、待機中の最大化も移動しない',async()=>{
 const first=deferred(),second=deferred(),pending=[first,second],f=fixture('code',()=>pending.shift().promise),g=fixture('discord',async()=>false);
 f.emit('mouseDown');f.emit('mouseUp');f.emit('mouseDown');g.emit('mouseDown');await f.advance();await g.advance();
 first.resolve(1);await Promise.resolve();assert.deepEqual(f.calls,[]);assert.deepEqual(g.calls,[]);
 f.window.isMaximized=()=>true;second.resolve(1);await f.advance();assert.deepEqual(f.calls,[]);f.emit('mouseUp');g.emit('mouseUp');assert.equal(f.sent.length,0);assert.equal(g.sent.length,0);f.dispose();g.dispose();
});
test('gestureの確認とarmは権限のない隔離worldだけを使い、DOM座標で対象を判定する',async()=>{
 const f=fixture();f.contents.getZoomFactor=()=>1.25;f.emit('mouseDown',{x:25,y:50});await f.advance();
 assert.deepEqual(f.queries.map(q=>q.action),['install','query','arm']);
 for(const query of f.queries){assert.equal(query.world,1004);assert.doesNotMatch(query.scripts[0].code,/ipcRenderer|require\(|fetch\(|postMessage/);}
 assert.match(f.queries[0].scripts[0].code,/eligible\(event.clientX,event.clientY\)/);f.emit('mouseUp');f.dispose();
});
test('armの待機中の解放・別押下・失敗では移動せず、新gestureに古い結果を使わない',async()=>{
 for(const action of [f=>f.emit('mouseUp'),f=>{f.emit('mouseUp');f.emit('mouseDown');},f=>f.window.emit('blur'),f=>f.contents.emit('destroyed')]){
  const arm=deferred(),f=fixture('code',async()=>1,()=>arm.promise);f.emit('mouseDown');await f.advance();assert.deepEqual(f.calls,[]);action(f);arm.resolve(true);for(let i=0;i<12;i++)await Promise.resolve();assert.deepEqual(f.calls,[]);f.dispose();
 }
 for(const arm of [()=>{throw Error('frame destroyed');},()=>Promise.reject(Error('gone')),async()=>false]){
  const f=fixture('code',async()=>1,arm);f.emit('mouseDown');await f.advance();f.emit('mouseUp');assert.deepEqual(f.calls,[]);assert.deepEqual(f.inputs.map(i=>i.type),['mouseDown','mouseUp']);f.dispose();
 }
});
test('native操作部品・ラベル・編集欄・iframe・shadow内の部品を背景移動から除く',()=>{
 const selectors=[];
 const element=(tag,parent=null,extra={})=>({parentElement:parent,isContentEditable:false,matches:query=>{selectors.push(query);return query.split(',').includes(tag);},getRootNode:()=>({}),...extra});
 const allowed=(node,extra={})=>vm.runInNewContext(`(${nativeMove.backgroundMoveTarget.toString()})(10,20)`,{document:{elementFromPoint:()=>node,querySelector:()=>null,querySelectorAll:()=>[],...extra},getComputedStyle:node=>({visibility:node.visibility||'visible'})});
 assert.equal(allowed(null),false);assert.equal(allowed(element('div')),true);
 for(const control of ['select','option','optgroup','datalist','input','textarea','button','a[href]','label','summary','iframe','object','embed','audio[controls]','video[controls]','[role="combobox"]','[role="listbox"]','[role="option"]','.monaco-editor','.xterm','[data-aidiy-no-window-move]']){
  const node=element(control);assert.equal(allowed(node),false,control);assert.equal(allowed(element('span',node)),false,control+'内の子要素');
 }
 assert.equal(allowed(element('div',null,{isContentEditable:true})),false);
 const input=element('input'),host=element('div',null,{shadowRoot:{elementFromPoint:()=>input}});assert.equal(allowed(host),false);
 const button=element('button'),inside=element('span',null,{getRootNode:()=>({host:button})});assert.equal(allowed(inside),false);
 assert.equal(allowed(element('div'),{querySelector:()=>element('select')}),false,'native popup表示中は背景も動かさない');
 for(const tag of ['select','input[list]','[role="combobox"]'])assert.equal(allowed(element('div'),{activeElement:element(tag)}),false,'popup操作中は背景も動かさない');
 assert.equal(allowed(element('div'),{activeElement:{shadowRoot:{activeElement:element('select')}}}),false,'shadow内のselect操作中も動かさない');
 assert.equal(allowed(element('div'),{querySelectorAll:()=>[{getClientRects:()=>[{}]}]}),false,'modal/展開popup表示中は背景も動かさない');
 assert.equal(allowed(element('div'),{querySelectorAll:()=>[{getClientRects:()=>[]}]}),true,'非表示popupは背景を妨げない');
 assert.equal(allowed(element('div'),{querySelectorAll:()=>[{getClientRects:()=>[{}],visibility:'hidden'}]}),true,'visibility hiddenのpopupは背景を妨げない');
 assert.ok(selectors.length>0);
});
test('専用移動面は閉じたselectの残存focusだけを許可し、一般部品・開いたpopupの保護は維持',()=>{
 const element=(selectors,parent=null,extra={})=>({parentElement:parent,isContentEditable:false,matches:query=>query.split(',').some(selector=>selectors.includes(selector)),getRootNode:()=>({}),...extra});
 const marked=parent=>element(['[data-aidiy-window-move-handle]'],parent);
 const focused=element(['select','input[list]','[role="combobox"]']);
 const allowed=(node,extra={})=>vm.runInNewContext(`(${nativeMove.backgroundMoveTarget.toString()})(10,20)`,{document:{elementFromPoint:()=>node,querySelector:()=>null,querySelectorAll:()=>[],activeElement:focused,...extra},getComputedStyle:node=>({visibility:node.visibility||'visible'})});
 assert.equal(allowed(element(['header'])),false,'一般背景では従来のfocus保護を維持');
 for(const name of ['.route-controls','.route-drag-handle']){
  const handle=marked(),surface=element([name],handle);
  assert.equal(allowed(surface),true,name+'は閉じた選択欄の後でも初回から移動可能');
  for(const control of ['button','select','input','label','[role="combobox"]','[role="button"]','[tabindex]:not([tabindex="-1"])','[data-aidiy-no-window-move]']){
   assert.equal(allowed(element(['span'],element([control],handle))),false,name+'内の'+control);
   assert.equal(allowed(element(['span'],marked(element([control])))),false,control+'内のmarkerも権限を広げない');
  }
  assert.equal(allowed(surface,{querySelector:()=>element(['select'])}),false,'open select/input/dialogはmarkerでも移動禁止');
  assert.equal(allowed(surface,{querySelectorAll:()=>[{getClientRects:()=>[{}]}]}),false,'表示中のdialog/listboxも移動禁止');
  assert.equal(allowed(surface,{querySelectorAll:()=>[{getClientRects:()=>[]}]}),true,'閉じたpopupは移動を妨げない');
 }
});
test('独立軌跡バーのボタンと内側の印だけ静止長押しを許可し、埋込バーと明示除外は保護する',()=>{
 const element=(selectors,parent=null)=>({parentElement:parent,isContentEditable:false,matches:query=>query.split(',').some(selector=>selectors.includes(selector)),getRootNode:()=>({})});
 const bar=element(['[data-aidiy-window-move-handle]']),button=element(['button','[tabindex]:not([tabindex="-1"])'],bar),icon=element(['span'],button);
 for(const node of [button,icon])node.closest=selector=>selector==='.native-route-window .route-controls button'?button:null;
 const allowed=(node,extra={})=>vm.runInNewContext(`(${nativeMove.backgroundMoveTarget.toString()})(10,20)`,{document:{elementFromPoint:()=>node,querySelector:()=>null,querySelectorAll:()=>[],activeElement:element(['select']),...extra},getComputedStyle:()=>({visibility:'visible'})});
 assert.equal(allowed(button),true);assert.equal(allowed(icon),true);
 assert.equal(allowed(icon,{querySelector:()=>({})}),false,'開いた選択欄やdialogは優先する');
 assert.equal(allowed(icon,{querySelectorAll:()=>[{getClientRects:()=>[{}]}]}),false,'モーダル表示中は移動しない');
 button.closest=icon.closest=()=>null;assert.equal(allowed(button),false,'本体内の通常ボタンには広げない');
 const excluded=element(['button','[data-aidiy-no-window-move]'],bar);excluded.closest=()=>excluded;assert.equal(allowed(excluded),false,'明示的な移動禁止を尊重する');
});
test('別窓Explorer一覧: 行と余白だけ許可し、未指定tree・操作部品・スクロールバーは除外',()=>{
 const element=(selectors,parent=null,extra={})=>({parentElement:parent,isContentEditable:false,matches:query=>query.split(',').some(selector=>selectors.includes(selector)),getRootNode:()=>({}),getBoundingClientRect:()=>({left:0,top:0}),...extra});
 const marked=()=>element(['ul[role="tree"][data-aidiy-window-move-list]','[tabindex]:not([tabindex="-1"])']);
 const allowed=(node,extra={},x=10,y=20)=>vm.runInNewContext(`(${nativeMove.backgroundMoveTarget.toString()})(${x},${y})`,{document:{elementFromPoint:()=>node,querySelector:()=>null,querySelectorAll:()=>[],...extra},getComputedStyle:()=>({visibility:'visible'})});
 const tree=marked(),row=element(['li'],tree),text=element(['span'],row);
 assert.equal(allowed(tree),true,'一覧の余白');assert.equal(allowed(row),true,'ファイル行');assert.equal(allowed(text),true,'ファイル名');
 assert.equal(allowed(text,{activeElement:element(['select'])}),true,'閉じた選択欄の直後も一覧を長押し可能');
 assert.equal(allowed(element(['span'],element(['[tabindex]:not([tabindex="-1"])']))),false,'埋込IDEなど未指定のtreeは従来どおり');
 for(const control of ['input','button','label','[role="button"]','[tabindex]:not([tabindex="-1"])','[data-aidiy-no-window-move]']){
  assert.equal(allowed(element(['span'],element([control],tree))),false,'一覧内の'+control);
  const underControl=marked();underControl.parentElement=element([control]);assert.equal(allowed(element(['span'],underControl)),false,'一覧外側の'+control);
 }
 assert.equal(allowed(text,{querySelector:()=>element(['dialog'])}),false);
 assert.equal(allowed(text,{querySelectorAll:()=>[{getClientRects:()=>[{}]}]}),false,'context menu表示中は一覧も動かさない');
 Object.assign(tree,{clientWidth:100,offsetWidth:115,clientLeft:0,clientHeight:80,offsetHeight:95,clientTop:0});
 assert.equal(allowed(tree,{},105,20),false,'縦scrollbar');assert.equal(allowed(tree,{},10,85),false,'横scrollbar');assert.equal(allowed(text,{},10,20),true);
});

function rendererFixture(){
 const listeners=new Map(),events=[],released=[];let allowed=true,dragging=false;
 const target={dispatchEvent(event){events.push(event.type);if(event.type==='pointercancel')dragging=false;},hasPointerCapture:()=>true,releasePointerCapture:id=>released.push(id)};
 const context=vm.createContext({window:{addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);}},PointerEvent:class{constructor(type,init){Object.assign(this,init,{type,isTrusted:false});}},backgroundTarget:()=>allowed});
 const run=(action,id=null,owner='owner')=>vm.runInContext(`(${nativeMove.rendererMoveGesture.toString()})(${JSON.stringify(action)},${JSON.stringify(owner)},${JSON.stringify(id)},backgroundTarget)`,context);
 const emit=(type,extra={})=>{const event={type,isTrusted:true,button:0,detail:1,pointerId:7,clientX:20,clientY:30,target,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};for(const fn of listeners.get(type)||[])fn(event);events.push(type);return event;};
 const down=()=>{dragging=true;emit('pointerdown');emit('mousedown');};
 run('install');return{run,emit,down,events,released,listeners,target,allow:value=>allowed=value,dragging:()=>dragging};
}
test('renderer: 成立した背景gestureだけをpointercancelし、実upを通してclickだけ抑止',()=>{
 const f=rendererFixture();f.down();const id=f.run('query');assert.ok(id>0);assert.equal(f.run('arm',id),true);
 assert.equal(f.dragging(),false);assert.deepEqual(f.released,[7]);assert.ok(f.events.includes('pointercancel'));
 assert.notEqual(f.emit('pointerup').prevented,true);assert.notEqual(f.emit('mouseup').prevented,true);
 const click=f.emit('click');assert.equal(click.prevented,true);assert.equal(click.stopped,true);
 f.down();f.emit('pointerup');f.emit('mouseup');assert.notEqual(f.emit('click').prevented,true);
});
test('renderer: 解放・移動・新しい押下をまたぐ古いarmは新しいclickを奪わない',()=>{
 for(const cancel of [f=>f.emit('mouseup'),f=>f.emit('mousemove',{clientX:21}),f=>f.emit('pointercancel'),f=>f.down()]){
  const f=rendererFixture();f.down();const old=f.run('query');cancel(f);assert.equal(f.run('arm',old),false);f.emit('mouseup');assert.notEqual(f.emit('click').prevented,true);
 }
 const f=rendererFixture();f.down();const old=f.run('query');f.run('arm',old);f.emit('mouseup');
 assert.notEqual(f.emit('click',{detail:0}).prevented,true,'keyboard clickは抑止しない');
 f.down();f.emit('mouseup');assert.notEqual(f.emit('click').prevented,true,'失われたrelease後でも次の押下は通常操作');
});
test('renderer: controls・途中で開いたpopup・別owner・破棄・未導入はfail closed',()=>{
 const f=rendererFixture();f.allow(false);f.down();assert.equal(f.run('query'),null);assert.equal(f.run('arm',1),false);f.emit('mouseup');assert.notEqual(f.emit('click').prevented,true);assert.equal(f.events.includes('pointercancel'),false);
 f.allow(true);f.down();const id=f.run('query');f.allow(false);assert.equal(f.run('arm',id),false,'長押し中にpopupが開いた場合');
 assert.equal(f.run('arm',id,'wrong-window'),false);assert.equal(f.run('dispose'),true);assert.equal(f.run('query'),false);assert.ok([...f.listeners.values()].every(set=>set.size===0));
});

test('navigation後に同じ連番になっても古いdocument ownerではarmしない',()=>{
 const f=rendererFixture();f.down();const old=f.run('query');f.run('install',null,'new-document');f.down();
 assert.equal(f.run('query',null,'new-document'),old,'連番が一致する条件');assert.equal(f.run('arm',old),false);assert.equal(f.events.includes('pointercancel'),false);f.emit('mouseup');assert.notEqual(f.emit('click').prevented,true);
 const main=fixture();const first=main.queries[0].scripts[0].code;main.contents.emit('dom-ready');assert.notEqual(main.queries[1].scripts[0].code,first,'documentごとにownerを更新');main.dispose();
});

test('隔離world APIが使えない場合でも取り付け・再読込を失敗させず通常入力を渡す',async()=>{
 const f=fixture();delete f.contents.executeJavaScriptInIsolatedWorld;assert.doesNotThrow(()=>f.contents.emit('dom-ready'));f.emit('mouseDown');await f.advance();f.emit('mouseUp');assert.deepEqual(f.calls,[]);assert.deepEqual(f.inputs.map(i=>i.type),['mouseDown','mouseUp']);f.dispose();
});

for (const kind of ['cpu','task','team']) {
 test(`${kind}: 実共有controllerで500ms移動し、解放・再操作・取消時に回収する`,async()=>{
  for (const view of kind==='task'?['request','flow','detail','dialog']:['combined']) {
   const f=fixture(kind,undefined,undefined,true);f.record.taskView=view;
   try {
    const down=f.emit('mouseDown');await f.advance(499);
    assert.notEqual(down.prevented,true);assert.equal(f.ticks.size,0);assert.equal(f.leases.size,0);
    await f.advance(1);assert.equal(f.ticks.size,1,view);assert.equal(f.leases.size,1,view);
    f.cursor({x:130,y:120});assert.equal(f.emit('mouseMove').prevented,true);
    assert.deepEqual(f.positions.at(-1),{x:80,y:80,width:400,height:300});
    assert.notEqual(f.emit('mouseUp').prevented,true);assert.equal(f.ticks.size,0);assert.equal(f.leases.size,0);
    // 同じ窓で再開し、Esc / blur / スクロール / 遷移 / renderer終了を各回で回収する。
    for (const cancel of [f=>f.contents.emit('before-input-event',{preventDefault(){}},{key:'Escape'}),f=>f.window.emit('blur'),f=>f.emit('mouseWheel'),f=>f.contents.emit('did-start-navigation',{},'about:blank',false,true),f=>f.contents.emit('render-process-gone')]) {
     f.emit('mouseDown');await f.advance();assert.equal(f.ticks.size,1);assert.equal(f.leases.size,1);
     cancel(f);assert.equal(f.ticks.size,0);assert.equal(f.leases.size,0);
     assert.notEqual(f.emit('mouseUp').prevented,true);
    }
    f.emit('mouseDown');await f.advance();f.window.emit('closed');
    assert.equal(f.ticks.size,0);assert.equal(f.leases.size,0);assert.equal(f.contents.listenerCount('before-mouse-event'),0);
   } finally { f.dispose(); }
  }
 });
 test(`${kind}: 早い解放・選択移動・wheel・遅いDOM結果で移動を開始しない`,async()=>{
  for (const cancel of [f=>f.emit('mouseUp'),f=>{f.cursor({x:101,y:100});f.emit('mouseMove');},f=>f.emit('mouseWheel'),f=>f.window.emit('blur')]) {
   const pending=deferred(),f=fixture(kind,()=>pending.promise,undefined,true);
   try {
    f.emit('mouseDown');await f.advance();cancel(f);pending.resolve(1);await f.advance(0);
    assert.equal(f.ticks.size,0);assert.equal(f.leases.size,0);assert.deepEqual(f.positions,[]);
    assert.notEqual(f.emit('mouseUp').prevented,true);
   } finally { f.dispose(); }
  }
 });
}
