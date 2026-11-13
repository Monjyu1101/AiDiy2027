// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test');
const assert=require('node:assert/strict');
const {通常窓サイズを作成}=require('../diag/起動/通常窓サイズ.cjs');
const {ミニ表示を作成}=require('../diag/起動/ミニ表示.cjs');
function fixture(){
 let bounds={x:48,y:48,width:800,height:600},minimum=[420,320],maximizable=true;
 const raw={getBounds:()=>({...bounds}),getNormalBounds:()=>({...bounds}),setBounds:v=>{bounds={...v};},isMaximized:()=>false,isDestroyed:()=>false,getMinimumSize:()=>minimum,setMinimumSize:(...v)=>{minimum=v;},isMaximizable:()=>maximizable,setMaximizable:v=>{maximizable=v;},unmaximize(){throw Error('native maximize flags are unreliable in this fixture');}};
 const area={x:-1920,y:28,width:1920,height:1052},screen={getDisplayMatching:()=>({workArea:area}),getPrimaryDisplay:()=>({workArea:area})};
 return {raw,screen,area,window:通常窓サイズを作成(raw,screen,'win32')};
}
test('Windows透明窓のnative最大化フラグがfalseでも寸法と復元状態を保持する',()=>{
 const f=fixture(),original=f.window.getBounds();
 for(let i=0;i<3;i++){
  f.window.maximize();assert.equal(f.window.isMaximized(),true);assert.deepEqual(f.raw.getBounds(),f.area);assert.deepEqual(f.window.getNormalBounds(),original);
  f.window.maximize();f.window.unmaximize();assert.equal(f.window.isMaximized(),false);assert.deepEqual(f.raw.getBounds(),original);
 }
});
test('最大化からミニへ切替後は現在の左肩で元の通常寸法へ戻る',()=>{
 const f=fixture(),mini=ミニ表示を作成(f.window,{screen:f.screen});f.window.maximize();mini.set(true);mini.set(false);
 assert.equal(f.window.isMaximized(),false);assert.deepEqual(f.window.getBounds(),{x:f.area.x,y:f.area.y,width:800,height:600});
});
test('Windows以外では既存のnative窓をそのまま使用する',()=>{
 const f=fixture();for(const platform of ['linux','darwin'])assert.equal(通常窓サイズを作成(f.raw,f.screen,platform),f.raw);
});

test('最大化からアイコンへ切替後も通常寸法を保持し現在のアイコン位置へ復帰する',()=>{
 const {EventEmitter}=require('node:events');
 const {マイクロ表示を作成}=require('../diag/起動/マイクロ表示.cjs');
 let bounds={x:48,y:48,width:800,height:600},minimum=[420,320],maximizable=true,resizable=true;
 const raw=new EventEmitter(),contents=new EventEmitter();
 Object.assign(raw,{webContents:contents,getBounds:()=>({...bounds}),getNormalBounds:()=>({...bounds}),setBounds:v=>bounds={...v},isMaximized:()=>false,isDestroyed:()=>false,getMinimumSize:()=>minimum,setMinimumSize:(...v)=>minimum=v,isMaximizable:()=>maximizable,setMaximizable:v=>maximizable=v,isResizable:()=>resizable,setResizable:v=>resizable=v,isAlwaysOnTop:()=>true,setAlwaysOnTop(){},setIgnoreMouseEvents(){}});
 const screen={getDisplayMatching:()=>({workArea:{x:-1920,y:28,width:1920,height:1052}})},window=通常窓サイズを作成(raw,screen,'win32');
 const micro=マイクロ表示を作成(window,{screen,pins:{setLocked(){},state:()=>({pinned:false})}});
 for(let i=0;i<3;i++){
  window.maximize();micro.set(true);assert.equal(window.isMaximized(),false);assert.equal(window.isMaximizable(),false);
  raw.setBounds({...raw.getBounds(),x:-900,y:150});micro.set(false);
  assert.deepEqual(raw.getBounds(),{x:-900,y:150,width:800,height:600});assert.equal(window.isMaximized(),false);assert.equal(window.isMaximizable(),true);
 }
 raw.emit('closed');
});
