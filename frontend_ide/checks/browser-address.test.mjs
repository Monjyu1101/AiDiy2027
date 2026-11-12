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
import browser from '../デスクトップ/ブラウザ.cjs';
const {displayBrowserURL,browserAddressTarget}=addressTools;
const require=createRequire(import.meta.url),vue=require('vue');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const encoded='https://example.test/'+encodeURIComponent('漢字 ひらがな カタカナー「資料」𠮷')+'?'+encodeURIComponent('検索')+'='+encodeURIComponent('日本語')+'#'+encodeURIComponent('見出し');
const readable='https://example.test/漢字%20ひらがな%20カタカナー「資料」𠮷?検索=日本語#見出し';
test('Browser URL表示: 日本語path/query/hash、空白保持、未編集Enterは元URLを保持',()=>{
 assert.equal(displayBrowserURL(encoded),readable);
 assert.equal(browserAddressTarget(readable,encoded),encoded);
 assert.equal(browser.browserURL(readable),encoded);
 const lower=encoded.replace(/%[0-9A-F]{2}/g,value=>value.toLowerCase());
 assert.equal(browserAddressTarget(displayBrowserURL(lower),lower),lower);
 const file='file:///C:/'+encodeURIComponent('資料 100% #.html');
 assert.equal(displayBrowserURL(file),'file:///C:/資料%20100%25%20%23.html');
 assert.equal(browser.browserURL(displayBrowserURL(file)),file);
});
test('Browser URL表示: ASCII・authority・不正UTF8・制御/不可視/紛らわしい文字を復号しない',()=>{
 const untouched=['%20','%2f','%3F','%23','%25','%26','%3D','%00','%0A','%09','%7F','%C0%AF','%E0%80%AF','%ED%A0%80','%F4%90%80%80','%E6%BC','%ZZ','%',...['\u0085','\u00a0','\u200b','\u202e','\u2066','\ufeff','\u3000','\u3164','\uff0f','\uff03'].map(encodeURIComponent)];
 for(const value of untouched)assert.equal(displayBrowserURL('https://example.test/'+value+'/%E6%BC%A2'),'https://example.test/'+value+'/漢',value);
 for(const value of ['https://%E6%BC%A2.example/','https://xn--wgv71a.example/','https://%E6%BC%A2:password@example.test/','about:blank','data:text/plain,%E6%BC%A2'])assert.equal(displayBrowserURL(value),value);
 assert.equal(displayBrowserURL(undefined),'');
 assert.equal(displayBrowserURL('https://example.test/%25E6%25BC%25A2'),'https://example.test/%25E6%25BC%25A2');
});
test('Browser URL入力: 日本語で始まる語と通常の検索語はGoogle、アドレスはそのまま開く',()=>{
 for(const query of ['日本語','かな カタカナ','日本語.example','検索: 今日の天気','東京/京都','AiDiy Browser','　日本語 検索　']){
  assert.equal(browser.browserURL(query),'https://www.google.com/ai?q='+encodeURIComponent(query.trim()),query);
 }
 for(const [input,target] of [
  ['127.0.0.1:8090','http://127.0.0.1:8090/'],['localhost:8090/','http://localhost:8090/'],
  ['example.com/検索?q=東京','https://example.com/'+encodeURIComponent('検索')+'?q='+encodeURIComponent('東京')],
  ['https://日本語.jp/資料',new URL('https://日本語.jp/資料').href],
  ['http://127.0.0.1:8090/画面',new URL('http://127.0.0.1:8090/画面').href],
  ['about:blank','about:blank'],['file:///tmp/資料.html',new URL('file:///tmp/資料.html').href],
 ])assert.equal(browser.browserURL(input),target,input);
 for(const input of ['javascript:alert(1)','data:text/html,検索','https://user:password@example.com'])assert.throws(()=>browser.browserURL(input));
});
// タブ/URLを包むレイアウト階層に依存せず、実フォームを検査する。
function findNode(node,predicate){if(!node||typeof node!=='object')return; if(predicate(node))return node;for(const child of Array.isArray(node.children)?node.children:[]){const found=findNode(child,predicate);if(found)return found;}}
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function fixture(){
 const mounted=[],unmounted=[],calls=[];let listener,raw=encoded;
 const source=readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8');
 const {descriptor}=parse(source),script=compileScript(descriptor,{id:'browser',genDefaultAs:'component'});
 const template=compileTemplate({source:descriptor.template.content,filename:'Browser.vue',id:'browser',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
 const module={exports:{}},snapshot=()=>({ok:true,url:raw,available:true,back:true,forward:true});
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{
  module,console,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},ResizeObserver:class{observe(){}disconnect(){}},window:{aidiyWindow:{onBrowserChanged(fn){listener=fn;return()=>{listener=null;};},async browserAction(name,value){calls.push([name,value]);if(name==='navigate')raw=browser.browserURL(value);return snapshot();}}},
  require:id=>id==='./ブラウザ解析状態.js'?analysisTools:id==='./URL表示.js'?addressTools:id==='vue'?{...vue,withDirectives:node=>node,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)}:{},
 });
 const state=module.exports.setup({},{expose(){}}),render=()=>module.exports.render({},[],{},vue.proxyRefs(state),{},{});
 for(const fn of mounted)fn();
 return{state,calls,render,notify(url){raw=url;listener(snapshot());},dispose(){unmounted.forEach(fn=>fn());}};
}
test('Browser実コンポーネント: 状態/履歴/再読込/編集保護/Enter/破棄',async()=>{
 const f=fixture();try{
  await flush();assert.equal(f.state.address.value,readable);assert.equal(f.state.page.value.url,encoded);
  const form=()=>findNode(f.render(),node=>node.type==='form');
  const input=()=>form().children.find(node=>node.type==='input');
  input().props.onFocus();input().props['onUpdate:modelValue']('https://example.test/編集%20後?値=漢字%2F');
  f.notify(encoded+'#changed');assert.equal(f.state.address.value,'https://example.test/編集%20後?値=漢字%2F');
  form().props.onSubmit({preventDefault(){}});await flush();
  assert.equal(f.calls.find(([name])=>name==='navigate')[1],'https://example.test/編集%20後?値=漢字%2F');
  assert.equal(f.state.page.value.url,'https://example.test/'+encodeURIComponent('編集')+'%20'+encodeURIComponent('後')+'?'+encodeURIComponent('値')+'='+encodeURIComponent('漢字')+'%2F');
  for(const name of ['back','forward','reload']){f.notify(encoded);await f.state.action(name);assert.equal(f.state.address.value,readable);assert.equal(f.state.page.value.url,encoded);}
  f.state.navigate();await flush();assert.equal(f.calls.at(-1)[1],encoded);
  input().props.onFocus();input().props.onBlur();f.notify(encoded+'#next');assert.equal(f.state.address.value,readable+'#next');
 }finally{f.dispose();}
 const before=f.state.address.value;f.state.update({url:'https://changed.test/'});assert.equal(f.state.address.value,before);
});
test('Browser実コンポーネント: フォーカス全選択と日本語IME確定Enterの保護',async()=>{
 const f=fixture();try{
  await flush();const form=()=>findNode(f.render(),node=>node.type==='form');
  const input=()=>form().children.find(node=>node.type==='input');
  let selections=0;const focus={target:{select(){selections++;}}};
  input().props.onFocus(focus);assert.equal(selections,1);
  input().props.onCompositionstart();
  input().props['onUpdate:modelValue']('日本語 検索');
  let prevented=0;
  input().props.onKeydown({key:'Enter',preventDefault(){prevented++;}});
  form().props.onSubmit({preventDefault(){}});await flush();
  assert.equal(prevented,1);assert.equal(f.calls.filter(([name])=>name==='navigate').length,0);
  input().props.onCompositionend();
  for(const flags of [{isComposing:true},{keyCode:229}])input().props.onKeydown({key:'Enter',...flags,preventDefault(){prevented++;}});
  assert.equal(prevented,3,'ブラウザー側のIME判定・確定キーも送信しない');
  input().props.onKeydown({key:'Enter',preventDefault(){prevented++;}});assert.equal(prevented,3,'通常Enterはフォーム送信へ進む');
  form().props.onSubmit({preventDefault(){}});await flush();
  assert.deepEqual(f.calls.filter(([name])=>name==='navigate'),[['navigate','日本語 検索']]);
  assert.equal(f.state.page.value.url,'https://www.google.com/ai?q='+encodeURIComponent('日本語 検索'));
  input().props.onBlur();input().props.onFocus(focus);assert.equal(selections,2,'再フォーカスでも全選択する');
  input().props.onCompositionstart();input().props.onBlur();input().props.onFocus(focus);
  input().props['onUpdate:modelValue']('127.0.0.1:8090');form().props.onSubmit({preventDefault(){}});await flush();
  assert.equal(f.state.page.value.url,'http://127.0.0.1:8090/','IME入力の中断後も通常入力を開ける');
 }finally{f.dispose();}
});
