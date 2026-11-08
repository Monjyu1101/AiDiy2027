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
import {openBrowser} from '../src/components/ブラウザ/起動.js';
import {normalizeDisplayUrls,isPageSource} from '../viewer/表示URL.mjs';
import {MEDIA_PATTERN} from '../viewer/media-types.mjs';
const require=createRequire(import.meta.url),vue=require('vue'),MarkdownIt=require('markdown-it');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const target='http://localhost:8090/selected';

function fixture(type,{available=true,reply=async()=>({ok:true})}={}){
 const path=type==='viewer'?'../src/components/ファイル閲覧/ファイルビューア.vue':'../src/dialog/ファイル解析ダイアログ.vue';
 const {descriptor}=parse(readFileSync(new URL(path,import.meta.url),'utf8'));
 const script=compileScript(descriptor,{id:'analysis-launch-ui',genDefaultAs:'component'});
 const template=compileTemplate({source:descriptor.template.content,filename:path,id:'analysis-launch-ui',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
 const calls=[],module={exports:{}},unmount=[];
 const win={aidiyWindow:{openBrowser:async(...args)=>{calls.push(args);return reply();}},location:{origin:'http://127.0.0.1:12345/'}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{
  module,console,window:win,localStorage:{getItem:()=>null},AbortController,AbortSignal,URL,URLSearchParams,setTimeout,clearTimeout,
  require:id=>id==='vue'?{...vue,watch(){},inject:key=>key==='browserAvailable'?available:null,onMounted(){},onBeforeUnmount:fn=>unmount.push(fn),withDirectives:node=>node}
   :id==='markdown-it'?MarkdownIt:id.endsWith('/起動.js')?{openBrowser}:id.endsWith('/表示URL.mjs')?{normalizeDisplayUrls,isPageSource}:id.endsWith('/media-types.mjs')?{MEDIA_PATTERN}
   :id.endsWith('/閲覧待機.js')?{createViewerActivity:()=>({handle(){},scroll(){},dispose(){}})}:id.endsWith('/ファイル操作.js')?{fullFilePath:()=>'/project/Screen.vue'}:{},
 });
 const props={file:{name:'Screen.vue',path:'Screen.vue'},root:'/project'};
 const state=module.exports.setup(props,{expose(){},emit(){}});
 return{state,calls,render:()=>module.exports.render({},[],props,vue.proxyRefs(state),{},{}),dispose:()=>unmount.forEach(fn=>fn())};
}
function nodes(node,found=[]){if(!node||typeof node!=='object')return found;found.push(node);if(Array.isArray(node.children))for(const child of node.children)nodes(child,found);return found;}
const inferredButton=f=>nodes(f.render()).find(node=>node.props?.class==='viewer-analysis-page');

test('AI推定ページ: 解析URLがある時だけ表示し、選択URLで再利用指定、既存ブラウザは新規指定',async()=>{
 const f=fixture('viewer');
 for(const preview of [null,{kind:'html',url:target},{kind:'vue',routes:[{url:target}]},{kind:'analysis',routes:[]}]){
  f.state.preview.value=preview;assert.equal(inferredButton(f),undefined);await f.state.browse(true);assert.equal(f.calls.length,0);
 }
 f.state.preview.value={kind:'analysis',routes:[{url:'http://localhost:8090/first'},{url:target}]};f.state.routeIndex.value=1;
 const button=inferredButton(f);assert.equal(button.children,'AI推定ページ');assert.equal(button.props.disabled,false);
 await button.props.onClick();assert.deepEqual(f.calls[0],['Screen.vue',undefined,target,true]);
 await f.state.browse({type:'click'});assert.deepEqual(f.calls[1],['Screen.vue',undefined,target,false]);
 f.state.routeIndex.value=0;await f.state.browse(true);assert.equal(f.calls[2][2],'http://localhost:8090/first');f.dispose();
 const offline=fixture('viewer',{available:false});offline.state.preview.value={kind:'analysis',routes:[{url:target}]};assert.equal(inferredButton(offline).props.disabled,true);offline.dispose();
});

test('AI推定ページ: 準備中・連打を抑止し、失敗後は再試行できる',async()=>{
 let finish;const f=fixture('viewer',{reply:()=>new Promise(resolve=>{finish=resolve;})});
 f.state.preview.value={kind:'analysis',routes:[{url:target}]};f.state.previewLoading.value=true;
 await f.state.browse(true);assert.equal(f.calls.length,0);
 f.state.previewLoading.value=false;const pending=f.state.browse(true);await f.state.browse(true);
 assert.equal(f.calls.length,1);assert.equal(inferredButton(f).props.disabled,true);assert.equal(f.state.actionBusy.value,'analysis-browser');
 finish({ok:false,error:'tools未接続'});await pending;assert.equal(f.state.actionError.value,'tools未接続');assert.equal(f.state.actionBusy.value,'');
 const retry=f.state.browse(true);finish({ok:true});await retry;assert.equal(f.calls.length,2);assert.equal(f.state.actionError.value,'');f.dispose();
});

test('AI解析画面: 保存URLは同じ再利用指定を使い、連打と閉じた後の応答を抑止する',async()=>{
 let finish;const f=fixture('dialog',{reply:()=>new Promise(resolve=>{finish=resolve;})});
 f.state.record.value={displayUrls:[{url:target}]};
 const pending=f.state.browse(target);await f.state.browse('http://localhost:8090/ignored');
 assert.deepEqual(f.calls,[['Screen.vue',undefined,target,true]]);
 finish({ok:false,error:'起動失敗'});await pending;assert.equal(f.state.urlError.value,'起動失敗');
 const retry=f.state.browse(target);f.dispose();finish({ok:false,error:'遅い応答'});await retry;assert.equal(f.state.urlError.value,'');
});


test('AI解析画面: ページ関連と1次レベルの結果範囲を区別し、保存URL以外を開かない',async()=>{
 const f=fixture('dialog');
 f.state.record.value={relatedSourceScope:'direct',content:'関連ソース（1次レベル）',displayUrls:[{url:target}]};assert.deepEqual(Array.from(f.state.displayUrls.value),[]);assert.match(f.state.scopeLabel.value,/1次レベル/);assert.match(f.state.scopeLabel.value,/直接の呼び出し元・呼び出し先/);await f.state.browse(target);assert.equal(f.calls.length,0);
 f.state.record.value={relatedSourceScope:'page',displayUrls:[{url:target}]};assert.match(f.state.scopeLabel.value,/複数URL/);await f.state.browse('http://localhost:8090/not-saved');assert.equal(f.calls.length,0);await f.state.browse(target);assert.equal(f.calls.length,1);
 f.state.record.value={content:'旧結果'};assert.equal(f.state.scopeLabel.value,'');f.dispose();
});
