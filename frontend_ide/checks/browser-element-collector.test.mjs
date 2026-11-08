// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBrowserElement} from '../デスクトップ/ブラウザ要素情報.cjs';
// ブラウザAPIの小さな代役でcollector本体を実行。実DOM描画試験とは区別する。
function dom(){
 const doc={URL:'https://user:password@site.test/path?token=url-private#private',baseURI:'https://site.test/'};
 doc.defaultView={CSS:{escape:value=>value},getComputedStyle:node=>({display:node.attrs.style==='display:none'?'none':'block',visibility:node.attrs.style==='visibility:hidden'?'hidden':'visible',getPropertyValue:name=>name==='width'?'120px':name==='display'?'block':''})};
 const text=value=>({nodeType:3,textContent:value});
 function element(tag,attrs={},...children){
  const node={nodeType:1,localName:tag,attrs,id:attrs.id||'',ownerDocument:doc,hidden:'hidden'in attrs,isContentEditable:'contenteditable'in attrs,childNodes:children.map(child=>typeof child==='string'?text(child):child),attributes:Object.entries(attrs).map(([name,value])=>({name,value})),getAttribute:name=>attrs[name]??null,getBoundingClientRect:()=>({x:1.234,y:2,width:120,height:40}),closest(){return this.isContentEditable?this:this.parentElement?.closest()||null;}};
  node.children=node.childNodes.filter(child=>child.nodeType===1);for(const child of node.childNodes)child.parentElement=node;return node;
 }
 return{element};
}
test('要素情報: 入力・非表示DOM・スクリプト・機密属性・JSON秘密値・URL情報を除外',()=>{
 const {element:e}=dom();
 const node=e('section',{id:'form','data-token':'data-secret',onclick:'event-secret',style:'style-secret'},
  e('h2',{},'商品フォーム'),e('input',{value:'input-secret',type:'password'}),e('input',{type:'hidden',value:'hidden-secret'}),e('textarea',{},'textarea-secret'),e('select',{},e('option',{},'option-secret')),e('div',{contenteditable:'true'},'editable-secret'),
  e('span',{hidden:''},'hidden-note'),e('div',{style:'display:none'},'display-note'),e('div',{style:'visibility:hidden'},'visibility-note'),e('div',{'aria-hidden':'true'},'aria-note'),
  e('script',{},'script-secret'),e('style',{},'css-secret'),e('iframe',{srcdoc:'srcdoc-secret'},'iframe-secret'),
  e('pre',{},'{"password":"json-private","token":"json-token"} secret=plain-private Bearer bearer-private sk-abcdefghijklmnopqrst'),
  e('pre',{},JSON.stringify({password:'escaped-quote-\"-escaped-tail-private'})),
  e('a',{href:'https://user:pass@site.test/next?token=query-private#fragment-private',title:'<script>not executable</script>'},'次へ'));
 const result=collectBrowserElement.call(node),serialized=JSON.stringify(result);
 for(const text of ['data-secret','event-secret','style-secret','input-secret','hidden-secret','textarea-secret','option-secret','editable-secret','hidden-note','display-note','visibility-note','aria-note','script-secret','css-secret','srcdoc-secret','iframe-secret','json-private','json-token','escaped-quote','escaped-tail-private','plain-private','bearer-private','sk-abcdefghijklmnopqrst','query-private','fragment-private','url-private','user:password'])assert.ok(!serialized.includes(text),'excluded '+text);
 assert.equal(result.url,'https://site.test/path');assert.equal(result.selector,'section#form');assert.equal(result.rect.x,1.23);assert.match(result.html,/商品フォーム/);assert.match(result.html,/&lt;script&gt;/);assert.match(result.html,/https:\/\/site.test\/next/);assert.match(result.notice,/元のVue/);
});
test('要素情報: ノード数・深さ・文字数を制限し、入力フォーム選択でも値を読まない',()=>{
 const {element:e}=dom();
 const many=collectBrowserElement.call(e('div',{},...Array.from({length:600},()=>e('span',{},'x'.repeat(1200)))));
 assert.ok(many.html.length<=16000);assert.ok(many.text.length<=1000);assert.equal(many.truncated,true);
 let deep=e('div',{},'deep-secret');for(let i=0;i<20;i++)deep=e('div',{},deep);const limited=collectBrowserElement.call(deep);assert.equal(limited.truncated,true);assert.ok(!limited.html.includes('deep-secret'));
 const input=e('input',{type:'text',name:'username'});Object.defineProperty(input,'value',{get(){throw Error('入力値へアクセスした');}});assert.match(collectBrowserElement.call(input).html,/入力値は取得しません/);
});
