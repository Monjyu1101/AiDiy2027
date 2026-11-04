// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture({cancel=false}={}){
 const bounds={x:-200,y:50,width:480,height:600},canvases=[],realCalls=[];let allowed=true;
 const contents={executeJavaScript:async()=>{},capturePage:async()=>({isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,fixture'})};
 class Canvas{
  constructor(options){this.options=options;this.webContents=contents;canvases.push(this);}
  setBounds(value){assert.deepEqual(value,bounds);}async loadURL(url){this.html=decodeURIComponent(url.split(',')[1]);if(cancel)allowed=false;}
  showInactive(){}isDestroyed(){return !!this.dead;}destroy(){this.dead=true;}
 }
 const main={getContentBounds:()=>({...bounds}),webContents:contents,isDestroyed:()=>false,setOpacity:value=>realCalls.push(['opacity',value]),show:()=>realCalls.push(['show']),focus:()=>{},hide:()=>realCalls.push(['hide'])};
 const module={exports:{}};
 vm.runInNewContext(readFileSync(new URL('../host/scripts/window-opening.cjs',import.meta.url),'utf8'),{module,setTimeout:callback=>{queueMicrotask(callback);return 1;}});
 return{...module.exports,main,Canvas,canvases,realCalls,allowed:()=>allowed};
}
test('表示開始は最終寸法の透明パネルで先に領域確保し、内側だけズームして実窓寸法を変更しない',async()=>{
 const f=fixture();assert.equal(await f.拡大表示(f.Canvas,f.main),true);
 const canvas=f.canvases[0];assert.equal(canvas.options.transparent,true);assert.equal(canvas.options.backgroundColor,'#00000000');assert.equal(canvas.options.show,false);
 assert.equal(canvas.isAiDiyOpeningCanvas,true,'試験用のクリック透過・不透明度変更から演出窓を区別する');
 assert.match(canvas.html,/background:transparent/);assert.match(canvas.html,/transform:scale\(0\.55\)/);assert.match(canvas.html,/grow 750ms/);
 assert.match(canvas.html,/<img alt="" src="data:image\/png;base64,fixture">/);
 assert.equal(canvas.dead,true);assert.deepEqual(f.realCalls,[['opacity',0],['show'],['opacity',1]]);
});
test('ズーム待ちの表示取消では実窓を表示せず、透明パネルを回収する',async()=>{
 const f=fixture({cancel:true});assert.equal(await f.拡大表示(f.Canvas,f.main,{canShow:f.allowed}),false);
 assert.equal(f.canvases[0].dead,true);assert.deepEqual(f.realCalls,[]);
});

test('短命な演出キャンバスは実窓のピン層だけを継承し、OFF窓を最前面にしない',async()=>{
 for(const pinned of [false,true]){
  const f=fixture();f.main.isAlwaysOnTop=()=>pinned;
  assert.equal(await f.拡大表示(f.Canvas,f.main),true);
  assert.equal(f.canvases[0].options.alwaysOnTop,pinned);assert.equal(f.canvases[0].dead,true);
 }
});

test('実画面を取得できない時は代用の白い面を出さず、一時スタイルを回収して本画面を表示する',async()=>{
 const f=fixture(),scripts=[];
 f.main.webContents.executeJavaScript=async script=>scripts.push(script);
 f.main.webContents.capturePage=async()=>{throw Error('capture unavailable');};
 assert.equal(await f.拡大表示(f.Canvas,f.main),true);
 assert.equal(f.canvases.length,0);assert.ok(scripts.some(script=>script.includes("querySelector('style[data-aidiy-opening-capture]')?.remove()")));
 assert.deepEqual(f.realCalls,[['opacity',0],['show'],['opacity',1]]);
});

test('非表示窓の初回キャプチャが描画待ちで失敗しても再描画後の実画面でズームする',async()=>{
 const f=fixture();let calls=0;
 f.main.webContents.capturePage=async()=>{if(++calls===1)throw Error('UnknownVizError');return{isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,retry'};};
 assert.equal(await f.拡大表示(f.Canvas,f.main),true);assert.equal(calls,2);assert.match(f.canvases[0].html,/base64,retry/);
});
