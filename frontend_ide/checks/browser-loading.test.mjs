// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse,compileTemplate} from '@vue/compiler-sfc';
import {transformSync} from 'esbuild';
import * as vue from 'vue';
import vm from 'node:vm';
const {descriptor}=parse(readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8'));
const compiled=compileTemplate({source:descriptor.template.content,filename:'Browser.vue',id:'loading-check'});
assert.deepEqual(compiled.errors,[]);
const module={exports:{}};
vm.runInNewContext(transformSync(compiled.code,{format:'cjs'}).code,{module,exports:module.exports,require:()=>({...vue,resolveComponent:name=>name})});
function label(page){
 const context={page,analysisStatus:{status:'idle'},openingAnalysis:false,analysisContext:null,headerOnly:false,headerOffset:0,windowTitle:'Browser',standalone:false,headerWindowApi:undefined,capturing:false,handing:false,captureMessage:'',address:'',error:'',draftRequest:null,transition(){},capture(){},handoff(){},action(){},navigate(){}};
 const root=module.exports.render(context,[]);
 function find(v){if(v?.type==='p'&&v.props?.role==='status'&&String(v.props.class).includes('browser-page-title'))return v;for(const c of Array.isArray(v?.children)?v.children:[]){const result=find(c);if(result)return result;}}
 return find(root);
}
for(const [name,page,expected,busy]of [
 ['読込開始',{loading:true,title:'前のページ'},'Loading…',true],
 ['読込完了',{loading:false,title:'公開画像'},'公開画像',false],
 ['読込失敗',{loading:true,title:'前のページ',error:'読込失敗'},'前のページ',false],
 ['手動停止',{loading:false,title:'停止したページ'},'停止したページ',false],
 ['次のページへ移動',{loading:true,title:'次のページ'},'Loading…',true],
])test(`Browser Loading表示: ${name}`,()=>{
 const node=label(page);assert.ok(node);
 assert.equal(node.props['aria-busy'],busy);
 assert.equal(node.props.class.includes('browser-loading'),busy);
 assert.equal(typeof node.children==='string'?node.children:node.children.map(child=>child?.children||'').join(''),expected);
});
