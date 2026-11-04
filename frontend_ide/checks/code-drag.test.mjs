// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {installWindowMove,windowMoveTarget} from '../src/components/共通表示/長押し窓移動.js';
const {createCodeDrag}=createRequire(import.meta.url)('../デスクトップ/code-drag.cjs');
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function native(rounding=0,options={}){
 const window=new EventEmitter(),webContents=new EventEmitter(),positions=[],timers=new Map();let id=0,cursor={x:-1900,y:-200};
 let bounds={x:-1800,y:-100,width:900,height:700};
 Object.assign(window,{webContents,isDestroyed:()=>false,isMaximized:()=>false,isFullScreen:()=>false,isFocused:()=>true,getBounds:()=>({...bounds}),setBounds:(value,animate)=>{positions.push([value,animate]);bounds={...value,width:value.width+rounding,height:value.height+rounding};}});
 const record={window,kind:'code',revision:1};
 const api=createCodeDrag({trustedEvent:event=>event.record,screen:{getCursorScreenPoint:()=>({...cursor})},setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:id=>timers.delete(id),...options});
 return{api,record,window,webContents,positions,timers,event:{record},cursor:value=>cursor=value,resize:value=>bounds={...bounds,...value}};
}
test('native: Code本人だけを同じDIP座標の差分で移動し、負座標・倍率境界を丸め誤差なく保つ',()=>{
 const f=native(),token=f.api.begin(f.event);assert.equal(typeof token,'string');f.cursor({x:-1875,y:-170});assert.equal(f.api.move(f.event,token),true);assert.deepEqual(f.positions,[[{x:-1775,y:-70,width:900,height:700},false]]);
 f.cursor({x:30,y:40});f.api.move(f.event,token);assert.deepEqual(f.positions[1],[{x:130,y:140,width:900,height:700},false]);
 assert.equal(f.api.move({record:{...f.record}},token),false);assert.equal(f.api.move(f.event,'fake'),false);
 f.api.end(f.event,token);assert.equal(f.timers.size,0);assert.equal(f.window.listenerCount('blur'),0);assert.equal(f.api.move(f.event,token),false);
 f.record.kind='unknown';assert.equal(f.api.begin(f.event),null);
});

test('VR配置の自動移動中はIDEと子パネルの長押し移動を重ねない',()=>{
 const f=native();f.record.vrPanelMoving=true;assert.equal(f.api.begin(f.event),null);
 f.record.vrPanelMoving=false;f.record.owner={vrPanelMoving:true};assert.equal(f.api.begin(f.event),null);
 f.record.owner.vrPanelMoving=false;const token=f.api.begin(f.event);assert.equal(typeof token,'string');f.api.end(f.event,token);
});

