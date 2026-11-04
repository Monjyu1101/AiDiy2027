// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import * as idleModule from '../src/components/ファイル閲覧/閲覧待機.js';
const {createViewerIdle,createViewerActivity,viewerActivityScript,VIEWER_IDLE_MS}=idleModule;
function clock(){
 let time=0,id=0,closes=0;const tasks=new Map();
 const options={now:()=>time,schedule:(fn,delay)=>{tasks.set(++id,{fn,at:time+delay});return id;},cancel:id=>tasks.delete(id),close:()=>closes++};
 const idle=createViewerIdle(options);
 return{idle,options,tasks,get closes(){return closes;},get now(){return time;},advance(ms){time+=ms;for(const [key,item] of [...tasks])if(item.at<=time){tasks.delete(key);item.fn();}}};
}
for(const inline of [true,false])for(const autoSpin of [true,false])test(`閲覧3分: inline=${inline} auto=${autoSpin}`,()=>{
 const f=clock();f.idle.configure({inline,autoSpin});f.advance(179999);assert.equal(f.closes,0);f.advance(1);assert.equal(f.closes,Number(inline&&autoSpin));f.idle.dispose();assert.equal(f.tasks.size,0);
});
test('閲覧3分: OFF解除・ONから新たな3分・pin開始時解除・失敗復帰・古いcallback破棄',()=>{
 const f=clock(),on={inline:true,autoSpin:true};f.idle.configure(on);f.advance(179900);const old=[...f.tasks.values()][0].fn;
 f.idle.configure({...on,pinning:true});old();f.advance(5000);assert.equal(f.closes,0);assert.equal(f.tasks.size,0);
 f.idle.configure(on);f.advance(179999);assert.equal(f.closes,0);f.idle.configure({...on,autoSpin:false});old();f.advance(500000);assert.equal(f.closes,0);
 f.idle.configure(on);f.advance(VIEWER_IDLE_MS);assert.equal(f.closes,1);
 f.idle.configure({...on,inline:false});f.idle.activity();f.advance(500000);assert.equal(f.closes,1);assert.equal(f.tasks.size,0);
 f.idle.dispose();f.idle.configure(on);old();assert.equal(f.tasks.size,0);
});
test('操作: 左右Monaco/入れ子scrollは直前入力ありだけ、同期scroll/単なる移動は延長しない',()=>{
 const f=clock();f.idle.configure({inline:true,autoSpin:true});const input=createViewerActivity(f.idle.activity,()=>f.now);
 f.advance(179000);input.scroll();input.handle({type:'scroll',isTrusted:true});input.handle({type:'pointermove',buttons:0,isTrusted:true});input.handle({type:'click',isTrusted:false});f.advance(1000);assert.equal(f.closes,1);
 f.idle.configure({inline:true,autoSpin:false});f.idle.configure({inline:true,autoSpin:true});f.advance(179000);
 input.handle({type:'wheel',isTrusted:true});f.advance(1000);input.scroll();f.advance(179999);assert.equal(f.closes,1);f.advance(1);assert.equal(f.closes,2);
 input.dispose();input.handle({type:'click',isTrusted:true});input.scroll();assert.equal(f.tasks.size,0);
});
for(const type of ['pointerdown','click','keydown','wheel','touchstart','touchmove','change','pointermove'])test(`操作: ${type}で最後の操作から3分`,()=>{
 const f=clock();f.idle.configure({inline:true,autoSpin:true});const input=createViewerActivity(f.idle.activity,()=>f.now);f.advance(179999);input.handle({type,buttons:1,isTrusted:true});f.advance(179999);assert.equal(f.closes,0);f.advance(1);assert.equal(f.closes,1);
});
test('iframe通知: スクリプトscrollを送らず、実入力と近接scrollだけ送信・離脱後解除',()=>{
 const listeners=new Map(),sent=[];let time=0;
 vm.runInNewContext(viewerActivityScript,{Date:{now:()=>time},parent:{postMessage:value=>sent.push(value)},addEventListener:(type,fn)=>listeners.set(type,fn)});
 listeners.get('scroll')({type:'scroll',isTrusted:true});assert.equal(sent.length,0);
 listeners.get('wheel')({type:'wheel',isTrusted:true});listeners.get('scroll')({type:'scroll',isTrusted:true});assert.equal(sent.length,2);
 time=2000;listeners.get('scroll')({type:'scroll',isTrusted:true});assert.equal(sent.length,2);
 listeners.get('pagehide')();listeners.get('click')({type:'click',isTrusted:true});assert.equal(sent.length,2);assert.equal(sent[0].userInput,true);
});

const require=createRequire(import.meta.url),vue=require('vue'),{parse,compileScript}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
test('実Vue session: pinBusyは同期解除、比較/再描画/子reloadで再開せず、失敗時だけ埋込へ再開',async()=>{
 const f=clock(),provided={},unmount=[],emitted=[];let pinResolve,panelOptions;
 const {descriptor}=parse(readFileSync(new URL('../src/components/ファイル閲覧/閲覧セッション.vue',import.meta.url),'utf8'));
 const {content}=compileScript(descriptor,{id:'ViewerSession',genDefaultAs:'component'});const module={exports:{}};
 vm.runInNewContext(transformSync(content+'\nmodule.exports=component;',{format:'cjs'}).code,{module,JSON,require:id=>id==='vue'?{...vue,provide:(key,value)=>provided[key]=value,onBeforeUnmount:fn=>unmount.push(fn)}:id.endsWith('閲覧待機.js')?{createViewerIdle:options=>createViewerIdle({...f.options,...options})}:id.endsWith('パネル別窓.js')?{createPanelWindow:options=>{panelOptions=options;return{pin:()=>new Promise(resolve=>pinResolve=resolve),close(){},focus(){return true;}};}}:{}});
 const props=vue.reactive({file:{path:'a.js',name:'a.js'},root:'/project',autoSpin:true}),scope=vue.effectScope();
 const state=scope.run(()=>module.exports.setup(props,{expose(){},emit:(...args)=>emitted.push(args)}));
 try{
  f.advance(179900);const old=[...f.tasks.values()][0].fn;const pin=state.pin();assert.equal(f.tasks.size,0);old();assert.deepEqual(emitted,[['pinning',true]]);
  f.advance(5000);pinResolve(false);await pin;assert.equal(f.tasks.size,1,'失敗したpinは3分から再開');
  f.advance(179900);props.file={...props.file,mtime:99};provided.openFileHistory(props.file,props.root);await flush();assert.equal([...f.tasks.values()][0].at-f.now,100,'同じ対象の再描画や比較切替だけで延長しない');
  const next=state.pin();panelOptions.changed(true);pinResolve(true);await next;assert.equal(f.tasks.size,0);
  provided.openFileHistory(props.file,props.root);panelOptions.moved();props.autoSpin=false;props.autoSpin=true;await flush();f.advance(999999);assert.equal(f.tasks.size,0);assert.equal(emitted.filter(e=>e[0]==='close').length,0);
 }finally{for(const fn of unmount)fn();scope.stop();assert.equal(f.tasks.size,0);}
});
