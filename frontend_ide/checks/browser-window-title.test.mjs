// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as analysisTools from '../src/components/ブラウザ/ブラウザ解析状態.js';
import * as addressTools from '../src/components/ブラウザ/URL表示.js';
const require=createRequire(import.meta.url),vue=require('vue');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

function fixture({standalone=false,headerOnly=false,title=()=>Promise.resolve('AiDiy IDE / Browser 2'),missingTitle=false}={}){
 const mounted=[],unmounted=[],calls=[];let listener,disposed=false;
 const {descriptor,errors}=parse(readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8'));assert.deepEqual(errors,[]);
 const script=compileScript(descriptor,{id:'browser-title',genDefaultAs:'component'});
 const template=compileTemplate({source:descriptor.template.content,filename:'Browser.vue',id:'browser-title',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
 const module={exports:{}},api={
  onBrowserChanged(fn){listener=fn;return()=>{listener=null;};},
  browserAction:async name=>({ok:true,url:'https://example.test/',title:'Webページの題名',available:true,session:standalone?'aidiy_browser 05687026-3ad0-4b23-8be1-f797738ac6cc':'aidiy_ide 2',stateRevision:1}),
  ...(!missingTitle?{title(){calls.push('title');return title();}}:{}),
 };
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{
  module,console,window:{aidiyWindow:api},requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},document:{documentElement:{classList:{add(){},remove(){}}}},
  require:id=>id==='./ブラウザ解析状態.js'?analysisTools:id==='./URL表示.js'?addressTools:id==='vue'?{...vue,withDirectives:node=>node,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:{},
 });
 const props={standalone,headerOnly},scope=vue.effectScope(),state=scope.run(()=>module.exports.setup(props,{expose(){}}));
 const render=()=>module.exports.render({},[],props,vue.proxyRefs(state),{},{});
 const chrome=()=>render().children[0];
 for(const fn of mounted)fn();
 return{state,calls,render,chrome,heading:()=>chrome().children.find(node=>node.props?.mode==='online' && 'title' in node.props).props.title,notify:value=>listener?.(value),dispose(){if(disposed)return;disposed=true;for(const fn of unmounted)fn();scope.stop();}};
}

for(const standalone of [false,true])for(const headerOnly of [false,true])test(`Browser見出し: ${standalone?'単独':'IDE番号'}/${headerOnly?'全画面ヘッダー':'通常表示'}はmainのタイトルをそのまま使う`,async()=>{
 const title=standalone?'AiDiy Browser':'AiDiy IDE / Browser 2';
 const f=fixture({standalone,headerOnly,title:()=>Promise.resolve(title)});
 try{
  assert.equal(f.heading(),standalone?'AiDiy Browser':'AiDiy IDE / Browser');await flush();
  assert.equal(f.heading(),title);assert.deepEqual(f.calls,['title']);
  f.notify({ok:true,stateRevision:2,url:'https://example.test/next',title:'別ページの偽窓タイトル',session:'aidiy_ide 9',fullscreen:true});
  assert.equal(f.heading(),title,'ページ題名や他の状態通知からOS窓タイトルを生成しない');
  assert.ok(f.chrome().props.class.split(' ').includes('panel-window-title'),'見出しは既存の縮小可能な列へ収める');
 }finally{f.dispose();}
});

for(const standalone of [false,true])test(`Browser見出し: ${standalone?'単独':'IDE'}のIPC欠損・失敗・不正応答は従来見出しへ戻る`,async()=>{
 for(const option of [{missingTitle:true},...[()=>Promise.reject(Error('unavailable')),()=>{throw Error('sync failure');},()=>Promise.resolve(undefined),()=>Promise.resolve(123),()=>Promise.resolve({title:'invalid'}),()=>Promise.resolve(''),()=>Promise.resolve('  ')].map(title=>({title}))]){
  const f=fixture({standalone,...option});try{await flush();assert.equal(f.heading(),standalone?'AiDiy Browser':'AiDiy IDE / Browser');assert.equal(f.state.windowTitle.value,'');}finally{f.dispose();}
 }
});

for(const headerOnly of [false,true])test(`Browser見出し: ${headerOnly?'全画面ヘッダー':'通常表示'}破棄後の遅延IPCでタイトルを書き換えない`,async()=>{
 let resolve;const f=fixture({headerOnly,title:()=>new Promise(done=>{resolve=done;})});
 await flush();assert.equal(typeof resolve,'function');f.dispose();resolve('古いBrowser 99');await flush();assert.equal(f.state.windowTitle.value,'');
});

test('Browser見出し: 共有の長文省略規則を再利用し、全画面の半透明背景は維持する',()=>{
 const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 assert.match(css,/\.panel-window-title \.panel-brand\{grid-template-columns:auto minmax\(0,1fr\) auto\}/);
 assert.match(css,/\.panel-window-title \.panel-brand strong\{[^}]*min-width:0;overflow:hidden;text-overflow:ellipsis/);
 const source=readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8');
 assert.match(source,/\.browser-header-only \.browser-chrome\{[^}]*background:rgba\(64,210,245,\.10\)/);
});
