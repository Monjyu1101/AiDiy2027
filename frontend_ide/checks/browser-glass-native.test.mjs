// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../デスクトップ/ブラウザ全画面パネル.cjs',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};

function fixture({platform='linux',release='6.12.0',zoom=1,area={x:-1600,y:40,width:1600,height:900},deferLoad=false}={}){
 const timers=new Map(),headers=new Map();let clock=0,next=0,nativeWindow,captures=0,finishLoad,stopped=0;
 const state={area:{...area}};
 class Window extends EventEmitter{
  constructor(options){super();nativeWindow=this;this.options=options;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.webContents=Object.assign(new EventEmitter(),{sent:[],send(channel,value){this.sent.push([channel,value]);},setZoomFactor(value){this.zoom=value;},setWindowOpenHandler(){},isDestroyed:()=>!!this.destroyed});}
  isDestroyed(){return!!this.destroyed;}getBounds(){return{...this.bounds};}setBounds(value){this.bounds={...value};}setAlwaysOnTop(value,level){this.top={value,level};}showInactive(){this.visible=true;}moveTop(){}hide(){this.visible=false;}
  async loadURL(){if(deferLoad)await new Promise(resolve=>{finishLoad=resolve;});}destroy(){this.destroyed=true;this.emit('closed');this.webContents.emit('destroyed');}
 }
 const module={exports:{}};
 vm.runInNewContext(source,{module,__dirname:'/app/デスクトップ',process:{platform},Date:{now:()=>clock},
  setInterval(fn,delay){const token={id:++next,unref(){}};timers.set(token,{fn,delay});return token;},clearInterval:token=>timers.delete(token),
  require:id=>id==='node:os'?{release:()=>release}:id==='./長押し窓移動.cjs'?{attachNativeWindowMove:()=>()=>{stopped++;}}:require(id),
 });
 const owner={getContentBounds:()=>({...state.area}),webContents:{getZoomFactor:()=>zoom}};
 const entry={view:{webContents:{capturePage(){captures++;throw Error('屈折用撮影を再導入しない');}}}};
 const header=module.exports.createBrowserHeader({BrowserWindow:Window,screen:{},record:{window:owner,url:'http://127.0.0.1:1234'},entry,notify(){},fullscreenKey(){},headers});
 return{header,state,timers,headers,get window(){return nativeWindow;},get captures(){return captures;},get stopped(){return stopped;},finishLoad:()=>finishLoad?.(),tick(ms=240){clock+=ms;for(const {fn}of [...timers.values()])fn();},close(){header.close();}};
}

for(const [platform,release,material,vibrancy]of [
 ['win32','10.0.22621',undefined,undefined],['win32','10.0.26100',undefined,undefined],
 ['win32','10.0.22000',undefined,undefined],['win32','10.0.19045',undefined,undefined],
 ['darwin','23.0.0',undefined,undefined],['linux','6.12.0',undefined,undefined],
])test(`Browserすりガラス: ${platform}/${release}で中央を覆うOS材質を使わない`,async()=>{
 const f=fixture({platform,release});try{
  f.header.show(true);await flush();f.tick();const options=f.window.options;
  assert.equal(options.backgroundMaterial,material);assert.equal(options.vibrancy,vibrancy);assert.equal(options.visualEffectState,vibrancy?'active':undefined);
  assert.equal(options.roundedCorners,false);assert.equal(options.transparent,true);assert.equal(options.backgroundColor,'#00000000');
  assert.equal(options.webPreferences.sandbox,true);assert.equal(options.webPreferences.contextIsolation,true);assert.equal(options.webPreferences.nodeIntegration,false);
  assert.equal(f.captures,0);assert.equal(f.timers.size,0,'表示完了後は定期画像取得用timerを残さない');
  f.tick(10000);assert.equal(f.captures,0);assert.ok(f.window.webContents.sent.every(([channel])=>channel!=='development:browser-header-glass'));
 }finally{f.close();}
});

