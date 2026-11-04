// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import * as cliTitles from '../src/components/ターミナル/CLIタイトル.js';
import test from 'node:test';
import * as keyboard from '../src/components/ターミナル/キー入力.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),vue=require('vue');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const flush=async()=>{for(let n=0;n<10;n++)await Promise.resolve();};
function fixture({desktop=true,linked=true,title=()=>Promise.resolve('AiDiy IDE / Console 3')}={}){
 const mounted=[],unmounted=[];let calls=0;
 const source=readFileSync(new URL('../src/components/ターミナル/ターミナルパネル.vue',import.meta.url),'utf8');
 const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
 const script=compileScript(descriptor,{id:'console',genDefaultAs:'component'});
 const template=compileTemplate({source:descriptor.template.content,filename:'ConsolePanel.vue',id:'console',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
 const noop=()=>{},subscription=()=>({dispose:noop});
 class Terminal{loadAddon(){}open(){}attachCustomKeyEventHandler(){}reset(){}dispose(){}onData=subscription;onKey=subscription;onResize=subscription;onCursorMove=subscription;onScroll=subscription;onRender=subscription;}
 const module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{
  module,console,URL,window:{aidiyWindow:{title:()=>{calls++;return title();}}},location:{href:'http://localhost/'},ResizeObserver:class{observe(){}disconnect(){}},WebSocket:class{close(){}},
  require:id=>id==='./CLIタイトル.js'?cliTitles:id==='./キー入力.js'?keyboard:id==='vue'?{...vue,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:id==='@xterm/xterm'?{Terminal}:id==='@xterm/addon-fit'?{FitAddon:class{}}:id==='../ターミナル/コマンド補完.js'?{cliCompletions:{}}:{},
 });
 const scope=vue.effectScope(),component=module.exports,props={desktop,linked,visible:true,base:'/console/'};
 const state=scope.run(()=>component.setup(props,{expose(){}}));state.container.value={addEventListener:noop,removeEventListener:noop};
 // 実テンプレートのStatusBarへ渡るタイトルを検証する。
 const heading=()=>component.render({},[],props,vue.proxyRefs(state),{},{}).children[0].props.title;
 for(const fn of mounted)fn();
 return{state,heading,calls:()=>calls,dispose(){for(const fn of unmounted)fn();scope.stop();}};
}
test('Console見出し: ホストの番号付きOSタイトルを実テンプレートへ反映する',async()=>{
 const f=fixture();try{assert.equal(f.heading(),'AiDiy IDE / Console');await flush();assert.equal(f.state.windowTitle.value,'AiDiy IDE / Console 3');assert.equal(f.heading(),'AiDiy IDE / Console 3');assert.equal(f.calls(),1);}finally{f.dispose();}
});
test('Console見出し: 単独・Webは問い合わせず従来表示を維持する',async()=>{
 for(const [desktop,linked,expected] of [[true,false,'AiDiy Console'],[false,true,'AiDiy IDE / Console'],[false,false,'AiDiy Console']]){
  const f=fixture({desktop,linked});try{await flush();assert.equal(f.calls(),0);assert.equal(f.heading(),expected);}finally{f.dispose();}
 }
});
test('Console見出し: IPC失敗・不正応答は従来表示へ、破棄後の遅延応答は無視する',async()=>{
 for(const title of [()=>Promise.reject(Error('unavailable')),()=>Promise.resolve(undefined),()=>Promise.resolve(123)]){
  const f=fixture({title});try{await flush();assert.equal(f.heading(),'AiDiy IDE / Console');}finally{f.dispose();}
 }
 let resolve;const f=fixture({title:()=>new Promise(done=>{resolve=done;})});f.dispose();resolve('AiDiy IDE / Console 9');await flush();assert.equal(f.state.windowTitle.value,'');
});


test('Hermes見出し: 正式名とIDを保ったまま実テンプレートのタイトルだけ短縮する',async()=>{
 const f=fixture({desktop:true,linked:false,title:()=>Promise.resolve('AiDiy Console / Hermes')});
 try{
  f.state.cli.value={id:'aidiy_hermes',name:'AiDiy Hermes'};await flush();
  assert.equal(f.heading(),'AiDiy Console / Hermes');assert.equal(f.calls(),0);
  assert.equal(f.state.cli.value.name,'AiDiy Hermes');
 }finally{f.dispose();}
});
