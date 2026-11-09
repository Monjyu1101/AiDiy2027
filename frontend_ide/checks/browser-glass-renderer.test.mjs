// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import * as analysisTools from '../src/components/ブラウザ/ブラウザ解析状態.js';
import {parse,compileScript} from '@vue/compiler-sfc';
import * as vue from 'vue';
import {transformSync} from 'esbuild';
import * as addressTools from '../src/components/ブラウザ/URL表示.js';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Browserすりガラス: 屈折SVG・方向マップ・定期画像取得用rendererを持たない',()=>{
 const source=read('../src/components/ブラウザ/ブラウザパネル.vue');
 assert.doesNotMatch(source,/BrowserGlassEdge|headerGlass|stopGlass|onBrowserHeaderGlass|feDisplacementMap|capturePage/);
 for(const path of ['../src/components/ブラウザ/ガラス縁.vue','../src/components/ブラウザ/ガラス屈折.js'])assert.equal(existsSync(new URL(path,import.meta.url)),false);
 assert.match(source,/browserAction\('capture'\)/,'明示的なWeb画面撮影は維持する');
});

test('Browserすりガラス: preloadの屈折専用APIは撤去し表示フレームと手動撮影は維持する',()=>{
 const ipc=new EventEmitter(),invoked=[];let api;
 ipc.invoke=(...args)=>{invoked.push(args);};
 vm.runInNewContext(read('../デスクトップ/preload.cjs'),{require:()=>({contextBridge:{exposeInMainWorld(_name,value){api=value;}},ipcRenderer:ipc})});
 assert.equal(api.onBrowserHeaderGlass,undefined);
 assert.doesNotMatch(read('../デスクトップ/preload.cjs'),/browser-header-glass/);
 const frames=[],stop=api.onBrowserHeaderFrame(value=>frames.push(value));
 ipc.emit('development:browser-header-frame',{},-25);assert.deepEqual(frames,[-25]);
 stop();ipc.emit('development:browser-header-frame',{},0);assert.deepEqual(frames,[-25]);
 api.browserAction('capture');assert.deepEqual(invoked,[['development:browser-action','capture',undefined]]);
});

for(const headerOnly of [false,true])test(`Browserすりガラス: ${headerOnly?'専用ヘッダー':'通常表示'}は画像購読せず手動撮影・展開・破棄を維持する`,async()=>{
 const mounted=[],unmounted=[],actions=[],classes=new Set();let frameHandler,frameStops=0,glassSubscriptions=0;
 const {descriptor}=parse(read('../src/components/ブラウザ/ブラウザパネル.vue'));
 const script=compileScript(descriptor,{id:'browser-frosted-lifetime',genDefaultAs:'component'}),module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\nmodule.exports=component;',{format:'cjs'}).code,{
  module,console,requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},document:{documentElement:{classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}}},
  window:{aidiyWindow:{onBrowserChanged:()=>()=>{},browserAction:async(name,value)=>{actions.push([name,value]);return name==='capture'?{ok:true,path:'temp/input/browser.png',message:'撮影しました。'}:{ok:true,url:'about:blank',fullscreen:headerOnly,available:true};},onBrowserHeaderFrame(fn){frameHandler=fn;return()=>{frameStops++;};},onBrowserHeaderGlass(){glassSubscriptions++;return()=>{};}}},
  require:id=>id==='./ブラウザ解析状態.js'?analysisTools:id==='./URL表示.js'?addressTools:id==='vue'?{...vue,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:{},
 });
 const state=module.exports.setup({headerOnly},{expose(){}});mounted.forEach(fn=>fn());await Promise.resolve();
 assert.equal(glassSubscriptions,0);assert.equal(classes.has('browser-header-document'),headerOnly);
 if(headerOnly){frameHandler(-50);assert.equal(state.headerOffset.value,-50);frameHandler(0);assert.equal(state.headerOffset.value,0);}
 await state.capture();assert.ok(actions.some(([name])=>name==='capture'));assert.equal(state.captureMessage.value,'撮影しました。');
 unmounted.forEach(fn=>fn());assert.equal(frameStops,headerOnly?1:0);assert.equal(classes.has('browser-header-document'),false);
});