for(const zoom of [1,1.5,2])test(`Browser繰り出し幅: 倍率${zoom}でも幅800DIP、収納後は上端中央へ戻す`,async()=>{
 const f=fixture({zoom});try{
  f.header.show(true);await flush();f.tick();assert.deepEqual(f.window.getBounds(),{x:-1200,y:40,width:800,height:100});assert.equal(f.window.webContents.zoom,zoom);
  f.header.measure(100);assert.equal(f.window.getBounds().height,100*zoom);assert.equal(f.window.getBounds().width,800);
  f.window.setBounds({x:-900,y:300,width:800,height:100*zoom});f.window.emit('move');
  f.header.show(true);assert.equal(f.window.getBounds().x,-900,'表示中の重複show(true)では移動位置を変えない');
  f.header.show(false);f.tick();assert.equal(f.window.visible,false);f.header.show(true);f.tick();assert.equal(f.window.visible,true);
  assert.deepEqual(f.window.getBounds(),{x:-1200,y:40,width:800,height:100*zoom},'収納後は同じ全画面中でも上端中央から出す');
  f.window.setBounds({x:-1100,y:260,width:800,height:100*zoom});f.window.emit('move');f.header.show(false);f.tick(32);f.header.show(true);f.tick();
  assert.deepEqual(f.window.getBounds(),{x:-1200,y:40,width:800,height:100*zoom},'収納途中の再表示でも上端中央へ戻す');
  f.header.show(false);f.tick();f.state.area={x:-2400,y:-200,width:1200,height:800};f.header.resetPosition();f.header.show(true);f.tick();
  assert.deepEqual(f.window.getBounds(),{x:-2200,y:-200,width:800,height:100*zoom},'F11再入場も現在の画面上端へ戻す');
  assert.equal(f.captures,0);assert.equal(f.timers.size,0);const contents=f.window.webContents;
  f.close();assert.equal(f.headers.size,0);assert.equal(contents.listenerCount('before-input-event'),0);assert.ok(f.stopped>0);
 }finally{f.close();}
});
for(const width of [800,640,320,10])test(`Browser繰り出し幅: 狭い画面${width}DIPでは余白付きで収める`,async()=>{
 const f=fixture({area:{x:-640,y:-300,width,height:700}});try{
  f.header.show(true);await flush();f.tick();const bounds=f.window.getBounds();
  assert.equal(bounds.width,Math.max(1,Math.min(800,width-16)));assert.ok(bounds.x>=-640&&bounds.x+bounds.width<=-640+width);
  f.window.setBounds({...bounds,x:-5000,y:9000});f.window.emit('move');f.header.measure(110);
  const moved=f.window.getBounds();assert.ok(moved.x>=-640&&moved.x+moved.width<=-640+width);assert.ok(moved.y>=-300&&moved.y+moved.height<=400);
 }finally{f.close();}
});
test('Browser繰り出し: 読込中の収納・表示途中の反転・終了後のcallbackを維持する',async()=>{
 const f=fixture({deferLoad:true});try{
  f.header.show(true);f.header.show(false);f.finishLoad();await flush();f.tick();assert.equal(!!f.window.visible,false);
  f.header.show(true);f.tick(32);f.header.show(false);f.tick(32);f.header.show(true);f.tick();assert.equal(f.window.visible,true);
  f.header.show(false);f.tick(32);f.close();f.tick(1000);assert.equal(f.timers.size,0);assert.equal(f.captures,0);
 }finally{f.close();}
});
test('Browserすりガラス: 旧キャプチャ部品と専用preload購読APIを残さない',()=>{
 assert.equal(existsSync(new URL('../デスクトップ/ブラウザ縁屈折.cjs',import.meta.url)),false);
 assert.doesNotMatch(source,/createBrowserGlass|capturePage|browser-header-glass/);
 const preload=readFileSync(new URL('../デスクトップ/preload.cjs',import.meta.url),'utf8');assert.doesNotMatch(preload,/onBrowserHeaderGlass|browser-header-glass/);
 assert.match(preload,/onBrowserHeaderFrame/,'繰り出しの既存frame購読は維持する');
});