test('IDE通常モードは窓を動かし、VRでは倍率を考慮した中心差分だけを通知する',()=>{
 let vr=false;
 const f=native(0,{isCenterMove:()=>vr}),messages=[];f.record.kind='ide';
 Object.assign(f.webContents,{isDestroyed:()=>false,getZoomFactor:()=>1.5,send:(channel,value)=>messages.push({channel,...value})});
 let token=f.api.begin(f.event);f.cursor({x:-1870,y:-185});f.api.move(f.event,token);f.api.end(f.event,token);
 assert.equal(f.positions.length,1);assert.equal(messages.length,0);
 const bounds=f.window.getBounds();vr=true;
 token=f.api.begin(f.event);f.cursor({x:-1810,y:-215});f.api.move(f.event,token);f.api.move(f.event,token);f.api.end(f.event,token);
 assert.deepEqual(f.window.getBounds(),bounds);assert.equal(f.positions.length,1);
 assert.deepEqual(messages.map(({phase,x,y})=>({phase,x,y})),[{phase:'start',x:0,y:0},{phase:'move',x:40,y:-20},{phase:'end',x:0,y:0}]);
 assert.ok(messages.every(m=>m.id===token&&m.channel==='development:space-center-move'));
 // 解除・再移行やフォーカス喪失で、古いジェスチャーを窓移動へ流用しない。
 token=f.api.begin(f.event);vr=false;assert.equal(f.api.move(f.event,token),false);
 assert.equal(messages.at(-1).phase,'end');assert.equal(f.positions.length,1);
 token=f.api.begin(f.event);vr=true;assert.equal(f.api.move(f.event,token),false);assert.equal(f.positions.length,1);
 token=f.api.begin(f.event);f.window.emit('blur');assert.equal(messages.at(-1).phase,'end');assert.equal(f.api.move(f.event,token),false);assert.equal(f.timers.size,0);
});
test('静止中のheartbeatは窓を変更せずleaseを更新し、移動を繰り返しても端数DPIで膨張しない',()=>{
 for(const rounding of [0,1,2]){
  const f=native(rounding);
  for(let gesture=0;gesture<4;gesture++){
   const token=f.api.begin(f.event),start=f.window.getBounds(),calls=f.positions.length;
   const oldLease=[...f.timers.values()][0];
   for(let i=0;i<20;i++)assert.equal(f.api.move(f.event,token),true);
   assert.equal(f.positions.length,calls);oldLease();assert.equal(f.api.move(f.event,token),true);
   for(let i=0;i<30;i++){
    f.cursor({x:-1900+(gesture*30+i+1)*7,y:-200+(gesture*30+i+1)*3});
    assert.equal(f.api.move(f.event,token),true);
    const actual=f.window.getBounds();assert.equal(actual.width,start.width);assert.equal(actual.height,start.height);
    const moved=f.positions.length;f.api.move(f.event,token);assert.equal(f.positions.length,moved);
   }
   f.api.end(f.event,token);assert.equal(f.timers.size,0);
  }
  assert.equal(f.window.getBounds().width,900);assert.equal(f.window.getBounds().height,700);
 }
});
test('補正後に残る整数DIP誤差を次の長押しへ累積せず、手動サイズ変更は維持する',()=>{
 const f=native();
 // この座標では偶数幅を正確に表現できないOSを模擬する。
 f.window.setBounds=(value,animate)=>{f.positions.push([value,animate]);f.resize({...value,width:2*Math.floor(value.width/2)+1});};
 for(let gesture=0;gesture<10;gesture++){
  const token=f.api.begin(f.event),calls=f.positions.length;
  f.cursor({x:-1890+gesture*10,y:-200});f.api.move(f.event,token);
  assert.equal(f.positions[calls][0].width,900);
  assert.ok(Math.abs(f.window.getBounds().width-900)<=1);
  f.api.end(f.event,token);
 }
 f.resize({width:1000,height:800});
 const token=f.api.begin(f.event),calls=f.positions.length;
 f.cursor({x:-1700,y:0});f.api.move(f.event,token);
 assert.equal(f.positions[calls][0].width,1000);assert.equal(f.positions[calls][0].height,800);
 f.api.end(f.event,token);
});
for(const reason of ['blur','closed','did-start-navigation','render-process-gone','lease','revision','maximized','fullscreen'])test(`native終了: ${reason}`,()=>{
 const f=native(),token=f.api.begin(f.event);
 if(reason==='lease')[...f.timers.values()][0]();else if(reason==='revision')f.record.revision++;else if(reason==='maximized')f.window.isMaximized=()=>true;else if(reason==='fullscreen')f.window.isFullScreen=()=>true;else(reason==='blur'||reason==='closed'?f.window:f.webContents).emit(reason);
 assert.equal(f.api.move(f.event,token),false);assert.equal(f.positions.length,0);assert.equal(f.timers.size,0);assert.equal(f.webContents.listenerCount('did-start-navigation'),0);
});
for(const kind of ['code','live','console','viewer','explorer','panel-viewer','panel-routes'])test(`窓全体の長押し: ${kind}の移動・解除`,async()=>{
 const f=native();f.record.kind=kind;const token=f.api.begin(f.event);assert.equal(typeof token,'string');
 f.cursor({x:-1800,y:-150});assert.equal(f.api.move(f.event,token),true);f.api.end(f.event,token);assert.equal(f.timers.size,0);
 const b=browser({kind});b.emit('pointerdown');await b.advance(500);assert.equal(b.doc.documentElement.classes.has('window-moving'),true);
 b.emit('pointermove',{screenX:170});await b.advance(16);assert.ok(b.calls.some(call=>Array.isArray(call)&&call[0]==='move'));b.dispose();assert.equal(b.intervals.size,0);
});
test('ピン留め窓の移動は所有元と窓名で解決し、別の窓・古い所有元からtokenを使えない',()=>{
 const owner={kind:'ide'},other={kind:'ide'};let allowed=true;
 const f=native(0,{resolvePanel:(source,name)=>allowed&&source===owner&&name==='panel'?f.record:null});f.record.kind='panel-viewer';
 assert.equal(f.api.begin({record:other},'panel'),null);assert.equal(f.api.begin({record:owner},'wrong'),null);
 const event={record:owner},token=f.api.begin(event,'panel');assert.equal(typeof token,'string');
 f.cursor({x:-1800,y:-150});assert.equal(f.api.move(event,token,'panel'),true);
 assert.equal(f.api.move({record:other},token,'panel'),false);assert.equal(f.api.move(event,token,'wrong'),false);
 allowed=false;assert.equal(f.api.move(event,token,'panel'),false);f.window.emit('closed');assert.equal(f.timers.size,0);
});
class Surface{
 listeners=new Map();children=[];style={setProperty:(key,value)=>{this.style[key]=value;}};classes=new Set();classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)};
 addEventListener(type,fn){const set=this.listeners.get(type)||new Set();set.add(fn);this.listeners.set(type,set);}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
 emit(type,extra={}){const event={type,button:0,buttons:1,isPrimary:true,pointerType:'mouse',pointerId:1,clientX:50,clientY:50,screenX:150,screenY:150,target:this,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};for(const fn of this.listeners.get(type)||[])fn(event);return event;}
 closest(){return this.excluded?this:null;}getBoundingClientRect(){return{left:0,top:0,width:500,height:500};}setAttribute(){}append(child){child.parent=this;this.children.push(child);}remove(){this.parent.children=this.parent.children.filter(x=>x!==this);}setPointerCapture(){this.capture=true;}hasPointerCapture(){return this.capture;}releasePointerCapture(){this.capture=false;}
}
function browser(options={}){
 const win=new Surface(),doc=new Surface(),target=new Surface(),tasks=new Map(),intervals=new Map(),calls=[];let id=0,time=0,selections=0;
 doc.documentElement=new Surface();doc.body=new Surface();doc.createElement=()=>new Surface();doc.getSelection=()=>({removeAllRanges:()=>selections++});win.document=doc;win.getComputedStyle=()=>({webkitAppRegion:''});
 win.setTimeout=(fn,delay)=>{tasks.set(++id,{fn,at:time+delay});return id;};win.clearTimeout=id=>tasks.delete(id);win.setInterval=fn=>{intervals.set(++id,fn);return id;};win.clearInterval=id=>intervals.delete(id);win.requestAnimationFrame=fn=>win.setTimeout(fn,16);win.cancelAnimationFrame=win.clearTimeout;
 const api={beginWindowMove:async()=>{calls.push('begin');return 'token';},moveWindow:async token=>{calls.push(['move',token]);return true;},endWindowMove:async token=>{calls.push(['end',token]);},...options.api};
 const dispose=installWindowMove({kind:'code',win,...options,api:options.api===null?{}:api});
 return{win,doc,target,tasks,intervals,calls,dispose,get selections(){return selections;},async advance(ms){time+=ms;for(const [id,t]of [...tasks])if(t.at<=time){tasks.delete(id);t.fn();}await flush();},emit:(type,extra={})=>doc.emit(type,{target,...extra})};
}
test('長押し: 0.5秒前は選択維持、成立後は移動カーソルのみ、解放で全解除',async()=>{
 const f=browser();const down=f.emit('pointerdown');f.emit('pointermove');await f.advance(499);assert.equal(down.prevented,undefined);assert.equal(f.selections,0);assert.equal(f.calls.length,0);
 f.target.setPointerCapture=()=>{throw Error('本文の再描画で押下元の文字DOMが除去された');};
 await f.advance(1);assert.equal(f.selections,1);assert.equal(f.doc.documentElement.capture,true);assert.equal(f.doc.body.children.length,0);assert.equal(f.doc.documentElement.classes.has('window-moving'),true);
 const move=f.emit('pointermove',{screenX:170,clientX:70});assert.equal(move.prevented,true);assert.equal(f.doc.body.children.length,0);await f.advance(16);assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='move').length,1);
 f.emit('pointerup');assert.equal(f.doc.body.children.length,0);assert.equal(f.doc.documentElement.capture,false);assert.equal(f.intervals.size,0);assert.equal(f.tasks.size,0);assert.deepEqual(f.calls.at(-1),['end','token']);f.dispose();
});
test('通常ドラッグ・入力・ボタン・scrollbarは長押し移動にしない',async()=>{
 const f=browser();f.emit('pointerdown');const move=f.emit('pointermove',{screenX:151});f.emit('pointermove',{screenX:150});await f.advance(500);assert.equal(f.calls.length,0);assert.equal(move.prevented,undefined);
 f.target.excluded=true;f.emit('pointerdown');await f.advance(500);assert.equal(f.calls.length,0);f.target.excluded=false;
 Object.assign(f.target,{offsetWidth:500,clientWidth:485,clientLeft:0,offsetHeight:500,clientHeight:500,clientTop:0});assert.equal(windowMoveTarget(f.target,490,50,f.win),false);assert.equal(windowMoveTarget(f.target,100,50,f.win),true);f.dispose();
 Object.assign(f.target,{offsetWidth:150,clientWidth:0,offsetHeight:20,clientHeight:0});assert.equal(windowMoveTarget(f.target,100,10,f.win),true,'MonacoやConsoleの文字spanをスクロールバー扱いしない');
});
test('Explorer一覧・軌跡のno-drag面はfallbackでも500ms待ち、操作部品やnative二重導入を除外',async()=>{
 for(const kind of ['explorer','panel-routes']){
  const f=browser({kind});
  f.win.getComputedStyle=()=>({webkitAppRegion:'drag'});f.emit('pointerdown');await f.advance(500);assert.equal(f.calls.length,0,'OSの即時drag面はfallback対象外');
  f.win.getComputedStyle=()=>({webkitAppRegion:'no-drag'});f.emit('pointerdown');await f.advance(499);assert.equal(f.calls.length,0);
  await f.advance(1);assert.deepEqual(f.calls,['begin']);f.emit('pointerup');
  f.target.excluded=true;f.emit('pointerdown');await f.advance(500);assert.equal(f.calls.filter(call=>call==='begin').length,1,'面内のボタン・入力は除外');f.dispose();
  const nativeOnly=browser({kind,api:{nativeWindowMove:true}});nativeOnly.emit('pointerdown');await nativeOnly.advance(500);assert.equal(nativeOnly.calls.length,0);assert.equal(nativeOnly.doc.listeners.size,0);nativeOnly.dispose();
 }
});
test('プレビューiframeの追加・再読込・除去で長押し購読と移動tokenを片付ける',async()=>{
 const root=browser({api:null}),first=browser({api:null}),second=browser({api:null}),calls=[];
 for(const f of [root,first,second])f.doc.head=new Surface();
 let frames=[];root.doc.querySelectorAll=()=>frames;
 const api={beginWindowMove:async()=>{calls.push('begin');return 'frame-token';},moveWindow:async()=>true,endWindowMove:async()=>calls.push('end')};
 const stop=installWindowMove({kind:'panel-viewer',win:root.win,api});
 const frame={tagName:'IFRAME',contentWindow:first.win};
 frames=[frame,{contentWindow:{get document(){throw Error('cross-origin');}}}];root.doc.emit('load',{target:frame});
 first.emit('pointerdown');await first.advance(500);assert.equal(first.doc.documentElement.classes.has('window-moving'),true);
 frame.contentWindow=second.win;root.doc.emit('load',{target:frame});
 assert.equal(first.doc.documentElement.classes.size,0);assert.equal(first.intervals.size,0);assert.deepEqual(calls,['begin','end']);assert.equal(first.doc.head.children.length,0);
 second.emit('pointerdown');await second.advance(500);assert.equal(second.doc.documentElement.classes.has('window-moving'),true);
 frames=[];root.doc.emit('load',{target:frame});assert.equal(second.intervals.size,0);assert.equal(second.doc.head.children.length,0);
 stop();for(const f of [root,first,second]){assert.equal([...f.doc.listeners.values()].reduce((sum,set)=>sum+set.size,0),0);f.dispose();}
 assert.deepEqual(calls,['begin','end','begin','end']);
});
for(const reason of ['pointercancel','lostpointercapture','blur','pagehide','escape','outside-release','dispose'])test(`長押し終了: ${reason}`,async()=>{
 const f=browser();f.emit('pointerdown');await f.advance(500);
 if(reason==='dispose')f.dispose();else if(reason==='blur'||reason==='pagehide')f.win.emit(reason);else if(reason==='escape')f.emit('keydown',{key:'Escape'});else if(reason==='outside-release')f.emit('pointermove',{buttons:0});else f.emit(reason);
 assert.equal(f.doc.body.children.length,0);assert.equal(f.intervals.size,0);assert.equal(f.tasks.size,0);assert.equal(f.doc.documentElement.classes.size,0);f.dispose();assert.equal([...f.doc.listeners.values()].reduce((sum,set)=>sum+set.size,0),0);
});
test('遅い開始応答はキャンセル後に表示せずnativeも終了、Web/IDE本体/VSCodeには導入しない',async()=>{
 let resolve;const f=browser({api:{beginWindowMove:()=>new Promise(done=>{resolve=done;})}});f.emit('pointerdown');await f.advance(500);f.emit('pointerup');resolve('late');await flush();assert.equal(f.doc.body.children.length,0);assert.deepEqual(f.calls,[['end','late']]);f.dispose();
 for(const options of [{kind:'ide'},{kind:'unknown'},{host:true},{api:null}]){const g=browser(options);g.emit('pointerdown');await g.advance(500);assert.equal(g.calls.length,0);assert.equal(g.doc.listeners.size,0);g.dispose();}
});
test('native開始拒否・既存選択dragは選択を消さず、古いleaseが次の移動を終了しない',async()=>{
 const f=browser({api:{beginWindowMove:async()=>null}});f.emit('pointerdown');await f.advance(500);assert.equal(f.selections,0);f.dispose();
 const g=browser();g.emit('pointerdown');const drag=g.emit('dragstart');await g.advance(500);assert.equal(drag.prevented,undefined);assert.equal(g.calls.length,0);g.dispose();
 const n=native();n.api.begin(n.event);const old=[...n.timers.values()][0];const token=n.api.begin(n.event);old();assert.equal(n.api.move(n.event,token),true);n.api.end(n.event,token);
});
