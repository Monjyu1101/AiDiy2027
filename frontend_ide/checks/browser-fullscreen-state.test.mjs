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
import * as addressTools from '../src/components/ブラウザ/URL表示.js';
const require=createRequire(import.meta.url),vue=require('vue');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');

function fixture(props){
 const mounted=[],unmounted=[],pending=[];let listener;
 const {descriptor}=parse(readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8'));
 const script=compileScript(descriptor,{id:'browser',genDefaultAs:'component'});
 const template=compileTemplate({source:descriptor.template.content,filename:'Browser.vue',id:'browser',compilerOptions:{bindingMetadata:script.bindings}});
 assert.deepEqual(template.errors,[]);
 const module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{
  module,console,requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},document:{documentElement:{classList:{add(){},remove(){}}}},
  window:{aidiyWindow:{onBrowserChanged(fn){listener=fn;return()=>{listener=null;};},browserAction(name,value){return new Promise(resolve=>pending.push({name,value,resolve}));}}},
  require:id=>id==='./URL表示.js'?addressTools:id==='vue'?{...vue,withDirectives:node=>node,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:{},
 });
 const state=module.exports.setup(props,{expose(){}});
 for(const fn of mounted)fn();
 return{state,pending,notify:value=>listener(value),render:()=>module.exports.render({},[],props,vue.proxyRefs(state),{},{}),close:()=>unmounted.forEach(fn=>fn())};
}
const snapshot=(stateRevision,fullscreen)=>({ok:true,stateRevision,fullscreen,url:`https://example.test/${stateRevision}`,available:true,title:'Browser'});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

for(const standalone of [false,true])for(const headerOnly of [false,true])test(`Browser F11: ${standalone?'単独':'IDE所属'}/${headerOnly?'ホバーヘッダー':'通常操作欄'}は遅い初期状態・操作応答で全画面へ巻き戻らない`,async()=>{
 const f=fixture({standalone,headerOnly});
 try{
  const initial=f.pending.find(item=>item.name==='state');
  f.notify(snapshot(2,true));f.notify(snapshot(3,false));
  initial.resolve(snapshot(1,true));await flush();
  assert.equal(f.state.page.value.fullscreen,false,'初期状態の応答待ち中にF11で戻っても通常表示を保つ');
  for(let cycle=0;cycle<3;cycle++){
   const base=10+cycle*10;
   const first=f.state.action('fullscreen'),second=f.state.action('reload');
   const replies=f.pending.slice(-2);
   f.notify(snapshot(base,true));f.notify(snapshot(base+2,false));
   replies[1].resolve(snapshot(base+1,true));await second;
   replies[0].resolve(snapshot(base,true));await first;
   f.notify(snapshot(base+1,true));
   assert.equal(f.state.page.value.fullscreen,false,'操作応答と通知が逆順でも最後の通常表示を保つ');
   assert.equal(f.state.address.value,`https://example.test/${base+2}`);
   assert.ok(!f.render().props.class.split(' ').includes('browser-fullscreen'),'通常操作欄を隠すクラスを残さない');
   f.notify(snapshot(base+3,true));assert.equal(f.state.page.value.fullscreen,true,'次の新しいF11は受け付ける');
   f.notify(snapshot(base+4,false));
  }
  const delayed=f.state.action('state'),last=f.pending.at(-1),before=f.state.page.value;
  f.close();last.resolve(snapshot(100,true));await delayed;assert.equal(f.state.page.value,before,'破棄後の応答は反映しない');
 }finally{f.close();}
});
